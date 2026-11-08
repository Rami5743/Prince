/**
 * Where the port and a capture differ, tick by tick, in the digest's own
 * terms.
 *
 *   node --experimental-strip-types tools/dev/tick-diff.ts \
 *       <name> <capture-dir> [--from n] [--to n] [--slip n]
 *
 * The capture directory is the one `split_ticks.py` wrote, with its
 * `dos.json` beside it. Both pictures are turned into indices of the
 * capture's own palette and the flame mask is taken out, which is
 * exactly what the comparison counts -- so a tick this calls equal is a
 * tick the suite calls equal, and the rows it prints are the pixels
 * that make the difference and nothing else.
 *
 * Doing it by hand against the PNGs does not work and wasted an
 * afternoon: the capture's colours are a frame grab of a VGA signal and
 * the port's are the palette, so (120,131,143) and (120,132,148) are
 * the same colour of the same wall and every tile edge in the room
 * shows up as a difference.
 *
 * `--slip n` also reports, per tick, which of the port's ticks within n
 * of this one is the nearest match, which is how a run that has gained
 * or lost a tick tells on itself.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { unpackMask, PaletteMap, type Digest } from './digest-common.ts';

const W = 320, H = 200;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}

const name = process.argv[2];
const dir = process.argv[3];
if (!name || !dir) {
  console.error('usage: tick-diff.ts <name> <capture-dir> [--from n] [--to n] [--slip n]');
  process.exit(2);
}
const from = arg('from', 0);
const to = arg('to', Number.MAX_SAFE_INTEGER);
const slip = arg('slip', 0);

const digest = JSON.parse(readFileSync(join(dir, '..', 'dos.json'), 'utf8')) as Digest;
const mask = digest.mask ? unpackMask(digest.mask) : new Uint8Array(W * H);
const map = new PaletteMap(digest.palette ?? []);

/** A capture's tick as indices into its own palette, flames taken out. */
function captured(t: number): Uint16Array | null {
  const file = join(dir, `t${String(t).padStart(5, '0')}.png`);
  if (!existsSync(file)) return null;
  const png = PNG.sync.read(readFileSync(file));
  const out = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    out[i] = mask[i] ? 0xffff
      : map.indexOf(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]);
  }
  return out;
}

function ported(rgb: Uint8Array): Uint16Array {
  const out = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) {
    out[i] = mask[i] ? 0xffff : map.indexOf(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  }
  return out;
}

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const rec = parseRecording(
  readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
);
const ticks = decodeTimeline(rec.timeline);

const last = Math.min(to + slip + 1, ticks.length);
let game = await Game.start(assets, exe, rec.level);
const port: Uint16Array[] = [ported(game.render().toRgb(game.scene.screenPalette.toRgba()))];
for (let t = 0; t < last; t++) {
  if (ticks[t].shift && !(ticks[t - 1]?.shift)) game.pressButton();
  game.step(ticks[t]);
  if (game.restartDue) game = await game.restart(assets, exe);
  port.push(ported(game.render().toRgb(game.scene.screenPalette.toRgba())));
}

const available = readdirSync(dir).filter((f) => /^t\d+\.png$/.test(f)).length;
for (let t = from; t <= Math.min(to, available - 1); t++) {
  const dos = captured(t);
  if (!dos) continue;
  let bestK = 0;
  let bestN = Infinity;
  for (let k = -slip; k <= slip; k++) {
    const p = port[t + k];
    if (!p) continue;
    let n = 0;
    for (let i = 0; i < W * H; i++) if (dos[i] !== p[i]) n++;
    if (n < bestN) { bestN = n; bestK = k; }
  }
  if (bestN === 0) { console.log(`${t}  exact${bestK ? ` at ${bestK >= 0 ? '+' : ''}${bestK}` : ''}`); continue; }
  const p = port[t + bestK];
  const rows = new Map<number, number[]>();
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (dos[y * W + x] === p[y * W + x]) continue;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push(x);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  console.log(`${t}  ${bestN} px${bestK ? ` (best at ${bestK >= 0 ? '+' : ''}${bestK})` : ''}`
    + `  x ${x0}-${x1}  y ${y0}-${y1}`);
  if (process.argv.includes('--rows')) {
    for (const [y, xs] of [...rows].slice(0, 12)) {
      console.log(`     y ${y}: ${xs.slice(0, 24).join(',')}${xs.length > 24 ? ' ...' : ''}`);
    }
  }
}
