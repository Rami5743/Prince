/** The translation's frames as PNGs, for looking at beside a capture. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const [recPath, outdir, fromS, toS] = process.argv.slice(2);
const from = Number(fromS ?? 0);
const to = Number(toS ?? 4);
const rec = parseRecording(readFileSync(recPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);
let game = await PopGame.start(assets, exe, rec.level);
mkdirSync(outdir, { recursive: true });
function write(index: number): void {
  // Always render: `draw_game_frame` counts down the words under the
  // room, so skipping a frame's drawing changes what the next one says.
  const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
  if (index < from || index > to) return;
  const png = new PNG({ width: 320, height: 200 });
  for (let i = 0; i < 320 * 200; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(join(outdir, `t${String(index).padStart(5, '0')}.png`), PNG.sync.write(png));
}
write(0);
for (let t = 0; t < ticks.length && t + 1 <= to; t++) {
  if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
  game.step(ticks[t]);
  if (game.restartDue) game = await game.restart(assets, exe);
  write(t + 1);
}
