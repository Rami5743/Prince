/**
 * The picture at a higher resolution, for `quality: high`.
 *
 * **Every pixel out of here is one of the pixels that went in.** That
 * is not a style: the game is drawn in palette *indices* and the
 * palette moves while it plays -- `set_bg_attr` for the flash, the
 * sixty-four shades of every fade, `gen_palace_wall_colors` for a
 * palace -- so a pixel that is the average of two indices has no index
 * left to change and would stay bright through a `fade_out_2`. An
 * upscaler for this game may round a corner; it may not mix a colour.
 *
 * So this is AdvMAME's **Scale2x** and **Scale3x**, which fill a corner
 * with a neighbour's index when the two edges meeting there agree and
 * the diagonal does not, and copy the pixel otherwise. Nothing here
 * knows what the indices mean, which is why it survives a palette the
 * game rewrites underneath it.
 *
 * Nothing in `src/pop` is involved. The engine composes the same
 * 320x200 indexed surface it always did and hands it to `Display`;
 * this runs after that, on the way to the canvas, so `page-port.ts`
 * and every digest go on reading the surface itself.
 *
 * ## What else was tried, and what it cost
 *
 * Both were put beside Scale3x on the same six pictures -- the Prince
 * standing, the Prince running, a dungeon room, a palace room, a guard
 * and a torch -- and both lose:
 *
 * * **Eagle2x** (a corner takes the diagonal when all three of its
 *   neighbours agree) eats single pixels, and this art is full of
 *   them: the Prince's face flattened out and his hair became a blob.
 * * **xBR level 2 with the blending removed** -- the usual answer for
 *   a palette image -- came out thinner than the original everywhere
 *   and lost the shape of the torch handle. Without its blend the
 *   algorithm's own edge weighting has nothing to put at an edge but a
 *   neighbour's flat colour, and it takes more than it gives.
 */

/** 320x200 upscaled by this much, in each direction. */
export type UpscaleFactor = 1 | 2 | 3 | 6;

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
    const row1 = (y * 2 + 1) * w2;
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
    const row1 = (y * 3 + 1) * w3;
    const row2 = (y * 3 + 2) * w3;
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
 * The picture, `factor` times as big, in indices.
 *
 * 6 is Scale3x followed by Scale2x, which is the order that keeps the
 * most: Scale2x first would have to decide every corner twice, on a
 * picture its own first pass had already rounded.
 */
export function upscale(
  src: Uint8Array, width: number, height: number, factor: UpscaleFactor,
  out?: Uint8Array,
): Uint8Array {
  // `out` is the buffer from last time, where the caller kept one:
  // this runs on every tick that moved a pixel, and a fresh two
  // megabytes a tick is work for the collector and nothing else.
  const into = out?.length === width * height * factor * factor ? out : undefined;
  if (factor === 1) return src;
  if (factor === 2) return scale2x(src, width, height, into);
  if (factor === 3) return scale3x(src, width, height, into);
  return scale2x(scale3x(src, width, height), width * 3, height * 3, into);
}
