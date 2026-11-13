/**
 * The translation's frames as PNGs, for looking at beside a capture.
 *
 *   node --experimental-strip-types tools/dev/pop-frames.ts \
 *       <rec.json> <outdir> <from> <to> [--late <from>:<to>:<n>[:x+y+shift]]
 *
 * `--late` moves a press on by n ticks before replaying, the way
 * `tools/dev/late-key.ts` does, so a recording whose capture parted
 * company at a tap can still be put beside that capture after it. The
 * `gate1` exit stairs are only comparable with `--late 591:592:14`.
 */
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
/** A probe's cheats, applied where `control_kid` reads the keyboard. */
const cheatsAt = new Map<number, string[]>();
for (const c of rec.cheats ?? []) {
  const had = cheatsAt.get(c.tick);
  if (had) had.push(c.key); else cheatsAt.set(c.tick, [c.key]);
}
const lateArg = process.argv[process.argv.indexOf('--late') + 1];
if (process.argv.includes('--late') && lateArg) {
  const [a, b, d] = lateArg.split(':').map(Number);
  // Which of the three controls moves, the way `late-key.ts` takes it:
  // `--late a:b:n` moves all three, and a trailing `x`, `y` or `shift`
  // moves only those. Moving the horizontal control alone -- which is
  // all this used to do -- answers nothing about a press that was Up
  // or Shift, and it blanks a Right the player was still holding.
  const which = (lateArg.split(':')[3] ?? 'x:y:shift').split(/[,+]/);
  const was = ticks.map((c) => ({ ...c }));
  const blank: Record<string, number | boolean> = {};
  if (which.includes('x')) blank.x = 0;
  if (which.includes('y')) blank.y = 0;
  if (which.includes('shift')) blank.shift = false;
  for (let t = a; t <= b; t++) ticks[t] = { ...ticks[t], ...blank };
  for (let t = a; t <= b; t++) {
    if (t + d >= ticks.length) continue;
    const put: Record<string, number | boolean> = {};
    if (which.includes('x')) put.x = was[t].x;
    if (which.includes('y')) put.y = was[t].y;
    if (which.includes('shift')) put.shift = was[t].shift;
    ticks[t + d] = { ...ticks[t + d], ...put };
  }
}
let game = await PopGame.start(assets, exe, rec.level, { minutesLeft: rec.startMinutes });
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
  for (const key of cheatsAt.get(t) ?? []) game.cheat(key);
  game.step(ticks[t]);
  if (game.restartDue) game = await game.restart(assets, exe);
  write(t + 1);
}
