/**
 * The cutscenes, against a capture of the original.
 *
 * Everything in `tests/oracle/recordings-vs-original.test.ts` is
 * gameplay. `show_title` -- what the player sees on every page load --
 * `end_sequence`, `expired` and the six scenes between the levels had
 * never been put beside a capture of `PRINCE.EXE` at all; they were
 * written out of the C with unit tests only, and a unit test pins what
 * the author believed the C does.
 *
 * ## What a scene capture is
 *
 * No keys are pressed in one, so there is no key-edge lottery, no
 * `which-key` search and no choosing between shifts: a scene is the
 * same picture at the same moment every time the original plays it,
 * except for `prandom`. The unit is a video frame rather than a game
 * tick -- a scene is written in sixtieths of a second and thirty
 * frames a second is the finest a grab resolves -- so
 * `tools/oracle/scene_frames.py` writes one picture per frame of video
 * on which the screen changed, `digest.py` fingerprints them as usual,
 * and `tools/dev/scene-common.ts` replays the port in steps of 1/30 of
 * a second against a model of the PC speaker, because
 * `while (check_sound_playing())` is three of the title's waits and
 * the length of the music *is* the timing of the scene.
 *
 * ## What is left when it is not exact
 *
 * Two things, and both are the harness.
 *
 * * **A fade.** The port draws the capture's fade exactly on every
 *   even frame and on no odd one. A fade step is two sixtieths,
 *   33.3ms, and the grab is thirty frames a second, 33.3ms, so the two
 *   beat together and every other grab lands in the middle of
 *   `set_pal_arr` walking the sixteen entries of a row. The capture's
 *   odd frames have some components of some entries advanced and
 *   others not, which no arithmetic on a palette can produce.
 * * **The princess's room.** Its six stars (`draw_star(prandom(
 *   N_STARS - 1), 1)`, one a cutscene frame) and its two torches
 *   (`get_torch_frame`, which is `prandom` twice over) come out of the
 *   generator the original seeds from its clock, exactly like a room's
 *   torches, and `digest.py --cutscene` masks them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exactAgreement, type Digest } from '../../tools/dev/digest-common.ts';
import {
  specOf, runScene, bestOffset, shifted,
} from '../../tools/dev/scene-report.ts';

const DIGESTS = join(import.meta.dirname, '..', '..', 'tools', 'oracle', 'digests');

/**
 * What the port draws of each capture, of the changes the capture has.
 *
 * `title` -- 426 of 606. The whole hundred seconds of it lines up: the
 * six `do_wait`s of the opening titles come out 65, 103, 32, 135, 118
 * against the capture's 67, 102, 33, 135, 117, the wait on the intro
 * music is 290 against 289, and the absolute frame numbers of the two
 * runs are within two of each other over the first ninety seconds.
 * What is short is the fades' odd frames and the tail of the
 * princess-room fades; see the note above.
 */
const EXPECTED: Record<string, number> = {
  title: 426,
};

describe('the scenes, against a capture of the original', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const have = existsSync(join(DIGESTS, `${name}.json`));
    it.skipIf(!have)(`${name} is exact on ${expected} of the capture's changes`, async () => {
      const digest = JSON.parse(
        readFileSync(join(DIGESTS, `${name}.json`), 'utf8'),
      ) as Digest;
      if (!digest.hash || !digest.palette) {
        throw new Error(`${name}: the digest has no fingerprints; recapture it`);
      }
      const port = await runScene(specOf(name), digest);
      const { top } = bestOffset(digest, port);
      let best: ReturnType<typeof exactAgreement> | null = null;
      for (const cand of top) {
        const got = exactAgreement(shifted(digest, cand.o), port);
        if (!best || got.agreed > best.agreed) best = got;
      }
      expect(best!.agreed, `${name}: ${best!.agreed} of ${best!.ticks} changes exact`)
        .toBeGreaterThanOrEqual(expected);
      expect(best!.agreed, `${name} has improved -- raise the pin to ${best!.agreed}`)
        .toBeLessThan(expected + 10);
    }, 300000);
  }
});
