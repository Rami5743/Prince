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
  const out2 = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    out2[i * 4 + 0] = to8(pal.vga[i].r);
    out2[i * 4 + 1] = to8(pal.vga[i].g);
    out2[i * 4 + 2] = to8(pal.vga[i].b);
    out2[i * 4 + 3] = 255;
  }
  return out2;
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
  const step = stride - 1;
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
      dp += step;
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
  const out2 = new Uint8Array(width * height);
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
        out2[op++] = v >> shift & mask;
      }
    }
  }
  return out2;
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
  /**
   * `obj_clip_bottom`. The original clips everything it draws in the room
   * to the room's own 192 rows, so nothing reaches the eight rows of hit
   * points below it. The port had no clip at all, so a Prince stepping
   * off the bottom row of a room had his feet drawn across the bottom of
   * the screen on the way out.
   */
  clipBottom;
  /**
   * `obj_clip_top`, which `clip_char` sets to the top of the row a
   * character is in when there is a floor or a wall over him: that is
   * how the original keeps the arm of a Prince falling into a room
   * from being drawn through the floor he came through.
   */
  clipTop;
  /**
   * `obj_clip_left` and `obj_clip_right`.
   *
   * The original clips sideways as well, and the level door is what
   * needs it: `clip_char` sets `obj_clip_right` to `leveldoor_right`
   * for the frames of the climb up the stairs, so the Prince is cut
   * off at the door's right edge as he goes through it, and to the
   * right edge of the tile for a door top. The surface had no
   * horizontal clip at all, so both were dropped and the Prince's
   * legs were drawn sticking out past the level door on the way up.
   */
  clipLeft;
  clipRight;
  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
    this.clipBottom = height;
    this.clipTop = 0;
    this.clipLeft = 0;
    this.clipRight = width;
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
    const sx0 = Math.max(Math.max(0, -x), this.clipLeft - x);
    const sy0 = Math.max(Math.max(0, -y), this.clipTop - y);
    const sx1 = Math.min(src.width, Math.min(this.width, this.clipRight) - x);
    const sy1 = Math.min(src.height, this.clipBottom - y);
    for (let sy = sy0; sy < sy1; sy++) {
      let sp = sy * src.width + sx0;
      let dp = (y + sy) * this.width + (x + sx0);
      for (let sx = sx0; sx < sx1; sx++, sp++, dp++) fn(dp, src.pixels[sp]);
    }
  }
  /** Expand to RGBA for putImageData. */
  toRgba(paletteRgba, out2) {
    const dst = out2 ?? new Uint8ClampedArray(this.width * this.height * 4);
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
  const rooms2 = Math.min(roomCount, 24);
  const typeAt = (index) => fg[index] & TILE_TYPE_MASK;
  for (let room = 1; room <= rooms2; room++) {
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
  const out2 = { width: img.width, height: img.height, pixels };
  flipCache.set(img, out2);
  return out2;
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
var ROW_ABOVE_ORDER = -1;
var ROOM_BOTTOM_Y = 192;
function yToRowForMob(y) {
  return Math.min(2, Math.floor((y + 60) / 63) % 4 - 1);
}
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
var FLOOR_LEFT_OVERLAY = [32, 151, 151, 150, 150, 151, 32, 32];
var FLOOR_OVERLAY_TILES = /* @__PURE__ */ new Set([
  TILE.floor,
  TILE.pillar,
  TILE.stuck,
  TILE.torch
]);
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
  const out2 = new Uint8Array(132);
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
        out2[44 * row + 11 * subrow + column] = color;
        prev = color;
      }
    }
  }
  return out2;
}
var RoomRenderer = class {
  chtabs;
  tiles;
  opt;
  back = [];
  mid = [];
  /** `obj_tilepos = -1`: painted after everything. */
  onTop = [];
  fore = [];
  wipes = [];
  /** Which list draw_tile_base / draw_tile_bottom append to. */
  addTo = "back";
  /** Inside the part of `draw_tile` that `draw_tile2` draws again. */
  inTile2 = false;
  /**
   * Inside `wall_pattern`, which names its table rather than taking
   * the one in hand -- so the bricks and chips of a wall are never
   * part of an overlay, however the tile they belong to was reached.
   */
  inWallPattern = false;
  /** Per tile, what the climbing lip needs: keyed row * 10 + column. */
  tileInfo = /* @__PURE__ */ new Map();
  drawnRoom = 0;
  /** Which pass of the room drawing is running; stamped on every piece. */
  paintOrder = ROW_ABOVE_ORDER + 1;
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
  constructor(chtabs2, tiles2, opt) {
    this.chtabs = chtabs2;
    this.tiles = tiles2;
    this.opt = opt;
  }
  get isPalace() {
    return this.opt.levelType !== 0;
  }
  /** Build the draw lists for a room and paint them onto `surface`. */
  render(surface, room, characters = [], mobs2 = []) {
    this.back = [];
    this.mid = [];
    this.onTop = [];
    this.fore = [];
    this.wipes = [];
    this.addTo = "back";
    this.inTile2 = false;
    this.inWallPattern = false;
    this.tileInfo.clear();
    this.paintOrder = ROW_ABOVE_ORDER + 1;
    this.drawnRoom = room;
    this.palaceWallColors = this.opt.palaceWallColors ?? generatePalaceWallColors(room);
    this.loadRoomLinks();
    this.drawRoom();
    for (const m of mobs2) this.addMob(m);
    for (const c of characters) this.addCharacter(c);
    const clip = surface.clipBottom;
    surface.clipBottom = ROOM_BOTTOM_Y;
    this.paint(surface);
    surface.clipBottom = clip;
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
  /** `addCurrent`, and mark what it added as the front of a floor. */
  addFloorFront(chtab, id, x, yBottom, blit) {
    const list = this.addTo === "back" ? this.back : this.fore;
    const added = this.addCurrent(chtab, id, x, yBottom, blit);
    if (added) list[list.length - 1].floorFront = true;
    return added;
  }
  addCurrent(chtab, id, x, yBottom, blit) {
    return this.addTo === "back" ? this.addBack(chtab, id, x, yBottom, blit) : this.addFore(chtab, id, x, yBottom, blit);
  }
  push(list, chtab, id, x, yBottom, blit) {
    if (id === 0) return false;
    if (!this.image(chtab, id)) return false;
    list.push({
      chtab,
      id,
      x,
      yBottom,
      blit,
      order: this.paintOrder,
      col: this.drawnCol,
      row: this.drawnRow,
      tile2: this.inTile2 && !this.inWallPattern,
      leftEmpty: this.tileLeft === TILE.empty
    });
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
  /**
   * A button with a foot on it is drawn as the floor it sits in.
   *
   * Its plate is a pixel of height -- an opener's base is 32x14 where a
   * plain floor's is 32x13, and its right-hand piece sits a pixel higher
   * -- and that pixel is spread over four of the pieces a tile is built
   * from, the tile's own and two that its right-hand neighbour draws.
   * Sinking only some of them leaves the plate half down. Swapping the
   * type here instead puts every piece on the floor's measurements at
   * once.
   *
   * Whether a foot is on it is not in the tile: a button's modifier is an
   * index into the level's door links, and the timer kept there is the
   * record -- `pressButton` sets it to five and `animateButton` counts it
   * down, so it holds while the foot is there and runs out a few ticks
   * after it leaves.
   *
   * It runs out at one, not at nought. `animateButton` writes the timer
   * back and then drops the tile off the list of things to animate once
   * it is below two, so the last value ever written is one and nothing
   * will ever write a nought. A plate that counted one as pressed stayed
   * sunk for the rest of the level, which is what the player saw: step
   * on it, step off, and it never comes back up.
   */
  /**
   * The modifier goes with the type. A button's modifier is an index into
   * the level's door links and means nothing to a floor, which reads its
   * modifier as which of four marks to put on the wall above it -- so a
   * plate whose link happened to be numbered one, two or three hung a
   * decoration in the air the moment a foot came down on it, and took it
   * away again when the foot left. Rooms 12 and 20 of level 1 both have
   * one. A plate pressed flush is a plain floor, mark and all.
   */
  pressedToFloor(type, modifier) {
    if (type !== TILE.opener && type !== TILE.closer) return { type, modifier };
    return (this.tiles.doorLinkTimer?.(modifier) ?? 0) > 1 ? { type: TILE.floor, modifier: 0 } : { type, modifier };
  }
  loadCurrentAndLeftTile() {
    const outside = this.drawnRow === 2 ? this.opt.topLevelEdgeTile : TILE.wall;
    const curr = this.tileToDraw(this.drawnRoom, this.drawnCol, this.drawnRow, outside);
    const here = this.pressedToFloor(curr.type, curr.modifier);
    this.currTile = here.type;
    this.currModifier = here.modifier;
    const left = this.tileToDraw(this.drawnRoom, this.drawnCol - 1, this.drawnRow, outside);
    const beside = this.pressedToFloor(left.type, left.modifier);
    this.tileLeft = beside.type;
    this.modifierLeft = beside.modifier;
    this.drawX = COL_X[this.drawnCol];
  }
  drawRoom() {
    this.loadLeftRoom();
    for (this.drawnRow = 2; this.drawnRow >= 0; this.drawnRow--) {
      this.paintOrder = this.drawnRow;
      this.loadRowBelow();
      this.drawBottomY = 63 * this.drawnRow + 65;
      this.drawMainY = this.drawBottomY - 3;
      for (this.drawnCol = 0; this.drawnCol < 10; this.drawnCol++) {
        this.loadCurrentAndLeftTile();
        this.drawTile();
      }
    }
    const saved = this.drawnRoom;
    this.paintOrder = ROW_ABOVE_ORDER;
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
    this.inTile2 = true;
    this.tileInfo.set(this.drawnRow * 10 + this.drawnCol, {
      x: this.drawX,
      mainY: this.drawMainY,
      curr: this.currTile
    });
    this.drawTileRight();
    this.drawTileAnimRight();
    this.drawTileBottom();
    this.drawLoose();
    this.drawTileBase();
    this.drawTileAnim();
    this.inTile2 = false;
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
    if (chtab === CHTAB.environmentWall) {
      this.addCurrent(chtab, id, this.drawX, this.drawBottomY, blit);
      this.wallPattern(0, 0);
    } else {
      this.addFloorFront(chtab, id, this.drawX, this.drawBottomY, blit);
    }
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
    this.addFloorFront(
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
    const savedInWall = this.inWallPattern;
    this.inWallPattern = true;
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
    this.inWallPattern = savedInWall;
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
   * A floor that has come away and is on its way down.
   *
   * It is drawn out of the same three pieces a floor tile is -- the base,
   * the right-hand half that belongs to the next column along, and the
   * underside -- but at the height the falling block has reached rather
   * than at its row's. Until this existed nothing drew them at all: the
   * tile was taken out of the room the moment it gave way and the block
   * simply vanished instead of falling.
   */
  addMob(m) {
    let y = m.y;
    if (m.room === this.drawnRoom) {
      if (m.y >= 210) return;
    } else if (m.room === this.roomB) {
      if (Math.abs(m.y << 24 >> 24) >= 18) return;
      y = m.y + 192;
    } else if (m.room === this.roomA) {
      if (m.y < 174) return;
      y = m.y - 189;
    } else {
      return;
    }
    const col = m.column;
    if (col < 0 || col >= COL_X.length) return;
    const x = COL_X[col];
    const rawRow = yToRowForMob(y);
    const order = rawRow < 0 ? 2 : rawRow;
    const MOB = 10;
    this.mid.push({
      chtab: CHTAB.environment,
      id: LOOSE_FRAM_LEFT[MOB],
      x,
      mob: true,
      yBottom: y - 3,
      blit: BLIT.transparent,
      order,
      col
    });
    this.mid.push({
      chtab: CHTAB.environment,
      id: LOOSE_FRAM_BOTTOM[MOB],
      x,
      yBottom: y,
      mob: true,
      blit: BLIT.opaque,
      order,
      col
    });
    this.mid.push({
      chtab: CHTAB.environment,
      id: LOOSE_FRAM_RIGHT[MOB],
      x: x + 32,
      mob: true,
      yBottom: y - 1,
      blit: BLIT.transparent,
      order,
      col
    });
  }
  addCharacter(c) {
    const set = this.chtabs[c.chtab];
    if (!set) return;
    const img = set.images[c.image];
    if (!img) return;
    const row = c.row ?? 0;
    const layer = c.onTop ? "onTop" : "normal";
    const list = layer === "onTop" ? this.onTop : this.mid;
    list.push({
      chtab: c.chtab,
      id: c.image,
      x: c.x,
      yBottom: c.y,
      blit: BLIT.transparent,
      character: true,
      flip: c.direction === 0,
      screenX: c.alreadyScreenX === true,
      // A row above the room or below it is painted with the nearest
      // row of it: see `CharacterLayer`.
      order: Math.min(2, Math.max(0, row)),
      overlay: c.overlay,
      clipTop: c.clipTop,
      col: c.objColumn ?? c.overlay?.ownColumn
    });
  }
  /**
   * Every piece of the room, then everyone standing in it, then the few
   * pieces the original keeps in front of them -- and, between the last
   * two, the front of every floor above each character.
   *
   * That last bit is the ledge a climbing Prince disappears behind. It
   * took two measurements to get right, and they pull in opposite
   * directions.
   *
   * The first says the row above does *not* cover him. Count the pixels
   * of the Prince on the climb up the left of room 2 in the recorded run
   * `b4ff4672`, ticks 175 to 179:
   *
   *     the original          232  271  296  272  220
   *     painted this way      232  271  296  272  220
   *     row by row            215  187  156  121   82
   *
   * -- painting the rows bottom-up with each character in with his own
   * row eats his head as he rises into the row above, and the original
   * does not.
   *
   * The second says a ledge *does* cover him. The probe
   * `14.,4d,5r,9u,18s,8u,24.` -- level 1, jump up and take hold of the
   * ledge at the right of room 1's middle row, then climb it -- had the
   * port drawing his body over the front of that ledge for five ticks
   * where the original draws only his head and arms above it. That is
   * what the player meant by seeing the palms of his hands.
   *
   * What tells the two apart is not the row but the piece. A floor's
   * front -- the slab under the surface you walk on, which
   * `drawTileBase` and `drawTileBottom` lay down -- goes in front of
   * anyone in the row below it. A wall's back, which is what stands
   * above him at a room's edge, does not. So those pieces, and only
   * those, are painted a second time over each character who is below
   * them, and the two measurements agree: the climb at the edge is
   * untouched, and the climb onto the ledge is now pixel for pixel the
   * original's for every frame of it.
   */
  paint(surface) {
    this.paintWipes(surface, 0);
    for (const p of this.back) this.paintPiece(surface, p);
    const characters = [...this.mid].sort(
      (a, b) => b.order - a.order || (a.col ?? 0) - (b.col ?? 0) || a.yBottom - b.yBottom
    );
    for (const c of characters) {
      this.paintPiece(surface, c);
      for (const p of this.back) {
        if (!p.floorFront) continue;
        if (p.order < c.order || c.mob === true && p.order === c.order && p.x > c.x) {
          this.paintPiece(surface, p);
        }
      }
      if (c.overlay) this.paintOverlay(surface, c);
    }
    this.paintWipes(surface, 1);
    for (const p of this.fore) this.paintPiece(surface, p);
    for (const p of this.onTop) this.paintPiece(surface, p);
  }
  /**
   * `draw_other_overlay` and `draw_floor_overlay`: the tiles a falling
   * or climbing character marked, drawn again over him.
   *
   * Only the tiles past the one he is at: the original paints a room
   * left to right and a character with the tile he stands at, so the
   * tiles before his are under him and the ones after are over him.
   * And only where the tile to the left is empty, which is the test
   * both of those functions start with -- a floor with a floor beside
   * it has nothing of its own sticking out to the left to redraw.
   */
  paintOverlay(surface, c) {
    const o = c.overlay;
    if (!o) return;
    const rows = o.skipBottomRow ? [o.topRow] : o.topRow === o.bottomRow ? [o.bottomRow] : [o.topRow, o.bottomRow];
    for (const row of rows) {
      if (row < 0 || row > 2 || row > o.ownRow) continue;
      const from = row < o.ownRow ? o.colLeft : Math.max(o.colLeft, o.ownColumn + 1);
      for (let col = from; col <= o.colRight; col++) {
        const info = this.tileInfo.get(row * 10 + col);
        if (!info) continue;
        if (info.curr === TILE.empty) continue;
        const pieces = this.back.filter(
          (p) => p.tile2 && p.row === row && p.col === col && p.leftEmpty
        );
        if (!pieces.length) continue;
        if (o.climbFrame !== void 0 && FLOOR_OVERLAY_TILES.has(info.curr)) {
          const id = FLOOR_LEFT_OVERLAY[o.climbFrame - 137] ?? 0;
          const yBottom = info.mainY + (info.curr === TILE.stuck ? 1 : 0);
          if (id) {
            this.paintPiece(surface, {
              chtab: CHTAB.environment,
              id,
              x: info.x,
              yBottom,
              blit: BLIT.transparent,
              order: row
            });
          }
          for (const p of pieces) if (p.floorFront) this.paintPiece(surface, p);
          continue;
        }
        for (const p of pieces) this.paintPiece(surface, p);
      }
    }
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
      const clip = surface.clipTop;
      if (p.clipTop !== void 0) surface.clipTop = p.clipTop;
      surface.blitTransparent(sprite, x, y, base);
      surface.clipTop = clip;
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
  const levelType3 = exe.subarray(OFF.levelType, OFF.levelType + 16);
  for (const v of levelType3) {
    if (v > 1) throw new Error("level type table does not look like dungeon/palace flags");
  }
}
function readExeConstants(exe) {
  checkExe(exe);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u8 = (o) => exe[o];
  const vgaPalette = [];
  for (let i = 0; i < 16; i++) {
    const o = OFF.vgaPalette + i * 3;
    vgaPalette.push({ r: exe[o], g: exe[o + 1], b: exe[o + 2] });
  }
  return {
    startMinutesLeft: u16(OFF.startMinutesLeft),
    startTicksLeft: u16(OFF.startTicksLeft),
    startHitPoints: u16(OFF.startHitPoints),
    firstLevel: u16(OFF.firstLevel),
    maxHitPointsAllowed: u16(OFF.maxHitPointsAllowed),
    savingAllowedFirstLevel: u8(OFF.savingAllowedFirstLevel) + 1,
    savingAllowedLastLevel: u8(OFF.savingAllowedLastLevel) - 1,
    copyProtectionLevel: u16(OFF.copyProtectionLevel),
    drawnTileTopLevelEdge: u8(OFF.drawnTileTopLevelEdge),
    drawnTileLeftLevelEdge: u8(OFF.drawnTileLeftLevelEdge),
    levelEdgeHitTile: u8(OFF.levelEdgeHitTile),
    levelType: exe.slice(OFF.levelType, OFF.levelType + 16),
    guardHitPoints: exe.slice(OFF.guardHitPoints, OFF.guardHitPoints + 16),
    demoHitPoints: u8(OFF.demoHitPoints),
    demoEndRoom: u8(OFF.demoEndRoom),
    introMusicLevel: u8(OFF.introMusicLevel),
    checkpointLevel: u8(OFF.checkpointLevel),
    checkpointRespawnDir: u8(OFF.checkpointRespawnDir) << 24 >> 24,
    checkpointRespawnRoom: u8(OFF.checkpointRespawnRoom),
    checkpointRespawnTilePos: u8(OFF.checkpointRespawnTilePos),
    skeletonLevel: u8(OFF.skeletonLevel),
    skeletonRoom: u8(OFF.skeletonRoom),
    skeletonColumn: u8(OFF.skeletonColumn),
    skeletonRow: u8(OFF.skeletonRow),
    mirrorLevel: u8(OFF.mirrorLevel),
    mirrorRoom: u8(OFF.mirrorRoom),
    vgaPalette,
    // The original compares against 116; anything else means the "wall
    // decoration algorithm" was enabled for palace levels too.
    enableWdaInPalace: u8(OFF.enableWdaInPalace) !== 116
  };
}

// src/game/exe-tables.ts
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
  const out2 = [];
  let plain = before;
  for (let i = 0; i < packed.length; i++) {
    const block = i + 6 < packed.length && packed[i + 2] === 178 && packed[i + 5] === 0 && packed[i + 6] === 176 && (packed[i] | packed[i + 1] << 8) === plain;
    if (block) {
      for (let k = packed[i + 4]; k > 0; k--) out2.push(packed[i + 3]);
      i += 6;
      plain = 0;
      continue;
    }
    out2.push(packed[i]);
    plain += 1;
  }
  return Uint8Array.from(out2);
}
function readFrames(exe, offset, count) {
  const out2 = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 5;
    out2.push({
      image: exe[o],
      sword: exe[o + 1],
      dx: exe[o + 2] << 24 >> 24,
      dy: exe[o + 3] << 24 >> 24,
      flags: exe[o + 4]
    });
  }
  return out2;
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
var SOUND_SILENCE = -1;
var SEQUENCE_SOUND = [
  SOUND_SILENCE,
  // 0: stop
  23,
  // 1: a footstep
  8,
  // 2: bumping into something
  18,
  // 3: drinking
  19
  // 4: the way out of the level
];

// src/game/kid.ts
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
  /**
   * The two frames of the stride a runner can pull up on --
   * `control_running` takes the key only on frame 7 or frame 11, and
   * carries on to one of them otherwise.
   */
  run1: 7,
  run2: 11,
  /** The body the original leaves when the Prince falls out of the level. */
  dead: 185
};
var RUN_JUMP_FIRST = FRAME.run7;

// src/game/guard.ts
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
var NO_DIRECTION = 56;

// src/game/recording.ts
var RECORDING_FORMAT = "prince-input-recording";
var RECORDING_VERSION = 1;
function tokenOf(c) {
  const s = (c.x < 0 ? "l" : c.x > 0 ? "r" : "") + (c.y < 0 ? "u" : c.y > 0 ? "d" : "") + (c.shift ? "s" : "");
  return s === "" ? "." : s;
}
function encodeTimeline(ticks) {
  const out2 = [];
  let token = "";
  let count = 0;
  for (const c of ticks) {
    const t = tokenOf(c);
    if (t === token) {
      count++;
      continue;
    }
    if (count) out2.push(`${count}${token}`);
    token = t;
    count = 1;
  }
  if (count) out2.push(`${count}${token}`);
  return out2.join(",");
}

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
  const out2 = new Uint8Array(LEVEL_PAYLOAD_SIZE);
  out2.fill(255);
  out2.set(payload);
  return out2;
}
function parseLevel(payload, resourceId) {
  if (payload.length < LEVEL_PAYLOAD_SIZE - 1) {
    throw new Error(
      `level payload is ${payload.length} bytes, expected ${LEVEL_PAYLOAD_SIZE}`
    );
  }
  const d = normalise(payload);
  const guards2 = [];
  for (let i = 0; i < ROOM_COUNT; i++) {
    guards2.push({
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
    guards: guards2
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
function tilesetFileFor(levelType3, prefix = "V") {
  return `${prefix}${levelType3 ? "PALACE" : "DUNGEON"}.DAT`;
}
async function buildLevelScene(assets, exe, levelNumber, prefix = "V") {
  const constants = readExeConstants(exe);
  const levelsDat = await assets.dat("LEVELS.DAT");
  const resourceId = resourceIdOfLevel(levelNumber);
  const level = parseLevel(levelsDat.get(resourceId), resourceId);
  const levelType3 = constants.levelType[levelNumber] ?? 0;
  const tilesetFile = tilesetFileFor(levelType3, prefix);
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
    const headerFile = guardType === 0 ? levelType3 ? "GUARD1.DAT" : "GUARD2.DAT" : guardFile;
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
  const tiles2 = {
    typeAt: (room, column, row) => state.typeAt(room, column, row),
    modifierAt: (room, column, row) => state.modifierAt(room, column, row),
    linkOf: (room, dir) => state.linkOf(room, dir),
    doorLinkTimer: (index) => state.doorLinkTimer(index)
  };
  return {
    level,
    state,
    constants,
    chtabs: { environment, environmentWall, flameSwordPotion, kid, sword, guard },
    guardType,
    guardPalettes,
    screenPalette,
    tiles: tiles2,
    options: {
      levelType: levelType3,
      topLevelEdgeTile: constants.drawnTileTopLevelEdge,
      leftLevelEdgeTile: constants.drawnTileLeftLevelEdge,
      enableWdaInPalace: constants.enableWdaInPalace,
      startRoom: level.startRoom
    }
  };
}

// src/render/font.ts
var FONT_OFFSET = 107020;
function looksLikeGlyph(exe, o) {
  return o > 0 && o + 6 <= exe.length && exe[o + 1] === 0 && exe[o + 3] === 0 && exe[o] <= 16 && exe[o + 2] >= 1 && exe[o + 2] <= 20;
}
function readFont(exe, base = FONT_OFFSET) {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const firstChar = exe[base];
  const lastChar = exe[base + 1];
  const count = lastChar - firstChar + 1;
  const glyphs = [];
  for (let i = 0; i < count; i++) {
    let o = base + dv.getUint16(base + 10 + i * 2, true);
    if (!looksLikeGlyph(exe, o) && looksLikeGlyph(exe, o - 1)) o -= 1;
    if (!looksLikeGlyph(exe, o)) {
      glyphs.push(null);
      continue;
    }
    const height = exe[o];
    const width = exe[o + 2];
    const stride = Math.ceil(width / 8);
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = exe[o + 6 + y * stride + (x >> 3)] ?? 0;
        pixels[y * width + x] = byte >> 7 - (x & 7) & 1;
      }
    }
    glyphs.push({ width, height, sprite: { width, height, pixels } });
  }
  return {
    firstChar,
    lastChar,
    heightAbove: dv.getInt16(base + 2, true),
    heightBelow: dv.getInt16(base + 4, true),
    lineSpacing: dv.getInt16(base + 6, true),
    charSpacing: dv.getInt16(base + 8, true),
    glyphs
  };
}
function glyphOf(font, code) {
  if (code < font.firstChar || code > font.lastChar) return null;
  return font.glyphs[code - font.firstChar] ?? null;
}
function textWidth(font, text) {
  let width = 0;
  let drawn = 0;
  for (const ch of text) {
    const g2 = glyphOf(font, ch.charCodeAt(0));
    if (!g2) continue;
    width += g2.width;
    drawn += 1;
  }
  return width + Math.max(0, drawn - 1) * font.charSpacing;
}
function drawText(surface, font, text, x, top, color) {
  let at = x;
  for (const ch of text) {
    const g2 = glyphOf(font, ch.charCodeAt(0));
    if (!g2) continue;
    surface.blitMono(g2.sprite, at, top, color);
    at += g2.width + font.charSpacing;
  }
  return at - font.charSpacing;
}
function drawTextCentred(surface, font, text, left, right, top, color) {
  const width = textWidth(font, text);
  drawText(surface, font, text, left + (right - left + 1 - width >> 1), top, color);
}

// src/pop/state.ts
function newChar() {
  return {
    frame: 0,
    x: 0,
    y: 0,
    direction: 0,
    curr_col: 0,
    curr_row: 0,
    action: 0,
    fall_x: 0,
    fall_y: 0,
    room: 0,
    repeat: 0,
    charid: 0,
    sword: 0,
    alive: 0,
    curr_seq: 0
  };
}
function copyChar(to, from) {
  to.frame = from.frame;
  to.x = from.x;
  to.y = from.y;
  to.direction = from.direction;
  to.curr_col = from.curr_col;
  to.curr_row = from.curr_row;
  to.action = from.action;
  to.fall_x = from.fall_x;
  to.fall_y = from.fall_y;
  to.room = from.room;
  to.repeat = from.repeat;
  to.charid = from.charid;
  to.sword = from.sword;
  to.alive = from.alive;
  to.curr_seq = from.curr_seq;
}
var TABLES = 5;
var Globals = class {
  // -------------------------------------------------------- characters
  Char = newChar();
  Opp = newChar();
  Kid = newChar();
  Guard = newChar();
  cur_frame = { image: 0, sword: 0, dx: 0, dy: 0, flags: 0 };
  // -------------------------------------------------------- the level
  level;
  current_level = 0;
  next_level = 0;
  start_level = 0;
  is_restart_level = 0;
  checkpoint = 0;
  hitp_beg_lev = 0;
  /** The room the screen is showing, which need not be the Prince's. */
  drawn_room = 0;
  next_room = 0;
  loaded_room = 0;
  room_L = 0;
  room_R = 0;
  room_A = 0;
  room_B = 0;
  room_AL = 0;
  room_AR = 0;
  room_BL = 0;
  room_BR = 0;
  curr_room_tiles;
  curr_room_modif;
  leftroom_ = [0, 1, 2].map(() => ({ tiletype: 0, modifier: 0 }));
  row_below_left_ = Array.from({ length: 10 }, () => ({ tiletype: 0, modifier: 0 }));
  // -------------------------------------------------------- the tile just read
  curr_tile = 0;
  curr_tile2 = 0;
  curr_modifier = 0;
  curr_tilepos = 0;
  curr_room = 0;
  tile_col = 0;
  tile_row = 0;
  tile_left = 0;
  modifier_left = 0;
  // -------------------------------------------------------- the character's box
  char_x_left = 0;
  char_x_left_coll = 0;
  char_x_right = 0;
  char_x_right_coll = 0;
  char_top_y = 0;
  char_top_row = 0;
  char_bottom_row = 0;
  char_col_left = 0;
  char_col_right = 0;
  char_width_half = 0;
  char_height = 0;
  prev_char_top_row = 0;
  prev_char_col_right = 0;
  prev_char_col_left = 0;
  // -------------------------------------------------------- collisions
  prev_coll_room = new Int8Array(10).fill(-1);
  prev_coll_flags = new Uint8Array(10);
  curr_row_coll_room = new Int8Array(10).fill(-1);
  curr_row_coll_flags = new Uint8Array(10);
  below_row_coll_room = new Int8Array(10).fill(-1);
  below_row_coll_flags = new Uint8Array(10);
  above_row_coll_room = new Int8Array(10).fill(-1);
  above_row_coll_flags = new Uint8Array(10);
  prev_collision_row = -1;
  bump_col_left_of_wall = 0;
  bump_col_right_of_wall = 0;
  coll_tile_left_xpos = 0;
  // -------------------------------------------------------- the object table
  obj_direction = 0;
  obj_chtab = 0;
  obj_id = 0;
  obj_x = 0;
  obj_xh = 0;
  obj_xl = 0;
  obj_y = 0;
  obj_tilepos = 0;
  obj_clip_left = 0;
  obj_clip_top = 0;
  obj_clip_right = 0;
  obj_clip_bottom = 0;
  obj2_clip_left = 0;
  obj2_clip_top = 0;
  obj2_clip_right = 0;
  obj2_clip_bottom = 0;
  objtable = [];
  objtable_count = 0;
  // -------------------------------------------------------- the draw tables
  backtable = [];
  foretable = [];
  midtable = [];
  table_counts = new Int16Array(TABLES);
  wipetable = [];
  wipetable_count = 0;
  /** Which of `backtable` and `foretable` `ptr_add_table` points at. */
  ptr_add_table = "back";
  draw_xh = 0;
  draw_main_y = 0;
  draw_bottom_y = 0;
  drawn_row = 0;
  drawn_col = 0;
  draw_mode = 0;
  leveldoor_open = 0;
  leveldoor_right = 0;
  leveldoor_ybottom = 0;
  // -------------------------------------------------------- redraw flags
  redraw_frames_full = new Uint8Array(30);
  redraw_frames2 = new Uint8Array(30);
  redraw_frames_anim = new Uint8Array(30);
  redraw_frames_floor_overlay = new Uint8Array(30);
  redraw_frames_above = new Uint8Array(10);
  redraw_frames_fore = new Uint8Array(30);
  wipe_frames = new Uint8Array(30);
  wipe_heights = new Uint8Array(30);
  tile_object_redraw = new Uint8Array(30);
  redraw_height = 0;
  need_full_redraw = 0;
  // -------------------------------------------------------- tiles that move
  trobs = [];
  trobs_count = 0;
  trob = { tilepos: 0, room: 0, type: 0 };
  mobs = [];
  mobs_count = 0;
  curmob = { xh: 0, y: 0, room: 0, speed: 0, type: 0, row: 0 };
  // -------------------------------------------------------- the player
  control_x = 0;
  control_y = 0;
  control_shift = 0;
  control_forward = 0;
  control_backward = 0;
  control_up = 0;
  control_down = 0;
  control_shift2 = 0;
  ctrl1_forward = 0;
  ctrl1_backward = 0;
  ctrl1_up = 0;
  ctrl1_down = 0;
  ctrl1_shift2 = 0;
  is_paused = 0;
  // -------------------------------------------------------- hit points
  hitp_curr = 0;
  hitp_max = 0;
  hitp_delta = 0;
  guardhp_curr = 0;
  guardhp_max = 0;
  guardhp_delta = 0;
  flash_color = 0;
  flash_time = 0;
  resurrect_time = 0;
  // -------------------------------------------------------- the fight
  guard_skill = 0;
  guard_refrac = 0;
  justblocked = 0;
  kid_sword_strike = 0;
  can_guard_see_kid = 0;
  holding_sword = 0;
  offguard = 0;
  have_sword = 0;
  united_with_shadow = 0;
  guard_notice_timer = 0;
  is_guard_notice = 0;
  guard_refrac_timer = 0;
  // -------------------------------------------------------- odds and ends
  is_screaming = 0;
  is_feather_fall = 0;
  knock = 0;
  exit_room_timer = 0;
  roomleave_result = 0;
  pickup_obj_type = 0;
  jumped_through_mirror = 0;
  grab_timer = 0;
  rem_min = 0;
  rem_tick = 0;
  // ------------------------------------------------ the strip of words
  /** `text_time_remaining`, `text_time_total`: how long a message stays. */
  text_time_remaining = 0;
  text_time_total = 0;
  /** `is_show_time`: the clock has something to say. */
  is_show_time = 0;
  /** `seamless`: level 12's running exit, which shows no level number. */
  seamless = 0;
  /** `current_sound`: which sound is playing, or -1. */
  current_sound = -1;
  random_seed = 0;
  upside_down = 0;
  need_level1_music = 0;
  is_blind_mode = 0;
  torch_colors = [];
  palace_wall_colors = new Uint8Array(44 * 3);
  demo_index = 0;
  demo_time = 0;
  /** `shadow_initialized`: level 12's shadow has been put in the room. */
  shadow_initialized = 0;
  /** `chtab_addrs`: the sprite banks, filled in by the loader. */
  chtab_addrs = Array.from({ length: 10 }, () => null);
  tile_table = [];
};
var g = new Globals();
var byteOf = (v) => v & 255;
var sbyteOf = (v) => (v & 255) << 24 >> 24;
var wordOf = (v) => v & 65535;

// src/pop/types.ts
var tiles = {
  tiles_0_empty: 0,
  tiles_1_floor: 1,
  tiles_2_spike: 2,
  tiles_3_pillar: 3,
  tiles_4_gate: 4,
  tiles_5_stuck: 5,
  tiles_6_closer: 6,
  tiles_7_doortop_with_floor: 7,
  tiles_8_bigpillar_bottom: 8,
  tiles_9_bigpillar_top: 9,
  tiles_10_potion: 10,
  tiles_11_loose: 11,
  tiles_12_doortop: 12,
  tiles_13_mirror: 13,
  tiles_14_debris: 14,
  tiles_15_opener: 15,
  tiles_16_level_door_left: 16,
  tiles_17_level_door_right: 17,
  tiles_18_chomper: 18,
  tiles_19_torch: 19,
  tiles_20_wall: 20,
  tiles_21_skeleton: 21,
  tiles_22_sword: 22,
  tiles_23_balcony_left: 23,
  tiles_24_balcony_right: 24,
  tiles_25_lattice_pillar: 25,
  tiles_26_lattice_down: 26,
  tiles_27_lattice_small: 27,
  tiles_28_lattice_left: 28,
  tiles_29_lattice_right: 29,
  tiles_30_torch_with_debris: 30
};
var chtabs = {
  id_chtab_0_sword: 0,
  id_chtab_1_flameswordpotion: 1,
  id_chtab_2_kid: 2,
  id_chtab_3_princessinstory: 3,
  id_chtab_4_jaffarinstory_princessincutscenes: 4,
  id_chtab_5_guard: 5,
  id_chtab_6_environment: 6,
  id_chtab_7_environmentwall: 7,
  id_chtab_8_princessroom: 8,
  id_chtab_9_princessbed: 9
};
var blitters = {
  blitters_0_no_transp: 0,
  blitters_2_or: 2,
  blitters_3_xor: 3,
  blitters_white: 8,
  blitters_9_black: 9,
  blitters_10h_transp: 16,
  blitters_40h_mono: 64,
  blitters_46h_mono_6: 70,
  blitters_4Ch_mono_12: 76
};
var charids = {
  charid_0_kid: 0,
  charid_1_shadow: 1,
  charid_2_guard: 2,
  charid_3: 3,
  charid_4_skeleton: 4,
  charid_5_princess: 5,
  charid_6_vizier: 6,
  charid_24_mouse: 24
};
var sword_status = {
  sword_0_sheathed: 0,
  sword_2_drawn: 2
};
var frame_flags = {
  FRAME_WEIGHT_X: 31,
  FRAME_THIN: 32,
  FRAME_NEEDS_FLOOR: 64,
  FRAME_EVEN_ODD_PIXEL: 128
};
var directions = {
  dir_0_right: 0,
  dir_56_none: 86,
  dir_FF_left: -1
};
var actions = {
  actions_0_stand: 0,
  actions_1_run_jump: 1,
  actions_2_hang_climb: 2,
  actions_3_in_midair: 3,
  actions_4_in_freefall: 4,
  actions_5_bumped: 5,
  actions_6_hang_straight: 6,
  actions_7_turn: 7,
  actions_99_hurt: 99
};
var frameids = {
  frame_0: 0,
  frame_1_start_run: 1,
  frame_2_start_run: 2,
  frame_3_start_run: 3,
  frame_4_start_run: 4,
  frame_5_start_run: 5,
  frame_6_start_run: 6,
  frame_7_run: 7,
  frame_8_run: 8,
  frame_9_run: 9,
  frame_10_run: 10,
  frame_11_run: 11,
  frame_12_run: 12,
  frame_13_run: 13,
  frame_14_run: 14,
  frame_15_stand: 15,
  frame_16_standing_jump_1: 16,
  frame_17_standing_jump_2: 17,
  frame_18_standing_jump_3: 18,
  frame_19_standing_jump_4: 19,
  frame_20_standing_jump_5: 20,
  frame_21_standing_jump_6: 21,
  frame_22_standing_jump_7: 22,
  frame_23_standing_jump_8: 23,
  frame_24_standing_jump_9: 24,
  frame_25_standing_jump_10: 25,
  frame_26_standing_jump_11: 26,
  frame_27_standing_jump_12: 27,
  frame_28_standing_jump_13: 28,
  frame_29_standing_jump_14: 29,
  frame_30_standing_jump_15: 30,
  frame_31_standing_jump_16: 31,
  frame_32_standing_jump_17: 32,
  frame_33_standing_jump_18: 33,
  frame_34_start_run_jump_1: 34,
  frame_35_start_run_jump_2: 35,
  frame_36_start_run_jump_3: 36,
  frame_37_start_run_jump_4: 37,
  frame_38_start_run_jump_5: 38,
  frame_39_start_run_jump_6: 39,
  frame_40_running_jump_1: 40,
  frame_41_running_jump_2: 41,
  frame_42_running_jump_3: 42,
  frame_43_running_jump_4: 43,
  frame_44_running_jump_5: 44,
  frame_45_turn: 45,
  frame_46_turn: 46,
  frame_47_turn: 47,
  frame_48_turn: 48,
  frame_49_turn: 49,
  frame_50_turn: 50,
  frame_51_turn: 51,
  frame_52_turn: 52,
  frame_53_runturn: 53,
  frame_54_runturn: 54,
  frame_55_runturn: 55,
  frame_56_runturn: 56,
  frame_57_runturn: 57,
  frame_58_runturn: 58,
  frame_59_runturn: 59,
  frame_60_runturn: 60,
  frame_61_runturn: 61,
  frame_62_runturn: 62,
  frame_63_runturn: 63,
  frame_64_runturn: 64,
  frame_65_runturn: 65,
  frame_67_start_jump_up_1: 67,
  frame_68_start_jump_up_2: 68,
  frame_69_start_jump_up_3: 69,
  frame_70_jumphang: 70,
  frame_71_jumphang: 71,
  frame_72_jumphang: 72,
  frame_73_jumphang: 73,
  frame_74_jumphang: 74,
  frame_75_jumphang: 75,
  frame_76_jumphang: 76,
  frame_77_jumphang: 77,
  frame_78_jumphang: 78,
  frame_79_jumphang: 79,
  frame_80_jumphang: 80,
  frame_81_hangdrop_1: 81,
  frame_82_hangdrop_2: 82,
  frame_83_hangdrop_3: 83,
  frame_84_hangdrop_4: 84,
  frame_85_hangdrop_5: 85,
  frame_86_test_foot: 86,
  frame_87_hanging_1: 87,
  frame_88_hanging_2: 88,
  frame_89_hanging_3: 89,
  frame_90_hanging_4: 90,
  frame_91_hanging_5: 91,
  frame_92_hanging_6: 92,
  frame_93_hanging_7: 93,
  frame_94_hanging_8: 94,
  frame_95_hanging_9: 95,
  frame_96_hanging_10: 96,
  frame_97_hanging_11: 97,
  frame_98_hanging_12: 98,
  frame_99_hanging_13: 99,
  frame_102_start_fall_1: 102,
  frame_103_start_fall_2: 103,
  frame_104_start_fall_3: 104,
  frame_105_start_fall_4: 105,
  frame_106_fall: 106,
  frame_107_fall_land_1: 107,
  frame_108_fall_land_2: 108,
  frame_109_crouch: 109,
  frame_110_stand_up_from_crouch_1: 110,
  frame_111_stand_up_from_crouch_2: 111,
  frame_112_stand_up_from_crouch_3: 112,
  frame_113_stand_up_from_crouch_4: 113,
  frame_114_stand_up_from_crouch_5: 114,
  frame_115_stand_up_from_crouch_6: 115,
  frame_116_stand_up_from_crouch_7: 116,
  frame_117_stand_up_from_crouch_8: 117,
  frame_118_stand_up_from_crouch_9: 118,
  frame_119_stand_up_from_crouch_10: 119,
  frame_121_stepping_1: 121,
  frame_122_stepping_2: 122,
  frame_123_stepping_3: 123,
  frame_124_stepping_4: 124,
  frame_125_stepping_5: 125,
  frame_126_stepping_6: 126,
  frame_127_stepping_7: 127,
  frame_128_stepping_8: 128,
  frame_129_stepping_9: 129,
  frame_130_stepping_10: 130,
  frame_131_stepping_11: 131,
  frame_132_stepping_12: 132,
  frame_133_sheathe: 133,
  frame_134_sheathe: 134,
  frame_135_climbing_1: 135,
  frame_136_climbing_2: 136,
  frame_137_climbing_3: 137,
  frame_138_climbing_4: 138,
  frame_139_climbing_5: 139,
  frame_140_climbing_6: 140,
  frame_141_climbing_7: 141,
  frame_142_climbing_8: 142,
  frame_143_climbing_9: 143,
  frame_144_climbing_10: 144,
  frame_145_climbing_11: 145,
  frame_146_climbing_12: 146,
  frame_147_climbing_13: 147,
  frame_148_climbing_14: 148,
  frame_149_climbing_15: 149,
  frame_150_parry: 150,
  frame_151_strike_1: 151,
  frame_152_strike_2: 152,
  frame_153_strike_3: 153,
  frame_154_poking: 154,
  frame_155_guy_7: 155,
  frame_156_guy_8: 156,
  frame_157_walk_with_sword: 157,
  frame_158_stand_with_sword: 158,
  frame_159_fighting: 159,
  frame_160_fighting: 160,
  frame_161_parry: 161,
  frame_162_block_to_strike: 162,
  frame_163_fighting: 163,
  frame_164_fighting: 164,
  frame_165_walk_with_sword: 165,
  frame_166_stand_inactive: 166,
  frame_167_blocked: 167,
  frame_168_back: 168,
  frame_169_begin_block: 169,
  frame_170_stand_with_sword: 170,
  frame_171_stand_with_sword: 171,
  frame_172_jumpfall_2: 172,
  frame_173_jumpfall_3: 173,
  frame_174_jumpfall_4: 174,
  frame_175_jumpfall_5: 175,
  frame_177_spiked: 177,
  frame_178_chomped: 178,
  frame_179_collapse_1: 179,
  frame_180_collapse_2: 180,
  frame_181_collapse_3: 181,
  frame_182_collapse_4: 182,
  frame_183_collapse_5: 183,
  frame_185_dead: 185,
  frame_186_mouse_1: 186,
  frame_187_mouse_2: 187,
  frame_188_mouse_stand: 188,
  frame_191_drink: 191,
  frame_192_drink: 192,
  frame_193_drink: 193,
  frame_194_drink: 194,
  frame_195_drink: 195,
  frame_196_drink: 196,
  frame_197_drink: 197,
  frame_198_drink: 198,
  frame_199_drink: 199,
  frame_200_drink: 200,
  frame_201_drink: 201,
  frame_202_drink: 202,
  frame_203_drink: 203,
  frame_204_drink: 204,
  frame_205_drink: 205,
  frame_207_draw_1: 207,
  frame_208_draw_2: 208,
  frame_209_draw_3: 209,
  frame_210_draw_4: 210,
  frame_217_exit_stairs_1: 217,
  frame_218_exit_stairs_2: 218,
  frame_219_exit_stairs_3: 219,
  frame_220_exit_stairs_4: 220,
  frame_221_exit_stairs_5: 221,
  frame_222_exit_stairs_6: 222,
  frame_223_exit_stairs_7: 223,
  frame_224_exit_stairs_8: 224,
  frame_225_exit_stairs_9: 225,
  frame_226_exit_stairs_10: 226,
  frame_227_exit_stairs_11: 227,
  frame_228_exit_stairs_12: 228,
  frame_229_found_sword: 229,
  frame_230_sheathe: 230,
  frame_231_sheathe: 231,
  frame_232_sheathe: 232,
  frame_233_sheathe: 233,
  frame_234_sheathe: 234,
  frame_235_sheathe: 235,
  frame_236_sheathe: 236,
  frame_237_sheathe: 237,
  frame_238_sheathe: 238,
  frame_239_sheathe: 239,
  frame_240_sheathe: 240
};
var seqids = {
  seq_1_start_run: 1,
  seq_2_stand: 2,
  seq_3_standing_jump: 3,
  seq_4_run_jump: 4,
  seq_5_turn: 5,
  seq_6_run_turn: 6,
  seq_7_fall: 7,
  seq_8_jump_up_and_grab_straight: 8,
  seq_9_grab_while_jumping: 9,
  seq_10_climb_up: 10,
  seq_11_release_ledge_and_land: 11,
  seq_13_stop_run: 13,
  seq_14_jump_up_into_ceiling: 14,
  seq_15_grab_ledge_midair: 15,
  seq_16_jump_up_and_grab: 16,
  seq_17_soft_land: 17,
  seq_18_fall_after_standing_jump: 18,
  seq_19_fall: 19,
  seq_20_medium_land: 20,
  seq_21_fall_after_running_jump: 21,
  seq_22_crushed: 22,
  seq_23_release_ledge_and_fall: 23,
  seq_24_jump_up_and_grab_forward: 24,
  seq_25_hang_against_wall: 25,
  seq_26_crouch_while_running: 26,
  seq_28_jump_up_with_nothing_above: 28,
  seq_29_safe_step_1: 29,
  seq_30_safe_step_2: 30,
  seq_31_safe_step_3: 31,
  seq_32_safe_step_4: 32,
  seq_33_safe_step_5: 33,
  seq_34_safe_step_6: 34,
  seq_35_safe_step_7: 35,
  seq_36_safe_step_8: 36,
  seq_37_safe_step_9: 37,
  seq_38_safe_step_10: 38,
  seq_39_safe_step_11: 39,
  seq_40_safe_step_12: 40,
  seq_41_safe_step_13: 41,
  seq_42_safe_step_14: 42,
  seq_43_start_run_after_turn: 43,
  seq_44_step_on_edge: 44,
  seq_45_bumpfall: 45,
  seq_46_hardbump: 46,
  seq_47_bump: 47,
  seq_49_stand_up_from_crouch: 49,
  seq_50_crouch: 50,
  seq_51_spiked: 51,
  seq_52_loose_floor_fell_on_kid: 52,
  seq_54_chomped: 54,
  seq_55_draw_sword: 55,
  seq_56_guard_forward_with_sword: 56,
  seq_57_back_with_sword: 57,
  seq_58_guard_strike: 58,
  seq_60_turn_with_sword: 60,
  seq_61_parry_after_strike: 61,
  seq_62_parry: 62,
  seq_63_guard_active_after_fall: 63,
  seq_64_pushed_back_with_sword: 64,
  seq_65_bump_forward_with_sword: 65,
  seq_66_strike_after_parry: 66,
  seq_68_climb_down: 68,
  seq_69_attack_was_parried: 69,
  seq_70_go_up_on_level_door: 70,
  seq_71_dying: 71,
  seq_73_climb_up_to_closed_gate: 73,
  seq_74_hit_by_sword: 74,
  seq_75_strike: 75,
  seq_77_guard_stand_inactive: 77,
  seq_78_drink: 78,
  seq_79_crouch_hop: 79,
  seq_80_stand_flipped: 80,
  seq_81_kid_pushed_off_ledge: 81,
  seq_82_guard_pushed_off_ledge: 82,
  seq_83_guard_fall: 83,
  seq_84_run: 84,
  seq_85_stabbed_to_death: 85,
  seq_86_forward_with_sword: 86,
  seq_87_guard_become_inactive: 87,
  seq_88_skel_wake_up: 88,
  seq_89_turn_draw_sword: 89,
  seq_90_en_garde: 90,
  seq_91_get_sword: 91,
  seq_92_put_sword_away: 92,
  seq_93_put_sword_away_fast: 93,
  seq_94_princess_stand_PV1: 94,
  seq_95_Jaffar_stand_PV1: 95,
  seq_101_mouse_stands_up: 101,
  seq_103_princess_lying_PV2: 103,
  seq_104_start_fall_in_front_of_wall: 104,
  seq_105_mouse_forward: 105,
  seq_106_mouse: 106,
  seq_107_mouse_stand_up_and_go: 107,
  seq_108_princess_turn_and_hug: 108,
  seq_109_princess_stand_PV2: 109,
  seq_110_princess_crouching_PV2: 110,
  seq_111_princess_stand_up_PV2: 111,
  seq_112_princess_crouch_down_PV2: 112,
  seq_114_mouse_stand: 114
};
var seqtbl_instructions = {
  SEQ_DX: 251,
  SEQ_DY: 250,
  SEQ_FLIP: 254,
  SEQ_JMP_IF_FEATHER: 247,
  SEQ_JMP: 255,
  SEQ_UP: 253,
  SEQ_DOWN: 252,
  SEQ_ACTION: 249,
  SEQ_SET_FALL: 248,
  SEQ_KNOCK_UP: 245,
  SEQ_KNOCK_DOWN: 244,
  SEQ_SOUND: 242,
  SEQ_END_LEVEL: 241,
  SEQ_GET_ITEM: 243,
  SEQ_DIE: 246
};
var seqtbl_sounds = {
  SND_SILENT: 0,
  SND_FOOTSTEP: 1,
  SND_BUMP: 2,
  SND_DRINK: 3,
  SND_LEVEL: 4
};
var soundids = {
  sound_0_fell_to_death: 0,
  sound_1_falling: 1,
  sound_2_tile_crashing: 2,
  sound_3_button_pressed: 3,
  sound_4_gate_closing: 4,
  sound_5_gate_opening: 5,
  sound_6_gate_closing_fast: 6,
  sound_7_gate_stop: 7,
  sound_8_bumped: 8,
  sound_9_grab: 9,
  sound_10_sword_vs_sword: 10,
  sound_11_sword_moving: 11,
  sound_12_guard_hurt: 12,
  sound_13_kid_hurt: 13,
  sound_14_leveldoor_closing: 14,
  sound_15_leveldoor_sliding: 15,
  sound_16_medium_land: 16,
  sound_17_soft_land: 17,
  sound_18_drink: 18,
  sound_19_draw_sword: 19,
  sound_20_loose_shake_1: 20,
  sound_21_loose_shake_2: 21,
  sound_22_loose_shake_3: 22,
  sound_23_footstep: 23,
  sound_24_death_regular: 24,
  sound_25_presentation: 25,
  sound_26_embrace: 26,
  sound_27_cutscene_2_4_6_12: 27,
  sound_28_death_in_fight: 28,
  sound_29_meet_Jaffar: 29,
  sound_30_big_potion: 30,
  sound_32_shadow_music: 32,
  sound_33_small_potion: 33,
  sound_35_cutscene_8_9: 35,
  sound_36_out_of_time: 36,
  sound_37_victory: 37,
  sound_38_blink: 38,
  sound_39_low_weight: 39,
  sound_40_cutscene_12_short_time: 40,
  sound_41_end_level_music: 41,
  sound_43_victory_Jaffar: 43,
  sound_44_skel_alive: 44,
  sound_45_jump_through_mirror: 45,
  sound_46_chomped: 46,
  sound_47_chomper: 47,
  sound_48_spiked: 48,
  sound_49_spikes: 49,
  sound_50_story_2_princess: 50,
  sound_51_princess_door_opening: 51,
  sound_52_story_4_Jaffar_leaves: 52,
  sound_53_story_3_Jaffar_comes: 53,
  sound_54_intro_music: 54,
  sound_55_story_1_absence: 55,
  sound_56_ending_music: 56
};

// src/pop/data.ts
var tbl_line = [0, 10, 20];
var chtab_flip_clip = [1, 0, 1, 1, 1, 1, 0, 0, 0, 0];
var y_land = [-8, 55, 118, 181, 244];
var x_bump = [-12, 2, 16, 30, 44, 58, 72, 86, 100, 114, 128, 142, 156, 170, 184, 198, 212, 226, 240, 254];
var y_clip = [-60, 3, 66, 129, 192];
var dir_front = [-1, 1];
var dir_behind = [1, -1];
var tile_div_tbl = [-5, -5, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -4, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 13, 14, 14];
var tile_mod_tbl = [12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 1];
var col_xh = [0, 4, 8, 12, 16, 20, 24, 28, 32, 36];
var doortop_fram_top = [0, 81, 83, 0];
var door_fram_top = [60, 61, 62, 63, 64, 65, 66, 67];
var blueline_fram1 = [0, 124, 125, 126];
var blueline_fram_y = [0, -20, -20, 0];
var blueline_fram3 = [44, 44, 45, 45];
var doortop_fram_bot = [78, 80, 82, 0];
var spikes_fram_right = [0, 134, 135, 136, 137, 138, 137, 135, 134, 0];
var loose_fram_right = [42, 71, 42, 72, 72, 42, 42, 42, 72, 72, 72, 0];
var wall_fram_bottom = [7, 9, 5, 3];
var loose_fram_bottom = [43, 73, 43, 74, 74, 43, 43, 43, 74, 74, 74, 0];
var loose_fram_left = [41, 69, 41, 70, 70, 41, 41, 41, 70, 70, 70, 0];
var spikes_fram_left = [0, 128, 129, 130, 131, 132, 131, 129, 128, 0];
var potion_fram_bubb = [0, 16, 17, 18, 19, 20, 21, 22];
var chomper_fram1 = [3, 2, 0, 1, 4, 3, 3, 0];
var chomper_fram_bot = [101, 102, 103, 104, 105, 0];
var chomper_fram_top = [0, 0, 111, 112, 113, 0];
var chomper_fram_y = [0, 0, 37, 47, 50];
var spikes_fram_fore = [0, 139, 140, 141, 142, 143, 142, 140, 139, 0];
var chomper_fram_for = [106, 107, 108, 109, 110, 0];
var wall_fram_main = [8, 10, 6, 4];
var door_fram_slice = [67, 59, 58, 57, 56, 55, 54, 53, 52];
var floor_left_overlay = [32, 151, 151, 150, 150, 151, 32, 32];
var gate_close_speeds = [0, 0, 0, 20, 40, 60, 80, 100, 120];
var door_delta = [-1, 4, 4];
var leveldoor_close_speeds = [0, 5, 17, 99, 0];
var y_loose_land = [2, 65, 128, 191, 254];
var loose_sound = [0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0];
var y_something = [-1, 62, 125, 188, 25];
var strikeprob = [61, 100, 61, 61, 61, 40, 100, 220, 0, 48, 32, 48];
var restrikeprob = [0, 0, 0, 5, 5, 175, 16, 8, 0, 255, 255, 150];
var blockprob = [0, 150, 150, 200, 200, 255, 200, 250, 0, 255, 255, 255];
var impblockprob = [0, 61, 61, 100, 100, 145, 100, 250, 0, 145, 255, 175];
var advprob = [255, 200, 200, 200, 255, 255, 200, 0, 0, 255, 100, 100];
var refractimer = [16, 16, 16, 16, 8, 8, 8, 8, 0, 8, 0, 0];
var extrastrength = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
var tile_table = [
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 0, bottom_id: 0, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 127, floor_left: 1, base_y: 0, right_id: 133, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 92, floor_left: 1, base_y: 0, right_id: 93, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 94, bottom_id: 43, fore_id: 95, fore_x: 1, fore_y: 0 },
  { base_id: 46, floor_left: 1, base_y: 0, right_id: 47, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 48, bottom_id: 43, fore_id: 49, fore_x: 3, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 1, right_id: 35, floor_right: 1, right_y: 3, stripe_id: 145, topright_id: 0, bottom_id: 36, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 96, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 46, floor_left: 1, base_y: 0, right_id: 0, floor_right: 0, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 49, fore_x: 3, fore_y: 0 },
  { base_id: 86, floor_left: 1, base_y: 0, right_id: 87, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 88, fore_x: 1, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 89, floor_right: 0, right_y: 3, stripe_id: 0, topright_id: 90, bottom_id: 0, fore_id: 91, fore_x: 1, fore_y: 3 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 12, fore_x: 2, fore_y: -3 },
  { base_id: 0, floor_left: 1, base_y: 0, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 145, topright_id: 0, bottom_id: 0, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 0, floor_right: 0, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 85, fore_id: 49, fore_x: 3, fore_y: 0 },
  { base_id: 75, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 77, fore_x: 0, fore_y: 0 },
  { base_id: 97, floor_left: 1, base_y: 0, right_id: 98, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 100, fore_x: 0, fore_y: 0 },
  { base_id: 147, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 1, stripe_id: 145, topright_id: 0, bottom_id: 149, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 37, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 38, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 39, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 40, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 1, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 2, bottom_id: 0, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 30, floor_left: 1, base_y: 0, right_id: 31, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 41, floor_left: 1, base_y: 0, right_id: 10, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 11, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 0, floor_left: 0, base_y: 0, right_id: 12, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 13, bottom_id: 43, fore_id: 0, fore_x: 0, fore_y: 0 },
  { base_id: 92, floor_left: 1, base_y: 0, right_id: 42, floor_right: 1, right_y: 2, stripe_id: 145, topright_id: 0, bottom_id: 43, fore_id: 95, fore_x: 1, fore_y: 0 },
  { base_id: 1, floor_left: 0, base_y: 0, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 0, bottom_id: 2, fore_id: 9, fore_x: 0, fore_y: -53 },
  { base_id: 3, floor_left: 0, base_y: -10, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 0, bottom_id: 0, fore_id: 9, fore_x: 0, fore_y: -53 },
  { base_id: 4, floor_left: 0, base_y: -10, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 0, bottom_id: 0, fore_id: 9, fore_x: 0, fore_y: -53 },
  { base_id: 5, floor_left: 0, base_y: -10, right_id: 0, floor_right: 0, right_y: 0, stripe_id: 0, topright_id: 0, bottom_id: 0, fore_id: 9, fore_x: 0, fore_y: -53 },
  { base_id: 97, floor_left: 1, base_y: 0, right_id: 98, floor_right: 1, right_y: 2, stripe_id: 0, topright_id: 0, bottom_id: 43, fore_id: 100, fore_x: 0, fore_y: 0 }
];
var sword_tbl = [
  { id: 255, x: 0, y: 0 },
  { id: 0, x: 0, y: -9 },
  { id: 5, x: -9, y: -29 },
  { id: 1, x: 7, y: -25 },
  { id: 2, x: 17, y: -26 },
  { id: 6, x: 7, y: -14 },
  { id: 7, x: 0, y: -5 },
  { id: 3, x: 17, y: -16 },
  { id: 4, x: 16, y: -19 },
  { id: 30, x: 12, y: -9 },
  { id: 8, x: 13, y: -34 },
  { id: 9, x: 7, y: -25 },
  { id: 10, x: 10, y: -16 },
  { id: 11, x: 10, y: -11 },
  { id: 12, x: 22, y: -21 },
  { id: 13, x: 28, y: -23 },
  { id: 14, x: 13, y: -35 },
  { id: 15, x: 0, y: -38 },
  { id: 16, x: 0, y: -29 },
  { id: 17, x: 21, y: -19 },
  { id: 18, x: 14, y: -23 },
  { id: 19, x: 21, y: -22 },
  { id: 19, x: 22, y: -23 },
  { id: 17, x: 7, y: -13 },
  { id: 17, x: 15, y: -18 },
  { id: 7, x: 0, y: -8 },
  { id: 1, x: 7, y: -27 },
  { id: 28, x: 14, y: -28 },
  { id: 8, x: 7, y: -27 },
  { id: 4, x: 6, y: -23 },
  { id: 4, x: 9, y: -21 },
  { id: 10, x: 11, y: -18 },
  { id: 13, x: 24, y: -23 },
  { id: 13, x: 19, y: -23 },
  { id: 13, x: 21, y: -23 },
  { id: 20, x: 7, y: -32 },
  { id: 21, x: 14, y: -32 },
  { id: 22, x: 14, y: -31 },
  { id: 23, x: 14, y: -29 },
  { id: 24, x: 28, y: -28 },
  { id: 25, x: 28, y: -28 },
  { id: 26, x: 21, y: -25 },
  { id: 27, x: 14, y: -22 },
  { id: 255, x: 14, y: -25 },
  { id: 255, x: 21, y: -25 },
  { id: 29, x: 0, y: -16 },
  { id: 8, x: 8, y: -37 },
  { id: 31, x: 14, y: -24 },
  { id: 32, x: 14, y: -24 },
  { id: 33, x: 7, y: -14 },
  { id: 8, x: 8, y: -37 }
];

// src/pop/link.ts
function missing(name) {
  throw new Error(`${name} has not been linked in`);
}
function slot(name) {
  return { fn: (() => missing(name)) };
}
var l7 = {
  start_chompers: slot("start_chompers"),
  make_loose_fall: slot("make_loose_fall"),
  trigger_button: slot("trigger_button"),
  is_spike_harmful: slot("is_spike_harmful"),
  start_anim_spike: slot("start_anim_spike")
};
var l8 = {
  set_wipe: slot("set_wipe"),
  set_redraw_full: slot("set_redraw_full"),
  set_redraw_fore: slot("set_redraw_fore"),
  set_redraw2: slot("set_redraw2"),
  set_redraw_floor_overlay: slot("set_redraw_floor_overlay"),
  set_redraw_anim: slot("set_redraw_anim"),
  get_room_address: slot("get_room_address"),
  add_objtable: slot("add_objtable"),
  mark_obj_tile_redraw: slot("mark_obj_tile_redraw")
};
var l5 = {
  do_fall: slot("do_fall"),
  spiked: slot("spiked"),
  control: slot("control"),
  seqtbl_offset_char: slot("seqtbl_offset_char")
};
var l6 = {
  control_guard_inactive: slot("control_guard_inactive")
};
var l2 = {
  autocontrol_opponent: slot("autocontrol_opponent"),
  clear_char: slot("clear_char"),
  died_on_button: slot("died_on_button"),
  set_start_pos: slot("set_start_pos"),
  on_guard_killed: slot("on_guard_killed"),
  inc_curr_row: slot("inc_curr_row")
};
var out = {
  play_sound: (_which) => {
  },
  stop_sounds: () => {
  },
  check_sound_playing: () => 0,
  display_text_bottom: (_text) => {
  },
  erase_bottom_text: (_arg) => {
  },
  /** `play_death_music`, which `play_kid` then waits out. */
  play_death_music: () => {
  }
};

// src/pop/seg006.ts
var TILE_SIZEY = 63;
var TILE_RIGHTX = 13;
var FALLING_SPEED_ACCEL2 = 3;
var FALLING_SPEED_MAX2 = 33;
var CONTROL_HELD = -1;
var CONTROL_RELEASED = 0;
var CONTROL_IGNORE = 1;
var CONTROL_HELD_FORWARD = -1;
var CONTROL_HELD_BACKWARD = 1;
var CONTROL_HELD_UP = -1;
var CONTROL_HELD_DOWN = 1;
var obj_xl = 0;
var infrontx = 0;
var through_tile = 0;
function setThroughTile(v) {
  through_tile = v;
}
var fall_frame = 0;
var droppedout = 0;
function setDroppedout(v) {
  droppedout = v;
}
var frame_table_kid = [];
var frame_tbl_guard = [];
var frame_tbl_cuts = [];
var seqtbl = new Uint8Array(0);
var seqtbl_offsets = [];
function setFrameTables(kid, guard, cuts, table, offsets) {
  frame_table_kid = kid;
  frame_tbl_guard = guard;
  frame_tbl_cuts = cuts;
  seqtbl = table;
  seqtbl_offsets = offsets;
}
function seqByte(at) {
  return seqtbl[at - SEQTBL_BASE] ?? 0;
}
var SEQTBL_BASE = 6510;
function seqOffset(index) {
  return seqtbl_offsets[index] ?? 0;
}
function get_tile(room, col, row) {
  g.curr_room = room;
  g.tile_col = col;
  g.tile_row = row;
  g.curr_room = find_room_of_tile();
  if (g.curr_room > 0) {
    l8.get_room_address.fn(g.curr_room);
    g.curr_tilepos = tbl_line[g.tile_row] + g.tile_col;
    g.curr_tile2 = g.curr_room_tiles[g.curr_tilepos] & 31;
  } else {
    g.curr_tile2 = tiles.tiles_20_wall;
  }
  return g.curr_tile2;
}
function find_room_of_tile() {
  const linksOf = (room) => room >= 1 && room <= 24 ? g.level.roomlinks[room - 1] : { left: 0, right: 0, up: 0, down: 0 };
  for (; ; ) {
    if (g.tile_col < 0) {
      g.tile_col += 10;
      if (g.curr_room) g.curr_room = linksOf(g.curr_room).left;
      continue;
    }
    if (g.tile_col >= 10) {
      g.tile_col -= 10;
      if (g.curr_room) g.curr_room = linksOf(g.curr_room).right;
      continue;
    }
    if (g.tile_row < 0) {
      g.tile_row += 3;
      if (g.curr_room) g.curr_room = linksOf(g.curr_room).up;
      continue;
    }
    if (g.tile_row >= 3) {
      g.tile_row -= 3;
      if (g.curr_room) g.curr_room = linksOf(g.curr_room).down;
      continue;
    }
    return g.curr_room;
  }
}
function get_tilepos(tile_col, tile_row) {
  if (tile_row < 0) return -(tile_col + 1);
  if (tile_row >= 3 || tile_col >= 10 || tile_col < 0) return 30;
  return tbl_line[tile_row] + tile_col;
}
function get_tilepos_nominus(tile_col, tile_row) {
  const tilepos = get_tilepos(tile_col, tile_row);
  return tilepos < 0 ? 30 : tilepos;
}
function load_fram_det_col() {
  load_frame();
  determine_col();
}
function determine_col() {
  g.Char.curr_col = get_tile_div_mod_m7(dx_weight());
}
var BLANK_FRAME = { image: 255, sword: 0, dx: 0, dy: 0, flags: 0 };
function get_frame(table, frame) {
  const f = frame >= 0 && frame < table.length ? table[frame] : BLANK_FRAME;
  g.cur_frame = { image: f.image, sword: f.sword, dx: f.dx, dy: f.dy, flags: f.flags };
}
function load_frame() {
  const frame = g.Char.frame;
  let add_frame = 0;
  switch (g.Char.charid) {
    case charids.charid_0_kid:
    case charids.charid_24_mouse:
      get_frame(frame_table_kid, frame);
      break;
    case charids.charid_2_guard:
    case charids.charid_4_skeleton:
      if (frame >= 102 && frame < 107) add_frame = 70;
      get_frame(frame_tbl_guard, frame + add_frame - 149);
      break;
    case charids.charid_1_shadow:
      if (frame < 150 || frame >= 190) get_frame(frame_table_kid, frame);
      else get_frame(frame_tbl_guard, frame - 149);
      break;
    case charids.charid_5_princess:
    case charids.charid_6_vizier:
      get_frame(frame_tbl_cuts, frame);
      break;
    default:
      get_frame(frame_table_kid, frame);
      break;
  }
}
function dx_weight() {
  const offset = sbyteOf(g.cur_frame.dx - (g.cur_frame.flags & frame_flags.FRAME_WEIGHT_X));
  return char_dx_forward(offset);
}
function char_dx_forward(delta_x) {
  if (g.Char.direction < directions.dir_0_right) delta_x = -delta_x;
  return delta_x + g.Char.x;
}
function obj_dx_forward(delta_x) {
  if (g.obj_direction < directions.dir_0_right) delta_x = -delta_x;
  g.obj_x += delta_x;
  return g.obj_x;
}
function play_seq() {
  for (; ; ) {
    const command = seqByte(g.Char.curr_seq);
    g.Char.curr_seq++;
    switch (command) {
      case seqtbl_instructions.SEQ_DX:
        g.Char.x = byteOf(char_dx_forward(sbyteOf(seqByte(g.Char.curr_seq))));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_DY:
        g.Char.y = byteOf(g.Char.y + sbyteOf(seqByte(g.Char.curr_seq)));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_FLIP:
        g.Char.direction = ~g.Char.direction;
        break;
      case seqtbl_instructions.SEQ_JMP_IF_FEATHER:
        if (!g.is_feather_fall) {
          g.Char.curr_seq += 2;
          break;
        }
      // fallthrough
      case seqtbl_instructions.SEQ_JMP:
        g.Char.curr_seq = seqByte(g.Char.curr_seq) | seqByte(g.Char.curr_seq + 1) << 8;
        break;
      case seqtbl_instructions.SEQ_UP:
        --g.Char.curr_row;
        l7.start_chompers.fn();
        break;
      case seqtbl_instructions.SEQ_DOWN:
        l2.inc_curr_row.fn();
        l7.start_chompers.fn();
        break;
      case seqtbl_instructions.SEQ_ACTION:
        g.Char.action = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_SET_FALL:
        g.Char.fall_x = sbyteOf(seqByte(g.Char.curr_seq));
        g.Char.curr_seq++;
        g.Char.fall_y = sbyteOf(seqByte(g.Char.curr_seq));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_KNOCK_UP:
        g.knock = 1;
        break;
      case seqtbl_instructions.SEQ_KNOCK_DOWN:
        g.knock = -1;
        break;
      case seqtbl_instructions.SEQ_SOUND: {
        const which_sound = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        switch (which_sound) {
          case seqtbl_sounds.SND_SILENT:
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_FOOTSTEP:
            out.play_sound(soundids.sound_23_footstep);
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_BUMP:
            out.play_sound(soundids.sound_8_bumped);
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_DRINK:
            out.play_sound(soundids.sound_18_drink);
            break;
          case seqtbl_sounds.SND_LEVEL:
            if (g.current_level === 4) out.play_sound(soundids.sound_32_shadow_music);
            else if (g.current_level !== 13 && g.current_level !== 15) {
              out.play_sound(soundids.sound_41_end_level_music);
            }
            break;
          default:
            break;
        }
        break;
      }
      case seqtbl_instructions.SEQ_END_LEVEL:
        ++g.next_level;
        break;
      case seqtbl_instructions.SEQ_GET_ITEM: {
        const which_item = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        if (which_item === 1) proc_get_object();
        break;
      }
      case seqtbl_instructions.SEQ_DIE:
        break;
      default:
        g.Char.frame = command;
        return;
    }
  }
}
function get_tile_div_mod_m7(xpos) {
  return get_tile_div_mod(xpos - 7);
}
function get_tile_div_mod(xpos) {
  const i = xpos & 255;
  obj_xl = tile_mod_tbl[i];
  return tile_div_tbl[i];
}
function y_to_row_mod4(ypos) {
  return Math.trunc((ypos + 60) / TILE_SIZEY) % 4 - 1;
}
function loadkid() {
  copyChar(g.Char, g.Kid);
}
function savekid() {
  copyChar(g.Kid, g.Char);
}
function loadshad() {
  copyChar(g.Char, g.Guard);
}
function saveshad() {
  copyChar(g.Guard, g.Char);
}
function loadkid_and_opp() {
  loadkid();
  copyChar(g.Opp, g.Guard);
}
function savekid_and_opp() {
  savekid();
  copyChar(g.Guard, g.Opp);
}
function loadshad_and_opp() {
  loadshad();
  copyChar(g.Opp, g.Kid);
}
function saveshad_and_opp() {
  saveshad();
  copyChar(g.Kid, g.Opp);
}
function reset_obj_clip() {
  g.obj_clip_left = 0;
  g.obj_clip_top = 0;
  g.obj_clip_right = 320;
  g.obj_clip_bottom = 192;
}
function x_to_xh_and_xl(xpos) {
  if (xpos < 0) {
    return {
      xh: sbyteOf(-((Math.abs(-xpos) >> 3) + 1)),
      xl: sbyteOf(-((-xpos - 1) % 8 - 7))
    };
  }
  return { xh: sbyteOf(Math.abs(xpos) >> 3), xl: sbyteOf(xpos % 8) };
}
function fall_accel() {
  if (g.Char.action === actions.actions_4_in_freefall) {
    g.Char.fall_y += FALLING_SPEED_ACCEL2;
    if (g.Char.fall_y > FALLING_SPEED_MAX2) g.Char.fall_y = FALLING_SPEED_MAX2;
  }
}
function fall_speed() {
  g.Char.y = byteOf(g.Char.y + g.Char.fall_y);
  if (g.Char.action === actions.actions_4_in_freefall) {
    g.Char.x = byteOf(char_dx_forward(g.Char.fall_x));
    load_fram_det_col();
  }
}
function check_action() {
  const action = g.Char.action;
  const frame = g.Char.frame;
  if (action === actions.actions_6_hang_straight || action === actions.actions_5_bumped) {
    if (frame === frameids.frame_109_crouch) check_on_floor();
  } else if (action === actions.actions_4_in_freefall) {
    l5.do_fall.fn();
  } else if (action === actions.actions_3_in_midair) {
    if (frame >= frameids.frame_102_start_fall_1 && frame < frameids.frame_106_fall) {
      check_grab();
    }
  } else if (action !== actions.actions_2_hang_climb) {
    check_on_floor();
  }
}
function tile_is_floor(tiletype) {
  switch (tiletype) {
    case tiles.tiles_0_empty:
    case tiles.tiles_9_bigpillar_top:
    case tiles.tiles_12_doortop:
    case tiles.tiles_20_wall:
    case tiles.tiles_26_lattice_down:
    case tiles.tiles_27_lattice_small:
    case tiles.tiles_28_lattice_left:
    case tiles.tiles_29_lattice_right:
      return false;
    default:
      return true;
  }
}
function check_spiked() {
  const frame = g.Char.frame;
  if (get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row) === tiles.tiles_2_spike) {
    const harmful = l7.is_spike_harmful.fn();
    if (harmful >= 2 && (frame >= frameids.frame_7_run && frame < 15 || frame >= frameids.frame_34_start_run_jump_1 && frame < 40) || (frame === frameids.frame_43_running_jump_4 || frame === frameids.frame_26_standing_jump_11) && harmful !== 0) {
      l5.spiked.fn();
    }
  }
}
function take_hp(count) {
  let dead = 0;
  if (g.Char.charid === charids.charid_0_kid) {
    if (count >= g.hitp_curr) {
      g.hitp_delta = -g.hitp_curr;
      dead = 1;
    } else {
      g.hitp_delta = -count;
    }
  } else if (count >= g.guardhp_curr) {
    g.guardhp_delta = -g.guardhp_curr;
    dead = 1;
  } else {
    g.guardhp_delta = -count;
  }
  return dead;
}
function get_tile_at_char() {
  return get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row);
}
function set_char_collision() {
  const image = g.chtab_addrs[g.obj_chtab]?.[g.obj_id];
  if (!image) {
    g.char_width_half = 0;
    g.char_height = 0;
  } else {
    g.char_width_half = image.width + 1 >> 1;
    g.char_height = image.height;
  }
  g.char_x_left = Math.trunc(g.obj_x / 2) + 58;
  if (g.Char.direction >= directions.dir_0_right) {
    g.char_x_left -= g.char_width_half;
  }
  g.char_x_left_coll = g.char_x_left;
  g.char_x_right = g.char_x_left + g.char_width_half;
  g.char_x_right_coll = g.char_x_right;
  g.char_top_y = g.obj_y - g.char_height + 1;
  if (g.char_top_y >= 192) g.char_top_y = 0;
  g.char_top_row = y_to_row_mod4(g.char_top_y);
  g.char_bottom_row = y_to_row_mod4(g.obj_y);
  if (g.char_bottom_row === -1) g.char_bottom_row = 3;
  g.char_col_left = Math.max(get_tile_div_mod(g.char_x_left), 0);
  g.char_col_right = Math.min(get_tile_div_mod(g.char_x_right), 9);
  if (g.cur_frame.flags & frame_flags.FRAME_THIN) {
    g.char_x_left_coll += 4;
    g.char_x_right_coll -= 4;
  }
}
function check_on_floor() {
  if (g.cur_frame.flags & frame_flags.FRAME_NEEDS_FLOOR) {
    if (get_tile_at_char() === tiles.tiles_20_wall) in_wall();
    if (!tile_is_floor(g.curr_tile2)) {
      if (g.current_level === 12 && g.united_with_shadow < 0 && g.Char.curr_row === 0 && (g.Char.room === 2 || g.Char.room === 13 && g.tile_col >= 6)) {
        g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
        l8.set_wipe.fn(g.curr_tilepos, 1);
        l8.set_redraw_full.fn(g.curr_tilepos, 1);
        ++g.curr_tilepos;
        l8.set_wipe.fn(g.curr_tilepos, 1);
        l8.set_redraw_full.fn(g.curr_tilepos, 1);
      } else {
        start_fall();
      }
    }
  }
}
function start_fall() {
  let seq_id;
  const frame = g.Char.frame;
  g.Char.sword = sword_status.sword_0_sheathed;
  l2.inc_curr_row.fn();
  l7.start_chompers.fn();
  fall_frame = frame;
  if (frame === frameids.frame_9_run) {
    seq_id = seqids.seq_7_fall;
  } else if (frame === frameids.frame_13_run) {
    seq_id = seqids.seq_19_fall;
  } else if (frame === frameids.frame_26_standing_jump_11) {
    seq_id = seqids.seq_18_fall_after_standing_jump;
  } else if (frame === frameids.frame_44_running_jump_5) {
    seq_id = seqids.seq_21_fall_after_running_jump;
  } else if (frame >= frameids.frame_81_hangdrop_1 && frame < 86) {
    seq_id = seqids.seq_19_fall;
    g.Char.x = byteOf(char_dx_forward(5));
    load_fram_det_col();
  } else if (frame >= 150 && frame < 180) {
    if (g.Char.charid === charids.charid_2_guard) {
      if (g.Char.curr_row === 3 && g.Char.curr_col === 10) {
        l2.clear_char.fn();
        return;
      }
      if (g.Char.fall_x < 0) {
        seq_id = seqids.seq_82_guard_pushed_off_ledge;
        if (g.Char.direction < directions.dir_0_right && distance_to_edge_weight() <= 7) {
          g.Char.x = byteOf(char_dx_forward(-5));
        }
      } else {
        droppedout = 0;
        seq_id = seqids.seq_83_guard_fall;
      }
    } else {
      droppedout = 1;
      if (g.Char.direction < directions.dir_0_right && distance_to_edge_weight() <= 7) {
        g.Char.x = byteOf(char_dx_forward(-5));
      }
      seq_id = seqids.seq_81_kid_pushed_off_ledge;
    }
  } else {
    seq_id = seqids.seq_7_fall;
  }
  l5.seqtbl_offset_char.fn(seq_id);
  play_seq();
  load_fram_det_col();
  if (get_tile_at_char() === tiles.tiles_20_wall) {
    in_wall();
    return;
  }
  if (get_tile_infrontof_char() === tiles.tiles_20_wall) {
    if (fall_frame !== 44 || distance_to_edge_weight() >= 6) {
      g.Char.x = byteOf(char_dx_forward(-1));
    } else {
      l5.seqtbl_offset_char.fn(seqids.seq_104_start_fall_in_front_of_wall);
      play_seq();
    }
    load_fram_det_col();
  }
}
function check_grab() {
  const MAX_GRAB_FALLING_SPEED = 32;
  if (g.control_shift === CONTROL_HELD && g.Char.fall_y < MAX_GRAB_FALLING_SPEED && g.Char.alive < 0 && wordOf(y_land[g.Char.curr_row + 1]) <= wordOf(g.Char.y + 25)) {
    const old_x = g.Char.x;
    g.Char.x = byteOf(char_dx_forward(-8));
    load_fram_det_col();
    if (!can_grab_front_above()) {
      g.Char.x = old_x;
    } else {
      g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight()));
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
      l5.seqtbl_offset_char.fn(seqids.seq_15_grab_ledge_midair);
      play_seq();
      g.grab_timer = 12;
      out.play_sound(soundids.sound_9_grab);
      g.is_screaming = 0;
    }
  }
}
function can_grab_front_above() {
  through_tile = get_tile_above_char();
  get_tile_front_above_char();
  return can_grab();
}
function in_wall() {
  let delta_x = distance_to_edge_weight();
  if (delta_x >= 8 || get_tile_infrontof_char() === tiles.tiles_20_wall) {
    delta_x = 6 - delta_x;
  } else {
    delta_x += 4;
  }
  g.Char.x = byteOf(char_dx_forward(delta_x));
  load_fram_det_col();
  get_tile_at_char();
}
function get_tile_infrontof_char() {
  infrontx = dir_front[g.Char.direction + 1] + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row);
}
function get_tile_infrontof2_char() {
  const direction = dir_front[g.Char.direction + 1];
  infrontx = (direction << 1) + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row);
}
function get_tile_behind_char() {
  return get_tile(g.Char.room, dir_behind[g.Char.direction + 1] + g.Char.curr_col, g.Char.curr_row);
}
function distance_to_edge_weight() {
  return distance_to_edge(dx_weight());
}
function distance_to_edge(xpos) {
  get_tile_div_mod_m7(xpos);
  let distance = obj_xl;
  if (g.Char.direction === directions.dir_0_right) distance = TILE_RIGHTX - distance;
  return distance;
}
function fell_out() {
  if (g.Char.alive < 0 && g.Char.room === 0) {
    take_hp(100);
    g.Char.alive = 0;
    out.erase_bottom_text(1);
    g.Char.frame = frameids.frame_185_dead;
  }
}
function play_kid() {
  fell_out();
  control_kid();
  if (g.Char.alive >= 0 && is_dead()) {
    if (g.resurrect_time) {
      out.stop_sounds();
      loadkid();
      g.hitp_delta = g.hitp_max;
      l5.seqtbl_offset_char.fn(seqids.seq_2_stand);
      g.Char.x += 8;
      play_seq();
      load_fram_det_col();
      l2.set_start_pos.fn();
    }
    if (out.check_sound_playing() && g.current_sound !== 5) return;
    g.is_show_time = 0;
    if (g.Char.alive < 0 || g.Char.alive >= 6) {
      if (g.Char.alive === 6) {
        out.play_death_music();
      } else {
        if (g.Char.alive !== 7 || out.check_sound_playing()) return;
        if (g.current_level !== 0 && g.current_level !== 15) {
          g.text_time_remaining = g.text_time_total = 288;
          out.display_text_bottom("Press Button to Continue");
        } else {
          g.text_time_remaining = g.text_time_total = 36;
        }
      }
    }
    ++g.Char.alive;
  }
}
function control_kid() {
  if (g.Char.alive < 0 && g.hitp_curr === 0) g.Char.alive = 0;
  if (g.grab_timer !== 0) --g.grab_timer;
  rest_ctrl_1();
  read_user_control();
  user_control();
  save_ctrl_1();
}
function play_guard() {
  if (g.Char.charid === charids.charid_24_mouse) {
    l2.autocontrol_opponent.fn();
    return;
  }
  if (g.Char.alive < 0) {
    if (g.guardhp_curr === 0) {
      g.Char.alive = 0;
      l2.on_guard_killed.fn();
      return;
    }
  } else if (g.Char.charid === charids.charid_1_shadow) {
    l2.clear_char.fn();
  }
  l2.autocontrol_opponent.fn();
  l5.control.fn();
}
function user_control() {
  if (g.Char.direction >= directions.dir_0_right) {
    flip_control_x();
    l5.control.fn();
    flip_control_x();
  } else {
    l5.control.fn();
  }
}
function flip_control_x() {
  g.control_x = -g.control_x;
  const temp = g.control_forward;
  g.control_forward = g.control_backward;
  g.control_backward = temp;
}
function release_arrows() {
  g.control_backward = CONTROL_RELEASED;
  g.control_forward = CONTROL_RELEASED;
  g.control_up = CONTROL_RELEASED;
  g.control_down = CONTROL_RELEASED;
  return 1;
}
function save_ctrl_1() {
  g.ctrl1_forward = g.control_forward;
  g.ctrl1_backward = g.control_backward;
  g.ctrl1_up = g.control_up;
  g.ctrl1_down = g.control_down;
  g.ctrl1_shift2 = g.control_shift2;
}
function rest_ctrl_1() {
  g.control_forward = g.ctrl1_forward;
  g.control_backward = g.ctrl1_backward;
  g.control_up = g.ctrl1_up;
  g.control_down = g.ctrl1_down;
  g.control_shift2 = g.ctrl1_shift2;
}
function read_user_control() {
  if (g.control_forward >= CONTROL_RELEASED) {
    if (g.control_x === CONTROL_HELD_FORWARD) {
      if (g.control_forward === CONTROL_RELEASED) g.control_forward = CONTROL_HELD;
    } else {
      g.control_forward = CONTROL_RELEASED;
    }
  }
  if (g.control_backward >= CONTROL_RELEASED) {
    if (g.control_x === CONTROL_HELD_BACKWARD) {
      if (g.control_backward === CONTROL_RELEASED) g.control_backward = CONTROL_HELD;
    } else {
      g.control_backward = CONTROL_RELEASED;
    }
  }
  if (g.control_up >= CONTROL_RELEASED) {
    if (g.control_y === CONTROL_HELD_UP) {
      if (g.control_up === CONTROL_RELEASED) g.control_up = CONTROL_HELD;
    } else {
      g.control_up = CONTROL_RELEASED;
    }
  }
  if (g.control_down >= CONTROL_RELEASED) {
    if (g.control_y === CONTROL_HELD_DOWN) {
      if (g.control_down === CONTROL_RELEASED) g.control_down = CONTROL_HELD;
    } else {
      g.control_down = CONTROL_RELEASED;
    }
  }
  if (g.control_shift2 >= CONTROL_RELEASED) {
    if (g.control_shift === CONTROL_HELD) {
      if (g.control_shift2 === CONTROL_RELEASED) g.control_shift2 = CONTROL_HELD;
    } else {
      g.control_shift2 = CONTROL_RELEASED;
    }
  }
}
function can_grab() {
  const modifier = g.curr_room_modif[g.curr_tilepos];
  if (through_tile === tiles.tiles_20_wall) return 0;
  if (through_tile === tiles.tiles_12_doortop && g.Char.direction >= directions.dir_0_right) return 0;
  if (tile_is_floor(through_tile)) return 0;
  if (g.curr_tile2 === tiles.tiles_11_loose && modifier !== 0) return 0;
  if (g.curr_tile2 === tiles.tiles_7_doortop_with_floor && g.Char.direction < directions.dir_0_right) return 0;
  if (!tile_is_floor(g.curr_tile2)) return 0;
  return 1;
}
function wall_type(tiletype) {
  switch (tiletype) {
    case tiles.tiles_4_gate:
    case tiles.tiles_7_doortop_with_floor:
    case tiles.tiles_12_doortop:
      return 1;
    // wall at right
    case tiles.tiles_13_mirror:
      return 2;
    // wall at left
    case tiles.tiles_18_chomper:
      return 3;
    // chomper at left
    case tiles.tiles_20_wall:
      return 4;
    // wall at both sides
    default:
      return 0;
  }
}
function get_tile_above_char() {
  return get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row - 1);
}
function get_tile_behind_above_char() {
  return get_tile(g.Char.room, dir_behind[g.Char.direction + 1] + g.Char.curr_col, g.Char.curr_row - 1);
}
function get_tile_front_above_char() {
  infrontx = dir_front[g.Char.direction + 1] + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row - 1);
}
function back_delta_x(delta_x) {
  return g.Char.direction < directions.dir_0_right ? delta_x : -delta_x;
}
function do_pickup(obj_type) {
  g.pickup_obj_type = obj_type;
  g.control_shift2 = CONTROL_IGNORE;
  g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
  g.curr_room_modif[g.curr_tilepos] = 0;
  g.redraw_height = 35;
  l8.set_wipe.fn(g.curr_tilepos, 1);
  l8.set_redraw_full.fn(g.curr_tilepos, 1);
}
function check_press() {
  const frame = g.Char.frame;
  const action = g.Char.action;
  if (frame >= frameids.frame_87_hanging_1 && frame < 100 || frame >= frameids.frame_135_climbing_1 && frame < frameids.frame_141_climbing_7) {
    get_tile_above_char();
  } else if (action === actions.actions_7_turn || action === actions.actions_5_bumped || action < actions.actions_2_hang_climb) {
    if (frame === frameids.frame_79_jumphang && get_tile_above_char() === tiles.tiles_11_loose) {
      l7.make_loose_fall.fn(1);
    } else {
      if (!(g.cur_frame.flags & frame_flags.FRAME_NEEDS_FLOOR)) return;
      get_tile_at_char();
    }
  } else {
    return;
  }
  if (g.curr_tile2 === tiles.tiles_15_opener || g.curr_tile2 === tiles.tiles_6_closer) {
    if (g.Char.alive < 0) l7.trigger_button.fn(1, 0, -1);
    else l2.died_on_button.fn();
  } else if (g.curr_tile2 === tiles.tiles_11_loose) {
    g.is_guard_notice = 1;
    l7.make_loose_fall.fn(1);
  }
}
function check_spike_below() {
  const right_col = get_tile_div_mod_m7(g.char_x_right);
  if (right_col < 0) return;
  const room = g.Char.room;
  for (let col = get_tile_div_mod_m7(g.char_x_left); col <= right_col; ++col) {
    let row = g.Char.curr_row;
    let not_finished;
    do {
      not_finished = false;
      if (get_tile(room, col, row) === tiles.tiles_2_spike) {
        l7.start_anim_spike.fn(g.curr_room, g.curr_tilepos);
      } else if (!tile_is_floor(g.curr_tile2) && g.curr_room !== 0 && room === g.curr_room) {
        ++row;
        not_finished = true;
      }
    } while (not_finished);
  }
}
function clip_char() {
  const frame = g.Char.frame;
  const action = g.Char.action;
  const room = g.Char.room;
  const row = g.Char.curr_row;
  reset_obj_clip();
  if (frame >= frameids.frame_224_exit_stairs_8 && frame < 229) {
    g.obj_clip_top = g.leveldoor_ybottom + 1;
    g.obj_clip_right = g.leveldoor_right;
    return;
  }
  if (get_tile(room, g.char_col_left, g.char_top_row) === tiles.tiles_20_wall || tile_is_floor(g.curr_tile2)) {
    if (action === actions.actions_0_stand && (frame === frameids.frame_79_jumphang || frame === frameids.frame_81_hangdrop_1) || get_tile(room, g.char_col_right, g.char_top_row) === tiles.tiles_20_wall || tile_is_floor(g.curr_tile2)) {
      const clip_row = row + 1;
      const clip_y = y_clip[clip_row];
      if (clip_row === 1 || clip_y < g.obj_y && clip_y - 15 < g.char_top_y) {
        g.char_top_y = clip_y;
        g.obj_clip_top = clip_y;
      }
    }
  }
  const col = get_tile_div_mod(g.char_x_left_coll - 4);
  if (get_tile(room, col + 1, row) === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop) {
    g.obj_clip_right = (g.tile_col << 5) + 32;
  } else if (get_tile(room, col, row) !== tiles.tiles_7_doortop_with_floor && g.curr_tile2 !== tiles.tiles_12_doortop || action === actions.actions_3_in_midair || action === actions.actions_4_in_freefall && frame === frameids.frame_106_fall || action === actions.actions_5_bumped && frame === frameids.frame_107_fall_land_1) {
  } else {
    g.obj_clip_right = (g.tile_col << 5) + 32;
  }
}
function stuck_lower() {
  if (get_tile_at_char() === tiles.tiles_5_stuck) ++g.Char.y;
}
function set_objtile_at_char() {
  const char_frame = g.Char.frame;
  const char_action = g.Char.action;
  if (char_action === actions.actions_1_run_jump) {
    g.tile_row = g.char_bottom_row;
    g.tile_col = g.char_col_left;
  } else {
    g.tile_row = g.Char.curr_row;
    g.tile_col = g.Char.curr_col;
  }
  if (char_frame >= frameids.frame_135_climbing_1 && char_frame < 149 || char_action === actions.actions_2_hang_climb || char_action === actions.actions_3_in_midair || char_action === actions.actions_4_in_freefall || char_action === actions.actions_6_hang_straight) {
    --g.tile_col;
  }
  g.obj_tilepos = get_tilepos_nominus(g.tile_col, g.tile_row);
}
function proc_get_object() {
  if (g.Char.charid !== charids.charid_0_kid || g.pickup_obj_type === 0) return;
  if (g.pickup_obj_type === -1) {
    g.have_sword = -1;
    out.play_sound(soundids.sound_37_victory);
    g.flash_color = 14;
    g.flash_time = 8;
  } else {
    switch (g.pickup_obj_type) {
      case 1:
        if (g.hitp_curr !== g.hitp_max) {
          out.stop_sounds();
          out.play_sound(soundids.sound_33_small_potion);
          g.hitp_delta = 1;
          g.flash_color = 4;
          g.flash_time = 2;
        }
        break;
      case 2:
        out.stop_sounds();
        out.play_sound(soundids.sound_30_big_potion);
        g.flash_color = 4;
        g.flash_time = 4;
        g.hitp_max++;
        g.hitp_delta = g.hitp_max;
        break;
      case 3:
        g.is_feather_fall = 1;
        g.flash_color = 2;
        g.flash_time = 3;
        out.stop_sounds();
        out.play_sound(soundids.sound_39_low_weight);
        break;
      case 4:
        out.stop_sounds();
        out.play_sound(soundids.sound_38_blink);
        g.flash_color = 15;
        g.flash_time = 5;
        take_hp(1);
        break;
      default:
        break;
    }
  }
  g.pickup_obj_type = 0;
}
function is_dead() {
  return g.Char.frame >= frameids.frame_177_spiked && (g.Char.frame <= frameids.frame_178_chomped || g.Char.frame === frameids.frame_185_dead);
}
function load_frame_to_obj() {
  const chtab_base = chtabs.id_chtab_2_kid;
  reset_obj_clip();
  load_frame();
  g.obj_direction = g.Char.direction;
  g.obj_id = g.cur_frame.image;
  g.obj_chtab = chtab_base + (g.cur_frame.sword >> 6);
  g.obj_x = (char_dx_forward(g.cur_frame.dx) << 1) - 116;
  g.obj_y = g.cur_frame.dy + g.Char.y;
  if (sbyteOf(g.cur_frame.flags ^ g.obj_direction) >= 0) ++g.obj_x;
}

