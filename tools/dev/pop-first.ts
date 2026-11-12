/**
 * Where the translation first parts company with a capture.
 *
 * Under the same alignment `exactAgreement` uses, so a run that is
 * simply a tick or two ahead of the capture all the way through -- the
 * keys go into DOSBox on the clock, not on the game's ticks -- does not
 * count as a difference. Prints the drift at each disagreement, so a
 * run of them that comes with a change of drift is a timing difference
 * and one that does not is a drawing difference.
 *
 *   node --experimental-strip-types tools/dev/pop-first.ts [name...]
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
  .filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')))
  .filter((n) => existsSync(join(RECORDINGS, `${n}.json`))).sort();

for (const name of names) {
  const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(() => PopGame.start(assets, exe, rec.level, { minutesLeft: rec.startMinutes }), (g) => g.restart(assets, exe), ticks, digest);
  const { agreed, ticks: n, drift } = exactAgreement(digest, port, inputChanges(ticks));
  const dos = digest.hash ?? [];
  const bad: string[] = [];
  const upto = Math.min(dos.length, port.hash.length);
  for (let i = 0; i < upto; i++) {
    const k = i + drift[i];
    const ok = dos[i] !== null && k >= 0 && k < port.hash.length && dos[i] === port.hash[k];
    if (!ok && dos[i] !== null) bad.push(`${i}${drift[i] ? `(${drift[i] > 0 ? '+' : ''}${drift[i]})` : ''}`);
  }
  console.log(`${name.padEnd(10)} ${agreed} of ${n}; ${bad.length} apart, first ${bad[0] ?? '-'}`);
  console.log('  ', bad.slice(0, 40).join(' '));
}
