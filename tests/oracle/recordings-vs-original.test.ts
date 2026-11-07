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
 * ## What is left when it is not exact
 *
 * The alignment may still slip by a tick, and pays two disagreements
 * for each tick of slip, because two things in the harness are a tick
 * wide and neither is the game:
 *
 * * Which tick a key press lands in. The game reads the keyboard once a
 *   tick; the emulator is sent the press on the clock, and where the
 *   clock sits inside a tick depends on how long DOSBox took to restart
 *   the level. `recording_to_script.mjs` puts each edge in the middle of
 *   its tick, which is the best that can be done without asking the
 *   game, and that is still half a tick either way.
 * * A room change. The original holds the screen black for one tick
 *   longer than the port, which is the redraw and not the game; see
 *   `ROOM_CHANGE_BLANK`.
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
import { runOf, exactAgreement, type Digest } from '../../tools/dev/digest-common.ts';

const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** How many ticks of each run the port draws exactly as the original. */
const EXPECTED: Record<string, number> = {
  '0fbffa60': 0,
  '13ab6867': 0,
  '25c4ebb8': 0,
  '33e8ace7': 0,
  '3764b76d': 0,
  '5920a8c2': 0,
  '72b3522f': 0,
  '756b259c': 0,
  '760c3e74': 0,
  '848ee3c4': 0,
  '9b60bf3a': 0,
  'a356bdd6': 0,
  'b4ff4672': 0,
  'e209b01a': 0,
  'ec99dc5b': 0,
  'f6874819': 0,
  // Probes: the same machinery, with a timeline written here rather
  // than played by the player. `probeE` is `f6874819`'s own opening,
  // `probeC` is that followed by the climb at the left of room 2, and
  // `probeF` is the whole of `f6874819` sent again.
  'probeC': 0,
  'probeE': 0,
  'probeF': 0,
};

async function score(name: string): Promise<{ agreed: number; ticks: number }> {
  const digest = JSON.parse(
    readFileSync(join(DIGESTS, `${name}.json`), 'utf8'),
  ) as Digest;
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    decodeTimeline(rec.timeline),
    digest,
  );
  const { agreed, ticks } = exactAgreement(digest, port);
  return { agreed, ticks };
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
