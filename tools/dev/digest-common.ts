/**
 * What moved from one tick to the next, the way `tools/oracle/digest.py`
 * reads it off a capture of the original.
 *
 * Four numbers and a count: the box around whatever changed, and how
 * many pixels of it there were. Not a picture, so the two sides can be
 * compared without either of them keeping one, and not a palette, so
 * the emulator's own colour rounding does not come into it.
 */
/**
 * What the scoring needs of a game, and no more.
 *
 * Two implementations answer to this now: the hand-written port in
 * `src/game` and the translation of SDLPoP in `src/pop`, which is
 * replacing it. Naming the four calls rather than the class is what
 * lets the same measurement judge both.
 */
export interface Playable {
  step(controls: Controls): void;
  render(): { toRgb(palette: Uint8Array): Uint8Array };
  pressButton(): void;
  readonly restartDue: boolean;
  readonly scene: { screenPalette: { toRgba(): Uint8Array } };
}
import type { Controls } from '../../src/game/kid.ts';

const W = 320;
const H = 200;

/** One tick: [x0, y0, x1, y1, pixels], or null if nothing moved. */
export type Moved = [number, number, number, number, number] | null;

/** A fire picks its next picture at random; neither side can match one. */
function flameMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const hot = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    for (const px of [a, b]) {
      const r = px[i * 3], g = px[i * 3 + 1], bl = px[i * 3 + 2];
      if (r > 140 && bl < 120 && r > bl + 60) { hot[i] = 1; break; }
    }
  }
  // Grown by two pixels, as the python does with its four rolls.
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (hot[i]) { out[i] = 1; continue; }
      for (const d of [-2, -1, 1, 2]) {
        const yy = (y + d + H) % H;
        const xx = (x + d + W) % W;
        if (hot[yy * W + x] || hot[y * W + xx]) { out[i] = 1; break; }
      }
    }
  }
  return out;
}

export function movedBetween(a: Uint8Array, b: Uint8Array): Moved {
  const mask = flameMask(a, b);
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (mask[i]) continue;
      const d = Math.max(
        Math.abs(a[i * 3] - b[i * 3]),
        Math.abs(a[i * 3 + 1] - b[i * 3 + 1]),
        Math.abs(a[i * 3 + 2] - b[i * 3 + 2]),
      );
      if (d <= 40) continue;
      n += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return n === 0 ? null : [x0, y0, x1, y1, n];
}

/** Replay a recording and say what moved on each of its ticks. */
export async function digestOfRun<T extends Playable>(
  start: () => Promise<T>,
  restart: (g: T) => Promise<T>,
  ticks: readonly Controls[],
): Promise<Moved[]> {
  let game = await start();
  const out: Moved[] = [];
  // The level's own first picture, before a tick has been played -- see
  // the same thing in `runOf`.
  let prev: Uint8Array | null =
    game.render().toRgb(game.scene.screenPalette.toRgba());
  out.push(null);
  for (let t = 0; t < ticks.length; t++) {
    if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
    game.step(ticks[t]);
    // The level is built again *before* the tick is drawn: the original
    // reads the button and shows the new level in the same tick -- see
    // `RESTART_DELAY`.
    if (game.restartDue) game = await restart(game);
    const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
    out.push(prev === null ? null : movedBetween(prev, rgb));
    prev = rgb;
  }
  return out;
}

/**
 * How many of the original's ticks the port agrees with.
 *
 * Within a tolerance on each edge of the box, and letting the alignment
 * slip: the emulator loses a little time whenever it redraws a room and
 * the keys go in on the clock rather than on the game's ticks, so a port
 * doing exactly the same thing is routinely a tick or two out, and over
 * a long run several. Measured on two captures of the same recording
 * from the original itself, which agree on 1412 of their 1470 ticks when
 * the alignment may slip and on 729 of them when it may not.
 */
