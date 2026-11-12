/**
 * What picture the capture has on a tick, named in the port's own terms.
 *
 * The captures cannot live in the repository, but the digest keeps two
 * things per tick that are enough to say what the original drew: the
 * fingerprint of the whole screen, and the box of what moved since the
 * tick before. So for a tick the port draws differently, this asks the
 * run itself -- is the capture's picture one the port draws, on some
 * other tick? If it is, the capture is the port's own run shifted, and
 * the answer says by how much. If it is not, the two really do draw
 * something different, and the two boxes say where.
 *
 *   node --experimental-strip-types tools/dev/which-tick.ts <name> <from> <to> \
 *       [edge-tick x|y|shift|all by]
 *
 * The optional last three put one key edge where `which-key.ts` says
 * the emulator took it, so what is printed is the residue and not the
 * edge.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest, type Moved, cheatsByTick,
} from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

type Controls = { x: number; y: number; shift: boolean };
type Which = 'x' | 'y' | 'shift' | 'all';

const [name, fromArg, toArg, atArg, whichArg, byArg] = process.argv.slice(2);
if (!name) {
  console.error('usage: which-tick.ts <name> <from> <to> [edge-tick x|y|shift|all by]');
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
  cheatsByTick(rec.cheats),
);
const { drift } = exactAgreement(digest, port, inputChanges(ticks));
const dos = digest.hash ?? [];
const box = (m: Moved | undefined): string => (
  m == null ? '          -        ' : `${String(m[0]).padStart(3)},${String(m[1]).padStart(3)} ${String(m[2]).padStart(3)},${String(m[3]).padStart(3)} ${String(m[4]).padStart(5)}`
);
const where = new Map<number, number[]>();
port.hash.forEach((h, j) => {
  const seen = where.get(h);
  if (seen) seen.push(j); else where.set(h, [j]);
});
const from = Number(fromArg ?? 0);
const to = Number(toArg ?? dos.length - 1);
console.log('tick  ok  drift  capture moved          port moved            capture picture is');
for (let i = from; i <= to && i < dos.length; i++) {
  const k = i + (drift[i] ?? 0);
  const h = dos[i];
  const ok = h !== null && h === port.hash[k];
  const at = h === null ? [] : (where.get(h) ?? []);
  const says = h === null ? 'not in the capture'
    : at.length === 0 ? 'nothing the port ever draws'
      : `the port's tick${at.length > 1 ? 's' : ''} ${at.join(' ')}`;
  console.log(
    `${String(i).padStart(4)}  ${ok ? ' .' : ' X'}  ${String(drift[i] ?? 0).padStart(5)}  `
    + `${box(digest.ticks[i])}  ${box(port.moved[k])}  ${ok ? '' : says}`,
  );
}
