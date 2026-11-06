/**
 * Decoder for the image/sprite resources of the Prince of Persia 1 `.DAT`
 * files.
 *
 * Payload header:
 *   uint16 height
 *   uint16 width        (pixels)
 *   uint16 flags
 *
 *   depth  = ((flags >> 12) & 7) + 1     bits per pixel
 *   method = (flags >> 8) & 0x0F         compression scheme
 *   stride = (depth * width + 7) >> 3    bytes per row of packed data
 *
 * Methods: 0 raw, 1 RLE row-major, 2 RLE column-major, 3 LZ row-major,
 * 4 LZ column-major. The LZ scheme is LZ77 over a 1 KiB ring buffer with a
 * bit mask selecting literal vs. back-reference.
 *
 * The routines below reproduce the original 1990 code's exact arithmetic,
 * including the 8- and 16-bit wraparound of its counters, so that malformed
 * or edge-case streams decode the same way they did on DOS.
 */

const WINDOW_SIZE = 0x400;
/** Where the original set its ring-buffer write cursor before decoding. */
const WINDOW_START = WINDOW_SIZE - 0x42;

const i8 = (v: number): number => (v << 24) >> 24;
const i16 = (v: number): number => (v << 16) >> 16;

export const CompressionMethod = {
  Raw: 0,
  RleRowMajor: 1,
  RleColumnMajor: 2,
  LzRowMajor: 3,
  LzColumnMajor: 4,
} as const;
export type CompressionMethod =
  (typeof CompressionMethod)[keyof typeof CompressionMethod];

export interface ImageHeader {
  readonly height: number;
  readonly width: number;
  readonly flags: number;
  readonly depth: number;
  readonly method: CompressionMethod;
  readonly stride: number;
}

export interface DecodedImage extends ImageHeader {
  /** width * height palette indices, one byte each, row-major. */
  readonly pixels: Uint8Array;
}

export function readImageHeader(payload: Uint8Array): ImageHeader {
  if (payload.length < 6) throw new Error('image payload shorter than its header');
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const height = dv.getUint16(0, true);
  const width = dv.getUint16(2, true);
  const flags = dv.getUint16(4, true);
  const depth = ((flags >> 12) & 7) + 1;
  const method = ((flags >> 8) & 0x0f) as CompressionMethod;
  const stride = (depth * width + 7) >> 3;
  return { height, width, flags, depth, method, stride };
}

/**
 * Unused slots inside a sprite group are stored as a two-byte payload of
 * zeroes — a height of 0 and nothing else. The original engine skipped them.
 */
export function isEmptyPlaceholder(payload: Uint8Array): boolean {
  return payload.length <= 5 && payload.every((b) => b === 0);
}

export function isImage(payload: Uint8Array): boolean {
  if (payload.length < 6) return false;
  const h = readImageHeader(payload);
  return (
    h.height > 0 &&
    h.width > 0 &&
    h.method <= CompressionMethod.LzColumnMajor &&
    h.depth >= 1 &&
    h.depth <= 8
  );
}

function rleRowMajor(dest: Uint8Array, src: Uint8Array, destLength: number): number {
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

function rleColumnMajor(
  dest: Uint8Array,
  src: Uint8Array,
  destLength: number,
  stride: number,
  height: number,
): number {
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

function lzRowMajor(dest: Uint8Array, src: Uint8Array, destLength: number): number {
  const window = new Uint8Array(WINDOW_SIZE);
  let wp = WINDOW_START;
  let remaining = i16(destLength);
  let sp = 0;
  let dp = 0;
  let mask = 0;
  do {
    mask >>>= 1;
    if ((mask & 0xff00) === 0) mask = src[sp++] | 0xff00;
    if (mask & 1) {
      const v = src[sp++];
      window[wp++] = v;
      dest[dp++] = v;
      if (wp >= WINDOW_SIZE) wp = 0;
      remaining = i16(remaining - 1);
    } else {
      const info = ((src[sp] << 8) | src[sp + 1]) & 0xffff;
      sp += 2;
      let from = info & 0x3ff;
      let runLength = ((info >>> 10) + 3) & 0xff;
      do {
        const v = window[from++];
        window[wp++] = v;
        dest[dp++] = v;
        if (from >= WINDOW_SIZE) from = 0;
        if (wp >= WINDOW_SIZE) wp = 0;
        remaining = i16(remaining - 1);
        runLength = (runLength - 1) & 0xff;
      } while (remaining !== 0 && runLength !== 0);
    }
  } while (remaining !== 0);
  return sp;
}

function lzColumnMajor(
  dest: Uint8Array,
  src: Uint8Array,
  destLength: number,
  stride: number,
  height: number,
): number {
  const window = new Uint8Array(WINDOW_SIZE);
  let wp = WINDOW_START;
  let remaining = i16(height);
  let left = destLength;
  const back = i16(destLength - 1);
  let sp = 0;
  let dp = 0;
  let mask = 0;
  do {
    mask >>>= 1;
    if ((mask & 0xff00) === 0) mask = src[sp++] | 0xff00;
    if (mask & 1) {
      const v = src[sp++];
      window[wp++] = v;
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
      const info = ((src[sp] << 8) | src[sp + 1]) & 0xffff;
      sp += 2;
      let from = info & 0x3ff;
      let runLength = ((info >>> 10) + 3) & 0xff;
      do {
        const v = window[from++];
        window[wp++] = v;
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
        runLength = (runLength - 1) & 0xff;
      } while (left !== 0 && runLength !== 0);
    }
  } while (left !== 0);
  return sp;
}

/** Expand packed `depth`-bit pixels (most significant bits first) to one byte each. */
export function unpackPixels(
  packed: Uint8Array,
  width: number,
  height: number,
  stride: number,
  depth: number,
): Uint8Array {
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
        out[op++] = (v >> shift) & mask;
      }
    }
  }
  return out;
}

export interface DecodeResult extends DecodedImage {
  /** How many payload bytes after the 6-byte header the decoder consumed. */
  readonly bytesConsumed: number;
}

export function decodeImage(payload: Uint8Array): DecodeResult {
  const h = readImageHeader(payload);
  if (h.height === 0) throw new Error('image has zero height');
  const body = payload.subarray(6);
  const destSize = h.stride * h.height;
  const packed = new Uint8Array(destSize);
  let consumed: number;
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
    bytesConsumed: consumed,
  };
}
