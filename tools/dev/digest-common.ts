/**
 * What moved from one tick to the next, the way `tools/oracle/digest.py`
 * reads it off a capture of the original.
 *
 * Four numbers and a count: the box around whatever changed, and how
 * many pixels of it there were. Not a picture, so the two sides can be
 * compared without either of them keeping one, and not a palette, so
 * the emulator's own colour rounding does not come into it.
 */
import type { Game } from '../../src/game/game.ts';
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
export async function digestOfRun(
  start: () => Promise<Game>,
  restart: (g: Game) => Promise<Game>,
  ticks: readonly Controls[],
): Promise<Moved[]> {
  let game = await start();
  const out: Moved[] = [];
  let prev: Uint8Array | null = null;
  for (let t = 0; t < ticks.length; t++) {
    if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
    game.step(ticks[t]);
    const due = game.restartDue;
    const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
    if (due) game = await restart(game);
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
