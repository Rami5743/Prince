/**
 * The kid's frame, position and control latches, tick by tick.
 *
 * For the questions the pictures cannot answer: which animation frame
 * the Prince is on when a key is let go, what `control_x` and the
 * forward and backward latches were at that moment, and which
 * sequence he is in.
 *
 *   node --experimental-strip-types tools/dev/kid-trace.mjs <name> <from> <to>
 */

import { readFileSync } from 'node:fs';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { g } from '../../src/pop/state.ts';
const GAME=new URL('../../original/prince1', import.meta.url).pathname;
const assets=new Assets(async n=>new Uint8Array(readFileSync(GAME+'/'+n)));
const exe=new Uint8Array(readFileSync(GAME+'/UNCRKD.EXE'));
const [name,lo,hi]=process.argv.slice(2);
const here = new URL('../oracle/recordings/', import.meta.url).pathname;
const rec=parseRecording(readFileSync(`${here}${name}.json`,'utf8'));
const ticks=decodeTimeline(rec.timeline);
let game=await PopGame.start(assets,exe,rec.level);
const L=Number(lo), H=Number(hi);
for(let t=0;t<ticks.length;t++){
  if (ticks[t].shift && !(ticks[t-1]?.shift)) game.pressButton();
  game.step(ticks[t]);
  if (game.restartDue) { game = await game.restart(assets, exe); continue; }
  const n=t+1;
  if(n>=L && n<=H){
    const k=g.Kid;
    console.log(n, 'in.x'+ticks[t].x, 'f'+k.frame, 'x'+k.x, 'dir'+k.direction, 'act'+k.action,
      '| cx'+g.control_x, 'fw'+g.control_forward, 'bw'+g.control_backward, 'seq'+k.curr_seq);
  }
}