// src/pop/seg004.ts
var TILE_SIZEX = 14;
var TILE_MIDX = 7;
var TILE_RIGHTX2 = 13;
var FIRST_ONSCREEN_COLUMN2 = 5;
var SCREEN_TILECOUNTX = 10;
var EDGE_TYPE_CLOSER = 0;
var EDGE_TYPE_WALL = 1;
var EDGE_TYPE_FLOOR = 2;
var wall_dist_from_left = [0, 10, 0, -1, 0, 0];
var wall_dist_from_right = [0, 0, 10, 13, 0, 0];
var collision_row = 0;
var right_checked_col = 0;
var left_checked_col = 0;
var edge_type = 0;
function check_collisions() {
  g.bump_col_left_of_wall = -1;
  g.bump_col_right_of_wall = -1;
  if (g.Char.action === actions.actions_7_turn) return;
  collision_row = g.Char.curr_row;
  move_coll_to_prev();
  g.prev_collision_row = collision_row;
  right_checked_col = Math.min(get_tile_div_mod_m7(g.char_x_right_coll) + 2, 11);
  left_checked_col = get_tile_div_mod_m7(g.char_x_left_coll) - 1;
  get_row_collision_data(collision_row, g.curr_row_coll_room, g.curr_row_coll_flags);
  get_row_collision_data(collision_row + 1, g.below_row_coll_room, g.below_row_coll_flags);
  get_row_collision_data(collision_row - 1, g.above_row_coll_room, g.above_row_coll_flags);
  for (let column = 9; column >= 0; --column) {
    if (g.curr_row_coll_room[column] >= 0 && g.prev_coll_room[column] === g.curr_row_coll_room[column]) {
      if ((g.prev_coll_flags[column] & 15) === 0 && (g.curr_row_coll_flags[column] & 15) !== 0) {
        g.bump_col_left_of_wall = column;
      }
      if ((g.prev_coll_flags[column] & 240) === 0 && (g.curr_row_coll_flags[column] & 240) !== 0) {
        g.bump_col_right_of_wall = column;
      }
    }
  }
}
function move_coll_to_prev() {
  let room_ptr;
  let flags_ptr;
  if (collision_row === g.prev_collision_row || collision_row + 3 === g.prev_collision_row || collision_row - 3 === g.prev_collision_row) {
    room_ptr = g.curr_row_coll_room;
    flags_ptr = g.curr_row_coll_flags;
  } else if (collision_row + 1 === g.prev_collision_row || collision_row - 2 === g.prev_collision_row) {
    room_ptr = g.above_row_coll_room;
    flags_ptr = g.above_row_coll_flags;
  } else {
    room_ptr = g.below_row_coll_room;
    flags_ptr = g.below_row_coll_flags;
  }
  const room = Array.from(room_ptr);
  const flags = Array.from(flags_ptr);
  for (let column = 0; column < 10; ++column) {
    g.prev_coll_room[column] = room[column];
    g.prev_coll_flags[column] = flags[column];
    g.below_row_coll_room[column] = -1;
    g.above_row_coll_room[column] = -1;
    g.curr_row_coll_room[column] = -1;
  }
}
function get_row_collision_data(row, room_ptr, flags_ptr) {
  const room = g.Char.room;
  g.coll_tile_left_xpos = x_bump[left_checked_col + FIRST_ONSCREEN_COLUMN2] + TILE_MIDX;
  for (let column = left_checked_col; column <= right_checked_col; ++column) {
    const left_wall_xpos = get_left_wall_xpos(room, column, row);
    const right_wall_xpos = get_right_wall_xpos(room, column, row);
    let curr_flags = (left_wall_xpos < g.char_x_right_coll ? 1 : 0) * 15;
    curr_flags |= (right_wall_xpos > g.char_x_left_coll ? 1 : 0) * 240;
    flags_ptr[g.tile_col] = curr_flags;
    room_ptr[g.tile_col] = g.curr_room;
    g.coll_tile_left_xpos += TILE_SIZEX;
  }
}
function get_left_wall_xpos(room, column, row) {
  const type = wall_type(get_tile(room, column, row));
  if (type) return wall_dist_from_left[type] + g.coll_tile_left_xpos;
  return 255;
}
function get_right_wall_xpos(room, column, row) {
  const type = wall_type(get_tile(room, column, row));
  if (type) return g.coll_tile_left_xpos - wall_dist_from_right[type] + TILE_RIGHTX2;
  return 0;
}
function check_bumped() {
  if (g.Char.action !== actions.actions_2_hang_climb && g.Char.action !== actions.actions_6_hang_straight && (g.Char.frame < frameids.frame_135_climbing_1 || g.Char.frame >= 149)) {
    if (g.bump_col_left_of_wall >= 0) {
      check_bumped_look_right();
    } else if (g.bump_col_right_of_wall >= 0) {
      check_bumped_look_left();
    }
  }
}
function check_bumped_look_left() {
  if ((g.Char.sword === sword_status.sword_2_drawn || g.Char.direction < directions.dir_0_right) && is_obstacle_at_col(g.bump_col_right_of_wall)) {
    bumped(
      sbyteOf(get_right_wall_xpos(g.curr_room, g.tile_col, g.tile_row) - g.char_x_left_coll),
      directions.dir_0_right
    );
  }
}
function check_bumped_look_right() {
  if ((g.Char.sword === sword_status.sword_2_drawn || g.Char.direction === directions.dir_0_right) && is_obstacle_at_col(g.bump_col_left_of_wall)) {
    bumped(
      sbyteOf(get_left_wall_xpos(g.curr_room, g.tile_col, g.tile_row) - g.char_x_right_coll),
      directions.dir_FF_left
    );
  }
}
function is_obstacle_at_col(tile_col) {
  let tile_row = g.Char.curr_row;
  if (tile_row < 0) tile_row += 3;
  if (tile_row >= 3) tile_row -= 3;
  get_tile(g.curr_row_coll_room[tile_col], tile_col, tile_row);
  return is_obstacle();
}
function is_obstacle() {
  if (g.curr_tile2 === tiles.tiles_10_potion) {
    return 0;
  } else if (g.curr_tile2 === tiles.tiles_4_gate) {
    if (!can_bump_into_gate()) return 0;
  } else if (g.curr_tile2 === tiles.tiles_18_chomper) {
    if (g.curr_room_modif[g.curr_tilepos] !== 2) return 0;
  } else if (g.curr_tile2 === tiles.tiles_13_mirror && g.Char.charid === charids.charid_0_kid && g.Char.frame >= frameids.frame_39_start_run_jump_6 && g.Char.frame < frameids.frame_44_running_jump_5 && g.Char.direction < directions.dir_0_right) {
    g.curr_room_modif[g.curr_tilepos] = 86;
    g.jumped_through_mirror = -1;
    return 0;
  }
  g.coll_tile_left_xpos = xpos_in_drawn_room(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN2]) + TILE_MIDX;
  return 1;
}
function xpos_in_drawn_room(xpos) {
  if (g.curr_room !== g.drawn_room) {
    if (g.curr_room === g.room_L || g.curr_room === g.room_BL) {
      xpos -= TILE_SIZEX * SCREEN_TILECOUNTX;
    } else if (g.curr_room === g.room_R || g.curr_room === g.room_BR) {
      xpos += TILE_SIZEX * SCREEN_TILECOUNTX;
    }
  }
  return xpos;
}
function bumped(delta_x, push_direction) {
  if (g.Char.alive < 0 && g.Char.frame !== frameids.frame_177_spiked) {
    g.Char.x = byteOf(g.Char.x + delta_x);
    if (push_direction < directions.dir_0_right) {
      if (g.curr_tile2 === tiles.tiles_20_wall) {
        get_tile(g.curr_room, --g.tile_col, g.tile_row);
      }
    } else if (g.curr_tile2 === tiles.tiles_12_doortop || g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_20_wall) {
      ++g.tile_col;
      if (g.curr_room === 0 && g.tile_col === 10) {
        g.curr_room = g.Char.room;
        g.tile_col = 0;
      }
      get_tile(g.curr_room, g.tile_col, g.tile_row);
    }
    if (tile_is_floor(g.curr_tile2)) bumped_floor(push_direction);
    else bumped_fall();
  }
}
function bumped_fall() {
  const action = g.Char.action;
  g.Char.x = byteOf(char_dx_forward(-4));
  if (action === actions.actions_4_in_freefall) {
    g.Char.fall_x = 0;
  } else {
    l5.seqtbl_offset_char.fn(seqids.seq_45_bumpfall);
    play_seq();
  }
  bumped_sound();
}
function bumped_floor(push_direction) {
  let seq_index;
  if (g.Char.sword !== sword_status.sword_2_drawn && (y_land[g.Char.curr_row + 1] - g.Char.y & 65535) >= 15) {
    bumped_fall();
    return;
  }
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  if (g.Char.fall_y >= 22) {
    g.Char.x = byteOf(char_dx_forward(-5));
    return;
  }
  g.Char.fall_y = 0;
  if (g.Char.alive >= 0) return;
  if (g.Char.sword === sword_status.sword_2_drawn) {
    if (push_direction === g.Char.direction) {
      l5.seqtbl_offset_char.fn(seqids.seq_65_bump_forward_with_sword);
      play_seq();
      g.Char.x = byteOf(char_dx_forward(1));
      return;
    }
    seq_index = seqids.seq_64_pushed_back_with_sword;
  } else {
    const frame = g.Char.frame;
    if (frame === 24 || frame === 25 || frame >= 40 && frame < 43 || frame >= frameids.frame_102_start_fall_1 && frame < 107) {
      seq_index = seqids.seq_46_hardbump;
    } else {
      seq_index = seqids.seq_47_bump;
    }
  }
  l5.seqtbl_offset_char.fn(seq_index);
  play_seq();
  bumped_sound();
}
function bumped_sound() {
  g.is_guard_notice = 1;
  out.play_sound(soundids.sound_8_bumped);
}
function clear_coll_rooms() {
  g.prev_coll_room.fill(-1);
  g.curr_row_coll_room.fill(-1);
  g.below_row_coll_room.fill(-1);
  g.above_row_coll_room.fill(-1);
  g.prev_collision_row = -1;
}
function can_bump_into_gate() {
  return (g.curr_room_modif[g.curr_tilepos] >> 2) + 6 < g.char_height;
}
function get_edge_distance() {
  let distance = 0;
  determine_col();
  load_frame_to_obj();
  set_char_collision();
  let tiletype = get_tile_at_char();
  let settled = false;
  if (wall_type(tiletype) !== 0) {
    g.tile_col = g.Char.curr_col;
    distance = dist_from_wall_forward(tiletype);
    if (distance >= 0) {
      distance = fromWall(distance);
      settled = true;
    }
  }
  if (!settled) {
    tiletype = get_tile_infrontof_char();
    if (tiletype === tiles.tiles_12_doortop && g.Char.direction >= directions.dir_0_right) {
      edge_type = EDGE_TYPE_CLOSER;
      distance = distance_to_edge_weight();
    } else {
      let closer = false;
      if (wall_type(tiletype) !== 0) {
        g.tile_col = infrontx;
        distance = dist_from_wall_forward(tiletype);
        if (distance >= 0) {
          distance = fromWall(distance);
          settled = true;
        }
      }
      if (!settled) {
        if (tiletype === tiles.tiles_11_loose) {
          closer = true;
        } else if (tiletype === tiles.tiles_6_closer || tiletype === tiles.tiles_22_sword || tiletype === tiles.tiles_10_potion) {
          distance = distance_to_edge_weight();
          if (distance !== 0) {
            edge_type = EDGE_TYPE_CLOSER;
          } else {
            edge_type = EDGE_TYPE_FLOOR;
            distance = 11;
          }
        } else if (tile_is_floor(tiletype)) {
          edge_type = EDGE_TYPE_FLOOR;
          distance = 11;
        } else {
          closer = true;
        }
        if (closer) {
          edge_type = EDGE_TYPE_CLOSER;
          distance = distance_to_edge_weight();
        }
      }
    }
  }
  g.curr_tile2 = tiletype;
  return distance;
}
function fromWall(distance) {
  if (distance <= TILE_RIGHTX2) {
    edge_type = EDGE_TYPE_WALL;
    return distance;
  }
  edge_type = EDGE_TYPE_FLOOR;
  return 11;
}
function check_chomped_kid() {
  const tile_row = g.Char.curr_row;
  for (let tile_col = 0; tile_col < 10; ++tile_col) {
    if (g.curr_row_coll_flags[tile_col] === 255 && get_tile(g.curr_row_coll_room[tile_col], tile_col, tile_row) === tiles.tiles_18_chomper && (g.curr_room_modif[g.curr_tilepos] & 127) === 2) {
      chomped();
    }
  }
}
function chomped() {
  g.curr_room_modif[g.curr_tilepos] |= 128;
  if (g.Char.frame !== frameids.frame_178_chomped && g.Char.room === g.curr_room) {
    g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN2] + TILE_MIDX);
    g.Char.x = byteOf(char_dx_forward(7 - (g.Char.direction ? 0 : 1)));
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    take_hp(100);
    out.play_sound(soundids.sound_46_chomped);
    l5.seqtbl_offset_char.fn(seqids.seq_54_chomped);
    play_seq();
  }
}
function check_gate_push() {
  const frame = g.Char.frame;
  if (g.Char.action === actions.actions_7_turn || frame === frameids.frame_15_stand || frame >= frameids.frame_108_fall_land_2 && frame < 111) {
    get_tile_at_char();
    const orig_col = g.tile_col;
    if ((g.curr_tile2 === tiles.tiles_4_gate || get_tile(g.curr_room, --g.tile_col, g.tile_row) === tiles.tiles_4_gate) && (g.curr_row_coll_flags[g.tile_col] & g.prev_coll_flags[g.tile_col]) === 255 && can_bump_into_gate()) {
      bumped_sound();
      g.Char.x = byteOf(g.Char.x + 5 - (orig_col <= g.tile_col ? 1 : 0) * 10);
    }
  }
}
function check_guard_bumped() {
  if (g.Char.action === actions.actions_1_run_jump && g.Char.alive < 0 && g.Char.sword >= sword_status.sword_2_drawn) {
    if (get_tile_at_char() === tiles.tiles_20_wall || g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_4_gate && can_bump_into_gate() || g.Char.direction >= directions.dir_0_right && (get_tile(g.curr_room, --g.tile_col, g.tile_row) === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_4_gate && can_bump_into_gate())) {
      load_frame_to_obj();
      set_char_collision();
      if (is_obstacle()) {
        const delta_x = dist_from_wall_behind(g.curr_tile2);
        if (delta_x < 0 && delta_x > -13) {
          g.Char.x = byteOf(char_dx_forward(-delta_x));
          l5.seqtbl_offset_char.fn(seqids.seq_65_bump_forward_with_sword);
          play_seq();
          load_fram_det_col();
        }
      }
    }
  }
}
function check_chomped_guard() {
  get_tile_at_char();
  if (!check_chomped_here()) {
    get_tile(g.curr_room, ++g.tile_col, g.tile_row);
    check_chomped_here();
  }
}
function check_chomped_here() {
  if (g.curr_tile2 === tiles.tiles_18_chomper && (g.curr_room_modif[g.curr_tilepos] & 127) === 2) {
    g.coll_tile_left_xpos = x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN2] + TILE_MIDX;
    if (get_left_wall_xpos(g.curr_room, g.tile_col, g.tile_row) < g.char_x_right_coll && get_right_wall_xpos(g.curr_room, g.tile_col, g.tile_row) > g.char_x_left_coll) {
      chomped();
      return 1;
    }
    return 0;
  }
  return 0;
}
function dist_from_wall_forward(tiletype) {
  if (tiletype === tiles.tiles_4_gate && !can_bump_into_gate()) return -1;
  g.coll_tile_left_xpos = x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN2] + TILE_MIDX;
  const type = wall_type(tiletype);
  if (type === 0) return -1;
  if (g.Char.direction < directions.dir_0_right) {
    return g.char_x_left_coll - (g.coll_tile_left_xpos + TILE_RIGHTX2 - wall_dist_from_right[type]);
  }
  return wall_dist_from_left[type] + g.coll_tile_left_xpos - g.char_x_right_coll;
}
function dist_from_wall_behind(tiletype) {
  const type = wall_type(tiletype);
  if (type === 0) return 99;
  if (g.Char.direction >= directions.dir_0_right) {
    return g.char_x_left_coll - (g.coll_tile_left_xpos + TILE_RIGHTX2 - wall_dist_from_right[type]);
  }
  return wall_dist_from_left[type] + g.coll_tile_left_xpos - g.char_x_right_coll;
}

