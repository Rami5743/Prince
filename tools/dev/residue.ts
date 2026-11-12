/**
 * What is left of a run once the one key edge the oracle misplaced is
 * put where the emulator took it.
 *
 * `which-key.ts` says which edge of a recording, moved a tick or two,
 * the capture really wants; that is the harness's own resolution and
 * not a fault. But while the edge is in the wrong place the whole run
 * after it is marked wrong, so the few ticks that are genuinely the
 * port's cannot be seen at all. This applies the shift and then does
 * what `pop-first.ts` does: lists every tick the port still draws
 * differently, with the drift the alignment is carrying there.
 *
 *   node --experimental-strip-types tools/dev/residue.ts 13ab6867 573 y 2
 *   node --experimental-strip-types tools/dev/residue.ts 9b60bf3a 380 x 2
 *
 * The arguments are the recording, the tick of the edge, which of the
 * three controls moves (`x`, `y`, `shift` or `all`) and by how many
 * ticks -- negative for earlier. With no edge given it is the run as
 * recorded, which is `pop-first.ts`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

type Controls = { x: number; y: number; shift: boolean };
type Which = 'x' | 'y' | 'shift' | 'all';

const [name, atArg, whichArg, byArg] = process.argv.slice(2);
if (!name) {
  console.error('usage: residue.ts <name> [edge-tick] [x|y|shift|all] [by]');
  process.exit(2);
}
const digest = JSON.parse(
  readFileSync(join(REPO, 'tools', 'oracle', 'digests', `${name}.json`), 'utf8'),
) as Digest;
const rec = parseRecording(
  readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
);
const base = decodeTimeline(rec.timeline) as Controls[];
const ticks = base.map((c) => ({ ...c }));
if (atArg !== undefined) {
  const at = Number(atArg);
  const which = (whichArg ?? 'all') as Which;
  const by = Number(byArg ?? 1);
  const put = (t: number, from: Controls): void => {
    if (t < 0 || t >= ticks.length) return;
    ticks[t] = which === 'all' ? { ...from } : { ...ticks[t], [which]: from[which] };
  };
  if (by < 0) for (let t = at + by; t < at; t++) put(t, base[at]);
  else for (let t = at; t < at + by; t++) put(t, base[at - 1]);
}

const port = await runOf(
  () => PopGame.start(assets, exe, rec.level, { minutesLeft: rec.startMinutes }),
  (g) => g.restart(assets, exe),
  ticks,
  digest,
);
const { agreed, ticks: n, drift } = exactAgreement(digest, port, inputChanges(ticks));
const dos = digest.hash ?? [];
const bad: string[] = [];
const upto = Math.min(dos.length, port.hash.length);
for (let i = 0; i < upto; i++) {
  const k = i + drift[i];
  const ok = dos[i] !== null && k >= 0 && k < port.hash.length && dos[i] === port.hash[k];
  if (!ok && dos[i] !== null) {
    bad.push(`${i}${drift[i] ? `(${drift[i] > 0 ? '+' : ''}${drift[i]})` : ''}`);
  }
}
console.log(`${name} ${agreed} of ${n}; ${bad.length} apart`);
console.log('  ', bad.join(' '));
