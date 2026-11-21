/**
 * The art, traced into outlines.
 *
 * `upscale.ts` enlarges the picture by looking at a 3x3 neighbourhood,
 * which can round a corner but can never make an edge that is not on
 * the pixel grid. This makes one that is: every region of one palette
 * index becomes a closed outline, and the outline is drawn at whatever
 * size the canvas is.
 *
 * **The one rule is the upscaler's rule.** The game is drawn in palette
 * **indices** and the palette moves while it plays -- `set_bg_attr` for
 * the flash, sixty-four shades of every fade, `gen_palace_wall_colors`
 * for a palace -- so a shape here carries the **index** it was traced
 * from and nothing else. The colour is looked up when it is drawn, out
 * of the palette that is live at that moment.
 *
 * Three things decide whether a trace of pixel art looks right, and all
 * three are measured in `tests/render/vectorize.test.ts`:
 *
 * * **Nothing may be lost.** A one-pixel speck is a feature in this art
 *   -- the round that tried Eagle2x lost the Prince's face to exactly
 *   that -- so every region is traced however small it is.
 * * **No seams.** Two regions that share a boundary, traced
 *   independently and filled, leave a hairline of background between
 *   them in every rasterizer there is. So the layers are **stacked**:
 *   layer k is the union of its own index and every index drawn after
 *   it, and each one paints over the last. The partition is rebuilt
 *   exactly and there is nothing between them to show through.
 * * **A corner is not a staircase.** A boundary that steps one pixel at
 *   a time is a line the artist drew at an angle; a boundary that turns
 *   after a long run is a corner they meant. `CORNER_RUN` is where the
 *   one becomes the other.
 */

/**
 * How far a simplified edge may stray from the staircase it replaces.
 *
 * This is the number the whole thing turns on, and the first attempt
 * did not have it: rounding every single-pixel step gives a **chain of
 * beads** down every diagonal, because a one-pixel step rounded is a
 * bulge and a diagonal is nothing but one-pixel steps. A diagonal is a
 * line the artist drew, so it has to become one segment before anything
 * is rounded.
 *
 * The corners of the lattice path of a 45-degree boundary sit
 * `1/sqrt(2)` = 0.707 either side of the line they describe, so the
 * tolerance has to be above that. **One pixel**, measured: at 0.75 a
 * blade drawn as a staircase of two-pixel steps -- the Prince's sword
 * in frames 569 and 570 -- could not be straightened and came out a
 * wave, and at 1.4 a shoulder started to lose its notch. A single
 * pixel is never lost to it, because `simplify` will not take a loop
 * below four points.
 */
export const TOLERANCE = 1;

/**
 * Both arms this long make a turn a corner that is left sharp.
 *
 * It is **nought**, which is to say there is no such rule, and that is
 * measured rather than chosen: with the radius capped at half the
 * shorter arm, a corner between two long edges is already only
 * softened by a pixel, while a rule that kept such turns sharp left
 * the Prince's head a staircase -- his hair is drawn in runs of three
 * and four pixels, so every turn in it counted as a corner. Three
 * settings were put side by side on one sheet and looked at; this is
 * the one that won.
 */
export const CORNER_RUN = 0;

/**
 * The largest radius, in pixels, that a smoothed turn may be given.
 *
 * It is a **distance**, not a fraction of the arm, and that is the
 * second thing the first attempt had wrong: at half of each arm a
 * one-pixel feature rounds into a circle, and the lighter shade the
 * artist dithered along the Prince's edge is a chain of single pixels.
 * Rounded at half an arm they came out as a **string of beads** down
 * his back. The radius is `min(ROUND, half the shorter arm)`, so a
 * long edge is softened and a single pixel is barely touched.
 */
export const ROUND = 1;

/** A loop no bigger than this is drawn as it is: a speck is a speck. */
export const SPECK = 2.5;

export interface VectorLayer {
  /** The palette index this layer is filled with. */
  readonly index: number;
  /** SVG path data in pixel coordinates, 0..width and 0..height. */
  readonly path: string;
}

export interface VectorSprite {
  readonly width: number;
  readonly height: number;
  /** Drawn in order; each paints over the ones before it. */
  readonly layers: readonly VectorLayer[];
}

export interface VectorOptions {
  /** The index that is not drawn at all. Sprites: 0. Backgrounds: none. */
  readonly transparent?: number;
  /** Straight staircase, no curves, for the test that checks the shape. */
  readonly sharp?: boolean;
  /** How far a simplified edge may stray; 0 keeps every lattice corner. */
  readonly tolerance?: number;
  /** The largest radius a turn may be rounded by, in pixels. */
  readonly round?: number;
  /** Both arms this long make a turn a corner; 0 rounds every turn. */
  readonly cornerRun?: number;
}

