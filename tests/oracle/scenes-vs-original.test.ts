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
  title: 512,
  /**
   * `end_sequence` -- **325 of 480**, from 1.
   *
   * The ending needs a thirteen-level chain and then the Prince in
   * room 5 of level 14, which is four taps of `h`: `check_the_end`
   * runs `end_sequence()` when the **drawn** room of level 14 is 5,
   * and that level's rooms go 4, 3, 2, 1, 5.
   *
   * Everything the round before this one read off the ending's first
   * capture was read off **the wrong scene**. That capture's
   * princess room is at 218.5 seconds, it fades in over sixty-three
   * frames, it has an hourglass on the carpet -- and four seconds
   * after it the screen is black again and six after it a level is
   * starting with `59 MINUTES LEFT` written under it. It is a
   * cutscene between two levels. The chain had lost a `shift+l`.
   *
   * A capture that does reach the ending is known by what follows
   * it: `the tyrant Jaffar lies dead`, the landscape, and then the
   * hall of fame. In this one the scene is at 231.4 seconds and
   * there is **no fade and no hourglass** -- black at video frame
   * 104, the whole room and all 46 of its colours at 108. Which is
   * what the C has: `end_sequence_anim` opens on
   * `copy_screen_rect(&screen_rect)`, calls no `fade_in_1`, and
   * never sets `hourglass_state` after `reset_cutscene` has zeroed
   * it.
   *
   * Four things, each measured against that capture:
   *
   * * the fade taken out, and the room put up whole: 1 -> 108;
   * * `init_ending_princess` back to the C's `init_princess`, which
   *   leaves her facing **left**. The last round turned her round
   *   and that moved her, because `load_frame_to_obj` is
   *   `obj_x = (char_dx_forward(dx) << 1) - 116` and
   *   `char_dx_forward` negates `dx` for a character facing left --
   *   so a direction is worth four times the frame's own `dx`, and
   *   the thirty-nine pixels the last round could not account for
   *   ("centred on 134 where x = 136 draws her centred on 173") is
   *   exactly that. There is no fitted `x = 118`;
   * * the hourglass taken out: 108 -> 219. The box
   *   `draw_hourglass` fills, x 152 to 170 and y 141 to 168, is
   *   carpet and nothing else on every frame of the capture's
   *   embrace, and a port that drew one differed there by **338
   *   pixels** on every frame and nowhere else;
   * * the spec's `remMin` 57 -> 58: 219 -> 325. `show_hof` prints
   *   `min - 1`, and the capture's hall of fame reads **57:57**.
   *
   * What is left is in three places, and the frames between them
   * are exact to the pixel -- port 450 to 1042 against capture 492
   * to 1084, nought unmasked differences:
   *
   * * the **fades**, which are the emulator's: `fade_out_1` into the
   *   story screen and `fade_out_2` into the hall of fame;
   * * the **cursor** of the name box, which blinks every six
   *   sixtieths. From capture frame 1203 the run alternates three
   *   exact, three not, all the way to the end -- the port's blink
   *   is exactly half a period out of the capture's, and nothing
   *   else in those frames differs;
   * * the Prince **running in**, capture 187 to 236.
   */
  ending: 325,
  /**
   * `cutscene2` -- **72 of 137** on a capture taken with a lossless
   * RGB encoder, where the same scene read 34 with the old one. See
   * `dosbox_oracle.py`: `-qp 0` is lossless in whatever space the
   * encoder works in, and `yuv444p` means ffmpeg rounds the colours
   * through YUV first. The digest hashes palette *indices* and a
   * scene's palette holds a thousand entries off its own fades, so
   * near-duplicates two units apart; a colour a unit or three out
   * then lands on a different index and the frame is marked wrong
   * although the picture is right.
   *
   * What the old capture found is still worth more than the number.
   *
   * **The eight rows under the room.** Every frame of this scene
   * differed from the capture in rows 192 to 199 and nowhere else:
   * the capture's are black and the port drew the floor of the
   * princess's room in them. Rows 97 to 179 of the same pair of
   * frames differ by five pixels in all, and with the clip in
   * (`clip_room`) the port's picture is the capture's **to the
   * pixel** -- the frames matched by hand are diff 0.
   *
   * What is left is the fade. `fade_in_1` in the port is one shade
   * every two sixtieths, which is what `make_pal_buffer_fadein(...,
   * 2)` and `do_simple_wait(timer_1)` say, so its sixty-three shades
   * take sixty-three frames of video. The capture takes **fifty-
   * three** -- the brightest pixel goes 4, 9, 12, 20, 25, 28, 32,
   * 36, 41, 49 ... 252 over frames 35 to 88, which is three and a
   * half shades per cutscene frame rather than three. That is
   * `proc_cutscene_frame`'s inner busy loop fitting a fourth
   * `proc_fade_frame` into a six-sixtieth cutscene frame whenever
   * there is room, and the port's driver, which steps the fade off
   * its own clock, cannot express it. The two fades are 109 of this
   * capture's 137 changes.
   */
  /**
   * `expired` -- 108 of 177, the hourglass the player gets when the
   * hour runs out.
   *
   * Reached by taking the hour off level 1 with the `-` cheat and
   * waiting out the last minute. Seventy-five presses for
   * fifty-nine minutes: a capture of fifty-nine landed only
   * fifty-six of them and stopped at `4 MINUTES LEFT`, and the cheat
   * refuses to go below one (`if (rem_min > 1) --rem_min`), so the
   * extra taps cost nothing.
   *
   * Its eight rows under the room are **drawn**, where the scene
   * before level 2 has them black -- see `clip_room`.
   */
  expired: 167,
  /**
   * The other five scenes between the levels, captured the same way
   * and all of them short for the same two reasons: the fades, and
   * the fourteen-odd frames of black at the start where `load_intro`
   * waits on whatever sound the level before was playing.
   *
   * The **pictures** are not the problem. Frames of each matched by
   * hand against the port's come out **diff 0** outside the mask --
   * `cutscene9` at capture frames 198, 240 and 278 matches the
   * port's 82, 121 and 139 to the pixel. What moves is when: the
   * offset between the two runs grows through the scene, which is
   * the cutscene-frame clock and not the drawing.
   *
   * `cutscene9` is the worst of them at 8 of 207 and its drift is
   * the largest -- 116 frames at the start of the mouse and 139 by
   * the end of it -- which is the thing to measure next with
   * `scene-frames.ts` and the capture side by side.
   */
  cutscene2: 73,
  cutscene4: 131,
  cutscene6: 75,
  cutscene8: 121,
  cutscene9: 136,
  cutscene12: 70,
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
      const spec = specOf(name);
      const port = await runScene(spec, digest);
      // The spec's own range, not the default: a scene reached by
      // playing is a minute or two into the video and `expired` is
      // 344 frames past where its `start` trims.
      const { top } = bestOffset(digest, port, spec.range ?? 240);
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
