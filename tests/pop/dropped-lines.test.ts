/**
 * Three lines of the C the translation had lost, each of which a
 * reading of `sdlpop/src` beside `src/pop` turned up and no capture
 * in the suite reaches.
 *
 * They are here because the score cannot guard them: the suite's
 * twenty-one recordings never hurt a character who is holding a
 * sword, never drop a loose floor on a raise button, and never reach
 * Jaffar. A pin of 11673 would not move if any of the three came
 * back out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { draw_hurt_splash } from '../../src/pop/seg008.ts';
import { loose_land } from '../../src/pop/seg007.ts';
import { on_guard_killed } from '../../src/pop/seg002.ts';
import { tiles } from '../../src/pop/types.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('the lines the translation dropped', () => {
  /**
   * `save_obj` and `load_obj` carry ten fields, and the four clipping
   * ones were not among the six this saved. `reset_obj_clip` inside
   * `draw_hurt_splash` then stood until something else set the clip,
   * and the next thing to read it is `add_sword_to_objtable` in the
   * same breath -- so a character hurt while holding a sword had the
   * sword drawn over whatever the wall in front of him should hide.
   */
  it('draw_hurt_splash puts the clipping rectangle back', async () => {
    await PopGame.start(assets, exe, 1);
    g.Char.frame = 20; // anything but `frame_178_chomped`
    g.Char.charid = 0;
    g.obj_clip_top = 11;
    g.obj_clip_bottom = 150;
    g.obj_clip_left = 33;
    g.obj_clip_right = 222;
    draw_hurt_splash();
    expect([g.obj_clip_top, g.obj_clip_bottom, g.obj_clip_left, g.obj_clip_right])
      .toEqual([11, 150, 33, 222]);
  });

  /**
   * `loose_land` is one `switch` with two fallthroughs in the C, and
   * the tile it switches on is not the tile its last case reads: the
   * raise-button case falls through to the button press, which
   * re-reads `tiletype`, and on into the floor case, which the switch
   * has already chosen. Re-testing the new value instead loses that
   * last case for a raise button, because the tile is debris by then
   * and debris is not in its list -- so the button stayed on the
   * screen with no redraw asked for.
   */
  it('a loose floor landing on a raise button asks for the redraw', async () => {
    await PopGame.start(assets, exe, 1);
    const room = g.drawn_room;
    const col = 4;
    const row = 1;
    const tilepos = row * 10 + col;
    g.curr_room_tiles[tilepos] = tiles.tiles_15_opener;
    g.curr_room_modif[tilepos] = 0;
    g.redraw_frames_full.fill(0);
    g.wipe_frames.fill(0);
    g.curmob = { xh: col << 2, y: 0, room, speed: 0, type: 0, row };
    loose_land();
    expect(g.curr_room_tiles[tilepos]).toBe(tiles.tiles_14_debris);
    expect(g.redraw_frames_full[tilepos]).toBeGreaterThan(0);
    expect(g.wipe_frames[tilepos]).toBeGreaterThan(0);
  });

  /**
   * `on_guard_killed` sets `is_show_time` between the flash and
   * `leveldoor_open`, so killing Jaffar puts the minutes left under
   * the room. The port flashed and opened the door in silence.
   */
  it("Jaffar's death asks for the time", async () => {
    await PopGame.start(assets, exe, 1);
    g.current_level = 13;
    g.is_show_time = 0;
    on_guard_killed();
    expect(g.is_show_time).toBe(1);
    expect(g.leveldoor_open).toBe(2);
  });
});