// src/pop/seg005.ts
var TILE_SIZEX2 = 14;
var FIRST_ONSCREEN_COLUMN3 = 5;
var CONTROL_HELD2 = -1;
var CONTROL_RELEASED2 = 0;
var CONTROL_IGNORE2 = 1;
var CONTROL_HELD_FORWARD2 = -1;
var CONTROL_HELD_BACKWARD2 = 1;
var CONTROL_HELD_UP2 = -1;
var CONTROL_HELD_DOWN2 = 1;
var dist = { char_opp_dist: () => 0 };
function seqtbl_offset_char(seq_index) {
  g.Char.curr_seq = seqOffset(seq_index);
}
function do_fall() {
  if (g.is_screaming === 0 && g.Char.fall_y >= 31) {
    out.play_sound(soundids.sound_1_falling);
    g.is_screaming = 1;
  }
  if (wordOf(y_land[g.Char.curr_row + 1]) > wordOf(g.Char.y)) {
    check_grab();
  } else {
    if (get_tile_at_char() === tiles.tiles_20_wall) in_wall();
    if (tile_is_floor(g.curr_tile2)) land();
    else l2.inc_curr_row.fn();
  }
}
function land() {
  let seq_id = 0;
  g.is_screaming = 0;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  let onSpikes = false;
  if (get_tile_at_char() !== tiles.tiles_2_spike) {
    if (!tile_is_floor(get_tile_infrontof_char()) && distance_to_edge_weight() < 3) {
      g.Char.x = byteOf(char_dx_forward(-3));
    }
    l7.start_chompers.fn();
  } else {
    onSpikes = true;
  }
  if (!onSpikes && g.Char.alive >= 0) {
    take_hp(100);
    out.play_sound(soundids.sound_0_fell_to_death);
    seq_id = seqids.seq_22_crushed;
    seqtbl_offset_char(seq_id);
    play_seq();
    g.Char.fall_y = 0;
    return;
  }
  if (onSpikes || distance_to_edge_weight() >= 12 && get_tile_behind_char() === tiles.tiles_2_spike || get_tile_at_char() === tiles.tiles_2_spike) {
    if (l7.is_spike_harmful.fn()) {
      spiked();
      return;
    }
  }
  const landedOneRow = () => {
    let id;
    if (g.Char.charid >= charids.charid_2_guard || g.Char.sword === sword_status.sword_2_drawn) {
      g.Char.sword = sword_status.sword_2_drawn;
      id = seqids.seq_63_guard_active_after_fall;
    } else {
      id = seqids.seq_17_soft_land;
    }
    if (g.Char.charid === charids.charid_0_kid) {
      out.play_sound(soundids.sound_17_soft_land);
      g.is_guard_notice = 1;
    }
    return id;
  };
  let crushed = false;
  let crushedNoHp = false;
  if (g.Char.fall_y < 22) {
    seq_id = landedOneRow();
  } else if (g.Char.fall_y < 33) {
    if (g.Char.charid === charids.charid_1_shadow) {
      seq_id = landedOneRow();
    } else if (g.Char.charid === charids.charid_2_guard) {
      crushed = true;
    } else if (!take_hp(1)) {
      out.play_sound(soundids.sound_16_medium_land);
      g.is_guard_notice = 1;
      seq_id = seqids.seq_20_medium_land;
    } else {
      crushedNoHp = true;
    }
  } else {
    crushed = true;
  }
  if (crushed) take_hp(100);
  if (crushed || crushedNoHp) {
    out.play_sound(soundids.sound_0_fell_to_death);
    seq_id = seqids.seq_22_crushed;
  }
  seqtbl_offset_char(seq_id);
  play_seq();
  g.Char.fall_y = 0;
}
function spiked() {
  g.curr_room_modif[g.curr_tilepos] = 255;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN3] + 10);
  g.Char.x = byteOf(char_dx_forward(8));
  g.Char.fall_y = 0;
  out.play_sound(soundids.sound_48_spiked);
  take_hp(100);
  seqtbl_offset_char(seqids.seq_51_spiked);
  play_seq();
}
function control() {
  const char_frame = g.Char.frame;
  if (g.Char.alive >= 0) {
    if (char_frame === frameids.frame_15_stand || char_frame === frameids.frame_166_stand_inactive || char_frame === frameids.frame_158_stand_with_sword || char_frame === frameids.frame_171_stand_with_sword) {
      seqtbl_offset_char(seqids.seq_71_dying);
    }
    return;
  }
  const char_action = g.Char.action;
  if (char_action === actions.actions_5_bumped || char_action === actions.actions_4_in_freefall) {
    release_arrows();
  } else if (g.Char.sword === sword_status.sword_2_drawn) {
    control_with_sword();
  } else if (g.Char.charid >= charids.charid_2_guard) {
    l6.control_guard_inactive.fn();
  } else if (char_frame === frameids.frame_15_stand || char_frame >= frameids.frame_50_turn && char_frame < 53) {
    control_standing();
  } else if (char_frame === frameids.frame_48_turn) {
    control_turning();
  } else if (char_frame < 4) {
    control_startrun();
  } else if (char_frame >= frameids.frame_67_start_jump_up_1 && char_frame < frameids.frame_70_jumphang) {
    control_jumpup();
  } else if (char_frame < 15) {
    control_running();
  } else if (char_frame >= frameids.frame_87_hanging_1 && char_frame < 100) {
    control_hanging();
  } else if (char_frame === frameids.frame_109_crouch) {
    control_crouched();
  }
}
function control_crouched() {
  if (g.need_level1_music !== 0 && g.current_level === 1) {
    if (!out.check_sound_playing()) {
      if (g.need_level1_music === 1) {
        out.play_sound(soundids.sound_25_presentation);
        g.need_level1_music = 2;
      } else {
        g.need_level1_music = 0;
      }
    }
    return;
  }
  g.need_level1_music = 0;
  if (g.control_shift2 === CONTROL_HELD2 && check_get_item()) return;
  if (g.control_y !== CONTROL_HELD_DOWN2) {
    seqtbl_offset_char(seqids.seq_49_stand_up_from_crouch);
  } else if (g.control_forward === CONTROL_HELD2) {
    g.control_forward = CONTROL_IGNORE2;
    seqtbl_offset_char(seqids.seq_79_crouch_hop);
  }
}
function control_standing() {
  if (g.control_shift2 === CONTROL_HELD2 && g.control_shift === CONTROL_HELD2 && check_get_item()) {
    return;
  }
  if (g.Char.charid !== charids.charid_0_kid && g.control_down === CONTROL_HELD2 && g.control_forward === CONTROL_HELD2) {
    draw_sword();
    return;
  }
  let plain = false;
  if (g.have_sword) {
    if (g.offguard !== 0 && g.control_shift >= CONTROL_RELEASED2) {
      plain = true;
    } else if (g.can_guard_see_kid >= 2) {
      const distance = dist.char_opp_dist();
      if (distance >= -10 && distance < 90) {
        g.holding_sword = 1;
        if (wordOf(distance) < wordOf(-6)) {
          if (g.Opp.charid === charids.charid_1_shadow && (g.Opp.action === actions.actions_3_in_midair || g.Opp.frame >= frameids.frame_107_fall_land_1 && g.Opp.frame < 118)) {
            g.offguard = 0;
          } else {
            draw_sword();
            return;
          }
        } else {
          back_pressed();
          return;
        }
      }
    } else {
      g.offguard = 0;
    }
  }
  if (!plain && g.control_shift === CONTROL_HELD2) {
    if (g.control_backward === CONTROL_HELD2) back_pressed();
    else if (g.control_up === CONTROL_HELD2) up_pressed();
    else if (g.control_down === CONTROL_HELD2) down_pressed();
    else if (g.control_x === CONTROL_HELD_FORWARD2 && g.control_forward === CONTROL_HELD2) {
      safe_step();
    }
    return;
  }
  if (g.control_forward === CONTROL_HELD2) {
    if (g.control_up === CONTROL_HELD2) standing_jump();
    else forward_pressed();
  } else if (g.control_backward === CONTROL_HELD2) {
    back_pressed();
  } else if (g.control_up === CONTROL_HELD2) {
    if (g.control_forward === CONTROL_HELD2) standing_jump();
    else up_pressed();
  } else if (g.control_down === CONTROL_HELD2) {
    down_pressed();
  } else if (g.control_x === CONTROL_HELD_FORWARD2) {
    forward_pressed();
  }
}
function up_pressed() {
  let leveldoor_tilepos = -1;
  if (get_tile_at_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  else if (get_tile_behind_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  else if (get_tile_infrontof_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  if (leveldoor_tilepos !== -1 && g.level.start_room !== g.drawn_room && g.leveldoor_open) {
    go_up_leveldoor();
    return;
  }
  if (g.control_x === CONTROL_HELD_FORWARD2) standing_jump();
  else check_jump_up();
}
function down_pressed() {
  g.control_down = CONTROL_IGNORE2;
  if (!tile_is_floor(get_tile_infrontof_char()) && distance_to_edge_weight() < 3) {
    g.Char.x = byteOf(char_dx_forward(5));
    load_fram_det_col();
    return;
  }
  if (!tile_is_floor(get_tile_behind_char()) && distance_to_edge_weight() >= 8) {
    setThroughTile(get_tile_behind_char());
    get_tile_at_char();
    if (can_grab() && (g.Char.direction >= directions.dir_0_right || get_tile_at_char() !== tiles.tiles_4_gate || g.curr_room_modif[g.curr_tilepos] >> 2 >= 6)) {
      g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight() - 9));
      seqtbl_offset_char(seqids.seq_68_climb_down);
      return;
    }
  }
  crouch();
}
function go_up_leveldoor() {
  g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN3] + 10);
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_70_go_up_on_level_door);
}
function control_turning() {
  if (g.control_shift >= CONTROL_RELEASED2 && g.control_x === CONTROL_HELD_FORWARD2 && g.control_y >= CONTROL_RELEASED2) {
    seqtbl_offset_char(seqids.seq_43_start_run_after_turn);
  }
}
function crouch() {
  seqtbl_offset_char(seqids.seq_50_crouch);
  g.control_down = release_arrows();
}
function back_pressed() {
  let seq_id;
  g.control_backward = release_arrows();
  if (g.have_sword === 0 || g.can_guard_see_kid < 2 || dist.char_opp_dist() > 0 || distance_to_edge_weight() < 2) {
    seq_id = seqids.seq_5_turn;
  } else {
    g.Char.sword = sword_status.sword_2_drawn;
    g.offguard = 0;
    seq_id = seqids.seq_89_turn_draw_sword;
  }
  seqtbl_offset_char(seq_id);
}
function forward_pressed() {
  const distance = get_edge_distance();
  if (edge_type === EDGE_TYPE_WALL && g.curr_tile2 !== tiles.tiles_18_chomper && distance < 8) {
    if (g.control_forward === CONTROL_HELD2) safe_step();
  } else {
    seqtbl_offset_char(seqids.seq_1_start_run);
  }
}
function control_running() {
  if (g.control_x === CONTROL_RELEASED2 && (g.Char.frame === frameids.frame_7_run || g.Char.frame === frameids.frame_11_run)) {
    g.control_forward = release_arrows();
    seqtbl_offset_char(seqids.seq_13_stop_run);
  } else if (g.control_x === CONTROL_HELD_BACKWARD2) {
    g.control_backward = release_arrows();
    seqtbl_offset_char(seqids.seq_6_run_turn);
  } else if (g.control_y === CONTROL_HELD_UP2 && g.control_up === CONTROL_HELD2) {
    run_jump();
  } else if (g.control_down === CONTROL_HELD2) {
    g.control_down = CONTROL_IGNORE2;
    seqtbl_offset_char(seqids.seq_26_crouch_while_running);
  }
}
function safe_step() {
  g.control_shift2 = CONTROL_IGNORE2;
  g.control_forward = CONTROL_IGNORE2;
  const distance = get_edge_distance();
  if (distance) {
    g.Char.repeat = 1;
    seqtbl_offset_char(distance + 28);
  } else if (edge_type !== EDGE_TYPE_WALL && g.Char.repeat !== 0) {
    g.Char.repeat = 0;
    seqtbl_offset_char(seqids.seq_44_step_on_edge);
  } else {
    seqtbl_offset_char(seqids.seq_39_safe_step_11);
  }
}
function check_get_item() {
  if (get_tile_at_char() === tiles.tiles_10_potion || g.curr_tile2 === tiles.tiles_22_sword) {
    if (!tile_is_floor(get_tile_behind_char())) return 0;
    g.Char.x = byteOf(char_dx_forward(-14));
    load_fram_det_col();
  }
  if (get_tile_infrontof_char() === tiles.tiles_10_potion || g.curr_tile2 === tiles.tiles_22_sword) {
    get_item();
    return 1;
  }
  return 0;
}
function get_item() {
  if (g.Char.frame !== frameids.frame_109_crouch) {
    const distance = get_edge_distance();
    if (edge_type !== EDGE_TYPE_FLOOR) {
      g.Char.x = byteOf(char_dx_forward(distance));
    }
    if (g.Char.direction >= directions.dir_0_right) {
      g.Char.x = byteOf(char_dx_forward(
        (g.curr_tile2 === tiles.tiles_10_potion ? 1 : 0) - 2
      ));
    }
    crouch();
  } else if (g.curr_tile2 === tiles.tiles_22_sword) {
    do_pickup(-1);
    seqtbl_offset_char(seqids.seq_91_get_sword);
  } else {
    do_pickup(g.curr_room_modif[g.curr_tilepos] >> 3);
    seqtbl_offset_char(seqids.seq_78_drink);
  }
}
function control_startrun() {
  if (g.control_y === CONTROL_HELD_UP2 && g.control_x === CONTROL_HELD_FORWARD2) {
    standing_jump();
  }
}
function control_jumpup() {
  if (g.control_x === CONTROL_HELD_FORWARD2 || g.control_forward === CONTROL_HELD2) {
    standing_jump();
  }
}
function standing_jump() {
  g.control_up = CONTROL_IGNORE2;
  g.control_forward = CONTROL_IGNORE2;
  seqtbl_offset_char(seqids.seq_3_standing_jump);
}
function check_jump_up() {
  g.control_up = release_arrows();
  setThroughTile(get_tile_above_char());
  get_tile_front_above_char();
  if (can_grab()) {
    grab_up_with_floor_behind();
    return;
  }
  setThroughTile(get_tile_behind_above_char());
  get_tile_above_char();
  if (can_grab()) jump_up_or_grab();
  else jump_up();
}
function jump_up_or_grab() {
  const distance = distance_to_edge_weight();
  if (distance < 6) {
    jump_up();
  } else if (!tile_is_floor(get_tile_behind_char())) {
    grab_up_no_floor_behind();
  } else {
    g.Char.x = byteOf(char_dx_forward(distance - TILE_SIZEX2));
    load_fram_det_col();
    grab_up_with_floor_behind();
  }
}
function grab_up_no_floor_behind() {
  get_tile_above_char();
  g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight() - 10));
  seqtbl_offset_char(seqids.seq_16_jump_up_and_grab);
}
function jump_up() {
  g.control_up = release_arrows();
  const distance = get_edge_distance();
  if (distance < 4 && edge_type === EDGE_TYPE_WALL) {
    g.Char.x = byteOf(char_dx_forward(distance - 3));
  }
  get_tile(g.Char.room, get_tile_div_mod(back_delta_x(0) + dx_weight() - 6), g.Char.curr_row - 1);
  if (g.curr_tile2 !== tiles.tiles_20_wall && !tile_is_floor(g.curr_tile2)) {
    seqtbl_offset_char(seqids.seq_28_jump_up_with_nothing_above);
  } else {
    seqtbl_offset_char(seqids.seq_14_jump_up_into_ceiling);
  }
}
function control_hanging() {
  if (g.Char.alive >= 0) {
    hang_fall();
    return;
  }
  if (g.grab_timer === 0 && g.control_y === CONTROL_HELD2) {
    can_climb_up();
  } else if (g.control_shift === CONTROL_HELD2) {
    if (g.Char.action !== actions.actions_6_hang_straight && (get_tile_at_char() === tiles.tiles_20_wall || g.Char.direction === directions.dir_FF_left && (g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop))) {
      if (g.grab_timer === 0) out.play_sound(soundids.sound_8_bumped);
      seqtbl_offset_char(seqids.seq_25_hang_against_wall);
    } else if (!tile_is_floor(get_tile_above_char())) {
      hang_fall();
    }
  } else {
    hang_fall();
  }
}
function can_climb_up() {
  let seq_id = seqids.seq_10_climb_up;
  g.control_up = release_arrows();
  g.control_shift2 = g.control_up;
  get_tile_above_char();
  if ((g.curr_tile2 === tiles.tiles_13_mirror || g.curr_tile2 === tiles.tiles_18_chomper) && g.Char.direction === directions.dir_0_right || g.curr_tile2 === tiles.tiles_4_gate && g.Char.direction !== directions.dir_0_right && g.curr_room_modif[g.curr_tilepos] >> 2 < 6) {
    seq_id = seqids.seq_73_climb_up_to_closed_gate;
  }
  seqtbl_offset_char(seq_id);
}
function hang_fall() {
  g.control_down = release_arrows();
  if (!tile_is_floor(get_tile_behind_char()) && !tile_is_floor(get_tile_at_char())) {
    seqtbl_offset_char(seqids.seq_23_release_ledge_and_fall);
    return;
  }
  if (get_tile_at_char() === tiles.tiles_20_wall || g.Char.direction < directions.dir_0_right && (g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop)) {
    g.Char.x = byteOf(char_dx_forward(-7));
  }
  seqtbl_offset_char(seqids.seq_11_release_ledge_and_land);
}
function grab_up_with_floor_behind() {
  const distance = distance_to_edge_weight();
  const edge_distance = get_edge_distance();
  if (distance < 4 && edge_distance < 4 && edge_type !== EDGE_TYPE_WALL) {
    g.Char.x = byteOf(char_dx_forward(distance));
    seqtbl_offset_char(seqids.seq_8_jump_up_and_grab_straight);
  } else {
    g.Char.x = byteOf(char_dx_forward(distance - 4));
    seqtbl_offset_char(seqids.seq_24_jump_up_and_grab_forward);
  }
}
function run_jump() {
  if (g.Char.frame >= frameids.frame_7_run) {
    const xpos = char_dx_forward(4);
    let col = get_tile_div_mod_m7(xpos);
    for (let tiles_forward = 0; tiles_forward < 2; ++tiles_forward) {
      col += [-1, 1][g.Char.direction + 1];
      get_tile(g.Char.room, col, g.Char.curr_row);
      if (g.curr_tile2 === tiles.tiles_2_spike || !tile_is_floor(g.curr_tile2)) {
        let pos_adjustment = distance_to_edge(xpos) + TILE_SIZEX2 * tiles_forward - TILE_SIZEX2;
        if (wordOf(pos_adjustment) < wordOf(-8) || pos_adjustment >= 2) {
          if (pos_adjustment < 128) return;
          pos_adjustment = -3;
        }
        g.Char.x = byteOf(char_dx_forward(pos_adjustment + 4));
        break;
      }
    }
    g.control_up = release_arrows();
    seqtbl_offset_char(seqids.seq_4_run_jump);
  }
}
function back_with_sword() {
  const frame = g.Char.frame;
  if (frame === frameids.frame_158_stand_with_sword || frame === frameids.frame_170_stand_with_sword || frame === frameids.frame_171_stand_with_sword) {
    g.control_backward = CONTROL_IGNORE2;
    seqtbl_offset_char(seqids.seq_57_back_with_sword);
  }
}
function forward_with_sword() {
  const frame = g.Char.frame;
  if (frame === frameids.frame_158_stand_with_sword || frame === frameids.frame_170_stand_with_sword || frame === frameids.frame_171_stand_with_sword) {
    g.control_forward = CONTROL_IGNORE2;
    if (g.Char.charid !== charids.charid_0_kid) {
      seqtbl_offset_char(seqids.seq_56_guard_forward_with_sword);
    } else {
      seqtbl_offset_char(seqids.seq_86_forward_with_sword);
    }
  }
}
function draw_sword() {
  let seq_id = seqids.seq_55_draw_sword;
  g.control_forward = release_arrows();
  g.control_shift2 = g.control_forward;
  if (g.Char.charid === charids.charid_0_kid) {
    out.play_sound(soundids.sound_19_draw_sword);
    g.offguard = 0;
  } else if (g.Char.charid !== charids.charid_1_shadow) {
    seq_id = seqids.seq_90_en_garde;
  }
  g.Char.sword = sword_status.sword_2_drawn;
  seqtbl_offset_char(seq_id);
}
function control_with_sword() {
  if (g.Char.action >= actions.actions_2_hang_climb) return;
  if (get_tile_at_char() === tiles.tiles_11_loose || g.can_guard_see_kid >= 2) {
    const distance = dist.char_opp_dist();
    if (wordOf(distance) < wordOf(90)) {
      swordfight();
      return;
    }
    if (distance < 0) {
      if (wordOf(distance) < wordOf(-4)) {
        seqtbl_offset_char(seqids.seq_60_turn_with_sword);
      } else {
        swordfight();
      }
      return;
    }
  }
  if (g.Char.charid === charids.charid_0_kid && g.Char.alive < 0) {
    g.holding_sword = 0;
  }
  if (g.Char.charid < charids.charid_2_guard) {
    if (g.Char.frame === frameids.frame_171_stand_with_sword) {
      g.Char.sword = sword_status.sword_0_sheathed;
      seqtbl_offset_char(seqids.seq_92_put_sword_away);
    }
  } else {
    swordfight();
  }
}
function swordfight() {
  let seq_id;
  const frame = g.Char.frame;
  const charid = g.Char.charid;
  if (frame === frameids.frame_161_parry && g.control_shift2 >= 0) {
    seqtbl_offset_char(seqids.seq_57_back_with_sword);
    return;
  }
  if (g.control_shift2 === CONTROL_HELD2) {
    if (charid === charids.charid_0_kid) g.kid_sword_strike = 15;
    sword_strike();
    if (g.control_shift2 === CONTROL_IGNORE2) return;
  }
  if (g.control_down === CONTROL_HELD2) {
    if (frame === frameids.frame_158_stand_with_sword || frame === frameids.frame_170_stand_with_sword || frame === frameids.frame_171_stand_with_sword) {
      g.control_down = CONTROL_IGNORE2;
      g.Char.sword = sword_status.sword_0_sheathed;
      if (charid === charids.charid_0_kid) {
        g.offguard = 1;
        g.guard_refrac = 9;
        g.holding_sword = 0;
        seq_id = seqids.seq_93_put_sword_away_fast;
      } else if (charid === charids.charid_1_shadow) {
        seq_id = seqids.seq_92_put_sword_away;
      } else {
        seq_id = seqids.seq_87_guard_become_inactive;
      }
      seqtbl_offset_char(seq_id);
    }
  } else if (g.control_up === CONTROL_HELD2) {
    parry();
  } else if (g.control_forward === CONTROL_HELD2) {
    forward_with_sword();
  } else if (g.control_backward === CONTROL_HELD2) {
    back_with_sword();
  }
}
function sword_strike() {
  const frame = g.Char.frame;
  let seq_id;
  if (frame === frameids.frame_157_walk_with_sword || frame === frameids.frame_158_stand_with_sword || frame === frameids.frame_170_stand_with_sword || frame === frameids.frame_171_stand_with_sword || frame === frameids.frame_165_walk_with_sword) {
    seq_id = g.Char.charid === charids.charid_0_kid ? seqids.seq_75_strike : seqids.seq_58_guard_strike;
  } else if (frame === frameids.frame_150_parry || frame === frameids.frame_161_parry) {
    seq_id = seqids.seq_66_strike_after_parry;
  } else {
    return;
  }
  g.control_shift2 = CONTROL_IGNORE2;
  seqtbl_offset_char(seq_id);
}
function parry() {
  const char_frame = g.Char.frame;
  const opp_frame = g.Opp.frame;
  const char_charid = g.Char.charid;
  let seq_id = seqids.seq_62_parry;
  let do_play_seq = false;
  if (char_frame === frameids.frame_158_stand_with_sword || char_frame === frameids.frame_170_stand_with_sword || char_frame === frameids.frame_171_stand_with_sword || char_frame === frameids.frame_168_back || char_frame === frameids.frame_165_walk_with_sword) {
    if (dist.char_opp_dist() >= 32 && char_charid !== charids.charid_0_kid) {
      back_with_sword();
      return;
    }
    if (char_charid === charids.charid_0_kid) {
      if (opp_frame === frameids.frame_168_back) return;
      if (opp_frame !== frameids.frame_151_strike_1 && opp_frame !== frameids.frame_152_strike_2 && opp_frame !== frameids.frame_162_block_to_strike) {
        if (opp_frame === frameids.frame_153_strike_3) do_play_seq = true;
      }
    } else if (opp_frame !== frameids.frame_152_strike_2) {
      return;
    }
  } else {
    if (char_frame !== frameids.frame_167_blocked) return;
    seq_id = seqids.seq_61_parry_after_strike;
  }
  g.control_up = CONTROL_IGNORE2;
  seqtbl_offset_char(seq_id);
  if (do_play_seq) play_seq();
}

