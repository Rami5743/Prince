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
  /** One entry's six-bit components. */
  entry(i) {
    const o = i * 3;
    return [this.rgb6[o], this.rgb6[o + 1], this.rgb6[o + 2]];
  }
  /** Put one entry's six-bit components back, as `set_bg_attr` does. */
  setEntry(i, r, g2, b) {
    const o = i * 3;
    if (this.rgb6[o] === r && this.rgb6[o + 1] === g2 && this.rgb6[o + 2] === b) return;
    this.rgb6[o] = r;
    this.rgb6[o + 1] = g2;
    this.rgb6[o + 2] = b;
    this.dirty = true;
  }
  /**
   * RGBA bytes, expanding each 6-bit component the way the DAC did.
   *
   * **The six bits are a fraction of full scale, not the high bits of
   * a byte.** A DAC fed 63 drives the line to its maximum, so 63 is
   * 255 and not 252, and the expansion is `(v << 2) | (v >> 4)` --
   * the six bits with their own top two repeated underneath, which is
   * `round(v * 255 / 63)` for every one of the sixty-four values.
   * The port used a bare `v << 2`, which is every colour in the game
   * 1.2 per cent dark and a white that is not white.
   *
   * DOSBox agrees: `machine=svga_s3` renders a DAC entry of 60 as
   * 243 and one of 20 as 81, which is this formula and not `v << 2`.
   * (`machine=vgaonly`, which the oracle used to run, goes through a
   * 16-bit RGB565 lookup instead and throws the low bit of red and
   * blue away -- see `tools/oracle/README.md`.)
   */
  toRgba() {
    if (this.dirty) {
      for (let i = 0; i < PALETTE_SIZE2; i++) {
        const r = this.rgb6[i * 3] & 63;
        const g2 = this.rgb6[i * 3 + 1] & 63;
        const b = this.rgb6[i * 3 + 2] & 63;
        this.rgba[i * 4] = r << 2 | r >> 4;
        this.rgba[i * 4 + 1] = g2 << 2 | g2 >> 4;
        this.rgba[i * 4 + 2] = b << 2 | b >> 4;
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
  /**
   * `blitters_0_no_transp`, with the sprite's colour 0 written as the
   * screen's own black rather than as colour 0 of the sprite's bank.
   *
   * The two are the same picture -- colour 0 of every bank in the
   * game is black -- and nothing in a room can tell them apart. The
   * princess's room can: `load_intro` lays the room down and then ORs
   * the bed into it with `blitters_2_or`, and the bed's pixels are
   * only where the room's are nought. OR the bed's 224+v into the
   * room's own 208 and the result is 240+v, a row of the palette the
   * game never loads -- a bed painted in black. OR it into nought and
   * the bed is in its own colours, which is the picture the original
   * shows.
   */
  blitOpaqueBlack(src, x, y, base = 0) {
    this.each(src, x, y, (dp, v) => {
      this.pixels[dp] = v === 0 ? 0 : base + v;
    });
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
  /**
   * `blitters_3_xor`: the VGA write-mode that XORs the sprite's byte
   * into the one on the screen.
   *
   * **A pixel the sprite leaves at nought changes nothing**, because
   * `d ^ 0 == d`. The port XORed `base + v` instead of `v`, so every
   * transparent pixel of the sprite's box had the bank's palette base
   * XORed into it -- 112 for the Kid's bank -- and the only thing in
   * the game drawn this way is the **shadow**, who is an
   * `blitters_2_or` and a `blitters_3_xor` of the same frame a pixel
   * apart. That is the box the player sees behind the shadow of
   * level 12, where he carries a sword and is drawn from a bank
   * whose base is not nought.
   *
   * Measured: `shadow6` 279 of 280 to **280, exact**, and nothing
   * else in the suite moves. `shadow5` was already 300 of 300 and
   * stays there.
   */
  blitXor(src, x, y, base = 0) {
    this.each(src, x, y, (dp, v) => {
      if (v === 0) return;
      this.pixels[dp] ^= base + v;
    });
  }
  /**
   * `blitters_2_or`: the VGA write-mode that ORs the byte already on
   * the screen with the sprite's.
   *
   * A pixel the sprite leaves at nought has no bits to set and so is
   * see-through, which is why this was translated as an ordinary
   * transparent blit and went unnoticed: over black -- which is all a
   * tapestry is usually drawn over -- the two give the same picture.
   * Over something already drawn they do not, and a capture of
   * `palace4` says which is right. The Prince jumps for the ledge of
   * room 10 with his arm in the top three rows of the screen, the
   * tapestry of the room above is drawn over him with this blitter,
   * and at (220,0) the capture has colour 117. The Prince's own pixel
   * there is 113 and the tapestry's is 85; 113 | 85 is 117, and a
   * transparent blit gives 85.
   */
  blitOr(src, x, y, base = 0) {
    this.each(src, x, y, (dp, v) => {
      if (v === 0) return;
      this.pixels[dp] |= base + v;
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

// src/render/kid-hires.ts
var KID_BANK = 112;
var BANK_SIZE = 16;
var KID_FIRST_SPRITE = 401;
var KID_SPRITE_COUNT = 219;
var KID_HIRES_DIR = "graphics/kid-10x";
var KID_HIRES_SCALE = 10;
function fadeOf(live, base) {
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < BANK_SIZE; i++) {
    const at = (KID_BANK + i) * 4;
    top += live[at] + live[at + 1] + live[at + 2];
    bottom += base[i * 3] + base[i * 3 + 1] + base[i * 3 + 2];
  }
  if (bottom === 0) return 1;
  return Math.min(1, top / bottom);
}
function near(mask, w, h, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      if (mask[yy * w + xx]) return true;
    }
  }
  return false;
}
var KidHiRes = class {
  source = /* @__PURE__ */ new Map();
  scaled = /* @__PURE__ */ new Map();
  covers = /* @__PURE__ */ new Map();
  /** The bank the sprites were painted for: sixteen RGB triples, 0..255. */
  base = [];
  /** The sixteen colours of `KID.DAT`'s own header, DAC-expanded. */
  setBasePalette(rgb) {
    this.base = rgb;
  }
  /** Is there artwork for this frame yet? */
  has(id) {
    return this.source.has(id);
  }
  /** Keep one decoded sprite. The page fetches and decodes them. */
  put(id, image) {
    this.source.set(id, image);
  }
  /**
   * Draw every sprite the game drew into the composed frame.
   *
   * `rgba` is the finished picture at `factor` times the surface,
   * which is what `presentHigh` has just composed; `surface` is the
   * 320 by 200 the game itself drew, and is the mask.
   */
  draw(rgba, factor, surface, sprites, fade) {
    let drawn = 0;
    const w = surface.width;
    const h = surface.height;
    const pitch = w * factor;
    for (const s of sprites) {
      const art = this.at(s.id, factor, s.flipped);
      const cover = this.coverage(s.id, s.flipped);
      if (!art || !cover) continue;
      const cw = cover.width;
      const ch = cover.length / cw;
      const kept = new Uint8Array(cw * ch);
      let any = false;
      for (let y = 0; y < ch; y++) {
        const py = s.y + y;
        if (py < 0 || py >= h) continue;
        for (let x = 0; x < cw; x++) {
          if (!cover[y * cw + x]) continue;
          const px = s.x + x;
          if (px < 0 || px >= w) continue;
          const index = surface.pixels[py * w + px];
          if (index >= KID_BANK && index < KID_BANK + BANK_SIZE) {
            kept[y * cw + x] = 1;
            any = true;
          }
        }
      }
      if (!any) continue;
      drawn++;
      for (let sy = 0; sy < art.height; sy++) {
        const y = s.y * factor + sy;
        if (y < 0 || y >= h * factor) continue;
        const row = (y / factor | 0) - s.y;
        for (let sx = 0; sx < art.width; sx++) {
          const x = s.x * factor + sx;
          if (x < 0 || x >= pitch) continue;
          const col = (x / factor | 0) - s.x;
          if (row < 0 || row >= ch || col < 0 || col >= cw) continue;
          if (cover[row * cw + col]) {
            if (!kept[row * cw + col]) continue;
          } else if (!near(kept, cw, ch, col, row)) {
            continue;
          }
          const a = art.rgba[(sy * art.width + sx) * 4 + 3] / 255;
          if (a <= 4e-3) continue;
          const d = (y * pitch + x) * 4;
          for (let c = 0; c < 3; c++) {
            const paint2 = art.rgba[(sy * art.width + sx) * 4 + c] * fade;
            rgba[d + c] = paint2 * a + rgba[d + c] * (1 - a);
          }
        }
      }
    }
    return drawn;
  }
  /**
   * Where the sprite is solid, at the surface's own resolution.
   *
   * One byte a surface pixel: 1 where the artwork is mostly opaque
   * over that whole pixel, which is where the game's own blit must
   * have written something, and 0 at the soft edge and outside. It is
   * the half of the mask that says "a pixel of his belongs here", and
   * `draw` only asks who owns a surface pixel where this says so.
   */
  coverage(id, flipped) {
    const key = `${id}:${flipped ? 1 : 0}`;
    const had = this.covers.get(key);
    if (had) return had;
    const src = this.source.get(id);
    if (!src) return null;
    const w = Math.round(src.width / KID_HIRES_SCALE);
    const h = Math.round(src.height / KID_HIRES_SCALE);
    const out2 = Object.assign(new Uint8Array(w * h), { width: w });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = flipped ? w - 1 - x : x;
        let sum = 0;
        let n = 0;
        for (let yy = y * KID_HIRES_SCALE; yy < (y + 1) * KID_HIRES_SCALE; yy++) {
          for (let xx = sx * KID_HIRES_SCALE; xx < (sx + 1) * KID_HIRES_SCALE; xx++) {
            sum += src.data[(yy * src.width + xx) * 4 + 3];
            n++;
          }
        }
        out2[y * w + x] = sum / n > 160 ? 1 : 0;
      }
    }
    this.covers.set(key, out2);
    return out2;
  }
  /** One sprite at one factor, scaled and flipped on first use. */
  at(id, factor, flipped) {
    const key = `${id}:${factor}:${flipped ? 1 : 0}`;
    const had = this.scaled.get(key);
    if (had) return had;
    const src = this.source.get(id);
    if (!src) return null;
    const w = Math.round(src.width / KID_HIRES_SCALE * factor);
    const h = Math.round(src.height / KID_HIRES_SCALE * factor);
    const out2 = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * src.height / h);
      const y1 = Math.max(Math.floor((y + 1) * src.height / h), y0 + 1);
      for (let x = 0; x < w; x++) {
        const sx = flipped ? w - 1 - x : x;
        const x0 = Math.floor(sx * src.width / w);
        const x1 = Math.max(Math.floor((sx + 1) * src.width / w), x0 + 1);
        let r = 0;
        let g2 = 0;
        let b = 0;
        let a = 0;
        let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * src.width + xx) * 4;
            const al = src.data[i + 3] / 255;
            r += src.data[i] * al;
            g2 += src.data[i + 1] * al;
            b += src.data[i + 2] * al;
            a += al;
            n++;
          }
        }
        const d = (y * w + x) * 4;
        out2[d] = a > 0 ? r / a : 0;
        out2[d + 1] = a > 0 ? g2 / a : 0;
        out2[d + 2] = a > 0 ? b / a : 0;
        out2[d + 3] = a / n * 255;
      }
    }
    const made = { width: w, height: h, rgba: out2 };
    this.scaled.set(key, made);
    return made;
  }
};

// src/render/font.ts
var FONT_OFFSET = 107020;
function looksLikeGlyph(exe, o) {
  return o > 0 && o + 6 <= exe.length && exe[o + 1] === 0 && exe[o + 3] === 0 && exe[o] <= 16 && exe[o + 2] >= 1 && exe[o + 2] <= 20;
}
var UNDERSCORE_ROWS = [0, 0, 0, 0, 0, 0, 0, 252];
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
    const broken = dv.getUint16(o + 4, true) !== 1;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = broken ? UNDERSCORE_ROWS[y] ?? 0 : exe[o + 6 + y * stride + (x >> 3)] ?? 0;
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
function textWidth(font, text2) {
  let width = 0;
  let drawn = 0;
  for (const ch of text2) {
    const g2 = glyphOf(font, ch.charCodeAt(0));
    if (!g2) continue;
    width += g2.width;
    drawn += 1;
  }
  return width + Math.max(0, drawn - 1) * font.charSpacing;
}
function drawText(surface, font, text2, x, top, color) {
  let at = x;
  for (const ch of text2) {
    const g2 = glyphOf(font, ch.charCodeAt(0));
    if (!g2) continue;
    surface.blitMono(g2.sprite, at, top, color);
    at += g2.width + font.charSpacing;
  }
  return at - font.charSpacing;
}
function drawTextCentred(surface, font, text2, left, right, top, color) {
  const width = textWidth(font, text2);
  drawText(surface, font, text2, left + (right - left + 1 - width >> 1), top, color);
}
function charWidth(font, code) {
  const g2 = glyphOf(font, code);
  let width = 0;
  if (g2) {
    width += g2.width;
    if (width) width += font.charSpacing;
  }
  return width;
}
function lineWidth(font, text2) {
  let width = 0;
  for (const ch of text2) width += charWidth(font, ch.charCodeAt(0));
  return width;
}
function textCenterY(font, top, bottom) {
  const empty = bottom - font.heightAbove - font.heightBelow - top;
  return (empty - empty % 2 >> 1) + font.heightAbove + empty % 2 + top;
}
function drawTextCharacter(surface, font, code, x, y, color) {
  const g2 = glyphOf(font, code);
  if (!g2) return 0;
  surface.blitMono(g2.sprite, x, y - font.heightAbove, color);
  return font.charSpacing + g2.width;
}
function drawTextInRect(surface, font, text2, left, top, right, bottom, xAlign, yAlign, color) {
  const rectWidth = right - left;
  const rectHeight = bottom - top;
  const fontLineDistance = font.heightAbove + font.heightBelow + font.lineSpacing;
  const textHeight = fontLineDistance - font.lineSpacing;
  let textTop = top;
  if (yAlign >= 0) {
    if (yAlign <= 0) {
      textTop += ((rectHeight + 1) / 2 | 0) - ((textHeight + 1) / 2 | 0);
    } else {
      textTop += rectHeight - textHeight;
    }
  }
  const currentY = textTop + font.heightAbove;
  const width = lineWidth(font, text2);
  let textLeft = left;
  if (xAlign >= 0) {
    if (xAlign <= 0) textLeft += (rectWidth / 2 | 0) - (width / 2 | 0);
    else textLeft += rectWidth - width;
  }
  const savedLeft = surface.clipLeft;
  const savedRight = surface.clipRight;
  const savedTop = surface.clipTop;
  const savedBottom = surface.clipBottom;
  surface.clipLeft = Math.max(savedLeft, left);
  surface.clipRight = Math.min(savedRight, right);
  surface.clipTop = Math.max(savedTop, top);
  surface.clipBottom = Math.min(savedBottom, bottom);
  let at = textLeft;
  for (const ch of text2) {
    at += drawTextCharacter(surface, font, ch.charCodeAt(0), at, currentY, color);
  }
  surface.clipLeft = savedLeft;
  surface.clipRight = savedRight;
  surface.clipTop = savedTop;
  surface.clipBottom = savedBottom;
}

// src/render/hebrew.ts
var ROWS = {
  // alef: the main stroke rises to the right, with an arm at each end.
  "\u05D0": [
    "....##",
    "##.##.",
    ".####.",
    "..##..",
    ".####.",
    ".##.##",
    "##...."
  ],
  // bet: the foot sticks out to the left, which is the whole of what
  // tells it from a kaf -- so it sticks out by **two** columns, which
  // is the face's own stem weight, and not by one. Read on the screen
  // at one column, `בכל` came out `ככל` and `בין` came out `כין`: a
  // single pixel of foot against a kaf's rounded corner is not a
  // difference the eye makes at this size.
  "\u05D1": [
    "..#####",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    "#######"
  ],
  "\u05D2": [
    ".####.",
    "..##..",
    "..##..",
    "..##..",
    "..##..",
    ".###..",
    "##..##"
  ],
  // dalet: a square corner, and the bar reaches the right edge.
  "\u05D3": [
    "#######",
    "....##.",
    "....##.",
    "....##.",
    "....##.",
    "....##.",
    "....##."
  ],
  // he: the left leg hangs free of the bar.
  "\u05D4": [
    "######",
    "....##",
    "....##",
    "##..##",
    "##..##",
    "##..##",
    "##..##"
  ],
  "\u05D5": [
    "####",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##"
  ],
  "\u05D6": [
    "#####",
    ".##..",
    ".##..",
    ".##..",
    ".##..",
    ".##..",
    ".##.."
  ],
  "\u05D7": [
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##",
    "##...##"
  ],
  "\u05D8": [
    "##.###",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    ".####."
  ],
  // yod: three rows, and so drawn at the top of the line.
  "\u05D9": [
    "###",
    ".##",
    ".##"
  ],
  "\u05DA": [
    "######",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##"
  ],
  "\u05DB": [
    ".#####",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    ".#####"
  ],
  // lamed: the one letter of the alphabet that climbs above the line,
  // and the font has no room above the line -- `heightAbove` is the top
  // of the cell. So the climb is inside the cell, which is what keeps
  // it from reading as a kaf: measured on the story screen, a lamed
  // whose body filled the cell left `של` looking like `שכ` on every
  // line it appeared in.
  "\u05DC": [
    "##.....",
    "###....",
    ".######",
    ".....##",
    ".....##",
    ".....##",
    ".######"
  ],
  "\u05DD": [
    "######",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "######"
  ],
  // mem: a bet's shape with the short left stroke a bet has not, and
  // the gap at the top left that a final mem has not. Measured on the
  // screen, `מוטל מת` read `כוטל כת` while the top bar reached within
  // one column of the left stroke: the eye joined the two and read a
  // closed kaf. The bar stops two columns short of it now.
  "\u05DE": [
    "..#####",
    ".....##",
    ".....##",
    "##...##",
    "##...##",
    "##...##",
    "#######"
  ],
  "\u05DF": [
    "####",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##",
    "..##"
  ],
  "\u05E0": [
    ".####",
    "...##",
    "...##",
    "...##",
    "...##",
    "...##",
    "#####"
  ],
  // samekh: rounded at all four corners, where a final mem is square.
  "\u05E1": [
    ".####.",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    ".####."
  ],
  /*
   * ayin: the left arm comes **straight down** and only then bends
   * into the stem, and the stem carries on below the join to a foot
   * that stops short of the left edge.
   *
   * A tsadi's arm bends from the first row and its base runs the whole
   * width. Read on the story screen, `העריץ` came out `הצריץ` while
   * the two differed by one row of one stroke; they differ by three
   * rows and by the base now.
   */
  "\u05E2": [
    "##...##",
    "##...##",
    "##...##",
    ".##..##",
    "..#####",
    ".....##",
    "..#####"
  ],
  "\u05E3": [
    "######",
    "##..##",
    ".#####",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##"
  ],
  "\u05E4": [
    "######",
    "##..##",
    ".#####",
    "....##",
    "....##",
    "....##",
    "######"
  ],
  "\u05E5": [
    "##...##",
    ".##..##",
    "..##.##",
    "...####",
    ".....##",
    ".....##",
    ".....##",
    ".....##",
    ".....##"
  ],
  "\u05E6": [
    "##...##",
    ".##..##",
    "..##.##",
    "...####",
    ".....##",
    ".....##",
    "#######"
  ],
  // qof: the stem stops on the line and the left leg carries on under it.
  "\u05E7": [
    "######",
    "....##",
    "....##",
    "##..##",
    "##..##",
    "##..##",
    "##..##",
    "##....",
    "##...."
  ],
  // resh: rounded, where a dalet's corner is square.
  "\u05E8": [
    ".#####",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##",
    "....##"
  ],
  "\u05E9": [
    "##.##.##",
    "##.##.##",
    "##.##.##",
    "##.##.##",
    "##.##.##",
    ".######.",
    "########"
  ],
  // tav: the left leg is inset and kicks left at the foot, which is what
  // tells it from a het.
  "\u05EA": [
    "#######",
    ".##..##",
    ".##..##",
    ".##..##",
    ".##..##",
    ".##..##",
    "###..##"
  ],
  // The two Hebrew marks that stand in for a quote and an apostrophe.
  "\u05F3": [
    "##",
    "##",
    ".#"
  ],
  "\u05F4": [
    "##.##",
    "##.##",
    ".#..#"
  ]
};
function glyphFrom(rows) {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y];
    for (let x = 0; x < width; x++) pixels[y * width + x] = row[x] === "#" ? 1 : 0;
  }
  return { width, height, sprite: { width, height, pixels } };
}
var HEBREW_GLYPHS = new Map(
  Object.entries(ROWS).map(([ch, rows]) => [ch, glyphFrom(rows)])
);
function isRtl(ch) {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 1424 && code <= 1535;
}

