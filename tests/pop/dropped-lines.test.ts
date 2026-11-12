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
import { on_guard_killed, clear_char, load_room_links } from '../../src/pop/seg002.ts';
import { play_kid_frame, play_guard_frame } from '../../src/pop/seg000.ts';
import { jump_through_mirror } from '../../src/pop/seg003.ts';
import { hud } from '../../src/pop/link.ts';
import { tiles, charids, directions } from '../../src/pop/types.ts';

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
  /**
   * `play_kid_frame` has three lines after `play_kid()` that the
   * translation had lost: a Prince who is dying turns the world the
   * right way up again. `Char.alive` is -1 while he lives, so the
   * reset only fires once the green potion's owner is on his way out.
   */
  it('dying cancels the upside-down potion', async () => {
    await PopGame.start(assets, exe, 1);
    g.upside_down = -1;
    play_kid_frame();
    // Alive: the world stays over.
    expect(g.upside_down).toBe(-1);
    g.Kid.alive = 0;
    play_kid_frame();
    expect(g.upside_down).toBe(0);
  });

  /**
   * `clear_char` erases the guard's flasks before it zeroes the
   * count. Nothing else will -- `draw_hp` only redraws them while
   * `guardhp_delta` is set -- so without this line every character
   * `clear_char` removes (the shadows of levels 4, 5 and 12, and the
   * mouse of level 8) left his hit points painted under the room.
   */
  it('clear_char rubs the guard hit points out first', async () => {
    await PopGame.start(assets, exe, 1);
    const asked: Array<[number, number]> = [];
    const was = hud.draw_guard_hp.fn;
    hud.draw_guard_hp.fn = (curr: number, max: number) => { asked.push([curr, max]); };
    try {
      g.guardhp_curr = 3;
      clear_char();
    } finally {
      hud.draw_guard_hp.fn = was;
    }
    expect(asked).toEqual([[0, 3]]);
    expect(g.guardhp_curr).toBe(0);
  });

  /**
   * `play_guard_frame` ends on `saveshad()`, not `saveshad_and_opp()`.
   * The second of those also writes `Opp` -- the copy of the Prince
   * taken at the top of the same function -- back over `Kid`, which
   * throws away anything the guard's own frame did to the Prince.
   *
   * The one that does it is the shadow of level 12: when the Prince
   * reaches him, `autocontrol_shadow_level12` moves the Prince to
   * where the shadow stood with `savekid()`. Writing the stale `Opp`
   * back over `Kid` undid exactly that.
   */
  it('the guard frame does not write the stale Prince back', async () => {
    await PopGame.start(assets, exe, 1);
    g.Guard.direction = directions.dir_FF_left;
    g.Guard.room = g.drawn_room;
    g.Guard.charid = charids.charid_2_guard;
    g.Guard.alive = -1;
    g.Guard.x = 100;
    // `loadshad_and_opp` will take this x into `Opp`; the frame then
    // moves the Prince, as the shadow of level 12 does.
    const moved = (g.Kid.x + 40) & 0xff;
    const original = { ...g.Kid };
    g.Kid.x = moved;
    play_guard_frame();
    expect(g.Kid.x).toBe(moved);
    expect(original.x).not.toBe(moved);
  });

  /**
   * `jump_through_mirror` sets `Char.charid` and then `saveshad()`.
   * The translation set `Guard.charid` and then copied the whole of
   * `Char` over `Guard`, which put the Prince's own `charid_0_kid`
   * straight back on top of it -- so what came through the glass on
   * level 4 was an ordinary guard, drawn solid and run by
   * `autocontrol_kid` rather than `autocontrol_shadow_level4`.
   */
  it('what comes through the mirror is the shadow', async () => {
    await PopGame.start(assets, exe, 1);
    g.current_level = 4;
    g.hitp_max = 3;
    g.hitp_curr = 3;
    g.jumped_through_mirror = -1;
    jump_through_mirror();
    expect(g.Guard.charid).toBe(charids.charid_1_shadow);
    expect(g.guardhp_curr).toBe(3);
    expect(g.hitp_curr).toBe(1);
    expect(g.jumped_through_mirror).toBe(0);
  });
  /**
   * `load_room_links` had only the `if` halves of its two pairs. With
   * no room directly above, the original still reaches the rooms
   * above-left and above-right by going sideways first and then up,
   * and the same below; without those four lines the four diagonals
   * stayed nought.
   *
   * Three things read them: `bumped`, which is how a character bumps
   * into a wall of the room below-left or below-right;
   * `get_trob_right_above_pos_in_drawn_room` and its twin, which is
   * how a gate or a loose floor in a diagonal room asks for its
   * redraw; and `load_leftroom`, which takes the left-hand column of
   * the row below from `room_BL`.
   *
   * Level 1 has two rooms that show it: room 3 has nothing above it
   * and room 1 above-left, and room 6 has nothing below it and room
   * 11 below-left.
   */
  it('the diagonal rooms are found sideways when there is none above', async () => {
    await PopGame.start(assets, exe, 1);
    g.drawn_room = 3;
    load_room_links();
    expect(g.room_A).toBe(0);
    expect(g.room_AL).toBe(1);
    g.drawn_room = 6;
    load_room_links();
    expect(g.room_B).toBe(0);
    expect(g.room_BL).toBe(11);
  });
});
