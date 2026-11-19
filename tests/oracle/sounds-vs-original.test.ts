/**
 * What the player hears, against a recording of what `PRINCE.EXE`
 * plays.
 *
 * The scores these pin are the first sound measurements this project
 * has ever had. Every one of the fifty digests beside them is a
 * picture, the capture chain ran DOSBox with `pcspeaker=false`, and
 * three of the five bugs a human found in one sitting by playing the
 * page were sound -- while neither score moved by a tick when all
 * five were fixed.
 *
 * `tools/oracle/sound_notes.py` turns a recording of the mixer into
 * notes and into stretches of noise; `tools/dev/sound-report.ts`
 * scores the port against them. See `tools/oracle/README.md`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  specOf, digestOf, sceneSounds, spanOf,
} from '../../tools/dev/sound-report.ts';
import {
  tunesOf, detect, heardOf, scoreHeard, noises, scoreNoise,
  type SoundNote, type Noise,
} from '../../tools/dev/sound-common.ts';
import { Assets } from '../../src/render/assets.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const DIGESTS = join(import.meta.dirname, '..', '..', 'tools', 'oracle', 'digests');
const assets = new Assets(
  async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

/**
 * What each capture scores now.
 *
 * `title` is **exact**: every one of the six sounds `show_title` plays
 * over seventy-two seconds, and every note of every one of them, with
 * the port's start inside 0.18 seconds of the original's.
 *
 * `cutscene2snd` is the scene before level 2 -- the one the player's
 * five bugs lived in -- and it is exact at +0.00 seconds.
 *
 * `gate1snd` is the same run as the `gate1` picture digest -- eight
 * hundred ticks of level 1, six rooms, the only probe in the suite
 * that steps on a button and opens the exit door, and the capture
 * that settles the bug the player reported as "no exit door sound".
 *
 * The door is **exact**. `animate_leveldoor` asks for
 * `sound_15_leveldoor_sliding` on each of the forty-three ticks the
 * door takes to rise; the tune is a quarter of a second and, with
 * `sound_interruptible[15]` at 0, it holds the channel until it ends,
 * so the port sounds unbroken from tick 696 to tick 738 -- 3.500
 * seconds. The capture of the original has one unbroken noise there
 * of **3.498**. And `sound_41_end_level_music`, which the Prince's
 * climb into the door asks for at tick 768, agrees to four
 * milliseconds: the capture's three stretches are 0.683, 1.062 and
 * 6.791 (the last cut off by the end of the recording) where the
 * game's own tune has 0.688, 1.063 and 9.375.
 *
 * Those three stretches are why this read 92 and not 94. The
 * capture's extractor breaks a noise at a rest of over fifty
 * milliseconds and `occupancy` did not, so a tune with rests in it
 * arrived as one interval against three and the report called two of
 * the three "the original alone". `noises()` splits the port's side
 * by the same rule.
 *
 * Two are left: clicks of nought and eight milliseconds at 30.65 and
 * 33.81 seconds, which no origin pairs with anything the port plays
 * -- the seven blips around them all sit a steady 0.216 s off.
 *
 * `level10bsnd` is **exact, 90 of 90**, and it is the run the gate
 * stutter was found on: `animate_door` asks for `sound_5_gate_opening`
 * four times in one tick there, which before the queue in front of
 * the device started four sounds, each stopping the one before after
 * nought milliseconds. The capture plays one.
 */
const EXPECTED: Record<string, number> = {
  title: 212,
  cutscene2snd: 21,
  gate1snd: 94,
  level10bsnd: 90,
};

describe('the sound, against a capture of the original', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const have = existsSync(join(DIGESTS, `${name}.sound.json`));
    it.skipIf(!have)(`${name} matches ${expected}`, async () => {
      const spec = specOf(name);
      const digest = digestOf(name);
      const tunes = await tunesOf(assets);
      const events = await sceneSounds(spec);
      let got: number;
      let of: number;
      if (spec.recording) {
        const chan = noises(events, tunes);
        const s = scoreNoise((digest.active ?? []) as readonly Noise[], chan,
                             digest.origin ?? 0, spanOf(spec));
        got = s.matched;
        of = s.total;
      } else {
        const capture: SoundNote[] =
          digest.notes.map(([at, dur, hz]) => ({ at, dur, hz }));
        const s = scoreHeard(detect(capture, tunes), heardOf(events, tunes),
                             spanOf(spec));
        got = s.matched;
        of = s.total;
      }
      expect(got, `${name}: ${got} of ${of}`).toBeGreaterThanOrEqual(expected);
      expect(got, `${name} has improved -- raise the pin to ${got}`)
        .toBeLessThan(expected + 5);
    }, 300000);
  }
});