export function agreement(
  dos: readonly Moved[], port: readonly Moved[], tolerance = 4, range = 8,
): number {
  // One offset for the whole run will not do and a free window at every
  // tick will not either: the drift is real and it is slow. Measured on
  // `13ab6867`, which the port reproduces almost exactly, it goes from
  // one tick to five over five hundred, a tick at a time. So: the
  // cheapest walk through the run, paying for a tick of drift what two
  // disagreements cost, which buys a drift that persists and not one
  // that jumps about to pick up a tick here and there.
  const SLIP = 2;
  /**
   * A room change is free to slip.
   *
   * The original spends three ticks on one -- the screen goes black,
   * nothing changes, the new room appears -- and the port spends two.
   * That one tick is a property of the redraw and not of the game (see
   * `ROOM_CHANGE_BLANK`), and paying for it out of the slip budget costs
   * the twenty ticks after every room change in the run. So the
   * alignment may move for nothing on a tick where the original
   * repainted the whole screen.
   */
  const wholeScreen = (m: Moved): boolean =>
    m !== null && m[0] <= 2 && m[1] <= 2 && m[2] >= 317 && m[3] >= 189;
  const offsets: number[] = [];
  for (let o = -range; o <= range; o++) offsets.push(o);
  // Only as far as the two runs both go. A capture runs on for a second
  // or two after the recording's last key, and counting those ticks
  // against the port is counting ticks it was never asked to play.
  const n = Math.min(dos.length, port.length);
  const m = offsets.length;
  if (n === 0) return 0;
  const cost = (i: number, j: number): number => {
    const k = i + offsets[j];
    if (k < 0 || k >= port.length) return 1;
    return sameMove(dos[i], port[k], tolerance) ? 0 : 1;
  };
  let best = offsets.map((_, j) => cost(0, j));
  const back: number[][] = [new Array(m).fill(0)];
  for (let i = 1; i < n; i++) {
    const next = new Array(m).fill(0);
    const from = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      let pick = j;
      let value = best[j];
      const slip = wholeScreen(dos[i]) ? 0 : SLIP;
      for (const k of [j - 1, j + 1]) {
        if (k >= 0 && k < m && best[k] + slip < value) {
          pick = k;
          value = best[k] + slip;
        }
      }
      next[j] = value + cost(i, j);
      from[j] = pick;
    }
    best = next;
    back.push(from);
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (best[k] < best[j]) j = k;
  let agreed = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (cost(i, j) === 0) agreed += 1;
    j = back[i][j];
  }
  return agreed;
}

function sameMove(a: Moved, b: Moved, tolerance: number): boolean {
  if (a === null || b === null) return a === b;
  for (let k = 0; k < 4; k++) {
    if (Math.abs(a[k] - b[k]) > tolerance) return false;
  }
  return true;
}

// ---------------------------------------------------------------- v2

/**
 * The exact comparison: is the port's picture the original's picture?
 *
 * `tools/oracle/digest.py` keeps, per tick, a CRC of the capture's
 * screen written as indices into the capture's own palette, with the
 * pixels that are on fire left out. The port can compute the same
 * number: map each of its pixels to the nearest colour in that palette,
 * blank the same mask, take the same CRC. Equal means the two pictures
 * are the same picture, to the pixel.
 *
 * Why indices and not colours. DOSBox's output, grabbed off an X
 * display and encoded, is a unit or three away from the port's idea of
 * the same colour -- 81,84,81 where the port has 84,84,84 -- so no
 * tolerance-free comparison of colours can work and no tolerance can be
 * folded into a hash. A capture uses two or three dozen colours and
 * they are far apart, so "which of those is this" is unambiguous.
 */
export interface Digest {
  version?: number;
  palette?: number[][];
  mask?: number[];
  /** Per tick, or null for a tick the capture does not have. */
  hash?: (number | null)[];
  ticks: Moved[];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The run-length mask from a digest, as one byte per pixel. */
export function unpackMask(runs: readonly number[]): Uint8Array {
  const out = new Uint8Array(W * H);
  let at = 0;
  let value = 0;
  for (const run of runs) {
    out.fill(value, at, at + run);
    at += run;
    value = value ? 0 : 1;
  }
  return out;
}

/**
 * Nearest-colour lookup into a capture's palette, for every colour the
 * port can produce. Built once per run: the port's palette changes with
 * the room, so the table is keyed on the colour itself.
 */
export class PaletteMap {
  private readonly palette: readonly number[][];
  private readonly cache = new Map<number, number>();

  constructor(palette: readonly number[][]) { this.palette = palette; }

  indexOf(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.palette.length; i++) {
      const p = this.palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    this.cache.set(key, best);
    return best;
  }
}

/** The fingerprint of one rendered frame, as `digest.py` computes it. */
export function fingerprint(rgb: Uint8Array, map: PaletteMap, mask: Uint8Array): number {
  const bytes = new Uint8Array(W * H * 2);
  for (let i = 0; i < W * H; i++) {
    const v = mask[i]
      ? 0xffff
      : map.indexOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >> 8) & 0xff;
  }
  return crc32(bytes);
}

/** The ticks on which what the player was holding changed. */
export function inputChanges(ticks: readonly Controls[]): Set<number> {
  const out = new Set<number>();
  for (let t = 1; t < ticks.length; t++) {
    const a = ticks[t - 1];
    const b = ticks[t];
    if (a.x !== b.x || a.y !== b.y || a.shift !== b.shift) out.add(t);
  }
  return out;
}

/** A replay's fingerprints and movement boxes, for a given digest. */
export interface Run {
  readonly hash: number[];
  readonly moved: Moved[];
}

