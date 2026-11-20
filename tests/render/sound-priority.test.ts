/**
 * The two sound tables, against the executable they came out of.
 *
 * `play_sound` does not play anything: it keeps the most important
 * sound of a tick in `next_sound`, and `play_next_sound` starts it
 * only if the channel is free, or if what is in it may be
 * interrupted by something at least as important --
 *
 *     sound_interruptible[current] != 0 &&
 *     sound_prio_table[next_sound] <= sound_prio_table[current]
 *
 * -- so the two tables decide what the player hears whenever two
 * things happen at once. SDLPoP defines `FIX_SOUND_PRIORITIES` by
 * default and runs `fix_sound_priorities()` before anything else,
 * whose own comment is "Change values to match those in PoP 1.3":
 * it moves `sound_48_spiked` from 0x19 to 0x15,
 * `sound_10_sword_vs_sword` from 0x0A to 0x0D, and marks
 * `sound_49_spikes` interruptible.
 *
 * The port had all three of the 1.3 values and **the executable
 * this project is measured against is 1.0**, so this reads the
 * tables straight out of it. No capture in the suite can: none of
 * the six sound probes fights with a sword or steps on a spike, and
 * no picture digest can hear at all.
 *
 * Both tables sit back to back in `PRINCE.EXE` and `UNCRKD.EXE`,
 * and ten bytes in the middle of each are written over by a
 * far-pointer table two bytes shorter than the run it replaces --
 * the same thing the release does to the `_` glyph of the font, and
 * the reason everything after it reads two bytes early. What can be
 * read is checked; what cannot is named.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { soundPriority, soundInterruptible } from '../../src/render/audio.ts';

/** The first ten entries of `sound_prio_table`, which are intact. */
const PRIO_HEAD = [0x14, 0x1e, 0x23, 0x66, 0x32, 0x37, 0x30, 0x30, 0x4b, 0x50];
/** The first ten of `sound_interruptible`, likewise. */
const INT_HEAD = [0, 1, 1, 1, 1, 1, 0, 1, 1, 1];

function find(exe: Uint8Array, head: readonly number[]): number {
  outer: for (let i = 0; i + head.length < exe.length; i++) {
    for (let k = 0; k < head.length; k++) if (exe[i + k] !== head[k]) continue outer;
    return i;
  }
  return -1;
}

describe('the sound priority tables', () => {
  for (const name of ['PRINCE.EXE', 'UNCRKD.EXE']) {
    it(`are ${name}'s own, where the release has not written over them`, () => {
      const exe = new Uint8Array(readFileSync(join(GAME_DIR, name)));
      const prio = find(exe, PRIO_HEAD);
      const inter = find(exe, INT_HEAD);
      expect(prio, 'sound_prio_table').toBeGreaterThan(0);
      expect(inter, 'sound_interruptible').toBeGreaterThan(0);
      // They are back to back, and the gap says how much of the
      // second one the far-pointer table ate: 58 bytes of
      // `sound_interruptible` occupy 45.
      expect(prio - inter).toBe(45);

      // 0 to 29 of each are intact.
      for (let i = 0; i < 30; i++) {
        expect(soundPriority(i), `sound_prio_table[${i}]`).toBe(exe[prio + i]);
        expect(soundInterruptible(i), `sound_interruptible[${i}]`)
          .toBe(exe[inter + i] !== 0);
      }
      // 30 to 39 are the eight bytes of pointer table, two short.
      expect(Array.from(exe.subarray(prio + 30, prio + 38)))
        .toEqual([0x1e, 0x00, 0xb2, 0x01, 0x09, 0x00, 0xb0, 0x00]);
      // So 40 to 57 are read two bytes early.
      for (let i = 40; i < 58; i++) {
        expect(soundPriority(i), `sound_prio_table[${i}]`).toBe(exe[prio + i - 2]);
      }

      // And the three `fix_sound_priorities` changes are not in.
      expect(soundPriority(10), 'sword vs sword').toBe(0x0a);
      expect(soundPriority(48), 'spiked').toBe(0x19);
      expect(soundInterruptible(49), 'spikes').toBe(false);
      // The feather, which is the one sound nothing may interrupt
      // and the one the capture measures: eighteen and a half
      // seconds of silence after it.
      expect(soundPriority(39)).toBe(0);
      expect(soundInterruptible(39)).toBe(false);
    });
  }
});
