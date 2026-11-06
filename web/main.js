// src/dat/container.ts
var DatFile = class {
  bytes;
  name;
  indexOffset;
  indexSize;
  entries;
  byId;
  constructor(bytes, name = "<dat>") {
    this.bytes = bytes;
    this.name = name;
    if (bytes.length < 6) throw new Error(`${name}: too short to be a DAT file`);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.indexOffset = dv.getUint32(0, true);
    this.indexSize = dv.getUint16(4, true);
    if (this.indexOffset + 2 > bytes.length) {
      throw new Error(`${name}: index offset ${this.indexOffset} is past end of file`);
    }
    const count = dv.getUint16(this.indexOffset, true);
    if (this.indexSize !== 2 + 8 * count) {
      throw new Error(
        `${name}: index size ${this.indexSize} does not match ${count} entries`
      );
    }
    const entries = [];
    const byId = /* @__PURE__ */ new Map();
    let p = this.indexOffset + 2;
    for (let i = 0; i < count; i++, p += 8) {
      const e = {
        id: dv.getUint16(p, true),
        offset: dv.getUint32(p + 2, true),
        size: dv.getUint16(p + 6, true)
      };
      if (e.offset + 1 + e.size > bytes.length) {
        throw new Error(`${name}: resource ${e.id} runs past end of file`);
      }
      entries.push(e);
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    this.entries = entries;
    this.byId = byId;
  }
  has(id) {
    return this.byId.has(id);
  }
  ids() {
    return this.entries.map((e) => e.id);
  }
  /** Payload of a resource, as a view into the underlying buffer. */
  get(id) {
    const e = this.byId.get(id);
    if (!e) throw new Error(`${this.name}: no resource with id ${id}`);
    return this.bytes.subarray(e.offset + 1, e.offset + 1 + e.size);
  }
  /** The stored checksum byte of a resource. */
  checksumOf(id) {
    const e = this.byId.get(id);
    if (!e) throw new Error(`${this.name}: no resource with id ${id}`);
    return this.bytes[e.offset];
  }
  /** True when the stored checksum matches the payload. */
  verify(id) {
    const payload = this.get(id);
    let sum = this.checksumOf(id);
    for (let i = 0; i < payload.length; i++) sum += payload[i];
    return (sum & 255) === 255;
  }
};

// src/dat/palette.ts
var PALETTE_SIZE = 100;
function parsePalette(payload) {
  if (payload.length !== PALETTE_SIZE) {
    throw new Error(`palette must be ${PALETTE_SIZE} bytes, got ${payload.length}`);
  }
  const vga = [];
  for (let i = 0; i < 16; i++) {
    const o = 4 + i * 3;
    vga.push({ r: payload[o], g: payload[o + 1], b: payload[o + 2] });
  }
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    imageCount: payload[0],
    rowBits: dv.getUint16(1, true),
    colorCount: payload[3],
    vga,
    cga: payload.slice(52, 68),
    ega: payload.slice(68, 100)
  };
}
function to8(c6) {
  return c6 << 2 & 255;
}
function paletteToRgba(pal) {
  const out = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    out[i * 4 + 0] = to8(pal.vga[i].r);
    out[i * 4 + 1] = to8(pal.vga[i].g);
    out[i * 4 + 2] = to8(pal.vga[i].b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// src/dat/image.ts
var WINDOW_SIZE = 1024;
var WINDOW_START = WINDOW_SIZE - 66;
var i8 = (v) => v << 24 >> 24;
var i16 = (v) => v << 16 >> 16;
var CompressionMethod = {
  Raw: 0,
  RleRowMajor: 1,
  RleColumnMajor: 2,
  LzRowMajor: 3,
  LzColumnMajor: 4
};
function readImageHeader(payload) {
  if (payload.length < 6) throw new Error("image payload shorter than its header");
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const height = dv.getUint16(0, true);
  const width = dv.getUint16(2, true);
  const flags = dv.getUint16(4, true);
  const depth = (flags >> 12 & 7) + 1;
  const method = flags >> 8 & 15;
  const stride = depth * width + 7 >> 3;
  return { height, width, flags, depth, method, stride };
}
function isEmptyPlaceholder(payload) {
  return payload.length <= 5 && payload.every((b) => b === 0);
}
function rleRowMajor(dest, src, destLength) {
  let sp = 0;
  let dp = 0;
  let rem = i16(destLength);
  while (rem !== 0) {
    let count = i8(src[sp++]);
    if (count >= 0) {
      count = i8(count + 1);
      do {
        dest[dp++] = src[sp++];
        rem = i16(rem - 1);
        count = i8(count - 1);
      } while (count !== 0 && rem !== 0);
    } else {
      const value = src[sp++];
      count = i8(-count);
      do {
        dest[dp++] = value;
        rem = i16(rem - 1);
        count = i8(count - 1);
      } while (count !== 0 && rem !== 0);
    }
  }
  return sp;
}
function rleColumnMajor(dest, src, destLength, stride, height) {
  let sp = 0;
  let dp = 0;
  let rem = i16(destLength);
  let remHeight = i16(height);
  const back = destLength - 1;
  const step2 = stride - 1;
  while (rem !== 0) {
    let count = i8(src[sp++]);
    const literal = count >= 0;
    let value = 0;
    if (literal) count = i8(count + 1);
    else {
      value = src[sp++];
      count = i8(-count);
    }
    do {
      dest[dp++] = literal ? src[sp++] : value;
      dp += step2;
      remHeight = i16(remHeight - 1);
      if (remHeight === 0) {
        dp -= back;
        remHeight = i16(height);
      }
      rem = i16(rem - 1);
      count = i8(count - 1);
    } while (count !== 0 && rem !== 0);
  }
  return sp;
}
function lzRowMajor(dest, src, destLength) {
  const window2 = new Uint8Array(WINDOW_SIZE);
  let wp = WINDOW_START;
  let remaining = i16(destLength);
  let sp = 0;
  let dp = 0;
  let mask = 0;
  do {
    mask >>>= 1;
    if ((mask & 65280) === 0) mask = src[sp++] | 65280;
    if (mask & 1) {
      const v = src[sp++];
      window2[wp++] = v;
      dest[dp++] = v;
      if (wp >= WINDOW_SIZE) wp = 0;
      remaining = i16(remaining - 1);
    } else {
      const info = (src[sp] << 8 | src[sp + 1]) & 65535;
      sp += 2;
      let from = info & 1023;
      let runLength = (info >>> 10) + 3 & 255;
      do {
        const v = window2[from++];
        window2[wp++] = v;
        dest[dp++] = v;
        if (from >= WINDOW_SIZE) from = 0;
        if (wp >= WINDOW_SIZE) wp = 0;
        remaining = i16(remaining - 1);
        runLength = runLength - 1 & 255;
      } while (remaining !== 0 && runLength !== 0);
    }
  } while (remaining !== 0);
  return sp;
}
function lzColumnMajor(dest, src, destLength, stride, height) {
  const window2 = new Uint8Array(WINDOW_SIZE);
  let wp = WINDOW_START;
  let remaining = i16(height);
  let left = destLength;
  const back = i16(destLength - 1);
  let sp = 0;
  let dp = 0;
  let mask = 0;
  do {
    mask >>>= 1;
    if ((mask & 65280) === 0) mask = src[sp++] | 65280;
    if (mask & 1) {
      const v = src[sp++];
      window2[wp++] = v;
      dest[dp] = v;
      dp += stride;
      remaining = i16(remaining - 1);
      if (remaining === 0) {
        dp -= back;
        remaining = i16(height);
      }
      if (wp >= WINDOW_SIZE) wp = 0;
      left -= 1;
    } else {
      const info = (src[sp] << 8 | src[sp + 1]) & 65535;
      sp += 2;
      let from = info & 1023;
      let runLength = (info >>> 10) + 3 & 255;
      do {
        const v = window2[from++];
        window2[wp++] = v;
        dest[dp] = v;
        dp += stride;
        remaining = i16(remaining - 1);
        if (remaining === 0) {
          dp -= back;
          remaining = i16(height);
        }
        if (from >= WINDOW_SIZE) from = 0;
        if (wp >= WINDOW_SIZE) wp = 0;
        left -= 1;
        runLength = runLength - 1 & 255;
      } while (left !== 0 && runLength !== 0);
    }
  } while (left !== 0);
  return sp;
}
function unpackPixels(packed, width, height, stride, depth) {
  const out = new Uint8Array(width * height);
  const perByte = 8 / depth;
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++) {
    let ip = y * stride;
    let op = y * width;
    for (let x = 0, b = 0; b < stride; b++) {
      const v = packed[ip++];
      let shift = 8;
      for (let k = 0; k < perByte && x < width; k++, x++) {
        shift -= depth;
        out[op++] = v >> shift & mask;
      }
    }
  }
  return out;
}
function decodeImage(payload) {
  const h = readImageHeader(payload);
  if (h.height === 0) throw new Error("image has zero height");
  const body = payload.subarray(6);
  const destSize = h.stride * h.height;
  const packed = new Uint8Array(destSize);
  let consumed;
  switch (h.method) {
    case CompressionMethod.Raw:
      packed.set(body.subarray(0, destSize));
      consumed = destSize;
      break;
    case CompressionMethod.RleRowMajor:
      consumed = rleRowMajor(packed, body, destSize);
      break;
    case CompressionMethod.RleColumnMajor:
      consumed = rleColumnMajor(packed, body, destSize, h.stride, h.height);
      break;
    case CompressionMethod.LzRowMajor:
      consumed = lzRowMajor(packed, body, destSize);
      break;
    case CompressionMethod.LzColumnMajor:
      consumed = lzColumnMajor(packed, body, destSize, h.stride, h.height);
      break;
    default:
      throw new Error(`unknown compression method ${h.method}`);
  }
  return {
    ...h,
    pixels: unpackPixels(packed, h.width, h.height, h.stride, h.depth),
    bytesConsumed: consumed
  };
}

// src/render/assets.ts
var OPTIONAL_GRAPHICS_BASE = 1200;
var OPTIONAL_GRAPHICS_RANGES = [
  [1, 9],
  [30, 31],
  [75, 77],
  [78, 83],
  [86, 91],
  [101, 123],
  [127, 143],
  [10, 13]
];
var Assets = class {
  dats = /* @__PURE__ */ new Map();
  fetcher;
  constructor(fetcher) {
    this.fetcher = fetcher;
  }
  async dat(name) {
    let d = this.dats.get(name);
    if (!d) {
      d = new DatFile(await this.fetcher(name), name);
      this.dats.set(name, d);
    }
    return d;
  }
  /**
   * Load a sprite group: its header resource plus the images that follow.
   *
   * A group's header can live in a different file from its images. The
   * ordinary guard is the case that needs it: GUARD.DAT holds the sprites
   * and no header at all, while GUARD1.DAT and GUARD2.DAT hold nothing but
   * the header, one for the palace and one for the dungeon.
   */
  async group(file, header, paletteBase = 0, withOptional = false, headerFile = file) {
    const d = await this.dat(file);
    const h = headerFile === file ? d : await this.dat(headerFile);
    const palette = parsePalette(h.get(header));
    const images = [null];
    for (let i = 1; i <= palette.imageCount; i++) {
      const id = header + i;
      if (!d.has(id)) {
        images.push(null);
        continue;
      }
      const payload = d.get(id);
      images.push(isEmptyPlaceholder(payload) ? null : decodeImage(payload));
    }
    if (withOptional) {
      for (const [from, to] of OPTIONAL_GRAPHICS_RANGES) {
        for (let id = from; id <= to; id++) {
          if (id >= images.length) continue;
          const resource = OPTIONAL_GRAPHICS_BASE + id;
          if (!d.has(resource)) continue;
          const payload = d.get(resource);
          if (isEmptyPlaceholder(payload)) continue;
          images[id] = decodeImage(payload);
        }
      }
    }
    return { palette, paletteBase, paletteRgba: paletteToRgba(palette), images };
  }
  /** A single image that is not part of a group, with a palette named separately. */
  async image(file, id) {
    const d = await this.dat(file);
    return decodeImage(d.get(id));
  }
  async palette(file, id) {
    const d = await this.dat(file);
    return parsePalette(d.get(id));
  }
};
function browserFetcher(baseUrl) {
  return async (name) => {
    const res = await fetch(`${baseUrl}/${name}`);
    if (!res.ok) throw new Error(`cannot load ${name}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}

// src/render/surface.ts
var SCREEN_WIDTH = 320;
var SCREEN_HEIGHT = 200;
var PALETTE_SIZE2 = 256;
var ScreenPalette = class {
  /** r, g, b per entry, each 0..63. */
  rgb6 = new Uint8Array(PALETTE_SIZE2 * 3);
  rgba = new Uint8Array(PALETTE_SIZE2 * 4);
  dirty = true;
  /** Load sixteen colours into the block starting at `base`. */
  loadBlock(base, colors) {
    for (let i = 0; i < colors.length && base + i < PALETTE_SIZE2; i++) {
      const o = (base + i) * 3;
      this.rgb6[o] = colors[i].r;
      this.rgb6[o + 1] = colors[i].g;
      this.rgb6[o + 2] = colors[i].b;
    }
    this.dirty = true;
  }
  /** RGBA bytes, expanding each 6-bit component the way the DAC did. */
  toRgba() {
    if (this.dirty) {
      for (let i = 0; i < PALETTE_SIZE2; i++) {
        this.rgba[i * 4] = this.rgb6[i * 3] << 2 & 255;
        this.rgba[i * 4 + 1] = this.rgb6[i * 3 + 1] << 2 & 255;
        this.rgba[i * 4 + 2] = this.rgb6[i * 3 + 2] << 2 & 255;
        this.rgba[i * 4 + 3] = 255;
      }
      this.dirty = false;
    }
    return this.rgba;
  }
};
var Surface = class {
  width;
  height;
  pixels;
  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }
  clear(color = 0) {
    this.pixels.fill(color);
  }
  fillRect(x, y, w, h, color) {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      this.pixels.fill(color, yy * this.width + x0, yy * this.width + x1);
    }
  }
  /** Copy every pixel, including the sprite's colour 0. */
  blitOpaque(src, x, y, base = 0) {
    this.blit(src, x, y, base, false);
  }
  /** Copy every pixel except the sprite's colour 0, which is see-through. */
  blitTransparent(src, x, y, base = 0) {
    this.blit(src, x, y, base, true);
  }
  /** Paint the sprite's non-zero pixels in one flat colour. */
  blitMono(src, x, y, color) {
    this.each(src, x, y, (dp, v) => {
      if (v !== 0) this.pixels[dp] = color;
    });
  }
  blitXor(src, x, y, base = 0) {
    this.each(src, x, y, (dp, v) => {
      this.pixels[dp] ^= base + v;
    });
  }
  blit(src, x, y, base, transparent) {
    this.each(src, x, y, (dp, v) => {
      if (transparent && v === 0) return;
      this.pixels[dp] = base + v;
    });
  }
  each(src, x, y, fn) {
    const sx0 = Math.max(0, -x);
    const sy0 = Math.max(0, -y);
    const sx1 = Math.min(src.width, this.width - x);
    const sy1 = Math.min(src.height, this.height - y);
    for (let sy = sy0; sy < sy1; sy++) {
      let sp = sy * src.width + sx0;
      let dp = (y + sy) * this.width + (x + sx0);
      for (let sx = sx0; sx < sx1; sx++, sp++, dp++) fn(dp, src.pixels[sp]);
    }
  }
  /** Expand to RGBA for putImageData. */
  toRgba(paletteRgba, out) {
    const dst = out ?? new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 4;
      dst[i * 4] = paletteRgba[c];
      dst[i * 4 + 1] = paletteRgba[c + 1];
      dst[i * 4 + 2] = paletteRgba[c + 2];
      dst[i * 4 + 3] = 255;
    }
    return dst;
  }
  /** RGB triples, for comparing against a captured frame. */
  toRgb(paletteRgba) {
    const dst = new Uint8Array(this.width * this.height * 3);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 4;
      dst[i * 3] = paletteRgba[c];
      dst[i * 3 + 1] = paletteRgba[c + 1];
      dst[i * 3 + 2] = paletteRgba[c + 2];
    }
    return dst;
  }
};

// src/render/display.ts
var Display = class {
  canvas;
  ctx;
  imageData;
  aspect = "original-4-3";
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("cannot get a 2d context");
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.imageData = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.applyAspect();
  }
  setAspect(mode) {
    this.aspect = mode;
    this.applyAspect();
  }
  applyAspect() {
    const s = this.canvas.style;
    s.imageRendering = "pixelated";
    s.aspectRatio = this.aspect === "original-4-3" ? "4 / 3" : "320 / 200";
  }
  present(surface, paletteRgba) {
    surface.toRgba(paletteRgba, this.imageData.data);
    this.ctx.putImageData(this.imageData, 0, 0);
  }
};

// src/game/tiles.ts
var ROOM_COLUMNS = 10;
var TILE = {
  empty: 0,
  floor: 1,
  spike: 2,
  pillar: 3,
  gate: 4,
  stuck: 5,
  closer: 6,
  doortopWithFloor: 7,
  bigPillarBottom: 8,
  bigPillarTop: 9,
  potion: 10,
  loose: 11,
  doortop: 12,
  mirror: 13,
  debris: 14,
  opener: 15,
  levelDoorLeft: 16,
  levelDoorRight: 17,
  chomper: 18,
  torch: 19,
  wall: 20,
  skeleton: 21,
  sword: 22,
  balconyLeft: 23,
  balconyRight: 24,
  latticePillar: 25,
  latticeDown: 26,
  latticeSmall: 27,
  latticeLeft: 28,
  latticeRight: 29,
  torchWithDebris: 30
};
var TILE_TYPE_MASK = 31;
function tileIsFloor(tileType) {
  switch (tileType) {
    case TILE.empty:
    case TILE.bigPillarTop:
    case TILE.doortop:
    case TILE.wall:
    case TILE.latticeDown:
    case TILE.latticeSmall:
    case TILE.latticeLeft:
    case TILE.latticeRight:
      return false;
    default:
      return true;
  }
}
function piece(v) {
  return {
    baseId: v[0],
    floorLeft: v[1],
    baseY: v[2],
    rightId: v[3],
    floorRight: v[4],
    rightY: v[5],
    stripeId: v[6],
    topRightId: v[7],
    bottomId: v[8],
    foreId: v[9],
    foreX: v[10],
    foreY: v[11]
  };
}
var TILE_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  // empty
  [41, 1, 0, 42, 1, 2, 145, 0, 43, 0, 0, 0],
  // floor
  [127, 1, 0, 133, 1, 2, 145, 0, 43, 0, 0, 0],
  // spike
  [92, 1, 0, 93, 1, 2, 0, 94, 43, 95, 1, 0],
  // pillar
  [46, 1, 0, 47, 1, 2, 0, 48, 43, 49, 3, 0],
  // gate
  [41, 1, 1, 35, 1, 3, 145, 0, 36, 0, 0, 0],
  // stuck floor
  [41, 1, 0, 42, 1, 2, 145, 0, 96, 0, 0, 0],
  // close button
  [46, 1, 0, 0, 0, 2, 0, 0, 43, 49, 3, 0],
  // door top with floor
  [86, 1, 0, 87, 1, 2, 0, 0, 43, 88, 1, 0],
  // big pillar bottom
  [0, 0, 0, 89, 0, 3, 0, 90, 0, 91, 1, 3],
  // big pillar top
  [41, 1, 0, 42, 1, 2, 145, 0, 43, 12, 2, -3],
  // potion
  [0, 1, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0],
  // loose floor
  [0, 0, 0, 0, 0, 2, 0, 0, 85, 49, 3, 0],
  // door top
  [75, 1, 0, 42, 1, 2, 0, 0, 43, 77, 0, 0],
  // mirror
  [97, 1, 0, 98, 1, 2, 145, 0, 43, 100, 0, 0],
  // debris
  [147, 1, 0, 42, 1, 1, 145, 0, 149, 0, 0, 0],
  // open button
  [41, 1, 0, 37, 0, 0, 0, 38, 43, 0, 0, 0],
  // level door left
  [0, 0, 0, 39, 1, 2, 0, 40, 43, 0, 0, 0],
  // level door right
  [0, 0, 0, 42, 1, 2, 145, 0, 43, 0, 0, 0],
  // chomper
  [41, 1, 0, 42, 1, 2, 0, 0, 43, 0, 0, 0],
  // torch
  [0, 0, 0, 1, 1, 2, 0, 2, 0, 0, 0, 0],
  // wall
  [30, 1, 0, 31, 1, 2, 0, 0, 43, 0, 0, 0],
  // skeleton
  [41, 1, 0, 42, 1, 2, 145, 0, 43, 0, 0, 0],
  // sword
  [41, 1, 0, 10, 0, 0, 0, 11, 43, 0, 0, 0],
  // balcony left
  [0, 0, 0, 12, 1, 2, 0, 13, 43, 0, 0, 0],
  // balcony right
  [92, 1, 0, 42, 1, 2, 145, 0, 43, 95, 1, 0],
  // lattice pillar
  [1, 0, 0, 0, 0, 0, 0, 0, 2, 9, 0, -53],
  // lattice down
  [3, 0, -10, 0, 0, 0, 0, 0, 0, 9, 0, -53],
  // lattice small
  [4, 0, -10, 0, 0, 0, 0, 0, 0, 9, 0, -53],
  // lattice left
  [5, 0, -10, 0, 0, 0, 0, 0, 0, 9, 0, -53],
  // lattice right
  [97, 1, 0, 98, 1, 2, 0, 0, 43, 100, 0, 0]
  // debris with torch
].map(piece);
var WALL_SWS = 0;
var WALL_SWW = 1;
var WALL_WWS = 2;
var WALL_WWW = 3;
function alterModifiers(fg, bg, roomLinks, roomCount) {
  const mod = bg.slice();
  const rooms = Math.min(roomCount, 24);
  const typeAt = (index) => fg[index] & TILE_TYPE_MASK;
  for (let room = 1; room <= rooms; room++) {
    const roomL = roomLinks[(room - 1) * 4 + 0];
    const roomR = roomLinks[(room - 1) * 4 + 1];
    for (let tilepos = 0; tilepos < 30; tilepos++) {
      const index = (room - 1) * 30 + tilepos;
      const type = typeAt(index);
      switch (type) {
        case TILE.gate:
          mod[index] = mod[index] === 1 ? 188 : 0;
          break;
        case TILE.loose:
          mod[index] = 0;
          break;
        case TILE.potion:
          mod[index] = mod[index] << 3 & 255;
          break;
        case TILE.wall: {
          mod[index] = mod[index] === 1 ? 128 : 0;
          let wallLeft = true;
          let wallRight = true;
          if (tilepos % 10 === 0) {
            if (roomL) wallLeft = typeAt((roomL - 1) * 30 + tilepos + 9) === TILE.wall;
          } else {
            wallLeft = typeAt(index - 1) === TILE.wall;
          }
          if (tilepos % 10 === 9) {
            if (roomR) wallRight = typeAt((roomR - 1) * 30 + tilepos - 9) === TILE.wall;
          } else {
            wallRight = typeAt(index + 1) === TILE.wall;
          }
          if (wallLeft && wallRight) mod[index] |= WALL_WWW;
          else if (wallLeft) mod[index] |= WALL_WWS;
          else if (wallRight) mod[index] |= WALL_SWW;
          break;
        }
        default:
          break;
      }
    }
  }
  return mod;
}

// src/game/geometry.ts
var TILE_SIZE_X = 14;
var TILE_MID_X = 7;
var FIRST_ONSCREEN_COLUMN = 5;
var X_BUMP = [
  -12,
  2,
  16,
  30,
  44,
  58,
  72,
  86,
  100,
  114,
  128,
  142,
  156,
  170,
  184,
  198,
  212,
  226,
  240,
  254
];
var Y_LAND = [-8, 55, 118, 181, 244];
function toScreenX(logicalX) {
  return Math.trunc(logicalX * 320 / 280);
}

// src/render/room.ts
var flipCache = /* @__PURE__ */ new WeakMap();
function flipHorizontally(img) {
  const cached = flipCache.get(img);
  if (cached) return cached;
  const pixels = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      pixels[y * img.width + (img.width - 1 - x)] = img.pixels[y * img.width + x];
    }
  }
  const out = { width: img.width, height: img.height, pixels };
  flipCache.set(img, out);
  return out;
}
var BLIT = {
  opaque: 0,
  or: 2,
  xor: 3,
  black: 9,
  transparent: 16,
  mono: 64,
  mono12: 76,
  /**
   * The brick edges of a palace wall. The original stamps these masks in one
   * flat colour taken from the wall group's own palette, not from the first
   * sixteen entries; which entry was settled by comparing against the game.
   */
  palaceDecal: 4110
};
var CHTAB = {
  /** PRINCE.DAT group 700: the sword in the Prince's hand. */
  sword: "sword",
  /** PRINCE.DAT group 150: torch flames, loose sword, potions, bubbles. */
  flameSwordPotion: "flameSwordPotion",
  /** KID.DAT group 400: the Prince. */
  kid: "kid",
  /** The enemy sprite set of the level: a guard, a skeleton, Jaffar. */
  guard: "guard",
  /** The tile set's group 200. */
  environment: "environment",
  /** The tile set's group 360. */
  environmentWall: "environmentWall"
};
var COL_X = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288];
var WALL_RES = {
  divider1: 11,
  randomBlock: 13,
  markTopLeft: 14,
  markBottomLeft: 15,
  markTopRight: 16,
  markBottomRight: 17
};
var DOORTOP_FRAM_TOP = [0, 81, 83, 0];
var DOOR_FRAM_TOP = [60, 61, 62, 63, 64, 65, 66, 67];
var BLUELINE_FRAM1 = [0, 124, 125, 126];
var BLUELINE_FRAM_Y = [0, -20, -20, 0];
var BLUELINE_FRAM3 = [44, 44, 45, 45];
var DOORTOP_FRAM_BOT = [78, 80, 82, 0];
var DOOR_FRAM_SLICE = [67, 59, 58, 57, 56, 55, 54, 53, 52];
var SPIKES_FRAM_RIGHT = [0, 134, 135, 136, 137, 138, 137, 135, 134, 0];
var LOOSE_FRAM_RIGHT = [42, 71, 42, 72, 72, 42, 42, 42, 72, 72, 72, 0];
var WALL_FRAM_BOTTOM = [7, 9, 5, 3];
var LOOSE_FRAM_BOTTOM = [43, 73, 43, 74, 74, 43, 43, 43, 74, 74, 74, 0];
var LOOSE_FRAM_LEFT = [41, 69, 41, 70, 70, 41, 41, 41, 70, 70, 70, 0];
var SPIKES_FRAM_LEFT = [0, 128, 129, 130, 131, 132, 131, 129, 128, 0];
var POTION_FRAM_BUBB = [0, 16, 17, 18, 19, 20, 21, 22];
var CHOMPER_FRAM1 = [3, 2, 0, 1, 4, 3, 3, 0];
var CHOMPER_FRAM_BOT = [101, 102, 103, 104, 105, 0];
var CHOMPER_FRAM_TOP = [0, 0, 111, 112, 113, 0];
var CHOMPER_FRAM_Y = [0, 0, 37, 47, 50];
var SPIKES_FRAM_FORE = [0, 139, 140, 141, 142, 143, 142, 140, 139, 0];
var CHOMPER_FRAM_FOR = [106, 107, 108, 109, 110, 0];
var WALL_FRAM_MAIN = [8, 10, 6, 4];
var LEFT_MARK_Y = [58, 41, 37, 20, 16];
var RIGHT_MARK_Y = [52, 42, 31, 21];
function spikeFrame(modifier) {
  return modifier & 128 ? 5 : modifier;
}
function looseFrame(modifier) {
  if (modifier & 128) {
    const m = modifier & 127;
    if (m > 10) return 1;
    return m;
  }
  return modifier;
}
var Prng = class {
  seed = 0;
  set(value) {
    this.seed = value >>> 0;
  }
  get() {
    return this.seed >>> 0;
  }
  next(max) {
    this.seed = Math.imul(this.seed, 214013) + 2531011 >>> 0;
    return (this.seed >>> 16) % (max + 1);
  }
};
function generatePalaceWallColors(room) {
  const out = new Uint8Array(132);
  const prng = new Prng();
  prng.set(room);
  prng.next(1);
  for (let row = 0; row < 3; row++) {
    for (let subrow = 0; subrow < 4; subrow++) {
      const base = subrow % 2 ? 97 : 102;
      let prev = -1;
      for (let column = 0; column <= 10; column++) {
        let color;
        do {
          color = base + prng.next(3);
        } while (color === prev);
        out[44 * row + 11 * subrow + column] = color;
        prev = color;
      }
    }
  }
  return out;
}
var RoomRenderer = class {
  chtabs;
  tiles;
  opt;
  back = [];
  mid = [];
  fore = [];
  wipes = [];
  /** Which list draw_tile_base / draw_tile_bottom append to. */
  addTo = "back";
  drawnRoom = 0;
  drawnRow = 0;
  drawnCol = 0;
  drawX = 0;
  drawBottomY = 0;
  drawMainY = 0;
  currTile = 0;
  currModifier = 0;
  tileLeft = 0;
  modifierLeft = 0;
  roomL = 0;
  roomR = 0;
  roomA = 0;
  roomB = 0;
  roomAL = 0;
  roomAR = 0;
  roomBL = 0;
  roomBR = 0;
  leftRoomTiles = new Uint8Array(3);
  leftRoomMods = new Uint8Array(3);
  rowBelowTiles = new Uint8Array(ROOM_COLUMNS);
  rowBelowMods = new Uint8Array(ROOM_COLUMNS);
  prng = new Prng();
  palaceWallColors = new Uint8Array(132);
  constructor(chtabs, tiles, opt) {
    this.chtabs = chtabs;
    this.tiles = tiles;
    this.opt = opt;
  }
  get isPalace() {
    return this.opt.levelType !== 0;
  }
  /** Build the draw lists for a room and paint them onto `surface`. */
  render(surface, room, characters = []) {
    this.back = [];
    this.mid = [];
    this.fore = [];
    this.wipes = [];
    this.addTo = "back";
    this.drawnRoom = room;
    this.palaceWallColors = this.opt.palaceWallColors ?? generatePalaceWallColors(room);
    this.loadRoomLinks();
    this.drawRoom();
    for (const c of characters) this.addCharacter(c);
    this.paint(surface);
  }
  // ---------------------------------------------------------------- lists
  addBack(chtab, id, x, yBottom, blit) {
    return this.push(this.back, chtab, id, x, yBottom, blit);
  }
  addFore(chtab, id, x, yBottom, blit) {
    return this.push(this.fore, chtab, id, x, yBottom, blit);
  }
  addMid(chtab, id, x, yBottom, blit) {
    return this.push(this.mid, chtab, id, x, yBottom, blit);
  }
  addCurrent(chtab, id, x, yBottom, blit) {
    return this.addTo === "back" ? this.addBack(chtab, id, x, yBottom, blit) : this.addFore(chtab, id, x, yBottom, blit);
  }
  push(list, chtab, id, x, yBottom, blit) {
    if (id === 0) return false;
    if (!this.image(chtab, id)) return false;
    list.push({ chtab, id, x, yBottom, blit });
    return true;
  }
  addWipe(layer, left, bottom, height, width, color) {
    this.wipes.push({ layer, left, bottom, height, width, color });
  }
  image(chtab, id) {
    return this.chtabs[chtab]?.images[id] ?? null;
  }
  // ------------------------------------------------------------ room setup
  loadRoomLinks() {
    const room = this.drawnRoom;
    this.roomBR = 0;
    this.roomBL = 0;
    this.roomAR = 0;
    this.roomAL = 0;
    if (!room) {
      this.roomL = this.roomR = this.roomA = this.roomB = 0;
      return;
    }
    this.roomL = this.tiles.linkOf(room, 0);
    this.roomR = this.tiles.linkOf(room, 1);
    this.roomA = this.tiles.linkOf(room, 2);
    this.roomB = this.tiles.linkOf(room, 3);
    if (this.roomA) {
      this.roomAL = this.tiles.linkOf(this.roomA, 0);
      this.roomAR = this.tiles.linkOf(this.roomA, 1);
    } else {
      if (this.roomL) this.roomAL = this.tiles.linkOf(this.roomL, 2);
      if (this.roomR) this.roomAR = this.tiles.linkOf(this.roomR, 2);
    }
    if (this.roomB) {
      this.roomBL = this.tiles.linkOf(this.roomB, 0);
      this.roomBR = this.tiles.linkOf(this.roomB, 1);
    } else {
      if (this.roomL) this.roomBL = this.tiles.linkOf(this.roomL, 3);
      if (this.roomR) this.roomBR = this.tiles.linkOf(this.roomR, 3);
    }
  }
  /**
   * A tile as it should be drawn: buttons that are currently held down show
   * as a different tile, and tiles outside the level show as the level edge.
   */
  tileToDraw(room, column, row, outsideTile) {
    let type;
    let modifier;
    if (column === -1) {
      type = this.leftRoomTiles[row];
      modifier = this.leftRoomMods[row];
    } else if (room) {
      type = this.tiles.typeAt(room, column, row) & TILE_TYPE_MASK;
      modifier = this.tiles.modifierAt(room, column, row);
    } else {
      type = outsideTile;
      modifier = 0;
    }
    return { type, modifier };
  }
  loadLeftRoom() {
    for (let row = 0; row < 3; row++) {
      const t = this.tileToDraw(this.roomL, 9, row, this.opt.leftLevelEdgeTile);
      this.leftRoomTiles[row] = t.type;
      this.leftRoomMods[row] = t.modifier;
    }
  }
  loadRowBelow() {
    let room;
    let roomLeft;
    let rowBelow;
    if (this.drawnRow === 2) {
      room = this.roomB;
      roomLeft = this.roomBL;
      rowBelow = 0;
    } else {
      room = this.drawnRoom;
      roomLeft = this.roomL;
      rowBelow = this.drawnRow + 1;
    }
    for (let column = 1; column < 10; column++) {
      const t = this.tileToDraw(room, column - 1, rowBelow, TILE.empty);
      this.rowBelowTiles[column] = t.type;
      this.rowBelowMods[column] = t.modifier;
    }
    const t0 = this.tileToDraw(roomLeft, 9, rowBelow, TILE.wall);
    this.rowBelowTiles[0] = t0.type;
    this.rowBelowMods[0] = t0.modifier;
  }
  loadCurrentAndLeftTile() {
    const outside = this.drawnRow === 2 ? this.opt.topLevelEdgeTile : TILE.wall;
    const curr = this.tileToDraw(this.drawnRoom, this.drawnCol, this.drawnRow, outside);
    this.currTile = curr.type;
    this.currModifier = curr.modifier;
    const left = this.tileToDraw(this.drawnRoom, this.drawnCol - 1, this.drawnRow, outside);
    this.tileLeft = left.type;
    this.modifierLeft = left.modifier;
    this.drawX = COL_X[this.drawnCol];
  }
  drawRoom() {
    this.loadLeftRoom();
    for (this.drawnRow = 2; this.drawnRow >= 0; this.drawnRow--) {
      this.loadRowBelow();
      this.drawBottomY = 63 * this.drawnRow + 65;
      this.drawMainY = this.drawBottomY - 3;
      for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
        this.loadCurrentAndLeftTile();
        this.drawTile();
      }
    }
    const saved = this.drawnRoom;
    this.drawnRoom = this.roomA;
    this.loadRoomLinks();
    this.loadLeftRoom();
    this.drawnRow = 2;
    this.loadRowBelow();
    for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
      this.loadCurrentAndLeftTile();
      this.drawMainY = -1;
      this.drawBottomY = 2;
      this.drawTileAboveRoom();
    }
    this.drawnRoom = saved;
    this.loadRoomLinks();
  }
  drawTile() {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileBase();
    this.drawTileAnim();
    this.drawTileFore();
  }
  drawTileAboveRoom() {
    this.drawTileFloorRight();
    this.drawTileAnimTopRight();
    this.drawTileRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileFore();
  }
  // ---------------------------------------------------------------- passes
  canSeeBottomLeft() {
    return this.currTile === TILE.empty || this.currTile === TILE.bigPillarTop || this.currTile === TILE.doortop || this.currTile === TILE.latticeDown;
  }
  drawTileFloorRight() {
    if (!this.canSeeBottomLeft()) return;
    this.drawTileTopRight();
    if (TILE_TABLE[this.tileLeft].floorRight === 0) return;
    this.addBack(
      CHTAB.environment,
      42,
      this.drawX,
      TILE_TABLE[TILE.floor].rightY + this.drawMainY,
      BLIT.black
    );
  }
  drawTileTopRight() {
    const type = this.rowBelowTiles[this.drawnCol];
    const modifier = this.rowBelowMods[this.drawnCol];
    if (type === TILE.doortopWithFloor || type === TILE.doortop) {
      if (!this.isPalace) return;
      this.addBack(
        CHTAB.environment,
        DOORTOP_FRAM_TOP[modifier] ?? 0,
        this.drawX,
        this.drawBottomY,
        BLIT.or
      );
    } else if (type === TILE.wall) {
      this.addBack(CHTAB.environmentWall, 2, this.drawX, this.drawBottomY, BLIT.or);
    } else {
      this.addBack(
        CHTAB.environment,
        TILE_TABLE[type].topRightId,
        this.drawX,
        this.drawBottomY,
        BLIT.or
      );
    }
  }
  drawTileAnimTopRight() {
    const seeThrough = this.currTile === TILE.empty || this.currTile === TILE.bigPillarTop || this.currTile === TILE.doortop;
    if (!seeThrough || this.rowBelowTiles[this.drawnCol] !== TILE.gate) return;
    this.addBack(CHTAB.environment, 68, this.drawX, this.drawBottomY, BLIT.mono);
    let modifier = this.rowBelowMods[this.drawnCol];
    if (modifier > 188) modifier = 188;
    this.addBack(
      CHTAB.environment,
      DOOR_FRAM_TOP[(modifier >> 2) % 8],
      this.drawX,
      this.drawBottomY,
      BLIT.or
    );
  }
  drawTileRight() {
    if (this.currTile === TILE.wall) return;
    const left = this.tileLeft;
    switch (left) {
      case TILE.empty: {
        if (this.modifierLeft > 3) return;
        this.addBack(
          CHTAB.environment,
          BLUELINE_FRAM1[this.modifierLeft],
          this.drawX,
          BLUELINE_FRAM_Y[this.modifierLeft] + this.drawMainY,
          BLIT.or
        );
        break;
      }
      case TILE.floor: {
        this.addCurrent(
          CHTAB.environment,
          42,
          this.drawX,
          TILE_TABLE[left].rightY + this.drawMainY,
          BLIT.transparent
        );
        let num = this.modifierLeft;
        if (num > 3) num = 0;
        if (num === (this.isPalace ? 1 : 0)) return;
        this.addBack(
          CHTAB.environment,
          BLUELINE_FRAM3[num],
          this.drawX,
          this.drawMainY - 20,
          BLIT.opaque
        );
        break;
      }
      case TILE.doortopWithFloor:
      case TILE.doortop: {
        if (!this.isPalace) return;
        this.addBack(
          CHTAB.environment,
          DOORTOP_FRAM_BOT[this.modifierLeft] ?? 0,
          this.drawX,
          TILE_TABLE[left].rightY + this.drawMainY,
          BLIT.or
        );
        break;
      }
      case TILE.wall: {
        if (this.isPalace && (this.modifierLeft & 128) === 0) {
          this.addBack(
            CHTAB.environment,
            84,
            this.drawX + 24,
            this.drawMainY - 27,
            BLIT.opaque
          );
        }
        this.addBack(
          CHTAB.environmentWall,
          1,
          this.drawX,
          TILE_TABLE[left].rightY + this.drawMainY,
          BLIT.or
        );
        break;
      }
      default: {
        let id = TILE_TABLE[left].rightId;
        if (id) {
          let blit = BLIT.or;
          if (left === TILE.stuck) {
            blit = BLIT.transparent;
            if (this.currTile === TILE.empty || this.currTile === TILE.stuck || !tileIsFloor(this.currTile)) {
              id = 42;
            }
          }
          this.addBack(
            CHTAB.environment,
            id,
            this.drawX,
            TILE_TABLE[left].rightY + this.drawMainY,
            blit
          );
        }
        if (this.isPalace) {
          this.addBack(
            CHTAB.environment,
            TILE_TABLE[left].stripeId,
            this.drawX,
            this.drawMainY - 27,
            BLIT.or
          );
        }
        if (left === TILE.torch || left === TILE.torchWithDebris) {
          this.addBack(
            CHTAB.environment,
            146,
            this.drawX,
            this.drawBottomY - 28,
            BLIT.opaque
          );
        }
        break;
      }
    }
  }
  drawTileAnimRight() {
    switch (this.tileLeft) {
      case TILE.spike:
        this.addBack(
          CHTAB.environment,
          SPIKES_FRAM_RIGHT[spikeFrame(this.modifierLeft)] ?? 0,
          this.drawX,
          this.drawMainY - 7,
          BLIT.transparent
        );
        break;
      case TILE.gate:
        this.drawGateBack();
        break;
      case TILE.loose:
        this.addBack(
          CHTAB.environment,
          LOOSE_FRAM_RIGHT[looseFrame(this.modifierLeft)] ?? 0,
          this.drawX,
          this.drawBottomY - 1,
          BLIT.or
        );
        break;
      case TILE.levelDoorLeft:
        this.drawLevelDoor();
        break;
      case TILE.torch:
      case TILE.torchWithDebris:
        if (this.modifierLeft < 9) {
          this.addBack(
            CHTAB.flameSwordPotion,
            this.modifierLeft + 1,
            this.drawX + 8,
            this.drawMainY - 40,
            BLIT.opaque
          );
        }
        break;
      default:
        break;
    }
  }
  drawTileBottom() {
    let id = 0;
    let blit = BLIT.opaque;
    let chtab = CHTAB.environment;
    if (this.currTile === TILE.wall) {
      if (!this.isPalace || this.opt.enableWdaInPalace) {
        id = WALL_FRAM_BOTTOM[this.currModifier & 127] ?? 0;
      }
      chtab = CHTAB.environmentWall;
    } else {
      if (this.currTile === TILE.doortop) blit = BLIT.or;
      id = TILE_TABLE[this.currTile].bottomId;
    }
    this.addCurrent(chtab, id, this.drawX, this.drawBottomY, blit);
    if (chtab === CHTAB.environmentWall) this.wallPattern(0, 0);
  }
  drawLoose() {
    if (this.currTile !== TILE.loose) return;
    const id = LOOSE_FRAM_BOTTOM[looseFrame(this.currModifier)] ?? 0;
    this.addBack(CHTAB.environment, id, this.drawX, this.drawBottomY, BLIT.opaque);
    this.addFore(CHTAB.environment, id, this.drawX, this.drawBottomY, BLIT.opaque);
  }
  drawTileBase() {
    let id;
    let yBottom = this.drawMainY;
    if (this.tileLeft === TILE.latticeDown && this.currTile === TILE.doortop) {
      id = 6;
      yBottom += 3;
    } else if (this.currTile === TILE.loose) {
      id = LOOSE_FRAM_LEFT[looseFrame(this.currModifier)] ?? 0;
    } else if (this.currTile === TILE.opener && this.tileLeft === TILE.empty && !this.isPalace) {
      id = 148;
    } else {
      id = TILE_TABLE[this.currTile].baseId;
    }
    this.addCurrent(
      CHTAB.environment,
      id,
      this.drawX,
      TILE_TABLE[this.currTile].baseY + yBottom,
      BLIT.transparent
    );
  }
  drawTileAnim() {
    switch (this.currTile) {
      case TILE.spike:
        this.addCurrent(
          CHTAB.environment,
          SPIKES_FRAM_LEFT[spikeFrame(this.currModifier)] ?? 0,
          this.drawX,
          this.drawMainY - 2,
          BLIT.transparent
        );
        break;
      case TILE.potion: {
        let potSize = 0;
        let color = 12;
        switch ((this.currModifier & 248) >> 3) {
          case 0:
            return;
          case 5:
          case 6:
            color = 9;
            break;
          case 3:
          case 4:
            color = 10;
            potSize = 1;
            break;
          case 2:
            potSize = 1;
            break;
          default:
            break;
        }
        const y = this.drawMainY - (potSize << 2) - 14;
        this.addBack(CHTAB.flameSwordPotion, 23, this.drawX + 25, y, BLIT.mono);
        this.addFore(
          CHTAB.flameSwordPotion,
          POTION_FRAM_BUBB[this.currModifier & 7],
          this.drawX + 25,
          y,
          color + BLIT.mono
        );
        break;
      }
      case TILE.sword:
        this.addMid(
          CHTAB.flameSwordPotion,
          (this.currModifier === 1 ? 1 : 0) + 10,
          this.drawX,
          this.drawMainY - 3,
          BLIT.transparent
        );
        break;
      case TILE.chomper: {
        const n = CHOMPER_FRAM1[Math.min(this.currModifier & 127, 6)];
        this.addBack(
          CHTAB.environment,
          CHOMPER_FRAM_BOT[n] ?? 0,
          this.drawX,
          this.drawMainY,
          BLIT.transparent
        );
        if (this.currModifier & 128) {
          this.addBack(
            CHTAB.environment,
            n + 114,
            this.drawX + 12,
            this.drawMainY - 6,
            BLIT.mono12
          );
        }
        this.addBack(
          CHTAB.environment,
          CHOMPER_FRAM_TOP[n] ?? 0,
          this.drawX,
          this.drawMainY - (CHOMPER_FRAM_Y[n] ?? 0),
          BLIT.transparent
        );
        break;
      }
      default:
        break;
    }
  }
  drawTileFore() {
    if (this.tileLeft === TILE.gate && this.opt.gateForeAt && this.opt.gateForeAt(this.drawnRow, this.drawnCol - 1)) {
      this.drawGateFore();
    }
    switch (this.currTile) {
      case TILE.spike:
        this.addFore(
          CHTAB.environment,
          SPIKES_FRAM_FORE[spikeFrame(this.currModifier)] ?? 0,
          this.drawX,
          this.drawMainY - 2,
          BLIT.transparent
        );
        return;
      case TILE.chomper: {
        const n = CHOMPER_FRAM1[Math.min(this.currModifier & 127, 6)];
        this.addFore(
          CHTAB.environment,
          CHOMPER_FRAM_FOR[n] ?? 0,
          this.drawX,
          this.drawMainY,
          BLIT.transparent
        );
        if (this.currModifier & 128) {
          this.addFore(
            CHTAB.environment,
            n + 119,
            this.drawX + 12,
            this.drawMainY - 6,
            BLIT.mono12
          );
        }
        return;
      }
      case TILE.wall:
        if (!this.isPalace || this.opt.enableWdaInPalace) {
          this.addFore(
            CHTAB.environmentWall,
            WALL_FRAM_MAIN[this.currModifier & 127] ?? 0,
            this.drawX,
            this.drawMainY,
            BLIT.opaque
          );
        }
        this.wallPattern(1, 1);
        return;
      default: {
        const table = TILE_TABLE[this.currTile];
        let id = table.foreId;
        if (id === 0) return;
        if (this.currTile === TILE.potion) {
          const potionType = (this.currModifier & 248) >> 3;
          if (potionType < 5 && potionType >= 2) id = 13;
        }
        const x = table.foreX * 8 + this.drawX;
        const yBottom = table.foreY + this.drawMainY;
        if (this.currTile === TILE.potion) {
          if (this.isPalace) id += 2;
          this.addFore(CHTAB.flameSwordPotion, id, x + 6, yBottom, BLIT.transparent);
        } else if (this.currTile === TILE.pillar && !this.isPalace || this.currTile >= TILE.latticeSmall && this.currTile < TILE.torchWithDebris) {
          this.addFore(CHTAB.environment, id, x, yBottom, BLIT.opaque);
        } else {
          this.addFore(CHTAB.environment, id, x, yBottom, BLIT.transparent);
        }
        return;
      }
    }
  }
  // ------------------------------------------------------------ gates
  gateTopY = 0;
  gateOpenness = 0;
  gateBottomY = 0;
  /** Right edge of the level door, needed by the game logic later. */
  levelDoorRight = 0;
  levelDoorYBottom = 0;
  calcGatePos() {
    this.gateTopY = this.drawBottomY - 62;
    this.gateOpenness = (Math.min(this.modifierLeft, 188) >> 2) + 1;
    this.gateBottomY = this.drawMainY - this.gateOpenness;
  }
  drawGateBack() {
    this.calcGatePos();
    if (this.gateBottomY + 12 < this.drawMainY) {
      this.addBack(CHTAB.environment, 50, this.drawX, this.gateBottomY, BLIT.opaque);
    } else {
      this.addBack(
        CHTAB.environment,
        TILE_TABLE[TILE.gate].rightId,
        this.drawX,
        TILE_TABLE[TILE.gate].rightY + this.drawMainY,
        BLIT.opaque
      );
      if (this.canSeeBottomLeft()) this.drawTileTopRight();
      this.drawTileBottom();
      this.drawLoose();
      this.drawTileBase();
      this.addBack(CHTAB.environment, 51, this.drawX, this.gateBottomY - 2, BLIT.transparent);
    }
    let yBottom = this.gateBottomY - 12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom - 7 > this.gateTopY; yBottom -= 8) {
        this.addBack(CHTAB.environment, 52, this.drawX, yBottom, BLIT.opaque);
      }
    }
    const frame = yBottom - this.gateTopY + 1 & 65535;
    if (frame > 0 && frame < 9) {
      this.addBack(CHTAB.environment, DOOR_FRAM_SLICE[frame], this.drawX, yBottom, BLIT.opaque);
    }
  }
  drawGateFore() {
    this.calcGatePos();
    this.addFore(CHTAB.environment, 51, this.drawX, this.gateBottomY - 2, BLIT.transparent);
    let yBottom = this.gateBottomY - 12;
    if (yBottom < 192) {
      for (; yBottom >= 0 && yBottom > 7 && yBottom - 7 > this.gateTopY; yBottom -= 8) {
        this.addFore(CHTAB.environment, 52, this.drawX, yBottom, BLIT.transparent);
      }
    }
  }
  drawLevelDoor() {
    const yBottom = this.drawMainY - 13;
    this.levelDoorRight = this.drawX + 48 + (this.isPalace ? 8 : 0);
    this.addBack(CHTAB.environment, 99, this.drawX + 8, yBottom, BLIT.opaque);
    if (this.modifierLeft) {
      if (this.opt.startRoom !== this.drawnRoom) {
        this.addBack(CHTAB.environment, 144, this.drawX + 8, yBottom - 4, BLIT.opaque);
      } else {
        const width = this.isPalace ? 48 : 39;
        const xLow = this.isPalace ? 0 : 2;
        this.addWipe(0, this.drawX + 8 + xLow, yBottom - 4, 45, width, 0);
      }
    }
    this.levelDoorYBottom = yBottom - (this.modifierLeft & 3) - 48;
    const y = yBottom - this.modifierLeft;
    for (; ; ) {
      this.addBack(CHTAB.environment, 33, this.drawX + 8, this.levelDoorYBottom, BLIT.opaque);
      if (y > this.levelDoorYBottom) this.levelDoorYBottom += 4;
      else break;
    }
    this.addBack(CHTAB.environment, 34, this.drawX + 8, this.drawMainY - 64, BLIT.opaque);
  }
  // ------------------------------------------------------------- wall look
  /**
   * Dungeon walls are not a repeated tile: the original decorates each one
   * with brick dividers and chipped marks drawn from a generator seeded by
   * the tile's own position, so the wall looks irregular but is identical
   * every time the room is drawn.
   */
  wallPattern(whichPart, whichTable) {
    const savedAddTo = this.addTo;
    this.addTo = whichTable === 0 ? "back" : "fore";
    const savedSeed = this.prng.get();
    this.prng.set(this.drawnRoom + this.drawnRow * 10 + this.drawnCol >>> 0);
    this.prng.next(1);
    const isDungeon = !this.isPalace || this.opt.enableWdaInPalace;
    if (!isDungeon) {
      this.palaceWallPattern(whichPart, whichTable);
    } else {
      const middleDivider = this.prng.next(1);
      const middleOffset = this.prng.next(4);
      const bottomDivider = this.prng.next(1);
      const bottomOffset = this.prng.next(4);
      const mod = this.currModifier & 127;
      const randomBlock = () => {
        if (this.prng.next(4) === 0) {
          this.addCurrent(
            CHTAB.environmentWall,
            WALL_RES.randomBlock,
            this.drawX,
            this.drawBottomY - 42,
            BLIT.opaque
          );
        }
      };
      const middle = () => this.addCurrent(
        CHTAB.environmentWall,
        WALL_RES.divider1 + middleDivider,
        this.drawX + 8 + middleOffset,
        this.drawBottomY - 21,
        BLIT.transparent
      );
      const bottom = () => this.addCurrent(
        CHTAB.environmentWall,
        WALL_RES.divider1 + bottomDivider,
        this.drawX + bottomOffset,
        this.drawBottomY,
        BLIT.transparent
      );
      const left = (variant) => this.leftMark(
        variant,
        middleOffset - middleDivider,
        bottomOffset - bottomDivider
      );
      switch (mod) {
        case WALL_WWW:
          if (whichPart !== 0) {
            randomBlock();
            middle();
          }
          bottom();
          if (whichPart !== 0) {
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(3), middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(4));
          }
          break;
        case WALL_SWS:
          if (whichPart !== 0 && this.prng.next(6) === 0) left(this.prng.next(1));
          break;
        case WALL_SWW:
          if (whichPart !== 0) {
            randomBlock();
            middle();
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(3), middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(3));
          }
          break;
        case WALL_WWS:
          if (whichPart !== 0) middle();
          bottom();
          if (whichPart !== 0) {
            if (this.prng.next(4) === 0) this.rightMark(this.prng.next(1) + 2, middleOffset);
            if (this.prng.next(4) === 0) left(this.prng.next(4));
          }
          break;
        default:
          break;
      }
    }
    this.prng.set(savedSeed);
    this.addTo = savedAddTo;
  }
  palaceWallPattern(whichPart, whichTable) {
    const at = (i) => this.palaceWallColors[i];
    if (whichPart) {
      this.addWipe(whichTable, this.drawX, this.drawMainY - 40, 20, 32, at(44 * this.drawnRow + this.drawnCol));
      this.addWipe(whichTable, this.drawX, this.drawMainY - 19, 21, 16, at(44 * this.drawnRow + 11 + this.drawnCol));
      this.addWipe(whichTable, this.drawX + 16, this.drawMainY - 19, 21, 16, at(44 * this.drawnRow + 12 + this.drawnCol));
      this.addWipe(whichTable, this.drawX, this.drawMainY, 19, 8, at(44 * this.drawnRow + 22 + this.drawnCol));
      this.addWipe(whichTable, this.drawX + 8, this.drawMainY, 19, 24, at(44 * this.drawnRow + 23 + this.drawnCol));
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 3, this.drawX + 24, this.drawMainY - 53, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 6, this.drawX, this.drawMainY - 34, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 9, this.drawX, this.drawMainY - 13, BLIT.palaceDecal);
      this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 12, this.drawX, this.drawMainY, BLIT.palaceDecal);
    }
    this.addWipe(whichTable, this.drawX, this.drawBottomY, 3, 32, at(44 * this.drawnRow + 33 + this.drawnCol));
    this.addCurrent(CHTAB.environmentWall, this.prng.next(2) + 15, this.drawX, this.drawBottomY, BLIT.palaceDecal);
  }
  leftMark(variant, arg2, arg1) {
    const id = variant % 2 ? WALL_RES.markBottomLeft : WALL_RES.markTopLeft;
    let xl = 0;
    if (variant > 3) xl = arg1 + 6;
    else if (variant > 1) xl = arg2 + 6;
    const xh = this.drawX + (variant === 2 || variant === 3 ? 8 : 0);
    this.addCurrent(
      CHTAB.environmentWall,
      id,
      xh + xl,
      this.drawBottomY - LEFT_MARK_Y[variant],
      BLIT.transparent
    );
  }
  rightMark(variant, arg1) {
    const id = variant % 2 ? WALL_RES.markBottomRight : WALL_RES.markTopRight;
    const xl = variant < 2 ? 24 : arg1 - 3;
    const xh = this.drawX + (variant > 1 ? 8 : 0);
    this.addCurrent(
      CHTAB.environmentWall,
      id,
      xh + xl,
      this.drawBottomY - RIGHT_MARK_Y[variant],
      BLIT.transparent
    );
  }
  // ---------------------------------------------------------------- paint
  /**
   * Characters are flipped rather than mirrored in the data: the sprites face
   * left, and the original flips them when the character faces right. Their
   * horizontal position is in internal units and is stretched to pixels only
   * here, at the last moment, exactly as the original does.
   */
  addCharacter(c) {
    const set = this.chtabs[c.chtab];
    if (!set) return;
    const img = set.images[c.image];
    if (!img) return;
    this.mid.push({
      chtab: c.chtab,
      id: c.image,
      x: c.x,
      yBottom: c.y,
      blit: BLIT.transparent,
      character: true,
      flip: c.direction === 0,
      screenX: c.alreadyScreenX === true
    });
  }
  paint(surface) {
    this.paintWipes(surface, 0);
    for (const p of this.back) this.paintPiece(surface, p);
    for (const p of this.mid) this.paintPiece(surface, p);
    this.paintWipes(surface, 1);
    for (const p of this.fore) this.paintPiece(surface, p);
  }
  paintWipes(surface, layer) {
    for (const w of this.wipes) {
      if (w.layer !== layer) continue;
      for (let y = w.bottom - w.height + 1; y <= w.bottom; y++) {
        if (y < 0 || y >= surface.height) continue;
        for (let x = w.left; x < w.left + w.width; x++) {
          if (x < 0 || x >= surface.width) continue;
          surface.pixels[y * surface.width + x] = w.color;
        }
      }
    }
  }
  paintPiece(surface, p) {
    const img = this.image(p.chtab, p.id);
    if (!img) return;
    const set = this.chtabs[p.chtab];
    if (!set) return;
    const y = p.yBottom - img.height + 1;
    const base = set.paletteBase;
    if (p.character) {
      let x = p.screenX ? p.x : toScreenX(p.x);
      let sprite = img;
      if (p.flip) {
        x -= img.width;
        sprite = flipHorizontally(img);
      }
      surface.blitTransparent(sprite, x, y, base);
      return;
    }
    const blit = p.blit;
    if (blit === BLIT.opaque) {
      surface.blitOpaque(img, p.x, y, base);
    } else if (blit === BLIT.or || blit === BLIT.transparent) {
      surface.blitTransparent(img, p.x, y, base);
    } else if (blit === BLIT.xor) {
      surface.blitXor(img, p.x, y, base);
    } else if (blit === BLIT.black) {
      surface.blitMono(img, p.x, y, 0);
    } else if (blit >= 4096) {
      surface.blitMono(img, p.x, y, base + (blit & 15));
    } else {
      surface.blitMono(img, p.x, y, blit & 191);
    }
  }
};

// src/dat/level.ts
var ROOM_COUNT = 24;
var ROOM_WIDTH = 10;
var ROOM_HEIGHT = 3;
var TILES_PER_ROOM = ROOM_WIDTH * ROOM_HEIGHT;
var LEVEL_TILE_COUNT = ROOM_COUNT * TILES_PER_ROOM;
var LEVEL_PAYLOAD_SIZE = 2305;
var FIRST_LEVEL_RESOURCE = 2e3;
var OFF_FG = 0;
var OFF_BG = 720;
var OFF_DOORLINKS1 = 1440;
var OFF_DOORLINKS2 = 1696;
var OFF_ROOMLINKS = 1952;
var OFF_USED_ROOMS = 2048;
var OFF_ROOM_XS = 2049;
var OFF_ROOM_YS = 2073;
var OFF_START_ROOM = 2112;
var OFF_START_POS = 2113;
var OFF_START_DIR = 2114;
var OFF_GUARDS = 2119;
function normalise(payload) {
  if (payload.length >= LEVEL_PAYLOAD_SIZE) return payload;
  const out = new Uint8Array(LEVEL_PAYLOAD_SIZE);
  out.fill(255);
  out.set(payload);
  return out;
}
function parseLevel(payload, resourceId) {
  if (payload.length < LEVEL_PAYLOAD_SIZE - 1) {
    throw new Error(
      `level payload is ${payload.length} bytes, expected ${LEVEL_PAYLOAD_SIZE}`
    );
  }
  const d = normalise(payload);
  const guards = [];
  for (let i = 0; i < ROOM_COUNT; i++) {
    guards.push({
      tile: d[OFF_GUARDS + i],
      dir: d[OFF_GUARDS + 24 + i],
      x: d[OFF_GUARDS + 48 + i],
      seqLo: d[OFF_GUARDS + 72 + i],
      skill: d[OFF_GUARDS + 96 + i],
      seqHi: d[OFF_GUARDS + 120 + i],
      color: d[OFF_GUARDS + 144 + i]
    });
  }
  return {
    resourceId,
    fg: d.slice(OFF_FG, OFF_FG + LEVEL_TILE_COUNT),
    bg: d.slice(OFF_BG, OFF_BG + LEVEL_TILE_COUNT),
    doorLinks1: d.slice(OFF_DOORLINKS1, OFF_DOORLINKS1 + 256),
    doorLinks2: d.slice(OFF_DOORLINKS2, OFF_DOORLINKS2 + 256),
    roomLinks: d.slice(OFF_ROOMLINKS, OFF_ROOMLINKS + 96),
    usedRooms: d[OFF_USED_ROOMS],
    roomXs: d.slice(OFF_ROOM_XS, OFF_ROOM_XS + ROOM_COUNT),
    roomYs: d.slice(OFF_ROOM_YS, OFF_ROOM_YS + ROOM_COUNT),
    startRoom: d[OFF_START_ROOM],
    startPos: d[OFF_START_POS],
    startDir: d[OFF_START_DIR] << 24 >> 24,
    guards
  };
}
function resourceIdOfLevel(levelNumber) {
  return FIRST_LEVEL_RESOURCE + levelNumber;
}

// src/game/level-state.ts
var LevelState = class {
  /** Tile codes, room-major, as the level data lays them out. */
  fg;
  /** Modifier bytes, rewritten on load the way the original rewrites them. */
  modifiers;
  roomLinks;
  doorLinks1;
  doorLinks2;
  startRoom;
  startPos;
  startDir;
  constructor(level) {
    this.fg = level.fg.slice();
    this.modifiers = alterModifiers(level.fg, level.bg, level.roomLinks, 24);
    this.roomLinks = level.roomLinks.slice();
    this.doorLinks1 = level.doorLinks1.slice();
    this.doorLinks2 = level.doorLinks2.slice();
    this.startRoom = level.startRoom;
    this.startPos = level.startPos;
    this.startDir = level.startDir;
  }
  index(room, column, row) {
    return (room - 1) * 30 + row * ROOM_COLUMNS + column;
  }
  inRoom(room, column, row) {
    return room >= 1 && room <= 24 && column >= 0 && column < ROOM_COLUMNS && row >= 0 && row < 3;
  }
  /** The tile's type, with the modifier bits masked off. */
  typeAt(room, column, row) {
    if (!this.inRoom(room, column, row)) return 0;
    return this.fg[this.index(room, column, row)] & TILE_TYPE_MASK;
  }
  /** The raw tile byte, type and flags together. */
  rawAt(room, column, row) {
    if (!this.inRoom(room, column, row)) return 0;
    return this.fg[this.index(room, column, row)];
  }
  setType(room, column, row, type) {
    if (!this.inRoom(room, column, row)) return;
    this.fg[this.index(room, column, row)] = type;
  }
  modifierAt(room, column, row) {
    if (!this.inRoom(room, column, row)) return 0;
    return this.modifiers[this.index(room, column, row)];
  }
  setModifier(room, column, row, value) {
    if (!this.inRoom(room, column, row)) return;
    this.modifiers[this.index(room, column, row)] = value & 255;
  }
  /** By tile position within a room: 0..29, counting across then down. */
  typeAtPos(room, tilePos) {
    return this.typeAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }
  rawAtPos(room, tilePos) {
    return this.rawAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }
  setTypeAtPos(room, tilePos, type) {
    this.setType(room, tilePos % 10, Math.floor(tilePos / 10), type);
  }
  modifierAtPos(room, tilePos) {
    return this.modifierAt(room, tilePos % 10, Math.floor(tilePos / 10));
  }
  setModifierAtPos(room, tilePos, value) {
    this.setModifier(room, tilePos % 10, Math.floor(tilePos / 10), value);
  }
  linkOf(room, dir) {
    if (room < 1 || room > 24) return 0;
    return this.roomLinks[(room - 1) * 4 + dir];
  }
  /**
   * A door link entry: which tile in which room a button is wired to, and
   * whether another entry follows. The room number is split across the two
   * arrays, which is why it is assembled rather than read.
   */
  doorLink(index) {
    const a = this.doorLinks1[index] ?? 0;
    const b = this.doorLinks2[index] ?? 0;
    return {
      room: ((a & 96) >> 5) + ((b & 224) >> 3),
      tilePos: a & 31,
      hasNext: (a & 128) === 0
    };
  }
  doorLinkTimer(index) {
    return (this.doorLinks2[index] ?? 0) & 31;
  }
  setDoorLinkTimer(index, value) {
    if (index < 0 || index >= this.doorLinks2.length) return;
    this.doorLinks2[index] = this.doorLinks2[index] & 224 | value & 31;
  }
};

// src/game/exe-constants.ts
var OFF = {
  startMinutesLeft: 18979,
  startTicksLeft: 18985,
  startHitPoints: 18991,
  firstLevel: 1799,
  maxHitPointsAllowed: 5105,
  savingAllowedFirstLevel: 1992,
  savingAllowedLastLevel: 1999,
  copyProtectionLevel: 109291,
  drawnTileTopLevelEdge: 41456,
  drawnTileLeftLevelEdge: 41579,
  levelEdgeHitTile: 28418,
  levelType: 109802,
  guardHitPoints: 112808,
  vgaPalette: 119105,
  demoHitPoints: 19496,
  demoEndRoom: 2880,
  introMusicLevel: 19511,
  checkpointLevel: 19358,
  checkpointRespawnDir: 19372,
  checkpointRespawnRoom: 19377,
  checkpointRespawnTilePos: 19382,
  skeletonLevel: 18084,
  skeletonRoom: 18104,
  skeletonColumn: 18142,
  skeletonRow: 18146,
  mirrorLevel: 36295,
  mirrorRoom: 36299,
  enableWdaInPalace: 42939
};
var SUPPORTED_EXE_SIZE = 123335;
function checkExe(exe) {
  if (exe.length !== SUPPORTED_EXE_SIZE) {
    throw new Error(
      `unsupported PRINCE.EXE: ${exe.length} bytes, expected ${SUPPORTED_EXE_SIZE}`
    );
  }
  if (exe[0] !== 77 || exe[1] !== 90) {
    throw new Error("not a DOS executable (no MZ signature)");
  }
  const levelType = exe.subarray(OFF.levelType, OFF.levelType + 16);
  for (const v of levelType) {
    if (v > 1) throw new Error("level type table does not look like dungeon/palace flags");
  }
}
function readExeConstants(exe) {
  checkExe(exe);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const u162 = (o) => dv.getUint16(o, true);
  const u82 = (o) => exe[o];
  const vgaPalette = [];
  for (let i = 0; i < 16; i++) {
    const o = OFF.vgaPalette + i * 3;
    vgaPalette.push({ r: exe[o], g: exe[o + 1], b: exe[o + 2] });
  }
  return {
    startMinutesLeft: u162(OFF.startMinutesLeft),
    startTicksLeft: u162(OFF.startTicksLeft),
    startHitPoints: u162(OFF.startHitPoints),
    firstLevel: u162(OFF.firstLevel),
    maxHitPointsAllowed: u162(OFF.maxHitPointsAllowed),
    savingAllowedFirstLevel: u82(OFF.savingAllowedFirstLevel) + 1,
    savingAllowedLastLevel: u82(OFF.savingAllowedLastLevel) - 1,
    copyProtectionLevel: u162(OFF.copyProtectionLevel),
    drawnTileTopLevelEdge: u82(OFF.drawnTileTopLevelEdge),
    drawnTileLeftLevelEdge: u82(OFF.drawnTileLeftLevelEdge),
    levelEdgeHitTile: u82(OFF.levelEdgeHitTile),
    levelType: exe.slice(OFF.levelType, OFF.levelType + 16),
    guardHitPoints: exe.slice(OFF.guardHitPoints, OFF.guardHitPoints + 16),
    demoHitPoints: u82(OFF.demoHitPoints),
    demoEndRoom: u82(OFF.demoEndRoom),
    introMusicLevel: u82(OFF.introMusicLevel),
    checkpointLevel: u82(OFF.checkpointLevel),
    checkpointRespawnDir: u82(OFF.checkpointRespawnDir) << 24 >> 24,
    checkpointRespawnRoom: u82(OFF.checkpointRespawnRoom),
    checkpointRespawnTilePos: u82(OFF.checkpointRespawnTilePos),
    skeletonLevel: u82(OFF.skeletonLevel),
    skeletonRoom: u82(OFF.skeletonRoom),
    skeletonColumn: u82(OFF.skeletonColumn),
    skeletonRow: u82(OFF.skeletonRow),
    mirrorLevel: u82(OFF.mirrorLevel),
    mirrorRoom: u82(OFF.mirrorRoom),
    vgaPalette,
    // The original compares against 116; anything else means the "wall
    // decoration algorithm" was enabled for palace levels too.
    enableWdaInPalace: u82(OFF.enableWdaInPalace) !== 116
  };
}

// src/game/character.ts
var DIRECTION = {
  right: 0,
  left: -1
};
var CHAR_ID = {
  kid: 0,
  shadow: 1,
  guard: 2,
  skeleton: 4,
  princess: 5,
  vizier: 6,
  mouse: 24
};
function newCharacter(partial = {}) {
  return {
    x: 0,
    y: 0,
    direction: DIRECTION.left,
    frame: 0,
    room: 1,
    currentColumn: 0,
    currentRow: 0,
    charId: CHAR_ID.kid,
    currentSequence: 0,
    action: 0,
    fallX: 0,
    fallY: 0,
    alive: -1,
    sword: 0,
    repeat: 0,
    grabTimer: 0,
    ...partial
  };
}
function forwardX(state, deltaX) {
  return state.x + (state.direction < 0 ? -deltaX : deltaX);
}
function placeCharacter(state, frame, chtab = "kid") {
  if (frame.image === 255) return null;
  let x = (forwardX(state, frame.dx) << 1) - 116;
  if ((frame.flags ^ state.direction) << 24 >> 24 >= 0) x += 1;
  return {
    chtab,
    image: frame.image + 1,
    x,
    y: frame.dy + state.y,
    direction: state.direction
  };
}
function placeSword(state, frame, swordTable, toScreenX2) {
  const index = frame.sword & 63;
  if (!index) return null;
  const placement = swordTable[index];
  if (!placement || placement.id === 255) return null;
  const base = placeCharacter(state, frame);
  if (!base) return null;
  const dx = state.direction < 0 ? -placement.x : placement.x;
  return {
    chtab: "sword",
    image: placement.id + 1,
    x: toScreenX2(base.x) + dx,
    y: base.y + placement.y,
    direction: state.direction,
    alreadyScreenX: true
  };
}

// src/game/exe-tables.ts
var FRAME_FLAG = {
  weightX: 31,
  thin: 32,
  needsFloor: 64,
  evenOddPixel: 128
};
var OFF2 = {
  swordTable: 114903,
  frameTableKid: 113061,
  frameTableGuard: 114267,
  frameTableCutscene: 114473,
  sequenceOffsets: 115063,
  sequences: 115291
};
var COUNT = {
  swordTable: 51,
  frameTableKid: 241,
  frameTableGuard: 41,
  frameTableCutscene: 86,
  /** Sequence ids are 1-based; index 0 is unused. */
  sequences: 114,
  sequenceBytes: 2282
};
function expandSequenceRuns(packed, before) {
  const out = [];
  let plain = before;
  for (let i = 0; i < packed.length; i++) {
    const block = i + 6 < packed.length && packed[i + 2] === 178 && packed[i + 5] === 0 && packed[i + 6] === 176 && (packed[i] | packed[i + 1] << 8) === plain;
    if (block) {
      for (let k = packed[i + 4]; k > 0; k--) out.push(packed[i + 3]);
      i += 6;
      plain = 0;
      continue;
    }
    out.push(packed[i]);
    plain += 1;
  }
  return Uint8Array.from(out);
}
var SEQUENCE_BASE = 6510;
function readFrames(exe, offset, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 5;
    out.push({
      image: exe[o],
      sword: exe[o + 1],
      dx: exe[o + 2] << 24 >> 24,
      dy: exe[o + 3] << 24 >> 24,
      flags: exe[o + 4]
    });
  }
  return out;
}
function readExeTables(exe) {
  checkExe(exe);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const sequenceOffsets = new Uint16Array(COUNT.sequences + 1);
  for (let i = 1; i <= COUNT.sequences; i++) {
    sequenceOffsets[i] = dv.getUint16(OFF2.sequenceOffsets + (i - 1) * 2, true);
  }
  const swordTable = [];
  for (let i = 0; i < COUNT.swordTable; i++) {
    const o = OFF2.swordTable + i * 3;
    swordTable.push({
      id: exe[o],
      x: exe[o + 1] << 24 >> 24,
      y: exe[o + 2] << 24 >> 24
    });
  }
  return {
    swordTable,
    frameTableKid: readFrames(exe, OFF2.frameTableKid, COUNT.frameTableKid),
    frameTableGuard: readFrames(exe, OFF2.frameTableGuard, COUNT.frameTableGuard),
    frameTableCutscene: readFrames(exe, OFF2.frameTableCutscene, COUNT.frameTableCutscene),
    sequences: expandSequenceRuns(
      exe.slice(OFF2.sequences, OFF2.sequences + COUNT.sequenceBytes),
      OFF2.sequences - OFF2.sequenceOffsets
    ),
    sequenceOffsets
  };
}

// src/game/sequence.ts
var SEQ_OP = {
  dx: 251,
  dy: 250,
  flip: 254,
  jumpIfFeather: 247,
  jump: 255,
  up: 253,
  down: 252,
  action: 249,
  setFall: 248,
  knockUp: 245,
  knockDown: 244,
  sound: 242,
  endLevel: 241,
  getItem: 243,
  die: 246
};
var ACTION = {
  stand: 0,
  runJump: 1,
  hangClimb: 2,
  inMidair: 3,
  inFreefall: 4,
  bumped: 5,
  hangStraight: 6,
  turning: 7
};
var u8 = (v) => v & 255;
var i82 = (v) => v << 24 >> 24;
function startSequence(state, id, tables) {
  state.currentSequence = tables.sequenceOffsets[id];
}
function playSequence(state, ctx) {
  const code = ctx.tables.sequences;
  const read = () => {
    const at = state.currentSequence - SEQUENCE_BASE;
    state.currentSequence = state.currentSequence + 1 & 65535;
    return at >= 0 && at < code.length ? code[at] : 255;
  };
  for (let guard = 0; guard < 1e3; guard++) {
    const at = state.currentSequence - SEQUENCE_BASE;
    if (at < 0 || at >= code.length) return false;
    const command = read();
    switch (command) {
      case SEQ_OP.dx:
        state.x = u8(forwardX(state, i82(read())));
        break;
      case SEQ_OP.dy:
        state.y = u8(state.y + i82(read()));
        break;
      case SEQ_OP.flip:
        state.direction = ~state.direction;
        break;
      case SEQ_OP.jumpIfFeather:
        if (!ctx.isFeatherFall) {
          read();
          read();
          break;
        }
      // fallthrough: a feather fall takes the jump
      case SEQ_OP.jump: {
        const lo = read();
        const hi = read();
        state.currentSequence = lo | hi << 8;
        break;
      }
      case SEQ_OP.up:
        state.currentRow -= 1;
        ctx.effects?.rowChanged?.(-1);
        break;
      case SEQ_OP.down:
        state.currentRow += 1;
        ctx.effects?.rowChanged?.(1);
        break;
      case SEQ_OP.action:
        state.action = read();
        break;
      case SEQ_OP.setFall:
        state.fallX = i82(read());
        state.fallY = i82(read());
        break;
      case SEQ_OP.knockUp:
        ctx.effects?.knock?.(1);
        break;
      case SEQ_OP.knockDown:
        ctx.effects?.knock?.(-1);
        break;
      case SEQ_OP.sound: {
        const sound = read();
        ctx.effects?.sound?.(sound);
        break;
      }
      case SEQ_OP.endLevel:
        ctx.effects?.endLevel?.();
        break;
      case SEQ_OP.getItem: {
        const item = read();
        ctx.effects?.getItem?.(item);
        break;
      }
      case SEQ_OP.die:
        ctx.effects?.die?.();
        break;
      default:
        state.frame = command;
        return true;
    }
  }
  throw new Error("sequence did not reach a frame");
}

// src/game/physics.ts
var SCREENSPACE_X = 58;
var TILE_RIGHT_X = 13;
var TILE_SIZE_Y = 63;
var FALLING_SPEED_MAX = 33;
var FALLING_SPEED_ACCEL = 3;
var DIR_FRONT = [-1, 1];
var DIR_BEHIND = [1, -1];
var EDGE_TYPE = {
  floor: 0,
  wall: 1,
  /** A tile the character must stop short of: a button, a sword, a potion. */
  closer: 2
};
var WALL_DIST_FROM_LEFT = [0, 10, 0, -1, 0, 0];
var WALL_DIST_FROM_RIGHT = [0, 0, 10, 13, 0, 0];
var GATE_OPEN_ENOUGH = 6;
function gateBlocks(modifier) {
  return modifier >> 2 < GATE_OPEN_ENOUGH;
}
function wallTypeAt(world, tile) {
  if (tile.type === TILE.gate) {
    if (tile.room === 0) return 0;
    const modifier = world.modifierAt(tile.room, tile.column, tile.row);
    if (!gateBlocks(modifier)) return 0;
  }
  return wallType(tile.type);
}
function wallType(tileType) {
  switch (tileType) {
    case TILE.gate:
    case TILE.doortopWithFloor:
    case TILE.doortop:
      return 1;
    // wall on the right
    case TILE.mirror:
      return 2;
    // wall on the left
    case TILE.chomper:
      return 3;
    // chomper on the left
    case TILE.wall:
      return 4;
    // wall on both sides
    default:
      return 0;
  }
}
function getTile(world, room, column, row) {
  let r = room;
  let col = column;
  let line = row;
  while (col < 0 && r) {
    r = world.linkOf(r, 0);
    col += 10;
  }
  while (col > 9 && r) {
    r = world.linkOf(r, 1);
    col -= 10;
  }
  while (line < 0 && r) {
    r = world.linkOf(r, 2);
    line += 3;
  }
  while (line > 2 && r) {
    r = world.linkOf(r, 3);
    line -= 3;
  }
  if (!r || col < 0 || col > 9 || line < 0 || line > 2) {
    return { type: world.levelEdgeHitTile, room: 0, column: col, row: line };
  }
  return { type: world.tileAt(r, col, line) & TILE_TYPE_MASK, room: r, column: col, row: line };
}
function tileDivMod(xpos) {
  const x = xpos - SCREENSPACE_X;
  let column = Math.trunc(x / TILE_SIZE_X);
  let offset = x % TILE_SIZE_X;
  if (offset < 0) {
    column -= 1;
    offset += TILE_SIZE_X;
  }
  return { column, offset };
}
function tileDivModM7(xpos) {
  return tileDivMod(xpos - TILE_MID_X);
}
function weightX(state, frame) {
  return forwardX(state, frame.dx - (frame.flags & FRAME_FLAG.weightX));
}
function determineColumn(state, frame) {
  return tileDivModM7(weightX(state, frame)).column;
}
function distanceToEdge(state, xpos) {
  const { offset } = tileDivModM7(xpos);
  return state.direction === 0 ? TILE_RIGHT_X - offset : offset;
}
function distanceToEdgeWeight(state, frame) {
  return distanceToEdge(state, weightX(state, frame));
}
function charCollision(state, frame, objX, spriteWidth) {
  const halfWidth = Math.trunc((spriteWidth + 1) / 2);
  let xLeft = Math.trunc(objX / 2) + SCREENSPACE_X;
  if (state.direction >= 0) xLeft -= halfWidth;
  const xRight = xLeft + halfWidth;
  let xLeftColl = xLeft;
  let xRightColl = xRight;
  if (frame.flags & FRAME_FLAG.thin) {
    xLeftColl += 4;
    xRightColl -= 4;
  }
  return { xLeft, xRight, xLeftColl, xRightColl };
}
function distanceFromWallForward(state, tileType, tileColumn, coll, knownType) {
  const type = knownType ?? wallType(tileType);
  if (type === 0) return -1;
  const tileLeft = X_BUMP[tileColumn + FIRST_ONSCREEN_COLUMN] + TILE_MID_X;
  if (state.direction < 0) {
    return coll.xLeftColl - (tileLeft + TILE_RIGHT_X - WALL_DIST_FROM_RIGHT[type]);
  }
  return WALL_DIST_FROM_LEFT[type] + tileLeft - coll.xRightColl;
}
function getEdgeDistance(world, state, frame, objX, spriteWidth) {
  const coll = charCollision(state, frame, objX, spriteWidth);
  const here = getTile(world, state.room, state.currentColumn, state.currentRow);
  const classify = (distance) => distance <= TILE_RIGHT_X ? { distance, edgeType: EDGE_TYPE.wall } : { distance: 11, edgeType: EDGE_TYPE.floor };
  const hereWall = wallTypeAt(world, here);
  if (hereWall !== 0) {
    const d = distanceFromWallForward(
      state,
      here.type,
      state.currentColumn,
      coll,
      hereWall
    );
    if (d >= 0) return classify(d);
  }
  const frontColumn = DIR_FRONT[state.direction + 1] + state.currentColumn;
  const front = getTile(world, state.room, frontColumn, state.currentRow);
  if (front.type === TILE.doortop && state.direction >= 0) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.closer };
  }
  const frontWall = wallTypeAt(world, front);
  if (frontWall !== 0) {
    const d = distanceFromWallForward(state, front.type, frontColumn, coll, frontWall);
    if (d >= 0) return classify(d);
  }
  if (front.type === TILE.loose) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.closer };
  }
  if (front.type === TILE.closer || front.type === TILE.sword || front.type === TILE.potion) {
    const d = distanceToEdgeWeight(state, frame);
    return { distance: d, edgeType: d !== 0 ? EDGE_TYPE.closer : EDGE_TYPE.floor };
  }
  if (!tileIsFloor(front.type)) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.floor };
  }
  return { distance: 11, edgeType: EDGE_TYPE.floor };
}
function floorHeightOfRow(row) {
  return Y_LAND[row + 1];
}

// src/game/guard.ts
var GUARD_SEQ = {
  standInactive: 77,
  activeAfterFall: 63,
  enGarde: 55,
  advance: 56,
  retreat: 57,
  strike: 58,
  turn: 60,
  readyBlock: 62,
  strikeToBlock: 61,
  blockToStrike: 66,
  stabbed: 74,
  dropDead: 71
};
var GUARD_TYPE = {
  guard: 0,
  fat: 1,
  skeleton: 2,
  vizier: 3,
  shadow: 4,
  none: -1
};
var GUARD_FILES = [
  "GUARD.DAT",
  "FAT.DAT",
  "SKEL.DAT",
  "VIZIER.DAT",
  "SHADOW.DAT"
];
var GUARD_TYPE_BY_LEVEL = [
  0,
  0,
  0,
  2,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  4,
  3,
  -1,
  -1
];
var EXTRA_STRENGTH = [0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 3, 3];
var NUM_GUARD_SKILLS = 12;
function newGuard() {
  return {
    ...newCharacter({ charId: CHAR_ID.guard }),
    skill: 0,
    colour: 0,
    hitPoints: 0,
    maxHitPoints: 0,
    // A guard that is not in the room faces nowhere.
    direction: NO_DIRECTION
  };
}
var NO_DIRECTION = 56;
function positionGuards(level, guards) {
  for (let room = 1; room <= 24; room++) {
    const tile = guards.tile[room - 1];
    if (tile >= 30) continue;
    guards.x[room - 1] = X_BUMP[tile % 10 + FIRST_ONSCREEN_COLUMN] + TILE_SIZE_X;
    guards.seqHi[room - 1] = 0;
  }
  void level;
}
function guardsFromLevel(specs) {
  const pick = (f) => Uint8Array.from(specs.map(f));
  return {
    tile: pick((s) => s.tile),
    dir: pick((s) => s.dir),
    x: pick((s) => s.x),
    seqLo: pick((s) => s.seqLo),
    skill: pick((s) => s.skill),
    seqHi: pick((s) => s.seqHi),
    colour: pick((s) => s.color)
  };
}
function enterGuard(guard, room, guards, ctx) {
  const index = room - 1;
  const tile = guards.tile[index];
  if (tile >= 30) {
    guard.direction = NO_DIRECTION;
    return false;
  }
  guard.room = room;
  guard.currentRow = Math.floor(tile / 10);
  guard.y = Y_LAND[guard.currentRow + 1];
  guard.x = guards.x[index];
  guard.currentColumn = tile % 10;
  guard.direction = guards.dir[index] << 24 >> 24;
  guard.colour = ctx.guardType === GUARD_TYPE.guard ? guards.colour[index] & 15 : 0;
  guard.charId = ctx.guardType === GUARD_TYPE.skeleton ? CHAR_ID.skeleton : CHAR_ID.guard;
  const seqHi = guards.seqHi[index];
  if (seqHi === 0) {
    if (guard.charId === CHAR_ID.skeleton) {
      guard.sword = 2;
      startSequence(guard, GUARD_SEQ.activeAfterFall, ctx.tables);
    } else {
      guard.sword = 0;
      startSequence(guard, GUARD_SEQ.standInactive, ctx.tables);
    }
  } else {
    guard.currentSequence = guards.seqLo[index] + (seqHi << 8);
  }
  playSequence(guard, { tables: ctx.tables });
  guard.skill = guards.skill[index];
  if (guard.skill >= NUM_GUARD_SKILLS) guard.skill = 3;
  const dead = guard.frame === 185 || guard.frame === 177 || guard.frame === 178;
  guard.alive = dead ? 1 : -1;
  guard.hitPoints = dead ? 0 : (EXTRA_STRENGTH[guard.skill] ?? 0) + ctx.levelGuardHitPoints;
  guard.maxHitPoints = guard.hitPoints;
  guard.fallY = 0;
  guard.fallX = 0;
  guard.action = 1;
  return true;
}
function leaveGuard(guard, guards) {
  if (guard.direction === NO_DIRECTION || guard.room < 1 || guard.room > 24) return;
  const index = guard.room - 1;
  guards.x[index] = guard.x;
  guards.dir[index] = guard.direction & 255;
  guards.skill[index] = guard.skill;
  guards.colour[index] = guard.colour;
  if (guard.alive < 0) {
    guards.seqLo[index] = guard.currentSequence & 255;
    guards.seqHi[index] = guard.currentSequence >> 8 & 255;
  } else {
    guards.seqHi[index] = 0;
  }
  guard.direction = NO_DIRECTION;
}
var GUARD_FRAME_INACTIVE = 166;
function comeOnGuard(guard, ctx) {
  if (guard.alive >= 0 || guard.sword !== 0) return;
  if (guard.frame !== GUARD_FRAME_INACTIVE) return;
  if (ctx.kidRoom !== guard.room || ctx.kidRow !== guard.currentRow) return;
  guard.sword = 2;
  startSequence(guard, GUARD_SEQ.enGarde, ctx.tables);
}
function stepGuard(guard, ctx) {
  if (guard.direction === NO_DIRECTION) return;
  comeOnGuard(guard, ctx);
  playSequence(guard, { tables: ctx.tables, effects: ctx.effects });
  if (guard.action === ACTION.inFreefall) {
    guard.fallY = Math.min(guard.fallY + FALLING_SPEED_ACCEL, FALLING_SPEED_MAX);
    guard.x = forwardX(guard, guard.fallX) & 255;
  }
  guard.y = guard.y + guard.fallY & 255;
  const frame = guardFrame(guard, ctx.tables);
  if (frame) guard.currentColumn = determineColumn(guard, frame);
}
function guardFrame(guard, tables) {
  const frame = guard.frame;
  if (guard.charId === CHAR_ID.guard || guard.charId === CHAR_ID.skeleton) {
    let add = 0;
    if (frame >= 102 && frame < 107) add = 70;
    const index = frame + add - 149;
    if (index >= 0 && index < tables.frameTableGuard.length) {
      return tables.frameTableGuard[index];
    }
  }
  return tables.frameTableKid[frame] ?? null;
}
function guardDraw(guard, tables) {
  if (guard.direction === NO_DIRECTION) return null;
  const frame = guardFrame(guard, tables);
  if (!frame) return null;
  return placeCharacter(guard, frame, "guard");
}

// src/game/scene.ts
var PALETTE_BASE = {
  /** The default VGA colours; mono blits and the status bar use these. */
  global: 0,
  sword: 2 * 16,
  flameSwordPotion: 3 * 16,
  environment: 5 * 16,
  environmentWall: 6 * 16,
  kid: 7 * 16,
  guard: 8 * 16
};
function tilesetFileFor(levelType, prefix = "V") {
  return `${prefix}${levelType ? "PALACE" : "DUNGEON"}.DAT`;
}
async function buildLevelScene(assets, exe, levelNumber, prefix = "V") {
  const constants = readExeConstants(exe);
  const levelsDat = await assets.dat("LEVELS.DAT");
  const resourceId = resourceIdOfLevel(levelNumber);
  const level = parseLevel(levelsDat.get(resourceId), resourceId);
  const levelType = constants.levelType[levelNumber] ?? 0;
  const tilesetFile = tilesetFileFor(levelType, prefix);
  const environment = await assets.group(tilesetFile, 200, PALETTE_BASE.environment, true);
  const environmentWall = await assets.group(tilesetFile, 360, PALETTE_BASE.environmentWall);
  const flameSwordPotion = await assets.group("PRINCE.DAT", 150, PALETTE_BASE.flameSwordPotion);
  const kid = await assets.group("KID.DAT", 400, PALETTE_BASE.kid);
  const sword = await assets.group("PRINCE.DAT", 700, PALETTE_BASE.sword);
  const guardType = GUARD_TYPE_BY_LEVEL[levelNumber] ?? -1;
  let guard;
  let guardPalettes;
  const guardFile = GUARD_FILES[guardType];
  if (guardFile) {
    const headerFile = guardType === 0 ? levelType ? "GUARD1.DAT" : "GUARD2.DAT" : guardFile;
    guard = await assets.group(guardFile, 750, PALETTE_BASE.guard, false, headerFile);
    const princeDat = await assets.dat("PRINCE.DAT");
    guardPalettes = princeDat.get(10);
  }
  const screenPalette = new ScreenPalette();
  screenPalette.loadBlock(PALETTE_BASE.global, constants.vgaPalette);
  for (const set of [environment, environmentWall, flameSwordPotion, kid, sword]) {
    screenPalette.loadBlock(set.paletteBase, set.palette.vga);
  }
  if (guard) screenPalette.loadBlock(guard.paletteBase, guard.palette.vga);
  const state = new LevelState(level);
  const tiles = {
    typeAt: (room, column, row) => state.typeAt(room, column, row),
    modifierAt: (room, column, row) => state.modifierAt(room, column, row),
    linkOf: (room, dir) => state.linkOf(room, dir)
  };
  return {
    level,
    state,
    constants,
    chtabs: { environment, environmentWall, flameSwordPotion, kid, sword, guard },
    guardType,
    guardPalettes,
    screenPalette,
    tiles,
    options: {
      levelType,
      topLevelEdgeTile: constants.drawnTileTopLevelEdge,
      leftLevelEdgeTile: constants.drawnTileLeftLevelEdge,
      enableWdaInPalace: constants.enableWdaInPalace,
      startRoom: level.startRoom
    }
  };
}

// src/game/control-latch.ts
var CONTROL = {
  /** Pressed, and nothing has acted on it yet. */
  held: -1,
  released: 0,
  /** Pressed, but already acted on: wait for the key to go up. */
  ignore: 1
};
var ControlLatch = class {
  forward = CONTROL.released;
  backward = CONTROL.released;
  up = CONTROL.released;
  down = CONTROL.released;
  /** The latch over the shift key; the raw key is read separately. */
  shift2 = CONTROL.released;
  /**
   * Take in the keys that are down now. A latch that is already held is left
   * alone -- only the move that acts on it clears it -- and one that is
   * ignored stays ignored until its key goes up.
   */
  read(controls, direction) {
    const forward = direction < 0 ? controls.x < 0 : controls.x > 0;
    const backward = controls.x !== 0 && !forward;
    this.forward = step(this.forward, forward);
    this.backward = step(this.backward, backward);
    this.up = step(this.up, controls.y < 0);
    this.down = step(this.down, controls.y > 0);
    this.shift2 = step(this.shift2, controls.shift);
  }
  /**
   * The original's `release_arrows`: forget every direction, and hand back
   * the ignored state for the caller to put on the one it has just used.
   */
  releaseArrows() {
    this.forward = CONTROL.released;
    this.backward = CONTROL.released;
    this.up = CONTROL.released;
    this.down = CONTROL.released;
    return CONTROL.ignore;
  }
  /** Forget everything, as the game does when a level starts. */
  clear() {
    this.releaseArrows();
    this.shift2 = CONTROL.released;
  }
};
function step(latch, down) {
  if (latch < CONTROL.released) return latch;
  if (!down) return CONTROL.released;
  return latch === CONTROL.released ? CONTROL.held : latch;
}

// src/game/kid.ts
var u16 = (v) => v & 65535;
var KID_SEQ = {
  startRun: 1,
  stand: 2,
  standingJump: 3,
  runJump: 4,
  turn: 5,
  runTurn: 6,
  fall: 7,
  /** The run a level that opens at a run starts with. */
  runEntry: 84,
  jumpUpAndGrabStraight: 8,
  hang: 9,
  climbUp: 10,
  releaseLedgeAndLand: 11,
  runStop: 13,
  jumpUpIntoCeiling: 14,
  grabLedgeMidair: 15,
  jumpUpAndGrab: 16,
  softLand: 17,
  mediumLand: 20,
  releaseLedgeAndFall: 23,
  jumpUpAndGrabForward: 24,
  hangAgainstWall: 25,
  crouchWhileRunning: 26,
  jumpUpWithNothingAbove: 28,
  /** 29..42: step forward by 1..14 units, to stop exactly at an edge. */
  stepBase: 28,
  startRunAfterTurn: 43,
  stepOnEdge: 44,
  standUpFromCrouch: 49,
  crouch: 50,
  climbDown: 68,
  climbUpToClosedGate: 73,
  /** The landing that kills: a fall of three rows or more. */
  crushed: 52,
  unsafeStep: 39,
  /** Walking into a wall. Its own byte-code reads `action 5`, `dx -4`. */
  bump: 47
};
var FRAME = {
  startRunFirst: 1,
  run7: 7,
  runLast: 14,
  stand: 15,
  startJumpUp: 67,
  jumpHang: 70,
  hangingFirst: 87,
  crouch: 109,
  turnFirst: 45,
  turnMid: 48,
  turnEnd: 50,
  turnLast: 52,
  run1: 7,
  run2: 11
};
function frameOf(tables, state) {
  return tables.frameTableKid[state.frame] ?? tables.frameTableKid[0];
}
function objectX(state, frame) {
  let x = (forwardX(state, frame.dx) << 1) - 116;
  if ((frame.flags ^ state.direction) << 24 >> 24 >= 0) x += 1;
  return x;
}
function forwardHeld(state, controls) {
  if (controls.x === 0) return false;
  return state.direction < 0 ? controls.x < 0 : controls.x > 0;
}
function backwardHeld(state, controls) {
  if (controls.x === 0) return false;
  return state.direction < 0 ? controls.x > 0 : controls.x < 0;
}
function control(state, controls, ctx) {
  if (state.alive >= 0) return;
  const f = state.frame;
  if (state.action === ACTION.bumped || state.action === ACTION.inFreefall) return;
  if (f === FRAME.stand || f >= FRAME.turnEnd && f < 53) {
    controlStanding(state, controls, ctx);
  } else if (f === FRAME.turnMid) {
    controlTurning(state, controls, ctx);
  } else if (f < 4) {
    controlStartRun(state, controls, ctx);
  } else if (f >= FRAME.startJumpUp && f < FRAME.jumpHang) {
    controlJumpUp(state, controls, ctx);
  } else if (f < 15) {
    controlRunning(state, controls, ctx);
  } else if (f >= FRAME.hangingFirst && f < 100) {
    controlHanging(state, controls, ctx);
  } else if (f === FRAME.crouch) {
    controlCrouched(state, controls, ctx);
  }
}
function canGrab(ctx, through, target, direction, targetModifier) {
  if (through === TILE.wall) return false;
  if (through === TILE.doortop && direction >= 0) return false;
  if (tileIsFloor(through)) return false;
  if (target === TILE.loose && targetModifier !== 0) return false;
  if (target === TILE.doortopWithFloor && direction < 0) return false;
  if (!tileIsFloor(target)) return false;
  return true;
}
function tileAbove(state, ctx) {
  return getTile(ctx.world, state.room, state.currentColumn, state.currentRow - 1);
}
function tileFrontAbove(state, ctx) {
  return getTile(
    ctx.world,
    state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn,
    state.currentRow - 1
  );
}
function tileBehindAbove(state, ctx) {
  return getTile(
    ctx.world,
    state.room,
    DIR_BEHIND[state.direction + 1] + state.currentColumn,
    state.currentRow - 1
  );
}
function tileBehind(state, ctx) {
  return getTile(
    ctx.world,
    state.room,
    DIR_BEHIND[state.direction + 1] + state.currentColumn,
    state.currentRow
  );
}
function tileHere(state, ctx) {
  return getTile(ctx.world, state.room, state.currentColumn, state.currentRow);
}
function modifierOf(ctx, t) {
  return t.room ? ctx.world.modifierAt(t.room, t.column, t.row) : 0;
}
function controlJumpUp(state, controls, ctx) {
  if (forwardHeld(state, controls) || ctx.latch.forward === CONTROL.held) {
    standingJump(state, ctx);
  }
}
function standingJump(state, ctx) {
  ctx.latch.up = CONTROL.ignore;
  ctx.latch.forward = CONTROL.ignore;
  startSequence(state, KID_SEQ.standingJump, ctx.tables);
}
function upPressed(state, controls, ctx) {
  if (forwardHeld(state, controls)) {
    standingJump(state, ctx);
    return;
  }
  checkJumpUp(state, ctx);
}
function checkJumpUp(state, ctx) {
  ctx.latch.up = ctx.latch.releaseArrows();
  const above = tileAbove(state, ctx);
  const frontAbove = tileFrontAbove(state, ctx);
  if (canGrab(ctx, above.type, frontAbove.type, state.direction, modifierOf(ctx, frontAbove))) {
    grabUpWithFloorBehind(state, ctx);
    return;
  }
  const behindAbove = tileBehindAbove(state, ctx);
  if (canGrab(ctx, behindAbove.type, above.type, state.direction, modifierOf(ctx, above))) {
    jumpUpOrGrab(state, ctx);
  } else {
    jumpUp(state, ctx);
  }
}
function jumpUpOrGrab(state, ctx) {
  const frame = frameOf(ctx.tables, state);
  const distance = distanceToEdgeWeight(state, frame);
  if (distance < 6) {
    jumpUp(state, ctx);
  } else if (!tileIsFloor(tileBehind(state, ctx).type)) {
    state.x = forwardX(state, distanceToEdgeWeight(state, frame) - 10) & 255;
    startSequence(state, KID_SEQ.jumpUpAndGrab, ctx.tables);
  } else {
    state.x = forwardX(state, distance - 14) & 255;
    state.currentColumn = determineColumn(state, frame);
    grabUpWithFloorBehind(state, ctx);
  }
}
function grabUpWithFloorBehind(state, ctx) {
  const frame = frameOf(ctx.tables, state);
  const distance = distanceToEdgeWeight(state, frame);
  const edge = getEdgeDistance(
    ctx.world,
    state,
    frame,
    objectX(state, frame),
    ctx.spriteWidth(frame.image)
  );
  if (distance < 4 && edge.distance < 4 && edge.edgeType !== EDGE_TYPE.wall) {
    state.x = forwardX(state, distance) & 255;
    startSequence(state, KID_SEQ.jumpUpAndGrabStraight, ctx.tables);
  } else {
    state.x = forwardX(state, distance - 4) & 255;
    startSequence(state, KID_SEQ.jumpUpAndGrabForward, ctx.tables);
  }
}
function jumpUp(state, ctx) {
  ctx.latch.up = ctx.latch.releaseArrows();
  const frame = frameOf(ctx.tables, state);
  const edge = getEdgeDistance(
    ctx.world,
    state,
    frame,
    objectX(state, frame),
    ctx.spriteWidth(frame.image)
  );
  if (edge.distance < 4 && edge.edgeType === EDGE_TYPE.wall) {
    state.x = forwardX(state, edge.distance - 3) & 255;
  }
  const column = tileDivModM7(weightX(state, frame) - 6).column;
  const above = getTile(ctx.world, state.room, column, state.currentRow - 1);
  if (above.type !== TILE.wall && !tileIsFloor(above.type)) {
    startSequence(state, KID_SEQ.jumpUpWithNothingAbove, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.jumpUpIntoCeiling, ctx.tables);
  }
}
function downPressed(state, ctx) {
  ctx.latch.down = CONTROL.ignore;
  const frame = frameOf(ctx.tables, state);
  const front = getTile(
    ctx.world,
    state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn,
    state.currentRow
  );
  if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
    state.x = forwardX(state, 5) & 255;
    state.currentColumn = determineColumn(state, frame);
    return;
  }
  const behind = tileBehind(state, ctx);
  const here = tileHere(state, ctx);
  if (!tileIsFloor(behind.type) && distanceToEdgeWeight(state, frame) >= 8 && canGrab(ctx, behind.type, here.type, state.direction, modifierOf(ctx, here))) {
    state.x = forwardX(state, distanceToEdgeWeight(state, frame) - 9) & 255;
    startSequence(state, KID_SEQ.climbDown, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.crouch, ctx.tables);
    ctx.latch.down = ctx.latch.releaseArrows();
  }
}
function controlCrouched(state, controls, ctx) {
  if (controls.y <= 0) startSequence(state, KID_SEQ.standUpFromCrouch, ctx.tables);
}
function controlHanging(state, controls, ctx) {
  if (state.alive >= 0) {
    hangFall(state, ctx);
    return;
  }
  if (state.grabTimer === 0 && controls.y < 0) {
    canClimbUp(state, ctx);
    return;
  }
  if (controls.shift) {
    const here = tileHere(state, ctx);
    const againstWall = here.type === TILE.wall || state.direction < 0 && (here.type === TILE.doortopWithFloor || here.type === TILE.doortop);
    if (state.action !== ACTION.hangStraight && againstWall) {
      startSequence(state, KID_SEQ.hangAgainstWall, ctx.tables);
    } else if (!tileIsFloor(tileAbove(state, ctx).type)) {
      hangFall(state, ctx);
    }
    return;
  }
  hangFall(state, ctx);
}
function canClimbUp(state, ctx) {
  ctx.latch.shift2 = CONTROL.ignore;
  ctx.latch.releaseArrows();
  const above = tileAbove(state, ctx);
  let seq = KID_SEQ.climbUp;
  if ((above.type === TILE.mirror || above.type === TILE.chomper) && state.direction === 0 || above.type === TILE.gate && state.direction !== 0 && modifierOf(ctx, above) >> 2 < 6) {
    seq = KID_SEQ.climbUpToClosedGate;
  }
  startSequence(state, seq, ctx.tables);
}
function hangFall(state, ctx) {
  ctx.latch.down = ctx.latch.releaseArrows();
  const behind = tileBehind(state, ctx);
  const here = tileHere(state, ctx);
  if (!tileIsFloor(behind.type) && !tileIsFloor(here.type)) {
    startSequence(state, KID_SEQ.releaseLedgeAndFall, ctx.tables);
    return;
  }
  if (here.type === TILE.wall || state.direction < 0 && (here.type === TILE.doortopWithFloor || here.type === TILE.doortop)) {
    state.x = forwardX(state, -7) & 255;
  }
  startSequence(state, KID_SEQ.releaseLedgeAndLand, ctx.tables);
}
function checkGrab(state, controls, ctx) {
  if (!controls.shift || state.fallY >= 32 || state.alive >= 0) return;
  if (u16(floorHeightOfRow(state.currentRow)) > u16(state.y + 25)) return;
  const frame = frameOf(ctx.tables, state);
  const oldX = state.x;
  state.x = forwardX(state, -8) & 255;
  state.currentColumn = determineColumn(state, frame);
  const above = tileAbove(state, ctx);
  const frontAbove = tileFrontAbove(state, ctx);
  if (!canGrab(ctx, above.type, frontAbove.type, state.direction, modifierOf(ctx, frontAbove))) {
    state.x = oldX;
    state.currentColumn = determineColumn(state, frame);
    return;
  }
  state.x = forwardX(state, distanceToEdgeWeight(state, frame)) & 255;
  state.y = floorHeightOfRow(state.currentRow);
  state.fallY = 0;
  startSequence(state, KID_SEQ.grabLedgeMidair, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  state.grabTimer = 12;
}
function controlStanding(state, controls, ctx) {
  const latch = ctx.latch;
  if (controls.shift) {
    if (latch.backward === CONTROL.held) {
      backPressed(state, ctx);
    } else if (latch.up === CONTROL.held) {
      upPressed(state, controls, ctx);
    } else if (latch.down === CONTROL.held) {
      downPressed(state, ctx);
    } else if (forwardHeld(state, controls) && latch.forward === CONTROL.held) {
      safeStep(state, ctx);
    }
    return;
  }
  if (latch.forward === CONTROL.held) {
    if (latch.up === CONTROL.held) standingJump(state, ctx);
    else forwardPressed(state, ctx);
  } else if (latch.backward === CONTROL.held) {
    backPressed(state, ctx);
  } else if (latch.up === CONTROL.held) {
    if (latch.forward === CONTROL.held) standingJump(state, ctx);
    else upPressed(state, controls, ctx);
  } else if (latch.down === CONTROL.held) {
    downPressed(state, ctx);
  } else if (forwardHeld(state, controls)) {
    forwardPressed(state, ctx);
  }
}
function backPressed(state, ctx) {
  startSequence(state, KID_SEQ.turn, ctx.tables);
  ctx.latch.backward = ctx.latch.releaseArrows();
}
function controlTurning(state, controls, ctx) {
  if (!controls.shift && forwardHeld(state, controls) && controls.y >= 0) {
    startSequence(state, KID_SEQ.startRunAfterTurn, ctx.tables);
  }
}
function controlStartRun(state, controls, ctx) {
  if (controls.y < 0 && forwardHeld(state, controls)) standingJump(state, ctx);
}
function controlRunning(state, controls, ctx) {
  const latch = ctx.latch;
  if (controls.x === 0 && (state.frame === FRAME.run1 || state.frame === FRAME.run2)) {
    latch.forward = latch.releaseArrows();
    startSequence(state, KID_SEQ.runStop, ctx.tables);
  } else if (backwardHeld(state, controls)) {
    latch.backward = latch.releaseArrows();
    startSequence(state, KID_SEQ.runTurn, ctx.tables);
  } else if (controls.y < 0 && latch.up === CONTROL.held) {
    runJump(state, ctx);
  } else if (latch.down === CONTROL.held) {
    latch.down = CONTROL.ignore;
    startSequence(state, KID_SEQ.crouchWhileRunning, ctx.tables);
  }
}
function runJump(state, ctx) {
  if (state.frame < FRAME.run7) return;
  const xpos = forwardX(state, 4);
  let column = tileDivModM7(xpos).column;
  for (let ahead = 0; ahead < 2; ahead++) {
    column += DIR_FRONT[state.direction + 1];
    const t = getTile(ctx.world, state.room, column, state.currentRow);
    if (t.type !== TILE.spike && tileIsFloor(t.type)) continue;
    let adjust = distanceToEdge(state, xpos) + 14 * ahead - 14;
    if ((adjust & 65535) < 65528 || adjust >= 2) {
      if (adjust < 128) return;
      adjust = -3;
    }
    state.x = forwardX(state, adjust + 4) & 255;
    break;
  }
  ctx.latch.up = ctx.latch.releaseArrows();
  startSequence(state, KID_SEQ.runJump, ctx.tables);
}
function forwardPressed(state, ctx) {
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world,
    state,
    frame,
    objX,
    ctx.spriteWidth(frame.image)
  );
  const front = getTile(
    ctx.world,
    state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn,
    state.currentRow
  );
  if (edgeType === EDGE_TYPE.wall && front.type !== TILE.chomper && distance < 8) {
    safeStep(state, ctx);
  } else {
    startSequence(state, KID_SEQ.startRun, ctx.tables);
  }
}
function safeStep(state, ctx) {
  ctx.latch.shift2 = CONTROL.ignore;
  ctx.latch.forward = CONTROL.ignore;
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world,
    state,
    frame,
    objX,
    ctx.spriteWidth(frame.image)
  );
  if (distance) {
    state.repeat = 1;
    startSequence(state, KID_SEQ.stepBase + Math.min(distance, 14), ctx.tables);
  } else if (edgeType !== EDGE_TYPE.wall && state.repeat !== 0) {
    state.repeat = 0;
    startSequence(state, KID_SEQ.stepOnEdge, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.unsafeStep, ctx.tables);
  }
}
function startFall(state, ctx) {
  state.sword = 0;
  state.currentRow += 1;
  ctx.traps?.startChompers(state.room, state.currentRow);
  startSequence(state, KID_SEQ.fall, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  const frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);
}
function land(state, ctx) {
  state.y = floorHeightOfRow(state.currentRow);
  ctx.traps?.startChompers(state.room, state.currentRow);
  const frame = frameOf(ctx.tables, state);
  const front = getTile(
    ctx.world,
    state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn,
    state.currentRow
  );
  if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
    state.x = forwardX(state, -3) & 255;
  }
  if (state.fallY < 22) {
    startSequence(state, KID_SEQ.softLand, ctx.tables);
  } else if (state.fallY < 33) {
    if (ctx.damage?.(1)) {
      state.alive = 0;
      startSequence(state, KID_SEQ.crushed, ctx.tables);
    } else {
      startSequence(state, KID_SEQ.mediumLand, ctx.tables);
    }
  } else {
    ctx.damage?.(100);
    state.alive = 0;
    startSequence(state, KID_SEQ.crushed, ctx.tables);
  }
  state.fallY = 0;
  state.fallX = 0;
}
function doFall(state, ctx) {
  if (u16(floorHeightOfRow(state.currentRow)) > u16(state.y)) {
    checkGrab(state, ctx.controls, ctx);
    return;
  }
  if (hasFloorAt(state, ctx)) land(state, ctx);
  else state.currentRow += 1;
}
function hasFloorAt(state, ctx) {
  const t = getTile(ctx.world, state.room, state.currentColumn, state.currentRow);
  return tileIsFloor(t.type);
}
function checkOnFloor(state, ctx) {
  const frame = frameOf(ctx.tables, state);
  if (!(frame.flags & 64)) return;
  if (!hasFloorAt(state, ctx)) startFall(state, ctx);
}
function checkAction(state, ctx) {
  const action = state.action;
  if (action === ACTION.hangStraight || action === ACTION.bumped) {
    if (state.frame === 109) checkOnFloor(state, ctx);
  } else if (action === ACTION.inFreefall) {
    doFall(state, ctx);
  } else if (action === ACTION.inMidair) {
    if (state.frame >= 102 && state.frame < 106) checkGrab(state, ctx.controls, ctx);
  } else if (action !== ACTION.hangClimb) {
    checkOnFloor(state, ctx);
  }
}
function checkPress(state, ctx) {
  if (!ctx.traps) return;
  const frame = frameOf(ctx.tables, state);
  const f = state.frame;
  let tile;
  if (f >= FRAME.hangingFirst && f < 100 || f >= 135 && f < 141) {
    tile = tileAbove(state, ctx);
  } else if (state.action === ACTION.turning || state.action === ACTION.bumped || state.action < ACTION.hangClimb) {
    if (f === 79 && tileAbove(state, ctx).type === TILE.loose) {
      const above = tileAbove(state, ctx);
      ctx.traps.makeLooseFall(above.room, above.row * 10 + above.column);
      return;
    }
    if (!(frame.flags & 64)) return;
    tile = tileHere(state, ctx);
  } else {
    return;
  }
  if (!tile.room) return;
  const tilePos = tile.row * 10 + tile.column;
  if (tile.type === TILE.opener || tile.type === TILE.closer) {
    ctx.traps.pressButton(tile.room, tilePos);
  } else if (tile.type === TILE.loose) {
    ctx.traps.makeLooseFall(tile.room, tilePos);
  }
}
function checkSpikeBelow(state, ctx) {
  if (!ctx.traps) return;
  const frame = frameOf(ctx.tables, state);
  const coll = charCollision(state, frame, objectX(state, frame), ctx.spriteWidth(frame.image));
  const rightColumn = tileDivModM7(coll.xRight).column;
  if (rightColumn < 0) return;
  for (let column = tileDivModM7(coll.xLeft).column; column <= rightColumn; column++) {
    let row = state.currentRow;
    for (let guard = 0; guard < 4; guard++) {
      const t = getTile(ctx.world, state.room, column, row);
      if (t.type === TILE.spike) {
        ctx.traps.startSpike(t.room, t.row * 10 + t.column);
        break;
      }
      if (tileIsFloor(t.type) || t.room === 0 || row > 2) break;
      row += 1;
    }
  }
}
function checkSpiked(state, ctx) {
  if (!ctx.traps) return;
  const t = tileHere(state, ctx);
  if (t.type !== TILE.spike || !t.room) return;
  const harm = ctx.traps.spikeHarm(t.room, t.row * 10 + t.column);
  const f = state.frame;
  const running = f >= 7 && f < 15 || f >= 34 && f < 40;
  if (harm >= 2 && running || (f === 43 || f === 26) && harm !== 0) {
    state.alive = 0;
  }
}
function checkChomped(state, ctx) {
  if (!ctx.traps || state.alive >= 0) return;
  const tile = tileHere(state, ctx);
  if (tile.type !== TILE.chomper || !tile.room) return;
  const tilePos = tile.row * 10 + tile.column;
  if (!ctx.traps.chomperHarm(tile.room, tilePos)) return;
  ctx.traps.bloodyChomper(tile.room, tilePos);
  state.alive = 0;
}
function stepKid(state, controls, ctx) {
  ctx.controls = controls;
  if (state.grabTimer > 0) state.grabTimer -= 1;
  ctx.latch.read(controls, state.direction);
  control(state, controls, ctx);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  if (state.action === ACTION.inFreefall) {
    state.fallY = Math.min(state.fallY + FALLING_SPEED_ACCEL, FALLING_SPEED_MAX);
  }
  state.y = state.y + state.fallY & 255;
  if (state.action === ACTION.inFreefall) {
    state.x = forwardX(state, state.fallX) & 255;
  }
  const frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);
  checkBumped(state, ctx);
  checkAction(state, ctx);
  const leave = leaveDirection(state, ctx);
  if (leave >= 0) {
    gotoOtherRoom(state, leave, ctx);
    state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
  }
  checkPress(state, ctx);
  checkSpikeBelow(state, ctx);
  checkSpiked(state, ctx);
  checkChomped(state, ctx);
  if (state.room === 0 && state.alive < 0) {
    ctx.damage?.(100);
    state.alive = 0;
  }
}
function checkBumped(state, ctx) {
  if (state.action === ACTION.hangClimb || state.action === ACTION.hangStraight || state.action === ACTION.bumped || state.action === ACTION.inFreefall || state.action === ACTION.inMidair) {
    return;
  }
  const f = state.frame;
  if (f >= 135 && f < 150 || f >= 110 && f < 120 || f >= 150 && f < 163 || f >= 166 && f < 169 || f >= FRAME.hangingFirst && f < 100) {
    return;
  }
  if (state.y !== floorHeightOfRow(state.currentRow)) return;
  const frame = frameOf(ctx.tables, state);
  const coll = charCollision(state, frame, objectX(state, frame), ctx.spriteWidth(frame.image));
  const penetration = (column) => {
    const tile = getTile(ctx.world, state.room, column, state.currentRow);
    if (tile.room === 0) return 0;
    if (tile.type === TILE.chomper) return 0;
    const wall = wallTypeAt(ctx.world, tile);
    if (wall === 0) return 0;
    const d = distanceFromWallForward(state, tile.type, column, coll, wall);
    return d < 0 ? d : 0;
  };
  const here = penetration(state.currentColumn);
  const front = penetration(DIR_FRONT[state.direction + 1] + state.currentColumn);
  const push = Math.min(here, front);
  if (push === 0) return;
  state.x = forwardX(state, push) & 255;
  state.currentColumn = determineColumn(state, frame);
  startSequence(state, KID_SEQ.bump, ctx.tables);
}
function yToRow(y) {
  return Math.trunc((y + 60) / TILE_SIZE_Y) % 4 - 1;
}
function leaveDirection(state, ctx) {
  const y = state.y;
  const sy = y << 24 >> 24;
  const f = state.frame;
  if (state.action !== ACTION.bumped && state.action !== ACTION.inFreefall && state.action !== ACTION.inMidair && sy < 10 && sy > -16) {
    return 2;
  }
  if (y >= 211) return 3;
  if (f >= 135 && f < 150 || f >= 110 && f < 120 || f >= 150 && f < 163 || f >= 166 && f < 169 || state.action === ACTION.turning) {
    return -1;
  }
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const coll = charCollision(state, frame, objX, ctx.spriteWidth(frame.image));
  if (state.direction !== 0) {
    if (coll.xLeft <= 54) return 0;
    if (coll.xLeft >= 198) return 1;
    return -1;
  }
  const edge = getTile(ctx.world, state.room, 9, state.currentRow);
  if (edge.type !== TILE.doortopWithFloor && edge.type !== TILE.doortop && coll.xRight >= 201) {
    return 1;
  }
  if (coll.xRight <= 57) return 0;
  return -1;
}
function gotoOtherRoom(state, direction, ctx) {
  state.room = ctx.world.linkOf(state.room, direction);
  if (direction === 0) state.x = state.x + 140 & 255;
  else if (direction === 1) state.x = state.x - 140 & 255;
  else if (direction === 2) {
    state.y = state.y + 189 & 255;
    state.currentRow = yToRow(state.y);
  } else {
    state.y = state.y - 189 & 255;
    state.currentRow = yToRow(state.y);
  }
}
function enterLevel(state, startRoom, startPos, startDir, ctx, level = 0) {
  state.room = startRoom;
  state.currentColumn = startPos % 10;
  state.currentRow = Math.floor(startPos / 10);
  state.x = X_BUMP_START(state.currentColumn) & 255;
  state.y = floorHeightOfRow(state.currentRow);
  state.direction = ~startDir;
  state.alive = -1;
  state.fallX = 0;
  state.fallY = 0;
  let entry = KID_SEQ.turn;
  if (level === ENTRY_FALL_LEVEL) {
    entry = KID_SEQ.fall;
    ctx.traps?.pressButton(ENTRY_BUTTON_ROOM, ENTRY_BUTTON_TILEPOS);
  } else if (level === ENTRY_RUN_LEVEL) {
    entry = KID_SEQ.runEntry;
  }
  startSequence(state, entry, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
}
var ENTRY_FALL_LEVEL = 1;
var ENTRY_BUTTON_ROOM = 5;
var ENTRY_BUTTON_TILEPOS = 2;
var ENTRY_RUN_LEVEL = 13;
function X_BUMP_START(column) {
  const X_BUMP2 = [
    -12,
    2,
    16,
    30,
    44,
    58,
    72,
    86,
    100,
    114,
    128,
    142,
    156,
    170,
    184,
    198,
    212,
    226,
    240,
    254
  ];
  return X_BUMP2[column + 5] + 14;
}

// src/game/traps.ts
var GATE_CLOSE_SPEEDS = [0, 0, 0, 20, 40, 60, 80, 100, 120];
var DOOR_DELTA = [-1, 4, 4];
var LEVEL_DOOR_CLOSE_SPEEDS = [0, 5, 17, 99, 0];
var LOOSE_SOUND = [0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0];
var Y_LOOSE_LAND = [2, 65, 128, 191, 254];
var Y_SOMETHING = [-1, 62, 125, 188, 25];
var LOOSE_FLOOR_DELAY = 11;
var CHOMPER_SPEED = 15;
var Traps = class {
  trobs = [];
  mobs = [];
  level;
  prng;
  effects;
  lastLooseSound = -1;
  /** The room the view is showing; some tiles only animate while visible. */
  drawnRoom = 0;
  /** Where the Prince is, which decides whether chompers keep snapping. */
  kidRoom = 0;
  kidRow = -1;
  /** Where he was last frame, so that arriving on a row can be noticed. */
  lastKidRoom = 0;
  lastKidRow = -1;
  kidAlive = -1;
  levelType;
  constructor(level, prng, levelType, effects = {}) {
    this.level = level;
    this.prng = prng;
    this.levelType = levelType;
    this.effects = effects;
  }
  // ------------------------------------------------------------- the list
  add(room, tilePos, type) {
    const found = this.trobs.find((t) => t.tilePos === tilePos && t.room === room);
    if (found) {
      found.type = type;
      return;
    }
    if (this.trobs.length >= 30) return;
    this.trobs.push({ room, tilePos, type });
  }
  /** Step every animated tile once. */
  step() {
    if (this.kidRoom !== this.lastKidRoom || this.kidRow !== this.lastKidRow) {
      this.lastKidRoom = this.kidRoom;
      this.lastKidRow = this.kidRow;
      if (this.kidRoom) this.startChompers(this.kidRoom, this.kidRow);
    }
    for (const trob of this.trobs) this.animate(trob);
    for (let i = this.trobs.length - 1; i >= 0; i--) {
      if (this.trobs[i].type < 0) this.trobs.splice(i, 1);
    }
    this.stepMobs();
  }
  animate(trob) {
    const type = this.level.typeAtPos(trob.room, trob.tilePos);
    let modifier = this.level.modifierAtPos(trob.room, trob.tilePos);
    switch (type) {
      case TILE.torch:
      case TILE.torchWithDebris:
        modifier = this.animateTorch(trob, modifier);
        break;
      case TILE.closer:
      case TILE.opener:
        modifier = this.animateButton(trob, modifier);
        break;
      case TILE.spike:
        modifier = this.animateSpike(trob, modifier);
        break;
      case TILE.loose:
        modifier = this.animateLoose(trob, modifier);
        break;
      case TILE.empty:
        trob.type = -1;
        break;
      case TILE.chomper:
        modifier = this.animateChomper(trob, modifier);
        break;
      case TILE.gate:
        modifier = this.animateGate(trob, modifier);
        break;
      case TILE.levelDoorLeft:
        modifier = this.animateLevelDoor(trob, modifier);
        break;
      case TILE.potion:
        modifier = this.animatePotion(trob, modifier);
        break;
      case TILE.sword:
        modifier = this.animateSword(trob, modifier);
        break;
      default:
        trob.type = -1;
        break;
    }
    this.level.setModifierAtPos(trob.room, trob.tilePos, modifier);
  }
  // --------------------------------------------------------- the tile kinds
  /**
   * A flame picks a new frame at random, mostly moving on by one. Two
   * torches side by side are therefore rarely in step, which is why no
   * simulation can be expected to match a captured frame's flames.
   */
  animateTorch(trob, modifier) {
    if (trob.room !== this.drawnRoom && !(trob.room === this.level.linkOf(this.drawnRoom, 0) && trob.tilePos % 10 === 9)) {
      trob.type = -1;
      return modifier;
    }
    let next = this.prng.next(255);
    if (next !== modifier) {
      if (next < 9) return next;
      next = modifier;
    }
    next += 1;
    if (next >= 9) next = 0;
    return next;
  }
  animateButton(trob, modifier) {
    if (trob.type < 0) return modifier;
    const timer = this.level.doorLinkTimer(modifier) - 1;
    this.level.setDoorLinkTimer(modifier, timer);
    if (timer < 2) trob.type = -1;
    return modifier;
  }
  /** Spikes come out, stay out a while, then go back in. */
  animateSpike(trob, modifier) {
    if (trob.type < 0) return modifier;
    if (modifier === 255) return modifier;
    if (modifier & 128) {
      modifier = modifier - 1 & 255;
      if (modifier & 127) return modifier;
      return 6;
    }
    modifier += 1;
    if (modifier === 5) return 143;
    if (modifier === 9) {
      trob.type = -1;
      return 0;
    }
    return modifier;
  }
  animateChomper(trob, modifier) {
    if (trob.type >= 0) {
      const blood = modifier & 128;
      let frame = (modifier & 127) + 1;
      if (frame > CHOMPER_SPEED) frame = 1;
      modifier = blood | frame;
      if (frame === 2) this.effects.sound?.(SOUND.chomper);
      const leftRoom = trob.room !== this.drawnRoom;
      const leftRow = Math.floor(trob.tilePos / 10) !== this.kidRow;
      const notHere = this.kidAlive >= 0 && blood === 0;
      if ((leftRoom || leftRow || notHere) && (modifier & 127) >= 6) trob.type = -1;
    }
    return modifier;
  }
  /**
   * A gate's modifier is how far it is open, 0 to 188. Type 0 is closing,
   * 1 opening, 2 opening permanently, 3..8 slamming shut at rising speed.
   */
  animateGate(trob, modifier) {
    if (trob.type < 0) return modifier;
    if (trob.type >= 3) {
      if (trob.type < 8) trob.type += 1;
      const next = modifier - GATE_CLOSE_SPEEDS[trob.type];
      if (next < 0) {
        trob.type = -1;
        this.effects.sound?.(SOUND.gateClosingFast);
        return 0;
      }
      return next;
    }
    if (modifier === 255) {
      trob.type = -1;
      return modifier;
    }
    modifier = modifier + DOOR_DELTA[trob.type] & 255;
    if (trob.type === 0) {
      if (modifier === 0) {
        trob.type = -1;
        this.effects.sound?.(SOUND.gateStop);
      } else if (modifier < 188 && (modifier & 3) === 3) {
        this.effects.sound?.(SOUND.gateClosing);
      }
      return modifier;
    }
    if (modifier < 188) {
      if ((modifier & 7) === 0) this.effects.sound?.(SOUND.gateOpening);
      return modifier;
    }
    if (trob.type < 2) {
      trob.type = 0;
      this.effects.sound?.(SOUND.gateStop);
      return 238;
    }
    trob.type = -1;
    return 255;
  }
  animateLevelDoor(trob, modifier) {
    if (trob.type < 0) return modifier;
    if (trob.type === 3) {
      modifier += 1;
      if (modifier >= 43) {
        trob.type = -1;
        return 43;
      }
      return modifier;
    }
    const speed = LEVEL_DOOR_CLOSE_SPEEDS[Math.min(trob.type, 4)];
    const next = modifier - speed;
    if (next <= 0) {
      trob.type = -1;
      return 0;
    }
    return next;
  }
  animatePotion(trob, modifier) {
    if (trob.type < 0 || trob.room !== this.drawnRoom) {
      trob.type = -1;
      return modifier;
    }
    const kind = modifier & 248;
    let bubble = (modifier & 7) + 1;
    if (bubble >= 8) bubble = 1;
    return kind | bubble;
  }
  animateSword(trob, modifier) {
    if (trob.room !== this.drawnRoom) trob.type = -1;
    return modifier;
  }
  /**
   * A loose floor shakes when something lands on it, and after a short delay
   * comes away and falls.
   */
  animateLoose(trob, modifier) {
    if (trob.type < 0) return modifier;
    modifier = modifier + 1 & 255;
    if (modifier & 128) {
      if (modifier >= 132) {
        trob.type = -1;
        this.looseShake(0, true);
        return 0;
      }
      this.looseShake(modifier, false);
      return modifier;
    }
    if (modifier < LOOSE_FLOOR_DELAY) {
      this.looseShake(modifier, false);
      return modifier;
    }
    const room = trob.room;
    const tilePos = trob.tilePos;
    const left = this.removeLoose(room, tilePos);
    trob.type = -1;
    const row = Math.floor(tilePos / 10);
    this.mobs.push({
      xh: tilePos % 10 << 2,
      y: Y_LOOSE_LAND[row + 1],
      room,
      speed: 0,
      type: 0,
      row
    });
    return left;
  }
  looseShake(modifier, force) {
    if (!force && !LOOSE_SOUND[modifier & 127]) return;
    let id;
    do {
      id = this.prng.next(2) + SOUND.looseShake1;
    } while (id === this.lastLooseSound);
    this.prng.next(2);
    this.lastLooseSound = id;
    this.effects.sound?.(id);
  }
  /** The tile left behind depends on whether the level is dungeon or palace. */
  removeLoose(room, tilePos) {
    this.level.setTypeAtPos(room, tilePos, TILE.empty);
    return this.levelType;
  }
  // ------------------------------------------------------- falling floors
  stepMobs() {
    for (const mob of this.mobs) this.moveMob(mob);
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      if (this.mobs[i].speed === -1) this.mobs.splice(i, 1);
    }
  }
  moveMob(mob) {
    if (mob.type === 0) this.moveLoose(mob);
    if (mob.speed <= 0) mob.speed += 1;
  }
  moveLoose(mob) {
    if (mob.speed < 0) return;
    if (mob.speed < 29) mob.speed += 3;
    mob.y += mob.speed;
    if (mob.room === 0) {
      if (mob.y >= 210) mob.speed = -2;
      return;
    }
    if (mob.y < 226 && Y_SOMETHING[mob.row + 1] <= mob.y) {
      const column = mob.xh >> 2;
      const type = this.level.typeAt(mob.room, column, mob.row);
      if (type === TILE.loose) {
        this.removeLoose(mob.room, mob.row * 10 + column);
      }
      if (type === TILE.empty || type === TILE.loose) {
        this.mobDownARow(mob);
        return;
      }
      this.effects.sound?.(SOUND.tileCrashing);
      this.knock(mob.room, mob.row);
      mob.y = Y_SOMETHING[mob.row + 1];
      mob.speed = -2;
      this.leaveRubble(mob.room, column, mob.row);
      this.effects.floorCrashed?.(mob.room, mob.row);
    }
  }
  mobDownARow(mob) {
    mob.row += 1;
    if (mob.row >= 3) {
      mob.row = 0;
      mob.y -= 189;
      mob.room = this.level.linkOf(mob.room, 3);
    }
  }
  /**
   * A floor that has smashed leaves its rubble where it landed. The tile set
   * is built for it: 14 is a floor with rubble on it and 30 is a torch with
   * rubble on it, which is the pair the original turns 1 and 19 into. Level
   * 1 ships with a tile 14 under its first loose floor, from a fall that
   * happened before the player arrives.
   */
  leaveRubble(room, column, row) {
    const type = this.level.typeAt(room, column, row);
    if (type === TILE.floor) this.level.setType(room, column, row, TILE.debris);
    else if (type === TILE.torch) this.level.setType(room, column, row, TILE.torchWithDebris);
  }
  /** A crash shakes every loose floor on the row. */
  knock(room, row) {
    for (let column = 0; column < 10; column++) {
      if (this.level.typeAt(room, column, row) === TILE.loose) {
        this.makeLooseShake(room, row * 10 + column);
      }
    }
  }
  // ------------------------------------------------------------- triggers
  /** The Prince stood on a button. */
  pressButton(room, tilePos, buttonType = 0, modifier = -1) {
    const type = buttonType || this.level.typeAtPos(room, tilePos);
    const link = modifier >= 0 ? modifier : this.level.modifierAtPos(room, tilePos);
    const timer = this.level.doorLinkTimer(link);
    if (timer === 31) return;
    this.level.setDoorLinkTimer(link, 5);
    if (timer < 2) {
      this.add(room, tilePos, 1);
      this.effects.sound?.(SOUND.buttonPressed);
    }
    this.runTriggerList(link, type);
  }
  runTriggerList(index, buttonType) {
    for (let i = index; i < 256; i++) {
      const link = this.level.doorLink(i);
      const target = this.level.typeAtPos(link.room, link.tilePos);
      const result = this.triggerOne(target, link.room, link.tilePos, buttonType);
      if (result >= 0) this.add(link.room, link.tilePos, result);
      if (!link.hasNext) break;
    }
  }
  triggerOne(target, room, tilePos, buttonType) {
    if (target === TILE.gate) return this.triggerGate(room, tilePos, buttonType);
    if (target === TILE.levelDoorLeft) {
      return this.level.modifierAtPos(room, tilePos) !== 0 ? -1 : 1;
    }
    return -1;
  }
  triggerGate(room, tilePos, buttonType) {
    const modifier = this.level.modifierAtPos(room, tilePos);
    if (buttonType === TILE.opener) {
      if (modifier === 255) return -1;
      if (modifier >= 188) {
        this.level.setModifierAtPos(room, tilePos, 238);
        return -1;
      }
      this.level.setModifierAtPos(room, tilePos, modifier + 3 & 252);
      return 1;
    }
    if (buttonType === TILE.debris) {
      if (modifier < 188) return 2;
      this.level.setModifierAtPos(room, tilePos, 255);
      return -1;
    }
    return modifier !== 0 ? 3 : -1;
  }
  /** Something put weight on a loose floor. */
  makeLooseFall(room, tilePos, modifier = 1) {
    if ((this.level.rawAtPos(room, tilePos) & 32) !== 0) return;
    const current = this.level.modifierAtPos(room, tilePos) << 24 >> 24;
    if (current > 0) return;
    this.level.setModifierAtPos(room, tilePos, modifier);
    this.add(room, tilePos, 0);
  }
  makeLooseShake(room, tilePos) {
    const current = this.level.modifierAtPos(room, tilePos) << 24 >> 24;
    if (current !== 0) return;
    this.level.setModifierAtPos(room, tilePos, 128);
    this.add(room, tilePos, 0);
  }
  /** Wake the chompers on the row a character has just arrived on. */
  startChompers(room, row) {
    if (row < 0 || row > 2) return;
    let timing = 15;
    for (let column = 0; column < 10; column++) {
      if (this.level.typeAt(room, column, row) !== TILE.chomper) continue;
      const tilePos = row * 10 + column;
      const modifier = this.level.modifierAtPos(room, tilePos);
      const phase = modifier & 127;
      if (phase !== 0 && phase < 6) continue;
      this.level.setModifierAtPos(room, tilePos, timing | modifier & 128);
      this.add(room, tilePos, 1);
      timing = nextChomperTiming(timing);
    }
  }
  /** Spikes come out when something walks over them. */
  startSpike(room, tilePos) {
    const old = this.level.modifierAtPos(room, tilePos) << 24 >> 24;
    if (old > 0) return;
    if (old === 0) {
      this.add(room, tilePos, 1);
      this.effects.sound?.(SOUND.spikes);
      return;
    }
    if (old !== -1) this.level.setModifierAtPos(room, tilePos, 143);
  }
  /** 0 harmless, 1 out and deadly, 2 coming out and deadly to a runner. */
  spikeHarm(room, tilePos) {
    const modifier = this.level.modifierAtPos(room, tilePos) << 24 >> 24;
    if (modifier === 0 || modifier === -1) return 0;
    if (modifier < 0) return 1;
    if (modifier < 5) return 2;
    return 0;
  }
  /**
   * Is this chomper's blade down? Phases 1 to 5 are the shut part of the
   * cycle: `startChompers` refuses to restart a chomper that is in them
   * because it is in the middle of a snap, and they are the ones that cut.
   */
  chomperHarm(room, tilePos) {
    if (this.level.typeAtPos(room, tilePos) !== TILE.chomper) return false;
    const phase = this.level.modifierAtPos(room, tilePos) & 127;
    return phase >= 1 && phase <= 5;
  }
  /** A chomper that has caught someone keeps the mark. */
  bloodyChomper(room, tilePos) {
    const modifier = this.level.modifierAtPos(room, tilePos);
    this.level.setModifierAtPos(room, tilePos, modifier | 128);
  }
  /** Start a level's exit door opening. */
  openLevelDoor(room, tilePos) {
    this.level.setModifierAtPos(room, tilePos, 43);
    this.add(room, tilePos, 3);
  }
};
function nextChomperTiming(timing) {
  let next = timing - 3;
  if (next < 6) next += 10;
  return next;
}
var SOUND = {
  falling: 1,
  tileCrashing: 2,
  buttonPressed: 3,
  gateClosing: 4,
  gateOpening: 5,
  gateClosingFast: 6,
  gateStop: 7,
  bumped: 8,
  grab: 9,
  softLand: 17,
  drink: 18,
  looseShake1: 20,
  looseShake2: 21,
  looseShake3: 22,
  footstep: 23,
  mediumLand: 16,
  chomper: 47,
  spikes: 49
};

// src/game/random.ts
var Prng2 = class {
  seed = 0;
  set(value) {
    this.seed = value >>> 0;
  }
  get() {
    return this.seed >>> 0;
  }
  /** A number in 0..max, inclusive, as the original returns it. */
  next(max) {
    this.seed = Math.imul(this.seed, 214013) + 2531011 >>> 0;
    return (this.seed >>> 16) % (max + 1);
  }
};

// src/game/game.ts
var Game = class _Game {
  scene;
  tables;
  kid;
  surface = new Surface();
  /** The room the view is showing. */
  drawnRoom;
  hitPoints;
  maxHitPoints;
  traps;
  prng = new Prng2();
  guard = newGuard();
  guards;
  renderer;
  ctx;
  levelNumber;
  effects;
  constructor(scene, tables, levelNumber, effects = {}) {
    this.levelNumber = levelNumber;
    this.effects = effects;
    this.scene = scene;
    this.tables = tables;
    this.kid = newCharacter();
    this.hitPoints = scene.constants.startHitPoints;
    this.maxHitPoints = scene.constants.startHitPoints;
    const world = {
      tileAt: (room, column, row) => scene.tiles.typeAt(room, column, row) & TILE_TYPE_MASK,
      modifierAt: (room, column, row) => scene.tiles.modifierAt(room, column, row),
      linkOf: (room, dir) => scene.tiles.linkOf(room, dir),
      levelEdgeHitTile: scene.constants.levelEdgeHitTile
    };
    this.prng.set(1);
    this.traps = new Traps(scene.state, this.prng, scene.options.levelType, effects);
    const trapHooks = {
      pressButton: (room, tilePos) => this.traps.pressButton(room, tilePos),
      makeLooseFall: (room, tilePos) => this.traps.makeLooseFall(room, tilePos),
      startChompers: (room, row) => this.traps.startChompers(room, row),
      chomperHarm: (room, tilePos) => this.traps.chomperHarm(room, tilePos),
      bloodyChomper: (room, tilePos) => this.traps.bloodyChomper(room, tilePos),
      startSpike: (room, tilePos) => this.traps.startSpike(room, tilePos),
      spikeHarm: (room, tilePos) => this.traps.spikeHarm(room, tilePos)
    };
    this.ctx = {
      tables,
      world,
      spriteWidth: (image) => scene.chtabs.kid?.images[image + 1]?.width ?? 0,
      controls: { x: 0, y: 0, shift: false },
      traps: trapHooks,
      latch: new ControlLatch(),
      damage: (amount) => this.damage(amount)
    };
    enterLevel(
      this.kid,
      scene.level.startRoom,
      scene.level.startPos,
      scene.level.startDir,
      this.ctx,
      levelNumber
    );
    this.drawnRoom = this.kid.room;
    this.traps.drawnRoom = this.drawnRoom;
    this.guards = guardsFromLevel(scene.level.guards);
    positionGuards(scene.state, this.guards);
    this.enterRoom(this.drawnRoom);
    this.renderer = new RoomRenderer(scene.chtabs, scene.tiles, scene.options);
  }
  static async start(assets, exe, levelNumber, options = {}) {
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? "V");
    return new _Game(scene, readExeTables(exe), levelNumber, options.effects);
  }
  /**
   * Advance one frame of the game: first the room reacts, then the Prince
   * moves, which is the order the original uses.
   */
  step(controls) {
    const wasDrawing = this.drawnRoom;
    this.traps.drawnRoom = this.drawnRoom;
    this.traps.kidRoom = this.kid.room;
    this.traps.kidRow = this.kid.currentRow;
    this.traps.kidAlive = this.kid.alive;
    this.traps.step();
    stepKid(this.kid, controls, this.ctx);
    stepGuard(this.guard, {
      tables: this.tables,
      effects: this.effects,
      kidRoom: this.kid.room,
      kidRow: this.kid.currentRow
    });
    if (this.kid.room !== 0) this.drawnRoom = this.kid.room;
    if (this.drawnRoom !== wasDrawing) this.enterRoom(this.drawnRoom);
  }
  /** Hurt the Prince. Returns true if that was the last of his hit points. */
  damage(amount) {
    this.hitPoints = Math.max(0, this.hitPoints - amount);
    return this.hitPoints === 0;
  }
  /** True once the Prince is dead and the level is waiting to be restarted. */
  get isDead() {
    return this.hitPoints === 0 || this.kid.alive >= 0;
  }
  /**
   * Put the level back as it was and the Prince back at its start, which is
   * what the original does after a death.
   */
  async restart(assets, exe) {
    return _Game.start(assets, exe, this.levelNumber, { effects: this.effects });
  }
  /** Show a different room without playing: for looking around. */
  showRoom(room) {
    if (room === this.drawnRoom) return;
    this.drawnRoom = room;
    this.enterRoom(room);
  }
  /**
   * Show a different room: the guard of the room being left goes back into
   * the level, the guard of the room being entered comes out of it, and the
   * new room's torches and exit door start up.
   */
  enterRoom(room) {
    leaveGuard(this.guard, this.guards);
    enterGuard(this.guard, room, this.guards, {
      tables: this.tables,
      guardType: this.scene.guardType,
      levelGuardHitPoints: this.scene.constants.guardHitPoints[this.levelNumber] ?? 0
    });
    this.applyGuardColour();
    this.traps.drawnRoom = room;
    this.startRoomTiles(room);
  }
  /**
   * A guard's clothes are recoloured per room, from the seven palettes the
   * game keeps in PRINCE.DAT. Colour 0 leaves the sprite's own colours alone.
   */
  applyGuardColour() {
    const set = this.scene.chtabs.guard;
    const palettes = this.scene.guardPalettes;
    if (!set) return;
    if (!palettes || this.guard.colour === 0) {
      this.scene.screenPalette.loadBlock(set.paletteBase, set.palette.vga);
      return;
    }
    const at = (this.guard.colour - 1) * 48;
    const colours = [];
    for (let i = 0; i < 16; i++) {
      colours.push({
        r: palettes[at + i * 3] ?? 0,
        g: palettes[at + i * 3 + 1] ?? 0,
        b: palettes[at + i * 3 + 2] ?? 0
      });
    }
    this.scene.screenPalette.loadBlock(set.paletteBase, colours);
  }
  /**
   * Entering a room sets its torches going and, on a level that is not the
   * one the Prince started on, its exit door. The original does this when it
   * draws a room for the first time.
   */
  startRoomTiles(room) {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 10; column++) {
        const type = this.scene.state.typeAt(room, column, row);
        const tilePos = row * 10 + column;
        if (type === 19 || type === 30) {
          this.scene.state.setModifierAtPos(room, tilePos, this.prng.next(8));
          this.traps.add(room, tilePos, 1);
        } else if (type === 10 || type === 22) {
          this.traps.add(room, tilePos, 1);
        }
      }
      const left = this.scene.state.linkOf(room, 0);
      if (left) {
        const type = this.scene.state.typeAt(left, 9, row);
        if (type === 19 || type === 30) {
          this.scene.state.setModifierAtPos(left, row * 10 + 9, this.prng.next(8));
          this.traps.add(left, row * 10 + 9, 1);
        }
      }
    }
  }
  /** What to draw for the Prince, if he is in the room being shown. */
  kidDraw() {
    if (this.kid.room !== this.drawnRoom) return null;
    const frame = this.tables.frameTableKid[this.kid.frame];
    if (!frame) return null;
    return placeCharacter(this.kid, frame);
  }
  render() {
    this.surface.clear();
    const characters = [];
    if (this.guard.room === this.drawnRoom && this.guard.direction !== NO_DIRECTION) {
      const draw = guardDraw(this.guard, this.tables);
      if (draw) characters.push(draw);
      const frame = guardFrame(this.guard, this.tables);
      if (frame && this.guard.alive < 0) {
        const sword = placeSword(this.guard, frame, this.tables.swordTable, toScreenX);
        if (sword) characters.push(sword);
      }
    }
    const kid = this.kidDraw();
    if (kid) characters.push(kid);
    const kidFrame = this.tables.frameTableKid[this.kid.frame];
    if (kid && kidFrame && this.kid.sword !== 0) {
      const sword = placeSword(this.kid, kidFrame, this.tables.swordTable, toScreenX);
      if (sword) characters.push(sword);
    }
    this.renderer.render(this.surface, this.drawnRoom, characters);
    this.drawStatusBar();
    return this.surface;
  }
  /**
   * The strip below the room. The original draws the Prince's hit points
   * there as small sprites from his own group: a full one for each point he
   * has, an empty one for each he has lost.
   */
  drawStatusBar() {
    const kid = this.scene.chtabs.kid;
    if (!kid) return;
    const full = kid.images[FULL_HP_IMAGE];
    const empty = kid.images[EMPTY_HP_IMAGE];
    for (let i = this.hitPoints; i < this.maxHitPoints; i++) {
      if (empty) this.surface.blitOpaque(empty, i * 7, HP_TOP_Y, kid.paletteBase);
    }
    for (let i = 0; i < this.hitPoints; i++) {
      if (full) this.surface.blitOpaque(full, i * 7, HP_TOP_Y, kid.paletteBase);
    }
    const guardSet = this.scene.chtabs.guard;
    const marker = guardSet?.images[1];
    if (!marker || this.guard.direction === NO_DIRECTION) return;
    for (let i = this.guard.hitPoints; i < this.guard.maxHitPoints; i++) {
      this.surface.blitMono(marker, 314 - i * 7, HP_TOP_Y, 0);
    }
    for (let i = 0; i < this.guard.hitPoints; i++) {
      this.surface.blitOpaque(marker, 314 - i * 7, HP_TOP_Y, guardSet.paletteBase);
    }
  }
};
var FULL_HP_IMAGE = 217;
var EMPTY_HP_IMAGE = 218;
var HP_TOP_Y = 194;

// web/main.ts
var DATA_URL = window.__princeDataUrl ?? "../original/prince1";
var FRAMES_PER_SECOND = 12;
async function boot() {
  const canvas = document.getElementById("screen");
  const sceneSel = document.getElementById("scene");
  const roomSel = document.getElementById("room");
  const aspectSel = document.getElementById("aspect");
  const status = document.getElementById("status");
  const display = new Display(canvas);
  const custom = window.__princeFetcher;
  const fetchFile = custom ?? browserFetcher(DATA_URL);
  const assets = new Assets(fetchFile);
  const exe = await fetchFile("UNCRKD.EXE");
  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group("TITLE.DAT", 50);
  const opening = await assets.group("TITLE.DAT", 40);
  const views = [{ kind: "title" }, { kind: "opening" }];
  for (let n = 1; n <= 14; n++) views.push({ kind: "level", level: n });
  const label = (v) => v.kind === "level" ? `level ${v.level}` : `${v.kind} screen`;
  for (const [i, v] of views.entries()) {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = label(v);
    sceneSel.append(o);
  }
  for (let r = 1; r <= 24; r++) {
    const o = document.createElement("option");
    o.value = String(r);
    o.textContent = `room ${r}`;
    roomSel.append(o);
  }
  let current = 0;
  let game = null;
  let watchRoom = null;
  const held = /* @__PURE__ */ new Set();
  const controls = () => ({
    x: (held.has("right") ? 1 : 0) - (held.has("left") ? 1 : 0),
    y: (held.has("down") ? 1 : 0) - (held.has("up") ? 1 : 0),
    shift: held.has("shift")
  });
  const CONTROLS = "arrow keys or the numeric keypad to move, up to jump; hold shift to step carefully and to keep hold of a ledge, then up again to climb it";
  function directionsOf(e) {
    switch (e.code) {
      case "Numpad7":
        return ["left", "up"];
      case "Numpad8":
        return ["up"];
      case "Numpad9":
        return ["right", "up"];
      case "Numpad4":
        return ["left"];
      case "Numpad5":
        return [];
      case "Numpad6":
        return ["right"];
      case "Numpad1":
        return ["left", "down"];
      case "Numpad2":
        return ["down"];
      case "Numpad3":
        return ["right", "down"];
      case "ArrowLeft":
        return ["left"];
      case "ArrowRight":
        return ["right"];
      case "ArrowUp":
        return ["up"];
      case "ArrowDown":
        return ["down"];
      case "ShiftLeft":
      case "ShiftRight":
        return ["shift"];
      default:
        return null;
    }
  }
  function drawTitle(group) {
    titleSurface.clear();
    titlePalette.loadBlock(0, group.palette.vga);
    titleSurface.blitOpaque(group.images[1], 0, 0);
    display.present(titleSurface, titlePalette.toRgba());
  }
  async function select(index) {
    current = index;
    sceneSel.value = String(current);
    const v = views[current];
    if (v.kind !== "level") {
      game = null;
      roomSel.disabled = true;
      drawTitle(v.kind === "title" ? title : opening);
      status.textContent = `${label(v)} \u2014 320x200, drawn from the original data files`;
      return;
    }
    roomSel.disabled = false;
    game = await Game.start(assets, exe, v.level);
    watchRoom = null;
    roomSel.value = String(game.drawnRoom);
  }
  function frame() {
    if (!game) return;
    if (watchRoom === null) {
      game.step(controls());
      if (roomSel.value !== String(game.drawnRoom)) roomSel.value = String(game.drawnRoom);
    } else if (game.drawnRoom !== watchRoom) {
      game.showRoom(watchRoom);
    }
    display.present(game.render(), game.scene.screenPalette.toRgba());
    const v = views[current];
    const type = game.scene.options.levelType ? "palace" : "dungeon";
    status.textContent = game.isDead ? `${label(v)} \u2014 you are dead; press any direction to begin again` : watchRoom === null ? `${label(v)} (${type}) \u2014 ${CONTROLS}` : `${label(v)} (${type}), room ${watchRoom} \u2014 looking around; press a key to play`;
  }
  sceneSel.addEventListener("change", () => {
    sceneSel.blur();
    void select(Number(sceneSel.value));
  });
  roomSel.addEventListener("change", () => {
    roomSel.blur();
    watchRoom = Number(roomSel.value);
  });
  aspectSel.addEventListener("change", () => {
    aspectSel.blur();
    display.setAspect(aspectSel.value);
  });
  window.addEventListener("keydown", (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    document.activeElement?.blur?.();
    if (dirs.length === 0) held.clear();
    for (const d of dirs) held.add(d);
    if (watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
    if (game?.isDead) void restart();
  });
  window.addEventListener("keyup", (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    for (const d of dirs) held.delete(d);
  });
  window.addEventListener("blur", () => held.clear());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) held.clear();
  });
  const w0 = window;
  const PAD_DIRECTION = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    Shift: "shift"
  };
  w0.__princeHold = (key, down) => {
    const d = PAD_DIRECTION[key] ?? key;
    if (down) held.add(d);
    else held.delete(d);
    if (down && game?.isDead) void restart();
    if (down && watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  };
  async function restart() {
    if (!game) return;
    held.clear();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }
  await select(0);
  const STEP_MS = 1e3 / FRAMES_PER_SECOND;
  let owed = 0;
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS;
    let stepped = false;
    while (owed >= STEP_MS) {
      owed -= STEP_MS;
      frame();
      stepped = true;
    }
    if (!stepped && game && watchRoom !== null) frame();
  }
  requestAnimationFrame(tick);
  const w = window;
  w.__princeFrame = (id) => {
    if (id === "title-background") {
      drawTitle(title);
      return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    }
    if (!game) return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    return Array.from(game.render().toRgb(game.scene.screenPalette.toRgba()));
  };
  w.__princeShow = async (level, room) => {
    await select(views.findIndex((v) => v.kind === "level" && v.level === level));
    watchRoom = room;
    if (game) game.showRoom(room);
    frame();
  };
  w.__princeStep = (n, c = {}) => {
    if (!game) return null;
    watchRoom = null;
    for (let i = 0; i < n; i++) game.step({ x: 0, y: 0, shift: false, ...c });
    display.present(game.render(), game.scene.screenPalette.toRgba());
    return { ...game.kid };
  };
  w.__princeState = () => game ? {
    frame: game.kid.frame,
    room: game.kid.room,
    x: game.kid.x,
    y: game.kid.y,
    hitPoints: game.hitPoints,
    dead: game.isDead,
    held: [...held].sort()
  } : null;
  w.__princeLevel = () => views[current].kind === "level" ? views[current].level : 0;
  w.__princeReady = true;
  void RoomRenderer;
}
boot().catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
