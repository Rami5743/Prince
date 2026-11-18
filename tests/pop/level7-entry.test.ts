/**
 * Level 7's falling entry, which is the one level the shell could not
 * draw.
 *
 * `do_startpos` does `next_room = Char.room = level.start_room` --
 * room 17 on level 7 -- and then `set_start_pos`'s special event does
 * `goto_other_room(3)`, which moves `Char.room` to the room below, 1,
 * and leaves `next_room` at 17. `savekid` carries room 1 into `Kid`,
 * and the C's `draw_level_first` then opens with
 * `next_room = Kid.room; check_the_end();` -- which is what puts the
 * pair back together.
 *
 * The translation wrote `check_the_end`'s body out by hand in
 * `startLevel` and set only `drawn_room`, so the level's first tick
 * found `next_room` 17 against `drawn_room` 1 and drew **room 17**,
 * which is empty: the player saw a black screen, fell down it and
 * landed dead, with nothing to tell him what had happened. On the
 * other thirteen levels the two numbers are equal and nothing showed.
 *
 * A capture of `PRINCE.EXE` taken for this round settles what the
 * original draws: at 118.0 seconds into the `level7` chain the screen
 * is **room 1**, the shaft with the Prince falling into it. A digest
 * of that capture scores the port 132 of 161 without the line and
 * **137** with it; the pinned `level7` digest, whose first fourteen
 * ticks the capture does not have, is 147 of 147 either way.
 *
 * And the fall is survivable, which is the other half of "level 7
 * cannot be played": holding shift as he drops grabs the ledge in
 * room 1. That is what the black screen took away -- not the chance
 * to live, but the chance to see that there was anything to grab.
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

describe('the falling entry of level 7', () => {
  it('opens on the room the Prince is in, not the one he started in', async () => {
    await PopGame.start(assets, exe, 7);
    // `goto_other_room(3)` has moved him out of room 17 already.
    expect(g.Kid.room).toBe(1);
    expect(g.drawn_room).toBe(1);
    // The line this test is here for.
    expect(g.next_room).toBe(g.Kid.room);
  });

  it('still draws room 1 once the level has begun stepping', async () => {
    const game = await PopGame.start(assets, exe, 7);
    for (let t = 0; t < 6; t++) game.step({ x: 0, y: 0, shift: false });
    expect(g.drawn_room).toBe(1);
  });

  it('lets him grab the ledge on the way down', async () => {
    const game = await PopGame.start(assets, exe, 7);
    for (let t = 0; t < 40; t++) game.step({ x: 0, y: 0, shift: true });
    expect(g.hitp_curr).toBe(3);
    expect(g.Kid.room).toBe(1);
  });

  it('and kills him if he does nothing, as the original does', async () => {
    const game = await PopGame.start(assets, exe, 7);
    for (let t = 0; t < 40; t++) game.step({ x: 0, y: 0, shift: false });
    expect(g.hitp_curr).toBe(0);
  });

  it('leaves the other levels opening where they started', async () => {
    for (const level of [1, 2, 6, 8, 13]) {
      await PopGame.start(assets, exe, level);
      expect(g.next_room).toBe(g.Kid.room);
      expect(g.drawn_room).toBe(g.Kid.room);
    }
  });
});
