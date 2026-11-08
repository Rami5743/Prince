import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
const REPO='/home/user/Prince';
const { Assets } = await import(join(REPO,'src/render/assets.ts'));
const { PopGame } = await import(join(REPO,'src/pop/game.ts'));
const GAME_DIR = join(REPO,'original','prince1');
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR,n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR,'UNCRKD.EXE')));
const g = await PopGame.start(assets, exe, 1);
console.log('kid', JSON.stringify(g.kid));
console.log('drawn room', g.drawnRoom, 'hp', g.hitPoints);
const s = g.render();
const rgb = s.toRgb(g.scene.screenPalette.toRgba());
const png = new PNG({width:320,height:200});
for (let i=0;i<320*200;i++){png.data[i*4]=rgb[i*3];png.data[i*4+1]=rgb[i*3+1];png.data[i*4+2]=rgb[i*3+2];png.data[i*4+3]=255;}
writeFileSync('/tmp/claude-0/-home-user-Prince/545872ac-bf31-59fd-86ea-17b93c8ec2fa/scratchpad/pop0.png', PNG.sync.write(png));
for (let i=0;i<10;i++) { g.step({x:0,y:0,shift:false}); }
console.log('after 10:', JSON.stringify(g.kid));
