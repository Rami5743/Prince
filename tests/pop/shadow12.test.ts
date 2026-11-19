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

  /**
   * And the box behind him is gone, in the picture.
   *
   * `blitters_3_xor` is the VGA write-mode that XORs the sprite's
   * byte into the screen's, so a sprite pixel of nought changes
   * nothing: `d ^ 0 == d`. `Surface.blitXor` XORed `base + v`, and
   * the shadow's bank base on every level is **112**, so every
   * transparent pixel of his bounding box had 112 XORed into what was
   * behind it. The shadow is the one thing in the game drawn that way
   * -- `drawShadow` is a `blitters_2_or` and a `blitters_3_xor` of
   * one frame a pixel apart.
   *
   * `shadow6` going 279 of 280 to exact is the measurement. This is
   * the thing the player sees, on the level he reported it on, and
   * the two readings beside each other on the eighth tick of the
   * shadow's fall -- the pixels of the stone ledge behind him, at
   * x 42 to 49 and y 62 to 65:
   *
   *     before   29 of the 32 black
   *     after     0 of the 32, and the wall's own 48,69,89 in most
   *               of them (his own leg crosses a few)
   *
   * No capture could ever have said so: `check_shadow` returns on the
   * sword still being in room 15 and no cheat writes a tile, so the
   * first test above is the reason there is no `shadow12` digest.
   */
  it('and the stone behind him is stone, not a black box', async () => {
    const game = await PopGame.start(assets, exe, 12);
    get_tile(15, 1, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_0_empty;
    game.drawRoomNow(15);
    let rgb = new Uint8Array();
    for (let t = 0; t < 8; t++) {
      game.step({ x: 0, y: 0, shift: false });
      rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
    }
    // He is in the air, a third of the way down the room.
    expect(g.Guard.charid).toBe(charids.charid_1_shadow);
    expect(g.Guard.y).toBe(69);
    let black = 0;
    const seen = new Set<string>();
    for (let y = 62; y <= 65; y++) {
      for (let x = 42; x <= 49; x++) {
        const i = (y * 320 + x) * 3;
        seen.add(`${rgb[i]},${rgb[i + 1]},${rgb[i + 2]}`);
        if (!rgb[i] && !rgb[i + 1] && !rgb[i + 2]) black++;
      }
    }
    expect(black, `the box is back: ${[...seen].join(' ')}`).toBe(0);
    expect([...seen]).toContain('48,69,89');
  }, 60000);
});
