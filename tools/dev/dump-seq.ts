/** Developer tool: print one sequence of the character byte-code. */
import { readFileSync } from 'node:fs';
import { readExeTables } from '../../src/game/exe-tables.ts';
const exe = new Uint8Array(readFileSync('original/prince1/UNCRKD.EXE'));
const t = readExeTables(exe);
const BASE = 0x196e;
const NAME: Record<number, string> = { 0xfb:'dx',0xfa:'dy',0xfe:'flip',0xf7:'jumpIfFeather',0xff:'jump',0xfd:'up',0xfc:'down',0xf9:'action',0xf8:'setFall',0xf5:'knockUp',0xf4:'knockDown',0xf2:'sound',0xf1:'endLevel',0xf3:'getItem',0xf6:'die' };
const n = Number(process.argv[2]);
let at = t.sequenceOffsets[n] - BASE;
for (let i = 0; i < 60; i++) {
  const b = t.sequences[at];
  const name = NAME[b];
  if (!name) { console.log(at + BASE, 'frame', b); at++; continue; }
  const args = { dx:1, dy:1, action:1, sound:1, getItem:1, setFall:2, jump:2, jumpIfFeather:2 }[name] ?? 0;
  const vals = [];
  for (let k = 1; k <= args; k++) vals.push(t.sequences[at+k] > 127 ? t.sequences[at+k]-256 : t.sequences[at+k]);
  console.log(at + BASE, name, vals.join(' '));
  at += 1 + args;
  if (name === 'jump') break;
}
