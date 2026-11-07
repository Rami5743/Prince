/**
 * Developer tool: what the original draws over the Prince, and where.
 *
 *   node --experimental-strip-types tools/dev/occlusion.ts \
 *       <recording.json> <capture dir> <from tick> <to tick> [out.json]
 *
 * The frame-by-frame comparison of a whole recording answers two
 * questions at once -- is the port in the same place at the same moment,
 * and does it draw what is there the same way -- and the first drowns the
 * second. A room change costs the emulator a couple of ticks, a keypress
 * of two ticks is a coin toss, and after either of those every tick
 * differs for reasons that have nothing to do with drawing.
 *
 * This separates them. For each captured tick it replays the port to the
 * tick that fits best, then searches a small neighbourhood of character
 * states -- the frame, the position, the facing -- for the one that
 * reproduces the capture. What comes out is one of two things:
 *
 * * a state that reproduces it, give or take the torches, in which case
 *   the port draws that moment exactly as the original does and the pair
 *   is worth keeping as a test; or
 * * no state that does, in which case something other than where he is
 *   standing is wrong, and that is the interesting case.
 *
 * `--pin` writes the states that were recovered to a JSON file, which is
 * what `tests/render/occlusion.test.ts` reads.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/**
 * A difference this small is the torches and nothing else: their flames
 * pick their next picture at random and the two runs can never agree.
 * Measured over the ticks where everything else matches exactly.
 */
export const TORCH_NOISE = 170;

const recPath = process.argv[2];
const capDir = process.argv[3];
const from = Number(process.argv[4] ?? 0);
const to = Number(process.argv[5] ?? from);
const pinTo = process.argv[6];

const rec = parseRecording(readFileSync(recPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);

function capture(tick: number): PNG | null {
  const f = join(capDir, `t${String(tick).padStart(5, '0')}.png`);
  return existsSync(f) ? PNG.sync.read(readFileSync(f)) : null;
}

/** Replay from the start to `tick`, restarting the level when it falls due. */
async function replayTo(tick: number): Promise<Game> {
  let game = await Game.start(assets, exe, rec.level);
  for (let t = 0; t <= tick && t < ticks.length; t++) {
    game.step(ticks[t]);
    if (game.restartDue) game = await game.restart(assets, exe);
  }
  return game;
}

function differsFrom(game: Game, want: PNG): number {
  const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
  let n = 0;
  for (let y = 0; y < 192; y++) {
    for (let x = 0; x < 320; x++) {
      const i = y * 320 + x;
      const d = Math.abs(rgb[i * 3] - want.data[i * 4])
        + Math.abs(rgb[i * 3 + 1] - want.data[i * 4 + 1])
        + Math.abs(rgb[i * 3 + 2] - want.data[i * 4 + 2]);
      if (d > 30) n++;
    }
  }
  return n;
}

interface Case {
  tick: number;
  portTick: number;
  room: number;
  row: number;
  frame: number;
  x: number;
  y: number;
  direction: number;
  differs: number;
}

const pinned: Case[] = [];
for (let tick = from; tick <= to; tick++) {
  const want = capture(tick);
  if (!want) continue;
  // The port's own best tick, to start the search from.
  let best = { n: Infinity, u: tick };
  for (let u = Math.max(0, tick - 4); u <= tick + 4 && u < ticks.length; u++) {
    const g = await replayTo(u);
    const n = differsFrom(g, want);
    if (n < best.n) best = { n, u };
  }
  const game = await replayTo(best.u);
  const kid = game.kid;
  const base = { frame: kid.frame, x: kid.x, y: kid.y, direction: kid.direction };
  let found = { n: best.n, ...base };
  for (const direction of [base.direction, base.direction === 0 ? -1 : 0]) {
    for (let f = Math.max(1, base.frame - 10); f <= base.frame + 10; f++) {
      if (!game.tables.frameTableKid[f] || game.tables.frameTableKid[f].image === 255) continue;
      for (let dx = -10; dx <= 10; dx++) {
        kid.frame = f; kid.x = (base.x + dx) & 0xff; kid.direction = direction;
        const n = differsFrom(game, want);
        if (n < found.n) found = { n, frame: f, x: base.x + dx, y: base.y, direction };
      }
    }
  }
  kid.frame = found.frame; kid.x = found.x & 0xff; kid.direction = found.direction;
  const ok = found.n <= TORCH_NOISE;
  console.log(
    `t${tick}: ${ok ? 'drawn alike' : 'DIFFERENT'} ${found.n} px`
    + ` (port tick ${best.u}, room ${kid.room} row ${kid.currentRow}`
    + ` frame ${found.frame} x ${found.x} y ${found.y} dir ${found.direction})`,
  );
  if (ok) {
    pinned.push({
      tick, portTick: best.u, room: kid.room, row: kid.currentRow,
      frame: found.frame, x: found.x & 0xff, y: found.y,
      direction: found.direction, differs: found.n,
    });
  }
}

if (pinTo) {
  writeFileSync(pinTo, `${JSON.stringify(pinned, null, 2)}\n`);
  console.log(`${pinned.length} states written to ${pinTo}`);
}
