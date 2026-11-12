/**
 * Falling out of the bottom of a level, twice.
 *
 * `goto_other_room` is what puts the Prince in room 0 when he falls
 * out, and `fell_out` only kills him for it while `Char.alive < 0`.
 * Once he is already dying the room stays nought, and the next
 * `exit_room` calls `goto_other_room` again -- this time with
 * `Char.room` of nought, so the C reads `level.roomlinks[-1]`.
 *
 * That is the four bytes in front of `roomlinks` in the level struct,
 * which is the end of `doorlinks2`: garbage, but the original's own
 * garbage and the same every time. Here the array has no index -1, so
 * reading `.left` off `undefined` threw a `TypeError` and took the
 * page down with it. Random play reaches it on level 5 about one run
 * in ten.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { goto_other_room, exit_room } from '../../src/pop/seg002.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('leaving a room that is not a room', () => {
  it('reads what the C reads and does not throw', async () => {
    await PopGame.start(assets, exe, 5);
    g.Char.room = 0;
    g.Char.y = 100;
    g.Char.curr_row = 1;
    // Down: the C takes the fourth of the four bytes in front of
    // `roomlinks`, which is `doorlinks2[255]`.
    const expected = g.level.doorlinks2[255];
    const opposite = goto_other_room(3);
    expect(opposite).toBe(2);
    expect(g.Char.room).toBe(expected);
    // And the other three directions, which take 252, 253 and 254.
    for (const [dir, index] of [[0, 252], [1, 253], [2, 254]] as const) {
      g.Char.room = 0;
      goto_other_room(dir);
      expect(g.Char.room).toBe(g.level.doorlinks2[index]);
    }
  });

  /**
   * And the way it is reached in play: he is already dying -- so
   * `fell_out` will not take him -- and he is in room 0 at the
   * bottom of the screen, which is what `leave_room` calls leaving
   * downwards. `exit_room` then goes straight back into
   * `goto_other_room` with a room of nought.
   */
  it('exit_room from room 0 while dying does not throw', async () => {
    await PopGame.start(assets, exe, 5);
    g.Kid.room = 0;
    g.Kid.alive = 0; // dying, so `fell_out` leaves him be
    g.Kid.y = 220; // `chary >= 211`: leaving downwards
    g.Kid.curr_row = 2;
    g.exit_room_timer = 0;
    expect(() => exit_room()).not.toThrow();
    expect(g.Kid.room).toBe(g.level.doorlinks2[255]);
  });
});
