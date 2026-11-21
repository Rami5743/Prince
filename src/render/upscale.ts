/**
 * The picture at `quality: high`: a bigger picture **and new colours**.
 *
 * ## Why the first attempt had no new colours, which is what was wrong with it
 *
 * The game is drawn in palette **indices** and the palette moves while
 * it plays -- `set_bg_attr` for the flash, sixty-four shades of every
 * fade, `gen_palace_wall_colors` for a palace. The first version of
 * this file took that to mean no pixel may ever be a mix, and used
 * AdvMAME's Scale3x, which only ever copies an index. Measured on four
 * real frames, that gives **exactly the colour count the original
 * has** -- 24, 19, 35 and 25 -- so an edge can only ever be a
 * staircase of the original's own colours, however finely it is cut.
 * Looked at, that is what it was.
 *
 * ## What it does instead: a mixture of indices, composed every frame
 *
 * A pixel may be a mix as long as the mix is kept **as indices** and
 * turned into a colour against the palette that is live at that
 * moment. Then a fade fades it and the flash flashes it, which is the
 * whole of what the index rule was protecting.
 *
 * So: run Scale3x to get a 960x600 picture whose shapes are clean,
 * then run Scale3x's own rule **again** over that picture and average
 * the nine answers it gives for each pixel. That is a 2880x1800
 * rendering of the art sampled down three by three -- supersampling,
 * the oldest anti-aliasing there is -- and the average is a mixture of
 * at most five indices, because Scale3x's nine answers are only ever
 * the centre and its four edge neighbours.
 *
 * Measured on the same four frames the first version was measured on,
 * colours on the glass:
 *
 *     frame      original   Scale3x   this
 *     dungeon      24         24       229
 *     running      19         19       171
 *     palace       35         35       393
 *     guard        25         25       246
 *
 * ## What it costs, and why the shape of the answer is what it is
 *
 * **Only four per cent of the pixels are a mixture** (23059 of 576000
 * on the palace frame), so the other ninety-six are a plain index and
 * cost exactly what they cost before. That is why the answer is kept
 * as `base` -- the Scale3x picture, one index a pixel -- plus a short
 * list of the pixels that are a mixture and the nine-ninths that make
 * them up. The compose fills the whole frame from `base` through the
 * palette, as it always did, and then writes over the four per cent.
 *
 * Measured in this machine's JS on the palace frame:
 *
 *     Scale3x                        0.7 ms
 *     the mixture pass over it       4.1 ms   only when the art moves
 *     compose, flat                  1.8 ms
 *     compose, the mixtures          0.8 ms   every frame
 *
 * The art moves twelve times a second and the screen is presented
 * about twenty-four, so that is about a tenth of a core -- less than
 * the x6 Scale3x path it replaces, which cost 10 ms of compose on
 * every one of those twenty-four frames.
 *
 * ## What else was tried
 *
 * * **Eagle2x** eats single pixels and this art is full of them: the
 *   Prince's face flattened out and his hair became a blob.
 * * **xBR level 2 with the blending removed** came out thinner than
 *   the original everywhere and lost the shape of the torch handle.
 *   Without its blend the algorithm's edge weighting has nothing to
 *   put at an edge but a neighbour's flat colour.
 * * **x18 geometry sampled down to x6** looks a shade better still
 *   and costs about 26 million writes a frame, which is a quarter of
 *   a second. The x9-into-x3 picture upscaled by the browser is a
 *   hair softer and is affordable.
 *
 * Nothing in `src/pop` is involved: the engine composes the same
 * 320x200 indexed surface it always did, and this runs on the way to
 * the canvas, so `page-port.ts` and every digest read the surface
 * itself.
 */

/** 320x200 upscaled by this much, in each direction. */
export type UpscaleFactor = 1 | 2 | 3 | 6;

/**
 * How much bigger the anti-aliased picture is than the game's own.
 *
 * Three, because the canvas is shown at about 2.8 game pixels across
 * on an ordinary desktop window, and because the sampling that makes
 * the new colours is itself a three-by-three.
 */
export const AA_FACTOR = 3;

/** How many indices a mixture can hold: the centre and its four edges. */
export const MIX_PARTS = 5;

/**
 * A picture at `AA_FACTOR`, as indices plus the pixels that are a mix.
 *
 * `mixWeights` holds five counts per mixed pixel, in the order
 * centre, up, left, right, down, summing to nine. The four
 * neighbours are not stored: they are read back out of `base`, which
 * is where they came from.
 */
export interface Antialiased {
  readonly base: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Where the mixed pixels are, as offsets into `base`. */
  readonly mixAt: Uint32Array;
  readonly mixCount: number;
  /** Five counts per mixed pixel: centre, up, left, right, down. */
  readonly mixWeights: Uint8Array;
}