export async function runOf<T extends Playable>(
  start: () => Promise<T>,
  restart: (g: T) => Promise<T>,
  ticks: readonly Controls[],
  digest: Digest,
): Promise<Run> {
  const mask = digest.mask ? unpackMask(digest.mask) : new Uint8Array(W * H);
  const map = new PaletteMap(digest.palette ?? []);
  let game = await start();
  const hash: number[] = [];
  const moved: Moved[] = [];
  let prev: Uint8Array | null = null;
  /**
   * The level's own first picture, before a single tick has been
   * played.
   *
   * The original draws the level as soon as it has built it and only
   * then starts the clock, so the opening picture is on the screen for
   * two frames: the one it was drawn on, and the one the first tick
   * does nothing in (`pendingFirstTick`). Ending a level again mid-run
   * shows both -- the capture of `probeF` has the restarted level's
   * first frame twice, on ticks 431 and 432 -- but at the start of a
   * recording this loop used to step first and draw after, so the port
   * had only one of them and everything the level said about itself
   * came a tick early. That was three ticks of every run scored wrong,
   * and it was the measurement, not the game.
   *
   * `split_ticks --anchor-text 25` numbers the capture to match: the
   * tick the level's number goes off the bottom of the screen is the
   * twenty-fifth after this one.
   */
  {
    const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
    hash.push(digest.palette ? fingerprint(rgb, map, mask) : 0);
    moved.push(null);
    prev = rgb;
  }
  for (let t = 0; t < ticks.length; t++) {
    if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
    game.step(ticks[t]);
    // The level is built again *before* the tick is drawn: the original
    // reads the button and shows the new level in the same tick -- see
    // `RESTART_DELAY`.
    if (game.restartDue) game = await restart(game);
    const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
    hash.push(digest.palette ? fingerprint(rgb, map, mask) : 0);
    moved.push(prev === null ? null : movedBetween(prev, rgb));
    prev = rgb;
  }
  return { hash, moved };
}

/**
 * How many ticks the two runs are the same picture on.
 *
 * The same walk as `agreement`, but the cost of a tick is nought when
 * the fingerprints are equal and one when they are not. The alignment
 * may still slip, and still slips for nothing where the original
 * repainted the whole screen: the original holds a room change black
 * for one tick longer than the port, which is the display's doing and
 * not the game's -- see `ROOM_CHANGE_BLANK`.
 */
export function exactAgreement(
  digest: Digest, port: Run, freeSlipAt: ReadonlySet<number> = new Set(), range = 16,
): { agreed: number; ticks: number; drift: number[] } {
  const dos = digest.hash ?? [];
  const n = Math.min(dos.length, port.hash.length);
  if (n === 0) return { agreed: 0, ticks: 0, drift: [] };
  const have = dos.slice(0, n).filter((h) => h !== null).length;
  const SLIP = 2;
  const wholeScreen = (m: Moved): boolean =>
    m !== null && m[0] <= 2 && m[1] <= 2 && m[2] >= 317 && m[3] >= 189;
  const offsets: number[] = [];
  for (let o = -range; o <= range; o++) offsets.push(o);
  const m = offsets.length;
  const cost = (i: number, j: number): number => {
    const k = i + offsets[j];
    if (k < 0 || k >= port.hash.length) return 1;
    return dos[i] !== null && dos[i] === port.hash[k] ? 0 : 1;
  };
  let best = offsets.map((_, j) => cost(0, j));
  const back: number[][] = [new Array(m).fill(0)];
  for (let i = 1; i < n; i++) {
    const next = new Array(m).fill(0);
    const from = new Array(m).fill(0);
    // Free where the harness cannot be more precise than a tick: a
    // room change, which the original holds black one tick longer than
    // the port, and a tick on which the player's keys changed, because
    // the emulator is sent the edge on the clock and the game reads the
    // keyboard on its own tick -- see `recording_to_script.mjs`.
    /**
     * And free across a tick the capture repeats.
     *
     * `split_ticks` numbers the capture by the game's own clock and
     * leaves a slot wherever it saw no change, so a capture can carry
     * more tick slots than it has pictures: `13ab6867` is 734 slots
     * over 730 changes, and the three it repeats are at 161, 482 and
     * 500. The port gains a tick against it at exactly 483 and 501.
     * A repeated picture says nothing about when anything happened,
     * so stepping over it must not be charged for.
     */
    const repeat = (k: number): boolean => dos[k] != null && dos[k] === dos[k - 1];
    const repeated = repeat(i - 1) || repeat(i) || repeat(i + 1);
    const slip = repeated || wholeScreen(digest.ticks[i]) || freeSlipAt.has(i)
      || freeSlipAt.has(i - 1) || freeSlipAt.has(i + 1) ? 0 : SLIP;
    for (let j = 0; j < m; j++) {
      let pick = j;
      let value = best[j];
      for (const k of [j - 1, j + 1]) {
        if (k >= 0 && k < m && best[k] + slip < value) { pick = k; value = best[k] + slip; }
      }
      next[j] = value + cost(i, j);
      from[j] = pick;
    }
    best = next;
    back.push(from);
  }
  let j = 0;
  for (let k = 1; k < m; k++) if (best[k] < best[j]) j = k;
  const drift = new Array<number>(n).fill(0);
  let agreed = 0;
  for (let i = n - 1; i >= 0; i--) {
    drift[i] = offsets[j];
    if (cost(i, j) === 0) agreed += 1;
    j = back[i][j];
  }
  return { agreed, ticks: have, drift };
}