// src/pop/seg009.ts
function prandom(max) {
  g.random_seed = Math.imul(g.random_seed, 214013) + 2531011 >>> 0;
  return (g.random_seed >>> 16) % (max + 1);
}
function set_seed(seed) {
  g.random_seed = seed >>> 0;
}

// src/pop/seg007.ts
var TROBS_MAX = 30;
var MOBS_MAX = 14;
var last_loose_sound = 0;
var curmob_index = 0;
var curr_tile_temp = 0;
var levelType = { of: (_level) => 0 };
function process_trobs() {
  let need_delete = false;
  if (g.trobs_count === 0) return;
  for (let index = 0; index < g.trobs_count; ++index) {
    g.trob = { ...g.trobs[index] };
    animate_tile();
    g.trobs[index].type = g.trob.type;
    if (g.trob.type < 0) need_delete = true;
  }
  if (need_delete) {
    let new_index = 0;
    for (let index = 0; index < g.trobs_count; ++index) {
      if (g.trobs[index].type >= 0) {
        g.trobs[new_index] = g.trobs[index];
        new_index++;
      }
    }
    g.trobs_count = new_index;
  }
}
function animate_tile() {
  l8.get_room_address.fn(g.trob.room);
  switch (get_curr_tile(g.trob.tilepos)) {
    case tiles.tiles_19_torch:
    case tiles.tiles_30_torch_with_debris:
      animate_torch();
      break;
    case tiles.tiles_6_closer:
    case tiles.tiles_15_opener:
      animate_button();
      break;
    case tiles.tiles_2_spike:
      animate_spike();
      break;
    case tiles.tiles_11_loose:
      animate_loose();
      break;
    case tiles.tiles_0_empty:
      animate_empty();
      break;
    case tiles.tiles_18_chomper:
      animate_chomper();
      break;
    case tiles.tiles_4_gate:
      animate_door();
      break;
    case tiles.tiles_16_level_door_left:
      animate_leveldoor();
      break;
    case tiles.tiles_10_potion:
      animate_potion();
      break;
    case tiles.tiles_22_sword:
      animate_sword();
      break;
    default:
      g.trob.type = -1;
      break;
  }
  g.curr_room_modif[g.trob.tilepos] = byteOf(g.curr_modifier);
}
function is_trob_in_drawn_room() {
  if (g.trob.room !== g.drawn_room) {
    g.trob.type = -1;
    return 0;
  }
  return 1;
}
function set_redraw_anim_right() {
  l8.set_redraw_anim.fn(get_trob_right_pos_in_drawn_room(), 1);
}
function set_redraw_anim_curr() {
  l8.set_redraw_anim.fn(get_trob_pos_in_drawn_room(), 1);
}
function redraw_at_trob() {
  g.redraw_height = 63;
  const tilepos = get_trob_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
}
function redraw_21h() {
  g.redraw_height = 33;
  redraw_tile_height();
}
function redraw_11h() {
  g.redraw_height = 17;
  redraw_tile_height();
}
function redraw_20h() {
  g.redraw_height = 32;
  redraw_tile_height();
}
function draw_trob() {
  const tilepos = get_trob_right_pos_in_drawn_room();
  l8.set_redraw_anim.fn(tilepos, 1);
  l8.set_redraw_fore.fn(tilepos, 1);
  l8.set_redraw_anim.fn(get_trob_right_above_pos_in_drawn_room(), 1);
}
function redraw_tile_height() {
  let tilepos = get_trob_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
  tilepos = get_trob_right_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
}
function get_trob_pos_in_drawn_room() {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.room_A) {
    if (tilepos >= 20 && tilepos < 30) tilepos = 19 - tilepos;
    else tilepos = 30;
  } else if (g.trob.room !== g.drawn_room) {
    tilepos = 30;
  }
  return tilepos;
}
function get_trob_right_pos_in_drawn_room() {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.drawn_room) {
    if (tilepos % 10 !== 9) ++tilepos;
    else tilepos = 30;
  } else if (g.trob.room === g.room_L) {
    if (tilepos % 10 === 9) tilepos -= 9;
    else tilepos = 30;
  } else if (g.trob.room === g.room_A) {
    if (tilepos >= 20 && tilepos < 29) tilepos = 18 - tilepos;
    else tilepos = 30;
  } else if (g.trob.room === g.room_AL && tilepos === 29) {
    tilepos = -1;
  } else {
    tilepos = 30;
  }
  return tilepos;
}
function get_trob_right_above_pos_in_drawn_room() {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.drawn_room) {
    if (tilepos % 10 !== 9) {
      if (tilepos < 10) tilepos = -(tilepos + 2);
      else tilepos -= 9;
    } else {
      tilepos = 30;
    }
  } else if (g.trob.room === g.room_L) {
    if (tilepos === 9) tilepos = -1;
    else if (tilepos % 10 === 9) tilepos -= 19;
    else tilepos = 30;
  } else if (g.trob.room === g.room_B) {
    if (tilepos < 9) tilepos += 21;
    else tilepos = 30;
  } else if (g.trob.room === g.room_BL && tilepos === 9) {
    tilepos = 20;
  } else {
    tilepos = 30;
  }
  return tilepos;
}
function animate_torch() {
  if (g.trob.room === g.drawn_room || g.trob.room === g.room_L && g.trob.tilepos % 10 === 9) {
    g.curr_modifier = get_torch_frame(g.curr_modifier);
    set_redraw_anim_right();
  } else {
    g.trob.type = -1;
  }
}
function animate_potion() {
  if (g.trob.type >= 0 && is_trob_in_drawn_room()) {
    const type = g.curr_modifier & 248;
    g.curr_modifier = bubble_next_frame(g.curr_modifier & 7) | type;
    set_redraw_anim_curr();
  }
}
function animate_sword() {
  if (is_trob_in_drawn_room()) {
    --g.curr_modifier;
    if (g.curr_modifier === 0) g.curr_modifier = (prandom(255) & 63) + 40;
    set_redraw_anim_curr();
  }
}
function animate_chomper() {
  if (g.trob.type >= 0) {
    const blood = g.curr_modifier & 128;
    let frame = (g.curr_modifier & 127) + 1;
    if (frame > 15) frame = 1;
    g.curr_modifier = blood | frame;
    if (frame === 2) out.play_sound(soundids.sound_47_chomper);
    if ((g.trob.room !== g.drawn_room || Math.trunc(g.trob.tilepos / 10) !== g.Kid.curr_row || g.Kid.alive >= 0 && blood === 0) && (g.curr_modifier & 127) >= 6) {
      g.trob.type = -1;
    }
  }
  if ((g.curr_modifier & 127) < 6) redraw_at_trob();
}
function animate_spike() {
  if (g.trob.type >= 0) {
    if (g.curr_modifier === 255) return;
    if (g.curr_modifier & 128) {
      --g.curr_modifier;
      if (g.curr_modifier & 127) return;
      g.curr_modifier = 6;
    } else {
      ++g.curr_modifier;
      if (g.curr_modifier === 5) {
        g.curr_modifier = 143;
      } else if (g.curr_modifier === 9) {
        g.curr_modifier = 0;
        g.trob.type = -1;
      }
    }
  }
  redraw_21h();
}
function animate_door() {
  let anim_type = g.trob.type;
  if (anim_type >= 0) {
    if (anim_type >= 3) {
      if (anim_type < 8) {
        ++anim_type;
        g.trob.type = anim_type;
      }
      const new_mod = g.curr_modifier - gate_close_speeds[anim_type];
      g.curr_modifier = new_mod;
      if (new_mod < 0) {
        g.curr_modifier = 0;
        g.trob.type = -1;
        out.play_sound(soundids.sound_6_gate_closing_fast);
      }
    } else if (g.curr_modifier !== 255) {
      g.curr_modifier = byteOf(g.curr_modifier + door_delta[anim_type]);
      if (anim_type === 0) {
        if (g.curr_modifier !== 0) {
          if (g.curr_modifier < 188 && (g.curr_modifier & 3) === 3) {
            play_door_sound_if_visible(soundids.sound_4_gate_closing);
          }
        } else {
          gate_stop();
        }
      } else if (g.curr_modifier < 188) {
        if ((g.curr_modifier & 7) === 0) out.play_sound(soundids.sound_5_gate_opening);
      } else if (anim_type < 2) {
        g.curr_modifier = 238;
        g.trob.type = 0;
        out.play_sound(soundids.sound_7_gate_stop);
      } else {
        g.curr_modifier = 255;
        gate_stop();
      }
    } else {
      gate_stop();
    }
  }
  draw_trob();
}
function gate_stop() {
  g.trob.type = -1;
  play_door_sound_if_visible(soundids.sound_7_gate_stop);
}
function animate_leveldoor() {
  if (g.trob.type >= 0) {
    if (g.trob.type >= 3) {
      ++g.trob.type;
      g.curr_modifier = byteOf(g.curr_modifier - leveldoor_close_speeds[g.trob.type - 3]);
      if (sbyteOf(g.curr_modifier) < 0) {
        g.curr_modifier = 0;
        g.trob.type = -1;
        out.play_sound(soundids.sound_14_leveldoor_closing);
      } else if (g.trob.type === 4) {
        out.play_sound(soundids.sound_15_leveldoor_sliding);
      }
    } else {
      ++g.curr_modifier;
      if (g.curr_modifier >= 43) {
        g.trob.type = -1;
        out.stop_sounds();
        if (g.leveldoor_open === 0 || g.leveldoor_open === 2) {
          g.leveldoor_open = 1;
          if (g.current_level === 4) {
            get_tile(4, 4, 0);
            g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_13_mirror;
          }
        }
      } else {
        out.play_sound(soundids.sound_15_leveldoor_sliding);
      }
    }
  }
  set_redraw_anim_right();
}
function bubble_next_frame(curr) {
  const next = curr + 1;
  return next >= 8 ? 1 : next;
}
function get_torch_frame(curr) {
  let next = prandom(255);
  if (next !== curr) {
    if (next < 9) return next;
    next = curr;
  }
  ++next;
  if (next >= 9) next = 0;
  return next;
}
function set_redraw_anim(tilepos, frames) {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_anim[tilepos] = frames;
    }
  }
}
function set_redraw2(tilepos, frames) {
  if (tilepos < 30) {
    if (tilepos < 0) {
      tilepos = -tilepos - 1;
      if (tilepos > 9) tilepos = 9;
      g.redraw_frames_above[tilepos] = frames;
    } else {
      g.redraw_frames2[tilepos] = frames;
    }
  }
}
function set_redraw_floor_overlay(tilepos, frames) {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_floor_overlay[tilepos] = frames;
    }
  }
}
function set_redraw_full(tilepos, frames) {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_full[tilepos] = frames;
    }
  }
}
function set_redraw_fore(tilepos, frames) {
  if (tilepos < 30 && tilepos >= 0) g.redraw_frames_fore[tilepos] = frames;
}
function set_wipe(tilepos, frames) {
  if (tilepos < 30 && tilepos >= 0) {
    if (g.wipe_frames[tilepos] !== 0) {
      g.redraw_height = Math.max(g.wipe_heights[tilepos], g.redraw_height);
    }
    g.wipe_heights[tilepos] = g.redraw_height;
    g.wipe_frames[tilepos] = frames;
  }
}
function start_anim_torch(room, tilepos) {
  g.curr_room_modif[tilepos] = prandom(8);
  add_trob(room, tilepos, 1);
}
function start_anim_potion(room, tilepos) {
  g.curr_room_modif[tilepos] &= 248;
  g.curr_room_modif[tilepos] |= prandom(6) + 1;
  add_trob(room, tilepos, 1);
}
function start_anim_sword(room, tilepos) {
  g.curr_room_modif[tilepos] = prandom(255) & 31;
  add_trob(room, tilepos, 1);
}
function start_anim_chomper(room, tilepos, modifier) {
  const old_modifier = g.curr_room_modif[tilepos];
  if (old_modifier === 0 || old_modifier >= 6) {
    g.curr_room_modif[tilepos] = byteOf(modifier);
    add_trob(room, tilepos, 1);
  }
}
function start_anim_spike(room, tilepos) {
  const old_modifier = sbyteOf(g.curr_room_modif[tilepos]);
  if (old_modifier <= 0) {
    if (old_modifier === 0) {
      add_trob(room, tilepos, 1);
      out.play_sound(soundids.sound_49_spikes);
    } else if (old_modifier !== -1) {
      g.curr_room_modif[tilepos] = 143;
    }
  }
}
function trigger_gate(_room, tilepos, button_type) {
  const modifier = g.curr_room_modif[tilepos];
  if (button_type === tiles.tiles_15_opener) {
    if (modifier === 255) return -1;
    if (modifier >= 188) {
      g.curr_room_modif[tilepos] = 238;
      return -1;
    }
    g.curr_room_modif[tilepos] = modifier + 3 & 252;
    return 1;
  }
  if (button_type === tiles.tiles_14_debris) {
    if (modifier < 188) return 2;
    g.curr_room_modif[tilepos] = 255;
    return -1;
  }
  return modifier !== 0 ? 3 : -1;
}
function trigger_1(target_type, room, tilepos, button_type) {
  if (target_type === tiles.tiles_4_gate) return trigger_gate(room, tilepos, button_type);
  if (target_type === tiles.tiles_16_level_door_left) {
    return g.curr_room_modif[tilepos] !== 0 ? -1 : 1;
  }
  return -1;
}
function do_trigger_list(index, button_type) {
  for (; ; ) {
    const room = get_doorlink_room(index);
    l8.get_room_address.fn(room);
    const tilepos = get_doorlink_tile(index);
    const target_type = g.curr_room_tiles[tilepos] & 31;
    const trigger_result = trigger_1(target_type, room, tilepos, button_type);
    if (trigger_result >= 0) add_trob(room, tilepos, trigger_result);
    if (get_doorlink_next(index) === 0) break;
    index++;
  }
}
function add_trob(room, tilepos, type) {
  if (g.trobs_count >= TROBS_MAX) return;
  g.trob = { room, tilepos, type };
  const found = find_trob();
  if (found === -1) {
    g.trobs[g.trobs_count] = { ...g.trob };
    g.trobs_count++;
  } else {
    g.trobs[found].type = g.trob.type;
  }
}
function find_trob() {
  for (let index = 0; index < g.trobs_count; ++index) {
    if (g.trobs[index].tilepos === g.trob.tilepos && g.trobs[index].room === g.trob.room) {
      return index;
    }
  }
  return -1;
}
function clear_tile_wipes() {
  g.redraw_frames_full.fill(0);
  g.wipe_frames.fill(0);
  g.wipe_heights.fill(0);
  g.redraw_frames_anim.fill(0);
  g.redraw_frames_fore.fill(0);
  g.redraw_frames2.fill(0);
  g.redraw_frames_floor_overlay.fill(0);
  g.tile_object_redraw.fill(0);
  g.redraw_frames_above.fill(0);
}
function get_doorlink_timer(index) {
  return g.level.doorlinks2[index] & 31;
}
function set_doorlink_timer(index, value) {
  g.level.doorlinks2[index] &= 224;
  g.level.doorlinks2[index] |= value & 31;
  return g.level.doorlinks2[index];
}
function get_doorlink_tile(index) {
  return g.level.doorlinks1[index] & 31;
}
function get_doorlink_next(index) {
  return g.level.doorlinks1[index] & 128 ? 0 : 1;
}
function get_doorlink_room(index) {
  return ((g.level.doorlinks1[index] & 96) >> 5) + ((g.level.doorlinks2[index] & 224) >> 3);
}
function trigger_button(playsound, button_type, modifier) {
  get_curr_tile(g.curr_tilepos);
  if (button_type === 0) button_type = g.curr_tile;
  if (modifier === -1) modifier = g.curr_modifier;
  const link_timer = get_doorlink_timer(modifier);
  if (link_timer !== 31) {
    set_doorlink_timer(modifier, 5);
    if (link_timer < 2) {
      add_trob(g.curr_room, g.curr_tilepos, 1);
      redraw_11h();
      g.is_guard_notice = 1;
      if (playsound) out.play_sound(soundids.sound_3_button_pressed);
    }
    do_trigger_list(modifier, button_type);
  }
}
function died_on_button() {
  let button_type = get_curr_tile(g.curr_tilepos);
  const modifier = g.curr_modifier;
  if (g.curr_tile === tiles.tiles_15_opener) {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.curr_room_modif[g.curr_tilepos] = 0;
    button_type = tiles.tiles_14_debris;
  } else {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_5_stuck;
  }
  trigger_button(1, button_type, modifier);
}
function animate_button() {
  if (g.trob.type >= 0) {
    const timer = get_doorlink_timer(g.curr_modifier) - 1;
    set_doorlink_timer(g.curr_modifier, timer);
    if (timer < 2) {
      g.trob.type = -1;
      redraw_11h();
    }
  }
}
function start_level_door(room, tilepos) {
  g.curr_room_modif[tilepos] = 43;
  add_trob(room, tilepos, 3);
}
function animate_empty() {
  g.trob.type = -1;
  redraw_20h();
}
function animate_loose() {
  const anim_type = g.trob.type;
  if (anim_type >= 0) {
    ++g.curr_modifier;
    if (g.curr_modifier & 128) {
      if (g.current_level === 13) return;
      if (g.curr_modifier >= 132) {
        g.curr_modifier = 0;
        g.trob.type = -1;
      }
      loose_shake(g.curr_modifier ? 0 : 1);
    } else if (g.curr_modifier >= 11) {
      const room = g.trob.room;
      const tilepos = g.trob.tilepos;
      g.curr_modifier = remove_loose(room, tilepos);
      g.trob.type = -1;
      const row = Math.trunc(tilepos / 10);
      g.curmob = {
        xh: tilepos % 10 << 2,
        y: y_loose_land[row + 1],
        room,
        speed: 0,
        type: 0,
        row
      };
      add_mob();
    } else {
      loose_shake(0);
    }
  }
  redraw_20h();
}
function loose_shake(arg_0) {
  if (arg_0 || loose_sound[g.curr_modifier & 127]) {
    let sound_id;
    do {
      sound_id = prandom(2) + soundids.sound_20_loose_shake_1;
    } while (sound_id === last_loose_sound);
    prandom(2);
    last_loose_sound = sound_id;
    out.play_sound(sound_id);
  }
}
function remove_loose(_room, tilepos) {
  g.curr_room_tiles[tilepos] = tiles.tiles_0_empty;
  return levelType.of(g.current_level);
}
function make_loose_fall(modifier) {
  if ((g.curr_room_tiles[g.curr_tilepos] & 32) === 0) {
    if (sbyteOf(g.curr_room_modif[g.curr_tilepos]) <= 0) {
      g.curr_room_modif[g.curr_tilepos] = modifier;
      add_trob(g.curr_room, g.curr_tilepos, 0);
      redraw_20h();
    }
  }
}
function start_chompers() {
  let timing = 15;
  if (byteOf(g.Char.curr_row) < 3) {
    l8.get_room_address.fn(g.Char.room);
    let tilepos = tbl_line[g.Char.curr_row];
    for (let column = 0; column < 10; ++column, ++tilepos) {
      if (get_curr_tile(tilepos) === tiles.tiles_18_chomper) {
        const modifier = g.curr_modifier & 127;
        if (modifier === 0 || modifier >= 6) {
          start_anim_chomper(g.Char.room, tilepos, timing | g.curr_modifier & 128);
          timing = next_chomper_timing(timing);
        }
      }
    }
  }
}
function next_chomper_timing(timing) {
  timing -= 3;
  if (timing < 6) timing += 10;
  return timing;
}
function loose_make_shake() {
  if (g.curr_room_modif[g.curr_tilepos] === 0 && g.current_level !== 13) {
    g.curr_room_modif[g.curr_tilepos] = 128;
    add_trob(g.curr_room, g.curr_tilepos, 1);
  }
}
function do_knock(room, tile_row) {
  for (let tile_col = 0; tile_col < 10; ++tile_col) {
    if (get_tile(room, tile_col, tile_row) === tiles.tiles_11_loose) loose_make_shake();
  }
}
function add_mob() {
  if (g.mobs_count >= MOBS_MAX) return;
  g.mobs[g.mobs_count] = { ...g.curmob };
  g.mobs_count++;
}
function get_curr_tile(tilepos) {
  g.curr_modifier = g.curr_room_modif[tilepos];
  g.curr_tile = g.curr_room_tiles[tilepos] & 31;
  return g.curr_tile;
}
function do_mobs() {
  const n_mobs = g.mobs_count;
  for (curmob_index = 0; n_mobs > curmob_index; ++curmob_index) {
    g.curmob = { ...g.mobs[curmob_index] };
    move_mob();
    check_loose_fall_on_kid();
    g.mobs[curmob_index] = { ...g.curmob };
  }
  let new_index = 0;
  for (let index = 0; index < g.mobs_count; ++index) {
    if (g.mobs[index].speed !== -1) {
      g.mobs[new_index] = g.mobs[index];
      new_index++;
    }
  }
  g.mobs_count = new_index;
}
function move_mob() {
  if (g.curmob.type === 0) move_loose();
  if (g.curmob.speed <= 0) ++g.curmob.speed;
}
function move_loose() {
  if (g.curmob.speed < 0) return;
  if (g.curmob.speed < 29) g.curmob.speed += 3;
  g.curmob.y += g.curmob.speed;
  if (g.curmob.room === 0) {
    if (g.curmob.y >= 210) g.curmob.speed = -2;
    return;
  }
  if (g.curmob.y < 226 && y_something[g.curmob.row + 1] <= g.curmob.y) {
    curr_tile_temp = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
    if (curr_tile_temp === tiles.tiles_11_loose) loose_fall();
    if (curr_tile_temp === tiles.tiles_0_empty || curr_tile_temp === tiles.tiles_11_loose) {
      mob_down_a_row();
      return;
    }
    out.play_sound(soundids.sound_2_tile_crashing);
    do_knock(g.curmob.room, g.curmob.row);
    g.curmob.y = y_something[g.curmob.row + 1];
    g.curmob.speed = -2;
    loose_land();
  }
}
function loose_land() {
  let button_type = 0;
  let tiletype = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
  if (tiletype === tiles.tiles_15_opener) {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_14_debris;
    button_type = tiles.tiles_14_debris;
  }
  if (tiletype === tiles.tiles_15_opener || tiletype === tiles.tiles_6_closer) {
    trigger_button(1, button_type, -1);
    tiletype = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
  }
  if (tiletype === tiles.tiles_15_opener || tiletype === tiles.tiles_6_closer || tiletype === tiles.tiles_1_floor || tiletype === tiles.tiles_2_spike || tiletype === tiles.tiles_10_potion || tiletype === tiles.tiles_19_torch || tiletype === tiles.tiles_30_torch_with_debris) {
    if (tiletype === tiles.tiles_19_torch || tiletype === tiles.tiles_30_torch_with_debris) {
      g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_30_torch_with_debris;
    } else {
      g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_14_debris;
    }
    redraw_at_cur_mob();
    if (g.tile_col !== 0) set_redraw_full(g.curr_tilepos - 1, 1);
  }
}
function loose_fall() {
  g.curr_room_modif[g.curr_tilepos] = remove_loose(g.curr_room, g.curr_tilepos);
  g.curmob.speed >>= 1;
  g.mobs[curmob_index] = { ...g.curmob };
  g.curmob.y += 6;
  mob_down_a_row();
  add_mob();
  g.curmob = { ...g.mobs[curmob_index] };
  redraw_at_cur_mob();
}
function redraw_at_cur_mob() {
  if (g.curmob.room === g.drawn_room) {
    g.redraw_height = 32;
    set_redraw_full(g.curr_tilepos, 1);
    set_wipe(g.curr_tilepos, 1);
    if (g.curr_tilepos % 10 + 1 < 10) {
      set_redraw_full(g.curr_tilepos + 1, 1);
      set_wipe(g.curr_tilepos + 1, 1);
    }
  }
}
function mob_down_a_row() {
  ++g.curmob.row;
  if (g.curmob.row >= 3) {
    g.curmob.y -= 192;
    g.curmob.row = 0;
    g.curmob.room = g.level.roomlinks[g.curmob.room - 1].down;
  }
}
function draw_mobs() {
  for (let index = 0; index < g.mobs_count; ++index) {
    g.curmob = { ...g.mobs[index] };
    draw_mob();
  }
}
function draw_mob() {
  let ypos = g.curmob.y;
  if (g.curmob.room === g.drawn_room) {
    if (g.curmob.y >= 210) return;
  } else if (g.curmob.room === g.room_B) {
    if (Math.abs(sbyteOf(ypos)) >= 18) return;
    g.curmob.y += 192;
    ypos = g.curmob.y;
  } else if (g.curmob.room === g.room_A) {
    if (g.curmob.y < 174) return;
    ypos = g.curmob.y - 189;
  } else {
    return;
  }
  let tile_col = g.curmob.xh >> 2;
  const tile_row = y_to_row_mod4(ypos);
  g.obj_tilepos = get_tilepos_nominus(tile_col, tile_row);
  ++tile_col;
  let tilepos = get_tilepos(tile_col, tile_row);
  set_redraw2(tilepos, 1);
  set_redraw_fore(tilepos, 1);
  const top_row = y_to_row_mod4(ypos - 18);
  if (top_row !== tile_row) {
    tilepos = get_tilepos(tile_col, top_row);
    set_redraw2(tilepos, 1);
    set_redraw_fore(tilepos, 1);
  }
  add_mob_to_objtable(ypos);
}
function add_mob_to_objtable(ypos) {
  g.objtable.push({
    obj_type: g.curmob.type | 128,
    xh: g.curmob.xh,
    xl: 0,
    y: ypos,
    chtab_id: 6,
    // id_chtab_6_environment
    id: 10,
    direction: 0,
    clip: { top: 0, bottom: 0, left: 0, right: 40 },
    tilepos: 30
  });
  g.objtable_count = g.objtable.length;
  l8.mark_obj_tile_redraw.fn(g.objtable.length - 1);
}
function is_spike_harmful() {
  const modifier = sbyteOf(g.curr_room_modif[g.curr_tilepos]);
  if (modifier === 0 || modifier === -1) return 0;
  if (modifier < 0) return 1;
  if (modifier < 5) return 2;
  return 0;
}
function check_loose_fall_on_kid() {
  loadkid();
  if (g.Char.room === g.curmob.room && g.Char.curr_col === g.curmob.xh >> 2 && g.curmob.y < g.Char.y && g.Char.y - 30 < g.curmob.y) {
    fell_on_your_head();
    savekid();
  }
}
function fell_on_your_head() {
  const frame = g.Char.frame;
  const action = g.Char.action;
  if ((g.current_level === 13 || frame < frameids.frame_5_start_run || frame >= 15) && (action < actions.actions_2_hang_climb || action === actions.actions_7_turn)) {
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    if (take_hp(1)) {
      l5.seqtbl_offset_char.fn(seqids.seq_22_crushed);
      if (frame === frameids.frame_177_spiked) {
        g.Char.x = byteOf(char_dx_forward(-12));
      }
    } else if (frame !== frameids.frame_109_crouch) {
      if (get_tile_behind_char() === 0) g.Char.x = byteOf(char_dx_forward(-2));
      l5.seqtbl_offset_char.fn(seqids.seq_52_loose_floor_fell_on_kid);
    }
  }
}
function play_door_sound_if_visible(sound_id) {
  const tilepos = g.trob.tilepos;
  const gate_room = g.trob.room;
  const has_sound = gate_room === g.room_L ? tilepos % 10 === 9 : gate_room === g.drawn_room && tilepos % 10 !== 9;
  if (has_sound) out.play_sound(sound_id);
}

