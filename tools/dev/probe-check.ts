/**
 * Is this probe worth capturing?
 *
 *   npx tsx tools/dev/probe-check.ts <level> '<timeline>' [--seed N] [--px 300]
 *
 * A capture costs two to five minutes of wall clock and nothing else
 * may run on the machine while it does, so it is worth knowing before
 * taking one whether the run it is of can be adjudicated at all. Three
 * things decide that, and this prints all three.
 *
 * **Does it stay out of trouble.** A fight cannot be measured -- a
 * guard's every choice comes out of `prandom`, which the original
 * seeds from its own clock -- and a Prince who dies early draws the
 * same picture for the rest of the run. The first lines say which
 * rooms the run visits, how many distinct pictures it draws, and the
 * tick he died or met a guard on.
 *
 * **Is it robust.** The oracle cannot place a key edge to better than
 * a tick: `tools/oracle/README.md` is mostly the history of that one
 * fact. So every control of every edge is moved a tick either way and
 * the run compared with itself. A probe whose worst such move leaves
 * the run alone is measuring the game; one whose worst move changes
 * half of it is measuring the schedule. For calibration, the two
 * probes the port draws exactly:
 *
 *     palace4   mean 0.973   worst 0.758
 *     level2    mean 0.975   worst 0.833
 *
 * and a route found by random search scores about 0.93 and 0.5. Aim
 * for a mean of 0.95 and up.
 *
 * **Can the original reproduce it.** `prandom` seeds itself from the
 * clock on its first roll, so a torch's flame, a potion's bubbles,
 * the delays on level 13's falling floors and a guard's every choice
 * differ between two runs of the original and no capture can settle
 * them. The run is rendered twice at two seeds and the ticks that
 * differ by more than `--px` pixels are listed. A torch is about
 * forty pixels and the digest masks torches, so the default of 300
 * is "bigger than a flame". Level 13's first twenty ticks fail this,
 * which is why its probe can never be exact.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { decodeTimeline } from '../../src/game/recording.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const argv = process.argv.slice(2);
const opt = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const level = Number(argv[0]);
const timeline = argv[1];
if (!Number.isFinite(level) || !timeline) {
  console.error("usage: probe-check.ts <level> '<timeline>' [--seed N] [--px 300]");
  process.exit(2);
}
const seed2 = Number(opt('seed', '77777'));
/**
 * `--cheat 40:j` -- one of `process_key`'s cheats, on a tick.
 *
 * Half the game is behind something a short route cannot reach, and
 * `megahit` is how the original itself reaches it: H, J, U and N draw
 * a room the Prince is not in, which is how a capture is shown the
 * shadow of level 5, 6 or 12, or Jaffar. Repeat the option for each.
 */
const cheats = new Map<number, string[]>();
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--cheat') continue;
  const [t, key] = argv[i + 1].split(':');
  const at = Number(t);
  const had = cheats.get(at);
  if (had) had.push(key); else cheats.set(at, [key]);
}
const bigPixels = Number(opt('px', '300'));

type Controls = { x: number; y: number; shift: boolean };

interface Run { sig: string[]; died: number; guard: number; rooms: number[] }

async function sim(ticks: Controls[]): Promise<Run> {
  const game = await PopGame.start(assets, exe, level);
  const sig: string[] = [];
  const rooms = new Set<number>();
  let died = -1;
  let guard = -1;
  for (let t = 0; t < ticks.length; t++) {
    for (const key of cheats.get(t) ?? []) game.cheat(key);
    game.step(ticks[t]);
    rooms.add(g.drawn_room);
    sig.push(`${g.drawn_room},${g.Kid.x},${g.Kid.y},${g.Kid.frame},${g.Kid.direction},`
      + `${g.Guard.frame},${g.Guard.x},${g.hitp_curr}`);
    if (g.Kid.alive >= 0 && died < 0) died = t;
    /**
     * Anybody in the room with him, whatever he is.
     *
     * This asked for `charid === 0` first, which is the Prince's own
     * id and never a guard's -- an ordinary guard is
     * `charid_2_guard`, the shadow is 1, the skeleton 3 and Jaffar
     * 4 -- so it never fired. `level5` was designed and captured
     * with a guard of skill 3 standing twenty units from the Prince
     * for a hundred ticks of it, and its nineteen remaining ticks
     * begin while the Prince is doing nothing at all.
     */
    if (guard < 0 && g.Guard.direction !== 0x56 && g.Guard.alive !== 0
      && g.Guard.room === g.Kid.room) guard = t;
  }
  return { sig, died, guard, rooms: [...rooms].sort((a, b) => a - b) };
}

