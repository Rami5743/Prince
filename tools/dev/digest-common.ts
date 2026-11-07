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
 * doing exactly the same thing is routinely a tick or two out. Measured
 * on two captures of the same recording from the original itself, which
 * agree on 1412 of their 1470 ticks this way and on 729 of them if the
 * alignment is not allowed to move at all.
 */
export function agreement(
  dos: readonly Moved[], port: readonly Moved[], tolerance = 4, slip = 3,
): number {
  let agreed = 0;
  for (let i = 0; i < dos.length; i++) {
    for (let d = -slip; d <= slip; d++) {
      const j = i + d;
      if (j < 0 || j >= port.length) continue;
      if (sameMove(dos[i], port[j], tolerance)) { agreed += 1; break; }
    }
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
