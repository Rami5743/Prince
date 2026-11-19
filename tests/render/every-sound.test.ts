/**
 * Every sound the byte-code can raise has something to play.
 *
 * `SoundPlayer.preload` swallows a failed read with
 * `this.buffers.set(index, null)` and `play` then returns silently on
 * `buffer === null`, so a sound the game raises in play and cannot
 * find is **nothing at all** -- no error, no warning, no noise. That
 * is the hardest kind of fault to notice and the easiest to test for.
 *
 * It is also the cheap half of "the exit door makes no sound": if
 * `sound_15_leveldoor_sliding` had no playable this would say so in
 * a line. It has one, a 1.613-second recording in `DIGISND1.DAT`.
 *
 * Four indices in the 0..57 range have nothing -- 31, 34, 42 and 57
 * -- and not one of them is in `soundids`, so nothing can ask for
 * them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { loadSound } from '../../src/render/audio.ts';
import { soundids } from '../../src/pop/types.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const DIGI = ['DIGISND1.DAT', 'DIGISND2.DAT', 'DIGISND3.DAT'];
const MIDI = ['MIDISND1.DAT', 'MIDISND2.DAT', 'MIDISND3.DAT'];
const SPEAKER = ['IBM_SND1.DAT', 'IBM_SND2.DAT', 'IBM_SND3.DAT'];

describe('every sound the game can ask for', () => {
  it('has a recording, a tune or a beep behind it', async () => {
    const silent: string[] = [];
    for (const [name, index] of Object.entries(soundids)) {
      const i = index as number;
      const have = [
        await loadSound(assets, i, DIGI),
        await loadSound(assets, i, MIDI),
        await loadSound(assets, i, SPEAKER),
      ].filter(Boolean);
      if (!have.length) silent.push(`${i} ${name}`);
    }
    expect(silent, 'these are raised by the game and play nothing').toEqual([]);
  }, 120000);

  it('and the level door is a recording a second and a half long', async () => {
    const door = await loadSound(assets, soundids.sound_15_leveldoor_sliding, DIGI);
    expect(door?.kind).toBe('digi');
    const samples = (door as { kind: 'digi'; samples: Uint8Array; rate: number });
    expect(samples.samples.length / samples.rate).toBeGreaterThan(1.5);
  }, 60000);

  /**
   * And the rate it is recorded at, which is the whole of "the exit
   * door makes no sound".
   *
   * `sound_15_leveldoor_sliding` is at **2750 Hz** and every other
   * recording in the game is at 8200, 11000 or 14000. The Web Audio
   * spec only obliges a browser to take 8000 and up, and Chromium's
   * `createBuffer` throws `NotSupportedError` under 3000 -- so the
   * door threw where it was read, `SoundPlayer.read`'s `catch` wrote
   * it down as "neither a recording nor a tune", and every
   * `play(15)` for the rest of the session returned on that.
   *
   * Nothing measured against the original could see it. The capture
   * of `PRINCE.EXE` has one unbroken noise of 3.498 seconds over the
   * forty-two ticks the door rises and the port sounds for 3.500, so
   * `sound-report.ts` reads the door as exact -- because neither side
   * of that comparison goes through a browser.
   * `tests/browser/exit-door.test.ts` is the one that does: nought
   * plays before this, three after.
   *
   * So the number is pinned here, with the rule that reads it.
   */
  it('is the one recording in the game a browser will not take raw', async () => {
    const slow: string[] = [];
    for (const [name, index] of Object.entries(soundids)) {
      const got = await loadSound(assets, index as number, DIGI);
      if (got?.kind !== 'digi') continue;
      if (got.rate < 8000) slow.push(`${index} ${name} at ${got.rate} Hz`);
    }
    expect(slow).toEqual(['15 sound_15_leveldoor_sliding at 2750 Hz']);
  }, 120000);
});