/**
 * AdvMAME's Scale2x, on palette indices.
 *
 *       B                E0 E1
 *     D E F     ->       E2 E3
 *       H
 *
 * A corner is filled only when the two edges that meet there are the
 * same and the two that do not are different; `B !== H && D !== F` is
 * the guard that keeps a flat area flat and keeps a one-pixel line
 * from being rounded away.
 */
export function scale2x(
  src: Uint8Array, width: number, height: number, out?: Uint8Array,
): Uint8Array {
  const w2 = width * 2;
  const dst = out ?? new Uint8Array(w2 * height * 2);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const mid = y * width;
    const down = (y + 1 < height ? y + 1 : height - 1) * width;
    const row0 = (y * 2) * w2;
    const row1 = row0 + w2;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < width ? x + 1 : width - 1;
      const e = src[mid + x]!;
      const b = src[up + x]!;
      const h = src[down + x]!;
      const d = src[mid + left]!;
      const f = src[mid + right]!;
      let e0 = e; let e1 = e; let e2 = e; let e3 = e;
      if (b !== h && d !== f) {
        if (d === b) e0 = d;
        if (b === f) e1 = f;
        if (d === h) e2 = d;
        if (h === f) e3 = f;
      }
      dst[row0 + x * 2] = e0;
      dst[row0 + x * 2 + 1] = e1;
      dst[row1 + x * 2] = e2;
      dst[row1 + x * 2 + 1] = e3;
    }
  }
  return dst;
}

/**
 * AdvMAME's Scale3x, on palette indices.
 *
 *     A B C              E0 E1 E2
 *     D E F     ->       E3 E4 E5
 *     G H I              E6 E7 E8
 *
 * The middle pixel is always `E`, which is what keeps a single pixel
 * of detail -- the speckles in the dungeon brick, the glint on a
 * sword -- from being swallowed. The four edge pixels need a corner
 * on each side of them *and* the opposite corner to disagree, which
 * is the `E !== C` family of tests.
 */
