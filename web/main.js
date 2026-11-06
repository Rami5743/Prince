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
var Assets = class {
  constructor(fetcher) {
    this.fetcher = fetcher;
  }
  fetcher;
  dats = /* @__PURE__ */ new Map();
  async dat(name) {
    let d = this.dats.get(name);
    if (!d) {
      d = new DatFile(await this.fetcher(name), name);
      this.dats.set(name, d);
    }
    return d;
  }
  /** Load a sprite group: its header resource plus the images that follow. */
  async group(file, header) {
    const d = await this.dat(file);
    const palette = parsePalette(d.get(header));
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
    return { palette, paletteRgba: paletteToRgba(palette), images };
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
  /** Copy every pixel, including index 0. */
  blitOpaque(src, x, y) {
    this.blit(src, x, y, false);
  }
  /** Copy every pixel except index 0, which the original treats as see-through. */
  blitTransparent(src, x, y) {
    this.blit(src, x, y, true);
  }
  blit(src, x, y, transparent) {
    const x0 = Math.max(0, -x);
    const y0 = Math.max(0, -y);
    const x1 = Math.min(src.width, this.width - x);
    const y1 = Math.min(src.height, this.height - y);
    for (let sy = y0; sy < y1; sy++) {
      let sp = sy * src.width + x0;
      let dp = (y + sy) * this.width + (x + x0);
      for (let sx = x0; sx < x1; sx++, sp++, dp++) {
        const v = src.pixels[sp];
        if (transparent && v === 0) continue;
        this.pixels[dp] = v;
      }
    }
  }
  /** Expand to RGBA using a 16-entry palette, for putImageData. */
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

// web/main.ts
var DATA_URL = "../original/prince1";
async function boot() {
  const canvas = document.getElementById("screen");
  const sceneSel = document.getElementById("scene");
  const aspectSel = document.getElementById("aspect");
  const status = document.getElementById("status");
  const display = new Display(canvas);
  const surface = new Surface();
  const assets = new Assets(browserFetcher(DATA_URL));
  const opening = await assets.group("TITLE.DAT", 40);
  const title = await assets.group("TITLE.DAT", 50);
  const scenes = [
    {
      id: "title-background",
      label: "title screen background",
      draw(s) {
        const img = title.images[1];
        s.blitOpaque(img, 0, 0);
        return title.paletteRgba;
      }
    },
    {
      id: "opening-background",
      label: "opening screen background",
      draw(s) {
        s.blitOpaque(opening.images[1], 0, 0);
        return opening.paletteRgba;
      }
    }
  ];
  for (const sc of scenes) {
    const o = document.createElement("option");
    o.value = sc.id;
    o.textContent = sc.label;
    sceneSel.append(o);
  }
  let current = scenes[0];
  const render = () => {
    surface.clear();
    const pal = current.draw(surface);
    display.present(surface, pal);
    status.textContent = `${current.label} \u2014 320x200, drawn from the original data files`;
  };
  sceneSel.addEventListener("change", () => {
    current = scenes.find((s) => s.id === sceneSel.value) ?? scenes[0];
    render();
  });
  aspectSel.addEventListener("change", () => {
    display.setAspect(aspectSel.value);
  });
  render();
  window.__princeFrame = (sceneId) => {
    if (sceneId) {
      const sc = scenes.find((s) => s.id === sceneId);
      if (!sc) throw new Error(`no scene ${sceneId}`);
      surface.clear();
      const pal = sc.draw(surface);
      return Array.from(surface.toRgb(pal));
    }
    return Array.from(surface.toRgb(current.draw(surface)));
  };
  window.__princeReady = true;
  void paletteToRgba;
}
boot().catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
