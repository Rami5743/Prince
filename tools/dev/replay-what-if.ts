/**
 * Replay a recording with one key held for a stretch of it, and write the
 * frames.
 *
 *   node --experimental-strip-types tools/dev/replay-what-if.ts \
 *       <recording> <outdir> <from> <to> [--axis x|y] [--value -1|0|1] [--ticks n]
 *
 * This answers the question a divergence always raises: is the port
 * wrong, or did the emulator not get the key? If holding the key for
 * four more ticks makes the port draw the capture's pictures exactly,
 * the capture is of a run in which the key was still down -- and then
 * the thing to fix is the replay, not the game.
 *
 * It is what settled `0fbffa60` tick 283. The player lets go of Left
 * there, the port stops at once on frame 11 as `control_running` says,
 * and the capture has him run on and off the left of the room. Held
 * four ticks longer the port draws ticks 283 to 286 pixel for pixel.
 * Both captures of that recording, a tick apart, show the same thing,
 * so it is not jitter in one of them.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}

const [name, outdir, fromArg, toArg] = process.argv.slice(2);
if (!name || !outdir || fromArg === undefined || toArg === undefined) {
  console.error('usage: replay-what-if.ts <recording> <outdir> <from> <to>'
    + ' [--axis x|y] [--value -1|0|1] [--ticks n]');
  process.exit(2);
}
const from = Number(fromArg);
const to = Number(toArg);
const axis = process.argv.includes('--axis')
  ? process.argv[process.argv.indexOf('--axis') + 1] : 'x';
const value = arg('value', -1);

const rec = parseRecording(
  readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
);
const ticks = decodeTimeline(rec.timeline).map((c, i) => (i >= from && i <= to
  ? { ...c, [axis === 'y' ? 'y' : 'x']: value } : c));
const last = Math.min(arg('ticks', to + 40), ticks.length);

mkdirSync(outdir, { recursive: true });
let game = await Game.start(assets, exe, rec.level);
function write(i: number): void {
  const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
  const png = new PNG({ width: 320, height: 200 });
  for (let p = 0; p < 320 * 200; p++) {
    png.data[p * 4] = rgb[p * 3];
    png.data[p * 4 + 1] = rgb[p * 3 + 1];
    png.data[p * 4 + 2] = rgb[p * 3 + 2];
    png.data[p * 4 + 3] = 255;
  }
  writeFileSync(join(outdir, `t${String(i).padStart(5, '0')}.png`), PNG.sync.write(png));
}
write(0);
for (let t = 0; t < last; t++) {
  if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
  game.step(ticks[t]);
  if (game.restartDue) game = await game.restart(assets, exe);
  write(t + 1);
}
console.error(`${last} ticks to ${outdir}, ${axis} forced to ${value} from ${from} to ${to}`);
