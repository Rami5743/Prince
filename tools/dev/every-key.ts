/**
 * The whole suite with *every* key edge moved by the same number of
 * ticks, which asks whether the port reads the keyboard a tick late.
 *
 *   node --experimental-strip-types tools/dev/every-key.ts [-2,-1,0,1,2]
 *
 * `tools/dev/which-key.ts` moves one edge of one recording and finds
 * the one that is worth something. The residue keeps reading as "one
 * edge, one tick out", and one edge of one run is the oracle's own
 * resolution -- but if the *port* sampled the keyboard a tick off the
 * original, every run would want the same shift, and that would be a
 * fault in `src/pop` and not in the harness.
 *
 * It does not. Measured on the twenty-one runs a capture can settle,
 * at the commit that scored 11690 of 12036:
 *
 *                 -2    -1     0     1     2
 *     0fbffa60   602   192   642   637   229   of 724
 *     13ab6867   572   572   572    50    50   of 728
 *     25c4ebb8   337   384   388   386   386   of 388
 *     33e8ace7    87   305   308   307   307   of 308
 *     3764b76d   173   214   218   216   216   of 218
 *     5920a8c2   372   406   413   407   405   of 415
 *     72b3522f   144   381   384   381   379   of 384
 *     756b259c   505   507   509   509   509   of 509
 *     760c3e74  1538  1538  1538  1536  1535   of 1566
 *     848ee3c4  1409  1438  1432  1432  1432   of 1446
 *     9b60bf3a   528   530   529   529   524   of 557
 *     a356bdd6   143   181   184   181   179   of 184
 *     b4ff4672   393   395   395   389   360   of 428
 *     e209b01a   211   213   214   213   211   of 214
 *     ec99dc5b   236   237   237   236    70   of 237
 *     f6874819  1183  1185  1189  1186  1184   of 1190
 *     level2     420   422   425   422   420   of 425
 *     palace4    519   521   519   519   518   of 521
 *     probeC     230   232   235   232   230   of 235
 *     probeE     161   163   166   163   161   of 166
 *     probeF    1188  1190  1193  1190  1188   of 1193
 *     TOTAL    10951 11206 11690 11121 10493   of 12036
 *
 * Nought wins by 484 ticks over a tick earlier and 569 over a tick
 * later, and it wins run by run in seventeen of the twenty-one. So
 * the port reads the keyboard on the tick the original does, and the
 * edges that `which-key` finds are the harness placing one edge of one
 * capture inside the wrong tick -- which is what it cannot do better
 * than, and what `tools/oracle/README.md` says it cannot do better
 * than.
 *
 * The two runs that do want a shift are worth reading. `palace4` at
 * a tick earlier is **521 of 521, exact**, which is its whole residue
 * and says the phase of that capture sat just the wrong side of a tick
 * -- the knife-edge the README already describes. `848ee3c4` gains six
 * at a tick earlier and loses them again at two, which is the same
 * thing in miniature.
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

/** The four whose captures measure the emulator rather than the port. */
const RETIRED = new Set(['gate1', 'exitdoor', 'gate2', 'gate2b']);

const args = process.argv.slice(2);
const offsets = (args.find((a) => !a.startsWith('--')) ?? '-2,-1,0,1,2')
  .split(',').map(Number);
const names = readdirSync(DIGESTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .filter((n) => existsSync(join(RECORDINGS, `${n}.json`)) && !RETIRED.has(n))
  .sort();

const total = new Map<number, number>();
let totalTicks = 0;
console.log('          ' + offsets.map((o) => String(o).padStart(6)).join(''));
for (const name of names) {
  const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const base = decodeTimeline(rec.timeline);
  const cells: string[] = [];
  let n = 0;
  for (const off of offsets) {
    // A negative offset is every edge a tick *earlier*, which is this
    // tick taking what the recording says about the next one. The ends
    // hold their own value rather than running off either side.
    const ticks = base.map((_, t) => ({
      ...base[Math.max(0, Math.min(base.length - 1, t - off))],
    }));
    const port = await runOf(
      () => PopGame.start(assets, exe, rec.level),
      (g) => g.restart(assets, exe),
      ticks,
      digest,
    );
    const got = exactAgreement(digest, port, inputChanges(ticks));
    n = got.ticks;
    total.set(off, (total.get(off) ?? 0) + got.agreed);
    cells.push(String(got.agreed).padStart(6));
  }
  totalTicks += n;
  console.log(`${name.padEnd(10)}${cells.join('')}   of ${n}`);
}
console.log('TOTAL     '
  + offsets.map((o) => String(total.get(o)).padStart(6)).join('')
  + `   of ${totalTicks}`);
