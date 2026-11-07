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
 * `--frames <dir>` also writes the port's own pictures, so that a tick
 * in the list can be put beside the capture's.
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
  console.log(`${name.padEnd(10)} ${String(ex.agreed).padStart(5)} of `
    + `${String(ex.ticks).padStart(5)}  ${String(pct).padStart(3)}%  `
    + miss.slice(0, 12).join(' ') + (miss.length > 12 ? ' ...' : ''));
}
const pct = totalTicks ? Math.round((totalAgreed / totalTicks) * 100) : 0;
console.log(`${'all'.padEnd(10)} ${String(totalAgreed).padStart(5)} of `
  + `${String(totalTicks).padStart(5)}  ${pct}%`);
