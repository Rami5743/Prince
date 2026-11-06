/**
 * Developer tool: play the same input the oracle played, and see whether the
 * port reproduces the original's frames.
 *
 * For every captured frame it looks for a step of the simulation whose
 * rendering differs from the capture only where a torch flame is -- the
 * flames pick random phases, so they cannot be expected to agree. Everything
 * else, the Prince included, has to match pixel for pixel.
 *
 *   node --experimental-strip-types tools/dev/match-run.ts <level> <capture dir>
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { diffClusters, toCaptureSpace } from '../../tests/helpers/fixtures.ts';
import { TILE } from '../../src/game/tiles.ts';

const level = Number(process.argv[2] ?? 3);
const dir = process.argv[3];
const gameDir = join(process.cwd(), 'original', 'prince1');
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(gameDir, n))));
const exe = new Uint8Array(readFileSync(join(gameDir, 'UNCRKD.EXE')));

const captures = readdirSync(dir).filter((f) => /^g\d+\.png$/.test(f)).sort();

const game = await Game.start(assets, exe, level);

/** Boxes where a torch flame can be drawn in the room on show. */
function flameBoxes(room: number): { x0: number; y0: number; x1: number; y1: number }[] {
  const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const add = (column: number, row: number): void => {
    const drawX = column * 32;
    const mainY = 63 * row + 65 - 3;
    out.push({ x0: drawX + 6, y0: mainY - 60, x1: drawX + 26, y1: mainY - 38 });
  };
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 10; c++) {
      const t = game.scene.tiles.typeAt(room, c, r);
      if (t === TILE.torch || t === TILE.torchWithDebris) add(c + 1, r);
    }
    const left = game.scene.tiles.linkOf(room, 0);
    if (left && [TILE.torch, TILE.torchWithDebris]
      .includes(game.scene.tiles.typeAt(left, 9, r) as never)) add(0, r);
  }
  return out;
}

const q5 = (v: number) => ((v >> 3) << 3) | (v >> 3 >> 2);
const q6 = (v: number) => ((v >> 2) << 2) | (v >> 2 >> 4);

function goldenRgb(file: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(join(dir, file)));
  const rgb = new Uint8Array(320 * 192 * 3);
  for (let i = 0; i < 320 * 192; i++) {
    rgb[i * 3] = png.data[i * 4];
    rgb[i * 3 + 1] = png.data[i * 4 + 1];
    rgb[i * 3 + 2] = png.data[i * 4 + 2];
  }
  return rgb;
}

/** The simulation's frames, in order, with what each looked like. */
const STILL = { x: 0, y: 0, shift: false };
const RIGHT = { x: 1, y: 0, shift: false };
const timeline: { step: number; rgb: Uint8Array; room: number; state: string }[] = [];
for (let step = 0; step < 160; step++) {
  // The oracle let the entry turn finish, then held Right.
  game.step(step < 12 ? STILL : RIGHT);
  const surface = game.render();
  const full = toCaptureSpace(surface.toRgb(game.scene.screenPalette.toRgba()));
  timeline.push({
    step,
    rgb: full.slice(0, 320 * 192 * 3),
    room: game.drawnRoom,
    state: `frame ${game.kid.frame} room ${game.kid.room} x ${game.kid.x} y ${game.kid.y}`,
  });
}

let lastMatch = -1;
let matched = 0;
for (const file of captures) {
  const want = goldenRgb(file);
  let best: { step: number; outside: number; state: string } | null = null;
  for (const t of timeline) {
    const boxes = flameBoxes(t.room);
    const clusters = diffClusters(t.rgb, want, 320, 192);
    const outside = clusters
      .filter((c) => !boxes.some((b) => c.x0 >= b.x0 && c.x1 <= b.x1 && c.y0 >= b.y0 && c.y1 <= b.y1))
      .reduce((a, c) => a + c.count, 0);
    if (!best || outside < best.outside) best = { step: t.step, outside, state: t.state };
  }
  const ok = best && best.outside === 0;
  if (ok) matched++;
  console.log(
    `${file}: ${ok ? 'matches' : 'closest'} step ${best?.step} (${best?.state})`
    + (ok ? '' : ` — ${best?.outside} pixels differ outside the flames`),
  );
  if (ok && best) {
    if (best.step <= lastMatch) console.log('   (out of order!)');
    lastMatch = best.step;
  }
}
console.log(`${matched} of ${captures.length} captured frames reproduced exactly`);