// src/render/text.ts
var HE_PATTERNS = [
  [/^GAME PAUSED$/, "\u05D4\u05DE\u05E9\u05D7\u05E7 \u05DE\u05D5\u05E9\u05D4\u05D4"],
  [/^LEVEL (\d+)$/, "\u05E9\u05DC\u05D1 $1"],
  [/^(\d+) MINUTES LEFT$/, "\u05E0\u05D5\u05EA\u05E8\u05D5 $1 \u05D3\u05E7\u05D5\u05EA"],
  [/^(\d+) SECONDS LEFT$/, "\u05E0\u05D5\u05EA\u05E8\u05D5 $1 \u05E9\u05E0\u05D9\u05D5\u05EA"],
  [/^1 SECOND LEFT$/, "\u05E0\u05D5\u05EA\u05E8\u05D4 \u05E9\u05E0\u05D9\u05D9\u05D4 \u05D0\u05D7\u05EA"],
  [/^TIME HAS EXPIRED!$/, "\u05EA\u05DD \u05D4\u05D6\u05DE\u05DF!"],
  [/^Press Button to Continue$/, "\u05D4\u05E7\u05E9 \u05DE\u05E7\u05E9 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05DE\u05E9\u05D9\u05DA"]
];
var STORY_EN = {
  7: {
    lines: [
      "In the Sultan\u2019s absence the",
      "Grand Vizier JAFFAR rules with",
      "the iron fist of tyranny. Only",
      "one obstacle remains between",
      "Jaffar and the throne: the",
      "Sultan\u2019s beautiful young",
      "daughter..."
    ]
  },
  8: {
    lines: [
      "Marry Jaffar... or die within",
      "the hour. All the Princess\u2019s",
      "hopes now rest on the brave",
      "youth she loves. Little does",
      "she know that he is already a",
      "prisoner in Jaffar\u2019s",
      "dungeons...."
    ]
  },
  9: {
    lines: [
      "The tyrant Jaffar lies dead,",
      "his power shattered. Throughout",
      "the land the people of Persia",
      "hail their Princess... and the",
      "brave youth who saved her from",
      "the forces of darkness. No",
      "longer a stranger, he shall",
      "from this day forth be known",
      "as... PRINCE OF PERSIA."
    ]
  },
  10: {
    credits: true,
    lines: [
      "Programmed by|Lance Groody",
      "Graphics by|Leila Bronstein",
      "|Avril Harrison",
      "|James St. Louis",
      "Sound design by|Tom Rettig",
      "Music composed by|Francis Mechner",
      "Produced by|Brian Eheler",
      "Directed by|Jordan Mechner"
    ]
  }
};
var STORY_HE = {
  7: {
    lines: [
      "\u05D1\u05D4\u05D9\u05E2\u05D3\u05E8\u05D5 \u05E9\u05DC \u05D4\u05E1\u05D5\u05DC\u05D8\u05D0\u05DF \u05E9\u05D5\u05DC\u05D8",
      "\u05D4\u05D5\u05D6\u05D9\u05E8 \u05D4\u05D2\u05D3\u05D5\u05DC \u05D2\u05F3\u05D0\u05E4\u05E8 \u05D1\u05D9\u05D3 \u05D1\u05E8\u05D6\u05DC.",
      "\u05DE\u05DB\u05E9\u05D5\u05DC \u05D0\u05D7\u05D3 \u05D1\u05DC\u05D1\u05D3 \u05E0\u05D5\u05EA\u05E8 \u05D1\u05D9\u05DF",
      "\u05D2\u05F3\u05D0\u05E4\u05E8 \u05D5\u05D1\u05D9\u05DF \u05DB\u05E1 \u05D4\u05DE\u05DC\u05D5\u05DB\u05D4: \u05D1\u05EA\u05D5",
      "\u05D4\u05D9\u05E4\u05D4 \u05D5\u05D4\u05E6\u05E2\u05D9\u05E8\u05D4 \u05E9\u05DC \u05D4\u05E1\u05D5\u05DC\u05D8\u05D0\u05DF..."
    ]
  },
  8: {
    lines: [
      "\u05D4\u05D9\u05E0\u05E9\u05D0\u05D9 \u05DC\u05D2\u05F3\u05D0\u05E4\u05E8... \u05D0\u05D5 \u05DE\u05D5\u05EA\u05D9",
      "\u05D1\u05EA\u05D5\u05DA \u05E9\u05E2\u05D4. \u05DB\u05DC \u05EA\u05E7\u05D5\u05D5\u05EA\u05D9\u05D4 \u05E9\u05DC",
      "\u05D4\u05E0\u05E1\u05D9\u05DB\u05D4 \u05E0\u05EA\u05D5\u05E0\u05D5\u05EA \u05E2\u05EA\u05D4 \u05D1\u05E0\u05E2\u05E8",
      "\u05D4\u05D0\u05DE\u05D9\u05E5 \u05E9\u05D4\u05D9\u05D0 \u05D0\u05D5\u05D4\u05D1\u05EA. \u05D4\u05D9\u05D0 \u05D0\u05D9\u05E0\u05D4",
      "\u05D9\u05D5\u05D3\u05E2\u05EA \u05DB\u05D9 \u05D4\u05D5\u05D0 \u05DB\u05D1\u05E8 \u05D0\u05E1\u05D9\u05E8",
      "\u05D1\u05E6\u05D9\u05E0\u05D5\u05E7\u05D9\u05D5 \u05E9\u05DC \u05D2\u05F3\u05D0\u05E4\u05E8..."
    ]
  },
  9: {
    lines: [
      "\u05D4\u05E2\u05E8\u05D9\u05E5 \u05D2\u05F3\u05D0\u05E4\u05E8 \u05DE\u05D5\u05D8\u05DC \u05DE\u05EA, \u05D5\u05DB\u05D5\u05D7\u05D5",
      "\u05E0\u05D5\u05E4\u05E5. \u05D1\u05DB\u05DC \u05E8\u05D7\u05D1\u05D9 \u05D4\u05D0\u05E8\u05E5 \u05DE\u05E8\u05D9\u05E2\u05D9\u05DD",
      "\u05D1\u05E0\u05D9 \u05E4\u05E8\u05E1 \u05DC\u05E0\u05E1\u05D9\u05DB\u05EA\u05DD... \u05D5\u05DC\u05E0\u05E2\u05E8",
      "\u05D4\u05D0\u05DE\u05D9\u05E5 \u05E9\u05D4\u05E6\u05D9\u05DC\u05D4 \u05DE\u05D9\u05D3\u05D9 \u05DB\u05D5\u05D7\u05D5\u05EA",
      "\u05D4\u05D0\u05D5\u05E4\u05DC. \u05DC\u05D0 \u05E2\u05D5\u05D3 \u05D6\u05E8, \u05DE\u05D4\u05D9\u05D5\u05DD \u05D4\u05D6\u05D4",
      "\u05D5\u05D0\u05D9\u05DC\u05DA \u05D9\u05D9\u05E7\u05E8\u05D0... \u05E0\u05E1\u05D9\u05DA \u05E4\u05E8\u05E1."
    ]
  },
  10: {
    credits: true,
    lines: [
      "\u05EA\u05DB\u05E0\u05D5\u05EA|\u05DC\u05D0\u05E0\u05E1 \u05D2\u05E8\u05D5\u05D3\u05D9",
      "\u05D2\u05E8\u05E4\u05D9\u05E7\u05D4|\u05DC\u05D9\u05D9\u05DC\u05D4 \u05D1\u05E8\u05D5\u05E0\u05E9\u05D8\u05D9\u05D9\u05DF",
      "|\u05D0\u05D1\u05E8\u05D9\u05DC \u05D4\u05E8\u05D9\u05E1\u05D5\u05DF",
      "|\u05D2\u05F3\u05D9\u05D9\u05DE\u05E1 \u05E1\u05E0\u05D8 \u05DC\u05D5\u05D0\u05D9\u05E1",
      "\u05E2\u05D9\u05E6\u05D5\u05D1 \u05E7\u05D5\u05DC|\u05D8\u05D5\u05DD \u05E8\u05D8\u05D9\u05D2",
      "\u05DE\u05D5\u05D6\u05D9\u05E7\u05D4|\u05E4\u05E8\u05E0\u05E1\u05D9\u05E1 \u05DE\u05DB\u05E0\u05E8",
      "\u05D4\u05E4\u05E7\u05D4|\u05D1\u05E8\u05D9\u05D0\u05DF \u05D0\u05D9\u05D9\u05DC\u05E8",
      "\u05D1\u05D9\u05DE\u05D5\u05D9|\u05D2\u05F3\u05D5\u05E8\u05D3\u05DF \u05DE\u05DB\u05E0\u05E8"
    ]
  }
};
function toVisual(text2) {
  const runs = [];
  for (const ch of text2) {
    const ltr = /[0-9A-Za-z]/.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.text += ch;
    else runs.push({ ltr, text: ch });
  }
  for (let i = 1; i < runs.length - 1; i++) {
    const run = runs[i];
    if (!run.ltr && /^[.:,’'-]+$/.test(run.text) && runs[i - 1].ltr && runs[i + 1].ltr) {
      runs[i - 1].text += run.text + runs[i + 1].text;
      runs.splice(i, 2);
      i--;
    }
  }
  let out2 = "";
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    out2 += run.ltr ? run.text : [...run.text].reverse().join("");
  }
  return out2;
}
function hasRtl(text2) {
  for (const ch of text2) if (isRtl(ch)) return true;
  return false;
}
var TEXT_CAP_HEIGHT = 7;
function fitLine(baseline, size, top, bottom, measure) {
  const band = bottom - top;
  if (!(band > 0)) return { size, baseline };
  const { ascent, descent } = measure(size);
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return { size, baseline };
  const ink = ascent + descent;
  if (ink > band) {
    const smaller = size * (band / ink);
    const fitted = measure(smaller);
    const drop = Number.isFinite(fitted.descent) ? fitted.descent : 0;
    return { size: smaller, baseline: bottom - drop };
  }
  if (baseline + descent > bottom) return { size, baseline: bottom - descent };
  if (baseline - ascent < top) return { size, baseline: top + ascent };
  return { size, baseline };
}
var TITLE_CARDS = {
  // full_image_id.TITLE_PRESENTS
  1: {
    keepRows: 20,
    lines: [[21, "\u05D1\u05E8\u05D5\u05D3\u05E8\u05D1\u05D5\u05E0\u05D3 \u05E1\u05D5\u05E4\u05D8\u05D5\u05D5\u05E8"], [36, "\u05DE\u05E6\u05D9\u05D2\u05D4"]]
  },
  // full_image_id.TITLE_GAME
  2: {
    keepRows: 0,
    lines: [[5, "\u05DE\u05E9\u05D7\u05E7 \u05DE\u05D0\u05EA"], [19, "\u05D2\u05F3\u05D5\u05E8\u05D3\u05DF \u05DE\u05DB\u05E0\u05E8"]]
  }
};
var GUTTER = 8;
var GameText = class _GameText {
  font;
  lang;
  qual;
  /**
   * The lines the **screen** is showing, keyed so that a line drawn
   * again in the same place replaces it.
   */
  lines = /* @__PURE__ */ new Map();
  /**
   * The lines drawn into the **offscreen** surface, which the screen
   * is not showing yet.
   *
   * A cutscene composes a picture offscreen and copies it over, and
   * the two are a block apart: `show_title` draws `TITLE_PRESENTS`,
   * waits, copies the rectangle to the screen, and only then paints
   * the offscreen back to the plain picture. So a word drawn into the
   * offscreen is on the screen from the **copy** until the next copy
   * over the same rectangle -- not from the moment it was drawn.
   *
   * At `quality: original` that is free, because the words are
   * pixels of the surface and the copy carries them. At `high` the
   * words are not in the surface at all, so the overlay has to keep
   * the same two sets and `commitOverlay` is the copy. Measured on
   * the page before this: both Hebrew title cards and every story
   * screen of the opening showed their words for two seconds and
   * then lost them for three, while the picture under them stayed.
   */
  pendingLines = /* @__PURE__ */ new Map();
  /** `scr.target(true)`: which of the two the next line goes into. */
  offscreen = false;
  /**
   * The hall of fame's name box, while it is taking a name.
   *
   * `input_str` draws a name one glyph at a time at an advancing x,
   * which is left to right and cannot be anything else: it is a loop
   * over `draw_text_character`, and the C has no notion of a line
   * that grows the other way. So for Hebrew the glyphs are not drawn
   * one at a time at all. What is typed is **read off the calls** --
   * the C's own protocol says which is which, and there are only
   * three kinds -- and the whole box is drawn again from the right
   * every time it changes, which is what typing Hebrew looks like.
   *
   * The box is `start_text_input`'s rectangle and the colour is the
   * one `input_str` filled it with on the line after.
   */
  box = null;
  /** What has been typed into it, in logical order. */
  typed = "";
  /** Whether `draw_text_cursor` last drew the cursor or erased it. */
  cursorUp = false;
  /** Whether the last strip drawn put ink in the row above its rectangle. */
  liftedRow = false;
  /** `arg_4`: how far inside the box `input_str` starts. */
  static BOX_INSET = 4;
  constructor(font, options = {}) {
    this.font = font;
    this.lang = options.language ?? "en";
    this.qual = options.quality ?? "original";
  }
  get language() {
    return this.lang;
  }
  set language(value) {
    this.lang = value;
  }
  get quality() {
    return this.qual;
  }
  set quality(value) {
    this.qual = value;
  }
  /** `quality: high` keeps the surface clear and draws on the canvas. */
  get vector() {
    return this.qual === "high";
  }
  /** Everything the canvas pass has to draw, oldest first. */
  get overlay() {
    return [...this.lines.values()];
  }
  /**
   * `scr.target(offscreen)`, for the duration of one call.
   *
   * The caller sets it and puts it back, so a game that has one
   * surface and never sets it writes to the screen's own list, which
   * is what it did before there were two.
   */
  get drawingOffscreen() {
    return this.offscreen;
  }
  set drawingOffscreen(on) {
    this.offscreen = on;
  }
  // --------------------------------------------------------------- words
  /** The words the game asked for, in the player's language. */
  translate(text2) {
    if (this.lang !== "he") return text2;
    for (const [pattern, into] of HE_PATTERNS) {
      if (pattern.test(text2)) return text2.replace(pattern, into);
    }
    return text2;
  }
  /** The story screen behind a `full_image_id`, or null for the picture. */
  story(id) {
    const table = this.lang === "he" ? STORY_HE : STORY_EN;
    const screen2 = table[id];
    if (!screen2) return null;
    if (this.lang === "en" && !this.vector) return null;
    return screen2;
  }
  // ------------------------------------------------------------- measuring
  glyph(ch) {
    const hebrew = HEBREW_GLYPHS.get(ch);
    if (hebrew) return hebrew;
    const code = ch.charCodeAt(0);
    if (code < this.font.firstChar || code > this.font.lastChar) return null;
    return this.font.glyphs[code - this.font.firstChar] ?? null;
  }
  /** `get_char_width`: the glyph and the gap after it. */
  charWidth(ch) {
    const hebrew = HEBREW_GLYPHS.get(ch);
    if (hebrew) return hebrew.width + this.font.charSpacing;
    return charWidth(this.font, ch.charCodeAt(0));
  }
  /** `get_cstring_width`. */
  cstringWidth(text2) {
    let width = 0;
    for (const ch of text2) width += this.charWidth(ch);
    return width;
  }
  /** The shell's own measure: no gap after the last character. */
  shellWidth(text2) {
    let width = 0;
    let drawn = 0;
    for (const ch of text2) {
      const g2 = this.glyph(ch);
      if (!g2) continue;
      width += g2.width;
      drawn += 1;
    }
    return width + Math.max(0, drawn - 1) * this.font.charSpacing;
  }
  // -------------------------------------------------------------- drawing
  blitLine(surface, text2, x, top, color) {
    let at = x;
    for (const ch of text2) {
      const g2 = this.glyph(ch);
      if (!g2) continue;
      surface.blitMono(g2.sprite, at, top, color);
      at += g2.width + this.font.charSpacing;
    }
  }
  remember(item) {
    const into = this.offscreen ? this.pendingLines : this.lines;
    into.delete(item.key);
    into.set(item.key, item);
  }
  /** Both lists, for a screen that has just been painted over. */
  clearOverlay() {
    this.lines.clear();
    this.pendingLines.clear();
  }
  /** The screen's own list, for `pal_restore_free_fadeout`'s black. */
  clearShownOverlay() {
    this.lines.clear();
  }
  /** Does this line have ink inside the box? */
  static touches(item, left, top, right, bottom) {
    const itemTop = item.baseline - item.capHeight;
    return item.right > left && item.left < right && item.baseline + 2 > top && itemTop < bottom;
  }
  /** Everything whose line sits inside this box, on the surface in hand. */
  clearOverlayIn(left, top, right, bottom) {
    const from = this.offscreen ? this.pendingLines : this.lines;
    for (const [key, item] of [...from]) {
      if (_GameText.touches(item, left, top, right, bottom)) from.delete(key);
    }
  }
  /**
   * `read_peel_from_screen`: the words inside the rectangle, kept.
   *
   * A peel is a rectangle of the screen put aside and painted back
   * later, and the hall of fame uses one to take its name box away
   * again. At `quality: original` the words in that rectangle are
   * pixels and the peel carries them; at `high` they are not, so the
   * peel has to carry them itself or the time beside the name is
   * painted out and never comes back.
   */
  readPeelOverlay(left, top, right, bottom) {
    const from = this.offscreen ? this.pendingLines : this.lines;
    const out2 = [];
    for (const item of from.values()) {
      if (_GameText.touches(item, left, top, right, bottom)) out2.push(item);
    }
    return out2;
  }
  /** `restore_peel`: the rectangle's words as they were when it was read. */
  restorePeelOverlay(left, top, right, bottom, words) {
    this.clearOverlayIn(left, top, right, bottom);
    const into = this.offscreen ? this.pendingLines : this.lines;
    for (const item of words) into.set(item.key, item);
  }
  /**
   * `method_1_blit_rect(onscreen_surface_, offscreen_surface, rect)`:
   * the offscreen's words reach the screen.
   *
   * Whatever the screen was showing in that rectangle is painted over
   * by the copy, and whatever the offscreen holds there is now shown.
   * The offscreen keeps its own words, exactly as it keeps its own
   * pixels.
   */
  commitOverlay(left, top, right, bottom) {
    for (const [key, item] of [...this.lines]) {
      if (_GameText.touches(item, left, top, right, bottom)) this.lines.delete(key);
    }
    for (const [key, item] of this.pendingLines) {
      if (_GameText.touches(item, left, top, right, bottom)) this.lines.set(key, item);
    }
  }
  /**
   * The strip under the room: `show_text(&rect_bottom_text,
   * halign_center, valign_bottom, ...)` with the rectangle blacked
   * first, which the caller has already done.
   */
  bottomText(surface, text2, left, top, right, color) {
    this.lines.delete("bottom");
    if (this.liftedRow) {
      surface.fillRect(left, top - 1, right - left + 1, 1, 0);
      this.liftedRow = false;
    }
    if (text2 === null) return;
    const words = this.translate(text2);
    const rtl = hasRtl(words);
    const lift = rtl ? 1 : 0;
    if (this.vector) {
      this.remember({
        key: "bottom",
        left,
        right,
        baseline: top + TEXT_CAP_HEIGHT,
        xAlign: 0,
        text: words,
        rtl,
        color,
        capHeight: TEXT_CAP_HEIGHT,
        top: top - 1,
        bottom: top + TEXT_CAP_HEIGHT
      });
      return;
    }
    const visual = rtl ? toVisual(words) : words;
    const width = this.shellWidth(visual);
    if (lift) {
      surface.fillRect(left, top - lift, right - left + 1, lift, 0);
      this.liftedRow = true;
    }
    this.blitLine(
      surface,
      visual,
      left + (right - left + 1 - width >> 1),
      top - lift,
      color
    );
  }
  /**
   * `draw_text` for one line, which is how the hall of fame draws a
   * name and a time. `xAlign`/`yAlign` are the C's.
   */
  showText(surface, text2, left, top, right, bottom, xAlign, yAlign, color) {
    const words = this.translate(text2);
    const rtl = hasRtl(words);
    const baseline = this.baselineIn(top, bottom, yAlign);
    if (this.lang === "he") xAlign = -xAlign;
    const key = `t:${left},${top},${right},${bottom},${xAlign},${color}`;
    if (this.vector) {
      this.remember({
        key,
        left,
        right,
        baseline,
        xAlign,
        text: words,
        rtl,
        color,
        capHeight: TEXT_CAP_HEIGHT,
        top,
        bottom
      });
      return;
    }
    const visual = rtl ? toVisual(words) : words;
    const width = this.cstringWidth(visual);
    let at = left;
    if (xAlign === 0) at += ((right - left) / 2 | 0) - (width / 2 | 0);
    else if (xAlign > 0) at += right - left - width;
    const savedLeft = surface.clipLeft;
    const savedRight = surface.clipRight;
    const savedTop = surface.clipTop;
    const savedBottom = surface.clipBottom;
    surface.clipLeft = Math.max(savedLeft, left);
    surface.clipRight = Math.min(savedRight, right);
    surface.clipTop = Math.max(savedTop, top);
    surface.clipBottom = Math.min(savedBottom, bottom);
    this.blitLine(surface, visual, at, baseline - this.font.heightAbove, color);
    surface.clipLeft = savedLeft;
    surface.clipRight = savedRight;
    surface.clipTop = savedTop;
    surface.clipBottom = savedBottom;
  }
  /**
   * Where `draw_text`'s own baseline falls, which is **not**
   * `get_text_center_y`.
   *
   * `seg009:3F01` works the top of the line out with
   * `((rect_height + 1) / 2) - ((text_height + 1) / 2)`, two
   * truncating divisions that simulate SHR and ADC, and
   * `get_text_center_y` works a different one out with a remainder
   * added back. For an odd-height rectangle the two agree; for an
   * even one they are a row apart. This is `draw_text`'s, because
   * `draw_text` is what the hall of fame calls -- and it has to be
   * exactly that, or the page and the headless port draw different
   * pictures with the language at its default and
   * `tools/dev/page-port.ts` says so.
   */
  baselineIn(top, bottom, yAlign) {
    const rectHeight = bottom - top;
    const textHeight = this.font.heightAbove + this.font.heightBelow;
    let textTop = top;
    if (yAlign >= 0) {
      if (yAlign <= 0) {
        textTop += ((rectHeight + 1) / 2 | 0) - ((textHeight + 1) / 2 | 0);
      } else {
        textTop += rectHeight - textHeight;
      }
    }
    return textTop + this.font.heightAbove;
  }
  /**
   * `SDL_StartTextInput()`, with the rectangle it is given.
   *
   * Nothing but the hall of fame's name box calls it, so this is the
   * one place a right-to-left line is typed rather than drawn whole.
   */
  beginTextInput(left, top, right, bottom) {
    this.box = { left, top, right, bottom, bg: 0 };
    this.typed = "";
    this.cursorUp = false;
  }
  /** `SDL_StopTextInput()`. */
  endTextInput() {
    this.box = null;
    this.typed = "";
  }
  /** `draw_rect`: which colour the box was painted, and what it wipes. */
  noteFill(left, top, right, bottom, color) {
    const box = this.box;
    if (box && box.left === left && box.top === top && box.right === right && box.bottom === bottom) {
      box.bg = color;
      this.typed = "";
      this.cursorUp = false;
    }
    this.clearOverlayIn(left, top, right, bottom);
  }
  /** Is a Hebrew name being typed into the box at this baseline? */
  typingRtl(y) {
    const box = this.box;
    return this.lang === "he" && box !== null && y > box.top && y <= box.bottom + 2;
  }
  /**
   * One call of `draw_text_character` inside the name box, read as
   * what it means rather than as a glyph at an x.
   *
   * `input_str` has exactly three kinds of call and the colour says
   * which: the cursor is always `_`, and anything else drawn in the
   * background colour is the erase half of a backspace.
   */
  typeInto(surface, ch, color) {
    const box = this.box;
    if (ch === "_") this.cursorUp = color !== box.bg;
    else if (color === box.bg) this.typed = this.typed.slice(0, -1);
    else this.typed += ch;
    const line = (this.cursorUp ? "_" : "") + toVisual(this.typed);
    const right = box.right - _GameText.BOX_INSET;
    const baseline = this.baselineIn(box.top, box.bottom, 0);
    if (this.vector) {
      this.remember({
        key: "name",
        left: box.left + _GameText.BOX_INSET,
        right,
        baseline,
        xAlign: 1,
        text: this.typed + (this.cursorUp ? "_" : ""),
        rtl: true,
        color: color === box.bg ? this.textColour : color,
        capHeight: TEXT_CAP_HEIGHT
      });
      return;
    }
    surface.fillRect(
      box.left,
      box.top,
      box.right - box.left,
      box.bottom - box.top,
      box.bg
    );
    this.blitLine(
      surface,
      line,
      right - this.shellWidth(line),
      baseline - this.font.heightAbove,
      color === box.bg ? this.textColour : color
    );
  }
  /** The colour the name is drawn in, kept from the last glyph that was. */
  textColour = 15;
  /**
   * `draw_text_character`: one glyph with its baseline at `y`, which is
   * how `input_str` draws a name as it is typed and blinks a cursor at
   * the end of it.
   *
   * At `quality: high` the glyph is not blitted; it is remembered at
   * the place it would have gone, keyed by that place, so that the
   * cursor redrawn in the background colour **replaces** the one drawn
   * in the text colour rather than piling up beside it. That is the C's
   * own erase, and it is why nothing here has to know what a cursor is.
   */
  drawChar(surface, x, y, ch, color) {
    const g2 = this.glyph(ch);
    if (!g2) return 0;
    if (this.typingRtl(y)) {
      if (color !== this.box.bg) this.textColour = color;
      this.typeInto(surface, ch, color);
      return this.font.charSpacing + g2.width;
    }
    if (this.vector) {
      this.remember({
        key: `c:${x},${y}`,
        left: x,
        right: x + g2.width,
        baseline: y,
        xAlign: -1,
        text: ch,
        rtl: isRtl(ch),
        color,
        capHeight: TEXT_CAP_HEIGHT
      });
    } else {
      surface.blitMono(g2.sprite, x, y - this.font.heightAbove, color);
    }
    return this.font.charSpacing + g2.width;
  }
  // ---------------------------------------------------------- the story
  /** Where a story screen's words go: the window inside `STORY_FRAME`. */
  static STORY = {
    left: 24,
    right: 296,
    top: 27,
    lineHeight: 16,
    /** The credits put the name beside the job rather than under it. */
    creditsSplit: 150
  };
  /**
   * Draw a story screen's words where the original blits its picture.
   *
   * The caller has already drawn `STORY_FRAME`, so this is the inside
   * of the frame and nothing else.
   */
  drawStory(surface, id, color) {
    const screen2 = this.story(id);
    if (!screen2) return;
    const { left, right, top, lineHeight, creditsSplit } = _GameText.STORY;
    const rtl = this.lang === "he";
    const split = left + creditsSplit;
    for (const [index, line] of screen2.lines.entries()) {
      const y = top + index * lineHeight;
      const key = `s${id}:${index}`;
      if (!screen2.credits) {
        this.storyLine(surface, line, y, rtl ? 1 : -1, color, key, left, right);
        continue;
      }
      const [job = "", name = ""] = line.split("|");
      if (rtl) {
        this.storyLine(surface, job, y, 1, color, `${key}:a`, split, right);
        this.storyLine(surface, name, y, 1, color, `${key}:b`, left, split - GUTTER);
      } else {
        this.storyLine(surface, job, y, 1, color, `${key}:a`, left, split);
        this.storyLine(surface, name, y, -1, color, `${key}:b`, split + GUTTER, right);
      }
    }
  }
  storyLine(surface, text2, top, xAlign, color, key, left, right) {
    if (text2 === "") return;
    if (this.vector) {
      this.remember({
        key,
        left,
        right,
        baseline: top + TEXT_CAP_HEIGHT,
        xAlign,
        text: text2,
        rtl: hasRtl(text2) || this.lang === "he",
        color,
        capHeight: TEXT_CAP_HEIGHT
      });
      return;
    }
    const visual = hasRtl(text2) ? toVisual(text2) : text2;
    const width = this.shellWidth(visual);
    let at = left;
    if (xAlign === 0) at = left + (right - left - width >> 1);
    else if (xAlign > 0) at = right - width;
    this.blitLine(surface, visual, at, top, color);
  }
  /**
   * The Hebrew words of a title card, or null to blit the picture.
   *
   * English keeps the original's own artwork at both qualities: the
   * card is a drawing of a logotype and there is nothing a redraw
   * could add to it.
   */
  titleCard(id) {
    if (this.lang !== "he") return null;
    return TITLE_CARDS[id] ?? null;
  }
  /** The words of a title card, centred where the picture's are. */
  drawTitleCard(surface, id, left, top, right, color) {
    const card = TITLE_CARDS[id];
    if (!card || this.lang !== "he") return;
    for (const [row, line] of card.lines) {
      this.storyLine(surface, line, top + row, 0, color, `tc${id}:${row}`, left, right);
    }
  }
  /** How wide a story line is drawn, for the test that pins they fit. */
  storyLineWidth(text2) {
    return this.shellWidth(hasRtl(text2) ? toVisual(text2) : text2);
  }
};

// src/render/upscale.ts
var AA_FACTOR = 3;
var MIX_PARTS = 5;
function scale3x(src, width, height, out2) {
  const w3 = width * 3;
  const dst = out2 ?? new Uint8Array(w3 * height * 3);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const mid = y * width;
    const down = (y + 1 < height ? y + 1 : height - 1) * width;
    const row0 = y * 3 * w3;
    const row1 = row0 + w3;
    const row2 = row1 + w3;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < width ? x + 1 : width - 1;
      const a = src[up + left];
      const b = src[up + x];
      const c = src[up + right];
      const d = src[mid + left];
      const e = src[mid + x];
      const f = src[mid + right];
      const g2 = src[down + left];
      const h = src[down + x];
      const i = src[down + right];
      let e0 = e;
      let e1 = e;
      let e2 = e;
      let e3 = e;
      let e5 = e;
      let e6 = e;
      let e7 = e;
      let e8 = e;
      if (b !== h && d !== f) {
        if (d === b) e0 = d;
        if (d === b && e !== c || b === f && e !== a) e1 = b;
        if (b === f) e2 = f;
        if (d === b && e !== g2 || d === h && e !== a) e3 = d;
        if (b === f && e !== i || h === f && e !== c) e5 = f;
        if (d === h) e6 = d;
        if (d === h && e !== i || h === f && e !== g2) e7 = h;
        if (h === f) e8 = f;
      }
      dst[row0 + x * 3] = e0;
      dst[row0 + x * 3 + 1] = e1;
      dst[row0 + x * 3 + 2] = e2;
      dst[row1 + x * 3] = e3;
      dst[row1 + x * 3 + 1] = e;
      dst[row1 + x * 3 + 2] = e5;
      dst[row2 + x * 3] = e6;
      dst[row2 + x * 3 + 1] = e7;
      dst[row2 + x * 3 + 2] = e8;
    }
  }
  return dst;
}
function antialias(src, width, height, scratch = {}) {
  const w = width * AA_FACTOR;
  const h = height * AA_FACTOR;
  const n = w * h;
  const base = scratch.base?.length === n ? scratch.base : new Uint8Array(n);
  scratch.base = base;
  scale3x(src, width, height, base);
  let at = scratch.mixAt?.length ? scratch.mixAt : new Uint32Array(n >> 3);
  let weights = scratch.mixWeights?.length === at.length * MIX_PARTS ? scratch.mixWeights : new Uint8Array(at.length * MIX_PARTS);
  let count = 0;
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const mid = y * w;
    const down = (y + 1 < h ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < w ? x + 1 : w - 1;
      const b = base[up + x];
      const d = base[mid + left];
      const e = base[mid + x];
      const f = base[mid + right];
      const hh = base[down + x];
      if (b === hh || d === f) continue;
      const a = base[up + left];
      const c = base[up + right];
      const g2 = base[down + left];
      const i = base[down + right];
      let nB = 0;
      let nD = 0;
      let nF = 0;
      let nH = 0;
      if (d === b) nD++;
      if (d === b && e !== c || b === f && e !== a) nB++;
      if (b === f) nF++;
      if (d === b && e !== g2 || d === hh && e !== a) nD++;
      if (b === f && e !== i || hh === f && e !== c) nF++;
      if (d === hh) nD++;
      if (d === hh && e !== i || hh === f && e !== g2) nH++;
      if (hh === f) nF++;
      const moved = nB + nD + nF + nH;
      if (moved === 0) continue;
      if (count === at.length) {
        const bigger = new Uint32Array(at.length * 2);
        bigger.set(at);
        at = bigger;
        const more = new Uint8Array(bigger.length * MIX_PARTS);
        more.set(weights);
        weights = more;
      }
      at[count] = mid + x;
      const o = count * MIX_PARTS;
      weights[o] = 9 - moved;
      weights[o + 1] = nB;
      weights[o + 2] = nD;
      weights[o + 3] = nF;
      weights[o + 4] = nH;
      count++;
    }
  }
  scratch.mixAt = at;
  scratch.mixWeights = weights;
  return { base, width: w, height: h, mixAt: at, mixCount: count, mixWeights: weights };
}
function composeAntialiased(aa, paletteRgba, out2) {
  const { base, width: w, height: h, mixAt, mixCount, mixWeights } = aa;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const c = base[i] * 4;
    const o = i * 4;
    out2[o] = paletteRgba[c];
    out2[o + 1] = paletteRgba[c + 1];
    out2[o + 2] = paletteRgba[c + 2];
    out2[o + 3] = 255;
  }
  for (let k = 0; k < mixCount; k++) {
    const i = mixAt[k];
    const y = i / w | 0;
    const x = i - y * w;
    const up = (y > 0 ? y - 1 : 0) * w;
    const down = (y + 1 < h ? y + 1 : h - 1) * w;
    const left = x > 0 ? x - 1 : 0;
    const right = x + 1 < w ? x + 1 : w - 1;
    const e = base[i] * 4;
    const b = base[up + x] * 4;
    const d = base[y * w + left] * 4;
    const f = base[y * w + right] * 4;
    const hh = base[down + x] * 4;
    const o = k * MIX_PARTS;
    const wE = mixWeights[o];
    const wB = mixWeights[o + 1];
    const wD = mixWeights[o + 2];
    const wF = mixWeights[o + 3];
    const wH = mixWeights[o + 4];
    const p = i * 4;
    out2[p] = (paletteRgba[e] * wE + paletteRgba[b] * wB + paletteRgba[d] * wD + paletteRgba[f] * wF + paletteRgba[hh] * wH) / 9;
    out2[p + 1] = (paletteRgba[e + 1] * wE + paletteRgba[b + 1] * wB + paletteRgba[d + 1] * wD + paletteRgba[f + 1] * wF + paletteRgba[hh + 1] * wH) / 9;
    out2[p + 2] = (paletteRgba[e + 2] * wE + paletteRgba[b + 2] * wB + paletteRgba[d + 2] * wD + paletteRgba[f + 2] * wF + paletteRgba[hh + 2] * wH) / 9;
  }
}