/** x, y pairs round a closed loop of unit, axis-aligned steps. */
type Loop = number[];

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * The boundary of a mask, as closed loops of lattice points.
 *
 * Each unit edge between an inside pixel and an outside one is directed
 * so that the inside is on its left in a y-down system, which makes an
 * outer loop run clockwise on the screen and a hole run the other way.
 * SVG's nonzero rule then takes the holes out without being told.
 *
 * Where two regions touch only at a corner the vertex has two ways on,
 * and the turn chosen is the **right-hand** one, which reads the
 * diagonal as joined -- which is how an eye reads pixel art.
 */
function trace(mask: Uint8Array, w: number, h: number): Loop[] {
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  // Outgoing edges by vertex. A vertex is (x, y) on the (w+1)*(h+1)
  // lattice; `edges[v]` holds the directions leaving it.
  const stride = w + 1;
  const edges = new Map<number, number[]>();
  const add = (x: number, y: number, dir: number): void => {
    const v = y * stride + x;
    const at = edges.get(v);
    if (at) at.push(dir); else edges.set(v, [dir]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, 0);          // top, rightwards
      if (!inside(x + 1, y)) add(x + 1, y, 1);      // right, downwards
      if (!inside(x, y + 1)) add(x + 1, y + 1, 2);  // bottom, leftwards
      if (!inside(x - 1, y)) add(x, y + 1, 3);      // left, upwards
    }
  }

  const loops: Loop[] = [];
  const take = (v: number, dir: number): boolean => {
    const at = edges.get(v);
    if (!at) return false;
    const i = at.indexOf(dir);
    if (i < 0) return false;
    at.splice(i, 1);
    if (at.length === 0) edges.delete(v);
    return true;
  };

  while (edges.size > 0) {
    const first = edges.keys().next().value as number;
    const dir0 = edges.get(first)![0]!;
    let x = first % stride;
    let y = (first - x) / stride;
    let dir = dir0;
    take(first, dir);
    const loop: Loop = [x, y];
    for (;;) {
      x += DX[dir]!;
      y += DY[dir]!;
      if (x === loop[0] && y === loop[1]) break;
      loop.push(x, y);
      const v = y * stride + x;
      // Right turn, then straight on, then left: the right-hand rule.
      const want = [(dir + 1) % 4, dir, (dir + 3) % 4];
      let next = -1;
      for (const d of want) if (take(v, d)) { next = d; break; }
      if (next < 0) break;
      dir = next;
    }
    // Close the first edge's own vertex if the walk came back to it.
    if (loop.length >= 8) loops.push(loop);
    else if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

/** The loop with every run of collinear steps merged into one segment. */
function corners(loop: Loop): Loop {
  const n = loop.length / 2;
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const px = loop[((i + n - 1) % n) * 2]!;
    const py = loop[((i + n - 1) % n) * 2 + 1]!;
    const x = loop[i * 2]!;
    const y = loop[i * 2 + 1]!;
    const nx = loop[((i + 1) % n) * 2]!;
    const ny = loop[((i + 1) % n) * 2 + 1]!;
    // Keep the point only where the direction changes.
    if ((x - px) * (ny - y) !== (y - py) * (nx - x)) out.push(x, y);
  }
  return out;
}

/**
 * Douglas-Peucker over a closed loop.
 *
 * A loop has no ends to anchor on, so the two anchors are the first
 * point and the point furthest from it, and each arc between them is
 * simplified on its own. **A loop never drops below four points**: a
 * single pixel is four corners each 0.707 from the diagonal across it,
 * which is inside the tolerance, and this art is full of single pixels
 * -- the round that tried Eagle2x lost the Prince's face to exactly
 * that kind of erasure.
 */
function simplify(poly: Loop, tol: number): Loop {
  const n = poly.length / 2;
  if (n <= 4) return poly;
  const px = (i: number): number => poly[i * 2]!;
  const py = (i: number): number => poly[i * 2 + 1]!;

  let far = 0; let best = -1;
  for (let i = 1; i < n; i++) {
    const d = (px(i) - px(0)) ** 2 + (py(i) - py(0)) ** 2;
    if (d > best) { best = d; far = i; }
  }

  const keep = new Uint8Array(n);
  keep[0] = 1; keep[far] = 1;
  const walk = (a: number, b: number): void => {
    // Indices run a+1 .. b-1 round the loop.
    const span = (b - a + n) % n;
    if (span < 2) return;
    const ax = px(a); const ay = py(a);
    const ex = px(b % n) - ax; const ey = py(b % n) - ay;
    const elen = Math.hypot(ex, ey);
    let worst = -1; let at = -1;
    for (let k = 1; k < span; k++) {
      const i = (a + k) % n;
      const dx = px(i) - ax; const dy = py(i) - ay;
      const d = elen === 0
        ? Math.hypot(dx, dy)
        : Math.abs(dx * ey - dy * ex) / elen;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst <= tol || at < 0) return;
    keep[at] = 1;
    walk(a, (at - a + n) % n + a);
    walk(at, b);
  };
  walk(0, far);
  walk(far, n);

  const out: Loop = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(px(i), py(i));
  return out.length >= 8 ? out : poly;
}

