/**
 * Developer tool: draw one room and compare it with a capture of the
 * original, writing ours, theirs and a difference map as PNGs.
 *
 * Animated tiles (torch flames, gates) are in whatever state the capture
 * happened to catch, so the tool searches the small space of those states
 * and reports the one that matches, which is then pinned in the test.
 *
 *   node --experimental-strip-types tools/dev/render-room.ts <level> <room> <golden.png> <outdir>
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Surface } from '../../src/render/surface.ts';
import { RoomRenderer, type RoomTiles } from '../../src/render/room.ts';
import { buildLevelScene } from '../../src/game/scene.ts';
import { TILE } from '../../src/game/tiles.ts';

const [levelArg, roomArg, goldenPath, outDir] = process.argv.slice(2);
const level = Number(levelArg ?? 1);
const room = Number(roomArg ?? 1);
mkdirSync(outDir, { recursive: true });

const gameDir = join(process.cwd(), 'original', 'prince1');
const assets = new Assets(async (name) => new Uint8Array(readFileSync(join(gameDir, name))));
const exe = new Uint8Array(readFileSync(join(gameDir, 'UNCRKD.EXE')));
const scene = await buildLevelScene(assets, exe, level);
const surface = new Surface();

const q5 = (v: number) => ((v >> 3) << 3) | (v >> 3 >> 2);
const q6 = (v: number) => ((v >> 2) << 2) | (v >> 2 >> 4);

function toRgb(s: Surface): Uint8Array {
  const rgba = scene.screenPalette.toRgba();
  const out = new Uint8Array(320 * 200 * 3);
  for (let i = 0; i < s.pixels.length; i++) {
    const c = s.pixels[i] * 4;
    out[i * 3] = q5(rgba[c]);
    out[i * 3 + 1] = q6(rgba[c + 1]);
    out[i * 3 + 2] = q5(rgba[c + 2]);
  }
  return out;
}

function writePng(path: string, rgb: Uint8Array): void {
  const png = new PNG({ width: 320, height: 200 });
  for (let i = 0; i < 320 * 200; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png));
}

const golden = PNG.sync.read(readFileSync(goldenPath));
const goldenRgb = new Uint8Array(320 * 200 * 3);
for (let i = 0; i < 320 * 200; i++) {
  goldenRgb[i * 3] = golden.data[i * 4];
  goldenRgb[i * 3 + 1] = golden.data[i * 4 + 1];
  goldenRgb[i * 3 + 2] = golden.data[i * 4 + 2];
}

/**
 * Tiles whose look depends on live state the capture caught mid-flight:
 * torch flames cycle at random, and gates are opening or closing. Each one
 * is searched over its own small range of states.
 */
interface Animated { room: number; column: number; row: number; type: number; states: number[] }
const animated: Animated[] = [];
const gateStates = Array.from({ length: 48 }, (_, i) => i * 4);
const flameStates = Array.from({ length: 9 }, (_, i) => i);
const roomL = scene.tiles.linkOf(room, 0);
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 10; c++) collect(room, c, r);
  if (roomL) collect(roomL, 9, r);
}
function collect(rm: number, c: number, r: number): void {
  const t = scene.tiles.typeAt(rm, c, r);
  if (t === TILE.torch) {
    animated.push({ room: rm, column: c, row: r, type: t, states: flameStates });
  } else if (t === TILE.gate) {
    animated.push({ room: rm, column: c, row: r, type: t, states: gateStates });
  } else if (t === TILE.potion) {
    // The potion's kind is fixed; only its bubble animates, in the low bits.
    const kind = scene.tiles.modifierAt(rm, c, r) & 0xf8;
    animated.push({
      room: rm, column: c, row: r, type: t,
      states: Array.from({ length: 8 }, (_, i) => kind | i),
    });
  }
}

function overrideTiles(values: number[]): RoomTiles {
  return {
    typeAt: (r, c, w) => scene.tiles.typeAt(r, c, w),
    modifierAt: (r, c, w) => {
      const i = animated.findIndex((x) => x.room === r && x.column === c && x.row === w);
      return i >= 0 ? values[i] : scene.tiles.modifierAt(r, c, w);
    },
    linkOf: (r, d) => scene.tiles.linkOf(r, d),
  };
}

function render(values: number[]): Uint8Array {
  surface.clear();
  new RoomRenderer(scene.chtabs, overrideTiles(values), scene.options).render(surface, room);
  return toRgb(surface);
}

function countDiff(rgb: Uint8Array): number {
  let n = 0;
  for (let y = 0; y < 192; y++) {
    for (let x = 0; x < 320; x++) {
      const i = (y * 320 + x) * 3;
      if (rgb[i] !== goldenRgb[i] || rgb[i + 1] !== goldenRgb[i + 1]
        || rgb[i + 2] !== goldenRgb[i + 2]) n++;
    }
  }
  return n;
}

// Greedy, one tile at a time: each animated tile only affects its own area,
// so this finds the same answer as trying every combination would.
const values = animated.map((a) => a.states[0]);
let best = countDiff(render(values));
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < animated.length; i++) {
    let bestState = values[i];
    for (const st of animated[i].states) {
      const trial = values.slice();
      trial[i] = st;
      const d = countDiff(render(trial));
      if (d < best) { best = d; bestState = st; }
    }
    values[i] = bestState;
  }
}

const rgb = render(values);
writePng(join(outDir, 'ours.png'), rgb);
writePng(join(outDir, 'theirs.png'), goldenRgb);

const map = new Uint8Array(320 * 200 * 3);
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 320; x++) {
    const i = (y * 320 + x) * 3;
    const same = rgb[i] === goldenRgb[i] && rgb[i + 1] === goldenRgb[i + 1]
      && rgb[i + 2] === goldenRgb[i + 2];
    const grey = ((goldenRgb[i] + goldenRgb[i + 1] + goldenRgb[i + 2]) / 6) | 0;
    if (y >= 192 || same) { map[i] = map[i + 1] = map[i + 2] = grey; }
    else { map[i] = 255; map[i + 1] = 0; map[i + 2] = 0; }
  }
}
writePng(join(outDir, 'diff.png'), map);
console.log('animated tiles:', JSON.stringify(
  animated.map((a, i) => ({ room: a.room, column: a.column, row: a.row, modifier: values[i] })),
));
console.log(`${countDiff(rgb)} differing pixels in the room area`);
