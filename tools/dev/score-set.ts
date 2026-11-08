/**
 * Score the port against a named set of captures, without installing them.
 *
 *   node --experimental-strip-types tools/dev/score-set.ts <name>:<digest.json> ...
 *
 * Prints a line per run and a total. This is the A/B bench while a
 * capture round is still running and `tools/oracle/digests` is a mix of
 * old captures and new ones: it names the digests on the command line
 * so a change can be measured against the same five captures before and
 * after.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

let total = 0;
let totalTicks = 0;
for (const spec of process.argv.slice(2)) {
  const i = spec.indexOf(':');
  const name = spec.slice(0, i);
  const digest = JSON.parse(readFileSync(spec.slice(i + 1), 'utf8')) as Digest;
  const rec = parseRecording(
    readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
  );
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  const ex = exactAgreement(digest, port, inputChanges(ticks));
  total += ex.agreed;
  totalTicks += ex.ticks;
  const dos = digest.hash ?? [];
  const miss: string[] = [];
  let run = -1;
  for (let t = 0; t < Math.min(dos.length, port.hash.length); t++) {
    const ok = dos[t] === null || dos[t] === port.hash[t + ex.drift[t]];
    if (!ok && run < 0) run = t;
    if (ok && run >= 0) { miss.push(run === t - 1 ? `${run}` : `${run}-${t - 1}`); run = -1; }
  }
  if (run >= 0) miss.push(`${run}-${ex.ticks - 1}`);
  console.log(`${name.padEnd(10)} ${String(ex.agreed).padStart(5)} of `
    + `${String(ex.ticks).padStart(5)}  ` + miss.slice(0, 10).join(' ')
    + (miss.length > 10 ? ' ...' : ''));
}
console.log(`${'TOTAL'.padEnd(10)} ${String(total).padStart(5)} of ${String(totalTicks).padStart(5)}`);
