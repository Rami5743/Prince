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
import { goto_other_room, exit_room, load_room_links } from '../../src/pop/seg002.ts';
import { roomLinksOf } from '../../src/pop/state.ts';

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

  /**
   * And the room the garbage sends him to. Level 10's four bytes are
   * 128 apiece, so the original walks out of room 0 into "room 128"
   * and reads `roomlinks[127]` -- four hundred bytes past the array,
   * in among the guard tables. There is nothing to reproduce without
   * the level's raw image, which the port does not keep, so a room
   * that is not a room has no links at all; that is what the level
   * data uses for the edge of the world, and it stops the wandering
   * instead of carrying it on. What matters is that it does not
   * throw: `load_room_links` took the page down about one run of
   * level 10 in five.
   */
  it('a room past the end of the table has no links and does not throw', async () => {
    await PopGame.start(assets, exe, 10);
    expect(Array.from(g.level.doorlinks2.slice(252))).toEqual([128, 128, 128, 128]);
    expect(roomLinksOf(128)).toEqual({ left: 0, right: 0, up: 0, down: 0 });
    g.drawn_room = 128;
    expect(() => load_room_links()).not.toThrow();
    expect([g.room_L, g.room_R, g.room_A, g.room_B]).toEqual([0, 0, 0, 0]);
  });
});
