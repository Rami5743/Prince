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
import { GAME_DIR, REPO } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g, copyChar } from '../../src/pop/state.ts';
import { draw_hurt_splash } from '../../src/pop/seg008.ts';
import { loose_land } from '../../src/pop/seg007.ts';
import { on_guard_killed, clear_char, load_room_links } from '../../src/pop/seg002.ts';
import { play_kid_frame, play_guard_frame } from '../../src/pop/seg000.ts';
import * as seg006 from '../../src/pop/seg006.ts';
import { setPainter, type Peel } from '../../src/pop/seg008.ts';
import { jump_through_mirror } from '../../src/pop/seg003.ts';
import { hud } from '../../src/pop/link.ts';
import { tiles, charids, directions, seqids } from '../../src/pop/types.ts';
import { seqtbl_offset_char } from '../../src/pop/seg005.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const { get_tile_div_mod } = seg006;
/** `obj_xl`, which `get_tile_div_mod` leaves its remainder in. */
const obj_xl_of = (): number => seg006.obj_xl;

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
   * taken by `loadshad_and_opp` at the top of the same function --
   * back over `Kid`, which throws away whatever the guard's own frame
   * did to the Prince.
   *
   * One thing does: uniting with the shadow on level 12.
   * `autocontrol_shadow_level12` runs inside `play_guard`, and when
   * the Prince reaches the shadow it puts the Prince where the shadow
   * stood -- `Char.charid = charid_0_kid; savekid();` -- and clears
   * the shadow. Writing the stale `Opp` back over `Kid` a few lines
   * later undid exactly that, so uniting left the Prince where he
   * was.
   */
  it('uniting with the shadow moves the Prince to where it stood', async () => {
    await PopGame.start(assets, exe, 12);
    g.current_level = 12;
    g.drawn_room = 15;
    // The shadow, close enough to unite with, and past its own setup.
    g.shadow_initialized = 1;
    g.offguard = 1;
    g.Guard.charid = charids.charid_1_shadow;
    g.Guard.direction = directions.dir_FF_left;
    g.Guard.room = 15;
    g.Guard.curr_row = 0;
    g.Guard.curr_col = 4;
    g.Guard.alive = -1;
    g.Guard.sword = 0;
    g.Guard.frame = 15;
    g.Guard.x = 150;
    g.guardhp_curr = 1;
    // The Prince, five units away and unarmed.
    g.Kid.charid = charids.charid_0_kid;
    g.Kid.room = 15;
    g.Kid.curr_row = 0;
    g.Kid.curr_col = 4;
    g.Kid.alive = -1;
    g.Kid.sword = 0;
    g.Kid.frame = 15;
    g.Kid.x = 155;
    const was = g.Kid.x;

    play_guard_frame();

    // `savekid()` moved him to where the shadow was, and nothing put
    // the old copy back.
    expect(g.Kid.x).toBe(150);
    expect(was).toBe(155);
    expect(g.united_with_shadow).toBe(42);
    // And the shadow is gone.
    expect(g.Guard.direction).toBe(directions.dir_56_none);
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
  /**
   * **And no seam in `wire.ts` may be wired to nothing.**
   *
   * `link.ts`'s own `slot()` makes an unwired seam **throw** -- "has
   * not been linked in" -- so the only way a call across a segment
   * cycle can quietly do nothing is for `wire.ts` to fill it in with
   * an empty function. One was: `l2.set_start_pos.fn = () => {}`.
   *
   * It cost `rooms7` the only shortfall left in the suite that was
   * the port's. `play_kid`'s resurrect is the one caller that goes
   * through that seam -- `do_startpos` calls `set_start_pos`
   * directly -- so `r` left the Prince standing wherever his corpse
   * lay, two pixels above `y_land[Char.curr_row + 1]`, with
   * `fall_y`, `fall_x`, `is_feather_fall`, `upside_down`, `knock`,
   * the sword and `savekid()` all skipped. Nine pixels outside the
   * digest's mask, on fifty-two ticks: `rooms7` 1057 of 1109 ->
   * **1109 of 1109**.
   *
   * A seam is a translation of a call the C makes. There is no such
   * thing as one that should do nothing, so this reads the file.
   */
  it('wires every seam to a real function', () => {
    const wire = readFileSync(join(REPO, 'src', 'pop', 'wire.ts'), 'utf8');
    const stubs = [...wire.matchAll(/^\s*(\S+)\.fn = \([^)]*\)(: \w+)? => \{\s*\};?$/gm)]
      .map((m) => m[1]);
    expect(stubs, 'seams wired to an empty function').toEqual([]);
  });

  /**
   * **`play_guard`'s `goto` is not a `return`, and the tick a guard
   * dies is a tick he is still played.**
   *
   *     if (Char.alive < 0) {
   *         if (guardhp_curr == 0) { Char.alive = 0; on_guard_killed(); }
   *         else goto loc_7A65;
   *     }
   *     if (Char.charid == charid_1_shadow) clear_char();
   *     loc_7A65:
   *     autocontrol_opponent();
   *     control();
   *
   * The `goto` skips `clear_char` for a guard who is merely alive. It
   * does **not** skip the two calls after it, and the port had read
   * the whole of the kill branch as a `return`, so on the one tick
   * `guardhp_curr` reaches nought nothing ran at all.
   *
   * `control()` with `Char.alive >= 0` -- which the line above has
   * just written -- is three lines long: a character standing on
   * frame 15, 166, 158 or 171 is put into `seq_71_dying`. So a guard
   * whose last hit point comes off while he is standing collapses on
   * that tick in the original and a tick later in the port.
   *
   * Measured, one tick after `guardhp_curr` reaches nought with
   * `Guard.alive` still -1 and the guard standing on `seq_2_stand`:
   *
   *     guard, frame 166    the C 179 (collapse 1)   the port 15
   *     guard, frame  15    the C 179                the port 15
   *     shadow              direction 86 (none)      direction -1
   *
   * -- the shadow's being `clear_char`, which the original runs on
   * the death tick and the port ran on the one after, so the mirror
   * shadow of level 4 stayed on the screen a tick longer than he
   * should.
   *
   * **No digest moves by a tick**, measured: 32260 of 33047 either
   * way, run for run. The one probe in the suite that kills a guard
   * is `killguard6`, and `k` is `guardhp_delta = -guardhp_curr;
   * Guard.alive = 0` -- it writes `alive` itself, so it never takes
   * this branch at all and reads 299 of 299 both ways.
   */
  it('the tick a guard dies still runs control and clear_char', async () => {
    const standing = async (charid: number, frame: number) => {
      await PopGame.start(assets, exe, 4);
      g.drawn_room = g.Kid.room;
      g.Guard.charid = charid;
      g.Guard.direction = directions.dir_FF_left;
      g.Guard.room = g.drawn_room;
      g.Guard.curr_row = 1;
      g.Guard.curr_col = 5;
      g.Guard.alive = -1;
      g.Guard.sword = 0;
      g.Guard.frame = frame;
      g.Guard.x = 120;
      g.Guard.y = 118;
      copyChar(g.Char, g.Guard);
      seqtbl_offset_char(seqids.seq_2_stand);
      g.Guard.curr_seq = g.Char.curr_seq;
      // The last hit point has just come off in `do_delta_hp`, which
      // runs after `play_guard_frame`: so the next tick opens with
      // `guardhp_curr` nought and `Guard.alive` still -1.
      g.guardhp_curr = 0;
      g.guardhp_max = 3;
      g.shadow_initialized = 1;
      play_guard_frame();
      return { frame: g.Guard.frame, dir: g.Guard.direction };
    };
    // frame_179_collapse_1, the first frame of `seq_71_dying`.
    expect(await standing(charids.charid_2_guard, 166)).toEqual({ frame: 179, dir: -1 });
    expect(await standing(charids.charid_2_guard, 15)).toEqual({ frame: 179, dir: -1 });
    // And a shadow is `clear_char`'d on the same tick, not the next.
    expect(await standing(charids.charid_1_shadow, 15))
      .toEqual({ frame: 179, dir: directions.dir_56_none });
  });

  /**
   * **`get_tile_div_mod` reads off the ends of its two tables, and
   * the original's answer is not `xpos & 0xff`.**
   *
   * `get_tile_div_mod` is two unchecked array reads --
   * `obj_xl = tile_mod_tbl[xpos]; return tile_div_tbl[xpos];` -- and
   * the two tables are 256 bytes each, laid out `tile_div_tbl` then
   * `tile_mod_tbl`. So a negative `xpos` reads `tile_div_tbl` for
   * `xl` and the bytes **in front of** `tile_div_tbl` for `xh`, and
   * SDLPoP writes both runs out verbatim to simulate it.
   *
   * The port answered `tile_div_tbl[xpos & 0xff]` under a comment
   * saying the game's own range of x never notices. It does not, and
   * that is measured: over every recording in the suite, every tick,
   * `xpos` runs **30 to 242**. But eight seeds of random keys over
   * all fourteen levels get it to **-4**, where the two answers are
   * not even the same pair -- `& 0xff` gives `tile_div_tbl[252]` for
   * `xh` where the original gives the byte 0xB5 before the table.
   *
   * So no score can move by this and no score could have caught it.
   */
  it('reads off the ends of the tile tables the way the DOS game does', () => {
    // In range, which is every tick anything in the suite plays.
    expect([get_tile_div_mod(58), obj_xl_of()]).toEqual([0, 0]);
    expect([get_tile_div_mod(72), obj_xl_of()]).toEqual([1, 0]);
    expect([get_tile_div_mod(255), obj_xl_of()]).toEqual([14, 1]);
    // Before the table: `xh` out of the bytes in front of
    // `tile_div_tbl`, `xl` out of `tile_div_tbl` itself.
    expect([get_tile_div_mod(-1), obj_xl_of()]).toEqual([0, 14]);
    expect([get_tile_div_mod(-4), obj_xl_of()]).toEqual([181, 13]);
    // And past the end: `xh` out of `tile_mod_tbl`, `xl` out of the
    // bytes after it.
    expect([get_tile_div_mod(256), obj_xl_of()]).toEqual([12, 244]);
    expect([get_tile_div_mod(260), obj_xl_of()]).toEqual([2, 44]);
  });

  /**
   * **H, J, U, N and Ctrl+B erase the guard's hit points, even when
   * the room asked for is the one already drawn.**
   *
   * `process_key`'s five looking-around cheats are each two lines:
   *
   *     case SDL_SCANCODE_H: draw_guard_hp(0, 10); next_room = room_L; break;
   *
   * and there is no test in front of them. The port's `showRoom`
   * opened on `if (room === g.drawn_room) return;`, which costs
   * nothing for `next_room` -- `check_the_end` is
   * `if (next_room != 0 && next_room != drawn_room)` and does
   * nothing either way -- but skips the erase. So **Ctrl+B pressed
   * in the room the Prince is already in**, which is the ordinary
   * way to stop looking around, left the guard's flasks painted
   * under the room where the original rubs them out. Nothing
   * redraws them: `draw_hp` only touches them while `guardhp_delta`
   * is set.
   *
   * No digest moves by it, measured: 32260 of 33047 either way, run
   * for run.
   */
  it('looking at the room already drawn still erases the guard hit points', async () => {
    const game = await PopGame.start(assets, exe, 2);
    const blits: Array<{ x: number; y: number; blit: number }> = [];
    // The painter is one global and `PopGame.start` sets it, so the
    // recorder goes in after the game is built and the next
    // `PopGame.start` puts the real one back.
    setPainter({
      image: () => null,
      blit: (_chtab, _id, x, y, blit) => { blits.push({ x, y, blit }); },
      rect: () => {},
      clip: () => {},
      text: () => {},
      readPeel: () => ({ x: 0, y: 0, width: 0, height: 0, pixels: new Uint8Array(0) } as unknown as Peel),
      restorePeel: () => {},
      target: () => {},
    });
    g.Guard.charid = charids.charid_2_guard;
    game.showRoom(g.drawn_room);
    // `draw_guard_hp(0, 10)` is ten erases of the flask row and
    // nothing drawn: `blitters_9_black` on row 194.
    expect(blits.length).toBe(10);
    expect(blits.every((b) => b.blit === 9 && b.y === 194)).toBe(true);
    // And the real painter back, for whatever runs next.
    await PopGame.start(assets, exe, 1);
  });

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