// src/pop/seg003.ts
var TILE_SIZEX3 = 14;
var TILE_MIDX2 = 7;
var FIRST_ONSCREEN_COLUMN4 = 5;
var SCREEN_TILECOUNTX2 = 10;
var ROOMCOUNT = 24;
var distance_mirror = 0;
var dist2 = { char_opp_dist: () => 0 };
var rooms = { goto_other_room: (_direction) => {
} };
function do_startpos() {
  if (g.current_level === 3 && g.checkpoint) {
    g.level.start_dir = directions.dir_FF_left;
    g.level.start_room = 2;
    g.level.start_pos = 6;
    get_tile(7, 4, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_0_empty;
  }
  g.Char.room = g.level.start_room;
  g.next_room = g.Char.room;
  let x = g.level.start_pos;
  g.Char.curr_col = x % SCREEN_TILECOUNTX2;
  g.Char.curr_row = Math.trunc(x / SCREEN_TILECOUNTX2);
  g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN4] + TILE_SIZEX3);
  g.Char.direction = ~g.level.start_dir;
  x = g.hitp_beg_lev;
  g.hitp_max = x;
  g.hitp_curr = x;
  if (g.current_level === 1) {
    get_tile(5, 2, 0);
    trigger_button(0, 0, -1);
    seqtbl_offset_char(seqids.seq_7_fall);
  } else if (g.current_level === 13) {
    seqtbl_offset_char(seqids.seq_84_run);
  } else {
    seqtbl_offset_char(seqids.seq_5_turn);
  }
  set_start_pos();
}
function set_start_pos() {
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.alive = -1;
  g.Char.charid = charids.charid_0_kid;
  g.is_screaming = 0;
  g.knock = 0;
  g.upside_down = 0;
  g.is_feather_fall = 0;
  g.Char.fall_y = 0;
  g.Char.fall_x = 0;
  g.offguard = 0;
  g.Char.sword = sword_status.sword_0_sheathed;
  play_seq();
  if (g.current_level === 7 && g.Char.room === 17) {
    rooms.goto_other_room(3);
  }
  savekid();
}
function find_start_level_door() {
  l8.get_room_address.fn(g.Kid.room);
  for (let tilepos = 0; tilepos < 30; ++tilepos) {
    if ((g.curr_room_tiles[tilepos] & 31) === tiles.tiles_16_level_door_left) {
      start_level_door(g.Kid.room, tilepos);
    }
  }
}
function redraw_at_char() {
  if (g.Char.sword >= sword_status.sword_2_drawn) {
    if (g.Char.direction >= directions.dir_0_right) {
      ++g.char_col_right;
      if (g.char_col_right > 9) g.char_col_right = 9;
    } else {
      --g.char_col_left;
      if (g.char_col_left < 0) g.char_col_left = 0;
    }
  }
  let x_top_row;
  let x_col_right;
  let x_col_left;
  if (g.Char.charid === charids.charid_0_kid) {
    x_top_row = Math.min(g.char_top_row, g.prev_char_top_row);
    x_col_right = Math.max(g.char_col_right, g.prev_char_col_right);
    x_col_left = Math.min(g.char_col_left, g.prev_char_col_left);
  } else {
    x_top_row = g.char_top_row;
    x_col_right = g.char_col_right;
    x_col_left = g.char_col_left;
  }
  for (let tile_row = x_top_row; tile_row <= g.char_bottom_row; ++tile_row) {
    for (let tile_col = x_col_left; tile_col <= x_col_right; ++tile_col) {
      l8.set_redraw_fore.fn(get_tilepos(tile_col, tile_row), 1);
    }
  }
  if (g.Char.charid === charids.charid_0_kid) {
    g.prev_char_top_row = g.char_top_row;
    g.prev_char_col_right = g.char_col_right;
    g.prev_char_col_left = g.char_col_left;
  }
}
function redraw_at_char2() {
  const char_action = g.Char.action;
  const char_frame = g.Char.frame;
  let redraw_func = l8.set_redraw2.fn;
  if (char_frame < frameids.frame_78_jumphang || char_frame >= frameids.frame_80_jumphang) {
    if (char_frame >= frameids.frame_137_climbing_3 && char_frame < frameids.frame_145_climbing_11) {
      redraw_func = l8.set_redraw_floor_overlay.fn;
    } else if (char_action !== actions.actions_2_hang_climb && char_action !== actions.actions_3_in_midair && char_action !== actions.actions_4_in_freefall && char_action !== actions.actions_6_hang_straight && (char_action !== actions.actions_5_bumped || char_frame < frameids.frame_102_start_fall_1 || char_frame > frameids.frame_106_fall)) {
      return;
    }
  }
  for (g.tile_col = g.char_col_right; g.tile_col >= g.char_col_left; --g.tile_col) {
    if (char_action !== 2) {
      redraw_func(get_tilepos(g.tile_col, g.char_bottom_row), 1);
    }
    if (g.char_top_row !== g.char_bottom_row) {
      redraw_func(get_tilepos(g.tile_col, g.char_top_row), 1);
    }
  }
}
function check_knock() {
  if (g.knock) {
    do_knock(g.Char.room, g.Char.curr_row - (g.knock > 0 ? 1 : 0));
    g.knock = 0;
  }
}
function timers() {
  if (g.united_with_shadow > 0) {
    --g.united_with_shadow;
    if (g.united_with_shadow === 0) --g.united_with_shadow;
  }
  if (g.guard_notice_timer > 0) --g.guard_notice_timer;
  if (g.resurrect_time > 0) --g.resurrect_time;
  if (g.is_feather_fall) g.is_feather_fall++;
  if (g.is_feather_fall && (!out.check_sound_playing() || g.is_feather_fall > 225)) {
    g.is_feather_fall = 0;
  }
  if (g.current_level === 8 && g.Char.room === 16 && g.leveldoor_open) {
    ++g.leveldoor_open;
    if (g.leveldoor_open === 150) do_mouse();
  }
}
function check_mirror() {
  if (g.jumped_through_mirror === -1) {
    jump_through_mirror();
  }
}
function jump_through_mirror() {
  g.jumped_through_mirror = 0;
  loadkid();
  check_mirror_image();
  g.Guard.charid = charids.charid_1_shadow;
  g.guardhp_max = g.hitp_max;
  g.guardhp_curr = g.guardhp_max;
  copyChar(g.Guard, g.Char);
  loadkid();
}
function check_mirror_image() {
  const xpos = x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN4] + 10;
  let distance = distance_to_edge_weight();
  if (g.Char.direction >= directions.dir_0_right) {
    distance = ~distance + TILE_SIZEX3;
  }
  distance_mirror = distance - 2;
  g.Char.x = byteOf((xpos << 1) - g.Char.x);
  g.Char.direction = ~g.Char.direction;
}
function bump_into_opponent() {
  if (g.can_guard_see_kid >= 2 && g.Char.sword === sword_status.sword_0_sheathed && g.Opp.sword !== sword_status.sword_0_sheathed && g.Opp.action < 2 && g.Char.direction !== g.Opp.direction) {
    const distance = dist2.char_opp_dist();
    if (Math.abs(distance) <= 15) {
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
      seqtbl_offset_char(seqids.seq_47_bump);
      play_seq();
    }
  }
}
function pos_guards() {
  for (let room1 = 0; room1 < ROOMCOUNT; ++room1) {
    const guard_tile = g.level.guards_tile[room1];
    if (guard_tile < 30) {
      g.level.guards_x[room1] = byteOf(
        x_bump[guard_tile % 10 + FIRST_ONSCREEN_COLUMN4] + TILE_SIZEX3
      );
      g.level.guards_seq_hi[room1] = 0;
    }
  }
}
function check_can_guard_see_kid() {
  const kid_frame = g.Kid.frame;
  if (g.Guard.charid === charids.charid_24_mouse) {
    g.can_guard_see_kid = 0;
    return;
  }
  if ((g.Guard.charid !== charids.charid_1_shadow || g.current_level === 12) && kid_frame !== 0 && (kid_frame < frameids.frame_219_exit_stairs_3 || kid_frame >= 229) && g.Guard.direction !== directions.dir_56_none && g.Kid.alive < 0 && g.Guard.alive < 0 && g.Kid.room === g.Guard.room && g.Kid.curr_row === g.Guard.curr_row) {
    g.can_guard_see_kid = 2;
    let left_pos = x_bump[g.Kid.curr_col + FIRST_ONSCREEN_COLUMN4] + TILE_MIDX2;
    let right_pos = x_bump[g.Guard.curr_col + FIRST_ONSCREEN_COLUMN4] + TILE_MIDX2;
    if (left_pos > right_pos) {
      const temp = left_pos;
      left_pos = right_pos;
      right_pos = temp;
    }
    if (get_tile_at_kid(left_pos) === tiles.tiles_18_chomper) left_pos += TILE_SIZEX3;
    if (get_tile_at_kid(right_pos) === tiles.tiles_4_gate) right_pos -= TILE_SIZEX3;
    while (left_pos <= right_pos) {
      if (get_tile_at_kid(left_pos) === tiles.tiles_20_wall || g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop) {
        g.can_guard_see_kid = 0;
        return;
      }
      if (g.curr_tile2 === tiles.tiles_11_loose || g.curr_tile2 === tiles.tiles_18_chomper || g.curr_tile2 === tiles.tiles_4_gate && g.curr_room_modif[g.curr_tilepos] < 112 || !tile_is_floor(g.curr_tile2)) {
        g.can_guard_see_kid = 1;
      }
      left_pos += TILE_SIZEX3;
    }
  } else {
    g.can_guard_see_kid = 0;
  }
}
function get_tile_at_kid(xpos) {
  return get_tile(g.Kid.room, get_tile_div_mod_m7(xpos), g.Kid.curr_row);
}
function do_mouse() {
  loadkid();
  g.Char.charid = charids.charid_24_mouse;
  g.Char.x = 200;
  g.Char.curr_row = 0;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.alive = -1;
  g.Char.direction = directions.dir_FF_left;
  g.guardhp_curr = 1;
  seqtbl_offset_char(seqids.seq_105_mouse_forward);
  play_seq();
  copyChar(g.Guard, g.Char);
  loadkid();
}

// src/pop/seg002.ts
var TILE_SIZEX4 = 14;
var TILE_MIDX3 = 7;
var FIRST_ONSCREEN_COLUMN5 = 5;
var SCREEN_TILECOUNTX3 = 10;
var NUM_GUARD_SKILLS = 12;
var CONTROL_HELD3 = -1;
var CONTROL_IGNORE3 = 1;
var CONTROL_RELEASED3 = 0;
var CONTROL_HELD_FORWARD3 = -1;
var CONTROL_HELD_BACKWARD3 = 1;
var CONTROL_HELD_UP3 = -1;
var CONTROL_HELD_DOWN3 = 1;
var guards = {
  hp: (_level) => 0,
  type: (_level) => 0
};
var curr_guard_color = 0;
var guardColor = { value: 0 };
function char_opp_dist() {
  if (g.Char.room !== g.Opp.room) return 999;
  let distance = g.Opp.x - g.Char.x;
  if (g.Char.direction < directions.dir_0_right) distance = -distance;
  if (distance >= 0 && g.Char.direction !== g.Opp.direction) distance += 13;
  return distance;
}
function clear_char() {
  g.Char.direction = directions.dir_56_none;
  g.Char.alive = 0;
  g.Char.action = 0;
  g.guardhp_curr = 0;
}
function inc_curr_row() {
  ++g.Char.curr_row;
}
function on_guard_killed() {
  if (g.current_level === 13) {
    g.flash_color = 15;
    g.flash_time = 18;
    g.leveldoor_open = 2;
    out.play_sound(soundids.sound_43_victory_Jaffar);
  } else if (g.Char.charid !== charids.charid_1_shadow) {
    out.play_sound(soundids.sound_37_victory);
  }
}
function load_room_links() {
  g.room_BR = 0;
  g.room_BL = 0;
  g.room_AR = 0;
  g.room_AL = 0;
  if (g.drawn_room) {
    l8.get_room_address.fn(g.drawn_room);
    const link2 = g.level.roomlinks[g.drawn_room - 1];
    g.room_L = link2.left;
    g.room_R = link2.right;
    g.room_A = link2.up;
    g.room_B = link2.down;
    if (g.room_A) {
      g.room_AL = g.level.roomlinks[g.room_A - 1].left;
      g.room_AR = g.level.roomlinks[g.room_A - 1].right;
    }
    if (g.room_B) {
      g.room_BL = g.level.roomlinks[g.room_B - 1].left;
      g.room_BR = g.level.roomlinks[g.room_B - 1].right;
    }
  } else {
    g.room_L = 0;
    g.room_R = 0;
    g.room_A = 0;
    g.room_B = 0;
  }
}
function get_guard_hp() {
  g.guardhp_max = extrastrength[g.guard_skill] + guards.hp(g.current_level);
  g.guardhp_curr = g.guardhp_max;
  g.guardhp_delta = g.guardhp_max;
}
function check_shadow() {
  g.offguard = 0;
  if (g.current_level === 12) {
    if (!g.united_with_shadow && g.drawn_room === 15) {
      g.Char.room = g.drawn_room;
      if (get_tile(15, 1, 0) === tiles.tiles_22_sword) return;
      g.shadow_initialized = 0;
      do_init_shad(INIT_SHAD_12, seqids.seq_7_fall);
      return;
    }
  }
  if (g.current_level === 6) {
    g.Char.room = g.drawn_room;
    if (g.Char.room === 1) {
      if (g.leveldoor_open !== 77) {
        out.play_sound(soundids.sound_25_presentation);
        g.leveldoor_open = 77;
      }
      do_init_shad(INIT_SHAD_6, seqids.seq_2_stand);
      return;
    }
  }
  if (g.current_level === 5) {
    g.Char.room = g.drawn_room;
    if (g.Char.room === 24) {
      if (get_tile(24, 3, 0) !== tiles.tiles_10_potion) return;
      do_init_shad(INIT_SHAD_5, seqids.seq_2_stand);
      return;
    }
  }
  enter_guard();
}
var INIT_SHAD_6 = [15, 81, 118, 0, 0, 1, 0];
var INIT_SHAD_5 = [15, 55, 55, 0, 255, 0, 0];
var INIT_SHAD_12 = [15, 81, 232, 0, 0, 0, 0];
function do_init_shad(source, seq_index) {
  g.Char.frame = source[0];
  g.Char.x = source[1];
  g.Char.y = source[2];
  g.Char.direction = sbyteOf(source[3]);
  g.Char.curr_col = sbyteOf(source[4]);
  g.Char.curr_row = sbyteOf(source[5]);
  g.Char.action = source[6];
  seqtbl_offset_char(seq_index);
  g.Char.charid = charids.charid_1_shadow;
  g.demo_time = 0;
  g.guard_skill = 3;
  g.guardhp_delta = g.guardhp_curr = g.guardhp_max = 4;
  saveshad();
}
var SHAD_DRINK_MOVE = [
  [0, 0],
  [1, 1],
  [14, 0],
  [18, 6],
  [29, 7],
  [45, 2],
  [49, 1],
  [255, -2]
];
function do_auto_moves(moves) {
  if (g.demo_time >= 254) return;
  ++g.demo_time;
  let demoindex = g.demo_index;
  if (moves[demoindex][0] <= g.demo_time) ++g.demo_index;
  else demoindex = g.demo_index - 1;
  switch (moves[demoindex][1]) {
    case -1:
      break;
    case 0:
      move_0_nothing();
      break;
    case 1:
      move_1_forward();
      break;
    case 2:
      move_2_backward();
      break;
    case 3:
      move_3_up();
      break;
    case 4:
      move_4_down();
      break;
    case 5:
      move_3_up();
      move_1_forward();
      break;
    case 6:
      move_6_shift();
      break;
    case 7:
      move_7();
      break;
    default:
      break;
  }
}
var hp = {
  draw_guard_hp: (_curr, _max) => {
  },
  add_life: () => {
  }
};
function enter_guard() {
  const room_minus_1 = g.drawn_room - 1;
  const guard_tile = g.level.guards_tile[room_minus_1];
  if (guard_tile >= 30) return;
  g.Char.room = g.drawn_room;
  g.Char.curr_row = Math.trunc(guard_tile / SCREEN_TILECOUNTX3);
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.x = g.level.guards_x[room_minus_1];
  g.Char.curr_col = get_tile_div_mod_m7(g.Char.x);
  g.Char.direction = sbyteOf(g.level.guards_dir[room_minus_1]);
  curr_guard_color = guards.type(g.current_level) === 0 ? g.level.guards_color[room_minus_1] : 0;
  curr_guard_color &= 15;
  guardColor.value = curr_guard_color;
  g.Char.charid = guards.type(g.current_level) === 2 ? charids.charid_4_skeleton : charids.charid_2_guard;
  const seq_hi = g.level.guards_seq_hi[room_minus_1];
  if (seq_hi === 0) {
    if (g.Char.charid === charids.charid_4_skeleton) {
      g.Char.sword = sword_status.sword_2_drawn;
      seqtbl_offset_char(seqids.seq_63_guard_active_after_fall);
    } else {
      g.Char.sword = sword_status.sword_0_sheathed;
      seqtbl_offset_char(seqids.seq_77_guard_stand_inactive);
    }
  } else {
    g.Char.curr_seq = g.level.guards_seq_lo[room_minus_1] + (seq_hi << 8);
  }
  play_seq();
  g.guard_skill = g.level.guards_skill[room_minus_1];
  if (g.guard_skill >= NUM_GUARD_SKILLS) g.guard_skill = 3;
  const frame = g.Char.frame;
  if (frame === frameids.frame_185_dead || frame === frameids.frame_177_spiked || frame === frameids.frame_178_chomped) {
    g.Char.alive = 1;
    hp.draw_guard_hp(0, g.guardhp_curr);
    g.guardhp_curr = 0;
  } else {
    g.Char.alive = -1;
    g.justblocked = 0;
    g.guard_refrac = 0;
    g.is_guard_notice = 0;
    get_guard_hp();
  }
  g.Char.fall_y = 0;
  g.Char.fall_x = 0;
  g.Char.action = actions.actions_1_run_jump;
  saveshad();
}
function check_guard_fallout() {
  if (g.Guard.direction === directions.dir_56_none || g.Guard.y < 211) return;
  if (g.Guard.charid === charids.charid_1_shadow) {
    if (g.Guard.action !== actions.actions_4_in_freefall) return;
    loadshad();
    clear_char();
    saveshad();
  } else if (g.Guard.charid === charids.charid_4_skeleton && g.level.roomlinks[g.Guard.room - 1].down === 3) {
    g.Guard.room = g.level.roomlinks[g.Guard.room - 1].down;
    g.Guard.x = 133;
    g.Guard.curr_row = 1;
    g.Guard.direction = directions.dir_0_right;
    g.Guard.alive = -1;
    leave_guard();
  } else {
    loadshad();
    on_guard_killed();
    saveshad();
    g.level.guards_tile[g.drawn_room - 1] = 255;
    g.Guard.direction = directions.dir_56_none;
    hp.draw_guard_hp(0, g.guardhp_curr);
    g.guardhp_curr = 0;
  }
}
function leave_guard() {
  if (g.Guard.direction === directions.dir_56_none || g.Guard.charid === charids.charid_1_shadow || g.Guard.charid === charids.charid_24_mouse) {
    return;
  }
  const room_minus_1 = g.Guard.room - 1;
  g.level.guards_tile[room_minus_1] = get_tilepos(0, g.Guard.curr_row);
  g.level.guards_color[room_minus_1] = curr_guard_color & 15;
  g.level.guards_x[room_minus_1] = g.Guard.x;
  g.level.guards_dir[room_minus_1] = byteOf(g.Guard.direction);
  g.level.guards_skill[room_minus_1] = g.guard_skill;
  if (g.Guard.alive < 0) {
    g.level.guards_seq_hi[room_minus_1] = 0;
  } else {
    g.level.guards_seq_lo[room_minus_1] = g.Guard.curr_seq & 255;
    g.level.guards_seq_hi[room_minus_1] = g.Guard.curr_seq >> 8;
  }
  g.Guard.direction = directions.dir_56_none;
  hp.draw_guard_hp(0, g.guardhp_curr);
  g.guardhp_curr = 0;
}
function follow_guard() {
  g.level.guards_tile[g.Kid.room - 1] = 255;
  g.level.guards_tile[g.Guard.room - 1] = 255;
  loadshad();
  goto_other_room(g.roomleave_result);
  saveshad();
}
function exit_room() {
  let leave = 0;
  if (g.exit_room_timer !== 0) {
    --g.exit_room_timer;
    return;
  }
  loadkid();
  load_frame_to_obj();
  set_char_collision();
  g.roomleave_result = leave_room();
  if (g.roomleave_result < 0) return;
  savekid();
  g.next_room = g.Char.room;
  if (g.Guard.direction === directions.dir_56_none) return;
  if (g.Guard.alive < 0 && g.Guard.sword === sword_status.sword_2_drawn) {
    const kid_room_m1 = g.Kid.room - 1;
    if (kid_room_m1 >= 0 && kid_room_m1 <= 23 && (g.level.guards_tile[kid_room_m1] >= 30 || g.level.guards_seq_hi[kid_room_m1] !== 0)) {
      if (g.roomleave_result === 0) {
        if (g.Guard.x >= 91) leave = 1;
      } else if (g.roomleave_result === 1) {
        if (g.Guard.x < 165) leave = 1;
      } else if (g.roomleave_result === 2) {
        if (g.Guard.curr_row >= 0) leave = 1;
      } else if (g.Guard.curr_row < 3) {
        leave = 1;
      }
    } else {
      leave = 1;
    }
  } else {
    leave = 1;
  }
  if (leave) leave_guard();
  else follow_guard();
}
function goto_other_room(direction) {
  const link2 = g.level.roomlinks[g.Char.room - 1];
  const other_room = [link2.left, link2.right, link2.up, link2.down][direction];
  g.Char.room = other_room;
  let opposite_dir;
  if (direction === 0) {
    g.Char.x = byteOf(g.Char.x + 140);
    opposite_dir = 1;
  } else if (direction === 1) {
    g.Char.x = byteOf(g.Char.x - 140);
    opposite_dir = 0;
  } else if (direction === 2) {
    g.Char.y = byteOf(g.Char.y + 189);
    g.Char.curr_row = y_to_row_mod4(g.Char.y);
    opposite_dir = 3;
  } else {
    g.Char.y = byteOf(g.Char.y - 189);
    g.Char.curr_row = y_to_row_mod4(g.Char.y);
    opposite_dir = 2;
  }
  return opposite_dir;
}
function leave_room() {
  let leave_dir;
  const chary = g.Char.y;
  const action = g.Char.action;
  const frame = g.Char.frame;
  if (action !== actions.actions_5_bumped && action !== actions.actions_4_in_freefall && action !== actions.actions_3_in_midair && sbyteOf(chary) < 10 && sbyteOf(chary) > -16) {
    leave_dir = 2;
  } else if (chary >= 211) {
    leave_dir = 3;
  } else if (frame >= frameids.frame_135_climbing_1 && frame < 150 || frame >= frameids.frame_110_stand_up_from_crouch_1 && frame < 120 || frame >= frameids.frame_150_parry && frame < 163 || frame >= frameids.frame_166_stand_inactive && frame < 169 || action === actions.actions_7_turn) {
    return -1;
  } else if (g.Char.direction !== directions.dir_0_right) {
    if (g.char_x_left <= 54) leave_dir = 0;
    else if (g.char_x_left >= 198) leave_dir = 1;
    else return -1;
  } else {
    get_tile(g.Char.room, 9, g.Char.curr_row);
    if (g.curr_tile2 !== tiles.tiles_7_doortop_with_floor && g.curr_tile2 !== tiles.tiles_12_doortop && g.char_x_right >= 201) {
      leave_dir = 1;
    } else if (g.char_x_right <= 57) {
      leave_dir = 0;
    } else {
      return -1;
    }
  }
  if (leave_dir === 0) {
    play_mirr_mus();
    level3_set_chkp();
    Jaffar_exit();
  } else if (leave_dir === 1) {
    sword_disappears();
    meet_Jaffar();
  } else if (leave_dir === 3) {
    if (g.current_level === 6 && g.Char.room === 1) return -2;
  }
  goto_other_room(leave_dir);
  return leave_dir;
}
function Jaffar_exit() {
  if (g.leveldoor_open === 2) {
    get_tile(24, 0, 0);
    trigger_button(0, 0, -1);
  }
}
function level3_set_chkp() {
  if (g.current_level === 3 && g.Char.room === 7) {
    g.checkpoint = 1;
    g.hitp_beg_lev = g.hitp_max;
  }
}
function sword_disappears() {
  if (g.current_level === 12 && g.Char.room === 18) {
    get_tile(15, 1, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.curr_room_modif[g.curr_tilepos] = 0;
  }
}
function meet_Jaffar() {
  if (g.current_level === 13 && g.leveldoor_open === 0 && g.Char.room === 3) {
    out.play_sound(soundids.sound_29_meet_Jaffar);
    g.guard_notice_timer = 28;
  }
}
function play_mirr_mus() {
  if (g.leveldoor_open !== 0 && g.leveldoor_open !== 77 && g.current_level === 4 && g.Char.curr_row === 0 && g.Char.room === 11) {
    out.play_sound(soundids.sound_25_presentation);
    g.leveldoor_open = 77;
  }
}
function move_0_nothing() {
  g.control_shift = CONTROL_RELEASED3;
  g.control_y = CONTROL_RELEASED3;
  g.control_x = CONTROL_RELEASED3;
  g.control_shift2 = CONTROL_RELEASED3;
  g.control_down = CONTROL_RELEASED3;
  g.control_up = CONTROL_RELEASED3;
  g.control_backward = CONTROL_RELEASED3;
  g.control_forward = CONTROL_RELEASED3;
}
function move_1_forward() {
  g.control_x = CONTROL_HELD_FORWARD3;
  g.control_forward = CONTROL_HELD3;
}
function move_2_backward() {
  g.control_backward = CONTROL_HELD3;
  g.control_x = CONTROL_HELD_BACKWARD3;
}
function move_3_up() {
  g.control_y = CONTROL_HELD_UP3;
  g.control_up = CONTROL_HELD3;
}
function move_4_down() {
  g.control_down = CONTROL_HELD3;
  g.control_y = CONTROL_HELD_DOWN3;
}
function move_down_back() {
  g.control_down = CONTROL_HELD3;
  move_2_backward();
}
function move_down_forw() {
  g.control_down = CONTROL_HELD3;
  move_1_forward();
}
function move_6_shift() {
  g.control_shift = CONTROL_HELD3;
  g.control_shift2 = CONTROL_HELD3;
}
function move_7() {
  g.control_shift = CONTROL_RELEASED3;
}
function autocontrol_opponent() {
  move_0_nothing();
  const charid = g.Char.charid;
  if (charid === charids.charid_0_kid) {
    autocontrol_kid();
    return;
  }
  if (g.justblocked) --g.justblocked;
  if (g.kid_sword_strike) --g.kid_sword_strike;
  if (g.guard_refrac) --g.guard_refrac;
  if (charid === charids.charid_24_mouse) autocontrol_mouse();
  else if (charid === charids.charid_4_skeleton) autocontrol_skeleton();
  else if (charid === charids.charid_1_shadow) autocontrol_shadow();
  else if (g.current_level === 13) autocontrol_Jaffar();
  else autocontrol_guard();
}
function autocontrol_mouse() {
  if (g.Char.direction === directions.dir_56_none) return;
  if (g.Char.action === actions.actions_0_stand) {
    if (g.Char.x >= 200) clear_char();
  } else if (g.Char.x < 166) {
    seqtbl_offset_char(seqids.seq_107_mouse_stand_up_and_go);
    play_seq();
  }
}
function autocontrol_shadow() {
  if (g.current_level === 4) autocontrol_shadow_level4();
  if (g.current_level === 5) autocontrol_shadow_level5();
  if (g.current_level === 6) autocontrol_shadow_level6();
  if (g.current_level === 12) autocontrol_shadow_level12();
}
function autocontrol_shadow_level4() {
  if (g.Char.room === 4) {
    if (g.Char.x < 80) clear_char();
    else move_1_forward();
  }
}
function autocontrol_shadow_level5() {
  if (g.Char.room !== 24) return;
  if (g.demo_time === 0) {
    get_tile(24, 1, 0);
    if (g.curr_room_modif[g.curr_tilepos] < 80) return;
    g.demo_index = 0;
  }
  do_auto_moves(SHAD_DRINK_MOVE);
  if (g.Char.x < 15) clear_char();
}
function autocontrol_shadow_level6() {
  if (g.Char.room === 1 && g.Kid.frame === frameids.frame_43_running_jump_4 && g.Kid.x < 128) {
    move_6_shift();
    move_1_forward();
  }
}
function autocontrol_shadow_level12() {
  if (g.Char.room === 15 && g.shadow_initialized === 0) {
    if (g.Opp.x >= 150) {
      do_init_shad(INIT_SHAD_12, seqids.seq_7_fall);
      return;
    }
    g.shadow_initialized = 1;
  }
  if (g.Char.sword >= sword_status.sword_2_drawn) {
    if (g.offguard === 0 || g.guard_refrac === 0) autocontrol_guard_active();
    else move_4_down();
    return;
  }
  if (g.Opp.sword >= sword_status.sword_2_drawn || g.offguard === 0) {
    let xdiff = 28672;
    if (g.can_guard_see_kid < 2 || (xdiff = char_opp_dist()) >= 90) {
      if (xdiff < 0) move_2_backward();
      return;
    }
    if (g.Char.frame === 15) move_down_forw();
    return;
  }
  if (char_opp_dist() < 10) {
    g.flash_color = 15;
    g.flash_time = 18;
    hp.add_life();
    g.united_with_shadow = 42;
    g.Char.charid = charids.charid_0_kid;
    savekid();
    clear_char();
    return;
  }
  if (g.can_guard_see_kid === 2) {
    const opp_frame = g.Opp.frame;
    if (opp_frame >= frameids.frame_3_start_run && opp_frame < frameids.frame_15_stand || opp_frame >= frameids.frame_127_stepping_7 && opp_frame < 133) {
      move_1_forward();
    }
  }
}
function autocontrol_skeleton() {
  g.Char.sword = sword_status.sword_2_drawn;
  autocontrol_guard();
}
function autocontrol_Jaffar() {
  autocontrol_guard();
}
function autocontrol_kid() {
  autocontrol_guard();
}
function autocontrol_guard() {
  if (g.Char.sword < sword_status.sword_2_drawn) autocontrol_guard_inactive();
  else autocontrol_guard_active();
}
function autocontrol_guard_inactive() {
  if (g.Kid.alive >= 0) return;
  const distance = char_opp_dist();
  if (g.Opp.curr_row !== g.Char.curr_row || wordOf(distance) < wordOf(-8)) {
    if (g.is_guard_notice) {
      g.is_guard_notice = 0;
      if (distance < 0) {
        if (wordOf(distance) < wordOf(-4)) move_4_down();
        return;
      }
    } else if (distance < 0) {
      return;
    }
  }
  if (g.can_guard_see_kid) {
    if (g.current_level !== 13 || g.guard_notice_timer === 0) move_down_forw();
  }
}
function autocontrol_guard_active() {
  const char_frame = g.Char.frame;
  if (char_frame === frameids.frame_166_stand_inactive || char_frame < 150 || g.can_guard_see_kid === 1) {
    return;
  }
  if (g.can_guard_see_kid === 0) {
    if (droppedout !== 0) {
      guard_follows_kid_down();
    } else if (g.Char.charid !== charids.charid_4_skeleton) {
      move_down_back();
    }
    return;
  }
  const opp_frame = g.Opp.frame;
  const distance = char_opp_dist();
  if (distance >= 12 && opp_frame >= frameids.frame_102_start_fall_1 && opp_frame < frameids.frame_118_stand_up_from_crouch_9 && g.Opp.action === actions.actions_5_bumped) {
    return;
  }
  if (distance < 35) {
    if (g.Char.sword < sword_status.sword_2_drawn && distance < 8 || distance < 12) {
      if (g.Char.direction === g.Opp.direction) move_2_backward();
      else move_1_forward();
    } else {
      autocontrol_guard_kid_in_sight(distance);
    }
    return;
  }
  if (g.guard_refrac !== 0) return;
  if (g.Char.direction !== g.Opp.direction) {
    if (opp_frame >= frameids.frame_7_run && opp_frame < 15) {
      if (distance < 40) move_6_shift();
      return;
    }
    if (opp_frame >= frameids.frame_34_start_run_jump_1 && opp_frame < 44) {
      if (distance < 50) move_6_shift();
      return;
    }
  }
  autocontrol_guard_kid_far();
}
function autocontrol_guard_kid_far() {
  if (tile_is_floor(get_tile_infrontof_char()) || tile_is_floor(get_tile_infrontof2_char())) {
    move_1_forward();
  } else {
    move_2_backward();
  }
}
function guard_follows_kid_down() {
  const opp_action = g.Opp.action;
  if (opp_action === actions.actions_2_hang_climb || opp_action === actions.actions_6_hang_straight) {
    return;
  }
  if (wall_type(get_tile_infrontof_char()) !== 0 || !tile_is_floor(g.curr_tile2) && (get_tile(g.curr_room, g.tile_col, ++g.tile_row) === tiles.tiles_2_spike || g.curr_tile2 === tiles.tiles_11_loose || wall_type(g.curr_tile2) !== 0 || !tile_is_floor(g.curr_tile2) || g.Char.curr_row + 1 !== g.Opp.curr_row)) {
    setDroppedout(0);
    move_2_backward();
  } else {
    move_1_forward();
  }
}
function autocontrol_guard_kid_in_sight(distance) {
  if (g.Opp.sword === sword_status.sword_2_drawn) {
    autocontrol_guard_kid_armed(distance);
  } else if (g.guard_refrac === 0) {
    if (distance < 29) move_6_shift();
    else move_1_forward();
  }
}
function autocontrol_guard_kid_armed(distance) {
  if (distance < 10 || distance >= 29) {
    guard_advance();
    return;
  }
  guard_block();
  if (g.guard_refrac === 0) {
    if (distance < 12 || distance >= 29) guard_advance();
    else guard_strike();
  }
}
function guard_advance() {
  if (g.guard_skill === 0 || g.kid_sword_strike === 0) {
    if (advprob[g.guard_skill] > prandom(255)) move_1_forward();
  }
}
function guard_block() {
  const opp_frame = g.Opp.frame;
  if (opp_frame === frameids.frame_152_strike_2 || opp_frame === frameids.frame_153_strike_3 || opp_frame === frameids.frame_162_block_to_strike) {
    if (g.justblocked !== 0) {
      if (impblockprob[g.guard_skill] > prandom(255)) move_3_up();
    } else if (blockprob[g.guard_skill] > prandom(255)) {
      move_3_up();
    }
  }
}
function guard_strike() {
  const opp_frame = g.Opp.frame;
  if (opp_frame === frameids.frame_169_begin_block || opp_frame === frameids.frame_151_strike_1) {
    return;
  }
  const char_frame = g.Char.frame;
  if (char_frame === frameids.frame_161_parry || char_frame === frameids.frame_150_parry) {
    if (restrikeprob[g.guard_skill] > prandom(255)) move_6_shift();
  } else if (strikeprob[g.guard_skill] > prandom(255)) {
    move_6_shift();
  }
}
function hurt_by_sword() {
  if (g.Char.alive >= 0) return;
  let killed = false;
  if (g.Char.sword !== sword_status.sword_2_drawn) {
    take_hp(100);
    seqtbl_offset_char(seqids.seq_85_stabbed_to_death);
    killed = true;
  } else if (g.Char.charid !== charids.charid_4_skeleton && take_hp(1)) {
    killed = true;
  }
  if (killed) {
    let distance = 0;
    if (get_tile_behind_char() !== 0 || (distance = distance_to_edge_weight()) < 4) {
      seqtbl_offset_char(seqids.seq_85_stabbed_to_death);
      if (g.Char.charid !== charids.charid_0_kid && g.Char.direction < directions.dir_0_right && (g.curr_tile2 === tiles.tiles_4_gate || get_tile_at_char() === tiles.tiles_4_gate)) {
        g.Char.x = byteOf(
          x_bump[g.tile_col - (g.curr_tile2 !== tiles.tiles_4_gate ? 1 : 0) + FIRST_ONSCREEN_COLUMN5] + TILE_MIDX3
        );
        g.Char.x = byteOf(char_dx_forward(10));
      }
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
    } else {
      g.Char.x = byteOf(char_dx_forward(distance - 20));
      load_fram_det_col();
      inc_curr_row();
      seqtbl_offset_char(seqids.seq_81_kid_pushed_off_ledge);
    }
  } else {
    seqtbl_offset_char(seqids.seq_74_hit_by_sword);
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    g.Char.fall_y = 0;
  }
  out.play_sound(g.Char.charid === charids.charid_0_kid ? soundids.sound_13_kid_hurt : soundids.sound_12_guard_hurt);
  play_seq();
}
function check_sword_hurt() {
  if (g.Guard.action === actions.actions_99_hurt) {
    if (g.Kid.action === actions.actions_99_hurt) {
      g.Kid.action = actions.actions_1_run_jump;
    }
    loadshad();
    hurt_by_sword();
    saveshad();
    g.guard_refrac = refractimer[g.guard_skill];
  } else if (g.Kid.action === actions.actions_99_hurt) {
    loadkid();
    hurt_by_sword();
    savekid();
  }
}
function check_sword_hurting() {
  const kid_frame = g.Kid.frame;
  if (kid_frame !== 0 && (kid_frame < frameids.frame_219_exit_stairs_3 || kid_frame >= 229)) {
    loadshad_and_opp();
    check_hurting();
    saveshad_and_opp();
    loadkid_and_opp();
    check_hurting();
    savekid_and_opp();
  }
}
function check_hurting() {
  if (g.Char.sword !== sword_status.sword_2_drawn) return;
  if (g.Char.curr_row !== g.Opp.curr_row) return;
  const char_frame = g.Char.frame;
  if (char_frame !== frameids.frame_153_strike_3 && char_frame !== frameids.frame_154_poking) {
    return;
  }
  let distance = char_opp_dist();
  const opp_frame = g.Opp.frame;
  if (distance < 0 || distance >= 29 || opp_frame !== frameids.frame_161_parry && opp_frame !== frameids.frame_150_parry) {
    if (g.Char.frame === frameids.frame_154_poking) {
      const min_hurt_range = g.Opp.sword < sword_status.sword_2_drawn ? 8 : 12;
      distance = char_opp_dist();
      if (distance >= min_hurt_range && distance < 29) {
        g.Opp.action = actions.actions_99_hurt;
      }
    }
  } else {
    g.Opp.frame = frameids.frame_161_parry;
    if (g.Char.charid !== charids.charid_0_kid) g.justblocked = 4;
    seqtbl_offset_char(seqids.seq_69_attack_was_parried);
    play_seq();
  }
  if (g.Char.direction === directions.dir_56_none) return;
  if (g.Char.frame === frameids.frame_154_poking && g.Opp.frame !== frameids.frame_161_parry && g.Opp.action !== actions.actions_99_hurt) {
    out.play_sound(soundids.sound_11_sword_moving);
  }
}
function check_skel() {
  if (g.current_level === 3 && g.Guard.direction === directions.dir_56_none && g.drawn_room === 1 && g.leveldoor_open !== 0 && (g.Kid.curr_col === 2 || g.Kid.curr_col === 3)) {
    get_tile(g.drawn_room, 5, 1);
    if (g.curr_tile2 !== tiles.tiles_21_skeleton) return;
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.redraw_height = 24;
    l8.set_redraw_full.fn(g.curr_tilepos, 1);
    l8.set_wipe.fn(g.curr_tilepos, 1);
    ++g.curr_tilepos;
    l8.set_redraw_full.fn(g.curr_tilepos, 1);
    l8.set_wipe.fn(g.curr_tilepos, 1);
    g.Char.room = g.drawn_room;
    g.Char.curr_row = 1;
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    g.Char.curr_col = 5;
    g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN5] + TILE_SIZEX4);
    g.Char.direction = directions.dir_FF_left;
    seqtbl_offset_char(seqids.seq_88_skel_wake_up);
    play_seq();
    out.play_sound(soundids.sound_44_skel_alive);
    g.guard_skill = 2;
    g.Char.alive = -1;
    g.guardhp_max = g.guardhp_curr = 3;
    g.Char.fall_x = g.Char.fall_y = 0;
    g.is_guard_notice = g.guard_refrac = 0;
    g.Char.sword = sword_status.sword_2_drawn;
    g.Char.charid = charids.charid_4_skeleton;
    saveshad();
  }
}
function control_guard_inactive() {
  if (g.Char.frame === frameids.frame_166_stand_inactive && g.control_down === CONTROL_HELD3) {
    if (g.control_forward === CONTROL_HELD3) {
      draw_sword();
    } else {
      g.control_down = CONTROL_IGNORE3;
      seqtbl_offset_char(seqids.seq_80_stand_flipped);
    }
  }
}