// src/render/display.ts
var VECTOR_FACE = '"Frank Ruehl CLM", "David Libre", David, "Noto Serif Hebrew", "Times New Roman", "Liberation Serif", "FreeSerif", "DejaVu Serif", serif';
var CAP_RATIO = 0.7;
var Display = class {
  canvas;
  ctx;
  imageData;
  aspect = "original-4-3";
  /**
   * The second canvas, over the first, for `quality: high`.
   *
   * The game's own canvas is 320 by 200 and nothing drawn into it can
   * be sharper than that. So the crisp words are not drawn into it at
   * all: they go on a canvas of the same size and place whose backing
   * store is the size the picture is really shown at, times the
   * device's own pixel ratio. The 320 by 200 surface underneath keeps
   * its background -- the strip under the room is still blacked, the
   * story frame is still drawn -- and `tools/dev/page-port.ts` goes on
   * reading that surface and seeing the headless port's own picture.
   */
  overlay = null;
  overlayCtx = null;
  textSource = null;
  /** The repainted Prince, and where the engine said it drew him. */
  kid = null;
  kidSource = null;
  /** `KID.DAT`'s own sixteen, DAC-expanded: the fade is read against it. */
  kidBase = [];
  /**
   * `quality: high` for the **picture**, which is a bigger canvas.
   *
   * The words went onto a second canvas because a letter wants a
   * vector face and the game has none; the picture cannot do that --
   * there is nothing to draw it from but the art in the data files.
   * What it gets instead is `src/render/upscale.ts`: the art drawn
   * nine times as fine and sampled back down three by three, so the
   * canvas is three times as big **and** its edges carry colours the
   * palette does not hold -- measured, 24 colours on a dungeon frame
   * become 229. They are kept as mixtures of indices rather than as
   * finished colours, so a fade still fades them.
   *
   * At `original` none of this exists: the canvas is 320 by 200 and
   * `image-rendering: pixelated`, exactly as it was.
   */
  quality = "original";
  /** The last surface anti-aliased, so a frame is filtered only once. */
  hiFrom = null;
  hiPicture = null;
  hiScratch = {};
  hiImage = null;
  /**
   * The last thing presented, so a resize can put it back.
   *
   * Changing a canvas's backing store **clears it**, and the quality
   * changes its size. The game presents every
   * tick so it would not show for long -- but a paused game and a
   * scene that has stopped present nothing at all, and those would
   * be left looking at a blank canvas until something else moved.
   * These are references and not copies: the surface is the game's
   * own and goes on being drawn into, which is what should be put
   * back.
   */
  last = null;
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
    this.watch();
  }
  setAspect(mode) {
    this.aspect = mode;
    this.applyAspect();
  }
  /**
   * The picture's quality, which the player may move at any moment.
   *
   * Only the canvas changes. Nothing is told about it: the next
   * `present` reads the same 320x200 surface it would have read
   * anyway, so a game in the middle of a tick does not notice, and a
   * player who changes their mind gets the original's own pixels back
   * on the very next frame.
   */
  setQuality(mode) {
    if (mode === this.quality) return;
    this.quality = mode;
    this.hiFrom = null;
    this.sizeCanvas();
  }
  /**
   * Give the canvas the backing store this quality asks for.
   *
   * There is one size at `high` and it is three times the game's,
   * which is also the size the anti-aliasing samples down from. A
   * bigger canvas would want a bigger sampling to be worth having,
   * and the measurement for that is in `upscale.ts`: a quarter of a
   * second a frame, against a tenth of a core for this.
   */
  sizeCanvas() {
    const factor = this.quality === "high" ? AA_FACTOR : 1;
    const width = SCREEN_WIDTH * factor;
    const height = SCREEN_HEIGHT * factor;
    let cleared = false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = false;
      this.hiFrom = null;
      this.hiPicture = null;
      this.hiImage = null;
      cleared = true;
    }
    this.canvas.style.imageRendering = factor === 1 ? "pixelated" : "auto";
    if (cleared && this.last) this.present(this.last.surface, this.last.palette);
  }
  /** The width of one screen height, in the shape of pixel chosen. */
  get ratio() {
    return this.aspect === "original-4-3" ? 4 / 3 : SCREEN_WIDTH / SCREEN_HEIGHT;
  }
  /**
   * The biggest the picture can be inside the box it is given.
   *
   * This is worked out here rather than left to CSS, and that is not a
   * preference. The page gives the game the whole height of the window,
   * so the width has to follow from the height -- and a rule that asks
   * for the height of the element's own container is circular, because
   * the container is sized by what is in it. Measured, in a window 760
   * pixels wide: the container-query form drew the game **two pixels
   * square**. Reading the box and setting the two lengths cannot go
   * wrong that way.
   */
  applyAspect() {
    const s = this.canvas.style;
    const box = this.canvas.parentElement?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) {
      s.aspectRatio = this.aspect === "original-4-3" ? "4 / 3" : "320 / 200";
      this.sizeCanvas();
      return;
    }
    const width = Math.min(box.width, box.height * this.ratio);
    s.width = `${Math.floor(width)}px`;
    s.height = `${Math.floor(width / this.ratio)}px`;
    s.aspectRatio = "";
    this.sizeCanvas();
    this.placeOverlay();
  }
  /**
   * The crisp text canvas, exactly over the game's own.
   *
   * It is made the first time something asks to draw on it, so a page
   * at `quality: original` never has a second canvas at all.
   */
  makeOverlay() {
    if (this.overlayCtx) return this.overlayCtx;
    const parent = this.canvas.parentElement;
    if (!parent || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.id = "screen-text";
    canvas.setAttribute("aria-hidden", "true");
    const s = canvas.style;
    s.position = "absolute";
    s.pointerEvents = "none";
    s.background = "transparent";
    s.border = "0";
    s.imageRendering = "auto";
    s.zIndex = "1";
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    parent.appendChild(canvas);
    this.overlay = canvas;
    this.overlayCtx = ctx;
    this.placeOverlay();
    return ctx;
  }
  /**
   * Put the text canvas where the game's canvas is.
   *
   * The stage centres the game in its box, so the offset is read off
   * the element rather than assumed -- and the border is a pixel, so
   * the content box is what the picture fills, not the border box.
   */
  placeOverlay() {
    const canvas = this.overlay;
    if (!canvas) return;
    const game = this.canvas;
    const style = typeof getComputedStyle === "function" ? getComputedStyle(game) : null;
    const borderLeft = style ? parseFloat(style.borderLeftWidth) || 0 : 0;
    const borderTop = style ? parseFloat(style.borderTopWidth) || 0 : 0;
    const width = game.clientWidth || game.offsetWidth;
    const height = game.clientHeight || game.offsetHeight;
    canvas.style.left = `${game.offsetLeft + borderLeft}px`;
    canvas.style.top = `${game.offsetTop + borderTop}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
  }
  /**
   * Where the crisp words come from, or null for none.
   *
   * `web/main.ts` points this at the text layer. Nothing else does, so
   * a page that never asked for the better text never draws one.
   */
  setTextSource(source) {
    this.textSource = source;
  }
  /**
   * Where the repainted Prince comes from, which only the page sets.
   *
   * `source` is asked once a frame for the sprites the engine
   * reported through `PopOptions.onKidSprite`, `art` holds the
   * artwork and `base` is the bank it was painted for. With none of
   * them -- which is every test and every tool that does not ask --
   * `presentHigh` is exactly what it was.
   */
  setKidHiRes(art, source, base = []) {
    this.kid = art;
    this.kidSource = source;
    this.kidBase = base;
  }
  /** Follow the box the page gives the game, which a resize changes. */
  watch() {
    const parent = this.canvas.parentElement;
    if (!parent || typeof ResizeObserver === "undefined") return;
    new ResizeObserver(() => this.applyAspect()).observe(parent);
  }
  present(surface, paletteRgba) {
    this.last = { surface, palette: paletteRgba };
    if (this.quality === "high") this.presentHigh(surface, paletteRgba);
    else {
      surface.toRgba(paletteRgba, this.imageData.data);
      this.ctx.putImageData(this.imageData, 0, 0);
    }
    this.presentText(paletteRgba);
  }
  /**
   * The same picture, three times as big and with its edges
   * anti-aliased, in the palette it was drawn with.
   *
   * The **filtering** is done on the indices and only when the
   * indices have moved, which is what makes this affordable: the
   * flash puts the screen up twice inside one tick and a fade writes
   * a new palette every other sixtieth, and neither of them changes
   * a pixel of the surface. What runs on every frame is the compose,
   * and that is the flat fill the display always did plus the four
   * per cent of pixels that are a mixture -- measured at 1.8 ms and
   * 0.8 ms on a palace room.
   */
  presentHigh(surface, paletteRgba) {
    const width = surface.width * AA_FACTOR;
    const height = surface.height * AA_FACTOR;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = false;
      this.hiImage = null;
    }
    const src = surface.pixels;
    let moved = this.hiFrom === null || this.hiFrom.length !== src.length;
    if (!moved) {
      const was = this.hiFrom;
      for (let i = 0; i < src.length; i++) {
        if (was[i] !== src[i]) {
          moved = true;
          break;
        }
      }
    }
    if (moved || !this.hiPicture) {
      this.hiPicture = antialias(src, surface.width, surface.height, this.hiScratch);
      this.hiFrom = this.hiFrom?.length === src.length ? this.hiFrom : new Uint8Array(src.length);
      this.hiFrom.set(src);
    }
    if (!this.hiImage || this.hiImage.width !== width || this.hiImage.height !== height) {
      this.hiImage = this.ctx.createImageData(width, height);
    }
    composeAntialiased(this.hiPicture, paletteRgba, this.hiImage.data);
    const sprites = this.kidSource?.();
    if (this.kid && sprites && sprites.length > 0 && this.kidBase.length > 0) {
      this.kid.draw(
        this.hiImage.data,
        AA_FACTOR,
        surface,
        sprites,
        fadeOf(paletteRgba, this.kidBase)
      );
    }
    this.ctx.putImageData(this.hiImage, 0, 0);
  }
  /**
   * The words, on the canvas over the picture, at the canvas's own
   * resolution.
   *
   * The colour is looked up in the palette the picture was just drawn
   * with, so a line fades with the screen it is on rather than staying
   * bright through a `fade_out_2` -- the palette is the whole of how
   * the original fades, and the overlay reads the same one.
   */
  presentText(paletteRgba) {
    const items = this.textSource?.() ?? [];
    if (items.length === 0) {
      if (this.overlayCtx && this.overlay) {
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      }
      return;
    }
    const ctx = this.makeOverlay();
    const canvas = this.overlay;
    if (!ctx || !canvas) return;
    if (canvas.width < 2 || canvas.height < 2) this.placeOverlay();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / SCREEN_WIDTH, 0, 0, canvas.height / SCREEN_HEIGHT, 0, 0);
    ctx.textBaseline = "alphabetic";
    for (const item of items) {
      ctx.direction = item.rtl ? "rtl" : "ltr";
      const baseline = this.fitToBand(ctx, item);
      const at = item.color * 4;
      const r = paletteRgba[at] ?? 255;
      const g2 = paletteRgba[at + 1] ?? 255;
      const b = paletteRgba[at + 2] ?? 255;
      ctx.fillStyle = `rgb(${r} ${g2} ${b})`;
      let x = item.left;
      if (item.xAlign === 0) {
        ctx.textAlign = "center";
        x = (item.left + item.right) / 2;
      } else if (item.xAlign > 0) {
        ctx.textAlign = "right";
        x = item.right;
      } else ctx.textAlign = "left";
      ctx.fillText(item.text, x, baseline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  /**
   * Set the font for this line and say where its baseline goes.
   *
   * A line that declares no band keeps the size a seven-pixel capital
   * asks for and the baseline the original drew on, which is every
   * line of English in the game. A line that declares one is measured
   * -- `actualBoundingBox` is the ink, not the em, so it is the real
   * answer for this string in this face -- and made small enough to
   * sit inside it, because the strip under the room has eight rows
   * and a Hebrew lamed and qof together want twelve.
   */
  fitToBand(ctx, item) {
    const size = item.capHeight / CAP_RATIO;
    ctx.font = `${size}px ${VECTOR_FACE}`;
    const { top, bottom } = item;
    if (top === void 0 || bottom === void 0) return item.baseline;
    const fitted = fitLine(item.baseline, size, top, bottom, (at) => {
      ctx.font = `${at}px ${VECTOR_FACE}`;
      const m = ctx.measureText(item.text);
      return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    });
    ctx.font = `${fitted.size}px ${VECTOR_FACE}`;
    return fitted.baseline;
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
  demoMoves: 112878,
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
var DEMO_MOVE_COUNT = 25;
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
  const demoMoves = [];
  for (let i = 0; i < DEMO_MOVE_COUNT; i++) {
    const o = OFF.demoMoves + i * 4;
    demoMoves.push([dv.getInt16(o, true), dv.getInt16(o + 2, true)]);
  }
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
    demoMoves,
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
function midiTune(sound) {
  const b = sound.bytes;
  const nothing = { notes: [], length: 0 };
  if (b.length < 14 || b[0] !== 77 || b[1] !== 84) return nothing;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const division = dv.getUint16(12, false);
  if (division & 32768 || division === 0) return nothing;
  const raw = [];
  const tempos = [];
  let endTick = 0;
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
        const skip = varLen();
        p += skip;
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
    if (tick > endTick) endTick = tick;
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
  notes.sort((a, b2) => a.at - b2.at);
  return { notes, length: seconds(endTick) };
}
function speakerTune(sound) {
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
  return { notes, length: at };
}
var RICH_PARTIAL = 2;
var RICH_PARTIAL_LEVEL = 0.28;
var RICH_CUTOFF_HZ = 3800;
var TUNE_NOTE_CAP = 2048;
var Tune = class {
  nodes = [];
  sink;
  /** The one low pass of a rich tune, or nothing at `plain`. */
  filter = null;
  /** The node that carries `onended`, kept so a stop cannot drop it. */
  silent = null;
  /** When the last note ends, in the sink's own clock. */
  endsAt;
  onended = null;
  /**
   * @param length how long the sequence itself lasts, where that is
   * longer than its last note. The channel is held until then, as the
   * original's own driver holds it: the feather's tune stops sounding
   * at 18.000 s and its sequence ends at 18.667, and the whole of
   * `is_feather_fall` is `while (check_sound_playing())`.
   */
  constructor(sink, notes, wave, length = 0, voice = "plain") {
    this.sink = sink;
    const t0 = sink.currentTime + 0.03;
    let end = t0 + length;
    const rich = voice === "rich" && notes.length > 0 && typeof sink.createBiquadFilter === "function";
    let out2 = sink.destination;
    if (rich) {
      const filter = sink.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = RICH_CUTOFF_HZ;
      filter.Q.value = 0.7;
      filter.connect(sink.destination);
      this.filter = filter;
      out2 = filter;
    }
    for (const n of notes.slice(0, TUNE_NOTE_CAP)) {
      const start = t0 + n.at;
      const stop = start + n.dur;
      const peak = 0.11 * n.level;
      this.voiceNote(sink, out2, wave, n.hz, peak, start, stop, rich);
      if (rich) {
        this.voiceNote(
          sink,
          out2,
          "sine",
          n.hz * RICH_PARTIAL,
          peak * RICH_PARTIAL_LEVEL,
          start,
          stop,
          rich
        );
      }
      if (stop > end) end = stop;
    }
    this.endsAt = end;
    if (this.nodes.length) {
      const osc = sink.createOscillator();
      const gain = sink.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(sink.destination);
      this.silent = osc;
      osc.onended = () => {
        this.onended?.();
      };
      osc.start(t0);
      osc.stop(end + 0.01);
      this.nodes.push({ osc, gain });
    }
  }
  /**
   * One oscillator of one note, with its envelope.
   *
   * At `plain` the envelope is a rise, a flat hold and a fall, which
   * is what the page has always played. At `rich` it decays to a
   * sustain and releases, which is the shape every instrument of
   * the period had and the reason the plain voice sounds like an
   * organ: a note that holds dead level and then stops is the one
   * thing no real voice does.
   */
  voiceNote(sink, out2, wave, hz, peak, start, stop, rich) {
    const osc = sink.createOscillator();
    const gain = sink.createGain();
    osc.type = wave;
    osc.frequency.value = hz;
    const g2 = gain.gain;
    if (rich) {
      const attack = Math.min(0.012, (stop - start) / 4);
      const decay = Math.min(0.09, (stop - start) / 2);
      const release2 = Math.min(0.045, (stop - start) / 3);
      g2.setValueAtTime(0, start);
      g2.linearRampToValueAtTime(peak, start + attack);
      g2.linearRampToValueAtTime(peak * 0.72, start + attack + decay);
      g2.setValueAtTime(peak * 0.72, Math.max(start + attack + decay, stop - release2));
      g2.linearRampToValueAtTime(0, stop);
    } else {
      g2.setValueAtTime(0, start);
      g2.linearRampToValueAtTime(peak, start + 8e-3);
      g2.setValueAtTime(peak, Math.max(start + 9e-3, stop - 0.02));
      g2.linearRampToValueAtTime(0, stop);
    }
    osc.connect(gain);
    gain.connect(out2);
    osc.start(start);
    osc.stop(stop + 0.01);
    this.nodes.push({ osc, gain });
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
    this.silent = null;
    try {
      this.filter?.disconnect();
    } catch {
    }
    this.filter = null;
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
  10,
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
  25,
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
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0
];
var priority = Uint8Array.from(PRIORITY);
var interruptible = new Uint8Array(64);
var release = "1.0";
function setSoundRelease(which) {
  release = which;
  priority.set(PRIORITY);
  for (let i = 0; i < interruptible.length; i++) interruptible[i] = INTERRUPTIBLE[i] ?? 1;
  if (which === "1.3") {
    interruptible[49] = 1;
    priority[48] = 21;
    priority[10] = 13;
  }
}
function soundRelease() {
  return release;
}
var priorityOf = (i) => i >= 0 && i < priority.length ? priority[i] : 255;
var soundPriority = priorityOf;
setSoundRelease("1.0");
var interruptibleOf = (i) => (interruptible[i] ?? 1) !== 0;
function setSoundInterruptible(index, value) {
  if (index >= 0 && index < interruptible.length) interruptible[index] = value ? 1 : 0;
}
var soundInterruptible = interruptibleOf;
var MIN_BUFFER_RATE = 8e3;
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
   * `quality: original` or `high`, for the **sound**.
   *
   * Nothing in `src/pop` knows this exists: the game asks for sound
   * 15 and the question of how sound 15 is made is the shell's. It
   * starts at `original`, so every headless tool and every test
   * hears exactly what they heard before there was a setting, and
   * `web/main.ts` is the only thing that ever moves it.
   */
  qual = "original";
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
  /**
   * The sounds that would not read, and why.
   *
   * `read` writes a sound that threw down as `null` -- "neither a
   * recording nor a tune" -- and every later `play` of it returns on
   * that one line, silently. That is exactly how the exit door was
   * lost: `sound_15_leveldoor_sliding` is recorded at 2750 Hz and
   * Chromium's `createBuffer` throws under 3000, so the door went
   * quiet in the browser and in no other measurement this project
   * takes. Nothing in the game has no sound -- `every-sound.test.ts`
   * pins that every index of `soundids` has a recording, a tune or a
   * beep behind it -- so an entry here is always a fault, and the
   * page is now able to say so instead of going quiet.
   */
  failed = /* @__PURE__ */ new Map();
  /**
   * The last couple of hundred sounds that really reached the
   * channel, in order, by index.
   *
   * Not what the byte-code asked for -- `tools/dev/sound-trace.ts`
   * has that -- but what `start` did with it, which is the thing a
   * walk through the page in a real browser can read back and say
   * "the gate creaked here". Bounded, because a long game would
   * otherwise grow it for ever.
   */
  started = [];
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
   * Whether the context is really running.
   *
   * `wake` resolves either way: a browser that will not sound before
   * the player has touched the page resolves `resume()` and leaves
   * the state `suspended`. The page asks this before it starts the
   * opening, because an opening played into a suspended context is
   * not only silent -- `show_title` waits on
   * `while (check_sound_playing())` three times and all three fall
   * through at once.
   */
  get awake() {
    return this.woken && this.context.state === "running";
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
  get quality() {
    return this.qual;
  }
  /**
   * Move the quality, and forget what was read at the old one.
   *
   * A recording is turned into an `AudioBuffer` once and kept, and
   * the two qualities build that buffer differently -- so the cache
   * has to go, or the player would go on hearing the staircase until
   * the page was reloaded. A tune keeps nothing: it is built out of
   * its notes every time it is played.
   */
  set quality(value) {
    if (value === this.qual) return;
    this.qual = value;
    for (const [index, playable] of [...this.buffers]) {
      if (playable && playable.kind === "digi") this.buffers.delete(index);
    }
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
    this.started.push(index);
    if (this.started.length > 200) this.started.shift();
    this.stop();
    if (what.kind === "tune") {
      const sink = this.context;
      if (typeof this.context.createOscillator !== "function") return;
      const voice = this.quality === "high" ? "rich" : "plain";
      const tune = new Tune(sink, what.notes, what.wave, what.length, voice);
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
      const hold = Math.max(1, Math.ceil(MIN_BUFFER_RATE / digi.rate));
      const buffer = this.context.createBuffer(
        1,
        digi.samples.length * hold,
        digi.rate * hold
      );
      const channel = buffer.getChannelData(0);
      const value = (i) => ((digi.samples[i] ?? 128) - 128) / 128;
      const smooth = this.quality === "high" && hold > 1;
      for (let i = 0; i < digi.samples.length; i++) {
        const v = value(i);
        if (!smooth) {
          for (let k = 0; k < hold; k++) channel[i * hold + k] = v;
          continue;
        }
        const next = i + 1 < digi.samples.length ? value(i + 1) : v;
        for (let k = 0; k < hold; k++) channel[i * hold + k] = v + (next - v) * (k / hold);
      }
      return { kind: "digi", buffer };
    }
    const midi = await loadSound(this.assets, index, MIDI_FILES);
    if (midi && midi.kind === "midi") {
      const { notes, length } = midiTune(midi);
      if (notes.length) return { kind: "tune", notes, wave: "triangle", length };
    }
    const beep = await loadSound(this.assets, index, SPEAKER_FILES);
    if (beep && beep.kind === "speaker") {
      const { notes, length } = speakerTune(beep);
      if (notes.length) return { kind: "tune", notes, wave: "square", length };
    }
    return null;
  }
  /** Read a sound and turn it into something playable, once. */
  async preload(index) {
    if (this.buffers.has(index)) return;
    const already = this.pending.get(index);
    if (already) return already;
    const read2 = this.read(index);
    this.pending.set(index, read2);
    return read2;
  }
  async read(index) {
    try {
      const playable = await this.readPlayable(index);
      this.buffers.set(index, playable);
      if (playable && this.waitingFor === index && !this.muted && this.woken && this.mayTake(index)) {
        this.start(index, playable);
      }
    } catch (err) {
      this.buffers.set(index, null);
      this.failed.set(index, String(err));
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

// src/dat/level.ts
var ROOM_COUNT = 24;
var ROOM_WIDTH = 10;
var ROOM_HEIGHT = 3;
var TILES_PER_ROOM = ROOM_WIDTH * ROOM_HEIGHT;
var LEVEL_TILE_COUNT = ROOM_COUNT * TILES_PER_ROOM;
var LEVEL_PAYLOAD_SIZE = 2305;
var FIRST_LEVEL_RESOURCE = 2e3;
var LAST_LEVEL_RESOURCE = 2015;
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
    this.modifiers = alterModifiers(
      level.fg,
      level.bg,
      level.roomLinks,
      level.usedRooms
    );
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
var TBL_LEVEL_COLOUR = [0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 0, 0, 3, 3, 4, 0];
async function levelPalettes(assets) {
  try {
    const princeDat = await assets.dat("PRINCE.DAT");
    return princeDat.has(20) ? princeDat.get(20) : void 0;
  } catch {
    return void 0;
  }
}
function applyLevelColour(palette, blocks, levelNumber, levelType3) {
  if (!blocks) return;
  const colour = TBL_LEVEL_COLOUR[levelNumber] ?? 0;
  if (colour === 0) return;
  const env = 48 * (colour - 1);
  const wall = env + 48 * levelType3;
  if (wall + 48 > blocks.length) return;
  const entries = (at) => {
    const out2 = [{ r: 0, g: 0, b: 0 }];
    for (let i = 1; i < 16; i++) {
      out2.push({ r: blocks[at + i * 3], g: blocks[at + i * 3 + 1], b: blocks[at + i * 3 + 2] });
    }
    return out2;
  };
  palette.loadBlock(PALETTE_BASE.environment, entries(env));
  palette.loadBlock(PALETTE_BASE.environmentWall, entries(wall));
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
  applyLevelColour(screenPalette, await levelPalettes(assets), levelNumber, levelType3);
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
  objtable = [];
  // -------------------------------------------------------- the draw tables
  backtable = [];
  foretable = [];
  midtable = [];
  table_counts = new Int16Array(TABLES);
  wipetable = [];
  /** Which of `backtable` and `foretable` `ptr_add_table` points at. */
  ptr_add_table = "back";
  draw_xh = 0;
  draw_main_y = 0;
  draw_bottom_y = 0;
  drawn_row = 0;
  drawn_col = 0;
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
  /**
   * `need_redraw_because_flipped`, which `draw_game_frame` reads.
   *
   * `toggle_upside` and `play_kid_frame`'s un-flip set it, and the
   * middle branch of `draw_game_frame` turns it into a
   * `redraw_screen(0)`. Without it the tick the screen turns over
   * takes the cheap path -- `draw_moving(); draw_tables()` onto a
   * buffer composed the other way up -- and only the moving parts
   * are right.
   */
  need_redraw_because_flipped = 0;
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
  /** `end_sequence` has been reached: the last room of the last level. */
  game_won = 0;
  /**
   * `expired()` has been reached.
   *
   * In the C `expired` never returns -- it ends in `start_game`,
   * which `longjmp`s out of the whole game -- so a `goto` is all it
   * is. Here the shell watches this and plays the hourglass.
   */
  game_expired = 0;
  /**
   * The demo level has been run out of.
   *
   * `play_frame`'s `current_level == 0` branch ends in
   * `start_level = -1; start_game()` -- back to the title -- and the
   * shell does that where the C does it directly.
   */
  demo_finished = 0;
  upside_down = 0;
  need_level1_music = 0;
  is_blind_mode = 0;
  palace_wall_colors = new Uint8Array(44 * 3);
  demo_index = 0;
  demo_time = 0;
  /** `shadow_initialized`: level 12's shadow has been put in the room. */
  shadow_initialized = 0;
  /** `chtab_addrs`: the sprite banks, filled in by the loader. */
  chtab_addrs = Array.from({ length: 10 }, () => null);
};
var g = new Globals();
function resetGlobals() {
  const fresh = new Globals();
  const live = g;
  const keep = { is_blind_mode: g.is_blind_mode };
  for (const key of Object.keys(fresh)) live[key] = fresh[key];
  g.is_blind_mode = keep.is_blind_mode;
}
function roomLinksOf(room) {
  if (room >= 1 && room <= 24) return g.level.roomlinks[room - 1];
  if (room === 0) {
    return {
      left: g.level.doorlinks2[252],
      right: g.level.doorlinks2[253],
      up: g.level.doorlinks2[254],
      down: g.level.doorlinks2[255]
    };
  }
  return { left: 0, right: 0, up: 0, down: 0 };
}
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
function unlinked(name) {
  return (() => missing(name));
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
  inc_curr_row: slot("inc_curr_row"),
  /** `add_life`, which lives in seg000 and the potions in seg006 want. */
  add_life: slot("add_life"),
  /** `feather_fall`, the same: seg000's, and the green potion's. */
  feather_fall: slot("feather_fall"),
  /** `toggle_upside`, seg000's, and the inversion potion's. */
  toggle_upside: slot("toggle_upside"),
  /** `do_auto_moves(custom->demo_moves)`, which `do_demo` calls. */
  do_demo_moves: slot("do_demo_moves")
};
var hud = {
  draw_kid_hp: slot("draw_kid_hp"),
  draw_guard_hp: slot("draw_guard_hp")
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
  },
  /**
   * `sound_interruptible[which] = value`.
   *
   * The only place the game writes that table is
   * `animate_leveldoor`, and it writes it on every tick of a level
   * door moving.
   */
  set_sound_interruptible: (_which, _value) => {
  }
};

// src/pop/seg006.ts
var TILE_SIZEX = 14;
var TILE_SIZEY = 63;
var TILE_RIGHTX = 13;
var SCREENSPACE_X = 58;
var FALLING_SPEED_ACCEL2 = 3;
var FALLING_SPEED_MAX2 = 33;
var FALLING_SPEED_ACCEL_FEATHER = 1;
var FALLING_SPEED_MAX_FEATHER = 4;
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
  const linksOf = roomLinksOf;
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
var BEFORE_TILE_DIV_TBL = [
  2,
  0,
  65,
  0,
  128,
  0,
  191,
  0,
  254,
  0,
  255,
  1,
  1,
  255,
  196,
  255,
  3,
  0,
  66,
  0,
  129,
  0,
  192,
  0,
  248,
  255,
  55,
  0,
  118,
  0,
  181,
  0,
  244,
  0
];
var AFTER_TILE_MOD_TBL = [
  244,
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
  254,
  0,
  10,
  0,
  255,
  0,
  0,
  0,
  0,
  10,
  13,
  0,
  0,
  0,
  0
];
function get_tile_div_mod(xpos) {
  if (xpos >= 0 && xpos < 256) {
    obj_xl = tile_mod_tbl[xpos];
    return tile_div_tbl[xpos];
  }
  if (xpos < 0) {
    const i = BEFORE_TILE_DIV_TBL.length + xpos;
    if (i < 0) return arithmetic(xpos);
    obj_xl = tile_div_tbl[tile_div_tbl.length + xpos];
    return BEFORE_TILE_DIV_TBL[i];
  }
  const over = xpos - 256;
  if (over >= AFTER_TILE_MOD_TBL.length) return arithmetic(xpos);
  obj_xl = AFTER_TILE_MOD_TBL[over];
  return tile_mod_tbl[over];
}
function arithmetic(xpos) {
  const x = xpos - SCREENSPACE_X;
  let xh = Math.trunc(x / TILE_SIZEX);
  let xl = x % TILE_SIZEX;
  if (xl < 0) {
    xh -= 1;
    xl += TILE_SIZEX;
  }
  obj_xl = xl;
  return xh;
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
  if (g.Char.action !== actions.actions_4_in_freefall) return;
  if (g.is_feather_fall) {
    g.Char.fall_y += FALLING_SPEED_ACCEL_FEATHER;
    if (g.Char.fall_y > FALLING_SPEED_MAX_FEATHER) g.Char.fall_y = FALLING_SPEED_MAX_FEATHER;
    return;
  }
  g.Char.fall_y += FALLING_SPEED_ACCEL2;
  if (g.Char.fall_y > FALLING_SPEED_MAX2) g.Char.fall_y = FALLING_SPEED_MAX2;
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
        if (g.current_level !== 0 && g.current_level !== 15) play_death_music();
      } else {
        if (g.Char.alive !== 7 || out.check_sound_playing()) return;
        if (g.rem_min === 0) g.game_expired = 1;
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
function do_demo() {
  if (g.checkpoint) {
    g.control_shift2 = release_arrows();
    g.control_forward = CONTROL_HELD;
    g.control_x = CONTROL_HELD_FORWARD;
  } else if (g.Char.sword) {
    g.guard_skill = 10;
    l2.autocontrol_opponent.fn();
    g.guard_skill = 11;
  } else {
    l2.do_demo_moves.fn();
  }
}
function control_kid() {
  if (g.Char.alive < 0 && g.hitp_curr === 0) g.Char.alive = 0;
  if (g.grab_timer !== 0) --g.grab_timer;
  if (g.current_level === 0) {
    do_demo();
    l5.control.fn();
  } else {
    rest_ctrl_1();
    read_user_control();
    user_control();
    save_ctrl_1();
  }
}
function play_guard() {
  if (g.Char.charid === charids.charid_24_mouse) {
    l2.autocontrol_opponent.fn();
    return;
  }
  let stillAlive = false;
  if (g.Char.alive < 0) {
    if (g.guardhp_curr === 0) {
      g.Char.alive = 0;
      l2.on_guard_killed.fn();
    } else {
      stillAlive = true;
    }
  }
  if (!stillAlive && g.Char.charid === charids.charid_1_shadow) {
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
  let col = get_tile_div_mod(g.char_x_left_coll - 4);
  if (get_tile(room, col + 1, row) === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop) {
    g.obj_clip_right = (g.tile_col << 5) + 32;
  } else if (get_tile(room, col, row) !== tiles.tiles_7_doortop_with_floor && g.curr_tile2 !== tiles.tiles_12_doortop || action === actions.actions_3_in_midair || action === actions.actions_4_in_freefall && frame === frameids.frame_106_fall || action === actions.actions_5_bumped && frame === frameids.frame_107_fall_land_1 || g.Char.direction < directions.dir_0_right && (action === actions.actions_2_hang_climb || action === actions.actions_6_hang_straight || action === actions.actions_1_run_jump && frame >= frameids.frame_137_climbing_3 && frame < frameids.frame_140_climbing_6)) {
    col = get_tile_div_mod(g.char_x_right_coll);
    if ((get_tile(room, col, row) === tiles.tiles_20_wall || g.curr_tile2 === tiles.tiles_13_mirror && g.Char.direction === directions.dir_0_right) && (get_tile(room, col, g.char_top_row) === tiles.tiles_20_wall || g.curr_tile2 === tiles.tiles_13_mirror) && room === g.curr_room) {
      g.obj_clip_right = g.tile_col << 5;
    }
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
        l2.add_life.fn();
        break;
      case 3:
        l2.feather_fall.fn();
        break;
      case 4:
        l2.toggle_upside.fn();
        break;
      case 6:
        get_tile(8, 0, 0);
        l7.trigger_button.fn(0, 0, -1);
        break;
      case 5:
        out.stop_sounds();
        out.play_sound(soundids.sound_13_kid_hurt);
        g.hitp_delta = g.current_level === 15 ? -(g.hitp_max + 1 >> 1) : -1;
        break;
      default:
        break;
    }
  }
  g.pickup_obj_type = 0;
}
function play_death_music() {
  const id = g.Guard.charid === charids.charid_1_shadow ? soundids.sound_32_shadow_music : g.holding_sword ? soundids.sound_28_death_in_fight : soundids.sound_24_death_regular;
  out.play_sound(id);
  out.play_death_music();
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
var TILE_SIZEX2 = 14;
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
    g.coll_tile_left_xpos += TILE_SIZEX2;
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
      xpos -= TILE_SIZEX2 * SCREEN_TILECOUNTX;
    } else if (g.curr_room === g.room_R || g.curr_room === g.room_BR) {
      xpos += TILE_SIZEX2 * SCREEN_TILECOUNTX;
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
function resetSeg004() {
  collision_row = 0;
  right_checked_col = 0;
  left_checked_col = 0;
}

// src/pop/seg005.ts
var TILE_SIZEX3 = 14;
var FIRST_ONSCREEN_COLUMN3 = 5;
var CONTROL_HELD2 = -1;
var CONTROL_RELEASED2 = 0;
var CONTROL_IGNORE2 = 1;
var CONTROL_HELD_FORWARD2 = -1;
var CONTROL_HELD_BACKWARD2 = 1;
var CONTROL_HELD_UP2 = -1;
var CONTROL_HELD_DOWN2 = 1;
var dist = { char_opp_dist: unlinked("char_opp_dist") };
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
    g.Char.x = byteOf(char_dx_forward(distance - TILE_SIZEX3));
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
        let pos_adjustment = distance_to_edge(xpos) + TILE_SIZEX3 * tiles_forward - TILE_SIZEX3;
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

// src/pop/screen.ts
var full_image_id = {
  TITLE_MAIN: 0,
  TITLE_PRESENTS: 1,
  TITLE_GAME: 2,
  TITLE_POP: 3,
  TITLE_MECHNER: 4,
  HOF_POP: 5,
  STORY_FRAME: 6,
  STORY_ABSENCE: 7,
  STORY_MARRY: 8,
  STORY_HAIL: 9,
  STORY_CREDITS: 10
};
var FADE_CUTSCENE_ROWS = 26249;
function missing2(name) {
  throw new Error(`screen.${name} has not been linked in`);
}
var scr = {
  copy_screen_rect: () => missing2("copy_screen_rect"),
  present: () => missing2("present"),
  clip_room: () => missing2("clip_room"),
  rect: () => missing2("rect"),
  clear_screen: () => missing2("clear_screen"),
  set_bg_attr: () => missing2("set_bg_attr"),
  fade_start: () => missing2("fade_start"),
  fade_active: () => false,
  blit_image: () => missing2("blit_image"),
  load_intro_images: () => missing2("load_intro_images"),
  free_intro_images: () => missing2("free_intro_images"),
  now: () => 0,
  clear_screen_and_sounds: () => missing2("clear_screen_and_sounds"),
  draw_full_image: () => missing2("draw_full_image"),
  load_title_images: () => missing2("load_title_images"),
  release_title_images: () => missing2("release_title_images"),
  target: () => missing2("target"),
  show_text: () => missing2("show_text"),
  text_center_y: () => 0,
  char_width: () => 0,
  cstring_width: () => 0,
  draw_text_character: () => 0,
  read_peel: () => null,
  restore_peel: () => {
  },
  start_text_input: () => {
  },
  stop_text_input: () => {
  },
  take_key: () => null,
  clear_kbd_buf: () => {
  },
  hof_read_file: () => null,
  hof_write_file: () => {
  }
};
function setScreen(ops) {
  Object.assign(scr, ops);
}

// src/pop/seg009.ts
function prandom(max) {
  g.random_seed = Math.imul(g.random_seed, 214013) + 2531011 >>> 0;
  return (g.random_seed >>> 16) % (max + 1);
}
function set_seed(seed) {
  g.random_seed = seed >>> 0;
}
function* input_str(rect, buffer, max_length, initial, has_initial, arg_4, color, bgcolor) {
  scr.start_text_input(rect.left, rect.top, rect.right, rect.bottom);
  let key = null;
  let entered = "";
  let length = 0;
  let cursor_visible = 0;
  scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
  const init_length = initial.length;
  if (has_initial) {
    buffer.text = initial;
    length = init_length;
  }
  let current_xpos = rect.left + arg_4;
  const ypos = scr.text_center_y(rect.top, rect.bottom);
  let at = current_xpos;
  for (const ch of initial) at += scr.draw_text_character(at, ypos, ch, color);
  current_xpos += scr.cstring_width(initial) + (init_length !== 0 ? arg_4 : 0);
  const draw_text_cursor = (xpos, y, c) => {
    scr.draw_text_character(xpos, y, "_", c);
  };
  for (; ; ) {
    key = null;
    entered = "";
    for (; ; ) {
      if (cursor_visible) draw_text_cursor(current_xpos, ypos, color);
      else draw_text_cursor(current_xpos, ypos, bgcolor);
      cursor_visible = cursor_visible ? 0 : 1;
      const deadline = scr.now() + 6;
      if (key !== null) {
        if (cursor_visible) {
          draw_text_cursor(current_xpos, ypos, color);
          cursor_visible = cursor_visible ? 0 : 1;
        }
        if (key === "enter") {
          scr.stop_text_input();
          return length;
        }
        break;
      }
      while (scr.now() < deadline) {
        const press = scr.take_key();
        if (press) {
          key = press.key;
          entered = press.ch;
          break;
        }
        yield 1;
      }
    }
    const code = entered.charCodeAt(0);
    const entered_char = entered.length === 1 && code !== 127 ? entered : "";
    scr.clear_kbd_buf();
    if (key === "escape") {
      scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
      buffer.text = "";
      scr.stop_text_input();
      return -1;
    }
    if (length !== 0 && (key === "backspace" || key === "delete")) {
      --length;
      draw_text_cursor(current_xpos, ypos, bgcolor);
      current_xpos -= scr.char_width(buffer.text[length]);
      scr.draw_text_character(current_xpos, ypos, buffer.text[length], bgcolor);
      buffer.text = buffer.text.slice(0, length);
      draw_text_cursor(current_xpos, ypos, color);
    } else if (entered_char !== "" && code >= 32 && code !== 127 && length < max_length) {
      if (scr.char_width("_") + scr.char_width(entered_char) + current_xpos < rect.right) {
        draw_text_cursor(current_xpos, ypos, bgcolor);
        buffer.text = buffer.text.slice(0, length) + entered_char;
        length++;
        current_xpos += scr.draw_text_character(current_xpos, ypos, entered_char, color);
      }
    }
  }
}

// src/pop/seg007.ts
var TROBS_MAX = 30;
var MOBS_MAX = 14;
var last_loose_sound = 0;
var curmob_index = 0;
var curr_tile_temp = 0;
var looseSound = {
  get: () => last_loose_sound,
  set: (v) => {
    last_loose_sound = v;
  }
};
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
        out.set_sound_interruptible(soundids.sound_15_leveldoor_sliding, true);
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
        out.set_sound_interruptible(soundids.sound_15_leveldoor_sliding, false);
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
  let fellThrough = false;
  if (tiletype === tiles.tiles_15_opener) {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_14_debris;
    button_type = tiles.tiles_14_debris;
    fellThrough = true;
  }
  if (fellThrough || tiletype === tiles.tiles_6_closer) {
    trigger_button(1, button_type, -1);
    tiletype = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
    fellThrough = true;
  }
  if (fellThrough || tiletype === tiles.tiles_1_floor || tiletype === tiles.tiles_2_spike || tiletype === tiles.tiles_10_potion || tiletype === tiles.tiles_19_torch || tiletype === tiles.tiles_30_torch_with_debris) {
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
    g.curmob.room = roomLinksOf(g.curmob.room).down;
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
  const visible = gate_room === g.room_L ? tilepos % 10 === 9 : gate_room === g.drawn_room && tilepos % 10 !== 9;
  const alwaysHeard = g.current_level === 3 && gate_room === 2;
  if (visible || alwaysHeard) out.play_sound(sound_id);
}
function resetSeg007() {
  last_loose_sound = 0;
  curmob_index = 0;
  curr_tile_temp = 0;
}

// src/pop/seg003.ts
var TILE_SIZEX4 = 14;
var TILE_MIDX2 = 7;
var FIRST_ONSCREEN_COLUMN4 = 5;
var SCREEN_TILECOUNTX2 = 10;
var ROOMCOUNT = 24;
var distance_mirror = 0;
var dist2 = { char_opp_dist: unlinked("char_opp_dist") };
var rooms = {
  goto_other_room: unlinked("goto_other_room")
};
var demo = { hitp: 4, end_room: 24 };
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
  g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN4] + TILE_SIZEX4);
  g.Char.direction = ~g.level.start_dir;
  if (g.seamless === 0) {
    x = g.current_level !== 0 ? g.hitp_beg_lev : demo.hitp;
    g.hitp_max = x;
    g.hitp_curr = x;
  }
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
  setDroppedout(0);
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
    return;
  }
  if (get_tile_at_char() !== tiles.tiles_13_mirror) return;
  loadkid();
  load_frame();
  check_mirror_image();
  if (distance_mirror >= 0 && g.Char.room === g.drawn_room) {
    load_frame_to_obj();
    reset_obj_clip();
    const clip_top = y_clip[g.Char.curr_row + 1];
    if (clip_top < g.obj_y) {
      g.obj_clip_top = clip_top;
      g.obj_clip_left = (g.Char.curr_col << 5) + 9;
      l8.add_objtable.fn(4);
    }
  }
}
function jump_through_mirror() {
  loadkid();
  load_frame();
  check_mirror_image();
  g.jumped_through_mirror = 0;
  g.Char.charid = charids.charid_1_shadow;
  out.play_sound(soundids.sound_45_jump_through_mirror);
  saveshad();
  g.guardhp_max = g.hitp_max;
  g.guardhp_curr = g.guardhp_max;
  g.hitp_curr = 1;
  hud.draw_kid_hp.fn(1, g.hitp_max);
  hud.draw_guard_hp.fn(g.guardhp_curr, g.guardhp_max);
}
function check_mirror_image() {
  const xpos = x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN4] + 10;
  let distance = distance_to_edge_weight();
  if (g.Char.direction >= directions.dir_0_right) {
    distance = ~distance + TILE_SIZEX4;
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
        x_bump[guard_tile % 10 + FIRST_ONSCREEN_COLUMN4] + TILE_SIZEX4
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
    if (get_tile_at_kid(left_pos) === tiles.tiles_18_chomper) left_pos += TILE_SIZEX4;
    if (get_tile_at_kid(right_pos) === tiles.tiles_4_gate) right_pos -= TILE_SIZEX4;
    while (left_pos <= right_pos) {
      if (get_tile_at_kid(left_pos) === tiles.tiles_20_wall || g.curr_tile2 === tiles.tiles_7_doortop_with_floor || g.curr_tile2 === tiles.tiles_12_doortop) {
        g.can_guard_see_kid = 0;
        return;
      }
      if (g.curr_tile2 === tiles.tiles_11_loose || g.curr_tile2 === tiles.tiles_18_chomper || g.curr_tile2 === tiles.tiles_4_gate && g.curr_room_modif[g.curr_tilepos] < 112 || !tile_is_floor(g.curr_tile2)) {
        g.can_guard_see_kid = 1;
      }
      left_pos += TILE_SIZEX4;
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
  saveshad();
}

// src/pop/seg002.ts
var TILE_SIZEX5 = 14;
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
var demo2 = {
  moves: [[0, -1]]
};
var curr_guard_color = 0;
var guardColor = { value: 0 };
function setGuardColor(v) {
  curr_guard_color = v;
  guardColor.value = v;
}
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
  hud.draw_guard_hp.fn(0, g.guardhp_curr);
  g.guardhp_curr = 0;
}
function inc_curr_row() {
  ++g.Char.curr_row;
}
function on_guard_killed() {
  if (g.current_level === 0) {
    g.checkpoint = 1;
    g.demo_index = 0;
    g.demo_time = 0;
  } else if (g.current_level === 13) {
    g.flash_color = 15;
    g.flash_time = 18;
    g.is_show_time = 1;
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
    const link2 = roomLinksOf(g.drawn_room);
    g.room_L = link2.left;
    g.room_R = link2.right;
    g.room_A = link2.up;
    g.room_B = link2.down;
    if (g.room_A) {
      g.room_AL = roomLinksOf(g.room_A).left;
      g.room_AR = roomLinksOf(g.room_A).right;
    } else {
      if (g.room_L) g.room_AL = roomLinksOf(g.room_L).up;
      if (g.room_R) g.room_AR = roomLinksOf(g.room_R).up;
    }
    if (g.room_B) {
      g.room_BL = roomLinksOf(g.room_B).left;
      g.room_BR = roomLinksOf(g.room_B).right;
    } else {
      if (g.room_L) g.room_BL = roomLinksOf(g.room_L).down;
      if (g.room_R) g.room_BR = roomLinksOf(g.room_R).down;
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
  if (moves[demoindex] === void 0) return;
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
  draw_guard_hp: unlinked("draw_guard_hp"),
  add_life: unlinked("add_life")
};
function enter_guard() {
  const room_minus_1 = g.drawn_room - 1;
  if (room_minus_1 < 0 || room_minus_1 > 23) return;
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
  } else if (g.Guard.charid === charids.charid_4_skeleton && roomLinksOf(g.Guard.room).down === 3) {
    g.Guard.room = roomLinksOf(g.Guard.room).down;
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
  const link2 = roomLinksOf(g.Char.room);
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
    g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN5] + TILE_SIZEX5);
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
var hp2 = { draw_hp: unlinked("draw_hp") };
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
  g.objtable.length = 0;
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
  const blit = which_table === 0 && entry.blit === blitters.blitters_2_or ? blitters.blitters_10h_transp : entry.blit;
  draw_image(entry.chtab_id, entry.id, entry.xh * 8 + entry.xl, entry.y, blit);
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
var mirror = { level: 4, room: 4, column: 4 };
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
  if (g.Char.charid === charids.charid_1_shadow) {
    if (g.current_level === mirror.level && g.Char.room === mirror.room) {
      g.obj_clip_left = 137 + (mirror.column - 4) * 32;
    }
    add_objtable(1);
    return;
  }
  add_objtable(2);
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
    direction: g.obj_direction,
    clip_top: g.obj_clip_top,
    clip_bottom: g.obj_clip_bottom,
    clip_left: g.obj_clip_left,
    clip_right: g.obj_clip_right
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
  g.obj_clip_top = saved.clip_top;
  g.obj_clip_bottom = saved.clip_bottom;
  g.obj_clip_left = saved.clip_left;
  g.obj_clip_right = saved.clip_right;
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
function display_text_bottom(text2) {
  paint.text(text2);
}
function erase_bottom_text(arg_0) {
  paint.text(null);
  if (arg_0) {
    g.text_time_total = 0;
    g.text_time_remaining = 0;
  }
}
function show_time() {
  if (g.Kid.alive < 0 && g.rem_min !== 0 && (g.current_level < 13 || g.current_level === 13 && g.leveldoor_open === 0) && g.current_level < 15) {
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
var mobs = { draw_mobs: unlinked("draw_mobs") };
function draw_mobs2() {
  mobs.draw_mobs();
}
function resetSeg008() {
  peels_table.length = 0;
  n_curr_objs = 0;
  curr_objs.length = 0;
  gate_top_y = 0;
  gate_openness = 0;
  gate_bottom_y = 0;
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
  if (g.current_level === 0) {
    if (g.Kid.room === demo.end_room) g.demo_finished = 1;
  } else if (g.current_level === FALLING_EXIT_LEVEL) {
    if (g.roomleave_result === -2) {
      g.Kid.y = byteOf(-1);
      out.stop_sounds();
      ++g.next_level;
    }
  } else if (g.current_level === SEAMLESS_EXIT_LEVEL) {
    if (g.Kid.room === SEAMLESS_EXIT_ROOM) {
      ++g.next_level;
      out.stop_sounds();
      g.seamless = 1;
    }
  }
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
  if (g.upside_down && g.Char.alive >= 0) {
    g.upside_down = 0;
    g.need_redraw_because_flipped = 1;
  }
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
  savekid();
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
    saveshad();
  }
}
function toggle_upside() {
  g.upside_down = ~g.upside_down;
  g.need_redraw_because_flipped = 1;
}
function feather_fall() {
  g.is_feather_fall = 1;
  g.flash_color = 2;
  g.flash_time = 3;
  out.stop_sounds();
  out.play_sound(soundids.sound_39_low_weight);
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
var WIN_LEVEL = 14;
var WIN_ROOM = 5;
var FALLING_EXIT_LEVEL = 6;
var SEAMLESS_EXIT_LEVEL = 12;
var SEAMLESS_EXIT_ROOM = 23;
function check_the_end() {
  if (g.next_room !== 0 && g.next_room !== g.drawn_room) {
    g.drawn_room = g.next_room;
    load_room_links();
    if (g.current_level === WIN_LEVEL && g.drawn_room === WIN_ROOM) g.game_won = 1;
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

// src/pop/wire.ts
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
  l2.set_start_pos.fn = set_start_pos;
  l2.on_guard_killed.fn = on_guard_killed;
  l2.inc_curr_row.fn = inc_curr_row;
  dist2.char_opp_dist = char_opp_dist;
  dist.char_opp_dist = char_opp_dist;
  rooms.goto_other_room = goto_other_room;
  mobs.draw_mobs = draw_mobs;
  hp2.draw_hp = draw_hp;
  hp.draw_guard_hp = draw_guard_hp;
  hp.add_life = add_life;
  l2.add_life.fn = add_life;
  l2.feather_fall.fn = feather_fall;
  l2.toggle_upside.fn = toggle_upside;
  l2.do_demo_moves.fn = () => do_auto_moves(demo2.moves);
  hud.draw_kid_hp.fn = draw_kid_hp;
  hud.draw_guard_hp.fn = draw_guard_hp;
}

// src/pop/game.ts
var GAMEPLAY_HEIGHT = 192;
var KID_FIRST_RESOURCE = 401;
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
var DEATH_MUSIC_TICKS = 36;
var FEATHER_SOUND_TICKS = 223;
var TEXT_RECT = { top: 193, left: 70, bottom: 202, right: 250 };
var TEXT_WHITE = 15;
var PopGame = class _PopGame {
  scene;
  surface = new Surface();
  levelNumber;
  /** `custom->intro_music_level`: the level whose opening has music. */
  introMusicLevel = 1;
  /**
   * `start_level = -1; start_game()`: the whole game again, from the
   * title. The shell acts on it between ticks.
   */
  restartGameDue = false;
  /** `is_restart_level`, which the shell acts on between ticks. */
  restartDue = false;
  /** The first tick of a level does nothing, as the original's does. */
  pendingFirstTick = true;
  /** The screen has to be drawn whole: `need_full_redraw`. */
  needFullRedraw = true;
  /**
   * Whether the next full redraw paints the room out first.
   *
   * `draw_game_frame` clears only when the room has changed. The
   * shell's own look-around changes the room too, and did not say so:
   * the room before it was left underneath and the new one drawn over
   * the top, so a palace room came up with another room's torches and
   * floors showing through it.
   */
  fullRedrawClears = false;
  /** The game's own font, out of the executable. */
  font;
  /**
   * The shell's text layer, or nothing at all.
   *
   * Nothing here reads a setting: this is handed in by `web/main.ts`
   * and is undefined everywhere else, so a headless run draws the
   * original's own words in the original's own font by construction.
   */
  text;
  /** The shell's listener for the Prince's own sprites; see the option. */
  onKidSprite;
  /** The last thing `display_text_bottom` asked for, for a relabel. */
  bottomText = null;
  /** `draw_level_first` has still to put the hit points up. */
  firstDraw = false;
  /** Where `play_sound` goes, if the shell has a speaker. */
  effects;
  /** `seamless` as the level began: see `PopOptions.seamless`. */
  seamlessEntry = false;
  /** `init_game`'s sixty, unless a capture arrived with less. */
  minutesLeft = 60;
  /** `prandom`'s seed, for asking what the original cannot reproduce. */
  seed;
  /** `current_target_surface`: the room's 192 rows, or the whole screen. */
  roomTarget = false;
  /**
   * `next_sound`: the sound this tick has asked for, waiting for
   * `play_next_sound` at the end of `draw_game_frame`. -1 is none.
   */
  nextSound = -1;
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
  /**
   * The ticks `sound_39_low_weight` has left, for `check_sound_playing`.
   *
   * See `FEATHER_SOUND_TICKS`. It is the feather's own clock: the C
   * has no other.
   */
  featherSound = 0;
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
    resetGlobals();
    resetSeg004();
    resetSeg007();
    resetSeg008();
    link();
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? "V");
    const game = new _PopGame(scene, levelNumber);
    game.effects = options.effects;
    game.seamlessEntry = options.seamless === true;
    game.minutesLeft = options.minutesLeft ?? 60;
    game.seed = options.seed;
    game.text = options.text;
    game.onKidSprite = options.onKidSprite;
    game.install(exe);
    const carried = options.carried;
    if (carried) {
      g.rem_min = carried.rem_min;
      g.rem_tick = carried.rem_tick;
      g.checkpoint = carried.checkpoint;
      g.hitp_beg_lev = carried.hitp_beg_lev;
    }
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
    const game = await _PopGame.start(
      assets,
      exe,
      this.levelNumber,
      { effects: this.effects, carried, text: this.text, onKidSprite: this.onKidSprite }
    );
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
    mirror.level = constants.mirrorLevel;
    mirror.room = constants.mirrorRoom;
    guards.hp = (n) => constants.guardHitPoints[n] ?? 0;
    guards.type = () => this.scene.guardType;
    demo2.moves = constants.demoMoves;
    demo.hitp = constants.demoHitPoints;
    demo.end_room = constants.demoEndRoom;
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
    out.set_sound_interruptible = setSoundInterruptible;
    out.play_sound = (which) => {
      if (this.nextSound < 0 || soundPriority(which) <= soundPriority(this.nextSound)) {
        if (this.effects?.hasSound && !this.effects.hasSound(which)) return;
        this.nextSound = which;
      }
    };
    out.stop_sounds = () => {
      this.deathMusic = 0;
      this.featherSound = 0;
      this.effects?.stopSounds?.();
    };
    out.check_sound_playing = () => this.deathMusic > 0 || this.featherSound > 0 || this.effects?.soundPlaying?.() ? 1 : 0;
    setPainter({
      image: (chtab, id) => this.imageOf(chtab, id),
      blit: (chtab, id, x, y, blit) => this.blit(chtab, id, x, y, blit),
      rect: (left, top, right, bottom, color) => {
        const floor = this.roomTarget ? 192 : 200;
        const low = Math.min(bottom, floor);
        if (low > top) this.surface.fillRect(left, top, right - left, low - top, color);
      },
      clip: (rect) => this.setClip(rect),
      text: (text2) => this.drawBottomText(text2),
      readPeel: (left, top, right, bottom) => this.readPeel(left, top, right, bottom),
      restorePeel: (peel) => this.restorePeel(peel),
      target: (room) => {
        this.roomTarget = room;
        this.setClip(this.clipRect);
      }
    });
    g.current_level = this.levelNumber;
    g.next_level = this.levelNumber;
    set_seed(this.seed ?? (this.levelNumber === 0 ? Math.floor(Date.now() / 1e3) : 1));
    g.hitp_beg_lev = constants.startHitPoints ?? 3;
    g.rem_min = this.minutesLeft;
    g.rem_tick = 719;
    g.text_time_remaining = 0;
    g.text_time_total = 0;
    g.is_show_time = 0;
    g.seamless = this.seamlessEntry ? 1 : 0;
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
    g.next_room = g.Kid.room;
    g.drawn_room = g.Kid.room;
    load_room_links();
    get_room_address(g.drawn_room);
    find_start_level_door();
    pos_guards();
    anim_tile_modif();
    loadkid();
    start_chompers();
    check_fall_flo();
    check_shadow();
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
  drawBottomText(text2) {
    this.bottomText = text2;
    this.surface.fillRect(
      TEXT_RECT.left,
      TEXT_RECT.top,
      TEXT_RECT.right - TEXT_RECT.left,
      TEXT_RECT.bottom - TEXT_RECT.top,
      0
    );
    if (this.text) {
      this.text.bottomText(
        this.surface,
        text2,
        TEXT_RECT.left,
        TEXT_RECT.top,
        TEXT_RECT.right - 1,
        TEXT_WHITE
      );
      return;
    }
    if (text2 === null || !this.font) return;
    drawTextCentred(
      this.surface,
      this.font,
      text2,
      TEXT_RECT.left,
      TEXT_RECT.right - 1,
      TEXT_RECT.top,
      TEXT_WHITE
    );
  }
  /**
   * Draw the strip again, because the language or the quality moved.
   *
   * The words under the room are put there once, by
   * `display_text_bottom`, and they stay on the surface until
   * something paints over them -- so a player who changes the
   * language while `60 MINUTES LEFT` is up would go on reading it in
   * English until the next time the game had something to say. This
   * is the shell asking for the same string again, and it is the only
   * thing in this class the shell may call about a setting.
   */
  refreshText() {
    this.drawBottomText(this.bottomText);
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
    if (this.onKidSprite && chtab === chtabs.id_chtab_2_kid && (blit & ~FLIPPED) === blitters.blitters_10h_transp) {
      this.onKidSprite(KID_FIRST_RESOURCE + id, x, y, (blit & FLIPPED) !== 0);
    }
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
    if (blit === blitters.blitters_46h_mono_6 && chtab === chtabs.id_chtab_7_environmentwall) {
      this.surface.blitMono(sprite, x, y, found.base + 14);
      return;
    }
    if (blit >= blitters.blitters_40h_mono) {
      this.surface.blitMono(sprite, x, y, blit & 15);
      return;
    }
    if (blit === blitters.blitters_2_or) {
      this.surface.blitOr(sprite, x, y, found.base);
      return;
    }
    if (blit === blitters.blitters_10h_transp) {
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
  /**
   * The player pressing the button after a death.
   *
   * `process_key` (`seg000:0784`), before its switch:
   *
   *     // If the Kid died, Enter or Shift will restart the level.
   *     if (rem_min != 0 && Kid.alive > 6 &&
   *         (control_shift || key == SDL_SCANCODE_RETURN)) {
   *         key = SDL_SCANCODE_A | WITH_CTRL; // Ctrl+A
   *     }
   *
   * The port took it from `Kid.alive >= 0`, which is the first tick
   * of the death, and with no `rem_min` guard at all -- so a player
   * mashing Shift as the Prince fell began the level again before
   * the death had played, where the original makes him watch it out,
   * and a Prince who died on the last tick of the hour restarted the
   * level instead of getting the hourglass. `Char.alive` counts 0 to
   * 6 over the death and stops at 7 for as long as the death music
   * is in the channel, so `> 6` is "the death is over".
   */
  pressButton() {
    if (g.rem_min !== 0 && g.Kid.alive > 6) this.restartDue = true;
  }
  step(controls) {
    if (this.pendingFirstTick) {
      this.pendingFirstTick = false;
      return;
    }
    if (g.current_level !== 0) {
      g.control_x = controls.x < 0 ? -1 : controls.x > 0 ? 1 : 0;
      g.control_y = controls.y < 0 ? -1 : controls.y > 0 ? 1 : 0;
      g.control_shift = controls.shift ? -1 : 0;
    }
    g.guardhp_delta = 0;
    g.hitp_delta = 0;
    if (this.deathMusic > 0) --this.deathMusic;
    if (this.featherSound > 0) --this.featherSound;
    timers();
    if (this.pendingCheats.length) {
      for (const key of this.pendingCheats) this.applyCheat(key);
      this.pendingCheats.length = 0;
    }
    if (g.control_shift && g.rem_min !== 0 && g.Kid.alive > 6) {
      this.restartDue = true;
    }
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
    if (differentRoom) {
      this.surface.fillRect(0, 0, 320, 192, 0);
    }
    screen.different_room = 0;
    if (g.is_blind_mode) {
      this.surface.fillRect(0, 0, 320, 192, 0);
      redraw_screen();
      return;
    }
    this.applyGuardColour();
    redraw_room();
    const blind = g.is_blind_mode;
    g.is_blind_mode = 1;
    draw_tables();
    g.is_blind_mode = blind;
    reset_tables();
    draw_moving();
    draw_tables();
    redraw_screen();
  }
  /** `draw_game_frame`. */
  render() {
    if (this.needFullRedraw) {
      this.needFullRedraw = false;
      const clears = this.fullRedrawClears;
      this.fullRedrawClears = false;
      this.redrawScreen(clears);
      if (this.firstDraw) {
        this.firstDraw = false;
        draw_kid_hp(g.hitp_curr, g.hitp_max);
        this.playNextSound();
        return this.surface;
      }
    } else if (screen.different_room) {
      g.drawn_room = g.next_room;
      if (levelType2.of(g.current_level)) gen_palace_wall_colors();
      this.redrawScreen(true);
    } else if (g.need_redraw_because_flipped) {
      g.need_redraw_because_flipped = 0;
      this.redrawScreen(false);
    } else {
      reset_tables();
      draw_moving();
      draw_tables();
    }
    this.tickBottomText();
    this.flashTick();
    this.playNextSound();
    return this.upsideDown ? this.flipped() : this.surface;
  }
  /** The picture the screen gets while `upside_down` is on. */
  flipSurface = null;
  /**
   * `flip_screen(offscreen_surface)`, which `draw_game_frame` wraps
   * the copy to the screen in while `upside_down` is set.
   *
   * It was in the shell, on the grounds that turning the finished
   * picture over on its way to the canvas looks the same and leaves
   * the comparison with a capture alone. The second half of that is
   * the problem: a capture of the original with the screen turned
   * over could not be compared with the port at all, because the
   * port's `render` handed back the picture the right way up. It is
   * `draw_game_frame`'s business in the C and it is here now.
   *
   * **The room turns over and the row of flasks does not.** The two
   * halves of the C say different things -- `flip_not_ega` mirrors
   * the whole surface about row 99.5, and `copy_screen_rect` mirrors
   * each rect about `SCREEN_GAMEPLAY_HEIGHT`, which is 192 -- and the
   * capture settles it. `invert2` turns the screen over at tick 60
   * and back at 190, and over the 130 ticks it is over the original
   * draws the 192 rows of the room mirrored **within themselves**,
   * with rows 192 to 199 left exactly where they are: that matches
   * 129 of the 130, and a mirror of all two hundred rows matches
   * **none** of them. The port mirrored all two hundred, in the
   * shell, and scored 131 of 260 for it.
   */
  flipped() {
    const out2 = this.flipSurface ??= new Surface();
    const w = this.surface.width;
    const h = this.surface.height;
    out2.pixels.set(this.surface.pixels);
    for (let y = 0; y < GAMEPLAY_HEIGHT; y++) {
      out2.pixels.set(
        this.surface.pixels.subarray(y * w, y * w + w),
        (GAMEPLAY_HEIGHT - 1 - y) * w
      );
    }
    if (h < GAMEPLAY_HEIGHT) throw new Error("the screen is shorter than the room");
    return out2;
  }
  /**
   * Which palette entries a flash took, to put back on the next tick.
   *
   * Entry nought was not enough: see `raiseFlash`.
   */
  flashedEntries = [];
  /**
   * `flash_if_hurt` and `remove_flash_if_hurt`, which the port never
   * had at all.
   *
   * `play_level` runs the two of them straight after
   * `draw_game_frame`, so the flash is on the frame that has just been
   * drawn and the countdown happens after it. The original does it by
   * filling the screen with the colour and blitting the frame back
   * over it with black punched out.
   *
   * ### A flash is a sixtieth of a second, not a tick
   *
   * `flash_if_hurt` is `do_flash(flash_color)`, which is
   * `set_timer_length(timer_2, 2); set_bg_attr(0, color);
   * do_simple_wait(timer_2)`, and `remove_flash_if_hurt` then takes
   * the colour off **before** `do_simple_wait(timer_1)` spends the
   * rest of the tick. So the colour is up for the first sixtieth or
   * two of a five-sixtieth tick and the screen is normal for the
   * rest of it. A flash is a *blink* at twelve a second, and for
   * eight ticks of a sword it is eight blinks.
   *
   * **Measured, on a capture of `PRINCE.EXE` grabbed at sixty frames
   * a second**: `addlife2`'s `shift+t` (`flash_color` 4,
   * `flash_time` 4) on level 2, every frame's share of the screen
   * that is pure black --
   *
   *     frame  3380 3381 3382 3383 3384 3385 3386 3387 3388 3389 ...
   *     black% 43.1 43.1 43.1 43.1  0.0 43.1 43.1 43.1 43.1  0.0
   *
   * -- **four flash frames, 3384, 3389, 3394 and 3399, one video
   * frame each and five apart**, which is one tick. The flashed
   * screen's commonest colour is `(170, 0, 0)`, which is the
   * hardcoded VGA palette's red (42,0,0) through the DAC's
   * `(v << 2) | (v >> 4)`.
   *
   * The port used to hold the colour for the whole tick, because
   * `render()` put it up and the next `render()` took it down. Eight
   * ticks of a sword were two thirds of a second of solid yellow
   * where the original blinks eight times: "the flash when picking
   * up the sword and when drinking a potion is not the original's".
   * `render()` now only counts the tick down and says what colour is
   * owed; `raiseFlash` and `dropFlash` are the two halves the page
   * runs a sixtieth apart.
   *
   * It also puts the port's once-a-tick picture where the capture's
   * is. `split_ticks.py` keeps, for each tick, the frame just before
   * the next change -- one of the four unflashed frames above -- so
   * a port whose tick picture carries the flash can never agree on
   * a flashing tick. `addlife2` 188 of 191 -> 190.
   *
   * ### The colour is the hardcoded sixteen, and it is the same table
   *
   * `set_bg_attr`'s commented-out original line is
   * `palette[vga_pal_index] = vga_palette[hc_pal_index]` -- the
   * hardcoded sixteen-colour table -- where SDLPoP's stand-in reads
   * `palette[hc_pal_index]`, the room's own. The two were measured
   * against each other for the four colours a flash ever takes, on
   * all fourteen levels:
   *
   *     hardcoded   2=[0,42,0]  4=[42,0,0]  14=[63,63,21]  15=[63,63,63]
   *     levels 1-14 the same, every one
   *
   * because `buildLevelScene` loads the EXE's own `vga_palette` into
   * entries 0 to 15 and no sprite bank's base is under 32. So the
   * difference is a no-op and `pal.entry(flash_color)` stands.
   *
   * **Every black pixel, not the background entry.** The port gave
   * entry nought the colour and nothing else, and a sprite drawn
   * with `blitters_0_no_transp` does not use entry nought for its
   * black -- it uses its own bank's, `paletteBase + 0`, which is
   * black in the palette and is not entry nought. The torches are
   * drawn exactly that way (`draw_tile_anim`'s
   * `add_backtable(id_chtab_1_flameswordpotion, modifier + 1, ...,
   * blitters_0_no_transp)`), so each flame kept a black box around
   * it while the rest of the room went red. That is the player's
   * "the flash is wrong, especially in the area of the torches".
   *
   * Measured against a capture of `PRINCE.EXE` taking `shift+t` on
   * level 2, as the share of the screen that is still black on the
   * flash frame:
   *
   *                        the room   the strip under it
   *     the original         0.0%           0.0%
   *     the port, before     2.9%           1.9%
   *     the port, after      0.0%           0.0%
   *
   * and 40.8% / 97.2% on the frames either side of it, in the
   * capture and in the port alike. So the flash covers the whole 320
   * by 200, the words and the hit points with it, and leaves nothing
   * black anywhere.
   *
   * Eight ticks of bright yellow for a sword picked up, four or two of
   * red for a hit point lost or gained, three of green for a potion,
   * eighteen of white when Jaffar falls. Every one of them was set in
   * `g` and none of them ever reached the screen.
   *
   * `flash_if_hurt` has a second branch -- red whenever `hitp_delta`
   * is negative, whether or not `flash_time` was set -- and it is
   * deliberately left out. The captures say the original does not do
   * it. `3764b76d` loses three hit points at tick 195 and not one of
   * the 17670 black pixels of its screen changes colour on that tick
   * or any other in the run; swept over the whole capture, no frame
   * has even half its usual count of black. Putting that branch in
   * costs one to three ticks on thirteen of the twenty-five
   * recordings -- 14069 of 16599 down to 14045 -- which is the
   * measurement saying the same thing twice.
   */
  flashTick() {
    this.dropFlash();
    this.flashColourThisTick = g.flash_time !== 0 ? g.flash_color : 0;
    if (g.flash_time !== 0) --g.flash_time;
  }
  /**
   * The colour `do_flash` is owed after this tick's picture, or nought.
   *
   * A driver that can draw inside a tick -- the page -- reads this
   * after `render()` and puts the colour up for a sixtieth. A driver
   * that draws once a tick leaves it alone, and so holds the picture
   * the original holds for four fifths of the tick.
   */
  get flashColour() {
    return this.flashColourThisTick;
  }
  flashColourThisTick = 0;
  /**
   * `do_flash(color)` -> `set_bg_attr(0, color)`: the colour over
   * every pixel of the screen that is black.
   */
  raiseFlash() {
    const colour = this.flashColourThisTick;
    if (colour <= 0 || this.flashedEntries.length !== 0) return;
    const pal = this.scene.screenPalette;
    const [r, gr, b] = pal.entry(colour);
    for (let i = 0; i < PALETTE_SIZE2; i++) {
      const [er, eg, eb] = pal.entry(i);
      if (er === 0 && eg === 0 && eb === 0) {
        this.flashedEntries.push(i);
        pal.setEntry(i, r, gr, b);
      }
    }
  }
  /** `remove_flash()` -> `set_bg_attr(0, 0)`: the black entries back. */
  dropFlash() {
    if (this.flashedEntries.length === 0) return;
    const pal = this.scene.screenPalette;
    for (const i of this.flashedEntries) pal.setEntry(i, 0, 0, 0);
    this.flashedEntries = [];
  }
  /**
   * `play_next_sound`, the last line of `draw_game_frame`.
   *
   *     if (next_sound >= 0) {
   *         if (!check_sound_playing() ||
   *             (sound_interruptible[current_sound] != 0 &&
   *              sound_prio_table[next_sound] <= sound_prio_table[current_sound]))
   *         {
   *             current_sound = next_sound;
   *             play_sound_from_buffer(sound_pointers[current_sound]);
   *         }
   *     }
   *     next_sound = -1;
   *
   * **The test in the middle of it is the game's and not only the
   * device's.** `SoundPlayer.mayTake` applies the same rule, so the
   * right sound reached the channel either way -- but this used to
   * write `current_sound` whatever the device then did with it, and
   * `current_sound` is read by `play_kid`:
   *
   *     if (check_sound_playing() && current_sound != 5) return;
   *
   * -- a dying Prince waits for whatever is sounding unless it is a
   * gate opening. With a gate in the channel and a footstep asked
   * for in the same tick, the device refuses the footstep (0xA0
   * against the gate's 0x37) and the channel still holds 5, while
   * `current_sound` said 23 and the Prince stopped to listen to a
   * sound nobody was playing.
   *
   * Everything the test needs is here: `check_sound_playing` is an
   * effect already and the two tables are the executable's. Where
   * there is no device -- `pop-report.ts`, `sound-report.ts`, every
   * test that is not the browser's -- `check_sound_playing` answers
   * nought except while the death music or a feather is being
   * counted out, so the first half of the test is true and nothing
   * changes.
   */
  playNextSound() {
    if (this.nextSound >= 0) {
      const current = g.current_sound;
      if (!out.check_sound_playing() || current >= 0 && soundInterruptible(current) && soundPriority(this.nextSound) <= soundPriority(current)) {
        g.current_sound = this.nextSound;
        if (this.nextSound === soundids.sound_39_low_weight) {
          this.featherSound = FEATHER_SOUND_TICKS;
        }
        this.effects?.sound?.(this.nextSound);
      }
    }
    this.nextSound = -1;
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
        this.restartGameDue = true;
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
  /**
   * `hitp_beg_lev`: how many flasks the Prince starts a level with.
   *
   * `start_level` sets it from the executable's `start_hitp` every
   * time, so a level of its own always begins with three. What carries
   * it is the shell: a death keeps it -- `restart` already did -- and
   * so must the door out of a level, or every flask the player found
   * is taken off him at the next one.
   *
   * The shell hands it the `hitp_max` of the level just finished, not
   * that level's own `hitp_beg_lev`: a flask raises the first and
   * leaves the second where it was.
   */
  get beginningHitPoints() {
    return g.hitp_beg_lev;
  }
  set beginningHitPoints(n) {
    if (n <= g.hitp_beg_lev) return;
    g.hitp_beg_lev = n;
    g.hitp_max = n;
    g.hitp_curr = n;
    g.hitp_delta = 1;
  }
  /** `drawn_room`, which the shell also sets to look round the level. */
  get drawnRoom() {
    return g.drawn_room;
  }
  set drawnRoom(room) {
    this.drawRoomNow(room);
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
  /**
   * `seamless`: this level was left at a run and the next one is not
   * to announce itself. Only level 12's room 23 sets it.
   */
  get seamlessExit() {
    return g.seamless !== 0;
  }
  /**
   * The flasks he is carrying, for a seamless exit.
   *
   * `do_startpos` skips `hitp_max = hitp_curr = hitp_beg_lev` when
   * `seamless` is set, because in the C the two are globals that the
   * run out of level 12 carries straight into 13. Here they are reset
   * with everything else, so the shell puts them back.
   */
  carryHitPoints(curr, max) {
    g.hitp_max = max;
    g.hitp_curr = curr;
    g.hitp_delta = 1;
  }
  /** `rem_min` and `rem_tick` as one number, for the shell's clock. */
  get remainingTicks() {
    return g.rem_min * 720 + g.rem_tick;
  }
  set remainingTicks(ticks) {
    g.rem_min = Math.max(0, Math.floor(ticks / 720));
    g.rem_tick = Math.max(1, ticks - g.rem_min * 720);
  }
  /**
   * `if (current_level < 13 && rem_min == 0) expired();`
   *
   * The last line of the original's `play_frame`. `expired()` throws
   * the screen away, plays the hourglass out and starts the game from
   * the title again, and the cutscene is the shell's business -- but
   * nothing in this port watched the clock at all, so the hour ran
   * out and the game simply carried on. The shell asks this each tick
   * and goes back to the title.
   *
   * Not on level 13 or after: the original says expiring does not
   * count on Jaffar's level or the princess's -- but `play_kid` has
   * its own `if (rem_min == 0) expired();` for a Prince who dies on
   * the last tick, and that one has no level guard.
   */
  get timeExpired() {
    return g.current_level < 13 && g.rem_min === 0 || g.game_expired !== 0;
  }
  /**
   * The Prince has walked into the last room of the last level.
   *
   * `check_the_end` runs `end_sequence()` there. A cutscene cannot
   * be run from inside a tick, so the game says it is won and the
   * shell plays the ending; before any of this nothing said it at
   * all and the game carried on.
   */
  get gameWon() {
    return g.game_won !== 0;
  }
  /** This is the demo level, which plays itself. */
  get isDemo() {
    return this.levelNumber === 0;
  }
  /**
   * The demo has run out of its last room.
   *
   * `play_frame`'s `current_level == 0` branch is
   * `start_level = -1; start_game()`, which is the title again.
   */
  get demoFinished() {
    return g.demo_finished !== 0;
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
  say(text2, ticks = 24) {
    display_text_bottom(text2);
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
  /** Shift+W: `feather_fall()`, the same call the green potion makes. */
  featherFall() {
    feather_fall();
  }
  /** Shift+B: the room goes dark and the Prince plays on without it. */
  toggleBlind() {
    g.is_blind_mode = g.is_blind_mode ? 0 : 1;
    this.needFullRedraw = true;
  }
  /**
   * `is_feather_fall`, for a shell that wants to show it.
   *
   * The potion page puts it on the screen beside the hit points,
   * because the green potion is the one effect in the game with
   * nothing to see: `fall_accel` gathers one to the fall instead of
   * three and that is all, so without a readout there is no way to
   * tell whether it took.
   */
  get isFeatherFall() {
    return g.is_feather_fall !== 0;
  }
  /** Shift+I: the screen turns over. The shell does the turning. */
  toggleUpsideDown() {
    toggle_upside();
  }
  get upsideDown() {
    return g.upside_down !== 0;
  }
  /**
   * Show another room without playing: the view-the-level keys.
   *
   * H, J, U and N are two lines of the C and no more --
   * `draw_guard_hp(0, 10); next_room = room_L;` -- and everything
   * else is `check_the_end`, which `play_frame` runs at the end of
   * the same tick the key was read in. That matters twice over.
   *
   * It used to be written out here instead, and the copy had dropped
   * three of `check_the_end`'s calls: `loadkid`, `check_fall_flo` and
   * `check_shadow`. So looking into room 24 of level 5, room 1 of
   * level 6 or room 15 of level 12 met nobody where the original
   * raises the shadow there; looking into any room with a guard in it
   * -- Jaffar's room 1 of level 13 among them -- met nobody, because
   * `enter_guard` is the tail of `check_shadow`; and looking into
   * room 23 or 16 of level 13 did not set its floors falling. It is
   * the same fault `startLevel` had, in the other place a room is
   * drawn whole, and it was found the same way: by reading
   * `check_the_end` beside it.
   *
   * And it drew the new room *before* the tick rather than inside it,
   * so `do_mobs`, `check_skel`, `play_kid_frame` and `exit_room` all
   * ran a tick early against the room they test `drawn_room` for.
   *
   * **And there is no test in front of the two lines.** This opened
   * on `if (room === g.drawn_room) return;`, which costs nothing for
   * `next_room` -- `check_the_end` is `if (next_room != 0 &&
   * next_room != drawn_room)` and does nothing either way -- but
   * skipped the erase. So **Ctrl+B pressed in the room the Prince is
   * already in**, which is the ordinary way to stop looking around,
   * left the guard's flasks painted under the room where the
   * original rubs them out, and nothing redraws them: `draw_hp` only
   * touches them while `guardhp_delta` is set. No digest moves by
   * it, measured: 32260 of 33047 either way, run for run.
   */
  showRoom(room) {
    draw_guard_hp(0, 10);
    g.next_room = room;
  }
  /**
   * The same, drawn at once rather than at the end of a tick.
   *
   * The shell's look-around and `__princeShow` want the picture
   * without playing a tick for it, which the game itself never does.
   * It is `check_the_end` and then the whole-screen redraw
   * `draw_game_frame` would have done.
   */
  drawRoomNow(room) {
    this.showRoom(room);
    check_the_end();
    if (levelType2.of(g.current_level)) gen_palace_wall_colors();
    this.needFullRedraw = true;
    this.fullRedrawClears = true;
  }
  /**
   * `process_key`'s cheats, by the key that asks for one.
   *
   * The shell has the same switch over the browser's key names; this
   * is the one a recording replays through, so that a probe can ask
   * the original a question the player's four keys cannot -- what the
   * shadow of level 5 looks like when room 24 is drawn, or Jaffar
   * when room 1 of level 13 is. `recording_to_script.mjs` sends the
   * same key to the emulator on the same tick.
   */
  cheat(key) {
    this.pendingCheats.push(key);
  }
  /**
   * The cheats asked for since the last tick, waiting for their place
   * in it.
   *
   * `process_key` does not run before the tick, it runs *inside* it:
   * the chain is `play_level_2` -> `play_frame` -> `play_kid_frame`
   * -> `control_kid` -> `do_paused`, and `do_paused` is where the
   * keyboard is pumped. `play_level_2` clears `guardhp_delta` and
   * `hitp_delta` just *before* `play_frame`, so a cheat that sets one
   * of them -- `shift+s`, `shift+t`, `k` -- has it carried to
   * `do_delta_hp` and `draw_hp` in the same tick.
   *
   * Applying them before `step` instead put them on the wrong side of
   * that clearing and the delta was wiped every time. `shift+t` took
   * `hitp_max` from three to four and the row of flasks went on
   * showing three: `addlife2` scored 60 of 191 for it, every tick
   * after the cheat, and the capture has the fourth flask at
   * (21,194)-(26,198) from its tick 62. `k` was the same -- the guard
   * fell over and his hit points stayed on the screen, 179 of 299.
   */
  pendingCheats = [];
  applyCheat(key) {
    switch (key) {
      case "h":
        this.showRoom(g.room_L);
        break;
      case "j":
        this.showRoom(g.room_R);
        break;
      case "u":
        this.showRoom(g.room_A);
        break;
      case "n":
        this.showRoom(g.room_B);
        break;
      case "ctrl+b":
        this.showRoom(g.Kid.room);
        break;
      case "k":
        this.killGuard();
        break;
      case "r":
        this.resurrect();
        break;
      case "shift+i":
        this.toggleUpsideDown();
        break;
      case "shift+w":
        this.featherFall();
        break;
      case "shift+b":
        this.toggleBlind();
        break;
      case "shift+s":
        this.heal();
        break;
      case "shift+t":
        this.addLife();
        break;
      case "+":
        this.addMinutes(1);
        break;
      case "-":
        this.addMinutes(-1);
        break;
      /**
       * `c` and `shift+c`: the room's links, in words under the room.
       *
       * `seg000.c:741` and `:746` write `sprintf_temp` and set
       * `need_show_text`, and the tail of `process_key` turns that
       * into `display_text_bottom(answer_text); text_time_total =
       * text_time_remaining = 24`. They were in the catalogue of
       * cheats in `tools/oracle/README.md` as "yes, a capture can use
       * them" and were the two of the eleven the port never had.
       */
      case "c":
        display_text_bottom(`S${g.drawn_room} L${g.room_L} R${g.room_R} A${g.room_A} B${g.room_B}`);
        g.text_time_total = 24;
        g.text_time_remaining = 24;
        break;
      case "shift+c":
        display_text_bottom(`AL${g.room_AL} AR${g.room_AR} BL${g.room_BL} BR${g.room_BR}`);
        g.text_time_total = 24;
        g.text_time_remaining = 24;
        break;
      default:
        throw new Error(`no such cheat ${JSON.stringify(key)}`);
    }
  }
};

// src/pop/seg001.ts
var cutscene_wait_frames = 0;
var cutscene_frame_time = 6;
var disable_keys = 0;
var keysDisabled = () => disable_keys;
var next_sound = -1;
function play_sound(which) {
  if (next_sound < 0 || soundPriority(which) <= soundPriority(next_sound)) {
    next_sound = which;
  }
}
function play_next_sound() {
  if (next_sound >= 0) {
    g.current_sound = next_sound;
    out.play_sound(next_sound);
  }
  next_sound = -1;
}
var hourglass_sandflow = -1;
var hourglass_state = 0;
var which_torch = 0;
var N_STARS = 6;
var MAX_HOF_COUNT = 6;
var HOF_ENTRY_BYTES = 29;
var hof = Array.from(
  { length: MAX_HOF_COUNT },
  () => ({ name: "", min: 0, tick: 0 })
);
var hof_count = 0;
var hof_rects = [
  { top: 84, left: 72, bottom: 96, right: 248 },
  { top: 98, left: 72, bottom: 110, right: 248 },
  { top: 112, left: 72, bottom: 124, right: 248 },
  { top: 126, left: 72, bottom: 138, right: 248 },
  { top: 140, left: 72, bottom: 152, right: 248 },
  { top: 154, left: 72, bottom: 166, right: 248 }
];
function show_hof_text(rect, x_align, y_align, text2) {
  const text_color = 183;
  const shadow_color = 0;
  scr.show_text(
    rect.left + 1,
    rect.top + 1,
    rect.right + 1,
    rect.bottom + 1,
    x_align,
    y_align,
    text2,
    shadow_color
  );
  scr.show_text(
    rect.left,
    rect.top,
    rect.right,
    rect.bottom,
    x_align,
    y_align,
    text2,
    text_color
  );
}
function show_hof() {
  for (let index = 0; index < hof_count; ++index) {
    const entry = hof[index];
    if (entry.min === 0) {
      entry.min = 1;
      entry.tick = 0;
    }
    const seconds = Math.trunc(entry.tick / 12);
    const time_text = `${entry.min - 1}:${String(seconds).padStart(2, "0")}`;
    show_hof_text(hof_rects[index], -1, 0, entry.name);
    show_hof_text(hof_rects[index], 1, 0, time_text);
  }
}
var HOF_HEBREW_FIRST = 224;
var HEBREW_ALEF = 1488;
var HEBREW_TAV = 1514;
function hofByte(code) {
  if (code >= HEBREW_ALEF && code <= HEBREW_TAV) {
    return HOF_HEBREW_FIRST + (code - HEBREW_ALEF);
  }
  return code & 255;
}
function hofChar(byte) {
  if (byte >= HOF_HEBREW_FIRST && byte <= HOF_HEBREW_FIRST + (HEBREW_TAV - HEBREW_ALEF)) {
    return String.fromCharCode(HEBREW_ALEF + (byte - HOF_HEBREW_FIRST));
  }
  return String.fromCharCode(byte);
}
function hof_write() {
  const bytes = new Uint8Array(2 + MAX_HOF_COUNT * HOF_ENTRY_BYTES);
  const dv = new DataView(bytes.buffer);
  dv.setInt16(0, hof_count, true);
  for (let i = 0; i < MAX_HOF_COUNT; i++) {
    const at = 2 + i * HOF_ENTRY_BYTES;
    const entry = hof[i];
    for (let c = 0; c < 25 && c < entry.name.length; c++) {
      bytes[at + c] = hofByte(entry.name.charCodeAt(c));
    }
    dv.setInt16(at + 25, entry.min, true);
    dv.setInt16(at + 27, entry.tick, true);
  }
  scr.hof_write_file(bytes);
}
function hof_read() {
  hof_count = 0;
  for (const entry of hof) {
    entry.name = "";
    entry.min = 0;
    entry.tick = 0;
  }
  const bytes = scr.hof_read_file();
  if (bytes === null) return;
  if (bytes.length !== 2 + MAX_HOF_COUNT * HOF_ENTRY_BYTES) {
    hof_count = 0;
    return;
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  hof_count = dv.getInt16(0, true);
  if (hof_count < 0 || hof_count > MAX_HOF_COUNT) {
    hof_count = 0;
    return;
  }
  for (let i = 0; i < MAX_HOF_COUNT; i++) {
    const at = 2 + i * HOF_ENTRY_BYTES;
    let name = "";
    for (let c = 0; c < 25; c++) {
      const b = bytes[at + c];
      if (b === 0) break;
      name += hofChar(b);
    }
    hof[i] = { name, min: dv.getInt16(at + 25, true), tick: dv.getInt16(at + 27, true) };
  }
}
function* proc_cutscene_frame(wait_frames) {
  cutscene_wait_frames = wait_frames;
  do {
    play_both_seq();
    draw_proom_drects();
    if (g.flash_time) {
      do_flash(g.flash_color);
    }
    if (g.flash_time) {
      --g.flash_time;
      remove_flash();
    }
    if (!out.check_sound_playing()) {
      play_next_sound();
    }
    yield cutscene_frame_time;
    --cutscene_wait_frames;
  } while (cutscene_wait_frames);
}
function play_both_seq() {
  play_kid_seq();
  play_opp_seq();
}
function draw_proom_drects() {
  draw_princess_room_bg();
  scr.present();
  if (cutscene_wait_frames & 1) {
    draw_star(prandom(N_STARS - 1), 1);
  }
}
function play_kid_seq() {
  loadkid();
  if (g.Char.frame) {
    play_seq();
    savekid();
  }
}
function play_opp_seq() {
  loadshad_and_opp();
  if (g.Char.frame) {
    play_seq();
    saveshad();
  }
}
function draw_princess_room_bg() {
  reset_tables();
  loadkid();
  if (g.Char.frame) {
    load_frame_to_obj();
    g.obj_tilepos = 30;
    add_objtable(0);
  }
  loadshad();
  if (g.Char.frame) {
    load_frame_to_obj();
    g.obj_tilepos = 30;
    add_objtable(0);
  }
  redraw_needed_tiles();
  add_foretable(
    chtabs.id_chtab_8_princessroom,
    2,
    30,
    0,
    167,
    blitters.blitters_10h_transp,
    0
  );
  princess_room_torch();
  draw_hourglass();
  draw_tables();
}
function seqtbl_offset_shad_char(seq_index) {
  loadshad();
  seqtbl_offset_char(seq_index);
  saveshad();
}
function seqtbl_offset_kid_char(seq_index) {
  loadkid();
  seqtbl_offset_char(seq_index);
  savekid();
}
function init_mouse_cu8() {
  init_mouse_go();
  g.Char.x = 144;
  seqtbl_offset_char(seqids.seq_106_mouse);
  play_seq();
}
function init_mouse_go() {
  g.Char.charid = charids.charid_24_mouse;
  g.Char.x = 199;
  g.Char.y = 167;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_105_mouse_forward);
  play_seq();
}
function princess_crouching() {
  init_princess();
  g.Char.x = 131;
  g.Char.y = 169;
  seqtbl_offset_char(seqids.seq_110_princess_crouching_PV2);
  play_seq();
}
function princess_stand() {
  init_princess_right();
  g.Char.x = 144;
  g.Char.y = 169;
  seqtbl_offset_char(seqids.seq_94_princess_stand_PV1);
  play_seq();
}
function init_princess_x156() {
  init_princess();
  g.Char.x = 156;
}
function princess_lying() {
  init_princess();
  g.Char.x = 92;
  g.Char.y = 162;
  seqtbl_offset_char(seqids.seq_103_princess_lying_PV2);
  play_seq();
}
function init_princess_right() {
  init_princess();
  g.Char.direction = directions.dir_0_right;
}
function init_ending_princess() {
  init_princess();
  g.Char.x = 136;
  g.Char.y = 164;
  seqtbl_offset_char(seqids.seq_109_princess_stand_PV2);
  play_seq();
}
function init_mouse_1() {
  init_mouse_go();
  g.Char.x -= 2;
  g.Char.y = 164;
}
function init_princess() {
  g.Char.charid = charids.charid_5_princess;
  g.Char.x = 120;
  g.Char.y = 166;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_94_princess_stand_PV1);
  play_seq();
}
function init_vizier() {
  g.Char.charid = charids.charid_6_vizier;
  g.Char.x = 198;
  g.Char.y = 166;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_95_Jaffar_stand_PV1);
  play_seq();
}
function init_ending_kid() {
  g.Char.charid = charids.charid_0_kid;
  g.Char.x = 198;
  g.Char.y = 164;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_1_start_run);
  play_seq();
}
function* cutscene_8() {
  play_sound(soundids.sound_35_cutscene_8_9);
  set_hourglass_state(hourglass_frame());
  init_mouse_cu8();
  savekid();
  princess_crouching();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(20);
  seqtbl_offset_kid_char(seqids.seq_107_mouse_stand_up_and_go);
  yield* proc_cutscene_frame(20);
  seqtbl_offset_shad_char(seqids.seq_111_princess_stand_up_PV2);
  yield* proc_cutscene_frame(20);
  g.Kid.frame = 0;
  yield* fade_out_1();
}
function* cutscene_9() {
  play_sound(soundids.sound_35_cutscene_8_9);
  set_hourglass_state(hourglass_frame());
  princess_stand();
  saveshad();
  yield* fade_in_1();
  init_mouse_go();
  savekid();
  yield* proc_cutscene_frame(5);
  seqtbl_offset_shad_char(seqids.seq_112_princess_crouch_down_PV2);
  yield* proc_cutscene_frame(9);
  seqtbl_offset_kid_char(seqids.seq_114_mouse_stand);
  yield* proc_cutscene_frame(58);
  yield* fade_out_1();
}
function* end_sequence_anim() {
  disable_keys = 1;
  scr.present();
  play_sound(soundids.sound_26_embrace);
  init_ending_princess();
  saveshad();
  init_ending_kid();
  savekid();
  yield* proc_cutscene_frame(8);
  seqtbl_offset_shad_char(seqids.seq_108_princess_turn_and_hug);
  yield* proc_cutscene_frame(5);
  seqtbl_offset_kid_char(seqids.seq_13_stop_run);
  yield* proc_cutscene_frame(2);
  g.Kid.frame = 0;
  yield* proc_cutscene_frame(39);
  init_mouse_1();
  savekid();
  yield* proc_cutscene_frame(9);
  seqtbl_offset_kid_char(seqids.seq_101_mouse_stands_up);
  yield* proc_cutscene_frame(41);
  yield* fade_out_1();
  while (out.check_sound_playing()) yield 1;
}
function* time_expired() {
  disable_keys = 1;
  set_hourglass_state(7);
  hourglass_sandflow = -1;
  play_sound(soundids.sound_36_out_of_time);
  yield* fade_in_1();
  yield* proc_cutscene_frame(2);
  yield* proc_cutscene_frame(100);
  yield* fade_out_1();
  while (out.check_sound_playing()) yield 1;
}
function* cutscene_12() {
  const frame_num = hourglass_frame();
  if (frame_num >= 6) {
    set_hourglass_state(frame_num);
    init_princess_x156();
    saveshad();
    play_sound(soundids.sound_40_cutscene_12_short_time);
    yield* fade_in_1();
    yield* proc_cutscene_frame(2);
    seqtbl_offset_shad_char(98);
    yield* proc_cutscene_frame(24);
    yield* fade_out_1();
  } else {
    yield* cutscene_2_6();
  }
}
function* cutscene_4() {
  play_sound(soundids.sound_27_cutscene_2_4_6_12);
  set_hourglass_state(hourglass_frame());
  princess_lying();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(26);
  yield* fade_out_1();
}
function* cutscene_2_6() {
  play_sound(soundids.sound_27_cutscene_2_4_6_12);
  set_hourglass_state(hourglass_frame());
  init_princess_right();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(26);
  yield* fade_out_1();
}
function* pv_scene() {
  init_princess();
  saveshad();
  yield* fade_in_1();
  init_vizier();
  savekid();
  yield* proc_cutscene_frame(2);
  play_sound(soundids.sound_50_story_2_princess);
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  cutscene_frame_time = 8;
  yield* proc_cutscene_frame(5);
  play_sound(soundids.sound_4_gate_closing);
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  play_sound(soundids.sound_51_princess_door_opening);
  yield* proc_cutscene_frame(3);
  seqtbl_offset_shad_char(98);
  yield* proc_cutscene_frame(5);
  seqtbl_offset_kid_char(96);
  yield* proc_cutscene_frame(6);
  play_sound(soundids.sound_53_story_3_Jaffar_comes);
  seqtbl_offset_kid_char(97);
  yield* proc_cutscene_frame(4);
  yield* proc_cutscene_frame(18);
  seqtbl_offset_kid_char(96);
  yield* proc_cutscene_frame(30);
  seqtbl_offset_kid_char(97);
  yield* proc_cutscene_frame(35);
  seqtbl_offset_kid_char(102);
  cutscene_frame_time = 7;
  yield* proc_cutscene_frame(1);
  seqtbl_offset_shad_char(99);
  yield* proc_cutscene_frame(17);
  hourglass_state = 1;
  g.flash_time = 5;
  g.flash_color = 15;
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  seqtbl_offset_kid_char(100);
  hourglass_sandflow = 0;
  yield* proc_cutscene_frame(6);
  play_sound(soundids.sound_52_story_4_Jaffar_leaves);
  yield* proc_cutscene_frame(24);
  hourglass_state = 2;
  yield* proc_cutscene_frame(9);
  seqtbl_offset_shad_char(113);
  yield* proc_cutscene_frame(28);
  yield* fade_out_1();
}
function set_hourglass_state(state) {
  hourglass_sandflow = 0;
  hourglass_state = state;
}
var time_bound = [6, 17, 33, 65];
function hourglass_frame() {
  let bound_index;
  for (bound_index = 0; bound_index < 4; ++bound_index) {
    if (time_bound[bound_index] > g.rem_min) break;
  }
  return 6 - bound_index;
}
var princess_torch_pos_xh = [11, 26];
var princess_torch_pos_xl = [5, 3];
var princess_torch_frame = [1, 6];
function princess_room_torch() {
  for (let which = 2; which--; ) {
    which_torch = which_torch ? 0 : 1;
    princess_torch_frame[which_torch] = get_torch_frame(princess_torch_frame[which_torch]);
    add_backtable(
      chtabs.id_chtab_1_flameswordpotion,
      princess_torch_frame[which_torch] + 1,
      princess_torch_pos_xh[which_torch],
      princess_torch_pos_xl[which_torch],
      116,
      0,
      0
    );
  }
}
function draw_hourglass() {
  if (hourglass_sandflow >= 0) {
    hourglass_sandflow = (hourglass_sandflow + 1) % 3;
    if (hourglass_state >= 7) return;
    add_foretable(
      chtabs.id_chtab_8_princessroom,
      hourglass_sandflow + 10,
      20,
      0,
      164,
      blitters.blitters_10h_transp,
      0
    );
  }
  if (hourglass_state) {
    add_midtable(
      chtabs.id_chtab_8_princessroom,
      hourglass_state + 2,
      19,
      0,
      168,
      blitters.blitters_10h_transp,
      1
    );
  }
}
function reset_cutscene() {
  g.Guard.frame = 0;
  g.Kid.frame = 0;
  which_torch = 0;
  disable_keys = 0;
  hourglass_state = 0;
  hourglass_sandflow = -1;
  cutscene_frame_time = 6;
  clear_tile_wipes();
  next_sound = -1;
}
function do_flash(color) {
  if (color) scr.set_bg_attr(color);
}
function remove_flash() {
  scr.set_bg_attr(0);
}
function* fade_in_1() {
  scr.fade_start("in", FADE_CUTSCENE_ROWS, 0);
  while (scr.fade_active()) {
    yield* proc_cutscene_frame(1);
  }
}
function* fade_out_1() {
  scr.fade_start("out", FADE_CUTSCENE_ROWS, 0);
  while (scr.fade_active()) {
    yield* proc_cutscene_frame(1);
  }
}
var stars = [
  { x: 20, y: 97, color: 0 },
  { x: 16, y: 104, color: 1 },
  { x: 23, y: 110, color: 2 },
  { x: 17, y: 116, color: 3 },
  { x: 24, y: 120, color: 4 },
  { x: 18, y: 128, color: 0 }
];
var PROOM_RANDOM_RECTS = [
  [16, 97, 24, 128],
  [96, 99, 104, 115],
  [214, 99, 222, 115]
];
var PROOM_RANDOM_PIXELS = PROOM_RANDOM_RECTS.flatMap(([x0, y0, x1, y1]) => {
  const out2 = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out2.push([x, y]);
  return out2;
});
var N_STAR_COLORS = 5;
var star_colors = [8, 7, 15, 15, 7];
function draw_star(which_star, _mark_dirty) {
  const star = stars[which_star];
  star.color = (star.color + 1) % N_STAR_COLORS;
  scr.rect(star.x, star.y, star.x + 1, star.y + 1, star_colors[star.color]);
}
function draw_all_stars() {
  for (let current_star = 0; current_star < N_STARS; ++current_star) {
    draw_star(current_star, 0);
  }
}
function reset_stars() {
  const initial = [0, 1, 2, 3, 4, 0];
  for (let i = 0; i < stars.length; i++) stars[i].color = initial[i];
}
var tbl_cutscenes = [
  null,
  null,
  cutscene_2_6,
  null,
  cutscene_4,
  null,
  cutscene_2_6,
  null,
  cutscene_8,
  cutscene_9,
  null,
  null,
  cutscene_12,
  null,
  null,
  null
];
function frameTime() {
  return cutscene_frame_time;
}
function start_timer(length) {
  return scr.now() + length;
}
function* do_wait(deadline) {
  const left = deadline - scr.now();
  if (left > 0) yield left;
}
function* pop_wait(time) {
  yield* do_wait(start_timer(time));
}
function* fade_in_2(which_rows) {
  scr.fade_start("in", which_rows, 2);
  while (scr.fade_active()) yield 1;
}
function* fade_out_2(which_rows) {
  scr.fade_start("out", which_rows, 2);
  while (scr.fade_active()) yield 1;
}
function* transition_ltr() {
  for (let position = 0; position < 320; position += 2) {
    scr.copy_screen_rect(position, 0, position + 2, 200);
  }
  yield 0;
}
function* load_intro(which_imgs, func, _free_sounds) {
  scr.clear_screen();
  scr.clip_room(true);
  scr.load_intro_images(which_imgs);
  scr.target(true);
  scr.blit_image(chtabs.id_chtab_8_princessroom, 0, 0, 0, 0);
  scr.blit_image(chtabs.id_chtab_9_princessbed, 0, 0, 142, blitters.blitters_2_or);
  draw_all_stars();
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  reset_cutscene();
  yield* func();
  scr.free_intro_images();
  scr.clip_room(false);
  scr.clear_screen();
}
function* end_sequence() {
  let color = 0;
  let bgcolor = 15;
  yield* load_intro(1, end_sequence_anim, 1);
  scr.clear_screen_and_sounds();
  out.play_sound(soundids.sound_56_ending_music);
  scr.load_title_images(0);
  scr.target(true);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_HAIL);
  yield* fade_in_2(2048);
  yield* pop_wait(900);
  const timer = start_timer(240);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* transition_ltr();
  yield* do_wait(timer);
  let hof_index = 0;
  for (hof_index = 0; hof_index < hof_count; ++hof_index) {
    const entry = hof[hof_index];
    if (entry.min < g.rem_min || entry.min === g.rem_min && entry.tick < g.rem_tick) break;
  }
  if (hof_index < MAX_HOF_COUNT && hof_index <= hof_count) {
    yield* fade_out_2(4096);
    let i = 5;
    for (i = 5; hof_index + 1 <= i; --i) hof[i] = { ...hof[i - 1] };
    hof[i] = { name: "", min: g.rem_min, tick: g.rem_tick };
    if (hof_count < MAX_HOF_COUNT) ++hof_count;
    scr.draw_full_image(full_image_id.STORY_FRAME);
    scr.draw_full_image(full_image_id.HOF_POP);
    show_hof();
    const row = hof_rects[hof_index];
    const rect = {
      left: row.left - 4,
      top: row.top - 1,
      right: row.right - 40,
      bottom: row.bottom - 1
    };
    const peel = scr.read_peel(rect.left, rect.top, rect.right, rect.bottom);
    color = 190;
    bgcolor = 183;
    scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
    yield* fade_in_2(6144);
    scr.target(false);
    const buffer = { text: hof[hof_index].name };
    let typed = 0;
    do {
      typed = yield* input_str(rect, buffer, 24, "", 0, 4, color, bgcolor);
    } while (typed <= 0);
    hof[hof_index].name = buffer.text;
    scr.restore_peel(peel);
    show_hof_text(hof_rects[hof_index], -1, 0, hof[hof_index].name);
    hof_write();
    yield* pop_wait(120);
    scr.target(true);
    scr.draw_full_image(full_image_id.TITLE_MAIN);
    yield* transition_ltr();
  }
  while (out.check_sound_playing()) yield 1;
  yield* fade_out_2(4096);
  scr.release_title_images();
}
function* expired() {
  scr.clear_screen_and_sounds();
  yield* load_intro(1, time_expired, 1);
}
function* show_title() {
  scr.load_title_images(1);
  scr.target(true);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* fade_in_2(4096);
  scr.present();
  out.play_sound(soundids.sound_54_intro_music);
  let timer = start_timer(130);
  scr.draw_full_image(full_image_id.TITLE_PRESENTS);
  yield* do_wait(timer);
  timer = start_timer(205);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* do_wait(timer);
  timer = start_timer(65);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_GAME);
  yield* do_wait(timer);
  timer = start_timer(270);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* do_wait(timer);
  timer = start_timer(235);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_POP);
  scr.draw_full_image(full_image_id.TITLE_MECHNER);
  yield* do_wait(timer);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_ABSENCE);
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  out.play_sound(soundids.sound_55_story_1_absence);
  yield* transition_ltr();
  yield* pop_wait(600);
  yield* fade_out_2(2048);
  scr.release_title_images();
  yield* load_intro(0, pv_scene, 0);
  scr.load_title_images(1);
  scr.target(true);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_MARRY);
  yield* fade_in_2(2048);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_POP);
  scr.draw_full_image(full_image_id.TITLE_MECHNER);
  while (out.check_sound_playing()) yield 1;
  yield* transition_ltr();
  yield* pop_wait(120);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_CREDITS);
  yield* transition_ltr();
  yield* pop_wait(360);
  if (hof_count) {
    scr.draw_full_image(full_image_id.STORY_FRAME);
    scr.draw_full_image(full_image_id.HOF_POP);
    show_hof();
    yield* transition_ltr();
    yield* pop_wait(240);
  }
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  yield* fade_out_2(6144);
  scr.release_title_images();
}

// src/pop/cutscene.ts
var UNIT_MS = 1e3 / 60;
var HOF_STORAGE_KEY = "PRINCE.HOF";
var ROW = {
  sword: 2,
  flame: 3,
  kid: 7,
  princessInStory: 9,
  jaffarInStory: 10,
  title40: 11,
  title50: 12,
  princessRoom: 13,
  princessBed: 14
};
var FULL_IMAGE = [
  { id: 0, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 0, ypos: 0 },
  { id: 1, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 96, ypos: 106 },
  { id: 2, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 96, ypos: 122 },
  { id: 3, bank: 50, blit: blitters.blitters_10h_transp, xpos: 24, ypos: 107 },
  { id: 4, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 48, ypos: 184 },
  { id: 3, bank: 50, blit: blitters.blitters_10h_transp, xpos: 24, ypos: 24 },
  { id: 0, bank: 40, blit: blitters.blitters_0_no_transp, xpos: 0, ypos: 0 },
  { id: 1, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 2, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 3, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 4, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 26 }
];
var STORY_TEXT_COLOR = ROW.title40 * 16 + 15;
function blankLevel() {
  return {
    fg: new Uint8Array(24 * 30),
    bg: new Uint8Array(24 * 30),
    doorlinks1: new Uint8Array(256),
    doorlinks2: new Uint8Array(256),
    roomlinks: Array.from({ length: 24 }, () => ({ left: 0, right: 0, up: 0, down: 0 })),
    start_room: 1,
    start_pos: 0,
    start_dir: 0,
    guards_tile: new Uint8Array(24).fill(30),
    guards_dir: new Uint8Array(24),
    guards_x: new Uint8Array(24),
    guards_seq_lo: new Uint8Array(24),
    guards_skill: new Uint8Array(24),
    guards_seq_hi: new Uint8Array(24),
    guards_color: new Uint8Array(24)
  };
}
var CUTSCENE_FADE_RATE = { 6: 2, 7: 12 / 7 };
var CUTSCENE_FADE_SWEEP = Number(
  globalThis.process?.env?.POP_CUTSCENE_FADE_UNITS ?? ""
) || 0;
var CutscenePlayer = class _CutscenePlayer {
  /** `offscreen_surface`, where the picture is composed. */
  offscreen = new Surface();
  /** `onscreen_surface_`, which is what the page shows. */
  onscreen = new Surface();
  target = this.offscreen;
  palette = new ScreenPalette();
  banks = /* @__PURE__ */ new Map();
  title40;
  title50;
  /** The two halves of chtab 4: 850 in the story, 900 in a cutscene. */
  jaffarInStory;
  princessInCutscenes;
  vgaPalette;
  gen = null;
  pending = 0;
  owed = 0;
  elapsed = 0;
  fadeOwed = 0;
  clipRect = null;
  effects;
  scene = { kind: "title" };
  /** Palette rows mid-fade, and the ones to put back when it is over. */
  fade = null;
  /** The background colour `do_flash` took, put back by `remove_flash`. */
  savedBackground = null;
  /** `remove_flash` has been asked for and is owed the next frame. */
  flashPending = false;
  /** The sixtieths of `do_flash`'s own wait that are still to run. */
  flashOwed = 0;
  /** `delay_ticks(1)`: what `proc_cutscene_frame` waits with the colour up. */
  static FLASH_UNITS = 2;
  exe;
  /** The game's own font, out of the executable, for the hall of fame. */
  font;
  /**
   * The shell's text layer, or nothing at all.
   *
   * Undefined in every headless tool, so `scene-report.ts` compares
   * the original's own pictures with the original's own font. See
   * `src/render/text.ts`.
   */
  text;
  /** Which story screen is on the frame, so that a relabel can redraw it. */
  storyShowing = null;
  /** What the shell has typed and `input_str` has not taken yet. */
  keys = [];
  /** `SDL_StartTextInput()` is in, `SDL_StopTextInput()` is out. */
  textInput = false;
  constructor(exe, vgaPalette) {
    this.exe = exe;
    this.vgaPalette = vgaPalette;
  }
  static async create(assets, exe, effects, text2) {
    const constants = readExeConstants(exe);
    const player = new _CutscenePlayer(exe, constants.vgaPalette);
    player.effects = effects;
    player.text = text2;
    player.banks.set(
      chtabs.id_chtab_0_sword,
      await assets.group("PRINCE.DAT", 700, ROW.sword * 16)
    );
    player.banks.set(
      chtabs.id_chtab_1_flameswordpotion,
      await assets.group("PRINCE.DAT", 150, ROW.flame * 16)
    );
    player.banks.set(
      chtabs.id_chtab_2_kid,
      await assets.group("KID.DAT", 400, ROW.kid * 16)
    );
    player.banks.set(
      chtabs.id_chtab_3_princessinstory,
      await assets.group("PV.DAT", 800, ROW.princessInStory * 16)
    );
    player.jaffarInStory = await assets.group("PV.DAT", 850, ROW.jaffarInStory * 16);
    player.princessInCutscenes = await assets.group("PV.DAT", 900, ROW.jaffarInStory * 16);
    player.banks.set(
      chtabs.id_chtab_8_princessroom,
      await assets.group("PV.DAT", 950, ROW.princessRoom * 16)
    );
    player.banks.set(
      chtabs.id_chtab_9_princessbed,
      await assets.group("PV.DAT", 980, ROW.princessBed * 16)
    );
    player.title40 = await assets.group("TITLE.DAT", 40, ROW.title40 * 16);
    player.title50 = await assets.group("TITLE.DAT", 50, ROW.title50 * 16);
    player.font = readFont(exe);
    setScreen({
      hof_read_file: () => readHofFile(),
      hof_write_file: (bytes) => {
        writeHofFile(bytes);
      }
    });
    hof_read();
    return player;
  }
  /** `tbl_cutscenes[level]`: is there a scene before this level at all? */
  static hasCutsceneFor(level) {
    return tbl_cutscenes[level] != null;
  }
  get running() {
    return this.gen !== null;
  }
  /**
   * `input_str` is waiting for a name: every key belongs to it, and
   * none of them to the shell's own "a key skips the scene".
   */
  get wantsText() {
    return this.textInput;
  }
  /** A key the player pressed, for `key_test_quit()` to find. */
  pushKey(key, ch) {
    this.keys.push({ key, ch });
  }
  get playing() {
    return this.scene;
  }
  /**
   * A key during the title starts the game rather than skipping to
   * what comes next, which is what `process_key` does while
   * `start_level < 0`.
   */
  get skippable() {
    return this.scene.kind === "title";
  }
  /**
   * `disable_keys`: the scene will not let a key cut it short.
   *
   * `proc_cutscene_frame`'s loop is
   * `if (!disable_keys && do_paused()) { stop_sounds(); ...; return 1; }`
   * and `do_paused` returns `key || control_shift` -- so **any** key,
   * shift included, ends a scene. Only `end_sequence_anim` and
   * `time_expired` set the flag, which is the ending and the
   * hourglass; the title and all six scenes between the levels take
   * a key.
   *
   * The shell took Escape and nothing else, so the player sat
   * through every transition: "a long pause that cannot be skipped",
   * and it is not like that in the original.
   */
  get keysDisabled() {
    return keysDisabled() !== 0;
  }
  render() {
    return this.onscreen;
  }
  /**
   * Start one. `level` plays `tbl_cutscenes[level]` before that level
   * is loaded, exactly as `play_level` does.
   */
  begin(scene) {
    this.scene = scene;
    this.install();
    const body = () => {
      switch (scene.kind) {
        case "title":
          return show_title();
        case "ending":
          return end_sequence();
        case "expired":
          return expired();
        default: {
          const func = tbl_cutscenes[scene.level];
          if (!func) return (function* () {
          })();
          return load_intro(scene.level > 2 ? 1 : 0, func, 1);
        }
      }
    };
    this.gen = body();
    this.elapsed = 0;
    this.owed = 0;
    this.fadeOwed = 0;
    this.pending = 0;
    this.step();
  }
  /** Stop where it stands: a key during the title, or the page moving on. */
  cancel() {
    this.gen = null;
    this.fade = null;
  }
  /**
   * Run the clock on by `ms`. Answers whether the scene is still going.
   *
   * The fade is stepped **here**, off the wall clock, and not where
   * the generator finishes a wait. In the C it has a timer of its
   * own: `proc_cutscene_frame`'s inner busy loop calls
   * `proc_fade_frame` over and over until the cutscene frame's
   * `timer_0` has run out, and each of those spends `timer_1`, which
   * is two sixtieths. So a cutscene frame of six sixtieths holds
   * three shades, one after another, each on the screen for two.
   *
   * Stepping them where the generator yields put all three up at once
   * and left the screen still for the other two thirds of the frame.
   * The capture says which: the princess-room scene of the title
   * fades in over **fifty-three consecutive video frames, one change
   * each**, where the port changed every third frame.
   */
  advance(ms) {
    if (!this.gen) return false;
    if (this.flashPending && this.flashOwed <= 0) this.takeFlashDown();
    const units = ms / UNIT_MS;
    this.owed += units;
    this.fadeClock(units);
    let guard = 0;
    while (this.gen && this.owed >= this.pending && guard++ < 2e4) {
      this.owed -= this.pending;
      this.elapsed += this.pending;
      this.step();
    }
    if (this.flashPending) this.flashOwed -= units;
    return this.gen !== null;
  }
  /**
   * `remove_flash`, put off by the two sixtieths the C waits.
   *
   * `proc_cutscene_frame` sets the background colour, waits
   * `delay_ticks(1)` -- two sixtieths -- and puts it back, all inside
   * one cutscene frame. A driver that draws once a frame has nothing
   * in between to show that on, so the colour goes back once the
   * scene's own clock has run those two sixtieths on, which is the
   * next frame of a thirtieth-of-a-second replay and the frame after
   * that of a sixtieth one.
   *
   * It used to go back in `step()`, where the next frame is the next
   * **cutscene** frame, and Jaffar conjuring the hourglass in
   * `pv_scene` is the one place that shows: `cutscene_frame_time` is
   * 7 there and `flash_time` is 5, so the white stayed up for five
   * cutscene frames end to end. In the port's own video frames that
   * is **seventeen frames of white**, mean brightness 168 against
   * the room's 84 on every one of them (2104 to 2120 of the title).
   * The original blinks five times: a capture of it reads 84 on
   * every frame around them and 168 on two (the sixty-a-second grab
   * catches the two-sixtieth flash, `--untear` halves it back to
   * thirty, and three of the five fall in the half that goes).
   * `scene-report` title 586 -> 588.
   */
  takeFlashDown() {
    if (!this.flashPending) return;
    this.flashPending = false;
    if (this.savedBackground) {
      this.palette.setEntry(0, ...this.savedBackground);
      this.savedBackground = null;
    }
  }
  step() {
    const r = this.gen.next();
    if (r.done) {
      this.gen = null;
      this.pending = 0;
      return;
    }
    this.pending = r.value;
  }
  /**
   * The sixtieths that have gone by: the fade moves a shade every two.
   *
   * `make_pal_buffer_fadein` and `make_pal_buffer_fadeout` are both
   * given `wait_time` **2**, and `fade_in_frame` spends it round one
   * shade of the sixty-four -- `start_timer(timer_1, wait_time)` at
   * the top and `do_simple_wait(timer_1)` at the bottom. So a whole
   * fade is 128 sixtieths, which is 2.13 seconds and 64 frames of a
   * thirty-a-second capture. This stepped a shade per sixtieth and so
   * faded in half the time, which nothing in the repository could see
   * until the title screen was captured: the original's opening fade
   * occupies video frames 5 to 64 of that capture, sixty of them,
   * where the port's took thirty-two.
   *
   * Every fade in the game is the same two calls -- `fade_in_1` and
   * `fade_out_1` reach the same step through `proc_cutscene_frame`'s
   * inner busy loop -- which is why the arithmetic belongs here and
   * not in the four generators.
   *
   * ### The odd frames of a fade are the capture, not the game
   *
   * With this right, the port draws the capture's fade **exactly on
   * every even frame** and matches no odd one, all the way from 17 to
   * 63, and `tools/dev/scene-report.ts` reports the fade that way.
   * That is the grab catching the DAC half written. A step is two
   * sixtieths, 33.3ms, and the grab is thirty frames a second, 33.3ms:
   * the two beat together exactly, so one grab lands after
   * `set_pal_arr` has walked all sixteen entries of the row and the
   * next lands in the middle of it. The capture's odd frames have
   * some components of some entries advanced and others not -- at
   * (0,0) between frames 18 and 19 the green of one entry moves a DAC
   * unit and the red of the same entry does not, which no arithmetic
   * on a palette can produce and a half-finished write can.
   *
   * Two shades every four sixtieths was tried, because it fits that
   * one pixel's reading of 8, 8, 16, 16; it scores **92 of the
   * capture's 606 changes against 108**, and moves the alternation's
   * parity rather than removing it. It is not kept.
   */
  static FADE_UNITS = 2;
  /**
   * And the cutscene fade, which has no wait of its own.
   *
   * `make_pal_buffer_fadein` is given `wait_time` 2 by `fade_in_2`
   * and **0** by `fade_in_1` -- SDLPoP writes the second one
   * `/*0*\/ 2`, keeping the original's value in the comment beside
   * its own substitution. With nought there is no timer between two
   * shades, so what paces a cutscene's fade is not `wait_time` but
   * `proc_cutscene_frame`'s own loop:
   *
   *     do { ... proc_fade_frame(...) ... }
   *     while (!has_timer_stopped(timer_0));
   *
   * -- a `do..while`, so a cutscene frame of `cutscene_frame_time`
   * sixtieths fits **ceil(T / 2)** shades in, the last of them
   * started with one sixtieth still to run. At the six sixtieths
   * every scene but one uses that is three shades in six, which is
   * the two sixtieths a shade `fade_in_2` has anyway and is why the
   * six cutscenes never showed it. At **seven**, which `pv_scene`
   * switches to before Jaffar conjures, it is four shades in seven.
   *
   * The capture says the same thing without the arithmetic. One of
   * the title, grabbed at sixty and untorn, measures `pv_scene`'s
   * fade-out shade by shade against the port's own frames:
   *
   *     cap frame  2373 2374 2375 2376 2377 2378 2379 2380 ...
   *     shade         0    2    3    4    5    6    8    9
   *
   * -- 63 shades over 54 video frames, 1, 1, 1, 1, 1, 2 without a
   * break, which is 1.71 sixtieths a shade against this model's
   * 1.75; and the same capture's `fade_in_2` of the story screen
   * forty frames later steps one shade per video frame exactly,
   * which is `wait_time` 2. Two rates in one capture, from the two
   * `wait_time`s, and the port keeps both.
   *
   * Flat rates were swept and all of them lose, because they move
   * the six cutscenes' fades as well:
   *
   *     2 (every fade)        scenes 2029 of 2236
   *     1.7143 (every fade)          1818 of 2232
   *     1.75   (every fade)          1833 of 2230
   *     1.6667 (every fade)          1829 of 2221
   */
  cutsceneFadeUnits() {
    if (CUTSCENE_FADE_SWEEP) return CUTSCENE_FADE_SWEEP;
    const t = frameTime();
    return CUTSCENE_FADE_RATE[t] ?? t / Math.ceil(t / 2);
  }
  /** The `wait_time` the fade now running was started with. */
  fadeUnits = _CutscenePlayer.FADE_UNITS;
  fadeClock(units) {
    this.fadeOwed += units;
    while (this.fadeOwed >= this.fadeUnits) {
      this.fadeOwed -= this.fadeUnits;
      this.fadeStep();
    }
  }
  // -- everything below is what `screen.ts` and `seg008.ts` ask for ----------
  install() {
    link();
    g.Kid = newChar();
    g.Guard = newChar();
    g.Char = newChar();
    g.Opp = newChar();
    g.level = blankLevel();
    g.drawn_room = 1;
    g.room_L = 0;
    g.room_R = 0;
    g.room_A = 0;
    g.room_B = 0;
    g.room_AL = 0;
    g.room_AR = 0;
    g.room_BL = 0;
    g.room_BR = 0;
    g.is_blind_mode = 0;
    g.upside_down = 0;
    g.flash_time = 0;
    g.flash_color = 0;
    this.savedBackground = null;
    this.flashPending = false;
    this.flashOwed = 0;
    this.fade = null;
    this.roomOnly = false;
    free_peels();
    reset_tables();
    reset_stars();
    const tables = readExeTables(this.exe);
    setFrameTables(
      tables.frameTableKid,
      tables.frameTableGuard,
      tables.frameTableCutscene,
      tables.sequences,
      Array.from(tables.sequenceOffsets)
    );
    g.chtab_addrs = Array.from({ length: 10 }, (_, i) => {
      const set = this.banks.get(i);
      return set ? set.images.slice(1) : null;
    });
    this.palette.loadBlock(0, this.vgaPalette);
    for (const set of this.banks.values()) {
      this.palette.loadBlock(set.paletteBase, set.palette.vga);
    }
    out.play_sound = (which) => {
      g.current_sound = which;
      this.effects?.sound?.(which);
    };
    out.stop_sounds = () => {
      this.effects?.stopSounds?.();
    };
    out.check_sound_playing = () => this.effects?.soundPlaying?.() ? 1 : 0;
    setPainter({
      image: (chtab, id) => this.imageOf(chtab, id),
      blit: (chtab, id, x, y, blit) => this.blitSprite(chtab, id, x, y, blit),
      rect: (left, top, right, bottom, color) => {
        if (bottom > top) this.target.fillRect(left, top, right - left, bottom - top, color);
      },
      clip: (rect) => this.setClip(rect),
      text: () => {
      },
      readPeel: (left, top, right, bottom) => this.readPeel(left, top, right, bottom),
      restorePeel: (peel) => this.restorePeel(peel),
      target: (offscreen) => {
        this.target = offscreen ? this.offscreen : this.onscreen;
        this.setClip(this.clipRect);
      }
    });
    setScreen({
      copy_screen_rect: (l, t, r, b) => this.copyRect(l, t, r, b),
      present: () => this.copyRect(0, 0, 320, 200),
      /**
       * `load_intro` asks for the clip; only a scene played **before
       * a level** gets it.
       *
       * Three captures, three answers, and nothing but the captures
       * decides this. Rows 192 to 199, right through the
       * princess-room scene:
       *
       *     show_title's own pv_scene    (152,96,88) -- the floor
       *     expired()'s hourglass        (152,96,88) -- the floor
       *     the scene before level 2     black on every frame
       *
       * and in the last of those they were the **only** rows that
       * differed from the port at all: rows 97 to 179 of the same
       * pair of frames differ by five pixels in all, and with the
       * clip in they are the same picture to the pixel.
       *
       * What differs is the buffer the room is composed in.
       * `show_title` frees the offscreen and makes its own
       * (`make_offscreen_buffer(&screen_rect)`), which is the whole
       * 320 by 200, so `TITLE.DAT`'s 320 by 200 images and the
       * princess room both reach the bottom. A scene played where
       * `play_level` plays one gets the game's own offscreen, which
       * is the 192-row gameplay buffer -- the same 192
       * `copy_screen_rect` mirrors about when the screen is upside
       * down, which `invert2` settled -- so the room image is
       * clipped at 191 and the eight rows under it keep the black
       * `load_intro` painted over the screen before it began. Why
       * `expired()`, which is reached from `show_time` in the middle
       * of a level, draws all two hundred is not accounted for; the
       * capture says it does.
       *
       * **`end_sequence` clips, and that is a capture and not a
       * guess.** It had never been captured when this was written.
       * It has now -- thirteen `shift+l` and then four `h`, because
       * `check_the_end` runs `end_sequence()` when the *drawn* room
       * of level 14 is 5 and `h` is what sets `next_room` -- and the
       * frames of the princess's room come out matching the port
       * everywhere above row 192 and differing on **every one of the
       * 320 pixels of rows 192 to 199**, which are black in the
       * capture and the floor of the room in the port. Frame for
       * frame, 2560 of the 3100 pixels that differed were those
       * eight rows. It is the same fault the six level cutscenes had
       * and the same cure, and it is a thing the player sees: the
       * end of the game is the one scene he has earned.
       */
      clip_room: (on) => {
        this.roomOnly = on && (this.scene.kind === "level" || this.scene.kind === "ending");
      },
      rect: (l, t, r, b, color) => {
        this.target.fillRect(l, t, r - l, b - t, color);
        if (this.text) this.aimed(() => this.text.noteFill(l, t, r, b, color));
      },
      clear_screen: () => {
        this.offscreen.clear(0);
        this.onscreen.clear(0);
        this.text?.clearOverlay();
        this.storyShowing = null;
      },
      clear_screen_and_sounds: () => {
        out.stop_sounds();
        this.offscreen.clear(0);
        this.onscreen.clear(0);
        this.text?.clearOverlay();
        this.storyShowing = null;
      },
      set_bg_attr: (color) => this.setBackground(color),
      fade_start: (dir, rows, waitTime) => this.fadeStart(dir, rows, waitTime),
      fade_active: () => this.fade !== null,
      blit_image: (chtab, id, x, y, blit) => this.blitSprite(chtab, id, x, y, blit),
      load_intro_images: (which) => this.loadIntroImages(which),
      free_intro_images: () => {
      },
      now: () => this.elapsed,
      draw_full_image: (id) => this.drawFullImage(id),
      load_title_images: (bgcolor) => this.loadTitleImages(bgcolor),
      release_title_images: () => {
      },
      target: (offscreen) => {
        this.target = offscreen ? this.offscreen : this.onscreen;
        this.setClip(this.clipRect);
      },
      show_text: (l, t, r, b, xa, ya, text2, color) => {
        if (this.text) {
          this.aimed(() => this.text.showText(this.target, text2, l, t, r, b, xa, ya, color));
          return;
        }
        if (!this.font) return;
        drawTextInRect(this.target, this.font, text2, l, t, r, b, xa, ya, color);
      },
      text_center_y: (t, b) => this.font ? textCenterY(this.font, t, b) : 0,
      char_width: (ch) => this.text ? this.text.charWidth(ch) : this.font ? charWidth(this.font, ch.charCodeAt(0)) : 0,
      cstring_width: (text2) => this.text ? this.text.cstringWidth(text2) : this.font ? lineWidth(this.font, text2) : 0,
      draw_text_character: (x, y, ch, color) => {
        if (this.text) {
          return this.aimed(() => this.text.drawChar(this.target, x, y, ch, color));
        }
        return this.font ? drawTextCharacter(this.target, this.font, ch.charCodeAt(0), x, y, color) : 0;
      },
      read_peel: (l, t, r, b) => this.readTargetPeel(l, t, r, b),
      restore_peel: (peel) => this.restoreTargetPeel(peel),
      start_text_input: (l, t, r, b) => {
        this.textInput = true;
        this.keys.length = 0;
        this.text?.beginTextInput(l, t, r, b);
      },
      stop_text_input: () => {
        this.textInput = false;
        this.keys.length = 0;
        this.text?.endTextInput();
      },
      take_key: () => this.keys.shift() ?? null,
      /**
       * `clear_kbd_buf()` is `last_key_scancode = last_text_input = 0`:
       * it drops the one key that was just read, which `take_key` has
       * already taken off the queue. Emptying the queue here instead
       * loses every key the player typed before the scene's clock next
       * ran, which on a page is most of a quickly typed name.
       */
      clear_kbd_buf: () => {
      },
      hof_read_file: () => readHofFile(),
      hof_write_file: (bytes) => {
        writeHofFile(bytes);
      }
    });
  }
  /**
   * `read_peel_from_screen` and `restore_peel`, which both work on
   * `current_target_surface`. The ending reads its peel off the
   * offscreen surface and puts it back on the onscreen one, which is
   * where `input_str` has just been drawing.
   */
  readTargetPeel(left, top, right, bottom) {
    const x0 = Math.max(0, Math.min(320, left));
    const x1 = Math.max(x0, Math.min(320, right));
    const y0 = Math.max(0, Math.min(200, top));
    const y1 = Math.max(y0, Math.min(200, bottom));
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      pixels.set(
        this.target.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width
      );
    }
    const words = this.text ? this.aimed(() => this.text.readPeelOverlay(x0, y0, x1, y1)) : void 0;
    return { left: x0, top: y0, width, height, pixels, words };
  }
  restoreTargetPeel(peel) {
    const p = peel;
    if (!p) return;
    for (let y = 0; y < p.height; y++) {
      this.target.pixels.set(
        p.pixels.subarray(y * p.width, (y + 1) * p.width),
        (p.top + y) * 320 + p.left
      );
    }
    const words = p.words;
    if (this.text) {
      this.aimed(() => this.text.restorePeelOverlay(
        p.left,
        p.top,
        p.left + p.width,
        p.top + p.height,
        words ?? []
      ));
    }
  }
  /**
   * `load_chtab_from_file(id_chtab_4_..., 50*which_imgs + 850, ...)`.
   *
   * The one bank a cutscene picks between: 850 is Jaffar for the
   * story the title tells, 900 the princess for every other scene.
   */
  loadIntroImages(which_imgs) {
    const set = which_imgs ? this.princessInCutscenes : this.jaffarInStory;
    if (!set) return;
    this.banks.set(chtabs.id_chtab_4_jaffarinstory_princessincutscenes, set);
    g.chtab_addrs[chtabs.id_chtab_4_jaffarinstory_princessincutscenes] = set.images.slice(1);
    this.palette.loadBlock(set.paletteBase, set.palette.vga);
  }
  /**
   * `load_title_images(bgcolor)`: the two banks of `TITLE.DAT`, and
   * the one colour the original pokes into the story bank by hand --
   * the frame's background, dark blue for the opening and dark red
   * for the ending.
   */
  loadTitleImages(bgcolor) {
    if (this.title40) this.palette.loadBlock(this.title40.paletteBase, this.title40.palette.vga);
    if (this.title50) this.palette.loadBlock(this.title50.paletteBase, this.title50.palette.vga);
    const at = ROW.title40 * 16 + 14;
    if (bgcolor) this.palette.setEntry(at, 4, 0, 24);
    else this.palette.setEntry(at, 32, 0, 0);
  }
  /**
   * Run one call of the text layer against the surface in hand.
   *
   * The layer keeps the screen's words and the offscreen's apart,
   * because a cutscene composes a picture offscreen and copies it
   * over a block later, so a word drawn now is on the screen from
   * the **copy**. The flag is set for the one call and always put
   * back, so a game that has one surface -- `PopGame`, which shares
   * this layer -- never inherits it.
   */
  aimed(fn) {
    const text2 = this.text;
    text2.drawingOffscreen = this.target === this.offscreen;
    try {
      return fn();
    } finally {
      text2.drawingOffscreen = false;
    }
  }
  // seg000:1DF8
  drawFullImage(id) {
    if (!this.text) {
      this.drawFullImageInner(id);
      return;
    }
    this.aimed(() => this.drawFullImageInner(id));
  }
  drawFullImageInner(id) {
    const spec = FULL_IMAGE[id];
    if (!spec) return;
    const bank = spec.bank === 40 ? this.title40 : this.title50;
    const image = bank?.images[spec.id + 1];
    if (!bank || !image) return;
    if (this.text) {
      if (id === full_image_id.STORY_FRAME || spec.blit === blitters.blitters_0_no_transp) {
        this.text.clearOverlayIn(
          spec.xpos,
          spec.ypos,
          spec.xpos + image.width,
          spec.ypos + image.height
        );
        this.storyShowing = null;
        this.titleShowing = null;
      }
      if (this.text.story(id)) {
        this.storyShowing = id;
        this.text.drawStory(this.target, id, STORY_TEXT_COLOR);
        return;
      }
      const card = this.text.titleCard(id);
      if (card) {
        if (card.keepRows > 0) {
          const savedBottom = this.target.clipBottom;
          this.target.clipBottom = Math.min(savedBottom, spec.ypos + card.keepRows);
          this.target.blitOpaqueBlack(image, spec.xpos, spec.ypos, bank.paletteBase);
          this.target.clipBottom = savedBottom;
        }
        this.titleShowing = id;
        this.text.drawTitleCard(
          this.target,
          id,
          spec.xpos,
          spec.ypos,
          spec.xpos + image.width,
          bank.paletteBase + 15
        );
        return;
      }
    }
    if (spec.blit === blitters.blitters_white) {
      this.target.blitMono(image, spec.xpos, spec.ypos, STORY_TEXT_COLOR);
    } else if (spec.blit === blitters.blitters_10h_transp) {
      this.target.blitTransparent(image, spec.xpos, spec.ypos, bank.paletteBase);
    } else {
      this.target.blitOpaqueBlack(image, spec.xpos, spec.ypos, bank.paletteBase);
    }
  }
  /**
   * Draw the story screen again, because the language or the quality
   * moved while it was on the screen.
   *
   * A scene paints into the offscreen surface and copies it over, so
   * which of the two holds the words depends on where in the scene the
   * player was when he opened the settings panel. Both are drawn: the
   * frame is the whole 320 by 200 and opaque, so redrawing it on each
   * costs nothing and the change is on the screen on the next frame
   * rather than at the next scene.
   */
  refreshText() {
    if (!this.text) return;
    const story = this.storyShowing;
    const title = this.titleShowing;
    if (story === null && title === null) return;
    const saved = this.target;
    for (const surface of [this.offscreen, this.onscreen]) {
      this.target = surface;
      if (story !== null) {
        this.drawFullImage(full_image_id.STORY_FRAME);
        this.drawFullImage(story);
      } else if (title !== null) {
        this.drawFullImage(full_image_id.TITLE_MAIN);
        this.drawFullImage(title);
      }
    }
    this.target = saved;
    this.storyShowing = story;
    this.titleShowing = title;
  }
  /** Which title card is on the screen, for a language change. */
  titleShowing = null;
  /** `method_1_blit_rect(onscreen_surface_, offscreen_surface, ...)`. */
  /** `clip_room`: a `load_intro` scene never reaches past row 191. */
  roomOnly = false;
  copyRect(left, top, right, bottom) {
    const x0 = Math.max(0, left);
    const x1 = Math.min(320, right);
    const y0 = Math.max(0, top);
    const y1 = Math.min(this.roomOnly ? 192 : 200, bottom);
    for (let y = y0; y < y1; y++) {
      this.onscreen.pixels.set(
        this.offscreen.pixels.subarray(y * 320 + x0, y * 320 + x1),
        y * 320 + x0
      );
    }
    this.text?.commitOverlay(x0, y0, x1, y1);
  }
  setBackground(color) {
    if (color === 0) {
      this.flashPending = this.savedBackground !== null;
      this.flashOwed = _CutscenePlayer.FLASH_UNITS;
      return;
    }
    if (!this.savedBackground) this.savedBackground = this.palette.entry(0);
    this.palette.setEntry(0, ...this.palette.entry(color));
  }
  // seg009:1A51 / seg009:1D28
  fadeStart(dir, rows, waitTime = 2) {
    this.fadeUnits = waitTime === 0 ? this.cutsceneFadeUnits() : waitTime;
    this.fadeOwed = 0;
    const original = this.palette.rgb6.slice();
    const faded = original.slice();
    this.copyRect(0, 0, 320, 200);
    if (dir === "in") {
      for (let row = 0; row < 16; row++) {
        if (!(rows & 1 << row)) continue;
        faded.fill(0, row * 16 * 3, (row * 16 + 16) * 3);
      }
      this.applyFade(faded, rows);
    }
    this.fade = { dir, rows, pos: dir === "in" ? 64 : 0, original, faded };
  }
  // seg009:1B88 / seg009:1DF7
  fadeStep() {
    const f = this.fade;
    if (!f) return;
    if (f.dir === "in") {
      --f.pos;
      for (let row = 0; row < 16; row++) {
        if (!(f.rows & 1 << row)) continue;
        for (let i = row * 16 * 3; i < (row * 16 + 16) * 3; i++) {
          if (f.original[i] > f.pos) ++f.faded[i];
        }
      }
      this.applyFade(f.faded, f.rows);
      if (f.pos === 0) {
        this.palette.loadBlock(0, this.rowsOf(f.original, 0, 256));
        this.fade = null;
        this.copyRect(0, 0, 320, 200);
      }
      return;
    }
    let finished = true;
    for (let row = 0; row < 16; row++) {
      if (!(f.rows & 1 << row)) continue;
      for (let i = row * 16 * 3; i < (row * 16 + 16) * 3; i++) {
        if (f.faded[i] !== 0) {
          --f.faded[i];
          finished = false;
        }
      }
    }
    this.applyFade(f.faded, f.rows);
    if (finished) {
      this.palette.loadBlock(0, this.rowsOf(f.original, 0, 256));
      this.fade = null;
      this.onscreen.clear(0);
      this.text?.clearShownOverlay();
    }
  }
  rowsOf(rgb6, from, count) {
    const outp = [];
    for (let i = from; i < from + count; i++) {
      outp.push({ r: rgb6[i * 3], g: rgb6[i * 3 + 1], b: rgb6[i * 3 + 2] });
    }
    return outp;
  }
  applyFade(faded, rows) {
    for (let row = 0; row < 16; row++) {
      if (!(rows & 1 << row)) continue;
      this.palette.loadBlock(row * 16, this.rowsOf(faded, row * 16, 16));
    }
  }
  imageOf(chtab, id) {
    return this.banks.get(chtab)?.images[id + 1] ?? null;
  }
  blitSprite(chtab, id, x, y, blit) {
    const bank = this.banks.get(chtab);
    const found = bank?.images[id + 1];
    if (!bank || !found) return;
    let sprite = found;
    const base = bank.paletteBase;
    if (blit & FLIPPED) {
      sprite = flipHorizontally(sprite);
      blit &= ~FLIPPED;
    }
    if (blit === blitters.blitters_9_black) this.target.blitMono(sprite, x, y, 0);
    else if (blit === blitters.blitters_3_xor) this.target.blitXor(sprite, x, y, base);
    else if (blit >= blitters.blitters_40h_mono) this.target.blitMono(sprite, x, y, blit & 15);
    else if (blit === blitters.blitters_2_or) this.target.blitOr(sprite, x, y, base);
    else if (blit === blitters.blitters_10h_transp) this.target.blitTransparent(sprite, x, y, base);
    else this.target.blitOpaqueBlack(sprite, x, y, base);
  }
  setClip(rect) {
    this.clipRect = rect;
    const s = this.target;
    s.clipTop = rect ? rect.top : 0;
    s.clipBottom = rect ? Math.min(rect.bottom, 200) : 200;
    s.clipLeft = rect ? rect.left : 0;
    s.clipRight = rect ? rect.right : 320;
  }
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
        this.offscreen.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width
      );
    }
    return { left: x0, top: y0, width, height, pixels };
  }
  restorePeel(peel) {
    for (let y = 0; y < peel.height; y++) {
      this.offscreen.pixels.set(
        peel.pixels.subarray(y * peel.width, (y + 1) * peel.width),
        (peel.top + y) * 320 + peel.left
      );
    }
  }
};
function readHofFile() {
  try {
    const stored = globalThis.localStorage?.getItem(HOF_STORAGE_KEY);
    if (stored == null) return null;
    const binary = atob(stored);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}
function writeHofFile(bytes) {
  try {
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    globalThis.localStorage?.setItem(HOF_STORAGE_KEY, btoa(binary));
  } catch {
  }
}

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

// src/dat/potion-level.ts
var POTION_LEVEL_NUMBER = 2;
var POTION_KIND = {
  heal: 1,
  life: 2,
  feather: 3,
  inversion: 4,
  hurt: 5,
  open: 6
};
var W = 20;
var F = 1;
var P = 10;
var ROOMS = [
  // Room 1: the wall at column 0 stops him walking out of the left of
  // the level, and columns 7, 8 and 9 are the run into room 2.
  {
    fg: [
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      F,
      P,
      F,
      P,
      F,
      P,
      F,
      F,
      F,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W
    ],
    bg: {
      12: POTION_KIND.hurt,
      // row 1 column 2
      14: POTION_KIND.heal,
      // row 1 column 4
      16: POTION_KIND.life
      // row 1 column 6
    }
  },
  // Room 2: the corridor carries on from room 1's column 9 into this
  // room's column 0, and the wall at column 9 is the far end.
  {
    fg: [
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      F,
      P,
      F,
      P,
      F,
      P,
      F,
      F,
      F,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W,
      W
    ],
    bg: {
      11: POTION_KIND.feather,
      // row 1 column 1
      13: POTION_KIND.inversion,
      // row 1 column 3
      15: POTION_KIND.open
      // row 1 column 5
    }
  }
];
var POTION_PLACES = ROOMS.flatMap((spec, i) => Object.entries(spec.bg).map(([pos, kind]) => ({
  name: Object.keys(POTION_KIND).find((k) => POTION_KIND[k] === kind),
  kind,
  room: i + 1,
  row: Math.floor(Number(pos) / 10),
  column: Number(pos) % 10
})));
var START_ROOM = 1;
var START_POS = 11;
var START_DIR = 0;
var NO_GUARD_TILE = 30;
var OFF_FG2 = 0;
var OFF_BG2 = 720;
var OFF_DOORLINKS12 = 1440;
var OFF_DOORLINKS22 = 1696;
var OFF_ROOMLINKS2 = 1952;
var OFF_USED_ROOMS2 = 2048;
var OFF_ROOM_XS2 = 2049;
var OFF_ROOM_YS2 = 2073;
var OFF_START_ROOM2 = 2112;
var OFF_START_POS2 = 2113;
var OFF_START_DIR2 = 2114;
var OFF_GUARDS2 = 2119;
function potionLevelPayload() {
  const d = new Uint8Array(LEVEL_PAYLOAD_SIZE);
  for (let room = 0; room < ROOMS.length; room++) {
    const spec = ROOMS[room];
    for (let pos = 0; pos < TILES_PER_ROOM; pos++) {
      const i = room * TILES_PER_ROOM + pos;
      d[OFF_FG2 + i] = spec.fg[pos];
      d[OFF_BG2 + i] = spec.bg[pos] ?? 0;
    }
  }
  for (let i = ROOMS.length * TILES_PER_ROOM; i < LEVEL_TILE_COUNT; i++) {
    d[OFF_FG2 + i] = 0;
    d[OFF_BG2 + i] = 0;
  }
  d[OFF_ROOMLINKS2 + 0 * 4 + 1] = 2;
  d[OFF_ROOMLINKS2 + 1 * 4 + 0] = 1;
  d.fill(255, OFF_DOORLINKS12, OFF_DOORLINKS12 + 256);
  d.fill(0, OFF_DOORLINKS22, OFF_DOORLINKS22 + 256);
  d[OFF_USED_ROOMS2] = ROOMS.length;
  d[OFF_ROOM_XS2 + 0] = 1;
  d[OFF_ROOM_YS2 + 0] = 1;
  d[OFF_ROOM_XS2 + 1] = 2;
  d[OFF_ROOM_YS2 + 1] = 1;
  d[OFF_START_ROOM2] = START_ROOM;
  d[OFF_START_POS2] = START_POS;
  d[OFF_START_DIR2] = START_DIR & 255;
  for (let i = 0; i < ROOM_COUNT; i++) d[OFF_GUARDS2 + i] = NO_GUARD_TILE;
  return d;
}
function levelsDatWithPotionLevel(bytes) {
  const out2 = bytes.slice();
  const dv = new DataView(out2.buffer, out2.byteOffset, out2.byteLength);
  const indexOffset = dv.getUint32(0, true);
  const count = dv.getUint16(indexOffset, true);
  const want = resourceIdOfLevel(POTION_LEVEL_NUMBER);
  for (let i = 0, p = indexOffset + 2; i < count; i++, p += 8) {
    if (dv.getUint16(p, true) !== want) continue;
    const offset = dv.getUint32(p + 2, true);
    const size = dv.getUint16(p + 6, true);
    const payload = potionLevelPayload().subarray(0, size);
    out2.set(payload, offset + 1);
    let sum = 0;
    for (const b of payload) sum = sum + b & 255;
    out2[offset] = 255 - sum & 255;
    return out2;
  }
  throw new Error(`LEVELS.DAT has no resource ${want}`);
}

// src/dat/fourd-level.ts
var FOURD_FIRST = 2e3;
var FOURD_LAST = 2010;
function levelsDatWithFourD(original, kirill) {
  const out2 = original.slice();
  const dst = new DatFile(out2, "LEVELS.DAT");
  const src = new DatFile(kirill, "KIRILL.DAT");
  let taken = 0;
  for (let id = FIRST_LEVEL_RESOURCE; id <= LAST_LEVEL_RESOURCE; id++) {
    if (id < FOURD_FIRST || id > FOURD_LAST) continue;
    const from = src.entries.find((e) => e.id === id && e.size > 0);
    const to = dst.entries.find((e) => e.id === id);
    if (!from || !to || from.size !== to.size) continue;
    out2.set(kirill.subarray(from.offset, from.offset + 1 + from.size), to.offset);
    taken++;
  }
  if (taken === 0) throw new Error("KIRILL.DAT: no level record could be used");
  return out2;
}

// web/settings.ts
var DEFAULTS = {
  language: "en",
  quality: "original",
  graphics: "original",
  music: "original",
  map: "original",
  aspect: "original-4-3"
};
var CHOICES = {
  language: ["en", "he"],
  quality: ["original", "high"],
  graphics: ["original", "1.4"],
  music: ["original", "1.3"],
  map: ["original", "4d"],
  aspect: ["original-4-3", "square-pixels"]
};
var KEY = "prince.settings.v1";
function clean(raw) {
  const out2 = { ...DEFAULTS };
  if (typeof raw !== "object" || raw === null) return out2;
  const given = raw;
  for (const key of Object.keys(DEFAULTS)) {
    const allowed = CHOICES[key];
    const value = given[key];
    if (typeof value === "string" && allowed.includes(value)) {
      out2[key] = value;
    }
  }
  return out2;
}
var SettingsStore = class {
  value;
  listeners = /* @__PURE__ */ new Set();
  constructor(initial) {
    this.value = clean({ ...read(), ...initial });
  }
  get all() {
    return this.value;
  }
  get(key) {
    return this.value[key];
  }
  /** Returns true when the value really moved. */
  set(key, value) {
    const allowed = CHOICES[key];
    if (!allowed.includes(value)) return false;
    if (this.value[key] === value) return false;
    this.value = { ...this.value, [key]: value };
    write(this.value);
    for (const listener of this.listeners) listener(this.value, key);
    return true;
  }
  /** Called with the whole settings object and the key that moved. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
};
function read() {
  try {
    const text2 = window.localStorage.getItem(KEY);
    return text2 === null ? {} : JSON.parse(text2);
  } catch {
    return {};
  }
}
function write(value) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
  }
}

// web/strings.ts
var EN = {
  dir: "ltr",
  title: "Prince of Persia",
  subtitle: "The 1990 DOS game, rebuilt to run here \u2014 reading the original\u2019s own data files and the tables inside its executable.",
  start: "Begin",
  settings: "Settings",
  tools: "Tools",
  close: "Close",
  language: "Language",
  quality: "Quality",
  graphics: "Graphics",
  music: "Music",
  map: "Map",
  aspect: "Pixels",
  languageEn: "English",
  languageHe: "\u05E2\u05D1\u05E8\u05D9\u05EA",
  qualityOriginal: "Original",
  qualityHigh: "High",
  original: "Original",
  mapOriginal: "The game's own",
  map4d: "4-D Prince of Persia (1994)",
  graphicsOriginal: "As released (1.0)",
  graphics14: "Version 1.4",
  musicOriginal: "As released (1.0)",
  music13: "Version 1.3",
  aspectCrt: "4:3, as on a CRT",
  aspectSquare: "Square",
  record: "Record keys",
  recordStop: "Stop and save",
  recordSaved: "Recording saved",
  saveGame: "Save",
  loadGame: "Load",
  saveGameFull: "Save game",
  loadGameFull: "Load game",
  slot: "Slot",
  empty: "empty",
  saved: "Game saved",
  loaded: "Game loaded",
  noSave: "Nothing saved there",
  deleteSlot: "Erase",
  pressAnyKey: "press any key to begin",
  skipScene: "press Escape to skip",
  hourUp: "the hour is up \u2014 press any key",
  pausedLine: "paused \u2014 press any key",
  demoLine: "the demo \u2014 press any key to play",
  againLine: "press any key to begin the level again",
  lookingLine: "looking around; press a key to play",
  controls: "arrow keys or the numeric keypad to move, up to jump; hold shift to step carefully and to keep hold of a ledge, then up again to climb it",
  levelN: "level {n}",
  theDemo: "the demo",
  roomN: "room {n}",
  titleScreen: "title screen",
  potionRoom: "the potion room",
  potionTitle: "Potions",
  potionHp: "hit points",
  potionFeather: "feather",
  potionUpside: "upside down",
  potionRoomRow: "room",
  potionYes: "yes",
  potionNo: "no",
  potionOf: "{n} of {m}",
  potionHow: "Walk up to a flask and press Shift to drink it. The corridor runs hurt, heal, life, feather, upside-down, and the one that opens the gates. Ctrl+A lays them all out afresh.",
  loading: "loading the game\u2019s data files\u2026",
  pressToBegin: "press any key to begin",
  keysTitle: "Keys",
  keys: [
    ["Arrows", "move; a corner jumps that way"],
    ["Shift", "step carefully, hold a ledge"],
    ["Up, running", "a running jump"],
    ["Space", "the time left"],
    ["Esc", "pause, again for one tick"],
    ["Ctrl+A", "begin the level again"],
    ["Ctrl+R", "back to the title"],
    ["Ctrl+S", "sound off and on"],
    ["Shift+L", "skip a level"],
    ["R", "raise a fallen Prince"],
    ["K", "fell the guard"],
    ["Shift+T", "a flask"],
    ["Shift+S", "a hit point"],
    ["Shift+W", "the feather"],
    ["Shift+I", "turn the screen over"],
    ["Shift+B", "put the lights out"],
    ["+ / \u2212", "move the clock"],
    ["H J U N", "look at the rooms around"],
    ["Ctrl+B", "come back"]
  ]
};
var HE = {
  dir: "rtl",
  title: "\u05E0\u05E1\u05D9\u05DA \u05E4\u05E8\u05E1",
  subtitle: "\u05DE\u05E9\u05D7\u05E7 \u05D4\u05D3\u05D5\u05E1 \u05DE\u05E9\u05E0\u05EA 1990, \u05D1\u05E0\u05D5\u05D9 \u05DE\u05D7\u05D3\u05E9 \u05DB\u05D3\u05D9 \u05DC\u05E8\u05D5\u05E5 \u05DB\u05D0\u05DF \u2014 \u05E7\u05D5\u05E8\u05D0 \u05D0\u05EA \u05E7\u05D5\u05D1\u05E6\u05D9 \u05D4\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D4\u05DE\u05E7\u05D5\u05E8\u05D9\u05D9\u05DD \u05D5\u05D0\u05EA \u05D4\u05D8\u05D1\u05DC\u05D0\u05D5\u05EA \u05E9\u05D1\u05EA\u05D5\u05DA \u05E7\u05D5\u05D1\u05E5 \u05D4\u05D4\u05E8\u05E6\u05D4 \u05E9\u05DC\u05D5.",
  start: "\u05D4\u05EA\u05D7\u05DC\u05D4",
  settings: "\u05D4\u05D2\u05D3\u05E8\u05D5\u05EA",
  tools: "\u05DB\u05DC\u05D9\u05DD",
  close: "\u05E1\u05D2\u05D9\u05E8\u05D4",
  language: "\u05E9\u05E4\u05D4",
  quality: "\u05D0\u05D9\u05DB\u05D5\u05EA",
  graphics: "\u05D2\u05E8\u05E4\u05D9\u05E7\u05D4",
  music: "\u05DE\u05D5\u05D6\u05D9\u05E7\u05D4",
  map: "\u05DE\u05E4\u05D4",
  aspect: "\u05E4\u05D9\u05E7\u05E1\u05DC\u05D9\u05DD",
  languageEn: "English",
  languageHe: "\u05E2\u05D1\u05E8\u05D9\u05EA",
  qualityOriginal: "\u05DE\u05E7\u05D5\u05E8\u05D9\u05EA",
  qualityHigh: "\u05D2\u05D1\u05D5\u05D4\u05D4",
  original: "\u05DE\u05E7\u05D5\u05E8\u05D9\u05EA",
  mapOriginal: "\u05E9\u05DC \u05D4\u05DE\u05E9\u05D7\u05E7 \u05E2\u05E6\u05DE\u05D5",
  map4d: "4-D Prince of Persia (1994)",
  graphicsOriginal: "\u05DB\u05E4\u05D9 \u05E9\u05D9\u05E6\u05D0 (1.0)",
  graphics14: "\u05D2\u05E8\u05E1\u05D4 1.4",
  musicOriginal: "\u05DB\u05E4\u05D9 \u05E9\u05D9\u05E6\u05D0 (1.0)",
  music13: "\u05D2\u05E8\u05E1\u05D4 1.3",
  aspectCrt: "4:3, \u05DB\u05DE\u05D5 \u05D1\u05DE\u05E1\u05DA \u05E7\u05EA\u05D5\u05D3\u05D9",
  aspectSquare: "\u05DE\u05E8\u05D5\u05D1\u05E2\u05D9\u05DD",
  record: "\u05D4\u05E7\u05DC\u05D8\u05EA \u05DE\u05E7\u05E9\u05D9\u05DD",
  recordStop: "\u05E2\u05E6\u05D9\u05E8\u05D4 \u05D5\u05E9\u05DE\u05D9\u05E8\u05D4",
  recordSaved: "\u05D4\u05D4\u05E7\u05DC\u05D8\u05D4 \u05E0\u05E9\u05DE\u05E8\u05D4",
  saveGame: "\u05E9\u05DE\u05D9\u05E8\u05D4",
  loadGame: "\u05D8\u05E2\u05D9\u05E0\u05D4",
  saveGameFull: "\u05E9\u05DE\u05D9\u05E8\u05EA \u05DE\u05E9\u05D7\u05E7",
  loadGameFull: "\u05D8\u05E2\u05D9\u05E0\u05EA \u05DE\u05E9\u05D7\u05E7",
  slot: "\u05DE\u05E9\u05D1\u05E6\u05EA",
  empty: "\u05E8\u05D9\u05E7\u05D4",
  saved: "\u05D4\u05DE\u05E9\u05D7\u05E7 \u05E0\u05E9\u05DE\u05E8",
  loaded: "\u05D4\u05DE\u05E9\u05D7\u05E7 \u05E0\u05D8\u05E2\u05DF",
  noSave: "\u05D0\u05D9\u05DF \u05E9\u05DD \u05E9\u05DE\u05D9\u05E8\u05D4",
  deleteSlot: "\u05DE\u05D7\u05D9\u05E7\u05D4",
  pressAnyKey: "\u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC",
  skipScene: "\u05D4\u05E7\u05D9\u05E9\u05D5 Esc \u05DB\u05D3\u05D9 \u05DC\u05D3\u05DC\u05D2",
  hourUp: "\u05D4\u05E9\u05E2\u05D4 \u05EA\u05DE\u05D4 \u2014 \u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5",
  pausedLine: "\u05DE\u05D5\u05E9\u05D4\u05D4 \u2014 \u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5",
  demoLine: "\u05D4\u05D4\u05D3\u05D2\u05DE\u05D4 \u2014 \u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5 \u05DB\u05D3\u05D9 \u05DC\u05E9\u05D7\u05E7",
  againLine: "\u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC \u05D0\u05EA \u05D4\u05E9\u05DC\u05D1 \u05DE\u05D7\u05D3\u05E9",
  lookingLine: "\u05DE\u05D1\u05D9\u05D8\u05D9\u05DD \u05E1\u05D1\u05D9\u05D1; \u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05D3\u05D9 \u05DC\u05D7\u05D6\u05D5\u05E8 \u05DC\u05E9\u05D7\u05E7",
  controls: "\u05D7\u05D9\u05E6\u05D9\u05DD \u05D0\u05D5 \u05D4\u05DE\u05E7\u05DC\u05D3\u05EA \u05D4\u05E1\u05E4\u05E8\u05EA\u05D9\u05EA \u05DC\u05EA\u05E0\u05D5\u05E2\u05D4, \u05DC\u05DE\u05E2\u05DC\u05D4 \u05DC\u05E7\u05E4\u05D9\u05E6\u05D4; \u05D4\u05D7\u05D6\u05D9\u05E7\u05D5 Shift \u05DC\u05E6\u05E2\u05D9\u05D3\u05D4 \u05D6\u05D4\u05D9\u05E8\u05D4 \u05D5\u05DC\u05D0\u05D7\u05D9\u05D6\u05D4 \u05D1\u05E7\u05E6\u05D4, \u05D5\u05D0\u05D6 \u05E9\u05D5\u05D1 \u05DC\u05DE\u05E2\u05DC\u05D4 \u05DB\u05D3\u05D9 \u05DC\u05D8\u05E4\u05E1",
  levelN: "\u05E9\u05DC\u05D1 {n}",
  theDemo: "\u05D4\u05D4\u05D3\u05D2\u05DE\u05D4",
  roomN: "\u05D7\u05D3\u05E8 {n}",
  titleScreen: "\u05DE\u05E1\u05DA \u05D4\u05E4\u05EA\u05D9\u05D7\u05D4",
  potionRoom: "\u05D7\u05D3\u05E8 \u05D4\u05E9\u05D9\u05E7\u05D5\u05D9\u05D9\u05DD",
  potionTitle: "\u05E9\u05D9\u05E7\u05D5\u05D9\u05D9\u05DD",
  potionHp: "\u05E0\u05E7\u05D5\u05D3\u05D5\u05EA \u05D7\u05D9\u05D9\u05DD",
  potionFeather: "\u05E0\u05D5\u05E6\u05D4",
  potionUpside: "\u05D4\u05D9\u05E4\u05D5\u05DA",
  potionRoomRow: "\u05D7\u05D3\u05E8",
  potionYes: "\u05DB\u05DF",
  potionNo: "\u05DC\u05D0",
  potionOf: "{n} \u05DE\u05EA\u05D5\u05DA {m}",
  potionHow: "\u05D2\u05E9\u05D5 \u05D0\u05DC \u05D4\u05DB\u05D3 \u05D5\u05D4\u05E7\u05D9\u05E9\u05D5 Shift \u05DB\u05D3\u05D9 \u05DC\u05E9\u05EA\u05D5\u05EA. \u05D4\u05DE\u05E1\u05D3\u05E8\u05D5\u05DF \u05DE\u05E1\u05D5\u05D3\u05E8: \u05E4\u05D2\u05D9\u05E2\u05D4, \u05E8\u05D9\u05E4\u05D5\u05D9, \u05E0\u05E7\u05D5\u05D3\u05EA \u05D7\u05D9\u05D9\u05DD, \u05E0\u05D5\u05E6\u05D4, \u05D4\u05D9\u05E4\u05D5\u05DA, \u05D5\u05D4\u05E9\u05D9\u05E7\u05D5\u05D9 \u05E9\u05E4\u05D5\u05EA\u05D7 \u05D0\u05EA \u05D4\u05E9\u05E2\u05E8\u05D9\u05DD. Ctrl+A \u05E4\u05D5\u05E8\u05E1 \u05D0\u05EA \u05DB\u05D5\u05DC\u05DD \u05DE\u05D7\u05D3\u05E9.",
  loading: "\u05D8\u05D5\u05E2\u05DF \u05D0\u05EA \u05E7\u05D5\u05D1\u05E6\u05D9 \u05D4\u05DE\u05E9\u05D7\u05E7\u2026",
  pressToBegin: "\u05D4\u05E7\u05D9\u05E9\u05D5 \u05DE\u05E7\u05E9 \u05DB\u05DC\u05E9\u05D4\u05D5 \u05DB\u05D3\u05D9 \u05DC\u05D4\u05EA\u05D7\u05D9\u05DC",
  keysTitle: "\u05DE\u05E7\u05E9\u05D9\u05DD",
  keys: [
    ["\u05D7\u05D9\u05E6\u05D9\u05DD", "\u05EA\u05E0\u05D5\u05E2\u05D4; \u05DE\u05E7\u05E9 \u05E4\u05D9\u05E0\u05EA\u05D9 \u05E7\u05D5\u05E4\u05E5 \u05DC\u05D0\u05D5\u05EA\u05D5 \u05DB\u05D9\u05D5\u05D5\u05DF"],
    ["Shift", "\u05E6\u05E2\u05D9\u05D3\u05D4 \u05D6\u05D4\u05D9\u05E8\u05D4 \u05D5\u05D0\u05D7\u05D9\u05D6\u05D4 \u05D1\u05E7\u05E6\u05D4"],
    ["\u05DC\u05DE\u05E2\u05DC\u05D4 \u05D1\u05E8\u05D9\u05E6\u05D4", "\u05E7\u05E4\u05D9\u05E6\u05EA \u05E8\u05D9\u05E6\u05D4"],
    ["\u05E8\u05D5\u05D5\u05D7", "\u05D4\u05D6\u05DE\u05DF \u05E9\u05E0\u05D5\u05EA\u05E8"],
    ["Esc", "\u05D4\u05E9\u05D4\u05D9\u05D4, \u05D5\u05E9\u05D5\u05D1 \u05DC\u05E6\u05E2\u05D3 \u05D0\u05D7\u05D3"],
    ["Ctrl+A", "\u05D4\u05EA\u05D7\u05DC\u05EA \u05D4\u05E9\u05DC\u05D1 \u05DE\u05D7\u05D3\u05E9"],
    ["Ctrl+R", "\u05D7\u05D6\u05E8\u05D4 \u05DC\u05DE\u05E1\u05DA \u05D4\u05E4\u05EA\u05D9\u05D7\u05D4"],
    ["Ctrl+S", "\u05DB\u05D9\u05D1\u05D5\u05D9 \u05D5\u05D4\u05D3\u05DC\u05E7\u05EA \u05D4\u05E7\u05D5\u05DC"],
    ["Shift+L", "\u05D3\u05D9\u05DC\u05D5\u05D2 \u05E2\u05DC \u05E9\u05DC\u05D1"],
    ["R", "\u05D4\u05D7\u05D9\u05D9\u05D0\u05EA \u05D4\u05E0\u05E1\u05D9\u05DA"],
    ["K", "\u05D4\u05E4\u05DC\u05EA \u05D4\u05E9\u05D5\u05DE\u05E8"],
    ["Shift+T", "\u05DB\u05D3"],
    ["Shift+S", "\u05E0\u05E7\u05D5\u05D3\u05EA \u05D7\u05D9\u05D9\u05DD"],
    ["Shift+W", "\u05D4\u05E0\u05D5\u05E6\u05D4"],
    ["Shift+I", "\u05D4\u05D9\u05E4\u05D5\u05DA \u05D4\u05DE\u05E1\u05DA"],
    ["Shift+B", "\u05DB\u05D9\u05D1\u05D5\u05D9 \u05D4\u05D0\u05D5\u05E8\u05D5\u05EA"],
    ["+ / \u2212", "\u05D4\u05D6\u05D6\u05EA \u05D4\u05E9\u05E2\u05D5\u05DF"],
    ["H J U N", "\u05D4\u05E6\u05E6\u05D4 \u05DC\u05D7\u05D3\u05E8\u05D9\u05DD \u05D4\u05E1\u05DE\u05D5\u05DB\u05D9\u05DD"],
    ["Ctrl+B", "\u05D7\u05D6\u05E8\u05D4"]
  ]
};
function stringsFor(language) {
  return language === "he" ? HE : EN;
}

// web/savegame.ts
var SAVE_FORMAT = "prince-save";
var SAVE_VERSION = 1;
var FIELDS = [
  // the level
  "level",
  "checkpoint",
  "upside_down",
  "drawn_room",
  "current_level",
  "next_level",
  "mobs_count",
  "mobs",
  "trobs_count",
  "trobs",
  "leveldoor_open",
  // the Prince
  "Kid",
  "hitp_curr",
  "hitp_max",
  "hitp_beg_lev",
  "grab_timer",
  "holding_sword",
  "united_with_shadow",
  "have_sword",
  "kid_sword_strike",
  "pickup_obj_type",
  "offguard",
  // the guard
  "Guard",
  "Char",
  "Opp",
  "guardhp_curr",
  "guardhp_max",
  "demo_index",
  "demo_time",
  "guard_notice_timer",
  "guard_skill",
  "shadow_initialized",
  "guard_refrac",
  "justblocked",
  // collision
  "curr_row_coll_room",
  "curr_row_coll_flags",
  "below_row_coll_room",
  "below_row_coll_flags",
  "above_row_coll_room",
  "above_row_coll_flags",
  "prev_collision_row",
  // the flash
  "flash_color",
  "flash_time",
  // sounds
  "need_level1_music",
  "is_screaming",
  "is_feather_fall",
  // random
  "random_seed",
  // the hour
  "rem_min",
  "rem_tick",
  // the controls, saved and restored around a sword fight
  "control_x",
  "control_y",
  "control_shift",
  "control_forward",
  "control_backward",
  "control_up",
  "control_down",
  "control_shift2",
  "ctrl1_forward",
  "ctrl1_backward",
  "ctrl1_up",
  "ctrl1_down",
  "ctrl1_shift2",
  // what the guard has noticed
  "is_guard_notice",
  "can_guard_see_kid"
];
var STATICS = {
  curr_guard_color: { get: () => curr_guard_color, set: setGuardColor },
  droppedout: { get: () => droppedout, set: setDroppedout },
  last_loose_sound: { get: looseSound.get, set: looseSound.set }
};
function pack(value) {
  if (value instanceof Uint8Array) return { $: "u8", v: [...value] };
  if (value instanceof Int8Array) return { $: "i8", v: [...value] };
  if (value instanceof Int16Array) return { $: "i16", v: [...value] };
  if (Array.isArray(value)) return value.map(pack);
  if (typeof value === "object" && value !== null) {
    const out2 = {};
    for (const [k, v] of Object.entries(value)) out2[k] = pack(v);
    return out2;
  }
  return value;
}
function unpack(value) {
  if (Array.isArray(value)) return value.map(unpack);
  if (typeof value === "object" && value !== null) {
    const tagged = value;
    if (tagged.$ === "u8" && Array.isArray(tagged.v)) return Uint8Array.from(tagged.v);
    if (tagged.$ === "i8" && Array.isArray(tagged.v)) return Int8Array.from(tagged.v);
    if (tagged.$ === "i16" && Array.isArray(tagged.v)) return Int16Array.from(tagged.v);
    const out2 = {};
    for (const [k, v] of Object.entries(value)) out2[k] = unpack(v);
    return out2;
  }
  return value;
}
function snapshot() {
  const state = {};
  const live = g;
  for (const field of FIELDS) state[field] = pack(live[field]);
  for (const [name, slot2] of Object.entries(STATICS)) state[name] = slot2.get();
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: (/* @__PURE__ */ new Date()).toISOString(),
    level: g.current_level,
    minutesLeft: g.rem_min,
    hitPoints: g.hitp_curr,
    state
  };
}
function readable(save) {
  if (typeof save !== "object" || save === null) return false;
  const s = save;
  return s.format === SAVE_FORMAT && s.version === SAVE_VERSION && typeof s.state === "object" && s.state !== null;
}
function restore(save) {
  const live = g;
  for (const field of FIELDS) {
    if (!(field in save.state)) continue;
    live[field] = unpack(save.state[field]);
  }
  for (const [name, slot2] of Object.entries(STATICS)) {
    const value = save.state[name];
    if (typeof value === "number") slot2.set(value);
  }
  g.next_room = g.Kid.room;
  g.drawn_room = g.Kid.room;
  load_room_links();
  g.hitp_delta = 1;
  g.guardhp_delta = 1;
  if (g.Guard.room !== g.drawn_room) {
    g.Guard.direction = directions.dir_56_none;
    g.guardhp_curr = 0;
  }
  loadkid_and_opp();
  g.text_time_total = 0;
  g.text_time_remaining = 0;
  g.exit_room_timer = 0;
}
var SLOT_KEY = (n) => `prince.save.${n}`;
var SLOTS = [1, 2, 3];
function readSlot(n) {
  try {
    const text2 = window.localStorage.getItem(SLOT_KEY(n));
    if (text2 === null) return null;
    const parsed = JSON.parse(text2);
    return readable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function writeSlot(n, save) {
  try {
    window.localStorage.setItem(SLOT_KEY(n), JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

// web/chrome.ts
var OPENING_FIELDS = ["language", "quality", "graphics", "music", "map"];
var PANEL_FIELDS = ["language", "quality", "music", "aspect"];
var Chrome = class {
  settings;
  hooks;
  s;
  recording = false;
  noteTimer = 0;
  constructor(settings, hooks) {
    this.settings = settings;
    this.hooks = hooks;
    this.s = stringsFor(settings.get("language"));
    this.applyDirection();
    this.build();
    settings.onChange((_all, key) => {
      if (key === "language") {
        this.s = stringsFor(this.settings.get("language"));
        this.applyDirection();
        this.build();
      }
      if (key === "aspect") this.applyAspect();
    });
    this.applyAspect();
    if (document.getElementById("panel-potion")) {
      window.setInterval(() => this.potionReadout(), 100);
    }
  }
  /** Hebrew turns the page over: the title goes to the right-hand margin. */
  applyDirection() {
    const root = document.documentElement;
    root.lang = this.settings.get("language");
    root.dir = this.s.dir;
  }
  /** The shape of a pixel, which the canvas's width is worked out from. */
  applyAspect() {
    const square = this.settings.get("aspect") === "square-pixels";
    const root = document.documentElement;
    root.style.setProperty("--ar", square ? "320 / 200" : "4 / 3");
    root.style.setProperty("--ar-num", square ? "1.6" : "1.3333");
  }
  // ------------------------------------------------------------- building
  build() {
    this.buildMargin();
    this.buildOpening();
    this.buildPanels();
    this.buildPotion();
  }
  /**
   * `potion.html`'s extra panel, which `index.html` does not have.
   *
   * Its words used to be written into the page by
   * `tools/dev/build-pages.mjs`, with its readout an inline script --
   * so it was the one piece of the page that stayed English when the
   * language changed. The page now carries the ids and nothing else,
   * and the readout is `potionReadout` below, which reads `this.s`
   * every tenth of a second and so relabels itself.
   */
  buildPotion() {
    if (!document.getElementById("panel-potion")) return;
    text("potion-label", this.s.potionTitle);
    text("pl-label-hp", this.s.potionHp);
    text("pl-label-feather", this.s.potionFeather);
    text("pl-label-upside", this.s.potionUpside);
    text("pl-label-room", this.s.potionRoomRow);
    text("pl-how", this.s.potionHow);
  }
  /** The four numbers, in whichever language is current. */
  potionReadout() {
    const state = window.__princeState?.();
    if (!state) return;
    const yesNo = (on) => on ? this.s.potionYes : this.s.potionNo;
    text("pl-hp", this.s.potionOf.replace("{n}", String(state.hitPoints)).replace("{m}", String(state.maxHitPoints)));
    text("pl-feather", yesNo(state.featherFall));
    text("pl-upside", yesNo(state.upsideDown));
    text("pl-room", String(state.room));
  }
  /** `potion.html` is the same page with one level record swapped. */
  get isPotionPage() {
    return window.__princePotionLevel === true;
  }
  get pageTitle() {
    return this.isPotionPage ? `${this.s.title} \u2014 ${this.s.potionRoom}` : this.s.title;
  }
  /**
   * The title margin, which is a title and nothing else.
   *
   * Clause 2 of the specification is "drop all the current prose", and
   * the paragraph under the title was the last of it. It is still on
   * the opening page, where it introduces the game; on the game page
   * the margin is the name and the width it gives up goes to the
   * picture.
   */
  buildMargin() {
    text("page-title", this.pageTitle);
    text("keys-label", this.s.keysTitle);
    const keys = document.getElementById("keys");
    if (!keys) return;
    keys.replaceChildren();
    for (const [key, what] of this.s.keys) {
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = what;
      keys.append(dt, dd);
    }
  }
  buildOpening() {
    text("opening-title", this.pageTitle);
    text("opening-subtitle", this.s.subtitle);
    const fields = document.getElementById("opening-fields");
    if (fields) {
      fields.replaceChildren();
      for (const key of OPENING_FIELDS) fields.append(this.field(key));
    }
    const begin = document.getElementById("begin");
    if (begin) {
      begin.textContent = this.s.start;
      begin.onclick = () => {
        this.dismissOpening();
        this.hooks.begin();
      };
    }
  }
  /** The opening page is gone for this visit; the panels carry on from here. */
  dismissOpening() {
    const opening = document.getElementById("opening");
    if (opening) opening.hidden = true;
  }
  buildPanels() {
    text("settings-label", this.s.settings);
    text("tools-label", this.s.tools);
    const fields = document.getElementById("settings-fields");
    if (fields) {
      fields.replaceChildren();
      for (const key of PANEL_FIELDS) fields.append(this.field(key));
    }
    const record = document.getElementById("record");
    if (record) {
      record.textContent = this.recording ? this.s.recordStop : this.s.record;
      record.classList.toggle("on", this.recording);
      record.onclick = () => {
        record.blur();
        this.recording = this.hooks.toggleRecording();
        record.textContent = this.recording ? this.s.recordStop : this.s.record;
        record.classList.toggle("on", this.recording);
        if (!this.recording) this.note(this.s.recordSaved);
      };
    }
    this.buildSlots();
    text("tool-note", "");
  }
  /** Three slots, each with what is in it, a save and a load. */
  buildSlots() {
    const host = document.getElementById("save-slots");
    if (!host) return;
    host.replaceChildren();
    for (const n of SLOTS) {
      const row = document.createElement("div");
      row.className = "slot-row";
      const label = document.createElement("span");
      label.textContent = `${this.s.slot} ${n} \u2014 ${describe(readSlot(n), this.s)}`;
      label.title = label.textContent;
      const save = document.createElement("button");
      save.textContent = this.s.saveGame;
      save.title = `${this.s.saveGameFull} \u2014 ${this.s.slot} ${n}`;
      save.onclick = () => {
        save.blur();
        this.hooks.save(n);
      };
      const load = document.createElement("button");
      load.textContent = this.s.loadGame;
      load.title = `${this.s.loadGameFull} \u2014 ${this.s.slot} ${n}`;
      load.disabled = readSlot(n) === null;
      load.onclick = () => {
        load.blur();
        this.hooks.load(n);
      };
      row.append(label, save, load);
      host.append(row);
    }
  }
  /** A line under the tools that says what just happened, then clears. */
  note(message) {
    text("tool-note", message);
    window.clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => text("tool-note", ""), 2500);
  }
  get strings() {
    return this.s;
  }
  /** True while the Tools panel is recording. */
  get isRecording() {
    return this.recording;
  }
  // -------------------------------------------------------------- a field
  field(key) {
    const label = document.createElement("label");
    label.className = "field";
    const name = document.createElement("span");
    name.textContent = this.labelOf(key);
    const select = document.createElement("select");
    select.id = `setting-${key}`;
    const choices = CHOICES[key];
    for (const value of choices) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = this.optionOf(key, value);
      select.append(option);
    }
    select.value = this.settings.get(key);
    select.disabled = choices.length < 2;
    select.onchange = () => {
      const value = select.value;
      if (!this.settings.set(key, value)) return;
      if (key === "aspect") this.hooks.aspect(value);
      if (key === "language") this.hooks.language(value);
      if (key === "quality") this.hooks.quality(value);
      if (key === "music") this.hooks.music(value);
    };
    label.append(name, select);
    return label;
  }
  labelOf(key) {
    switch (key) {
      case "language":
        return this.s.language;
      case "quality":
        return this.s.quality;
      case "graphics":
        return this.s.graphics;
      case "music":
        return this.s.music;
      case "map":
        return this.s.map;
      case "aspect":
        return this.s.aspect;
    }
  }
  optionOf(key, value) {
    if (key === "language") return value === "he" ? this.s.languageHe : this.s.languageEn;
    if (key === "quality") {
      return value === "high" ? this.s.qualityHigh : this.s.qualityOriginal;
    }
    if (key === "aspect") {
      return value === "square-pixels" ? this.s.aspectSquare : this.s.aspectCrt;
    }
    if (key === "music") {
      return value === "1.3" ? this.s.music13 : this.s.musicOriginal;
    }
    if (key === "graphics") {
      return value === "1.4" ? this.s.graphics14 : this.s.graphicsOriginal;
    }
    if (key === "map") {
      return value === "4d" ? this.s.map4d : this.s.mapOriginal;
    }
    return this.s.original;
  }
};
function text(id, value) {
  const el = document.getElementById(id);
  if (el && el.textContent !== value) el.textContent = value;
}
function describe(save, s) {
  if (!save) return s.empty;
  const when = new Date(save.savedAt);
  const stamp = Number.isNaN(when.getTime()) ? "" : ` \xB7 ${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const level = save.level === 0 ? "\u2014" : String(save.level);
  return `${level} \xB7 ${save.minutesLeft}\u2032${stamp}`;
}

// web/main.ts
var DATA_URL = window.__princeDataUrl ?? "../original/prince1";
var POTION_PAGE = window.__princePotionLevel === true;
var FRAMES_PER_SECOND = 12;
async function boot() {
  const canvas = document.getElementById("screen");
  const status = document.getElementById("status");
  const display = new Display(canvas);
  const settings = new SettingsStore();
  display.setAspect(settings.get("aspect"));
  display.setQuality(settings.get("quality"));
  let words = stringsFor(settings.get("language"));
  let sayStatus = () => words.loading;
  const setStatus = (line) => {
    sayStatus = line;
    status.textContent = line();
  };
  const custom = window.__princeFetcher;
  const plain = custom ?? browserFetcher(DATA_URL);
  const ART_1_4 = /* @__PURE__ */ new Set([
    "PRINCE.DAT",
    "TITLE.DAT",
    "VDUNGEON.DAT",
    "VPALACE.DAT",
    "SKEL.DAT"
  ]);
  const art14 = custom ?? browserFetcher(`${DATA_URL.replace(/prince1$/, "prince14")}`);
  const fromDisc = settings.get("graphics") === "1.4" && custom === void 0 ? async (name) => ART_1_4.has(name) ? art14(name) : plain(name) : plain;
  const fourD = settings.get("map") === "4d" && custom === void 0;
  const kirill = fourD ? browserFetcher(`${DATA_URL.replace(/prince1$/, "fourd")}`)("KIRILL.DAT") : void 0;
  const fetchFile = async (name) => {
    if (name !== "LEVELS.DAT") return fromDisc(name);
    let levels = await fromDisc(name);
    if (kirill) levels = levelsDatWithFourD(levels, await kirill);
    if (POTION_PAGE) levels = levelsDatWithPotionLevel(levels);
    return levels;
  };
  const assets = new Assets(fetchFile);
  const exe = await fetchFile("UNCRKD.EXE");
  const gameText = new GameText(readFont(exe), {
    language: settings.get("language"),
    quality: settings.get("quality")
  });
  display.setTextSource(() => gameText.overlay);
  const kidArt = new KidHiRes();
  const kidAsked = /* @__PURE__ */ new Set();
  let kidDrawn = [];
  const kidDir = `${DATA_URL.replace(/original\/prince1$/, "")}${KID_HIRES_DIR}`;
  const fetchKid = async (id) => {
    if (kidAsked.has(id)) return;
    kidAsked.add(id);
    {
      try {
        const res = await fetch(`${kidDir}/${String(id).padStart(4, "0")}.png`);
        if (!res.ok) return;
        const bmp = await createImageBitmap(await res.blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = c.getContext("2d");
        if (!cx) return;
        cx.drawImage(bmp, 0, 0);
        kidArt.put(id, cx.getImageData(0, 0, bmp.width, bmp.height));
      } catch {
      }
    }
  };
  let kidPrefetched = false;
  const prefetchKid = () => {
    if (kidPrefetched) return;
    kidPrefetched = true;
    const ids = [];
    for (let i = 0; i < KID_SPRITE_COUNT; i++) ids.push(KID_FIRST_SPRITE + i);
    let next = 0;
    const pump = async () => {
      while (next < ids.length) await fetchKid(ids[next++]);
    };
    for (let lane = 0; lane < 8; lane++) void pump();
  };
  const onKidSprite = (id, x, y, flipped) => {
    if (settings.get("quality") !== "high") return;
    if (!kidArt.has(id)) {
      void fetchKid(id);
      return;
    }
    kidDrawn.push({ id, x, y, flipped });
  };
  const kidSource = () => {
    const was = kidDrawn;
    kidDrawn = [];
    return was;
  };
  const firstLevel = readExeConstants(exe).firstLevel;
  let sound = null;
  const wakeSound = () => {
    if (!sound) {
      const Ctor = window;
      const Context = Ctor.AudioContext ?? Ctor.webkitAudioContext;
      if (!Context) return;
      sound = new SoundPlayer(assets, new Context());
      sound.quality = settings.get("quality");
      setSoundRelease(settings.get("music") === "1.3" ? "1.3" : "1.0");
      const ALL_SOUNDS = Array.from({ length: 57 }, (_, i) => i);
      void sound.preloadAll([
        ...Object.values(SOUND),
        ...SEQUENCE_SOUND.filter((i) => i !== SOUND_SILENCE),
        ...ALL_SOUNDS
      ]);
    }
    void sound.wake();
  };
  const asked = [];
  const effects = {
    sound: (which) => {
      if (asked.length < 4e3) asked.push({ tick: ticksPlayed, which });
      return sound?.play(which);
    },
    stopSounds: () => sound?.stop(),
    soundPlaying: () => sound?.isPlaying ?? false
  };
  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group("TITLE.DAT", 50);
  const opening = await assets.group("TITLE.DAT", 40);
  let cutscene = null;
  let cutsceneBuilding = false;
  let afterScene = null;
  async function playScene(scene, then) {
    if (!cutscene) {
      cutsceneBuilding = true;
      try {
        cutscene = await CutscenePlayer.create(assets, exe, effects, gameText);
      } finally {
        cutsceneBuilding = false;
      }
    }
    game = null;
    afterScene = then;
    sceneCount += 1;
    cutscene.begin(scene);
    display.present(cutscene.render(), cutscene.palette.toRgba());
    setStatus(() => scene.kind === "title" ? words.pressAnyKey : words.skipScene);
  }
  let sceneCount = 0;
  function sceneFrame(ms) {
    if (!cutscene || !cutscene.running) return false;
    const going = cutscene.advance(ms);
    display.present(cutscene.render(), cutscene.palette.toRgba());
    if (!going) endScene();
    return true;
  }
  function endScene() {
    cutscene?.cancel();
    const then = afterScene;
    afterScene = null;
    if (then) void changeScene(then);
  }
  function skipScene() {
    effects.stopSounds();
    endScene();
  }
  let soundWaitOver = null;
  let soundWaitUntil = 0;
  const SOUND_WAIT_CAP_MS = 25e3;
  function waitForSound() {
    if (!effects.soundPlaying()) {
      effects.stopSounds();
      return Promise.resolve();
    }
    soundWaitUntil = performance.now() + SOUND_WAIT_CAP_MS;
    return new Promise((resolve) => {
      soundWaitOver = () => {
        soundWaitOver = null;
        effects.stopSounds();
        resolve();
      };
    });
  }
  const views = [{ kind: "title" }, { kind: "opening" }];
  let ticksPlayed = 0;
  for (let n = 1; n <= 14; n++) views.push({ kind: "level", level: n });
  views.push({ kind: "level", level: 0 });
  const label = (v) => v.kind !== "level" ? words.titleScreen : v.level === 0 ? words.theDemo : words.levelN.replace("{n}", String(v.level));
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
  function directionsOf(e) {
    switch (e.code) {
      case "Numpad7":
      case "Home":
        return ["left", "up"];
      case "Numpad8":
        return ["up"];
      case "Numpad9":
      case "PageUp":
        return ["right", "up"];
      case "Numpad4":
        return ["left"];
      case "Numpad5":
      case "NumpadClear":
        return ["down"];
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
  async function select(index, carry = {}) {
    cutscene?.cancel();
    afterScene = null;
    const v = views[index];
    if (v.kind !== "level") {
      current = index;
      game = null;
      drawTitle(v.kind === "title" ? title : opening);
      setStatus(() => v.kind === "title" ? words.pressAnyKey : words.hourUp);
      return;
    }
    effects.stopSounds();
    current = index;
    building += 1;
    try {
      game = await PopGame.start(
        assets,
        exe,
        v.level,
        { effects, seamless: carry.seamless, text: gameText, onKidSprite }
      );
      const kidBank = game.scene.chtabs.kid?.palette.vga ?? [];
      if (settings.get("quality") === "high") prefetchKid();
      display.setKidHiRes(kidArt, kidSource, kidBank.flatMap((e) => [
        e.r << 2 | e.r >> 4,
        e.g << 2 | e.g >> 4,
        e.b << 2 | e.b >> 4
      ]));
    } finally {
      building -= 1;
    }
    watchRoom = null;
  }
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
        // A recording made here always starts the level with a fresh
        // hour; only a probe captured against the original past
        // level 2 arrives with less. See `startMinutes`.
        startMinutes: 60,
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
  function present(g2) {
    const surface = g2.render();
    lastShown = surface;
    display.present(surface, g2.scene.screenPalette.toRgba());
    if (g2.flashColour > 0) {
      g2.raiseFlash();
      display.present(surface, g2.scene.screenPalette.toRgba());
      flashOff = performance.now() + FLASH_MS;
    }
  }
  let lastShown = null;
  let flashOff = 0;
  const FLASH_MS = 12;
  function takeFlashDown(now) {
    if (flashOff === 0 || !game) return;
    if (now < flashOff) return;
    flashOff = 0;
    game.dropFlash();
    if (changing || building > 0 || cutsceneBuilding || cutscene?.running) return;
    if (lastShown) display.present(lastShown, game.scene.screenPalette.toRgba());
  }
  let stepOnce = false;
  let pauseShown = false;
  let changing = false;
  let building = 0;
  function frame() {
    if (!game) return;
    if (changing || building > 0 || cutsceneBuilding) return;
    if (game.paused && !stepOnce) {
      if (!pauseShown) {
        pauseShown = true;
        present(game);
      }
      setStatus(() => words.pausedLine);
      return;
    }
    stepOnce = false;
    pauseShown = false;
    if (watchRoom && game.drawnRoom !== watchRoom) game.showRoom(watchRoom);
    {
      const c = controls();
      pressedSinceStep.clear();
      game.step(c);
      ticksPlayed++;
      recorder.tick(c, game);
      if (watchRoom && game.drawnRoom !== watchRoom) watchRoom = null;
      if (game.gameWon) {
        void changeScene(() => playScene({ kind: "ending" }, restartGame));
        return;
      }
      if (game.timeExpired) {
        void changeScene(() => playScene({ kind: "expired" }, restartGame));
        return;
      }
      if (game.restartDue) {
        void changeScene(restart);
        return;
      }
      if (game.demoFinished || game.restartGameDue) {
        void changeScene(restartGame);
        return;
      }
      if (game.levelFinished) {
        void changeScene(nextLevel);
        return;
      }
    }
    present(game);
    const v = views[current];
    const g2 = game;
    const room = watchRoom;
    setStatus(() => g2.isDemo ? words.demoLine : g2.awaitingButton ? `${label(v)} \u2014 ${words.againLine}` : room === null ? `${label(v)} \u2014 ${words.controls}` : `${label(v)}, ${words.roomN.replace("{n}", String(room))} \u2014 ${words.lookingLine}`);
  }
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
    return commandKey(keyName(e));
  }
  function commandKey(key) {
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
      /**
       * Every one of these goes through `cheat()`, not through the
       * method behind it, because `process_key` runs **inside** the
       * tick and not before it.
       *
       * The chain is `play_level_2` -> `play_frame` ->
       * `play_kid_frame` -> `control_kid` -> `do_paused`, and
       * `play_level_2` clears `guardhp_delta` and `hitp_delta`
       * immediately before `play_frame`. A cheat called here, on the
       * key event, is on the wrong side of that clearing: K, Shift+S
       * and Shift+T each set a delta that the very next `step` wiped
       * before anything read it, so none of the three did anything to
       * the bar in the game the player plays. `addlife2` scored 60 of
       * 191 against the original for exactly that and `killguard6`
       * 179 of 299; queued, they are 188 and **299, exact**.
       *
       * `cheat()` queues and `step()` drains the queue where the C
       * reads the key, so the browser and the oracle's replay now run
       * the identical path. H, J, U, N and Ctrl+B stay below, because
       * the shell's look-around holds a room across ticks, which is
       * more than `process_key` does.
       */
      case "c":
      case "shift+c":
      case "+":
      case "-":
      case "r":
      case "k":
      case "shift+i":
      case "shift+w":
      case "shift+b":
      case "shift+s":
      case "shift+t":
        game.cheat(key);
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
  function textInputKey(e) {
    switch (e.code) {
      case "Enter":
      case "NumpadEnter":
        return "enter";
      case "Escape":
        return "escape";
      case "Backspace":
        return "backspace";
      case "Delete":
        return "delete";
      default:
        return "";
    }
  }
  window.addEventListener("keydown", (e) => {
    if (e.altKey) return;
    wakeSound();
    document.activeElement?.blur?.();
    if (soundWaitOver) {
      e.preventDefault();
      soundWaitOver();
      return;
    }
    if (cutscene?.running) {
      e.preventDefault();
      if (cutscene.wantsText) {
        cutscene.pushKey(textInputKey(e), e.key.length === 1 ? e.key : "");
        return;
      }
      if (cutscene.skippable) {
        effects.stopSounds();
        cutscene.cancel();
        afterScene = null;
        void changeScene(async () => {
          await select(levelView(firstLevel));
        });
        return;
      }
      if (!cutscene.keysDisabled || keyName(e) === "escape") skipScene();
      return;
    }
    if (!game) {
      e.preventDefault();
      void changeScene(async () => {
        await select(levelView(firstLevel));
      });
      return;
    }
    if (game.isDemo) {
      e.preventDefault();
      void changeScene(async () => {
        await select(levelView(firstLevel));
      });
      return;
    }
    if (game.paused) {
      e.preventDefault();
      game.paused = false;
      stepOnce = true;
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
    const carried = {
      ticks: game.remainingTicks,
      sword: game.hasSword,
      // The flasks he has found.
      //
      // `add_life` raises `hitp_max` and leaves `hitp_beg_lev` alone --
      // which is what the C does too -- and `start_level` sets
      // `hitp_max` back from `hitp_beg_lev` on the next level. So the
      // number to carry is the one he is playing with, not the one the
      // level began with, and carrying the latter is why the first
      // attempt at this changed nothing.
      lives: game.maxHitPoints,
      // `seamless`: level 12 is left at a run through room 23, and
      // level 13 then does not announce itself and does not give him
      // a fresh set of flasks. In the C both of those are globals
      // that simply survive `start_level`; here each level is a new
      // `PopGame`, so they are handed across.
      seamless: game.seamlessExit,
      hp: game.hitPoints
    };
    held.clear();
    const level = was + 1;
    const next = views.findIndex((x) => x.kind === "level" && x.level === level);
    if (next < 0) {
      await playScene({ kind: "ending" }, restartGame);
      return;
    }
    const arrive = async () => {
      await waitForSound();
      await select(next, { seamless: carried.seamless });
      if (!game) return;
      game.remainingTicks = carried.ticks;
      game.hasSword = carried.sword || game.hasSword;
      game.beginningHitPoints = carried.lives;
      if (carried.seamless) game.carryHitPoints(carried.hp, carried.lives);
      watchRoom = null;
    };
    if (CutscenePlayer.hasCutsceneFor(level)) {
      await playScene({ kind: "level", level }, arrive);
      return;
    }
    await arrive();
  }
  const levelView = (level) => views.findIndex((v) => v.kind === "level" && v.level === level);
  async function restartGame() {
    held.clear();
    await playScene({ kind: "title" }, startDemo);
  }
  async function startDemo() {
    held.clear();
    await select(levelView(0));
  }
  async function restart() {
    if (!game) return;
    held.clear();
    await waitForSound();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }
  function download(name, text2, type) {
    const url = URL.createObjectURL(new Blob([text2], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.append(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1e4);
  }
  function toggleRecording() {
    if (recorder.on) {
      recorder.stop();
      if (recorder.ticks.length) {
        const when = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
        download(
          `prince-keys-level${recorder.level}-${when}.json`,
          recorder.toJson(),
          "application/json"
        );
      }
      return false;
    }
    if (!game) return false;
    void (async () => {
      await changeScene(restart);
      recorder.start();
    })();
    return true;
  }
  function saveGame(slot2) {
    if (!game) return false;
    return writeSlot(slot2, snapshot());
  }
  async function loadGame(slot2) {
    const save = readSlot(slot2);
    if (!save) return false;
    await changeScene(async () => {
      const index = views.findIndex(
        (v) => v.kind === "level" && v.level === save.level
      );
      if (index < 0) return;
      await select(index);
      restore(save);
      held.clear();
      pressedSinceStep.clear();
      game?.drawRoomNow(game.kid.room);
    });
    return true;
  }
  let beganFromOpening = null;
  const openingGesture = new Promise((resolve) => {
    beganFromOpening = resolve;
  });
  async function waitUntilThePageCanSound() {
    wakeSound();
    if (!sound || sound.awake) return;
    display.present(titleSurface, titlePalette.toRgba());
    setStatus(() => words.pressAnyKey);
    window.__princeWaitingForSound = true;
    await new Promise((resolve) => {
      const go = (e) => {
        e.preventDefault();
        e.stopPropagation();
        off();
        wakeSound();
        void sound?.wake().then(resolve, resolve);
      };
      const off = () => {
        window.removeEventListener("keydown", go, true);
        window.removeEventListener("pointerdown", go, true);
      };
      window.addEventListener("keydown", go, true);
      window.addEventListener("pointerdown", go, true);
      void openingGesture.then(() => {
        off();
        void sound?.wake().then(resolve, resolve);
      });
    });
    window.__princeWaitingForSound = false;
  }
  const STEP_MS = 1e3 / FRAMES_PER_SECOND;
  let paused = false;
  let owed = 0;
  let last = performance.now();
  function tick(now) {
    requestAnimationFrame(tick);
    takeFlashDown(now);
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS;
    if (paused) {
      owed = 0;
      return;
    }
    if (soundWaitOver) {
      owed = 0;
      if (!effects.soundPlaying() || now > soundWaitUntil) soundWaitOver();
      return;
    }
    if (sceneFrame(Math.min(owed, STEP_MS * 5))) {
      owed = 0;
      return;
    }
    while (owed >= STEP_MS) {
      owed -= STEP_MS;
      frame();
    }
  }
  requestAnimationFrame(tick);
  const w = window;
  w.__princeFrame = (id) => {
    if (id === "title-background") {
      drawTitle(title);
      return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    }
    if (cutscene?.running) {
      return Array.from(cutscene.render().toRgb(cutscene.palette.toRgba()));
    }
    if (!game) return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    return Array.from(game.render().toRgb(game.scene.screenPalette.toRgba()));
  };
  w.__princeShow = async (level, room) => {
    await select(views.findIndex((v) => v.kind === "level" && v.level === level));
    watchRoom = room;
    if (game) game.drawRoomNow(room);
    frame();
  };
  w.__princeEnterLevel = async (level) => {
    await select(views.findIndex((v) => v.kind === "level" && v.level === level));
  };
  w.__princeStep = (n, c = {}, hash = false) => {
    if (!game || changing || building > 0) return null;
    watchRoom = null;
    for (let i = 0; i < n; i++) game.step({ x: 0, y: 0, shift: false, ...c });
    const surface = game.render();
    const rgba = game.scene.screenPalette.toRgba();
    display.present(surface, rgba);
    if (!hash) return { ...game.kid };
    const rgb = surface.toRgb(rgba);
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return { ...game.kid, hash: h >>> 0 };
  };
  w.__princeStepRestarting = async (c = {}) => {
    if (!game || changing || building > 0) return null;
    watchRoom = null;
    game.step({ x: 0, y: 0, shift: false, ...c });
    let restarted = false;
    if (game.restartDue) {
      restarted = true;
      await changeScene(restart);
      if (!game) return null;
    }
    const surface = game.render();
    const rgba = game.scene.screenPalette.toRgba();
    display.present(surface, rgba);
    const rgb = surface.toRgb(rgba);
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return { hash: h >>> 0, restarted };
  };
  w.__princeAsked = () => [...asked];
  w.__princeSeed = (n) => {
    set_seed(n);
  };
  w.__princeCommand = (key) => commandKey(key);
  w.__princePause = (on) => {
    paused = on;
  };
  w.__princePlayScene = async (scene) => {
    await playScene(scene, restartGame);
  };
  w.__princeSceneStep = (ms) => sceneFrame(ms);
  w.__princeSceneHash = () => {
    if (!cutscene) return null;
    const rgb = cutscene.render().toRgb(cutscene.palette.toRgba());
    for (const [x, y] of PROOM_RANDOM_PIXELS) {
      const at = (y * 320 + x) * 3;
      rgb[at] = 0;
      rgb[at + 1] = 0;
      rgb[at + 2] = 0;
    }
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return h >>> 0;
  };
  w.__princeSceneState = () => cutscene ? {
    running: cutscene.running,
    /** How many scenes have been begun; see `sceneCount`. */
    count: sceneCount,
    playing: cutscene.playing,
    /** `input_str` has the keyboard: the hall of fame is asking for a name. */
    wantsText: cutscene.wantsText,
    /** How many of the screen's pixels are not black. */
    lit: cutscene.render().pixels.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)
  } : null;
  w.__princeState = () => game ? {
    // How many ticks the page has played. A test that has to wait for
    // the game rather than for the clock waits on this: under load the
    // wall clock and the game's own time come apart, and three of the
    // browser tests used to fail for that and nothing else.
    ticks: ticksPlayed,
    frame: game.kid.frame,
    room: game.kid.room,
    x: game.kid.x,
    y: game.kid.y,
    hitPoints: game.hitPoints,
    dead: game.isDead,
    held: [...held].sort(),
    awaitingButton: game.awaitingButton,
    level: w0Level(),
    /** `current_level == 0`: the attract-mode level is playing itself. */
    demo: game.isDemo,
    /** `is_paused`, which `do_paused` leaves set between single steps. */
    paused: game.paused,
    /** The colour `do_flash` is owed after this tick's picture. */
    flashColour: game.flashColour,
    /** `is_feather_fall`, which `potion.html` shows while it lasts. */
    featherFall: game.isFeatherFall,
    upsideDown: game.upsideDown,
    maxHitPoints: game.maxHitPoints,
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
  w.__princeMute = (on) => {
    if (sound) sound.muted = on;
  };
  w.__princeSoundFailures = async () => {
    wakeSound();
    await sound?.preloadAll(Array.from({ length: 58 }, (_, i) => i));
    return sound ? [...sound.failed.entries()] : [];
  };
  w.__princeHeard = () => sound ? [...sound.started] : [];
  w.__princeSoundRelease = () => soundRelease();
  w.__princePlaySound = (which) => {
    wakeSound();
    sound?.stop();
    sound?.play(which);
  };
  void RoomRenderer;
  function relabelTheGame() {
    gameText.clearOverlay();
    if (cutscene?.running) {
      cutscene.refreshText();
      display.present(cutscene.render(), cutscene.palette.toRgba());
      return;
    }
    if (game) {
      game.refreshText();
      if (lastShown) display.present(lastShown, game.scene.screenPalette.toRgba());
    }
  }
  const chrome = new Chrome(settings, {
    begin: () => {
      wakeSound();
      beganFromOpening?.();
    },
    aspect: (value) => display.setAspect(value),
    language: (value) => {
      gameText.language = value;
      words = stringsFor(value);
      status.textContent = sayStatus();
      relabelTheGame();
    },
    quality: (value) => {
      gameText.quality = value;
      display.setQuality(value);
      if (value === "high") prefetchKid();
      if (sound) sound.quality = value;
      relabelTheGame();
    },
    music: (value) => {
      setSoundRelease(value === "1.3" ? "1.3" : "1.0");
    },
    toggleRecording,
    save: (slot2) => {
      const ok = saveGame(slot2);
      chrome.buildSlots();
      chrome.note(ok ? chrome.strings.saved : chrome.strings.noSave);
    },
    load: (slot2) => {
      void loadGame(slot2).then((ok) => {
        chrome.note(ok ? chrome.strings.loaded : chrome.strings.noSave);
      });
    }
  });
  if (POTION_PAGE) chrome.dismissOpening();
  w.__princeDismissOpening = () => chrome.dismissOpening();
  w.__princeSettings = () => ({ ...settings.all });
  await waitUntilThePageCanSound();
  if (POTION_PAGE) await select(levelView(POTION_LEVEL_NUMBER));
  else await restartGame();
  w.__princeReady = true;
}
boot().catch((err) => {
  const status = document.getElementById("status");
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
