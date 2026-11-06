import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../src/render/assets.ts';
import { Game } from '../src/game/game.ts';
import { standX, standY } from '../src/game/geometry.ts';
const G='/home/user/Prince/original/prince1';
const assets=new Assets(async(n:string)=>new Uint8Array(readFileSync(join(G,n))));
const exe=new Uint8Array(readFileSync(join(G,'UNCRKD.EXE')));
const g=await Game.start(assets,exe,1);
const k=g.kid;
k.room=1;k.currentRow=2;k.currentColumn=6;k.x=standX(6);k.y=standY(2);
k.direction=-1;k.frame=15;k.action=0;k.fallX=0;k.fallY=0;
g.showRoom(1);
const shots:Uint8Array[]=[];const labels:number[]=[];
for(let i=0;i<30;i++) g.step({x:-1,y:0,shift:true});
for(let i=0;i<34;i++){
  g.step({x:0,y:-1,shift:true});
  shots.push(g.render().toRgb(g.scene.screenPalette.toRgba()).slice(0,320*200*3));
  labels.push(k.frame);
}
console.log('frames:',labels.join(','));
const W=320,H=200,cols=4,rows=Math.ceil(shots.length/cols);
const png=new PNG({width:cols*W,height:rows*H});
shots.forEach((s,i)=>{const ox=(i%cols)*W, oy=Math.floor(i/cols)*H;
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const si=(y*W+x)*3, di=((oy+y)*cols*W+ox+x)*4;
  png.data[di]=s[si];png.data[di+1]=s[si+1];png.data[di+2]=s[si+2];png.data[di+3]=255;}});
writeFileSync(process.argv[2],PNG.sync.write(png));