// src/pop/seg008.ts
var paint;
function setPainter(p) {
  paint = p;
}
function paintBlit(chtab, id, x, y, blit) {
  paint.blit(chtab, id, x, y, blit);
}
var peels_table = [];
function add_peel(left, right, top, height) {
  if (peels_table.length >= 50) return;
  peels_table.push(paint.readPeel(left, top, right, top + height));
}
function restore_peels() {
  while (peels_table.length) paint.restorePeel(peels_table.pop());
}
function free_peels() {
  peels_table.length = 0;
}
var hp2 = { draw_hp: () => {
} };
var levelType2 = { of: (_level) => 0 };
var n_curr_objs = 0;
var curr_objs = [];
var gate_top_y = 0;
var gate_openness = 0;
var gate_bottom_y = 0;
function reset_tables() {
  g.table_counts.fill(0);
  g.backtable.length = 0;
  g.foretable.length = 0;
  g.midtable.length = 0;
  g.wipetable.length = 0;
  g.wipetable_count = 0;
  g.objtable.length = 0;
  g.objtable_count = 0;
}
function redraw_room() {
  free_peels();
  reset_tables();
  reset_obj_clip();
  draw_room();
  clear_tile_wipes();
}
function draw_room() {
  load_leftroom();
  for (g.drawn_row = 2; g.drawn_row >= 0; g.drawn_row--) {
    load_rowbelow();
    g.draw_bottom_y = 63 * g.drawn_row + 65;
    g.draw_main_y = g.draw_bottom_y - 3;
    for (g.drawn_col = 0; g.drawn_col < 10; g.drawn_col++) {
      load_curr_and_left_tile();
      draw_tile();
    }
  }
  const saved_room = g.drawn_room;
  g.drawn_room = g.room_A;
  load_room_links();
  load_leftroom();
  g.drawn_row = 2;
  load_rowbelow();
  for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
    load_curr_and_left_tile();
    g.draw_main_y = -1;
    g.draw_bottom_y = 2;
    draw_tile_aboveroom();
  }
  g.drawn_room = saved_room;
  load_room_links();
}
function draw_tile() {
  draw_tile_floorright();
  draw_tile_anim_topright();
  draw_tile_right();
  draw_tile_anim_right();
  draw_tile_bottom(0);
  draw_loose(0);
  draw_tile_base();
  draw_tile_anim();
  draw_tile_fore();
}
function draw_tile_aboveroom() {
  draw_tile_floorright();
  draw_tile_anim_topright();
  draw_tile_right();
  draw_tile_bottom(0);
  draw_loose(0);
  draw_tile_fore();
}
function redraw_needed(tilepos) {
  if (g.wipe_frames[tilepos]) {
    --g.wipe_frames[tilepos];
    draw_tile_wipe(g.wipe_heights[tilepos]);
  }
  if (g.redraw_frames_full[tilepos]) {
    --g.redraw_frames_full[tilepos];
    draw_tile();
  } else if (g.redraw_frames_anim[tilepos]) {
    --g.redraw_frames_anim[tilepos];
    draw_tile_anim_topright();
    draw_tile_anim_right();
    draw_tile_anim();
  }
  if (g.redraw_frames2[tilepos]) {
    --g.redraw_frames2[tilepos];
    draw_other_overlay();
  } else if (g.redraw_frames_floor_overlay[tilepos]) {
    --g.redraw_frames_floor_overlay[tilepos];
    draw_floor_overlay();
  }
  if (g.tile_object_redraw[tilepos]) {
    if (g.tile_object_redraw[tilepos] === 255) {
      draw_objtable_items_at_tile(tilepos - 1);
    }
    draw_objtable_items_at_tile(tilepos);
    g.tile_object_redraw[tilepos] = 0;
  }
  if (g.redraw_frames_fore[tilepos]) {
    --g.redraw_frames_fore[tilepos];
    draw_tile_fore();
  }
}
function redraw_needed_above(column) {
  if (g.redraw_frames_above[column] !== 0) {
    --g.redraw_frames_above[column];
    draw_tile_wipe(3);
    draw_tile_floorright();
    draw_tile_anim_topright();
    draw_tile_right();
    draw_tile_bottom(1);
    draw_loose(1);
    draw_tile_fore();
  }
}
function get_tile_to_draw(room, column, row, tile_room0) {
  const tilepos = tbl_line[row] + column;
  let tiletype;
  let modifier;
  if (column === -1) {
    tiletype = g.leftroom_[row].tiletype;
    modifier = g.leftroom_[row].modifier;
  } else if (room) {
    tiletype = g.curr_room_tiles[tilepos] & 31;
    modifier = g.curr_room_modif[tilepos];
  } else {
    modifier = 0;
    tiletype = tile_room0;
  }
  const type = tiletype & 31;
  if (type === tiles.tiles_6_closer) {
    if (get_doorlink_timer(modifier) > 1) tiletype = tiles.tiles_5_stuck;
  } else if (type === tiles.tiles_15_opener) {
    if (get_doorlink_timer(modifier) > 1) {
      modifier = 0;
      tiletype = tiles.tiles_1_floor;
    }
  }
  return { tiletype, modifier };
}
function load_curr_and_left_tile() {
  const outside = g.drawn_row === 2 ? tiles.tiles_1_floor : tiles.tiles_20_wall;
  const here = get_tile_to_draw(g.drawn_room, g.drawn_col, g.drawn_row, outside);
  g.curr_tile = here.tiletype;
  g.curr_modifier = here.modifier;
  const left = get_tile_to_draw(g.drawn_room, g.drawn_col - 1, g.drawn_row, outside);
  g.tile_left = left.tiletype;
  g.modifier_left = left.modifier;
  g.draw_xh = col_xh[g.drawn_col];
}
function load_leftroom() {
  get_room_address(g.room_L);
  for (let row = 0; row < 3; ++row) {
    const t = get_tile_to_draw(g.room_L, 9, row, tiles.tiles_20_wall);
    g.leftroom_[row].tiletype = t.tiletype;
    g.leftroom_[row].modifier = t.modifier;
  }
}
function load_rowbelow() {
  let row_below;
  let room;
  let room_left;
  if (g.drawn_row === 2) {
    room = g.room_B;
    room_left = g.room_BL;
    row_below = 0;
  } else {
    room = g.drawn_room;
    room_left = g.room_L;
    row_below = g.drawn_row + 1;
  }
  get_room_address(room);
  for (let column = 1; column < 10; ++column) {
    const t2 = get_tile_to_draw(room, column - 1, row_below, tiles.tiles_0_empty);
    g.row_below_left_[column].tiletype = t2.tiletype;
    g.row_below_left_[column].modifier = t2.modifier;
  }
  get_room_address(room_left);
  const t = get_tile_to_draw(room_left, 9, row_below, tiles.tiles_20_wall);
  g.row_below_left_[0].tiletype = t.tiletype;
  g.row_below_left_[0].modifier = t.modifier;
  get_room_address(g.drawn_room);
}
function draw_tile_floorright() {
  if (!can_see_bottomleft()) return;
  draw_tile_topright();
  if (tile_table[g.tile_left].floor_right === 0) return;
  add_backtable(
    chtabs.id_chtab_6_environment,
    42,
    g.draw_xh,
    0,
    tile_table[tiles.tiles_1_floor].right_y + g.draw_main_y,
    blitters.blitters_9_black,
    1
  );
}
function can_see_bottomleft() {
  return g.curr_tile === tiles.tiles_0_empty || g.curr_tile === tiles.tiles_9_bigpillar_top || g.curr_tile === tiles.tiles_12_doortop || g.curr_tile === tiles.tiles_26_lattice_down;
}
function draw_tile_topright() {
  const tiletype = g.row_below_left_[g.drawn_col].tiletype;
  if (tiletype === tiles.tiles_7_doortop_with_floor || tiletype === tiles.tiles_12_doortop) {
    if (levelType2.of(g.current_level) === 0) return;
    add_backtable(
      chtabs.id_chtab_6_environment,
      doortop_fram_top[g.row_below_left_[g.drawn_col].modifier],
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_2_or,
      0
    );
  } else if (tiletype === tiles.tiles_20_wall) {
    add_backtable(
      chtabs.id_chtab_7_environmentwall,
      2,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_2_or,
      0
    );
  } else {
    add_backtable(
      chtabs.id_chtab_6_environment,
      tile_table[tiletype].topright_id,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_2_or,
      0
    );
  }
}
function draw_tile_anim_topright() {
  if ((g.curr_tile === tiles.tiles_0_empty || g.curr_tile === tiles.tiles_9_bigpillar_top || g.curr_tile === tiles.tiles_12_doortop) && g.row_below_left_[g.drawn_col].tiletype === tiles.tiles_4_gate) {
    add_backtable(
      chtabs.id_chtab_6_environment,
      68,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_40h_mono,
      0
    );
    let modifier = g.row_below_left_[g.drawn_col].modifier;
    if (modifier > 188) modifier = 188;
    add_backtable(
      chtabs.id_chtab_6_environment,
      door_fram_top[(modifier >> 2) % 8],
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_2_or,
      0
    );
  }
}
function draw_tile_right() {
  if (g.curr_tile === tiles.tiles_20_wall) return;
  switch (g.tile_left) {
    case tiles.tiles_0_empty:
      if (g.modifier_left > 3) return;
      add_backtable(
        chtabs.id_chtab_6_environment,
        blueline_fram1[g.modifier_left],
        g.draw_xh,
        0,
        blueline_fram_y[g.modifier_left] + g.draw_main_y,
        blitters.blitters_2_or,
        0
      );
      break;
    case tiles.tiles_1_floor: {
      ptr_add_table(
        chtabs.id_chtab_6_environment,
        42,
        g.draw_xh,
        0,
        tile_table[g.tile_left].right_y + g.draw_main_y,
        blitters.blitters_10h_transp,
        0
      );
      let num = g.modifier_left;
      if (num > 3) num = 0;
      if (num === (levelType2.of(g.current_level) ? 1 : 0)) return;
      add_backtable(
        chtabs.id_chtab_6_environment,
        blueline_fram3[num],
        g.draw_xh,
        0,
        g.draw_main_y - 20,
        blitters.blitters_0_no_transp,
        0
      );
      break;
    }
    case tiles.tiles_7_doortop_with_floor:
    case tiles.tiles_12_doortop:
      if (levelType2.of(g.current_level) === 0) return;
      add_backtable(
        chtabs.id_chtab_6_environment,
        doortop_fram_bot[g.modifier_left],
        g.draw_xh,
        0,
        tile_table[g.tile_left].right_y + g.draw_main_y,
        blitters.blitters_2_or,
        0
      );
      break;
    case tiles.tiles_20_wall:
      if (levelType2.of(g.current_level) && (g.modifier_left & 128) === 0) {
        add_backtable(
          chtabs.id_chtab_6_environment,
          84,
          g.draw_xh + 3,
          0,
          g.draw_main_y - 27,
          blitters.blitters_0_no_transp,
          0
        );
      }
      add_backtable(
        chtabs.id_chtab_7_environmentwall,
        1,
        g.draw_xh,
        0,
        tile_table[g.tile_left].right_y + g.draw_main_y,
        blitters.blitters_2_or,
        0
      );
      break;
    default: {
      let id = tile_table[g.tile_left].right_id;
      if (id) {
        let blit;
        if (g.tile_left === tiles.tiles_5_stuck) {
          blit = blitters.blitters_10h_transp;
          if (g.curr_tile === tiles.tiles_0_empty || g.curr_tile === tiles.tiles_5_stuck || !tile_is_floor(g.curr_tile)) {
            id = 42;
          }
        } else {
          blit = blitters.blitters_2_or;
        }
        add_backtable(
          chtabs.id_chtab_6_environment,
          id,
          g.draw_xh,
          0,
          tile_table[g.tile_left].right_y + g.draw_main_y,
          blit,
          0
        );
      }
      if (levelType2.of(g.current_level) !== 0) {
        add_backtable(
          chtabs.id_chtab_6_environment,
          tile_table[g.tile_left].stripe_id,
          g.draw_xh,
          0,
          g.draw_main_y - 27,
          blitters.blitters_2_or,
          0
        );
      }
      if (g.tile_left === tiles.tiles_19_torch || g.tile_left === tiles.tiles_30_torch_with_debris) {
        add_backtable(
          chtabs.id_chtab_6_environment,
          146,
          g.draw_xh,
          0,
          g.draw_bottom_y - 28,
          blitters.blitters_0_no_transp,
          0
        );
      }
      break;
    }
  }
}
function get_spike_frame(modifier) {
  return modifier & 128 ? 5 : modifier;
}
function draw_tile_anim_right() {
  switch (g.tile_left) {
    case tiles.tiles_2_spike:
      add_backtable(
        chtabs.id_chtab_6_environment,
        spikes_fram_right[get_spike_frame(g.modifier_left)],
        g.draw_xh,
        0,
        g.draw_main_y - 7,
        blitters.blitters_10h_transp,
        0
      );
      break;
    case tiles.tiles_4_gate:
      draw_gate_back();
      break;
    case tiles.tiles_11_loose:
      add_backtable(
        chtabs.id_chtab_6_environment,
        loose_fram_right[get_loose_frame(g.modifier_left)],
        g.draw_xh,
        0,
        g.draw_bottom_y - 1,
        blitters.blitters_2_or,
        0
      );
      break;
    case tiles.tiles_16_level_door_left:
      draw_leveldoor();
      break;
    case tiles.tiles_19_torch:
    case tiles.tiles_30_torch_with_debris:
      if (g.modifier_left < 9) {
        add_backtable(
          chtabs.id_chtab_1_flameswordpotion,
          g.modifier_left + 1,
          g.draw_xh + 1,
          0,
          g.draw_main_y - 40,
          blitters.blitters_0_no_transp,
          0
        );
      }
      break;
    default:
      break;
  }
}
function draw_tile_bottom(arg_0) {
  let id = 0;
  let blit = blitters.blitters_0_no_transp;
  let chtab_id = chtabs.id_chtab_6_environment;
  if (g.curr_tile === tiles.tiles_20_wall) {
    if (levelType2.of(g.current_level) === 0) {
      id = wall_fram_bottom[g.curr_modifier & 127];
    }
    chtab_id = chtabs.id_chtab_7_environmentwall;
  } else {
    if (g.curr_tile === tiles.tiles_12_doortop) blit = blitters.blitters_2_or;
    id = tile_table[g.curr_tile].bottom_id;
  }
  if (ptr_add_table(chtab_id, id, g.draw_xh, 0, g.draw_bottom_y, blit, 0) && arg_0) {
    add_foretable(chtab_id, id, g.draw_xh, 0, g.draw_bottom_y, blit, 0);
  }
  if (chtab_id === chtabs.id_chtab_7_environmentwall) wall_pattern(0, 0);
}
function draw_loose(_arg_0) {
  if (g.curr_tile === tiles.tiles_11_loose) {
    const id = loose_fram_bottom[get_loose_frame(g.curr_modifier)];
    add_backtable(
      chtabs.id_chtab_6_environment,
      id,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_0_no_transp,
      0
    );
    add_foretable(
      chtabs.id_chtab_6_environment,
      id,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_0_no_transp,
      0
    );
  }
}
function draw_tile_base() {
  let id;
  let ybottom = g.draw_main_y;
  if (g.tile_left === tiles.tiles_26_lattice_down && g.curr_tile === tiles.tiles_12_doortop) {
    id = 6;
    ybottom += 3;
  } else if (g.curr_tile === tiles.tiles_11_loose) {
    id = loose_fram_left[get_loose_frame(g.curr_modifier)];
  } else if (g.curr_tile === tiles.tiles_15_opener && g.tile_left === tiles.tiles_0_empty && levelType2.of(g.current_level) === 0) {
    id = 148;
  } else {
    id = tile_table[g.curr_tile].base_id;
  }
  ptr_add_table(
    chtabs.id_chtab_6_environment,
    id,
    g.draw_xh,
    0,
    tile_table[g.curr_tile].base_y + ybottom,
    blitters.blitters_10h_transp,
    0
  );
}
function draw_tile_anim() {
  let pot_size = 0;
  let color = 12;
  switch (g.curr_tile) {
    case tiles.tiles_2_spike:
      ptr_add_table(
        chtabs.id_chtab_6_environment,
        spikes_fram_left[get_spike_frame(g.curr_modifier)],
        g.draw_xh,
        0,
        g.draw_main_y - 2,
        blitters.blitters_10h_transp,
        0
      );
      break;
    case tiles.tiles_10_potion:
      switch ((g.curr_modifier & 248) >> 3) {
        case 0:
          return;
        // empty
        case 5:
        case 6:
          color = 9;
          break;
        case 3:
        case 4:
          color = 10;
          pot_size = 1;
          break;
        case 2:
          pot_size = 1;
          break;
        default:
          break;
      }
      add_backtable(
        chtabs.id_chtab_1_flameswordpotion,
        23,
        g.draw_xh + 3,
        1,
        g.draw_main_y - (pot_size << 2) - 14,
        blitters.blitters_40h_mono,
        0
      );
      add_foretable(
        chtabs.id_chtab_1_flameswordpotion,
        potion_fram_bubb[g.curr_modifier & 7],
        g.draw_xh + 3,
        1,
        g.draw_main_y - (pot_size << 2) - 14,
        color + blitters.blitters_40h_mono,
        0
      );
      break;
    case tiles.tiles_22_sword:
      add_midtable(
        chtabs.id_chtab_1_flameswordpotion,
        (g.curr_modifier === 1 ? 1 : 0) + 10,
        g.draw_xh,
        0,
        g.draw_main_y - 3,
        blitters.blitters_10h_transp,
        g.curr_modifier === 1 ? 1 : 0
      );
      break;
    case tiles.tiles_18_chomper: {
      const chomper_num = chomper_fram1[Math.min(g.curr_modifier & 127, 6)];
      add_backtable(
        chtabs.id_chtab_6_environment,
        chomper_fram_bot[chomper_num],
        g.draw_xh,
        0,
        g.draw_main_y,
        blitters.blitters_10h_transp,
        0
      );
      if (g.curr_modifier & 128) {
        add_backtable(
          chtabs.id_chtab_6_environment,
          chomper_num + 114,
          g.draw_xh + 1,
          4,
          g.draw_main_y - 6,
          blitters.blitters_4Ch_mono_12,
          0
        );
      }
      add_backtable(
        chtabs.id_chtab_6_environment,
        chomper_fram_top[chomper_num],
        g.draw_xh,
        0,
        g.draw_main_y - chomper_fram_y[chomper_num],
        blitters.blitters_10h_transp,
        0
      );
      break;
    }
    default:
      break;
  }
}
function draw_tile_fore() {
  if (g.tile_left === tiles.tiles_4_gate && g.Kid.curr_row === g.drawn_row && g.Kid.curr_col === g.drawn_col - 1 && g.Kid.room !== g.room_R) {
    draw_gate_fore();
  }
  switch (g.curr_tile) {
    case tiles.tiles_2_spike:
      add_foretable(
        chtabs.id_chtab_6_environment,
        spikes_fram_fore[get_spike_frame(g.curr_modifier)],
        g.draw_xh,
        0,
        g.draw_main_y - 2,
        blitters.blitters_10h_transp,
        0
      );
      return;
    case tiles.tiles_18_chomper: {
      const chomper_num = chomper_fram1[Math.min(g.curr_modifier & 127, 6)];
      add_foretable(
        chtabs.id_chtab_6_environment,
        chomper_fram_for[chomper_num],
        g.draw_xh,
        0,
        g.draw_main_y,
        blitters.blitters_10h_transp,
        0
      );
      if (g.curr_modifier & 128) {
        add_foretable(
          chtabs.id_chtab_6_environment,
          chomper_num + 119,
          g.draw_xh + 1,
          4,
          g.draw_main_y - 6,
          blitters.blitters_4Ch_mono_12,
          0
        );
      }
      return;
    }
    case tiles.tiles_20_wall:
      if (levelType2.of(g.current_level) === 0) {
        add_foretable(
          chtabs.id_chtab_7_environmentwall,
          wall_fram_main[g.curr_modifier & 127],
          g.draw_xh,
          0,
          g.draw_main_y,
          blitters.blitters_0_no_transp,
          0
        );
      }
      wall_pattern(1, 1);
      return;
    default:
      break;
  }
  let id = tile_table[g.curr_tile].fore_id;
  if (id === 0) return;
  if (g.curr_tile === tiles.tiles_10_potion) {
    const potion_type = (g.curr_modifier & 248) >> 3;
    if (potion_type < 5 && potion_type >= 2) id = 13;
  }
  const xh = tile_table[g.curr_tile].fore_x + g.draw_xh;
  const ybottom = tile_table[g.curr_tile].fore_y + g.draw_main_y;
  if (g.curr_tile === tiles.tiles_10_potion) {
    if (levelType2.of(g.current_level) !== 0) id += 2;
    add_foretable(
      chtabs.id_chtab_1_flameswordpotion,
      id,
      xh,
      6,
      ybottom,
      blitters.blitters_10h_transp,
      0
    );
  } else if (g.curr_tile === tiles.tiles_3_pillar && levelType2.of(g.current_level) === 0 || g.curr_tile >= tiles.tiles_27_lattice_small && g.curr_tile < tiles.tiles_30_torch_with_debris) {
    add_foretable(
      chtabs.id_chtab_6_environment,
      id,
      xh,
      0,
      ybottom,
      blitters.blitters_0_no_transp,
      0
    );
  } else {
    add_foretable(
      chtabs.id_chtab_6_environment,
      id,
      xh,
      0,
      ybottom,
      blitters.blitters_10h_transp,
      0
    );
  }
}
function get_loose_frame(modifier) {
  if (modifier & 128) {
    modifier &= 127;
    if (modifier > 10) return 1;
  }
  return modifier;
}
function ptr_add_table(chtab_id, id, xh, xl, ybottom, blit, peel) {
  if (g.ptr_add_table === "mid") return add_midtable(chtab_id, id, xh, xl, ybottom, blit, peel);
  if (g.ptr_add_table === "fore") return add_foretable(chtab_id, id, xh, xl, ybottom, blit, peel);
  return add_backtable(chtab_id, id, xh, xl, ybottom, blit, peel);
}
function add_backtable(chtab_id, id, xh, xl, ybottom, blit, _peel) {
  if (id === 0) return 0;
  if (g.backtable.length >= 200) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  g.backtable.push({
    xh,
    xl,
    chtab_id,
    id: id - 1,
    y: ybottom - image.height + 1,
    blit
  });
  g.table_counts[0] = g.backtable.length;
  return 1;
}
function add_foretable(chtab_id, id, xh, xl, ybottom, blit, _peel) {
  if (id === 0) return 0;
  if (g.foretable.length >= 200) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  g.foretable.push({
    xh,
    xl,
    chtab_id,
    id: id - 1,
    y: ybottom - image.height + 1,
    blit
  });
  g.table_counts[1] = g.foretable.length;
  return 1;
}
function add_midtable(chtab_id, id, xh, xl, ybottom, blit, peel) {
  if (id === 0) return 0;
  if (g.midtable.length >= 50) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  if (g.obj_direction === directions.dir_0_right && chtab_flip_clip[chtab_id] !== 0) {
    blit += 128;
  }
  g.midtable.push({
    xh,
    xl,
    chtab_id,
    id: id - 1,
    y: ybottom - image.height + 1,
    blit,
    peel,
    clip: {
      left: g.obj_clip_left,
      right: g.obj_clip_right,
      top: g.obj_clip_top,
      bottom: g.obj_clip_bottom
    }
  });
  g.table_counts[3] = g.midtable.length;
  return 1;
}
function add_wipetable(layer, left, bottom, height, width, color) {
  if (g.wipetable.length >= 300) return;
  g.wipetable.push({ left, bottom: bottom + 1, height, width, color, layer });
  g.wipetable_count = g.wipetable.length;
}
function draw_table(which_table) {
  const count = g.table_counts[which_table];
  for (let index = 0; index < count; ++index) {
    if (which_table === 3) draw_mid(index);
    else draw_back_fore(which_table, index);
  }
}
function draw_wipes(which) {
  for (let index = 0; index < g.wipetable.length; ++index) {
    if (which === g.wipetable[index].layer) draw_wipe(index);
  }
}
function draw_back_fore(which_table, index) {
  const entry = which_table === 0 ? g.backtable[index] : g.foretable[index];
  if (!entry) return;
  draw_image(entry.chtab_id, entry.id, entry.xh * 8 + entry.xl, entry.y, entry.blit);
}
function draw_mid(index) {
  const entry = g.midtable[index];
  if (!entry) return;
  const chtab_id = entry.chtab_id;
  let xpos = entry.xh * 8 + entry.xl;
  const ypos = entry.y;
  let blit = entry.blit;
  let blit_flip = false;
  if (blit & 128) {
    blit_flip = true;
    blit &= 127;
  }
  if (chtab_flip_clip[chtab_id]) {
    paint.clip(entry.clip);
    if (chtab_id !== chtabs.id_chtab_0_sword) xpos = calc_screen_x_coord(xpos);
  }
  if (blit_flip) {
    const image = paint.image(chtab_id, entry.id);
    xpos -= image ? image.width : 0;
    blit |= FLIPPED;
  }
  if (entry.peel) {
    const image = paint.image(chtab_id, entry.id);
    if (image) add_peel(xpos, xpos + image.width, ypos, image.height);
  }
  draw_image(chtab_id, entry.id, xpos, ypos, blit);
  if (chtab_flip_clip[chtab_id]) paint.clip(null);
}
var FLIPPED = 32768;
function draw_image(chtab_id, id, xpos, ypos, blit) {
  paint.blit(chtab_id, id, xpos, ypos, blit);
}
function draw_wipe(index) {
  const w = g.wipetable[index];
  paint.rect(w.left, w.bottom - w.height, w.left + w.width, w.bottom, w.color);
}
function calc_gate_pos() {
  gate_top_y = g.draw_bottom_y - 62;
  gate_openness = (Math.min(g.modifier_left, 188) >> 2) + 1;
  gate_bottom_y = g.draw_main_y - gate_openness;
}
function draw_gate_back() {
  calc_gate_pos();
  if (gate_bottom_y + 12 < g.draw_main_y) {
    add_backtable(
      chtabs.id_chtab_6_environment,
      50,
      g.draw_xh,
      0,
      gate_bottom_y,
      blitters.blitters_0_no_transp,
      0
    );
  } else {
    add_backtable(
      chtabs.id_chtab_6_environment,
      tile_table[tiles.tiles_4_gate].right_id,
      g.draw_xh,
      0,
      tile_table[tiles.tiles_4_gate].right_y + g.draw_main_y,
      blitters.blitters_0_no_transp,
      0
    );
    if (can_see_bottomleft()) draw_tile_topright();
    draw_tile_bottom(0);
    draw_loose(0);
    draw_tile_base();
    add_backtable(
      chtabs.id_chtab_6_environment,
      51,
      g.draw_xh,
      0,
      gate_bottom_y - 2,
      blitters.blitters_10h_transp,
      0
    );
  }
  let ybottom = gate_bottom_y - 12;
  if (ybottom < 192) {
    for (; ybottom >= 0 && ybottom > 7 && ybottom - 7 > gate_top_y; ybottom -= 8) {
      add_backtable(
        chtabs.id_chtab_6_environment,
        52,
        g.draw_xh,
        0,
        ybottom,
        blitters.blitters_0_no_transp,
        0
      );
    }
  }
  const gate_frame = ybottom - gate_top_y + 1;
  if (gate_frame > 0 && gate_frame < 9) {
    add_backtable(
      chtabs.id_chtab_6_environment,
      door_fram_slice[gate_frame],
      g.draw_xh,
      0,
      ybottom,
      blitters.blitters_0_no_transp,
      0
    );
  }
}
function draw_gate_fore() {
  calc_gate_pos();
  add_foretable(
    chtabs.id_chtab_6_environment,
    51,
    g.draw_xh,
    0,
    gate_bottom_y - 2,
    blitters.blitters_10h_transp,
    0
  );
  let ybottom = gate_bottom_y - 12;
  if (ybottom < 192) {
    for (; ybottom >= 0 && ybottom > 7 && ybottom - 7 > gate_top_y; ybottom -= 8) {
      add_foretable(
        chtabs.id_chtab_6_environment,
        52,
        g.draw_xh,
        0,
        ybottom,
        blitters.blitters_10h_transp,
        0
      );
    }
  }
}
function draw_moving() {
  draw_mobs2();
  draw_people();
  redraw_needed_tiles();
}
function redraw_needed_tiles() {
  load_leftroom();
  draw_objtable_items_at_tile(30);
  for (g.drawn_row = 2; g.drawn_row >= 0; g.drawn_row--) {
    load_rowbelow();
    g.draw_bottom_y = 63 * g.drawn_row + 65;
    g.draw_main_y = g.draw_bottom_y - 3;
    for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
      load_curr_and_left_tile();
      redraw_needed(tbl_line[g.drawn_row] + g.drawn_col);
    }
  }
  const saved_drawn_room = g.drawn_room;
  g.drawn_room = g.room_A;
  load_room_links();
  load_leftroom();
  g.drawn_row = 2;
  load_rowbelow();
  for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
    load_curr_and_left_tile();
    g.draw_main_y = -1;
    g.draw_bottom_y = 2;
    redraw_needed_above(g.drawn_col);
  }
  g.drawn_room = saved_drawn_room;
  load_room_links();
  draw_objtable_items_at_tile(-1);
}
function draw_tile_wipe(height) {
  add_wipetable(0, g.draw_xh * 8, g.draw_bottom_y, height, 4 * 8, 0);
}
function draw_tables() {
  paint.target(true);
  if (g.is_blind_mode) paint.rect(0, 0, 320, 192, 0);
  restore_peels();
  draw_wipes(0);
  draw_table(0);
  draw_table(3);
  draw_wipes(1);
  draw_table(1);
  paint.target(false);
}
function draw_leveldoor() {
  const ybottom = g.draw_main_y - 13;
  g.leveldoor_right = (g.draw_xh << 3) + 48;
  if (levelType2.of(g.current_level)) g.leveldoor_right += 8;
  add_backtable(
    chtabs.id_chtab_6_environment,
    99,
    g.draw_xh + 1,
    0,
    ybottom,
    blitters.blitters_0_no_transp,
    0
  );
  if (g.modifier_left) {
    if (g.level.start_room !== g.drawn_room) {
      add_backtable(
        chtabs.id_chtab_6_environment,
        144,
        g.draw_xh + 1,
        0,
        ybottom - 4,
        blitters.blitters_0_no_transp,
        0
      );
    } else {
      const leveldoor_width = levelType2.of(g.current_level) === 0 ? 39 : 48;
      const x_low = levelType2.of(g.current_level) === 0 ? 2 : 0;
      add_wipetable(0, 8 * (g.draw_xh + 1) + x_low, ybottom - 4, 45, leveldoor_width, 0);
    }
  }
  g.leveldoor_ybottom = ybottom - (g.modifier_left & 3) - 48;
  const y = ybottom - g.modifier_left;
  for (; ; ) {
    add_backtable(
      chtabs.id_chtab_6_environment,
      33,
      g.draw_xh + 1,
      0,
      g.leveldoor_ybottom,
      blitters.blitters_0_no_transp,
      0
    );
    if (y > g.leveldoor_ybottom) g.leveldoor_ybottom += 4;
    else break;
  }
  add_backtable(
    chtabs.id_chtab_6_environment,
    34,
    g.draw_xh + 1,
    0,
    g.draw_main_y - 64,
    blitters.blitters_0_no_transp,
    0
  );
}
function get_room_address(room) {
  g.loaded_room = room;
  if (room) {
    g.curr_room_tiles = g.level.fg.subarray((room - 1) * 30, room * 30);
    g.curr_room_modif = g.level.bg.subarray((room - 1) * 30, room * 30);
  }
}
function draw_floor_overlay() {
  if (g.tile_left !== tiles.tiles_0_empty) return;
  if (g.curr_tile === tiles.tiles_1_floor || g.curr_tile === tiles.tiles_3_pillar || g.curr_tile === tiles.tiles_5_stuck || g.curr_tile === tiles.tiles_19_torch) {
    if (g.Kid.frame >= frameids.frame_137_climbing_3 && g.Kid.frame <= frameids.frame_144_climbing_10) {
      add_midtable(
        chtabs.id_chtab_6_environment,
        floor_left_overlay[g.Kid.frame - 137],
        g.draw_xh,
        0,
        (g.curr_tile === tiles.tiles_5_stuck ? 1 : 0) + g.draw_main_y,
        blitters.blitters_10h_transp,
        0
      );
    }
    g.ptr_add_table = "mid";
    draw_tile_bottom(0);
    g.ptr_add_table = "back";
  } else {
    draw_other_overlay();
  }
}
function draw_other_overlay() {
  if (g.tile_left === tiles.tiles_0_empty) {
    g.ptr_add_table = "mid";
    draw_tile2();
  } else if (g.curr_tile !== tiles.tiles_0_empty && g.drawn_col > 0 && get_tile_to_draw(
    g.drawn_room,
    g.drawn_col - 2,
    g.drawn_row,
    tiles.tiles_0_empty
  ).tiletype === tiles.tiles_0_empty) {
    g.ptr_add_table = "mid";
    draw_tile2();
    g.ptr_add_table = "back";
    draw_tile2();
    g.tile_object_redraw[tbl_line[g.drawn_row] + g.drawn_col] = 255;
  }
  g.ptr_add_table = "back";
}
function draw_tile2() {
  draw_tile_right();
  draw_tile_anim_right();
  draw_tile_base();
  draw_tile_anim();
  draw_tile_bottom(0);
  draw_loose(0);
}
function draw_objtable_items_at_tile(tilepos) {
  const obj_count = g.objtable.length;
  if (!obj_count) return;
  n_curr_objs = 0;
  curr_objs.length = 0;
  for (let obj_index = obj_count - 1; obj_index >= 0; --obj_index) {
    if (g.objtable[obj_index].tilepos === tilepos) {
      curr_objs[n_curr_objs] = obj_index;
      n_curr_objs++;
    }
  }
  if (n_curr_objs) {
    sort_curr_objs();
    for (let obj_index = 0; obj_index < n_curr_objs; ++obj_index) {
      draw_objtable_item(curr_objs[obj_index]);
    }
  }
}
function sort_curr_objs() {
  const last = n_curr_objs - 1;
  let swapped;
  do {
    swapped = false;
    for (let index = 0; index < last; ++index) {
      if (compare_curr_objs(index, index + 1)) {
        const temp = curr_objs[index];
        curr_objs[index] = curr_objs[index + 1];
        curr_objs[index + 1] = temp;
        swapped = true;
      }
    }
  } while (swapped);
}
function compare_curr_objs(index1, index2) {
  const obj_index1 = curr_objs[index1];
  if (g.objtable[obj_index1].obj_type === 1) return true;
  const obj_index2 = curr_objs[index2];
  if (g.objtable[obj_index2].obj_type === 1) return false;
  if (g.objtable[obj_index1].obj_type === 128 && g.objtable[obj_index2].obj_type === 128) {
    return g.objtable[obj_index1].y < g.objtable[obj_index2].y;
  }
  return g.objtable[obj_index1].y > g.objtable[obj_index2].y;
}
function draw_objtable_item(index) {
  const obj_type = load_obj_from_objtable(index);
  switch (obj_type) {
    case 0:
    // the Prince
    case 4:
      if (g.obj_id === 255) return;
      if (g.united_with_shadow && g.united_with_shadow % 2 === 0) {
        drawShadow();
        return;
      }
    // fallthrough
    case 2:
    // a guard
    case 3:
    // a sword
    case 5:
      add_midtable(
        g.obj_chtab,
        g.obj_id + 1,
        g.obj_xh,
        g.obj_xl,
        g.obj_y,
        blitters.blitters_10h_transp,
        1
      );
      break;
    case 1:
      drawShadow();
      break;
    case 128:
      g.obj_direction = directions.dir_FF_left;
      add_midtable(
        g.obj_chtab,
        loose_fram_left[g.obj_id],
        g.obj_xh,
        g.obj_xl,
        g.obj_y - 3,
        blitters.blitters_10h_transp,
        1
      );
      add_midtable(
        g.obj_chtab,
        loose_fram_bottom[g.obj_id],
        g.obj_xh,
        g.obj_xl,
        g.obj_y,
        0,
        1
      );
      add_midtable(
        g.obj_chtab,
        loose_fram_right[g.obj_id],
        g.obj_x + 4,
        g.obj_xl,
        g.obj_y - 1,
        blitters.blitters_10h_transp,
        1
      );
      break;
    default:
      break;
  }
}
function drawShadow() {
  if (g.united_with_shadow === 2) out.play_sound(soundids.sound_41_end_level_music);
  add_midtable(
    g.obj_chtab,
    g.obj_id + 1,
    g.obj_xh,
    g.obj_xl,
    g.obj_y,
    blitters.blitters_2_or,
    1
  );
  add_midtable(
    g.obj_chtab,
    g.obj_id + 1,
    g.obj_xh,
    g.obj_xl + 1,
    g.obj_y,
    blitters.blitters_3_xor,
    1
  );
}
function load_obj_from_objtable(index) {
  const curr_obj = g.objtable[index];
  g.obj_x = curr_obj.xh;
  g.obj_xh = curr_obj.xh;
  g.obj_xl = curr_obj.xl;
  g.obj_y = curr_obj.y;
  g.obj_id = curr_obj.id;
  g.obj_chtab = curr_obj.chtab_id;
  g.obj_direction = curr_obj.direction;
  g.obj_clip_top = curr_obj.clip.top;
  g.obj_clip_bottom = curr_obj.clip.bottom;
  g.obj_clip_left = curr_obj.clip.left;
  g.obj_clip_right = curr_obj.clip.right;
  return curr_obj.obj_type;
}
function draw_people() {
  check_mirror();
  draw_kid();
  draw_guard();
  reset_obj_clip();
  hp2.draw_hp();
}
function draw_kid() {
  if (g.Kid.room !== 0 && g.Kid.room === g.drawn_room) {
    add_kid_to_objtable();
    if (g.hitp_delta < 0) draw_hurt_splash();
    add_sword_to_objtable();
  }
}
function draw_guard() {
  if (g.Guard.direction !== directions.dir_56_none && g.Guard.room === g.drawn_room) {
    add_guard_to_objtable();
    if (g.guardhp_delta < 0) draw_hurt_splash();
    add_sword_to_objtable();
  }
}
function add_kid_to_objtable() {
  loadkid();
  load_fram_det_col();
  load_frame_to_obj();
  stuck_lower();
  set_char_collision();
  set_objtile_at_char();
  redraw_at_char();
  redraw_at_char2();
  clip_char();
  add_objtable(0);
}
function add_guard_to_objtable() {
  loadshad();
  load_fram_det_col();
  load_frame_to_obj();
  stuck_lower();
  set_char_collision();
  set_objtile_at_char();
  redraw_at_char();
  redraw_at_char2();
  clip_char();
  add_objtable(g.Char.charid === charids.charid_1_shadow ? 1 : 2);
}
function add_objtable(obj_type) {
  if (g.objtable.length >= 50) return;
  const { xh, xl } = x_to_xh_and_xl(g.obj_x);
  g.objtable.push({
    obj_type,
    xh,
    xl,
    y: g.obj_y,
    clip: {
      top: g.obj_clip_top,
      bottom: g.obj_clip_bottom,
      left: g.obj_clip_left,
      right: g.obj_clip_right
    },
    chtab_id: g.obj_chtab,
    id: g.obj_id,
    direction: g.obj_direction,
    tilepos: 30
  });
  g.objtable_count = g.objtable.length;
  mark_obj_tile_redraw(g.objtable.length - 1);
}
function mark_obj_tile_redraw(index) {
  g.objtable[index].tilepos = g.obj_tilepos;
  if (g.obj_tilepos < 30 && g.obj_tilepos >= 0) {
    g.tile_object_redraw[g.obj_tilepos] = 1;
  }
}
function draw_hurt_splash() {
  const frame = g.Char.frame;
  if (frame === frameids.frame_178_chomped) return;
  const saved = {
    x: g.obj_x,
    y: g.obj_y,
    id: g.obj_id,
    chtab: g.obj_chtab,
    tilepos: g.obj_tilepos,
    direction: g.obj_direction
  };
  g.obj_tilepos = -1;
  if (frame === frameids.frame_185_dead || frame >= frameids.frame_106_fall && frame < 111) {
    g.obj_y += 4;
    obj_dx_forward(5);
  } else if (frame === frameids.frame_177_spiked) {
    obj_dx_forward(-5);
  } else {
    g.obj_y -= ((g.Char.charid === charids.charid_0_kid ? 1 : 0) << 2) + 11;
    obj_dx_forward(5);
  }
  if (g.Char.charid === charids.charid_0_kid) {
    g.obj_chtab = chtabs.id_chtab_2_kid;
    g.obj_id = 218;
  } else {
    g.obj_chtab = chtabs.id_chtab_5_guard;
    g.obj_id = 1;
  }
  reset_obj_clip();
  add_objtable(5);
  g.obj_x = saved.x;
  g.obj_y = saved.y;
  g.obj_id = saved.id;
  g.obj_chtab = saved.chtab;
  g.obj_tilepos = saved.tilepos;
  g.obj_direction = saved.direction;
}
function add_sword_to_objtable() {
  const frame = g.Char.frame;
  if (frame >= frameids.frame_229_found_sword && frame < 238 || g.Char.sword !== 0 || g.Char.charid === charids.charid_2_guard && g.Char.alive < 0) {
    const sword_frame = g.cur_frame.sword & 63;
    if (sword_frame) {
      const entry = sword_tbl[sword_frame];
      if (entry && entry.id !== 255) {
        g.obj_id = entry.id;
        g.obj_x = calc_screen_x_coord(g.obj_x);
        obj_dx_forward(entry.x);
        g.obj_y += entry.y;
        g.obj_chtab = chtabs.id_chtab_0_sword;
        add_objtable(3);
      }
    }
  }
}
function calc_screen_x_coord(logical_x) {
  return Math.trunc(logical_x * 320 / 280);
}
function wall_pattern(which_part, which_table) {
  const saved_sim = g.ptr_add_table;
  g.ptr_add_table = which_table === 0 ? "back" : "fore";
  const saved_prng_state = g.random_seed;
  g.random_seed = g.drawn_room + tbl_line[g.drawn_row] + g.drawn_col;
  prandom(1);
  if (levelType2.of(g.current_level) !== 0) {
    if (which_part !== 0) {
      const at = (i) => g.palace_wall_colors[44 * g.drawn_row + i + g.drawn_col];
      add_wipetable(which_table, 8 * g.draw_xh, g.draw_main_y - 40, 20, 4 * 8, at(0));
      add_wipetable(which_table, 8 * g.draw_xh, g.draw_main_y - 19, 21, 2 * 8, at(11));
      add_wipetable(which_table, 8 * (g.draw_xh + 2), g.draw_main_y - 19, 21, 2 * 8, at(12));
      add_wipetable(which_table, 8 * g.draw_xh, g.draw_main_y, 19, 1 * 8, at(22));
      add_wipetable(which_table, 8 * (g.draw_xh + 1), g.draw_main_y, 19, 3 * 8, at(23));
      ptr_add_table(
        chtabs.id_chtab_7_environmentwall,
        prandom(2) + 3,
        g.draw_xh + 3,
        0,
        g.draw_main_y - 53,
        blitters.blitters_46h_mono_6,
        0
      );
      ptr_add_table(
        chtabs.id_chtab_7_environmentwall,
        prandom(2) + 6,
        g.draw_xh,
        0,
        g.draw_main_y - 34,
        blitters.blitters_46h_mono_6,
        0
      );
      ptr_add_table(
        chtabs.id_chtab_7_environmentwall,
        prandom(2) + 9,
        g.draw_xh,
        0,
        g.draw_main_y - 13,
        blitters.blitters_46h_mono_6,
        0
      );
      ptr_add_table(
        chtabs.id_chtab_7_environmentwall,
        prandom(2) + 12,
        g.draw_xh,
        0,
        g.draw_main_y,
        blitters.blitters_46h_mono_6,
        0
      );
    }
    add_wipetable(
      which_table,
      8 * g.draw_xh,
      g.draw_bottom_y,
      3,
      4 * 8,
      g.palace_wall_colors[44 * g.drawn_row + 33 + g.drawn_col]
    );
    ptr_add_table(
      chtabs.id_chtab_7_environmentwall,
      prandom(2) + 15,
      g.draw_xh,
      0,
      g.draw_bottom_y,
      blitters.blitters_46h_mono_6,
      0
    );
    g.ptr_add_table = saved_sim;
    g.random_seed = saved_prng_state;
    return;
  }
  const middle_divider = prandom(1);
  const middle_divider_offset = prandom(4);
  const bottom_divider = prandom(1);
  const bottom_divider_offset = prandom(4);
  const RSET_WALL = chtabs.id_chtab_7_environmentwall;
  const RES_WALL_DIVIDER1 = 11;
  const RES_WALL_RNDBLOCK = 13;
  const BLIT_TRANS = blitters.blitters_10h_transp;
  const BLIT_NO_TRANS = blitters.blitters_0_no_transp;
  const bg_modifier = g.curr_modifier & 127;
  if (bg_modifier === 3) {
    if (which_part !== 0) {
      if (prandom(4) === 0) {
        ptr_add_table(
          RSET_WALL,
          RES_WALL_RNDBLOCK,
          g.draw_xh,
          0,
          g.draw_bottom_y - 42,
          BLIT_NO_TRANS,
          0
        );
      }
      ptr_add_table(
        RSET_WALL,
        RES_WALL_DIVIDER1 + middle_divider,
        g.draw_xh + 1,
        middle_divider_offset,
        g.draw_bottom_y - 21,
        BLIT_TRANS,
        0
      );
    }
    ptr_add_table(
      RSET_WALL,
      RES_WALL_DIVIDER1 + bottom_divider,
      g.draw_xh,
      bottom_divider_offset,
      g.draw_bottom_y,
      BLIT_TRANS,
      0
    );
    if (which_part !== 0) {
      if (prandom(4) === 0) draw_right_mark(prandom(3), middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(
          prandom(4),
          middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider
        );
      }
    }
  } else if (bg_modifier === 0) {
    if (which_part !== 0 && prandom(6) === 0) {
      draw_left_mark(
        prandom(1),
        middle_divider_offset - middle_divider,
        bottom_divider_offset - bottom_divider
      );
    }
  } else if (bg_modifier === 1) {
    if (which_part !== 0) {
      if (prandom(4) === 0) {
        ptr_add_table(
          RSET_WALL,
          RES_WALL_RNDBLOCK,
          g.draw_xh,
          0,
          g.draw_bottom_y - 42,
          BLIT_NO_TRANS,
          0
        );
      }
      ptr_add_table(
        RSET_WALL,
        RES_WALL_DIVIDER1 + middle_divider,
        g.draw_xh + 1,
        middle_divider_offset,
        g.draw_bottom_y - 21,
        BLIT_TRANS,
        0
      );
      if (prandom(4) === 0) draw_right_mark(prandom(3), middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(
          prandom(3),
          middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider
        );
      }
    }
  } else if (bg_modifier === 2) {
    if (which_part !== 0) {
      ptr_add_table(
        RSET_WALL,
        RES_WALL_DIVIDER1 + middle_divider,
        g.draw_xh + 1,
        middle_divider_offset,
        g.draw_bottom_y - 21,
        BLIT_TRANS,
        0
      );
    }
    ptr_add_table(
      RSET_WALL,
      RES_WALL_DIVIDER1 + bottom_divider,
      g.draw_xh,
      bottom_divider_offset,
      g.draw_bottom_y,
      BLIT_TRANS,
      0
    );
    if (which_part !== 0) {
      if (prandom(4) === 0) draw_right_mark(prandom(1) + 2, middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(
          prandom(4),
          middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider
        );
      }
    }
  }
  g.random_seed = saved_prng_state;
  g.ptr_add_table = saved_sim;
}
var LPOS = [58, 41, 37, 20, 16];
var RPOS = [52, 42, 31, 21];
var RES_WALL_MARK_TL = 14;
var RES_WALL_MARK_BL = 15;
var RES_WALL_MARK_TR = 16;
var RES_WALL_MARK_BR = 17;
function draw_left_mark(decal_variant, arg2, arg1) {
  let image_id = RES_WALL_MARK_TL;
  let lv2 = 0;
  if (decal_variant % 2) image_id = RES_WALL_MARK_BL;
  if (decal_variant > 3) lv2 = arg1 + 6;
  else if (decal_variant > 1) lv2 = arg2 + 6;
  ptr_add_table(
    chtabs.id_chtab_7_environmentwall,
    image_id,
    g.draw_xh + (decal_variant === 2 || decal_variant === 3 ? 1 : 0),
    lv2,
    g.draw_bottom_y - LPOS[decal_variant],
    blitters.blitters_10h_transp,
    0
  );
}
function draw_right_mark(decal_variant, arg1) {
  let image_id = RES_WALL_MARK_TR;
  if (decal_variant % 2) image_id = RES_WALL_MARK_BR;
  if (decal_variant < 2) arg1 = 24;
  else arg1 -= 3;
  ptr_add_table(
    chtabs.id_chtab_7_environmentwall,
    image_id,
    g.draw_xh + (decal_variant > 1 ? 1 : 0),
    arg1,
    g.draw_bottom_y - RPOS[decal_variant],
    blitters.blitters_10h_transp,
    0
  );
}
function display_text_bottom(text) {
  paint.text(text);
}
function erase_bottom_text(arg_0) {
  paint.text(null);
  if (arg_0) {
    g.text_time_total = 0;
    g.text_time_remaining = 0;
  }
}
function show_time() {
  if (g.rem_min !== 0 && g.current_level < 13 && g.current_level < 15) {
    --g.rem_tick;
    if (g.rem_tick === 0) {
      g.rem_tick = 719;
      --g.rem_min;
      if (g.rem_min !== 0 && (g.rem_min <= 5 || g.rem_min % 5 === 0)) {
        g.is_show_time = 1;
      }
    } else if (g.rem_min === 1 && g.rem_tick % 12 === 0) {
      g.is_show_time = 1;
      g.text_time_remaining = 0;
    }
  }
  if (g.is_show_time && g.text_time_remaining === 0) {
    g.text_time_remaining = g.text_time_total = 24;
    if (g.rem_min > 0) {
      if (g.rem_min === 1) {
        const rem_sec = Math.floor((g.rem_tick + 1) / 12);
        if (rem_sec === 1) {
          g.text_time_remaining = g.text_time_total = 12;
          display_text_bottom("1 SECOND LEFT");
        } else {
          display_text_bottom(`${rem_sec} SECONDS LEFT`);
        }
      } else {
        display_text_bottom(`${g.rem_min} MINUTES LEFT`);
      }
    } else {
      display_text_bottom("TIME HAS EXPIRED!");
    }
    g.is_show_time = 0;
  }
}
function show_level() {
  const disp_level = g.current_level;
  if (disp_level !== 0 && disp_level < 14 && g.seamless === 0) {
    g.text_time_remaining = g.text_time_total = 24;
    display_text_bottom(`LEVEL ${disp_level === 13 ? 12 : disp_level}`);
    g.is_show_time = 1;
  }
  g.seamless = 0;
}
var mobs = { draw_mobs: () => {
} };
function draw_mobs2() {
  mobs.draw_mobs();
}