/** Every tick at which any of the three controls changed. */
function edgesOf(ticks: Controls[]): number[] {
  const e: number[] = [];
  for (let t = 1; t < ticks.length; t++) {
    const a = ticks[t - 1];
    const b = ticks[t];
    if (a.x !== b.x || a.y !== b.y || a.shift !== b.shift) e.push(t);
  }
  return e;
}

/**
 * One control of one edge moved by `by` ticks, which is what
 * `which-key.ts` does to a recording. A player who presses two keys
 * in the same thousandth of a second makes one edge and the emulator
 * can read them in two different ticks, so the three are moved apart.
 */
function shiftControl(
  ticks: Controls[], t: number, which: keyof Controls, by: number,
): Controls[] | null {
  const nt = t + by;
  if (nt < 1 || nt >= ticks.length) return null;
  const a = ticks.map((c) => ({ ...c }));
  const before = ticks[t - 1][which];
  const after = ticks[t][which];
  if (by < 0) for (let i = nt; i < t; i++) (a[i] as Record<string, unknown>)[which] = after;
  else for (let i = t; i < nt; i++) (a[i] as Record<string, unknown>)[which] = before;
  return a;
}

function agree(a: string[], b: string[]): number {
  const m = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < m; i++) if (a[i] === b[i]) s++;
  return s / Math.max(a.length, b.length);
}

const ticks = decodeTimeline(timeline) as Controls[];
const base = await sim(ticks);
console.log(`level ${level}, ${ticks.length} ticks, ${edgesOf(ticks).length} edges`);
console.log(`  rooms ${base.rooms.join(',')}  distinct pictures ${new Set(base.sig).size}`
  + `  died ${base.died}  guard ${base.guard}`);

let total = 0;
let n = 0;
let worst = 1;
let worstAt = '';
for (const t of edgesOf(ticks)) {
  for (const which of ['x', 'y', 'shift'] as (keyof Controls)[]) {
    if (ticks[t][which] === ticks[t - 1][which]) continue;
    for (const by of [-1, 1]) {
      const v = shiftControl(ticks, t, which, by);
      if (!v) continue;
      n++;
      const a = agree((await sim(v)).sig, base.sig);
      total += a;
      if (a < worst) { worst = a; worstAt = `${which}@${t}${by > 0 ? '+' : ''}${by}`; }
    }
  }
}
console.log(`  robustness over ${n} moves: mean ${(n ? total / n : 1).toFixed(4)},`
  + ` worst ${worst.toFixed(4)}${worstAt ? ` at ${worstAt}` : ''}`
  + '   (palace4 is 0.973/0.758, level2 0.975/0.833)');

/** The same run at another seed, rendered, to find what the original cannot repeat. */
async function render(seed: number): Promise<Uint8Array[]> {
  const game = await PopGame.start(assets, exe, level, { seed });
  const out: Uint8Array[] = [];
  for (let t = 0; t < ticks.length; t++) {
    for (const key of cheats.get(t) ?? []) game.cheat(key);
    game.step(ticks[t]);
    out.push(Uint8Array.from(game.render().pixels));
  }
  return out;
}
const one = await render(1);
const two = await render(seed2);
const loud: string[] = [];
for (let t = 0; t < ticks.length; t++) {
  let d = 0;
  let x0 = 1e9; let y0 = 1e9; let x1 = -1; let y1 = -1;
  const a = one[t];
  const b = two[t];
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    d++;
    const x = i % 320;
    const y = (i / 320) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (d > bigPixels) loud.push(`${t}:${d}px(${x0}-${x1},${y0}-${y1})`);
}
console.log(`  seeds 1 and ${seed2} differ by more than ${bigPixels} pixels on`
  + ` ${loud.length} ticks${loud.length ? `: ${loud.slice(0, 12).join(' ')}` : ''}`
  + `${loud.length > 12 ? ` ... ${loud.length - 12} more` : ''}`);
