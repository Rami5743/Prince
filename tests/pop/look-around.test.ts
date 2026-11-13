/**
 * H, J, U and N: the rooms the Prince is not in, and when a cheat
 * takes effect.
 *
 * `process_key`'s four look-around cheats are two lines of the C --
 * `draw_guard_hp(0, 10); next_room = room_L;` -- and everything that
 * follows is `check_the_end`, which `play_frame` runs at the end of
 * the same tick:
 *
 *     drawn_room = next_room; load_room_links();
 *     different_room = 1; loadkid();
 *     anim_tile_modif(); start_chompers();
 *     check_fall_flo(); check_shadow();
 *
 * `showRoom` used to write that out itself and had dropped the last
 * three of them, which is the same fault `startLevel` had in the
 * other place a room is drawn whole. So the shadow of levels 5 and 6
 * never appeared, no room's guard appeared -- `enter_guard` is the
 * tail of `check_shadow` -- and level 13's floors did not start to
 * fall. These are the three the capture can see.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const still = { x: 0, y: 0, shift: false };

/** Look along a chain of rooms, a cheat key at a time, and stop there. */
async function look(level: number, keys: string[], minutes = 60): Promise<PopGame> {
  const game = await PopGame.start(assets, exe, level, { minutesLeft: minutes });
  for (let t = 0; t < 10; t++) game.step(still);
  for (const key of keys) {
    game.cheat(key);
    for (let t = 0; t < 10; t++) game.step(still);
  }
  return game;
}

describe('the look-around cheats', () => {
  it('draws the room asked for, and at the end of the tick', async () => {
    const game = await PopGame.start(assets, exe, 5);
    // `pendingFirstTick`: the level's opening picture is on the screen
    // for the tick it was drawn on as well as the first played one.
    game.step(still);
    expect(g.drawn_room).toBe(7);
    game.cheat('u');
    // Nothing at all until the tick. `process_key` runs *inside*
    // `play_frame` -- `play_level_2` clears the hit-point deltas and
    // then calls it, and the keyboard is pumped four calls deeper in
    // `do_paused` -- so a cheat waits for `step`, which drains the
    // queue just after the clearing. Then `check_the_end`, at the end
    // of the same `play_frame`, switches the room.
    expect(g.drawn_room).toBe(7);
    expect(g.next_room).not.toBe(10);
    game.step(still);
    expect(g.drawn_room).toBe(10);
  });

  it('raises the shadow of level 5 when room 24 is drawn', async () => {
    // 7 -> up 10 -> right 11 -> right 24, and `check_shadow` puts the
    // shadow there because tile 3 of room 24 is still a potion.
    const game = await look(5, ['u', 'j', 'j']);
    expect(g.drawn_room).toBe(24);
    expect(g.Guard.charid).toBe(1); // charid_1_shadow
    expect(g.Guard.room).toBe(24);
    expect(g.Guard.alive).toBeLessThan(0);
    void game;
  });

  it('raises the shadow of level 6 when room 1 is drawn', async () => {
    // 24 -> left 2 -> 15 -> 6 -> 18 -> 1.
    const game = await look(6, ['h', 'h', 'h', 'h', 'h']);
    expect(g.drawn_room).toBe(1);
    expect(g.Guard.charid).toBe(1);
    expect(g.Guard.room).toBe(1);
    void game;
  });

  it('puts the guard of a room on the screen with it', async () => {
    // Level 6's room 6 has one, and `enter_guard` is what places him.
    const game = await look(6, ['h', 'h', 'h']);
    expect(g.drawn_room).toBe(6);
    expect(g.Guard.charid).toBe(2); // charid_2_guard
    expect(g.Guard.room).toBe(6);
    void game;
  });

  it('puts Jaffar in room 1 of level 13', async () => {
    // 23 -> above 17 -> left 1, which is the one way to his room that
    // does not pass through room 16 and set its floors falling.
    const game = await look(13, ['u', 'h'], 59);
    expect(g.drawn_room).toBe(1);
    expect(g.Guard.room).toBe(1);
    expect(g.Guard.alive).toBeLessThan(0);
    void game;
  });
});
