/**
 * Replay a recording made in the browser, and say where it disagrees.
 *
 *   node --experimental-strip-types tools/dev/replay.ts <recording.json>
 *
 * The game is deterministic, so feeding the recorded keys back in has to
 * reproduce the recorded states exactly. If it does, the recording is a
 * faithful account of the session and can be turned into a test. If it
 * does not, either the engine has changed since the recording was made --
 * which is what makes these useful as regression tests -- or the page is
 * feeding the game something other than what it recorded, which is a bug
 * in the page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');

const path = process.argv[2];
if (!path) {
  console.error('usage: replay.ts <recording.json> [--verbose]');
  process.exit(2);
}
const verbose = process.argv.includes('--verbose');
const rec = parseRecording(readFileSync(path, 'utf8'));
const ticks = decodeTimeline(rec.timeline);

console.log(`${path}`);
console.log(`  recorded ${rec.recordedAt || 'at an unknown time'} on level ${rec.level}`);
console.log(`  ${ticks.length} ticks, ${rec.events.length} key events, `
  + `${rec.states.length} recorded states`);

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const game = await Game.start(assets, exe, rec.level);

let mismatches = 0;
let first = -1;
for (let t = 0; t < ticks.length; t++) {
  game.step(ticks[t]);
  const want = rec.states[t];
  const got = {
    frame: game.kid.frame, room: game.kid.room,
    x: game.kid.x, y: game.kid.y, hitPoints: game.hitPoints,
  };
  if (verbose) {
    console.log(`  t${String(t).padStart(4)} frame ${String(got.frame).padStart(3)} `
      + `room ${got.room} x ${got.x} y ${got.y} hp ${got.hitPoints}`);
  }
  if (!want) continue;
  const same = want.frame === got.frame && want.room === got.room
    && want.x === got.x && want.y === got.y && want.hitPoints === got.hitPoints;
  if (same) continue;
  mismatches++;
  if (first < 0) {
    first = t;
    console.log(`  first disagreement at tick ${t}:`);
    console.log(`    recorded  frame ${want.frame} room ${want.room} `
      + `x ${want.x} y ${want.y} hp ${want.hitPoints}`);
    console.log(`    replayed  frame ${got.frame} room ${got.room} `
      + `x ${got.x} y ${got.y} hp ${got.hitPoints}`);
  }
}

if (!rec.states.length) console.log('  no states recorded; nothing to check the replay against');
else if (mismatches === 0) console.log('  the replay matches the recording exactly');
else console.log(`  ${mismatches} of ${rec.states.length} ticks disagree`);

// How long each press waited for a step, which is what "late" means here.
const downs = rec.events.filter((e) => e.type === 'down');
if (downs.length) {
  const perTick = 1000 / rec.ticksPerSecond;
  const waits = downs.map((e) => {
    const tickStart = e.tick * perTick;
    return Math.max(0, Math.min(perTick, e.ms - tickStart));
  });
  const mean = waits.reduce((a, b) => a + b, 0) / waits.length;
  console.log(`  ${downs.length} presses; each waited about `
    + `${mean.toFixed(0)}ms for the next step, at most ${perTick.toFixed(0)}ms`);
}
