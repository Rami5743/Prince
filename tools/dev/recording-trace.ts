/**
 * Replay a recording and print a line whenever the Prince's state changes.
 *
 *   node --experimental-strip-types tools/dev/recording-trace.ts <rec.json>
 *
 * This is the port's side of a frame-for-frame comparison with the
 * original: it says which tick he was in which room, on which frame, and
 * what the guard was doing, so a difference seen in the pictures can be
 * tied to a tick and a piece of state.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const path = process.argv[2];
if (!path) {
  console.error('usage: recording-trace.ts <recording.json> [--all]');
  process.exit(2);
}
const all = process.argv.includes('--all');
const rec = parseRecording(readFileSync(path, 'utf8'));
const ticks = decodeTimeline(rec.timeline);
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
let game = await Game.start(assets, exe, rec.level);

let prev = '';
for (let t = 0; t < ticks.length; t++) {
  // The page restarts the level when the button -- Shift -- is pressed
  // after a death, and so does the original. Without it a replay stops
  // dead at the first mistake and everything after it is noise.
  if (game.awaitingButton && ticks[t].shift && !(ticks[t - 1]?.shift)) {
    game = await game.restart(assets, exe);
  }
  game.step(ticks[t]);
  const k = game.kid;
  const c = ticks[t];
  const g = game.guard;
  const guard = g.direction === -128
    ? ''
    : ` | guard r${g.room} c${g.currentColumn} f${g.frame} sw${g.sword} hp${g.hitPoints}`;
  const line = `room ${k.room} r${k.currentRow} c${k.currentColumn} `
    + `x${k.x} y${k.y} f${k.frame} a${k.action} d${k.direction} `
    + `sw${k.sword} hp${game.hitPoints}${guard}`;
  if (all || line !== prev) {
    const keys = `${c.x < 0 ? 'l' : c.x > 0 ? 'r' : '.'}`
      + `${c.y < 0 ? 'u' : c.y > 0 ? 'd' : '.'}${c.shift ? 's' : '.'}`;
    console.log(`t${String(t).padStart(4)} [${keys}] ${line}`);
    prev = line;
  }
}
