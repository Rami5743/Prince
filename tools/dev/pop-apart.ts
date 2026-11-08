/**
 * What kind of difference is left?
 *
 *   node --experimental-strip-types tools/dev/pop-apart.ts [name...]
 *
 * For every tick the translation does not draw the capture's picture --
 * under the alignment `exactAgreement` scores with -- this asks one
 * question: does the translation draw that picture *anywhere* in the
 * run?
 *
 * * If it does, the two agree about what the game looks like and
 *   disagree about when, which is a timing difference.
 * * If it does not, the translation draws something the original never
 *   draws, which is a difference in the game.
 *
 * As of the translation's 10559 of 11094: 43 of the 535 ticks apart are
 * the first kind and 492 the second. That number is worth reading with
 * care, though. A picture is the whole screen, so a tick where the
 * Prince is right and a gate two rooms away is one frame further open
 * counts as "never drawn" -- and that is what the ones looked at so far
 * have been. See `docs/sdlpop-translation.md`.
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

let elsewhere = 0;
let never = 0;
for (const name of names) {
  const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => PopGame.start(assets, exe, rec.level), (g) => g.restart(assets, exe), ticks, digest,
  );
  const { drift } = exactAgreement(digest, port, inputChanges(ticks));
  const dos = digest.hash ?? [];
  const upto = Math.min(dos.length, port.hash.length);
  const drawn = new Set(port.hash);
  let s = 0;
  let z = 0;
  const first: number[] = [];
  for (let i = 0; i < upto; i++) {
    if (dos[i] === null) continue;
    const k = i + drift[i];
    if (k >= 0 && k < port.hash.length && dos[i] === port.hash[k]) continue;
    if (drawn.has(dos[i] as number)) s += 1;
    else { z += 1; if (first.length < 8) first.push(i); }
  }
  elsewhere += s;
  never += z;
  console.log(
    `${name.padEnd(10)} apart ${String(s + z).padStart(4)}`
    + ` | elsewhere ${String(s).padStart(4)} | never ${String(z).padStart(4)}`
    + `  ${first.join(' ')}`,
  );
}
console.log(`all: elsewhere ${elsewhere}, never ${never}`);