// src/pop/seg000.ts
var screen = { different_room: 0 };
function play_frame() {
  do_mobs();
  process_trobs();
  check_skel();
  check_can_guard_see_kid();
  if (play_kid_frame()) return;
  play_guard_frame();
  if (g.resurrect_time === 0) {
    check_sword_hurting();
    check_sword_hurt();
  }
  check_sword_vs_sword();
  do_delta_hp();
  exit_room();
  check_the_end();
  check_guard_fallout();
  show_time();
}
function draw_kid_hp(curr_hp, max_hp) {
  for (let i = curr_hp; i < max_hp; ++i) {
    paintBlit(chtabs_id_chtab_2_kid, 217, i * 7, 194, 0);
  }
  for (let i = 0; i < curr_hp; ++i) {
    paintBlit(chtabs_id_chtab_2_kid, 216, i * 7, 194, 0);
  }
}
function draw_guard_hp(curr_hp, max_hp) {
  if (!g.chtab_addrs[chtabs_id_chtab_5_guard]) return;
  const guard_charid = g.Guard.charid;
  if (guard_charid !== charids.charid_4_skeleton && guard_charid !== charids.charid_24_mouse && (guard_charid !== charids.charid_1_shadow || g.current_level === 12)) {
    for (let i = curr_hp; i < max_hp; ++i) {
      paintBlit(chtabs_id_chtab_5_guard, 0, 314 - i * 7, 194, 9);
    }
    for (let i = 0; i < curr_hp; ++i) {
      paintBlit(chtabs_id_chtab_5_guard, 0, 314 - i * 7, 194, 0);
    }
  }
}
function add_life() {
  let hpmax = g.hitp_max;
  ++hpmax;
  if (hpmax > 10) hpmax = 10;
  g.hitp_max = hpmax;
  set_health_life();
}
function set_health_life() {
  g.hitp_delta = g.hitp_max - g.hitp_curr;
}
function draw_hp() {
  if (g.hitp_delta) draw_kid_hp(g.hitp_curr, g.hitp_max);
  const blink_state = g.rem_tick & 1;
  if (g.hitp_curr === 1 && g.current_level !== 15) {
    if (blink_state) draw_kid_hp(1, 0);
    else draw_kid_hp(0, 1);
  }
  if (g.guardhp_delta) draw_guard_hp(g.guardhp_curr, g.guardhp_max);
  if (g.guardhp_curr === 1) {
    if (blink_state) draw_guard_hp(1, 0);
    else draw_guard_hp(0, 1);
  }
}
var chtabs_id_chtab_2_kid = 2;
var chtabs_id_chtab_5_guard = 5;
function play_kid_frame() {
  loadkid_and_opp();
  load_fram_det_col();
  check_killed_shadow();
  play_kid();
  if (g.is_restart_level) return 1;
  if (g.Char.room !== 0) {
    play_seq();
    fall_accel();
    fall_speed();
    load_frame_to_obj();
    load_fram_det_col();
    set_char_collision();
    bump_into_opponent();
    check_collisions();
    check_bumped();
    check_gate_push();
    check_action();
    check_press();
    check_spike_below();
    if (g.resurrect_time === 0) {
      check_spiked();
      check_chomped_kid();
    }
    check_knock();
  }
  savekid_and_opp();
  return 0;
}
function play_guard_frame() {
  if (g.Guard.direction !== directions.dir_56_none) {
    loadshad_and_opp();
    load_fram_det_col();
    check_killed_shadow();
    play_guard();
    if (g.Char.room === g.drawn_room) {
      play_seq();
      if (g.Char.x >= 44 && g.Char.x < 211) {
        fall_accel();
        fall_speed();
        load_frame_to_obj();
        load_fram_det_col();
        set_char_collision();
        check_guard_bumped();
        check_action();
        check_press();
        check_spike_below();
        check_spiked();
        check_chomped_guard();
      }
    }
    saveshad_and_opp();
  }
}
function gen_palace_wall_colors() {
  const old_randseed = g.random_seed;
  g.random_seed = g.drawn_room;
  prandom(1);
  for (let row = 0; row < 3; row++) {
    for (let subrow = 0; subrow < 4; subrow++) {
      const color_base = subrow % 2 ? 97 : 102;
      let prev_color = -1;
      for (let column = 0; column <= 10; ++column) {
        let color;
        do {
          color = color_base + prandom(3);
        } while (color === prev_color);
        g.palace_wall_colors[44 * row + 11 * subrow + column] = color;
        prev_color = color;
      }
    }
  }
  g.random_seed = old_randseed;
}
function check_the_end() {
  if (g.next_room !== 0 && g.next_room !== g.drawn_room) {
    g.drawn_room = g.next_room;
    load_room_links();
    screen.different_room = 1;
    loadkid();
    anim_tile_modif();
    start_chompers();
    check_fall_flo();
    check_shadow();
  }
}
function check_fall_flo() {
  if (g.current_level === 13 && (g.drawn_room === 23 || g.drawn_room === 16)) {
    g.curr_room = g.room_A;
    get_room_address(g.curr_room);
    for (g.curr_tilepos = 22; g.curr_tilepos <= 27; ++g.curr_tilepos) {
      make_loose_fall(-(prandom(255) & 15));
    }
  }
}
function anim_tile_modif() {
  for (let tilepos = 0; tilepos < 30; ++tilepos) {
    switch (get_curr_tile(tilepos)) {
      case tiles.tiles_10_potion:
        start_anim_potion(g.drawn_room, tilepos);
        break;
      case tiles.tiles_19_torch:
      case tiles.tiles_30_torch_with_debris:
        start_anim_torch(g.drawn_room, tilepos);
        break;
      case tiles.tiles_22_sword:
        start_anim_sword(g.drawn_room, tilepos);
        break;
      default:
        break;
    }
  }
  for (let row = 0; row <= 2; row++) {
    const t = get_tile(g.room_L, 9, row);
    if (t === tiles.tiles_19_torch || t === tiles.tiles_30_torch_with_debris) {
      start_anim_torch(g.room_L, row * 10 + 9);
    }
  }
}
function check_sword_vs_sword() {
  if (g.Kid.frame === 167 || g.Guard.frame === 167) {
    out.play_sound(soundids.sound_10_sword_vs_sword);
  }
}
function do_delta_hp() {
  if (g.Opp.charid === charids.charid_1_shadow && g.current_level === 12 && g.guardhp_delta !== 0) {
    g.hitp_delta = g.guardhp_delta;
  }
  g.hitp_curr = Math.min(Math.max(g.hitp_curr + g.hitp_delta, 0), g.hitp_max);
  g.guardhp_curr = Math.min(Math.max(g.guardhp_curr + g.guardhp_delta, 0), g.guardhp_max);
}
function check_killed_shadow() {
  if (g.current_level === 12) {
    if ((g.Char.charid | g.Opp.charid) === charids.charid_1_shadow && g.Char.alive < 0 && g.Opp.alive >= 0) {
      g.flash_color = 15;
      g.flash_time = 5;
      take_hp(100);
    }
  }
}
function redraw_screen() {
  g.exit_room_timer = 2;
}

