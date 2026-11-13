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
import {
  runOf, exactAgreement, inputChanges, cheatsByTick, type Digest,
} from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
/**
 * Where the digests are, so an experiment on the *numbering* can be
 * run without touching the repository's own.
 *
 * `--anchor-text N` is nothing but a constant added to every tick
 * index, so asking what a different N would have given is asking
 * what the same digests renumbered would give -- and that is a
 * question worth being able to answer without rewriting
 * `tools/oracle/digests/`.
 */
const DIGESTS = process.env.POP_DIGESTS || join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const names = (named.length ? named : readdirSync(DIGESTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, '')))
  .filter((n) => existsSync(join(RECORDINGS, `${n}.json`)))
  .sort();

/**
 * The recordings whose captures measure something other than the
 * port, and what each one measures instead. `tests/oracle/
 * recordings-vs-original.test.ts` has the numbers behind them.
 *
 * `gate1` was one of them and is not any more. Four captures with the
 * current scripts -- both `--start` values and both numberings --
 * score 809, 574, 594 and 808 of ~810, so the old digest's 596 was
 * one bad capture and the tap it was blamed on was never the
 * trouble. It is measured now, at 809 of 810.
 */
const RETIRED: Record<string, string> = {
  exitdoor: 'two edges DOSBox merged into one tick, in eleven captures of eleven',
  gate2: 'forty one-tick taps, half of which DOSBox drops',
  gate2b: "a sword fight, and the guard's choices come from a clock-seeded generator",
};

let total = 0;
let totalTicks = 0;
let retiredAgreed = 0;
let retiredTicks = 0;
for (const name of names) {
  const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => PopGame.start(assets, exe, rec.level, { minutesLeft: rec.startMinutes }),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
    cheatsByTick(rec.cheats),
  );
  const { agreed, ticks: n } = exactAgreement(digest, port, inputChanges(ticks));
  if (name in RETIRED) { retiredAgreed += agreed; retiredTicks += n; }
  else { total += agreed; totalTicks += n; }
  const pct = n ? Math.round((agreed * 100) / n) : 0;
  const why = RETIRED[name] ? `  -- retired: ${RETIRED[name]}` : '';
  console.log(`${name.padEnd(10)} ${String(agreed).padStart(5)} of ${String(n).padStart(5)} ${String(pct).padStart(4)}%${why}`);
}
const line = (label: string, a: number, n: number): string => `${label.padEnd(10)} ${String(a).padStart(5)} of ${String(n).padStart(5)} ${String(n ? Math.round((a * 100) / n) : 0).padStart(4)}%`;
console.log(line('measured', total, totalTicks));
if (retiredTicks) {
  console.log(line('retired', retiredAgreed, retiredTicks));
  console.log(line('all', total + retiredAgreed, totalTicks + retiredTicks));
}