function emit(poly: Loop, sharp: boolean, rMax: number, run: number): string {
  const n = poly.length / 2;
  if (n < 3) return '';
  const at = (i: number): [number, number] => [poly[i * 2]!, poly[i * 2 + 1]!];

  if (sharp || area(poly) <= SPECK) {
    let d = `M${poly[0]} ${poly[1]}`;
    for (let i = 1; i < n; i++) d += `L${poly[i * 2]} ${poly[i * 2 + 1]}`;
    return `${d}Z`;
  }

  const len = (i: number, j: number): number => Math.hypot(
    poly[j * 2]! - poly[i * 2]!, poly[j * 2 + 1]! - poly[i * 2 + 1]!,
  );
  // A turn between two long arms is a corner the artist meant and is
  // left sharp; everything else is softened, by at most half of its
  // shorter arm so that two neighbouring curves can never cross.
  const arm: number[] = [];
  const sharpAt: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = len((i + n - 1) % n, i);
    const b = len(i, (i + 1) % n);
    arm.push(Math.min(a, b) / 2);
    sharpAt.push(run > 0 && a >= run && b >= run);
  }
  const radius = (i: number): number => (sharpAt[i] ? 0 : Math.min(rMax, arm[i]!));

  /** The point `r` pixels back from vertex i towards vertex j. */
  const back = (i: number, j: number, r: number): [number, number] => {
    const [ax, ay] = at(i); const [bx, by] = at(j);
    const d = Math.hypot(bx - ax, by - ay) || 1;
    return [ax + ((bx - ax) / d) * r, ay + ((by - ay) / d) * r];
  };

  const parts: string[] = [];
  const first = radius(0) > 0 ? back(0, (n - 1) % n, radius(0)) : at(0);
  parts.push(`M${round(first[0])} ${round(first[1])}`);
  for (let k = 0; k < n; k++) {
    const next = (k + 1) % n;
    const r = radius(next);
    if (r <= 0) {
      const [x, y] = at(next);
      parts.push(`L${round(x)} ${round(y)}`);
      continue;
    }
    const a = back(next, k, r);
    const b = back(next, (next + 1) % n, r);
    const [vx, vy] = at(next);
    parts.push(`L${round(a[0])} ${round(a[1])}`);
    parts.push(`Q${round(vx)} ${round(vy)} ${round(b[0])} ${round(b[1])}`);
  }
  parts.push('Z');
  return parts.join('');
}

/** The shoelace area of a loop, unsigned. */
function area(poly: Loop): number {
  const n = poly.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i * 2]! * poly[j * 2 + 1]! - poly[j * 2]! * poly[i * 2 + 1]!;
  }
  return Math.abs(a) / 2;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * One sprite, as stacked outlines.
 *
 * The order is biggest region first, so the silhouette is traced once
 * as one shape and the small details go on top of it.
 */
export function vectorize(
  pixels: Uint8Array, width: number, height: number, opts: VectorOptions = {},
): VectorSprite {
  const transparent = opts.transparent;
  const area = new Map<number, number>();
  for (const v of pixels) {
    if (v === transparent) continue;
    area.set(v, (area.get(v) ?? 0) + 1);
  }
  const order = [...area.keys()].sort((a, b) => (area.get(b)! - area.get(a)!) || (a - b));

  const layers: VectorLayer[] = [];
  const mask = new Uint8Array(width * height);
  const live = new Set(order);
  for (const index of order) {
    mask.fill(0);
    for (let i = 0; i < pixels.length; i++) if (live.has(pixels[i]!)) mask[i] = 1;
    const loops = trace(mask, width, height);
    const tol = opts.sharp === true ? 0 : (opts.tolerance ?? TOLERANCE);
    const rMax = opts.round ?? ROUND;
    const run = opts.cornerRun ?? CORNER_RUN;
    const path = loops
      .map((l) => emit(
        tol > 0 ? simplify(corners(l), tol) : corners(l), opts.sharp === true, rMax, run,
      ))
      .join('');
    if (path !== '') layers.push({ index, path });
    live.delete(index);
  }
  return { width, height, layers };
}
