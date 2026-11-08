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
 * recording is therefore captured twice, the second time with the
 * schedule a tick later, and `tools/dev/pick-shift.ts` says which to
 * keep; `tools/oracle/digests/shifts.txt` records the answer, and
 * `tools/dev/oracle-report.ts` marks a run `PHASE` if its capture is
 * still the wrong side of a boundary. A number from a `PHASE` run is
 * not worth reading.
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
 * Two of these are *down* from where they were, which is normally not
 * allowed. They are `e209b01a` (205 to 192) and `probeF` (455 to 420),
 * and they went down when the port stopped standing a guard still for
 * two ticks after he follows the Prince through a door and started
 * doing what the original does instead: `exit_room_timer`, which
 * `redraw_screen` sets to 2, shuts the doorway for the two ticks after
 * the screen is drawn whole, and nothing is frozen.
 *
 * The freeze was measured, on `probeF`, and it was right about those
 * two ticks for the wrong reason, so it was wrong everywhere a room
 * change was not involved. Against the captures of the third round --
 * the first ones taken with the key schedule read off the timeline --
 * the change is worth seventy ticks of `0fbffa60` and costs
 * thirty-nine of `probeF`, which is the same recording as `f6874819`
 * sent twice and so counts once. These digests are the old captures,
 * whose keys are all a tick early; they are being replaced one at a
 * time as the round finishes, and every number here moves when that
 * is done.
 *
 * `f6874819` is down too, 293 to 276, and that one is the direction
 * latches: the original does not clear a latch when the key comes up,
 * and `control` clears all four on every tick a character is bumped or
 * falling. Together those are worth a hundred and sixty ticks on the
 * third round's captures -- `72b3522f` 177 to 381 of 386, `848ee3c4`
 * 1003 to 1215 of 1445, `756b259c` 297 to 432, `0fbffa60` 299 to 422 --
 * and seventeen ticks of this run's *old* capture go the other way.
 * The old capture's keys are a tick early throughout, which is exactly
 * what a change to when a key is acted on is most sensitive to.
 */
const EXPECTED: Record<string, number> = {
  '0fbffa60': 35,
  '13ab6867': 528,
  '25c4ebb8': 218,
  '33e8ace7': 300,
  '3764b76d': 189,
  '5920a8c2': 372,
  '72b3522f': 381,
  '756b259c': 263,
  '760c3e74': 1455,
  '848ee3c4': 188,
  '9b60bf3a': 297,
  'a356bdd6': 175,
  'b4ff4672': 357,
  'e209b01a': 195,
  'ec99dc5b': 179,
  'f6874819': 276,
  // Probes: the same machinery, with a timeline written here rather
  // than played by the player. `probeE` is `f6874819`'s own opening,
  // `probeC` is that followed by the climb at the left of room 2, and
  // `probeF` is the whole of `f6874819` sent again.
  'probeC': 234,
  'probeE': 160,
  'probeF': 421,
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
