/**
 * How much of a recording is `prandom`, cheats and all.
 *
 *   npx tsx tools/dev/probe-seeds.ts <recording-name>
 *
 * `probe-check.ts` answers this for a bare timeline, which is what a
 * probe was before a recording could carry cheats. A cheat changes
 * everything about whether a run can be adjudicated -- `k` is
 * `kill_guard`, and a dead guard is the difference between a run
 * that is `prandom` from end to end and one that is not -- so this
 * replays the recording as `pop-report.ts` does, cheats included, at
 * two seeds 77776 apart, and prints the rooms it toured, the tick
 * the Prince died on, and how many of its ticks the two seeds draw
 * differently by more than three hundred pixels. Three hundred is
 * "bigger than a torch", which the digest masks anyway.
 *
 * It is what `gate2c` was found with: the same 1653 ticks of level 2
 * as the retired `gate2b`, with the guard killed on tick 58, come
 * out **0** ticks apart at two seeds where the fight comes out
 * 1592.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { cheatsByTick } from './digest-common.ts';

const G = join(process.cwd(), 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(G, n))));
const exe = new Uint8Array(readFileSync(join(G, 'UNCRKD.EXE')));
const name = process.argv[2];
const rec = parseRecording(readFileSync(join('tools/oracle/recordings', `${name}.json`), 'utf8'));
const tl = decodeTimeline(rec.timeline);
const cheats = cheatsByTick(rec.cheats);

async function run(seed: number): Promise<{ px: Uint8Array[]; info: string }> {
  const game = await PopGame.start(assets, exe, rec.level, {
    minutesLeft: rec.startMinutes, seed,
  });
  const px: Uint8Array[] = [];
  const rooms: number[] = [];
  let died = -1; let guardSeen = -1;
  for (let t = 0; t < tl.length; t++) {
    for (const key of cheats.get(t) ?? []) game.cheat(key);
    game.step(tl[t]);
    px.push(new Uint8Array(game.render().pixels));
    if (!rooms.length || rooms[rooms.length - 1] !== g.drawn_room) rooms.push(g.drawn_room);
    if (died < 0 && game.isDead) died = t;
    if (guardSeen < 0 && g.Guard.direction !== -1 && g.Guard.alive > 0) guardSeen = t;
  }
  return { px, info: `rooms ${rooms.join(' ')} died ${died} guardAlive ${guardSeen}` };
}
const a = await run(1); const b = await run(77777);
let diff = 0; const where: number[] = [];
for (let t = 0; t < a.px.length; t++) {
  let n = 0;
  for (let i = 0; i < a.px[t].length; i++) if (a.px[t][i] !== b.px[t][i]) n++;
  if (n > 300) { diff++; if (where.length < 12) where.push(t); }
}
console.log(name, 'ticks', tl.length);
console.log(' ', a.info);
console.log('  two seeds differ on', diff, 'ticks', where.join(' '));
