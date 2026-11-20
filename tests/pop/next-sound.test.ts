/**
 * `play_sound` does not play anything.
 *
 *     if (next_sound < 0 || sound_prio_table[sound_id]
 *                            <= sound_prio_table[next_sound]) {
 *         next_sound = sound_id;
 *     }
 *
 * It writes the sound into `next_sound`, keeping the most important of
 * however many are asked for in one tick, and `play_next_sound` -- the
 * last line of `draw_game_frame` -- starts that one and no other.
 *
 * The translation went straight to the device on every call, so a tick
 * that asked for several started several, each one stopping the one
 * before it after nought milliseconds. Level 10 has two gates rising
 * together and asks for `sound_5_gate_opening` **four times in the
 * same tick**: the gate stuttered where the original creaks.
 * `tools/dev/sound-trace.ts` counted twenty-four such ticks in that
 * one recording and none in it now.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { out } from '../../src/pop/link.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

async function gameWithEar(): Promise<{ game: PopGame; heard: number[] }> {
  const heard: number[] = [];
  const game = await PopGame.start(assets, exe, 1, {
    effects: {
      sound: (which: number) => { heard.push(which); },
      stopSounds: () => {},
      soundPlaying: () => false,
    },
  });
  return { game, heard };
}

describe('next_sound', () => {
  it('keeps the most important sound of the tick and plays it once', async () => {
    const { game, heard } = await gameWithEar();
    game.render();
    heard.length = 0;

    // 19 is a footstep, priority 0x82; 3 is a button, 0x66, which is
    // the more important of the two. The order they are asked in does
    // not matter.
    out.play_sound(19);
    out.play_sound(3);
    expect(heard, 'nothing is played until the frame is drawn').toEqual([]);
    game.render();
    expect(heard).toEqual([3]);
    expect(g.current_sound, '`play_kid` reads this').toBe(3);

    heard.length = 0;
    out.play_sound(3);
    out.play_sound(19);
    game.render();
    expect(heard, 'the other way round, the same answer').toEqual([3]);
  });

  it('plays one gate once however many ask for it', async () => {
    const { game, heard } = await gameWithEar();
    game.render();
    heard.length = 0;
    // Level 10's two gates rising together.
    for (let i = 0; i < 4; i++) out.play_sound(5);
    game.render();
    expect(heard).toEqual([5]);
  });

  /**
   * **`play_next_sound`'s own test, which the port left to the
   * device.**
   *
   *     if (next_sound >= 0) {
   *         if (!check_sound_playing() ||
   *             (sound_interruptible[current_sound] != 0 &&
   *              sound_prio_table[next_sound] <= sound_prio_table[current_sound]))
   *         {
   *             current_sound = next_sound;
   *             play_sound_from_buffer(sound_pointers[current_sound]);
   *         }
   *     }
   *     next_sound = -1;
   *
   * `SoundPlayer.mayTake` applies the same rule, so the right sound
   * reached the channel either way -- but the port wrote
   * `current_sound` whatever the device then did with it, and
   * `current_sound` is read by `play_kid`:
   * `if (check_sound_playing() && current_sound != 5) return;`, a
   * dying Prince waiting for whatever is sounding unless it is a
   * gate opening. With a gate in the channel and a footstep asked
   * for in the same tick, the device refuses the footstep (0xA0
   * against the gate's 0x37) and the channel still holds 5, while
   * `current_sound` said 23 and the Prince stopped to listen to a
   * sound nobody was playing.
   *
   * Only the browser can meet it: where there is no device,
   * `check_sound_playing` answers nought and the first half of the
   * test is always true. Pictures 32260 of 33047 and sounds 493 of
   * 494 either way.
   */
  it('refuses a sound the channel will not take, and keeps current_sound', async () => {
    const heard: number[] = [];
    let playing = false;
    const game = await PopGame.start(assets, exe, 1, {
      effects: {
        sound: (which: number) => { heard.push(which); },
        stopSounds: () => { playing = false; },
        soundPlaying: () => playing,
      },
    });
    game.render();
    heard.length = 0;

    // A gate takes the channel.
    out.play_sound(5);
    game.render();
    expect(heard).toEqual([5]);
    expect(g.current_sound).toBe(5);
    playing = true;

    // A footstep is worth 0xA0 against the gate's 0x37, so it is
    // refused -- and `current_sound` stays the gate.
    out.play_sound(23);
    game.render();
    expect(heard).toEqual([5]);
    expect(g.current_sound).toBe(5);

    // The feather is priority 0 and takes the channel off the gate.
    out.play_sound(39);
    game.render();
    expect(heard).toEqual([5, 39]);
    expect(g.current_sound).toBe(39);

    // And nothing at all takes it back: `sound_interruptible[39]` is
    // nought, which is the eighteen and a half seconds of silence
    // the capture measures after a feather.
    out.play_sound(0);
    game.render();
    expect(heard).toEqual([5, 39]);
    expect(g.current_sound).toBe(39);
  });

  it('empties the queue even when nothing could be played', async () => {
    const { game, heard } = await gameWithEar();
    game.render();
    heard.length = 0;
    out.play_sound(19);
    game.render();
    expect(heard).toEqual([19]);
    // `next_sound = -1` happens whatever the test in the middle said.
    game.render();
    expect(heard).toEqual([19]);
  });
});
