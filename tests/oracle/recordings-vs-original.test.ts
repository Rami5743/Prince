/**
 * Every recording the player sent, against a capture of the original,
 * tick by tick and pixel by pixel.
 *
 * ## The measurement
 *
 * A capture is a thousand pictures and twenty-five megabytes, so the
 * pictures cannot live in the repository. `tools/oracle/digest.py`
 * keeps a fingerprint of each of them instead: the screen written as
 * indices into the capture's own palette, with the pixels that are on
 * fire left out, and a CRC of that. The port computes the same number
 * from its own rendering. Equal means the two are the same picture, to
 * the pixel.
 *
 * This used to be a far weaker thing -- the box around whatever had
 * moved since the tick before -- and that weakness was written up here
 * as a property of the original: two captures of the same recording
 * agreed on 1397 of 1473 ticks, so ninety-five per cent was called the
 * ceiling. It is not. Captured twice at three thousand cycles and twice
 * at twenty thousand, the original gives the same pictures tick for
 * tick; the only pixels that differ between two of its own runs are the
 * torches, which pick their flame from the game's random numbers. The
 * ceiling was the measurement's.
 *
 * ## Which capture
 *
 * Where the key schedule's clock sits inside one of the game's ticks
 * cannot be chosen: it starts when Ctrl+A has restarted the level and
 * the game's own tick boundaries fall wherever that landed, so about
 * half of all captures read every key of the run a tick early. Each
 * recording is therefore captured three times, at `--shift -1`, `0`
 * and `1`, and `tools/dev/pick-shift.ts` says which to keep;
 * `tools/oracle/digests/shifts.txt` records the answer, and
 * `tools/dev/oracle-report.ts` marks a run `PHASE` if its capture is
 * still the wrong side of a boundary.
 *
 * ## What is left when it is not exact
 *
 * The alignment may still slip by a tick, and pays two disagreements
 * for each tick of slip, because the emulator's clock and the game's
 * are not the same clock.
 *
 * ## The numbers
 *
 * These are pins. They go up when something is fixed and they must not
 * go down. Where a recording ends in a sword fight the tail of it
 * cannot be matched at all: the fight is driven by the game's random
 * numbers, whose seed comes from the clock at startup, and once the
 * Prince dies at a different tick the two runs are different runs.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, REPO } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import {
  runOf, exactAgreement, inputChanges, type Digest,
} from '../../tools/dev/digest-common.ts';

const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/**
 * How many ticks of each run the port draws exactly as the original.
 *
 * Every number here is against the fourth and fifth rounds of capture,
 * taken after two faults in the measurement were found and fixed, and
 * they are not comparable with the numbers that stood here before.
 *
 * The first fault was the splitter. `split_ticks.py` turned a gap
 * between two screen changes into a count of ticks by dividing by the
 * measured rate and rounding, and a run whose rate was a shade under
 * twelve a second had a tick invented in it every few seconds -- 238
 * ticks claimed for the 235 `probeC` really has. Every tick after an
 * invented one is numbered wrong, so a run would match perfectly for
 * two hundred ticks and then match nothing. It now rounds the gap
 * down by three tenths of a tick before taking it, and the splitter's
 * own report says 385 changes and 385 ticks spanned where it used to
 * disagree with itself.
 *
 * The second was that two captures are not enough. Where the key
 * schedule's clock sits inside one of the game's ticks cannot be
 * chosen -- it starts when Ctrl+A has restarted the level, and the
 * game's tick boundaries fall wherever that landed -- so each
 * recording is captured at `--shift -1`, `0` and `1`, and
 * `tools/dev/pick-shift.ts` keeps whichever of the three the port
 * draws most of exactly. Three of the nineteen want -1 and two want
 * 1; `848ee3c4` is 353 of 1440 at shift 0 and 1314 of 1447 at shift 1,
 * which is what a capture half a tick the wrong side of a boundary
 * costs. The answers are written down in
 * `tools/oracle/digests/shifts.txt`.
 *
 * `tools/dev/oracle-report.ts` still marks a run `PHASE` when the
 * capture's own clock and the keys disagree about which tick is which,
 * and six of these do. Their numbers are the honest count of ticks
 * drawn exactly all the same; what the mark means is that the capture
 * could be a tick better placed, not that the port is wrong.
 */
const EXPECTED: Record<string, number> = {
  '0fbffa60': 625,
  '13ab6867': 562,
  '25c4ebb8': 375,
  '33e8ace7': 308,
  '3764b76d': 216,
  '5920a8c2': 412,
  '72b3522f': 384,
  '756b259c': 494,
  '760c3e74': 1490,
  '848ee3c4': 1411,
  '9b60bf3a': 453,
  'a356bdd6': 184,
  'b4ff4672': 393,
  'e209b01a': 210,
  'ec99dc5b': 237,
  'f6874819': 1112,
  // Probes: the same machinery, with a timeline written here rather
  // than played by the player. `probeE` is `f6874819`'s own opening,
  // `probeC` is that followed by the climb at the left of room 2, and
  // `probeF` is the whole of `f6874819` sent again.
  'probeC': 232,
  'probeE': 166,
  'probeF': 1116,
};

async function score(name: string): Promise<{ agreed: number; ticks: number }> {
  const digest = JSON.parse(
    readFileSync(join(DIGESTS, `${name}.json`), 'utf8'),
  ) as Digest;
  // A digest from before the fingerprints would quietly score nothing
  // and pass a pin of nothing, which is worse than failing.
  if (!digest.hash || !digest.palette) {
    throw new Error(`${name}: the digest has no fingerprints; recapture it`);
  }
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  return exactAgreement(digest, port, inputChanges(ticks));
}

describe('the recordings, against a capture of the original', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const have = existsSync(join(DIGESTS, `${name}.json`));
    it.skipIf(!have)(`${name} is exact on ${expected} ticks`, async () => {
      const { agreed, ticks } = await score(name);
      expect(agreed, `${name}: ${agreed} of ${ticks} ticks exact`)
        .toBeGreaterThanOrEqual(expected);
      // And the pin is kept honest: a jump means the number should move.
      expect(agreed, `${name} has improved -- raise the pin to ${agreed}`)
        .toBeLessThan(expected + 10);
    }, 120000);
  }
});