export function scale3x(
  src: Uint8Array, width: number, height: number, out?: Uint8Array,
): Uint8Array {
  const w3 = width * 3;
  const dst = out ?? new Uint8Array(w3 * height * 3);
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const mid = y * width;
    const down = (y + 1 < height ? y + 1 : height - 1) * width;
    const row0 = (y * 3) * w3;
    const row1 = row0 + w3;
    const row2 = row1 + w3;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < width ? x + 1 : width - 1;
      const a = src[up + left]!; const b = src[up + x]!; const c = src[up + right]!;
      const d = src[mid + left]!; const e = src[mid + x]!; const f = src[mid + right]!;
      const g = src[down + left]!; const h = src[down + x]!; const i = src[down + right]!;
      let e0 = e; let e1 = e; let e2 = e; let e3 = e;
      let e5 = e; let e6 = e; let e7 = e; let e8 = e;
      if (b !== h && d !== f) {
        if (d === b) e0 = d;
        if ((d === b && e !== c) || (b === f && e !== a)) e1 = b;
        if (b === f) e2 = f;
        if ((d === b && e !== g) || (d === h && e !== a)) e3 = d;
        if ((b === f && e !== i) || (h === f && e !== c)) e5 = f;
        if (d === h) e6 = d;
        if ((d === h && e !== i) || (h === f && e !== g)) e7 = h;
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

/**
 * The picture, `factor` times as big, in indices and nothing else.
 *
 * This is the shape without the anti-aliasing, kept because it is
 * what `antialias` is built on and because it is the thing to reach
 * for anywhere a mixture would be wrong.
 */
export function upscale(
  src: Uint8Array, width: number, height: number, factor: UpscaleFactor,
  out?: Uint8Array,
): Uint8Array {
  const into = out?.length === width * height * factor * factor ? out : undefined;
  if (factor === 1) return src;
  if (factor === 2) return scale2x(src, width, height, into);
  if (factor === 3) return scale3x(src, width, height, into);
  return scale2x(scale3x(src, width, height), width * 3, height * 3, into);
}

/** Somewhere to keep the arrays between frames, so none is made twice. */
export interface AntialiasScratch {
  base?: Uint8Array;
  mixAt?: Uint32Array;
  mixWeights?: Uint8Array;
}

/**
 * The picture three times as big, with its edges anti-aliased.
 *
 * Scale3x first, for the shape, and then Scale3x's own rule a second
 * time over that picture -- but instead of writing the nine answers
 * out at nine times the size, they are counted. The counts are the
 * three-by-three average of a 2880x1800 rendering, which is what
 * puts a new colour on an edge, and they are counts of **indices**,
 * so the colour is worked out against whatever palette is live when
 * the frame is drawn.
 *
 * `scratch` is reused between frames: this runs every time the art
 * moves, which is twelve times a second.
 */
export function antialias(
  src: Uint8Array, width: number, height: number, scratch: AntialiasScratch = {},
): Antialiased {
  const w = width * AA_FACTOR;
  const h = height * AA_FACTOR;
  const n = w * h;
  const base = scratch.base?.length === n ? scratch.base : new Uint8Array(n);
  scratch.base = base;
  scale3x(src, width, height, base);

  // At most one pixel in four is ever a mixture in this art; the list
  // grows from an eighth and is kept for the next frame.
  let at = scratch.mixAt?.length ? scratch.mixAt : new Uint32Array(n >> 3);
  let weights = scratch.mixWeights?.length === at.length * MIX_PARTS
    ? scratch.mixWeights : new Uint8Array(at.length * MIX_PARTS);
  let count = 0;

  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : 0) * w;
    const mid = y * w;
    const down = (y + 1 < h ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const left = x > 0 ? x - 1 : 0;
      const right = x + 1 < w ? x + 1 : w - 1;
      const b = base[up + x]!;
      const d = base[mid + left]!;
      const e = base[mid + x]!;
      const f = base[mid + right]!;
      const hh = base[down + x]!;
      if (b === hh || d === f) continue;   // Scale3x's own guard: nothing to do
      const a = base[up + left]!; const c = base[up + right]!;
      const g = base[down + left]!; const i = base[down + right]!;
      let nB = 0; let nD = 0; let nF = 0; let nH = 0;
      if (d === b) nD++;
      if ((d === b && e !== c) || (b === f && e !== a)) nB++;
      if (b === f) nF++;
      if ((d === b && e !== g) || (d === hh && e !== a)) nD++;
      if ((b === f && e !== i) || (hh === f && e !== c)) nF++;
      if (d === hh) nD++;
      if ((d === hh && e !== i) || (hh === f && e !== g)) nH++;
      if (hh === f) nF++;
      const moved = nB + nD + nF + nH;
      if (moved === 0) continue;           // every answer was the centre
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

/**
 * Write an anti-aliased picture into an RGBA buffer, through a palette.
 *
 * The flat fill is the one the display has always done. The second
 * loop is the four per cent, and it is the whole of the difference
 * between this and a picture made only of the original's own colours.
 */
export function composeAntialiased(
  aa: Antialiased, paletteRgba: Uint8Array, out: Uint8ClampedArray,
): void {
  const { base, width: w, height: h, mixAt, mixCount, mixWeights } = aa;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const c = base[i]! * 4;
    const o = i * 4;
    out[o] = paletteRgba[c]!;
    out[o + 1] = paletteRgba[c + 1]!;
    out[o + 2] = paletteRgba[c + 2]!;
    out[o + 3] = 255;
  }
  for (let k = 0; k < mixCount; k++) {
    const i = mixAt[k]!;
    const y = (i / w) | 0;
    const x = i - y * w;
    const up = (y > 0 ? y - 1 : 0) * w;
    const down = (y + 1 < h ? y + 1 : h - 1) * w;
    const left = x > 0 ? x - 1 : 0;
    const right = x + 1 < w ? x + 1 : w - 1;
    const e = base[i]! * 4;
    const b = base[up + x]! * 4;
    const d = base[y * w + left]! * 4;
    const f = base[y * w + right]! * 4;
    const hh = base[down + x]! * 4;
    const o = k * MIX_PARTS;
    const wE = mixWeights[o]!; const wB = mixWeights[o + 1]!;
    const wD = mixWeights[o + 2]!; const wF = mixWeights[o + 3]!;
    const wH = mixWeights[o + 4]!;
    const p = i * 4;
    out[p] = (paletteRgba[e]! * wE + paletteRgba[b]! * wB + paletteRgba[d]! * wD
      + paletteRgba[f]! * wF + paletteRgba[hh]! * wH) / 9;
    out[p + 1] = (paletteRgba[e + 1]! * wE + paletteRgba[b + 1]! * wB
      + paletteRgba[d + 1]! * wD + paletteRgba[f + 1]! * wF
      + paletteRgba[hh + 1]! * wH) / 9;
    out[p + 2] = (paletteRgba[e + 2]! * wE + paletteRgba[b + 2]! * wB
      + paletteRgba[d + 2]! * wD + paletteRgba[f + 2]! * wF
      + paletteRgba[hh + 2]! * wH) / 9;
  }
}
