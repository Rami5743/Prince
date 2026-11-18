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
  tunesOf, detect, heardOf, scoreHeard, occupancy, scoreNoise,
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
 * `gate1snd` is the same run as the `gate1` picture digest -- eight
 * hundred ticks of level 1, six rooms, the only probe in the suite
 * that steps on a button and opens the exit door. Four of its
 * ninety-six noises are left: two clicks of under ten milliseconds
 * the port places two or three ticks off, and two past the end of the
 * run, where the capture goes on into the title music starting again.
 */
const EXPECTED: Record<string, number> = {
  title: 212,
  gate1snd: 92,
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
        const chan = occupancy(events, tunes);
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
