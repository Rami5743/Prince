/**
 * How close the port is to the original, run by run, in one page.
 *
 *   node --experimental-strip-types tools/dev/oracle-report.ts [name...]
 *
 * For each recording with a digest in `tools/oracle/digests`, replays it
 * and prints how many of the original's ticks the port draws exactly --
 * the same picture, pixel for pixel, outside the torches -- and where
 * the ones it does not are. This is the thing to read before a release:
 * the suite pins these numbers so they cannot fall, but the pins say
 * nothing about *where* a run is wrong, and the ranges below do.
 *
 * Each line also says whether the capture's own clock and the player's
 * keys agree about which tick is which. They have to: the level's
 * number under the room is a count the game keeps itself and the keys
 * cannot move it, so if the alignment before the player touched
 * anything and the alignment after it want different offsets, the
 * capture was taken with the schedule half a tick the wrong side of a
 * boundary and has to be taken again -- see tools/dev/pick-shift.ts.
 * A `PHASE` on a line means that run's number is not worth reading.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import {
  runOf, exactAgreement, inputChanges, type Digest,
} from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = named.length ? named : readdirSync(DIGESTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((n) => existsSync(join(RECORDINGS, `${n}.json`)))
  .sort();

let totalAgreed = 0;
let totalTicks = 0;
for (const name of names) {
  const digest = JSON.parse(
    readFileSync(join(DIGESTS, `${name}.json`), 'utf8'),
  ) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  const ex = exactAgreement(digest, port, inputChanges(ticks));
  totalAgreed += ex.agreed;
  totalTicks += ex.ticks;
  const dos = digest.hash ?? [];
  const miss: string[] = [];
  let run = -1;
  for (let i = 0; i < Math.min(dos.length, port.hash.length); i++) {
    const ok = dos[i] === null || dos[i] === port.hash[i + ex.drift[i]];
    if (!ok && run < 0) run = i;
    if (ok && run >= 0) { miss.push(run === i - 1 ? `${run}` : `${run}-${i - 1}`); run = -1; }
  }
  if (run >= 0) miss.push(`${run}-${ex.ticks - 1}`);
  const pct = ex.ticks ? Math.round((ex.agreed / ex.ticks) * 100) : 0;
  // The commonest offset over the ticks that agree, before the player
  // touched anything and after.
  let firstPress = ticks.length;
  for (let t = 0; t < ticks.length; t++) {
    const c = ticks[t];
    if (c.x !== 0 || c.y !== 0 || c.shift) { firstPress = t; break; }
  }
  const settled = (from: number, to: number): number | null => {
    const count = new Map<number, number>();
    for (let i = Math.max(0, from); i < Math.min(ex.drift.length, to); i++) {
      if (dos[i] == null || dos[i] !== port.hash[i + ex.drift[i]]) continue;
      count.set(ex.drift[i], (count.get(ex.drift[i]) ?? 0) + 1);
    }
    let best: number | null = null;
    let most = 0;
    for (const [d, n] of count) if (n > most) { most = n; best = d; }
    return most >= 3 ? best : null;
  };
  const before = settled(0, firstPress - 1);
  const after = settled(firstPress + 2, ex.drift.length);
  const phase = before !== null && after !== null && before !== after
    ? ` PHASE${after - before > 0 ? '+' : ''}${after - before}` : '';
  console.log(`${name.padEnd(10)} ${String(ex.agreed).padStart(5)} of `
    + `${String(ex.ticks).padStart(5)}  ${String(pct).padStart(3)}%${phase}  `
    + miss.slice(0, 12).join(' ') + (miss.length > 12 ? ' ...' : ''));
}
const pct = totalTicks ? Math.round((totalAgreed / totalTicks) * 100) : 0;
console.log(`${'all'.padEnd(10)} ${String(totalAgreed).padStart(5)} of `
  + `${String(totalTicks).padStart(5)}  ${pct}%`);
