/**
 * The translation, against the same nineteen captures.
 *
 *   node --experimental-strip-types tools/dev/pop-report.ts [name...]
 *
 * `tools/dev/oracle-report.ts` with `src/pop` in place of `src/game`:
 * the digests, the masks and the scoring are the same code, so the two
 * numbers can be put side by side. The translation replaces the port
 * when this one is the larger.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = (named.length ? named : readdirSync(DIGESTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, '')))
  .filter((n) => existsSync(join(RECORDINGS, `${n}.json`)))
  .sort();

let total = 0;
let totalTicks = 0;
for (const name of names) {
  const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => PopGame.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  const { agreed, ticks: n } = exactAgreement(digest, port, inputChanges(ticks));
  total += agreed;
  totalTicks += n;
  const pct = n ? Math.round((agreed * 100) / n) : 0;
  console.log(`${name.padEnd(10)} ${String(agreed).padStart(5)} of ${String(n).padStart(5)} ${String(pct).padStart(4)}%`);
}
console.log(`${'all'.padEnd(10)} ${String(total).padStart(5)} of ${String(totalTicks).padStart(5)} ${String(Math.round((total * 100) / totalTicks)).padStart(4)}%`);
