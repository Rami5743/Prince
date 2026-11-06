/**
 * Developer tool: work out what the Prince was doing in a captured frame.
 *
 * The room renders exactly without him, so whatever is left over is him. This
 * searches the frame table and a small window of positions for the one
 * combination that makes the leftover vanish, and prints the character state
 * that produces it. Those values are then pinned in the tests, and are what
 * the game logic will have to reproduce once it runs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Surface } from '../../src/render/surface.ts';
import { RoomRenderer, type RoomTiles, type CharacterDraw } from '../../src/render/room.ts';
import { buildLevelScene } from '../../src/game/scene.ts';
import { readExeTables } from '../../src/game/exe-tables.ts';
import { toScreenX } from '../../src/game/geometry.ts';

const gameDir = join(process.cwd(), 'original', 'prince1');
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(gameDir, n))));
const exe = new Uint8Array(readFileSync(join(gameDir, 'UNCRKD.EXE')));
const tables = readExeTables(exe);

const q5 = (v: number) => ((v >> 3) << 3) | (v >> 3 >> 2);
const q6 = (v: number) => ((v >> 2) << 2) | (v >> 2 >> 4);

interface Case { level: number; room: number; golden: string; modifiers: [number, number, number, number][] }

const CASES: Case[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));

for (const c of CASES) {
  const scene = await buildLevelScene(assets, exe, c.level);
  const pinned = new Map(c.modifiers.map(([r, col, row, v]) => [`${r},${col},${row}`, v]));
  const tiles: RoomTiles = {
    typeAt: (r, col, row) => scene.tiles.typeAt(r, col, row),
    modifierAt: (r, col, row) => pinned.get(`${r},${col},${row}`) ?? scene.tiles.modifierAt(r, col, row),
    linkOf: (r, d) => scene.tiles.linkOf(r, d),
  };
  const golden = PNG.sync.read(readFileSync(join('tests', 'golden', c.golden)));
  const rgba = scene.screenPalette.toRgba();

  const base = new Surface();
  const renderer = new RoomRenderer(scene.chtabs, tiles, scene.options);
  renderer.render(base, c.room);

  // Where the room alone disagrees with the capture: that is the Prince.
  let x0 = 320, y0 = 192, x1 = -1, y1 = -1;
  const differs = (s: Surface, x: number, y: number): boolean => {
    const p = s.pixels[y * 320 + x] * 4;
    const i = (y * 320 + x) * 4;
    return q5(rgba[p]) !== golden.data[i] || q6(rgba[p + 1]) !== golden.data[i + 1]
      || q5(rgba[p + 2]) !== golden.data[i + 2];
  };
  for (let y = 0; y < 192; y++) {
    for (let x = 0; x < 320; x++) {
      if (!differs(base, x, y)) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }

  const scratch = new Surface();
  const count = (char: CharacterDraw): number => {
    scratch.pixels.set(base.pixels);
    renderer.render(scratch, c.room, [char]);
    let n = 0;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 320; x++) if (differs(scratch, x, y)) n++;
    return n;
  };

  let best: { n: number; frame: number; dir: number; charX: number; charY: number } | null = null;
  const tried = new Set<string>();
  for (const dir of [0, -1]) {
    for (let f = 0; f < tables.frameTableKid.length; f++) {
      const fr = tables.frameTableKid[f];
      if (fr.image === 255) continue;
      const key = `${fr.image},${dir}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const sprite = scene.chtabs.kid?.images[fr.image + 1];
      if (!sprite) continue;
      // The sprite's left edge is the stretched x, or that minus its width
      // when it is flipped, so both ends of the window have to be generous.
      const lo = Math.floor((x0 - 6) * 280 / 320);
      const hi = Math.ceil((x0 + sprite.width + 6) * 280 / 320);
      for (let objX = lo; objX <= hi; objX++) {
        for (let objY = y1 - 3; objY <= y1 + 3; objY++) {
          const left = dir === 0 ? toScreenX(objX) - sprite.width : toScreenX(objX);
          if (left < x0 - 6 || left > x0 + 6) continue;
          const n = count({ chtab: 'kid', image: fr.image + 1, x: objX, y: objY, direction: dir });
          if (!best || n < best.n) {
            const e = ((((fr.flags ^ dir) << 24) >> 24) >= 0) ? 1 : 0;
            best = {
              n, frame: f, dir,
              charX: (objX - e + 116) / 2,
              charY: objY - fr.dy,
            };
          }
          if (best.n === 0) break;
        }
        if (best && best.n === 0) break;
      }
      if (best && best.n === 0) break;
    }
    if (best && best.n === 0) break;
  }
  console.log(`level ${c.level} room ${c.room}: ${JSON.stringify(best)}`);
}
