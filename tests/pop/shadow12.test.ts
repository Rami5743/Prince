/**
 * Level 12's shadow, and why no probe can reach him.
 *
 * `shadow5` and `shadow6` are captures of the original with the
 * shadow on the screen, both reached with nothing but the room
 * cheats -- `check_shadow` runs from `check_the_end`, so *drawing*
 * room 24 of level 5 or room 1 of level 6 is enough to raise him.
 * Both are now exact: 300 of 300 and 280 of 280.
 *
 * **Level 12's cannot be reached that way**, and this pins the
 * reason. `check_shadow`'s level-12 branch is
 *
 *     if (!united_with_shadow && drawn_room == 15) {
 *         Char.room = drawn_room;
 *         get_tile(15, 1, 0);
 *         if (curr_tile2 == tiles_22_sword) return;
 *         ...do_init_shad(init_shad_12, seq_7_fall);
 *     }
 *
 * and the tile at row 0 column 1 of room 15 **is** a sword when the
 * level begins. No cheat in `process_key` writes a tile, so the
 * shadow of level 12 needs the sword picked up, which is real play
 * -- the same wall that keeps the mirror of level 4 and the
 * skeleton of level 3 out of the capture suite, where the thing in
 * the way is a button.
 *
 * What a capture would have been for is settled instead by
 * `tests/render/surface.test.ts` and by `shadow6` going exact: the
 * box the player saw behind him was `blitters_3_xor` XORing the
 * bank's palette base into the sprite's transparent pixels, and the
 * shadow is the one thing in the game drawn with that write-mode.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { get_tile } from '../../src/pop/seg006.ts';
import { tiles, charids } from '../../src/pop/types.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe("level 12's shadow", () => {
  it('is held back by the sword in room 15, which no cheat can move', async () => {
    const game = await PopGame.start(assets, exe, 12);
    expect(get_tile(15, 1, 0)).toBe(tiles.tiles_22_sword);
    // Drawing room 15 is all a probe could do, and it is not enough.
    game.drawRoomNow(15);
    game.step({ x: 0, y: 0, shift: false });
    expect(g.Guard.charid).not.toBe(charids.charid_1_shadow);
    expect(g.Guard.frame).toBe(0);
  }, 60000);

  it('and falls into it the moment the sword is gone', async () => {
    const game = await PopGame.start(assets, exe, 12);
    get_tile(15, 1, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_0_empty;
    game.drawRoomNow(15);
    game.step({ x: 0, y: 0, shift: false });
    expect(g.Guard.charid).toBe(charids.charid_1_shadow);
    // `do_init_shad(init_shad_12, seq_7_fall)`: he comes down from
    // the top of the room.
    expect(g.Guard.frame).not.toBe(0);
    expect(g.Guard.room).toBe(15);
    expect(g.Guard.x).toBe(0x51);
    expect(g.Guard.y).toBe(0xe8);
  }, 60000);
});
