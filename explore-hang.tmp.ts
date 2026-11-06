import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from './src/render/assets.ts';
import { Game } from './src/game/game.ts';
import { TILE } from './src/game/tiles.ts';
import { toCaptureSpace, diffClusters } from './tests/helpers/fixtures.ts';
const GAME_DIR = 'original/prince1';
const DIR = 'tests/golden/level2-hang';
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
function capture(file: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(join(DIR, file)));
  const rgb = new Uint8Array(320 * 200 * 3);
  for (let i = 0; i < 320 * 200; i++) { rgb[i*3]=png.data[i*4]; rgb[i*3+1]=png.data[i*4+1]; rgb[i*3+2]=png.data[i*4+2]; }
  return rgb;
}
const files = readdirSync(DIR).filter(f => f.endsWith('.png')).sort();
const wants = files.map(capture);
async function build(still: number, shiftAt: number) {
  const game = await Game.start(assets, exe, 2);
  const boxesOf = (room: number) => {
    const out: {x0:number;y0:number;x1:number;y1:number}[] = [];
    const isT = (t:number) => t === TILE.torch || t === TILE.torchWithDebris;
    const add = (c:number,r:number) => { const dx=c*32, my=63*r+65-3; out.push({x0:dx+6,y0:my-60,x1:dx+26,y1:my-38}); };
    for (let r=0;r<3;r++){ for(let c=0;c<10;c++) if (isT(game.scene.tiles.typeAt(room,c,r))) add(c+1,r);
      const l = game.scene.tiles.linkOf(room,0); if (l && isT(game.scene.tiles.typeAt(l,9,r))) add(0,r); }
    return out;
  };
  const steps: {step:number;rgb:Uint8Array;boxes:any;state:string}[] = [];
  for (let s = 0; s < 80; s++) {
    const moving = s >= still && s < shiftAt;
    game.step({ x: moving ? -1 : 0, y: 0, shift: s >= shiftAt });
    const full = toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()));
    steps.push({ step: s, rgb: full.slice(0,320*200*3), boxes: boxesOf(game.drawnRoom),
      state: `f${game.kid.frame} r${game.kid.room} x${game.kid.x} y${game.kid.y}` });
  }
  return steps;
}
const still = 12;
let best: {shiftAt:number; matched:number; map:(number|null)[]} = { shiftAt: -1, matched: -1, map: [] };
for (let shiftAt = still + 10; shiftAt <= still + 34; shiftAt++) {
  const steps = await build(still, shiftAt);
  const map = files.map((_, i) => {
    for (const t of steps) {
      const bad = diffClusters(t.rgb, wants[i], 320, 200)
        .filter((c:any) => !t.boxes.some((b:any)=>c.x0>=b.x0&&c.x1<=b.x1&&c.y0>=b.y0&&c.y1<=b.y1))
        .reduce((a:number,c:any)=>a+c.count,0);
      if (bad === 0) return t.step;
    }
    return null;
  });
  const matched = map.filter(x => x !== null).length;
  console.log('shiftAt', shiftAt, 'matched', matched, JSON.stringify(map));
  if (matched > best.matched) best = { shiftAt, matched, map };
}
console.log('BEST', JSON.stringify(best));
