/**
 * Replay a browser recording and write every nth rendered frame as a PNG.
 *
 *   node --experimental-strip-types tools/dev/replay-frames.ts \
 *       <recording.json> <outdir> [--stride 3] [--from 0] [--to 9999]
 *
 * The point is to be able to lay the port's frames beside frames grabbed
 * off a DOSBox running the same key events, and look at the two together.
 * The port steps twelve times a second, so a stride of three matches a
 * display grabbed at four frames a second.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { ReplayDrift } from './replay-drift.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const W = 320, H = 200;

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}

const path = process.argv[2];
const outdir = process.argv[3];
if (!path || !outdir) {
  console.error('usage: replay-frames.ts <recording.json> <outdir> [--stride n]');
  process.exit(2);
}
const stride = arg('stride', 3);
const from = arg('from', 0);
const to = arg('to', Number.MAX_SAFE_INTEGER);

const rec = parseRecording(readFileSync(path, 'utf8'));
// `--pad n` runs n idle ticks before the recording starts. The recorder
// restarts the level and begins at once, so tick 0 catches the Prince in
// the drop the level opens with; a DOSBox left to settle has him standing.
// Padding puts both at the same standstill, so the first key press is a
// sound place to line the two up.
const pad = arg('pad', 0);
const ticks = Array.from({ length: pad }, () => ({ x: 0, y: 0, shift: false }))
  .concat(decodeTimeline(rec.timeline));
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
let game = await Game.start(assets, exe, rec.level);

mkdirSync(outdir, { recursive: true });
// `--stall n` feeds the replay the presses the original was reading, not
// the ones the port recorded: see `replay-drift.ts`. Zero is the port's
// own timing, which is what the browser recorded.
const drift = new ReplayDrift(arg('stall', 0));
const idle = { x: 0, y: 0, shift: false };
let drawnRoom = game.drawnRoom;
let written = 0;
for (let t = 0; t < ticks.length; t++) {
  const now = ticks[drift.index(t)] ?? idle;
  const before = ticks[drift.index(t - 1)];
  // The page restarts the level when the button -- Shift -- is pressed
  // after a death, and so does the original. Without it a replay stops
  // dead at the first mistake and everything after it is noise.
  if (now.shift && !before?.shift) game.pressButton();
  game.step(now);
  if (game.drawnRoom !== drawnRoom) {
    drawnRoom = game.drawnRoom;
    drift.roomChanged();
  }
  // The picture of this tick comes from the game that played it, and only
  // then is the level built again: the tick the restart falls due is one
  // of the black ones, and rendering the new level into it would lose it.
  const due = game.restartDue;
  const show = t >= from && t <= to && (stride <= 1 || t % stride === 0);
  const rgb = show ? game.render().toRgb(game.scene.screenPalette.toRgba()) : null;
  if (due) game = await game.restart(assets, exe);
  if (!rgb) continue;
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(join(outdir, `t${String(t).padStart(5, '0')}.png`), PNG.sync.write(png));
  written++;
}
console.log(`${written} frames from ${ticks.length} ticks -> ${outdir}`);