// src/pop/game.ts
var CHTAB_NAME = [
  "sword",
  "flameSwordPotion",
  "kid",
  null,
  null,
  "guard",
  "environment",
  "environmentWall",
  null,
  null
];
var linked = false;
function link() {
  if (linked) return;
  linked = true;
  l7.start_chompers.fn = start_chompers;
  l7.make_loose_fall.fn = make_loose_fall;
  l7.trigger_button.fn = trigger_button;
  l7.is_spike_harmful.fn = is_spike_harmful;
  l7.start_anim_spike.fn = start_anim_spike;
  l8.set_wipe.fn = set_wipe;
  l8.set_redraw_full.fn = set_redraw_full;
  l8.set_redraw_fore.fn = set_redraw_fore;
  l8.set_redraw2.fn = set_redraw2;
  l8.set_redraw_floor_overlay.fn = set_redraw_floor_overlay;
  l8.set_redraw_anim.fn = set_redraw_anim;
  l8.get_room_address.fn = get_room_address;
  l8.add_objtable.fn = add_objtable;
  l8.mark_obj_tile_redraw.fn = mark_obj_tile_redraw;
  l5.do_fall.fn = do_fall;
  l5.spiked.fn = spiked;
  l5.control.fn = control;
  l5.seqtbl_offset_char.fn = seqtbl_offset_char;
  l6.control_guard_inactive.fn = control_guard_inactive;
  l2.autocontrol_opponent.fn = autocontrol_opponent;
  l2.clear_char.fn = clear_char;
  l2.died_on_button.fn = died_on_button;
  l2.set_start_pos.fn = () => {
  };
  l2.on_guard_killed.fn = on_guard_killed;
  l2.inc_curr_row.fn = inc_curr_row;
  dist2.char_opp_dist = char_opp_dist;
  dist.char_opp_dist = char_opp_dist;
  rooms.goto_other_room = goto_other_room;
  mobs.draw_mobs = draw_mobs;
  hp2.draw_hp = draw_hp;
  hp.draw_guard_hp = draw_guard_hp;
  hp.add_life = add_life;
}
var DEATH_MUSIC_TICKS = 36;
var TEXT_RECT = { top: 193, left: 70, bottom: 202, right: 250 };
var TEXT_WHITE = 15;
var PopGame = class _PopGame {
  scene;
  surface = new Surface();
  levelNumber;
  /** `custom->intro_music_level`: the level whose opening has music. */
  introMusicLevel = 1;
  /** `is_restart_level`, which the shell acts on between ticks. */
  restartDue = false;
  /** The first tick of a level does nothing, as the original's does. */
  pendingFirstTick = true;
  /** The screen has to be drawn whole: `need_full_redraw`. */
  needFullRedraw = true;
  /** The game's own font, out of the executable. */
  font;
  /** `draw_level_first` has still to put the hit points up. */
  firstDraw = false;
  /** Where `play_sound` goes, if the shell has a speaker. */
  effects;
  /** `current_target_surface`: the room's 192 rows, or the whole screen. */
  roomTarget = false;
  /**
   * How much of the death music is left to play.
   *
   * `play_kid` counts `Char.alive` up a tick at a time once the Prince
   * is dead, starts the music at six, and will not go past seven while
   * `check_sound_playing()` says something is still sounding -- so
   * `Press Button to Continue` comes up seven ticks after the death
   * plus the length of the music. A replay has no sound, so this
   * stands in for it.
   *
   * Measured as the gap between the tick the Prince dies and the tick
   * the words appear in the captures: 25c4ebb8 46, 5920a8c2 47,
   * 756b259c 47, 9b60bf3a 49, 13ab6867 52.
   */
  deathMusic = 0;
  clipRect = null;
  /**
   * Renders that do not count against the words under the room.
   *
   * The level's opening picture is on the screen for two frames: the
   * one `draw_level_first` drew it on, and the one the level's first
   * tick does nothing in -- see `pendingFirstTick`. Neither is a
   * `draw_game_frame`, so neither spends one of `LEVEL 1`'s twenty-four
   * ticks. Measured: the capture has `LEVEL 1` on ticks 0 to 24,
   * nothing on 25, and `60 MINUTES LEFT` from 26 to 48.
   */
  textTicksToSkip = 0;
  constructor(scene, levelNumber) {
    this.scene = scene;
    this.levelNumber = levelNumber;
  }
  static async start(assets, exe, levelNumber, options = {}) {
    link();
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? "V");
    const game = new _PopGame(scene, levelNumber);
    game.effects = options.effects;
    game.install(exe);
    game.startLevel();
    return game;
  }
  /**
   * The level again, as the original restarts it after a death.
   *
   * `init_game` resets the clock and the hit points the level starts
   * with, and it is called once: the restart happens inside
   * `play_level`'s own loop, which never goes back out to it. So an
   * hour is an hour for the whole game, however many times the Prince
   * dies, and the capture of `probeF` says `59 MINUTES LEFT` where a
   * port that started the clock again says `60`.
   */
  async restart(assets, exe) {
    const carried = {
      rem_min: g.rem_min,
      rem_tick: g.rem_tick,
      hitp_beg_lev: g.hitp_beg_lev,
      checkpoint: g.checkpoint
    };
    const game = await _PopGame.start(assets, exe, this.levelNumber, { effects: this.effects });
    g.rem_min = carried.rem_min;
    g.rem_tick = carried.rem_tick;
    g.checkpoint = carried.checkpoint;
    if (carried.hitp_beg_lev !== g.hitp_beg_lev) {
      g.hitp_beg_lev = carried.hitp_beg_lev;
      g.hitp_max = carried.hitp_beg_lev;
      g.hitp_curr = carried.hitp_beg_lev;
      g.hitp_delta = 1;
    }
    g.need_level1_music = 0;
    return game;
  }
  /** `start_level`: the level's data into the globals, once. */
  install(exe) {
    const tables = readExeTables(exe);
    this.font = readFont(exe);
    setFrameTables(
      tables.frameTableKid,
      tables.frameTableGuard,
      tables.frameTableCutscene,
      tables.sequences,
      Array.from(tables.sequenceOffsets)
    );
    const constants = readExeConstants(exe);
    this.introMusicLevel = constants.introMusicLevel;
    const level = this.scene.level;
    const type = this.scene.options.levelType;
    levelType2.of = () => type;
    levelType.of = () => type;
    guards.hp = (n) => constants.guardHitPoints[n] ?? 0;
    guards.type = () => this.scene.guardType === 4 ? 2 : 0;
    g.level = {
      fg: this.scene.state.fg,
      bg: this.scene.state.modifiers,
      doorlinks1: Uint8Array.from(level.doorLinks1),
      doorlinks2: Uint8Array.from(level.doorLinks2),
      roomlinks: Array.from({ length: 24 }, (_, i) => ({
        left: level.roomLinks[i * 4],
        right: level.roomLinks[i * 4 + 1],
        up: level.roomLinks[i * 4 + 2],
        down: level.roomLinks[i * 4 + 3]
      })),
      start_room: level.startRoom,
      start_pos: level.startPos,
      start_dir: level.startDir,
      guards_tile: Uint8Array.from(level.guards.map((x) => x.tile)),
      guards_dir: Uint8Array.from(level.guards.map((x) => x.dir & 255)),
      guards_x: Uint8Array.from(level.guards.map((x) => x.x)),
      guards_seq_lo: Uint8Array.from(level.guards.map((x) => x.seqLo)),
      guards_skill: Uint8Array.from(level.guards.map((x) => x.skill)),
      guards_seq_hi: Uint8Array.from(level.guards.map((x) => x.seqHi)),
      guards_color: Uint8Array.from(level.guards.map((x) => x.color))
    };
    g.chtab_addrs = CHTAB_NAME.map((name) => {
      if (!name) return null;
      const set = this.scene.chtabs[name];
      return set ? set.images.slice(1) : null;
    });
    out.display_text_bottom = display_text_bottom;
    out.erase_bottom_text = erase_bottom_text;
    out.play_death_music = () => {
      this.deathMusic = DEATH_MUSIC_TICKS;
    };
    out.play_sound = (which) => {
      this.effects?.sound?.(which);
    };
    out.stop_sounds = () => {
      this.effects?.stopSounds?.();
    };
    out.check_sound_playing = () => this.deathMusic > 0 || this.effects?.soundPlaying?.() ? 1 : 0;
    setPainter({
      image: (chtab, id) => this.imageOf(chtab, id),
      blit: (chtab, id, x, y, blit) => this.blit(chtab, id, x, y, blit),
      rect: (left, top, right, bottom, color) => {
        const floor = this.roomTarget ? 192 : 200;
        const low = Math.min(bottom, floor);
        if (low > top) this.surface.fillRect(left, top, right - left, low - top, color);
      },
      clip: (rect) => this.setClip(rect),
      text: (text) => this.drawBottomText(text),
      readPeel: (left, top, right, bottom) => this.readPeel(left, top, right, bottom),
      restorePeel: (peel) => this.restorePeel(peel),
      target: (room) => {
        this.roomTarget = room;
        this.setClip(this.clipRect);
      }
    });
    g.current_level = this.levelNumber;
    g.next_level = this.levelNumber;
    set_seed(1);
    g.hitp_beg_lev = constants.startHitPoints ?? 3;
    g.rem_min = 60;
    g.rem_tick = 719;
    g.text_time_remaining = 0;
    g.text_time_total = 0;
    g.is_show_time = 0;
    g.seamless = 0;
    g.Kid = newChar();
    g.Guard = newChar();
    g.Char = newChar();
    g.Opp = newChar();
    g.objtable = [];
    g.trobs = [];
    g.trobs_count = 0;
    g.mobs = [];
    g.mobs_count = 0;
    g.wipetable = [];
    g.wipetable_count = 0;
    g.leveldoor_open = 0;
    g.exit_room_timer = 0;
    g.have_sword = 0;
    clear_coll_rooms();
    clear_tile_wipes();
  }
  /** `start_level` proper: `do_startpos` and the room it opens in. */
  startLevel() {
    g.united_with_shadow = 0;
    g.flash_time = 0;
    g.leveldoor_open = 0;
    g.guardhp_curr = 0;
    g.hitp_delta = 0;
    g.Guard.charid = 2;
    g.Guard.direction = 86;
    loadkid();
    do_startpos();
    g.have_sword = this.levelNumber === 0 || this.levelNumber >= 2 ? 1 : 0;
    g.need_level1_music = this.effects?.sound && this.levelNumber === this.introMusicLevel ? 1 : 0;
    g.drawn_room = g.Kid.room;
    load_room_links();
    get_room_address(g.drawn_room);
    find_start_level_door();
    pos_guards();
    anim_tile_modif();
    loadkid();
    start_chompers();
    enter_guard();
    if (levelType2.of(g.current_level)) gen_palace_wall_colors();
    redraw_screen();
    this.surface.clear(0);
    show_level();
    this.firstDraw = true;
    this.textTicksToSkip = 1;
  }
  /**
   * `show_text(&rect_bottom_text, halign_center, valign_bottom, ...)`,
   * and `draw_rect(&rect_bottom_text, color_0_black)` before it.
   */
  drawBottomText(text) {
    this.surface.fillRect(
      TEXT_RECT.left,
      TEXT_RECT.top,
      TEXT_RECT.right - TEXT_RECT.left,
      TEXT_RECT.bottom - TEXT_RECT.top,
      0
    );
    if (text === null || !this.font) return;
    drawTextCentred(
      this.surface,
      this.font,
      text,
      TEXT_RECT.left,
      TEXT_RECT.right - 1,
      TEXT_RECT.top,
      TEXT_WHITE
    );
  }
  imageOf(chtab, id) {
    const name = CHTAB_NAME[chtab];
    if (!name) return null;
    const set = this.scene.chtabs[name];
    return set?.images[id + 1] ?? null;
  }
  spriteOf(chtab, id) {
    const name = CHTAB_NAME[chtab];
    if (!name) return null;
    const set = this.scene.chtabs[name];
    const image = set?.images[id + 1];
    return image ? { image, base: set.paletteBase } : null;
  }
  setClip(rect) {
    this.clipRect = rect;
    const floor = this.roomTarget ? 192 : 200;
    if (rect) {
      this.surface.clipTop = rect.top;
      this.surface.clipBottom = Math.min(rect.bottom, floor);
      this.surface.clipLeft = rect.left;
      this.surface.clipRight = rect.right;
    } else {
      this.surface.clipTop = 0;
      this.surface.clipBottom = floor;
      this.surface.clipLeft = 0;
      this.surface.clipRight = 320;
    }
  }
  blit(chtab, id, x, y, blit) {
    const found = this.spriteOf(chtab, id);
    if (!found) return;
    let sprite = found.image;
    if (blit & FLIPPED) {
      sprite = flipHorizontally(sprite);
      blit &= ~FLIPPED;
    }
    if (blit === blitters.blitters_9_black) {
      this.surface.blitMono(sprite, x, y, 0);
      return;
    }
    if (blit === blitters.blitters_3_xor) {
      this.surface.blitXor(sprite, x, y, found.base);
      return;
    }
    if (blit >= blitters.blitters_40h_mono) {
      this.surface.blitMono(sprite, x, y, blit & 15);
      return;
    }
    if (blit === blitters.blitters_10h_transp || blit === blitters.blitters_2_or) {
      this.surface.blitTransparent(sprite, x, y, found.base);
      return;
    }
    this.surface.blitOpaque(sprite, x, y, found.base);
  }
  /**
   * `read_peel_from_screen` and `restore_peel`.
   *
   * How the original rubs out a moving thing: before a character is
   * drawn, the rectangle it is about to cover is read off the screen,
   * and at the top of the next frame's `draw_tables` it is put back.
   * Nothing else erases a character -- `redraw_at_char` only marks the
   * tiles whose *foreground* has to go on again -- so without this the
   * Prince leaves a copy of himself behind on every tick.
   */
  readPeel(left, top, right, bottom) {
    const x0 = Math.max(0, Math.min(320, left));
    const x1 = Math.max(x0, Math.min(320, right));
    const y0 = Math.max(0, Math.min(200, top));
    const y1 = Math.max(y0, Math.min(200, bottom));
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      pixels.set(
        this.surface.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width
      );
    }
    return { left: x0, top: y0, width, height, pixels };
  }
  restorePeel(peel) {
    for (let y = 0; y < peel.height; y++) {
      this.surface.pixels.set(
        peel.pixels.subarray(y * peel.width, (y + 1) * peel.width),
        (peel.top + y) * 320 + peel.left
      );
    }
  }
  /** The player pressing the button after a death. */
  pressButton() {
    if (g.Kid.alive >= 0) this.restartDue = true;
  }
  step(controls) {
    if (this.pendingFirstTick) {
      this.pendingFirstTick = false;
      return;
    }
    g.control_x = controls.x < 0 ? -1 : controls.x > 0 ? 1 : 0;
    g.control_y = controls.y < 0 ? -1 : controls.y > 0 ? 1 : 0;
    g.control_shift = controls.shift ? -1 : 0;
    g.guardhp_delta = 0;
    g.hitp_delta = 0;
    if (this.deathMusic > 0) --this.deathMusic;
    timers();
    play_frame();
    if (g.is_restart_level) {
      g.is_restart_level = 0;
      this.restartDue = true;
    }
  }
  /** `redraw_screen(drawing_different_room)`. */
  /**
   * `set_chtab_palette(chtab_addrs[id_chtab_5_guard], &guard_palettes[
   * 0x30 * curr_guard_color - 0x30], 0x10)`, at the top of
   * `redraw_screen`: a guard's clothes are recoloured per room from the
   * palettes PRINCE.DAT keeps. Colour nought leaves the bank as it is,
   * as the original does.
   */
  applyGuardColour() {
    const colour = guardColor.value;
    const set = this.scene.chtabs.guard;
    const palettes = this.scene.guardPalettes;
    if (!set) return;
    if (!palettes || colour === 0) {
      this.scene.screenPalette.loadBlock(set.paletteBase, set.palette.vga);
      return;
    }
    const at = (colour - 1) * 48;
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
  redrawScreen(differentRoom) {
    this.applyGuardColour();
    if (differentRoom) {
      this.surface.fillRect(0, 0, 320, 192, 0);
    }
    screen.different_room = 0;
    redraw_room();
    draw_tables();
    reset_tables();
    draw_moving();
    draw_tables();
    redraw_screen();
  }
  /** `draw_game_frame`. */
  render() {
    if (this.needFullRedraw) {
      this.needFullRedraw = false;
      this.redrawScreen(false);
      if (this.firstDraw) {
        this.firstDraw = false;
        draw_kid_hp(g.hitp_curr, g.hitp_max);
        return this.surface;
      }
    } else if (screen.different_room) {
      g.drawn_room = g.next_room;
      if (levelType2.of(g.current_level)) gen_palace_wall_colors();
      this.redrawScreen(true);
    } else {
      reset_tables();
      draw_moving();
      draw_tables();
    }
    this.tickBottomText();
    return this.surface;
  }
  /**
   * The tail of `draw_game_frame`: a message counts down and is rubbed
   * out, and `Press Button to Continue` blinks for its last six
   * seconds.
   */
  tickBottomText() {
    if (this.textTicksToSkip > 0) {
      --this.textTicksToSkip;
      return;
    }
    if (g.text_time_remaining === 1) {
      if (g.text_time_total === 36 || g.text_time_total === 288) {
        erase_bottom_text(1);
      } else {
        erase_bottom_text(1);
      }
      return;
    }
    if (g.text_time_remaining !== 0 && g.text_time_total !== 1188) {
      --g.text_time_remaining;
      if (g.text_time_total === 288 && g.text_time_remaining < 72) {
        const blink_frame = g.text_time_remaining % 12;
        if (blink_frame > 3) {
          erase_bottom_text(0);
        } else if (blink_frame === 3) {
          display_text_bottom("Press Button to Continue");
        }
      }
    }
  }
  get kid() {
    return g.Kid;
  }
  /**
   * The guard, with his hit points beside him.
   *
   * The C keeps a guard's strength in `guardhp_curr` rather than in the
   * character, and the shell reads it off the guard, so this puts the
   * two together.
   */
  get guard() {
    return Object.assign(Object.create(Object.getPrototypeOf(g.Guard)), g.Guard, {
      hitPoints: g.guardhp_curr,
      maxHitPoints: g.guardhp_max
    });
  }
  get hitPoints() {
    return g.hitp_curr;
  }
  get maxHitPoints() {
    return g.hitp_max;
  }
  /** `drawn_room`, which the shell also sets to look round the level. */
  get drawnRoom() {
    return g.drawn_room;
  }
  set drawnRoom(room) {
    this.showRoom(room);
  }
  /** `Char.alive >= 0`: the death animation has begun. */
  get isDead() {
    return g.Kid.alive >= 0;
  }
  /** `Press Button to Continue` is up: `text_time_total` is its 288. */
  get awaitingButton() {
    return g.text_time_total === 288 && g.text_time_remaining !== 0;
  }
  /** The level's door has been gone through: `next_level` moved on. */
  get levelFinished() {
    return g.next_level !== g.current_level;
  }
  /** `rem_min` and `rem_tick` as one number, for the shell's clock. */
  get remainingTicks() {
    return g.rem_min * 720 + g.rem_tick;
  }
  set remainingTicks(ticks) {
    g.rem_min = Math.max(0, Math.floor(ticks / 720));
    g.rem_tick = Math.max(1, ticks - g.rem_min * 720);
  }
  /** `have_sword`, which the shell carries from one level to the next. */
  get hasSword() {
    return g.have_sword !== 0;
  }
  set hasSword(has) {
    g.have_sword = has ? 1 : 0;
  }
  /**
   * `process_key`, less what belongs to a DOS machine.
   *
   * The original reads the keyboard twice: `read_keyb_control` turns
   * the arrows and Shift into the three `control_` globals the game
   * plays on, and `process_key` handles everything else -- the pause,
   * the clock, the restart, the cheats. The first of those is the
   * shell's `step`; these are the second. What is left out is what a
   * browser has no business doing or cannot do: quitting, saving to
   * disc, the joystick, redefining the keys.
   *
   * Each one says which case of the C's switch it stands for.
   */
  /** Space: `is_show_time = 1`. */
  showTime() {
    g.is_show_time = 1;
  }
  /** Esc: `is_paused`. The shell stops stepping while it is set. */
  get paused() {
    return g.is_paused !== 0;
  }
  set paused(on) {
    g.is_paused = on ? 1 : 0;
    if (on) this.say("GAME PAUSED", 0);
    else erase_bottom_text(1);
  }
  /**
   * `display_text_bottom(answer_text)` with the twenty-four ticks
   * `process_key` gives an answer. `ticks` of nought leaves it up
   * until something takes it away, which is what the pause wants.
   */
  say(text, ticks = 24) {
    display_text_bottom(text);
    g.text_time_total = ticks;
    g.text_time_remaining = ticks;
  }
  /** Ctrl+A: start the level again. Level 15 is the potions level. */
  restartLevel() {
    if (this.levelNumber === 15) return;
    out.stop_sounds();
    g.is_restart_level = 1;
  }
  /**
   * Shift+L: on to the next level.
   *
   * Without the cheats the original allows it only below level 4, and
   * takes the clock down to fifteen minutes if more than that is left.
   */
  skipLevel(cheats) {
    if (!(this.levelNumber < 4 || cheats)) return false;
    if (this.levelNumber === 14) g.next_level = 1;
    else {
      g.next_level = this.levelNumber + 1;
      if (!cheats && g.rem_min > 15) {
        g.rem_min = 15;
        g.rem_tick = 719;
      }
    }
    out.stop_sounds();
    return true;
  }
  /** `c` and Shift+C: the numbers of the rooms around this one. */
  get roomsAround() {
    return `S${g.drawn_room} L${g.room_L} R${g.room_R} A${g.room_A} B${g.room_B}`;
  }
  get roomsDiagonal() {
    return `AL${g.room_AL} AR${g.room_AR} BL${g.room_BL} BR${g.room_BR}`;
  }
  /** H, J, U, N and Ctrl+B, as room numbers. */
  get roomLeft() {
    return g.room_L;
  }
  get roomRight() {
    return g.room_R;
  }
  get roomAbove() {
    return g.room_A;
  }
  get roomBelow() {
    return g.room_B;
  }
  /** '+' and '-': a minute on the clock either way. */
  addMinutes(n) {
    g.rem_min = Math.max(1, g.rem_min + n);
    g.text_time_total = 0;
    g.text_time_remaining = 0;
    g.is_show_time = 1;
  }
  /** R: the Prince gets up again. */
  resurrect() {
    if (g.Kid.alive <= 0) return;
    g.resurrect_time = 20;
    g.Kid.alive = -1;
    erase_bottom_text(1);
  }
  /** K: the guard falls over. A skeleton cannot be killed. */
  killGuard() {
    if (g.Guard.charid === 4) return;
    g.guardhp_delta = -g.guardhp_curr;
    g.Guard.alive = 0;
  }
  /** Shift+S: one hit point back, with the small potion's red flash. */
  heal() {
    if (g.hitp_curr === g.hitp_max) return;
    out.play_sound(33);
    g.hitp_delta = 1;
    g.flash_color = 4;
    g.flash_time = 2;
  }
  /** Shift+T: another flask on the bar. */
  addLife() {
    out.play_sound(30);
    g.flash_color = 4;
    g.flash_time = 4;
    add_life();
  }
  /** Shift+W: the feather, with the green flash and the low note. */
  featherFall() {
    g.is_feather_fall = 1;
    g.flash_color = 2;
    g.flash_time = 3;
    out.stop_sounds();
    out.play_sound(39);
  }
  /** Shift+B: the room goes dark and the Prince plays on without it. */
  toggleBlind() {
    g.is_blind_mode = g.is_blind_mode ? 0 : 1;
    this.needFullRedraw = true;
  }
  /** Shift+I: the screen turns over. The shell does the turning. */
  toggleUpsideDown() {
    g.upside_down = g.upside_down ? 0 : -1;
  }
  get upsideDown() {
    return g.upside_down !== 0;
  }
  /**
   * Show another room without playing: the view-the-level keys.
   *
   * `next_room = room` and the screen drawn whole, which is what the
   * original's H, J, U and N do.
   */
  showRoom(room) {
    if (room === g.drawn_room) return;
    g.drawn_room = room;
    g.next_room = room;
    if (levelType2.of(g.current_level)) gen_palace_wall_colors();
    load_room_links();
    get_room_address(room);
    anim_tile_modif();
    start_chompers();
    this.needFullRedraw = true;
  }
};

// src/dat/sound.ts
var SOUND_RESOURCE_BASE = 1e4;
var SPEAKER_END = 18;
function parseSound(payload) {
  if (payload.length < 2) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  switch (payload[0] & 7) {
    case 1: {
      if (payload.length < 9) return null;
      const rate = dv.getUint16(1, true);
      const count = dv.getUint16(3, true);
      const samples = payload.subarray(8, 8 + count);
      if (samples.length === 0) return null;
      return { kind: "digi", rate: rate || 11e3, samples };
    }
    case 2:
      return { kind: "midi", bytes: payload.subarray(1) };
    case 0: {
      if (payload.length < 6) return null;
      const tempo = dv.getUint16(1, true);
      const notes = [];
      for (let o = 3; o + 2 < payload.length; o += 3) {
        const divisor = dv.getUint16(o, true);
        if (divisor === SPEAKER_END) break;
        notes.push({ divisor, length: payload[o + 2] });
      }
      if (notes.length === 0) return null;
      return { kind: "speaker", tempo, notes };
    }
    default:
      return null;
  }
}

// src/render/music.ts
var hzOf = (note) => 440 * 2 ** ((note - 69) / 12);
var DRUMS = 9;
function midiNotes(sound) {
  const b = sound.bytes;
  if (b.length < 14 || b[0] !== 77 || b[1] !== 84) return [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const division = dv.getUint16(12, false);
  if (division & 32768 || division === 0) return [];
  const raw = [];
  const tempos = [];
  let at = 8 + dv.getUint32(4, false);
  while (at + 8 <= b.length) {
    const isTrack = b[at] === 77 && b[at + 1] === 84 && b[at + 2] === 114 && b[at + 3] === 107;
    const len = dv.getUint32(at + 4, false);
    const start = at + 8;
    const end = Math.min(b.length, start + len);
    at = start + len;
    if (!isTrack) continue;
    let p = start;
    let tick = 0;
    let status = 0;
    const varLen = () => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const c = b[p++];
        v = v << 7 | c & 127;
        if (!(c & 128)) break;
      }
      return v;
    };
    while (p < end) {
      tick += varLen();
      if (p >= end) break;
      let byte = b[p];
      if (byte & 128) {
        status = byte;
        p++;
      }
      byte = status;
      if (byte === 255) {
        const type = b[p++];
        const n = varLen();
        if (type === 81 && n === 3) {
          tempos.push({ tick, usPerBeat: b[p] << 16 | b[p + 1] << 8 | b[p + 2] });
        }
        p += n;
        if (type === 47) break;
      } else if (byte === 240 || byte === 247) {
        p += varLen();
      } else {
        const kind = byte & 240;
        const ch = byte & 15;
        const a = b[p++];
        const two = kind !== 192 && kind !== 208;
        const c = two ? b[p++] : 0;
        if (kind === 144 && c > 0) raw.push({ tick, on: true, note: a, vel: c, ch });
        else if (kind === 128 || kind === 144) raw.push({ tick, on: false, note: a, vel: 0, ch });
      }
    }
  }
  tempos.sort((x, y) => x.tick - y.tick);
  raw.sort((x, y) => x.tick - y.tick || (x.on ? 1 : 0) - (y.on ? 1 : 0));
  let ti = 0;
  let usPerBeat = 5e5;
  let lastTick = 0;
  let lastSec = 0;
  const seconds = (tick) => {
    while (ti < tempos.length && tempos[ti].tick <= tick) {
      const t = tempos[ti++];
      lastSec += (t.tick - lastTick) * usPerBeat / (division * 1e6);
      lastTick = t.tick;
      usPerBeat = t.usPerBeat;
    }
    return lastSec + (tick - lastTick) * usPerBeat / (division * 1e6);
  };
  const notes = [];
  const open = /* @__PURE__ */ new Map();
  for (const e of raw) {
    const key = e.ch * 128 + e.note;
    const when = seconds(e.tick);
    if (e.on) {
      open.set(key, { at: when, vel: e.vel });
    } else {
      const was = open.get(key);
      if (!was) continue;
      open.delete(key);
      if (e.ch === DRUMS) continue;
      notes.push({
        at: was.at,
        dur: Math.max(0.03, when - was.at),
        hz: hzOf(e.note),
        level: was.vel / 127,
        channel: e.ch
      });
    }
  }
  return notes.sort((a, b2) => a.at - b2.at);
}
function speakerNotes(sound) {
  const notes = [];
  let at = 0;
  const tempo = sound.tempo || 1e3;
  for (const n of sound.notes) {
    const dur = n.length / tempo;
    if (n.divisor > 1) {
      notes.push({ at, dur, hz: n.divisor, level: 1, channel: 0 });
    }
    at += dur;
  }
  return notes;
}
var Tune = class {
  nodes = [];
  sink;
  /** When the last note ends, in the sink's own clock. */
  endsAt;
  onended = null;
  constructor(sink, notes, wave) {
    this.sink = sink;
    const t0 = sink.currentTime + 0.03;
    let end = t0;
    for (const n of notes.slice(0, 600)) {
      const osc = sink.createOscillator();
      const gain = sink.createGain();
      osc.type = wave;
      osc.frequency.value = n.hz;
      const start = t0 + n.at;
      const stop = start + n.dur;
      const peak = 0.11 * n.level;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 8e-3);
      gain.gain.setValueAtTime(peak, Math.max(start + 9e-3, stop - 0.02));
      gain.gain.linearRampToValueAtTime(0, stop);
      osc.connect(gain);
      gain.connect(sink.destination);
      osc.start(start);
      osc.stop(stop + 0.01);
      this.nodes.push({ osc, gain });
      if (stop > end) end = stop;
    }
    this.endsAt = end;
    const last = this.nodes[this.nodes.length - 1];
    if (last) last.osc.onended = () => {
      this.onended?.();
    };
  }
  get empty() {
    return this.nodes.length === 0;
  }
  stop() {
    const now = this.sink.currentTime;
    for (const { osc, gain } of this.nodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        osc.stop(now);
      } catch {
      }
    }
    this.nodes.length = 0;
  }
};

// src/render/audio.ts
var DIGI_FILES = ["DIGISND1.DAT", "DIGISND2.DAT", "DIGISND3.DAT"];
var MIDI_FILES = ["MIDISND1.DAT", "MIDISND2.DAT"];
var SPEAKER_FILES = ["IBM_SND1.DAT", "IBM_SND2.DAT"];
async function loadSound(assets, index, files = DIGI_FILES) {
  for (const name of files) {
    let dat;
    try {
      dat = await assets.dat(name);
    } catch {
      continue;
    }
    if (!dat.has(SOUND_RESOURCE_BASE + index)) continue;
    const sound = parseSound(dat.get(SOUND_RESOURCE_BASE + index));
    if (sound) return sound;
  }
  return null;
}
var PRIORITY = [
  20,
  30,
  35,
  102,
  50,
  55,
  48,
  48,
  75,
  80,
  13,
  18,
  12,
  11,
  105,
  110,
  115,
  120,
  125,
  130,
  145,
  150,
  155,
  160,
  1,
  1,
  1,
  1,
  1,
  19,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  1,
  1,
  1,
  135,
  140,
  15,
  16,
  21,
  22,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  0
];
var INTERRUPTIBLE = [
  0,
  1,
  1,
  1,
  1,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  1,
  1,
  0,
  1,
  1,
  1,
  1,
  1,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0
];
var priorityOf = (i) => PRIORITY[i] ?? 255;
var interruptibleOf = (i) => (INTERRUPTIBLE[i] ?? 1) !== 0;
var SoundPlayer = class {
  assets;
  context;
  buffers = /* @__PURE__ */ new Map();
  /**
   * The reads in flight, by index.
   *
   * A set of indices was enough while nothing waited for one, but
   * `play` now starts a read and leaves the sound to be played when it
   * lands, and a second `preload` of the same index has to wait for
   * that read rather than return as though it were done.
   */
  pending = /* @__PURE__ */ new Map();
  /** Nothing is played until the player has touched the page. */
  woken = false;
  /**
   * What is playing. The original had one channel: a new sound stopped
   * whatever was in it, which is why the byte-code can ask for silence by
   * name. Letting them pile up turns a run into a wall of noise.
   */
  playing = null;
  /** Which sound is in the channel, for the rule above. */
  playingIndex = -1;
  /**
   * The last sound asked for that had not been read off the disc yet.
   *
   * A one-off -- a button, a footstep, the first drink of the game --
   * used to be thrown away while its sample loaded, and the player
   * heard nothing where the original made a noise. The load is quick,
   * so the sound is still worth having when it lands; anything asked
   * for since has already taken the channel, and this is dropped.
   */
  waitingFor = -1;
  muted = false;
  constructor(assets, context) {
    this.assets = assets;
    this.context = context;
  }
  /** Call from the first key or click: a browser blocks sound before one. */
  async wake() {
    this.woken = true;
    if (this.context.state === "suspended") await this.context.resume();
  }
  /**
   * Play sound `index`, loading it the first time it is asked for.
   *
   * A sound that is not loaded yet is not played: the alternative is to
   * play it late, a second after the thing that made it, which is worse
   * than silence. The load is started all the same, so the next one is
   * ready.
   */
  play(index) {
    if (this.muted || !this.woken) return;
    if (index === SOUND_SILENCE) {
      this.stop();
      return;
    }
    if (!this.mayTake(index)) return;
    const buffer = this.buffers.get(index);
    if (buffer === void 0) {
      this.waitingFor = index;
      void this.preload(index);
      return;
    }
    if (buffer === null) return;
    this.start(index, buffer);
  }
  /**
   * Whether `index` may have the channel, by the original's rule: it
   * may if nothing is sounding, or if what is sounding may be
   * interrupted and `index` is at least as important.
   */
  mayTake(index) {
    if (!this.playing) return true;
    return interruptibleOf(this.playingIndex) && priorityOf(index) <= priorityOf(this.playingIndex);
  }
  start(index, what) {
    this.waitingFor = -1;
    this.stop();
    if (what.kind === "tune") {
      const sink = this.context;
      if (typeof this.context.createOscillator !== "function") return;
      const tune = new Tune(sink, what.notes, what.wave);
      if (tune.empty) return;
      tune.onended = () => {
        if (this.playing === tune) {
          this.playing = null;
          this.playingIndex = -1;
        }
      };
      this.playing = tune;
      this.playingIndex = index;
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = what.buffer;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.playing === source) {
        this.playing = null;
        this.playingIndex = -1;
      }
    };
    source.start();
    this.playing = source;
    this.playingIndex = index;
  }
  /**
   * `check_sound_playing`: something is still in the channel.
   *
   * A tune is asked its own end time rather than trusted to report
   * itself finished. `onended` fires on one oscillator of the many a
   * tune schedules, and a tune that lost that event -- or never
   * scheduled a note at all -- would leave the channel looking busy
   * for ever, which is not a quiet bug: the Prince waits crouched at
   * the start of level 1 until the opening has finished, and he would
   * wait there for good.
   */
  get isPlaying() {
    const playing = this.playing;
    if (!playing) return false;
    if (playing instanceof Tune) {
      if ((this.context.currentTime ?? 0) < playing.endsAt) return true;
      this.playing = null;
      this.playingIndex = -1;
      return false;
    }
    return true;
  }
  /** Empty the one channel, as the original does when a sound starts. */
  stop() {
    const source = this.playing;
    this.playing = null;
    this.playingIndex = -1;
    if (!source) return;
    try {
      source.stop();
    } catch {
    }
  }
  /**
   * What an index turned out to be.
   *
   * A recording is looked for first, because that is what the game
   * sounded like on the hardware this port is measured against. Where
   * there is none -- all of the music, and four of the effects -- the
   * MIDI is used, and where there is no MIDI either, the tune the
   * original wrote for the PC speaker.
   */
  async readPlayable(index) {
    const digi = await loadSound(this.assets, index, DIGI_FILES);
    if (digi && digi.kind === "digi") {
      const buffer = this.context.createBuffer(1, digi.samples.length, digi.rate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < digi.samples.length; i++) {
        channel[i] = (digi.samples[i] - 128) / 128;
      }
      return { kind: "digi", buffer };
    }
    const midi = await loadSound(this.assets, index, MIDI_FILES);
    if (midi && midi.kind === "midi") {
      const notes = midiNotes(midi);
      if (notes.length) return { kind: "tune", notes, wave: "triangle" };
    }
    const beep = await loadSound(this.assets, index, SPEAKER_FILES);
    if (beep && beep.kind === "speaker") {
      const notes = speakerNotes(beep);
      if (notes.length) return { kind: "tune", notes, wave: "square" };
    }
    return null;
  }
  /** Read a sound and turn it into something playable, once. */
  async preload(index) {
    if (this.buffers.has(index)) return;
    const already = this.pending.get(index);
    if (already) return already;
    const read = this.read(index);
    this.pending.set(index, read);
    return read;
  }
  async read(index) {
    try {
      const playable = await this.readPlayable(index);
      this.buffers.set(index, playable);
      if (playable && this.waitingFor === index && !this.muted && this.woken && this.mayTake(index)) {
        this.start(index, playable);
      }
    } catch {
      this.buffers.set(index, null);
    } finally {
      this.pending.delete(index);
      if (this.waitingFor === index) this.waitingFor = -1;
    }
  }
  /** Read every sound the game raises in play, so none of them is late. */
  async preloadAll(indices) {
    for (const index of indices) await this.preload(index);
  }
};

// src/game/traps.ts
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

// web/main.ts
var DATA_URL = window.__princeDataUrl ?? "../original/prince1";
var FRAMES_PER_SECOND = 12;
async function boot() {
  const canvas = document.getElementById("screen");
  const aspectSel = document.getElementById("aspect");
  const status = document.getElementById("status");
  const display = new Display(canvas);
  const custom = window.__princeFetcher;
  const fetchFile = custom ?? browserFetcher(DATA_URL);
  const assets = new Assets(fetchFile);
  const exe = await fetchFile("UNCRKD.EXE");
  let sound = null;
  const wakeSound = () => {
    if (!sound) {
      const Ctor = window;
      const Context = Ctor.AudioContext ?? Ctor.webkitAudioContext;
      if (!Context) return;
      sound = new SoundPlayer(assets, new Context());
      const ALL_SOUNDS = Array.from({ length: 57 }, (_, i) => i);
      void sound.preloadAll([
        ...Object.values(SOUND),
        ...SEQUENCE_SOUND.filter((i) => i !== SOUND_SILENCE),
        ...ALL_SOUNDS
      ]);
    }
    void sound.wake();
  };
  const effects = {
    sound: (which) => sound?.play(which),
    stopSounds: () => sound?.stop(),
    soundPlaying: () => sound?.isPlaying ?? false
  };
  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group("TITLE.DAT", 50);
  const opening = await assets.group("TITLE.DAT", 40);
  const views = [{ kind: "title" }, { kind: "opening" }];
  for (let n = 1; n <= 14; n++) views.push({ kind: "level", level: n });
  const label = (v) => v.kind === "level" ? `level ${v.level}` : `${v.kind} screen`;
  let current = 0;
  let game = null;
  let watchRoom = null;
  const held = /* @__PURE__ */ new Set();
  const pressedSinceStep = /* @__PURE__ */ new Set();
  const controls = () => {
    const down = (d) => held.has(d) || pressedSinceStep.has(d);
    return {
      x: (down("right") ? 1 : 0) - (down("left") ? 1 : 0),
      y: (down("down") ? 1 : 0) - (down("up") ? 1 : 0),
      shift: down("shift")
    };
  };
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
    const v = views[current];
    if (v.kind !== "level") {
      game = null;
      drawTitle(v.kind === "title" ? title : opening);
      status.textContent = v.kind === "title" ? "press any key to begin" : "the hour is up \u2014 press any key";
      return;
    }
    game = await PopGame.start(assets, exe, v.level, { effects });
    watchRoom = null;
  }
  const recordBtn = document.getElementById("record");
  const saveBtn = document.getElementById("save");
  const recorder = {
    on: false,
    started: 0,
    ticks: [],
    events: [],
    states: [],
    level: 0,
    start() {
      this.on = true;
      this.started = performance.now();
      this.ticks = [];
      this.events = [];
      this.states = [];
      this.level = w0Level();
    },
    stop() {
      this.on = false;
    },
    key(type, code) {
      if (!this.on || this.events.length >= MAX_RECORDED_EVENTS) return;
      this.events.push({
        ms: Math.round((performance.now() - this.started) * 10) / 10,
        tick: this.ticks.length,
        type,
        key: code
      });
    },
    tick(c, g2) {
      if (!this.on || this.ticks.length >= MAX_RECORDED_TICKS) return;
      this.ticks.push({ ...c });
      this.states.push({
        tick: this.ticks.length - 1,
        frame: g2.kid.frame,
        room: g2.kid.room,
        x: g2.kid.x,
        y: g2.kid.y,
        hitPoints: g2.hitPoints
      });
    },
    toJson() {
      const out2 = {
        format: RECORDING_FORMAT,
        version: RECORDING_VERSION,
        recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
        level: this.level,
        ticksPerSecond: FRAMES_PER_SECOND,
        timeline: encodeTimeline(this.ticks),
        events: this.events,
        states: this.states
      };
      return JSON.stringify(out2);
    }
  };
  const MAX_RECORDED_TICKS = 12 * 60 * 20;
  const MAX_RECORDED_EVENTS = 2e4;
  const w0Level = () => {
    const v = views[current];
    return v.kind === "level" ? v.level : 0;
  };
  const flipped = new Surface();
  function present(g2) {
    const drawn = g2.render();
    if (!g2.upsideDown) {
      display.present(drawn, g2.scene.screenPalette.toRgba());
      return;
    }
    for (let y = 0; y < 200; y++) {
      flipped.pixels.set(drawn.pixels.subarray(y * 320, y * 320 + 320), (199 - y) * 320);
    }
    display.present(flipped, g2.scene.screenPalette.toRgba());
  }
  function frame() {
    if (!game) return;
    if (game.paused) {
      present(game);
      status.textContent = "paused \u2014 press any key";
      return;
    }
    if (watchRoom === null) {
      const c = controls();
      pressedSinceStep.clear();
      game.step(c);
      recorder.tick(c, game);
      if (game.restartDue) {
        void changeScene(restart);
        return;
      }
      if (game.levelFinished) {
        void changeScene(nextLevel);
        return;
      }
    } else if (game.drawnRoom !== watchRoom) {
      game.showRoom(watchRoom);
    }
    present(game);
    const v = views[current];
    status.textContent = game.awaitingButton ? `${label(v)} \u2014 press any key to begin the level again` : watchRoom === null ? `${label(v)} \u2014 ${CONTROLS}` : `${label(v)}, room ${watchRoom} \u2014 looking around; press a key to play`;
  }
  aspectSel?.addEventListener("change", () => {
    aspectSel.blur();
    display.setAspect(aspectSel.value);
  });
  const cheats = true;
  function keyName(e) {
    const mod = (e.ctrlKey || e.metaKey ? "ctrl+" : "") + (e.shiftKey ? "shift+" : "");
    const code = e.code;
    if (/^Key[A-Z]$/.test(code)) return mod + code.slice(3).toLowerCase();
    if (code === "NumpadAdd" || code === "Equal") return mod + "+";
    if (code === "NumpadSubtract" || code === "Minus") return mod + "-";
    if (code === "Space") return mod + "space";
    if (code === "Escape") return mod + "escape";
    if (code === "Enter" || code === "NumpadEnter") return mod + "enter";
    return mod + code.toLowerCase();
  }
  function command(e) {
    const key = keyName(e);
    if (!game) return false;
    switch (key) {
      case "space":
        game.showTime();
        return true;
      case "escape":
      case "shift+escape":
        game.paused = true;
        return true;
      case "ctrl+a":
        game.restartLevel();
        return true;
      case "ctrl+r":
        void changeScene(restartGame);
        return true;
      case "ctrl+s":
        if (sound) sound.muted = !sound.muted;
        game.say(sound && !sound.muted ? "SOUND ON" : "SOUND OFF");
        return true;
      case "ctrl+k":
        game.say("KEYBOARD MODE");
        return true;
      case "ctrl+j":
        game.say("JOYSTICK NOT FOUND");
        return true;
      case "ctrl+v":
        game.say("PRINCE OF PERSIA  V1.0");
        return true;
      case "shift+l":
        if (!game.skipLevel(cheats)) return true;
        return true;
      default:
        break;
    }
    if (!cheats) return false;
    switch (key) {
      case "c":
        game.say(game.roomsAround);
        return true;
      case "shift+c":
        game.say(game.roomsDiagonal);
        return true;
      case "+":
        game.addMinutes(1);
        return true;
      case "-":
        game.addMinutes(-1);
        return true;
      case "r":
        game.resurrect();
        return true;
      case "k":
        game.killGuard();
        return true;
      case "shift+i":
        game.toggleUpsideDown();
        return true;
      case "shift+w":
        game.featherFall();
        return true;
      case "shift+b":
        game.toggleBlind();
        return true;
      case "shift+s":
        game.heal();
        return true;
      case "shift+t":
        game.addLife();
        return true;
      case "h":
        watchRoom = game.roomLeft;
        return true;
      case "j":
        watchRoom = game.roomRight;
        return true;
      case "u":
        watchRoom = game.roomAbove;
        return true;
      case "n":
        watchRoom = game.roomBelow;
        return true;
      case "ctrl+b":
        watchRoom = game.kid.room;
        return true;
      default:
        return false;
    }
  }
  window.addEventListener("keydown", (e) => {
    if (e.altKey) return;
    wakeSound();
    document.activeElement?.blur?.();
    if (!game) {
      e.preventDefault();
      void changeScene(async () => {
        await select(views.findIndex((v) => v.kind === "level" && v.level === 1));
      });
      return;
    }
    if (game.paused) {
      e.preventDefault();
      game.paused = false;
      return;
    }
    if (game.awaitingButton) {
      e.preventDefault();
      game.pressButton();
      return;
    }
    if (command(e)) {
      e.preventDefault();
      return;
    }
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    if (dirs.length === 0) held.clear();
    for (const d of dirs) {
      held.add(d);
      pressedSinceStep.add(d);
    }
    recorder.key("down", e.code);
    if (watchRoom !== null) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
    if (dirs.includes("shift")) game.pressButton();
  });
  window.addEventListener("keyup", (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    for (const d of dirs) held.delete(d);
    recorder.key("up", e.code);
  });
  window.addEventListener("blur", () => {
    held.clear();
    pressedSinceStep.clear();
  });
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
    if (down) {
      held.add(d);
      pressedSinceStep.add(d);
    } else held.delete(d);
    recorder.key(down ? "down" : "up", key);
    if (down && d === "shift") game?.pressButton();
    if (down) wakeSound();
    if (down && watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  };
  let changing = false;
  async function changeScene(what) {
    if (changing) return;
    changing = true;
    try {
      await what();
    } finally {
      changing = false;
    }
  }
  async function nextLevel() {
    if (!game) return;
    const v = views[current];
    const was = v.kind === "level" ? v.level : 1;
    const carried = { ticks: game.remainingTicks, sword: game.hasSword };
    held.clear();
    const next = views.findIndex((x) => x.kind === "level" && x.level === was + 1);
    if (next < 0) {
      await select(1);
      return;
    }
    await select(next);
    if (!game) return;
    game.remainingTicks = carried.ticks;
    game.hasSword = carried.sword || game.hasSword;
    watchRoom = null;
  }
  async function restartGame() {
    held.clear();
    await select(0);
  }
  async function restart() {
    if (!game) return;
    held.clear();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }
  recordBtn?.addEventListener("click", () => {
    void (async () => {
      recordBtn.blur();
      if (recorder.on) {
        recorder.stop();
        recordBtn.textContent = "record keys";
        if (saveBtn) saveBtn.disabled = recorder.ticks.length === 0;
        return;
      }
      if (!game) return;
      await restart();
      recorder.start();
      recordBtn.textContent = "stop recording";
      if (saveBtn) saveBtn.disabled = true;
    })();
  });
  saveBtn?.addEventListener("click", () => {
    saveBtn.blur();
    if (!recorder.ticks.length) return;
    const blob = new Blob([recorder.toJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const when = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `prince-keys-level${recorder.level}-${when}.json`;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1e4);
  });
  await select(0);
  const STEP_MS = 1e3 / FRAMES_PER_SECOND;
  let paused = false;
  let owed = 0;
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS;
    if (paused) {
      owed = 0;
      return;
    }
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
  w.__princePause = (on) => {
    paused = on;
  };
  w.__princeState = () => game ? {
    frame: game.kid.frame,
    room: game.kid.room,
    x: game.kid.x,
    y: game.kid.y,
    hitPoints: game.hitPoints,
    dead: game.isDead,
    held: [...held].sort(),
    awaitingButton: game.awaitingButton,
    level: w0Level(),
    sword: game.kid.sword,
    guard: game.guard.direction === NO_DIRECTION ? null : {
      frame: game.guard.frame,
      x: game.guard.x,
      hitPoints: game.guard.hitPoints,
      alive: game.guard.alive
    }
  } : null;
  w.__princeGoToLevel = (level) => {
    const at = views.findIndex((v) => v.kind === "level" && v.level === level);
    if (at >= 0) void changeScene(() => select(at));
  };
  w.__princeLevel = () => views[current].kind === "level" ? views[current].level : 0;
  w.__princeReady = true;
  void RoomRenderer;
}
boot().catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
