/**
 * Which of a recording's two captures has the keys in the right ticks?
 *
 *   node --experimental-strip-types tools/dev/pick-shift.ts \
 *       <recording.json> <digest-shift0.json> <digest-shift1.json>
 *
 * ## The problem
 *
 * `dosbox_oracle.py` sends every key edge on a wall clock whose origin
 * is Ctrl+A plus however long DOSBox took to restart the level, and
 * the game reads the keyboard at the start of each of its own ticks.
 * Where the one clock sits inside the other's tick is wherever that
 * landed -- anywhere in a tick, differently on every run -- and no
 * value of `--settle` helps, because the uncertainty is a whole tick
 * wide and so is the window. About half of all captures come out with
 * every key edge of the run a tick early.
 *
 * A tick is not a rounding error. `probeF` captured at one shift
 * scores 459 of its 1194 ticks pixel-exact against the port and at the
 * other 1053 of 1196; `0fbffa60` went from 35 of 731 to 227 of 726
 * when the schedule itself was corrected. A capture at the wrong phase
 * is not a hard measurement, it is a different run.
 *
 * ## How this chooses
 *
 * By the count: whichever of the two captures the port draws more of
 * exactly. That is not the test the comparison would like -- it uses
 * the port to choose the thing the port is then measured against --
 * so it is worth being exact about what it can and cannot hide.
 *
 * It cannot hide a difference between the port and the original: both
 * candidates are the original, and a port that is wrong somewhere is
 * wrong against both. What it can hide is the port being a tick late
 * or early in reading the keyboard, because then the capture that is
 * a tick out in the same direction would win. So the choice is kept
 * honest from the other end: `tools/dev/oracle-report.ts` marks a run
 * `PHASE` when the capture's own clock -- the level number under the
 * room, which the keys cannot move -- and the keys disagree about
 * which tick is which. A port that read the keyboard a tick late
 * would put a `PHASE` on every run it chose.
 *
 * A single tick was tried first and is not enough: the tick the two
 * captures first part company on is sometimes one the port is wrong
 * about, and then the wrong capture wins it. `probeF` is that case.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const [recPath, zeroPath, onePath] = process.argv.slice(2);
if (!recPath || !zeroPath || !onePath) {
  console.error('usage: pick-shift.ts <recording.json> <digest0> <digest1>');
  process.exit(2);
}
const rec = parseRecording(readFileSync(recPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);
const name = recPath.split('/').pop()?.replace(/\.json$/, '');

/** How many of this capture's ticks the port draws exactly. */
async function score(path: string): Promise<{ agreed: number; ticks: number }> {
  const digest = JSON.parse(readFileSync(path, 'utf8')) as Digest;
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  return exactAgreement(digest, port, inputChanges(ticks));
}

const zero = await score(zeroPath);
const one = await score(onePath);
const pick = one.agreed > zero.agreed ? 1 : 0;
console.log(`${name} ${pick}  (shift 0: ${zero.agreed} of ${zero.ticks}, `
  + `shift 1: ${one.agreed} of ${one.ticks})`);
