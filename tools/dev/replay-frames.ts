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
let written = 0;
for (let t = 0; t < ticks.length; t++) {
  // The page restarts the level when the button -- Shift -- is pressed
  // after a death, and so does the original. Without it a replay stops
  // dead at the first mistake and everything after it is noise.
  if (game.awaitingButton && ticks[t].shift && !(ticks[t - 1]?.shift)) {
    game = await game.restart(assets, exe);
  }
  game.step(ticks[t]);
  if (t < from || t > to || (stride > 1 && t % stride !== 0)) continue;
  const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
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
