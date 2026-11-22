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
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import {
  soundPriority, soundInterruptible, setSoundRelease, soundRelease, SOUND_RELEASES,
} from '../../src/render/audio.ts';

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

/**
 * **`sound_pcspeaker_exists`, and the two lines of `play_sound` the
 * port did not have.**
 *
 *     if (next_sound < 0 || sound_prio_table[id] <= sound_prio_table[next_sound]) {
 *         if (NULL == sound_pointers[id]) return;
 *         if (sound_pcspeaker_exists[id] != 0 ||
 *             sound_pointers[id]->type != sound_speaker) {
 *             next_sound = id;
 *         }
 *     }
 *
 * Six of the fifty-eight have no PC speaker version -- 1 falling, 11
 * sword moving, 19 drawing a sword, and the three loose-floor shakes
 * -- so on a speaker machine `play_sound` throws them away *before*
 * `next_sound` is written and whatever the tick had chosen before
 * them stands. The refusal being inside the priority test is what
 * makes it worth noises: a shake is 0x91 and a footstep 0x9A, so
 * without it the shake takes the tick and the footstep is lost.
 *
 * The capture runs a speaker machine -- that is how `show_title`'s
 * first wait was settled at 24.77 seconds against `IBM_SND1.DAT`'s
 * own 24.74 -- so with the lines in, `feather1snd` goes 49 of 50 to
 * **50** and `gate1snd` 94 of 96 to **95**: sounds 491 of 494 ->
 * **493**.
 *
 * The port does not hold the table; it asks the machine, through
 * `PopEffects.hasSound`, because that is what `sound_pointers[]` is.
 * The browser answers yes to all fifty-eight.
 */
describe('the sounds a PC speaker cannot make', () => {
  it('are the six, and IBM_SND1.DAT says so itself', async () => {
    const { SpeakerChannel } = await import('../../tools/dev/sound-common.ts');
    const { Assets } = await import('../../src/render/assets.ts');
    const assets = new Assets(
      async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
    const channel = await SpeakerChannel.load(assets);
    const missing: number[] = [];
    for (let i = 0; i < 58; i++) if (!channel.has(i)) missing.push(i);
    // The six with no speaker version, and the four indices with no
    // sound at all behind them -- 31, 34, 42 and 57, none of which is
    // a `soundids` value.
    expect(missing).toEqual([1, 11, 19, 20, 21, 22, 31, 34, 42, 57]);
  });

  it('match the bytes the release has left of sound_pcspeaker_exists', () => {
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    const prio = find(exe, PRIO_HEAD);
    // `sound_prio_table` is 58 bytes and the release writes two of
    // them away, so the next table starts 56 on.
    const at = prio + 56;
    // 0 and 1 are readable; 2 to 11 are eight bytes of pointer table.
    expect(exe[at]).toBe(1); // sound_0_fell_to_death
    expect(exe[at + 1]).toBe(0); // sound_1_falling, the first of the six
    expect(Array.from(exe.subarray(at + 2, at + 10)))
      .toEqual([0x15, 0x00, 0xb2, 0x01, 0x09, 0x00, 0xb0, 0x00]);
    // And after it, read two early again: twelve to eighteen are
    // there and nineteen to twenty-two are the other five of the six
    // but for 11, which the pointer table ate.
    expect(Array.from(exe.subarray(at + 10, at + 17))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(Array.from(exe.subarray(at + 17, at + 21))).toEqual([0, 0, 0, 0]);
  });
});

/**
 * The 1.3 tables, which the page may ask for and nothing else may.
 *
 * `fix_sound_priorities()` is three assignments and that is the whole
 * of what the later release changed about which sound wins a tick:
 *
 *     sound_interruptible[sound_49_spikes] = 1;
 *     sound_prio_table[sound_48_spiked] = 0x15;
 *     sound_prio_table[sound_10_sword_vs_sword] = 0x0D;
 *
 * The default must stay 1.0, because that is the release every
 * capture in this project was taken from: a headless tool that never
 * mentions a release has to hear 1.0's channel by construction, the
 * same way `SoundPlayer.quality` starts at `original`.
 */
describe('the DOS release the sound tables come from', () => {
  afterEach(() => setSoundRelease('1.0'));

  it('is 1.0 until something says otherwise', () => {
    expect(soundRelease()).toBe('1.0');
    expect(SOUND_RELEASES).toEqual(['1.0', '1.3']);
  });

  it('moves exactly the three bytes 1.3 moved, and no others', () => {
    const before = {
      prio: Array.from({ length: 58 }, (_, i) => soundPriority(i)),
      stop: Array.from({ length: 58 }, (_, i) => soundInterruptible(i)),
    };
    setSoundRelease('1.3');
    const after = {
      prio: Array.from({ length: 58 }, (_, i) => soundPriority(i)),
      stop: Array.from({ length: 58 }, (_, i) => soundInterruptible(i)),
    };
    expect(soundRelease()).toBe('1.3');

    const movedPrio = before.prio
      .map((v, i) => (v === after.prio[i] ? -1 : i))
      .filter((i) => i >= 0);
    const movedStop = before.stop
      .map((v, i) => (v === after.stop[i] ? -1 : i))
      .filter((i) => i >= 0);
    expect(movedPrio).toEqual([10, 48]);
    expect(movedStop).toEqual([49]);

    expect(before.prio[10]).toBe(0x0a);
    expect(after.prio[10]).toBe(0x0d);
    expect(before.prio[48]).toBe(0x19);
    expect(after.prio[48]).toBe(0x15);
    expect(before.stop[49]).toBe(false);
    expect(after.stop[49]).toBe(true);
  });

  it('puts 1.0 back exactly, byte for byte', () => {
    const was = Array.from({ length: 58 }, (_, i) => [
      soundPriority(i), soundInterruptible(i),
    ]);
    setSoundRelease('1.3');
    setSoundRelease('1.0');
    const now = Array.from({ length: 58 }, (_, i) => [
      soundPriority(i), soundInterruptible(i),
    ]);
    expect(now).toEqual(was);
  });

  it('leaves the spiking louder than the spikes in 1.3 and quieter in 1.0', () => {
    // `play_next_sound` takes the new sound when the old one may be
    // interrupted and the new one is at least as important. 1.0
    // refuses on both counts; 1.3 passes both.
    const takes = (): boolean =>
      soundInterruptible(49) && soundPriority(48) <= soundPriority(49);
    expect(takes()).toBe(false);
    setSoundRelease('1.3');
    expect(takes()).toBe(true);
  });
});
