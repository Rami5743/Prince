/**
 * `seg002.c`: leaving a room, the guard who lives in it, and the sword.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. Every `#ifdef FIX_` and `#ifdef
 * USE_` branch takes the side the unmodified game is on -- including
 * the ones about guards who walk off the edge of a room, which SDLPoP
 * fixes and the original does not.
 *
 * The shadow and the mouse are here because the C has them here. All
 * four of the shadow's minds -- the mirror image of level 4, the one
 * that drinks the potion on level 5, the one that steps across the gap
 * on level 6 and the one the Prince unites with on level 12 -- are
 * translated; no capture reaches those levels, so what stands behind
 * them is `tests/pop/levels-smoke.test.ts` and playing it.
 */
import { g, byteOf, sbyteOf, wordOf, roomLinksOf } from './state.ts';
import {
  x_bump, y_land, strikeprob, restrikeprob, blockprob, impblockprob,
  advprob, refractimer, extrastrength,
} from './data.ts';
import {
  tiles, charids, directions, frameids, seqids, sword_status, actions, soundids,
} from './types.ts';
import {
  get_tile, get_tile_at_char, get_tile_behind_char, get_tile_infrontof_char,
  get_tile_infrontof2_char, tile_is_floor, wall_type, char_dx_forward,
  distance_to_edge_weight, load_fram_det_col, load_frame_to_obj,
  set_char_collision, play_seq, take_hp, loadkid, savekid, loadshad, saveshad,
  loadkid_and_opp, savekid_and_opp, loadshad_and_opp, saveshad_and_opp,
  get_tilepos, get_tile_div_mod_m7, y_to_row_mod4, droppedout, setDroppedout,
} from './seg006.ts';
import { seqtbl_offset_char, draw_sword } from './seg005.ts';
import { trigger_button } from './seg007.ts';
import { prandom } from './seg009.ts';
import { hud, l8, out } from './link.ts';

const TILE_SIZEX = 14;
const TILE_MIDX = 7;
const FIRST_ONSCREEN_COLUMN = 5;
const SCREEN_TILECOUNTX = 10;
const NUM_GUARD_SKILLS = 12;
const CONTROL_HELD = -1;
const CONTROL_IGNORE = 1;
const CONTROL_RELEASED = 0;
const CONTROL_HELD_FORWARD = -1;
const CONTROL_HELD_BACKWARD = 1;
const CONTROL_HELD_UP = -1;
const CONTROL_HELD_DOWN = 1;

/** `tbl_guard_hp` and `tbl_guard_type`, by level. */
export const guards = {
  hp: (_level: number): number => 0,
  type: (_level: number): number => 0,
};

/**
 * `custom->demo_moves`, which is `demo_moves[]` in the executable.
 *
 * Twenty-five `[time, move]` pairs, read out of `PRINCE.EXE` by
 * `readExeConstants` rather than copied here, the same way the frame
 * and sequence tables are. `game.ts` fills this in.
 */
export const demo = {
  moves: [[0, -1]] as readonly (readonly [number, number])[],
};

export let curr_guard_color = 0;
/** `curr_guard_color`, where the shell can read it. */
export const guardColor = { value: 0 };

// seg006:17D7
export function char_opp_dist(): number {
  // Positive when the opponent is in front of him, negative behind.
  if (g.Char.room !== g.Opp.room) return 999;
  let distance = g.Opp.x - g.Char.x;
  if (g.Char.direction < directions.dir_0_right) distance = -distance;
  if (distance >= 0 && g.Char.direction !== g.Opp.direction) distance += 13;
  return distance;
}

// seg006:1634
export function clear_char(): void {
  g.Char.direction = directions.dir_56_none;
  g.Char.alive = 0;
  g.Char.action = 0;
  /**
   * `draw_guard_hp(0, guardhp_curr)`, which the translation dropped.
   *
   * It is what rubs the guard's flasks off the strip under the room.
   * Nothing else will: `draw_hp` only redraws them while
   * `guardhp_delta` is set, and the next line here takes the count to
   * nought without touching the delta. So every character this
   * removes -- the shadow of level 4 walking off the left of the
   * mirror room, the one of level 5 who drinks the potion and goes,
   * the mouse of level 8 once it has reached the right of the room,
   * and the shadow of level 12 the moment the Prince unites with him
   * -- used to leave his flasks painted on the screen for the rest of
   * the level.
   */
  hud.draw_guard_hp.fn(0, g.guardhp_curr);
  g.guardhp_curr = 0;
}

// seg006:17F4
export function inc_curr_row(): void {
  ++g.Char.curr_row;
}

// seg006:15E8
export function on_guard_killed(): void {
  if (g.current_level === 0) {
    // The demo level: once the guard is dead the Prince runs out of
    // the room, which is what `do_demo`'s `checkpoint` branch does.
    g.checkpoint = 1;
    g.demo_index = 0;
    g.demo_time = 0;
  } else if (g.current_level === 13) {
    // Jaffar's level: the screen flashes.
    g.flash_color = 15;
    g.flash_time = 18;
    /**
     * And the hour is announced, which the translation had dropped.
     *
     * `seg006.c`'s `on_guard_killed` sets `is_show_time` between the
     * flash and `leveldoor_open`, so the moment Jaffar dies the game
     * puts the minutes left under the room -- the player's reward for
     * the fight, and the number the whole run is played against. The
     * port flashed and opened the door in silence.
     */
    g.is_show_time = 1;
    g.leveldoor_open = 2;
    out.play_sound(soundids.sound_43_victory_Jaffar);
  } else if (g.Char.charid !== charids.charid_1_shadow) {
    out.play_sound(soundids.sound_37_victory);
  }
}

// seg008:0023
export function load_room_links(): void {
  g.room_BR = 0;
  g.room_BL = 0;
  g.room_AR = 0;
  g.room_AL = 0;
  if (g.drawn_room) {
    // The C's first line, and the translation had dropped it: every
    // caller of this is a room change, and without it `curr_room_tiles`
    // and `curr_room_modif` go on pointing at the room before. The
    // torches and potions of the new room were then started at the tile
    // positions of the old one -- so they never animated -- and every
    // write to a modifier after a room change landed in the wrong room,
    // which pressed buttons, opened gates and shook loose floors that
    // nothing had touched.
    l8.get_room_address.fn(g.drawn_room);
    const link = roomLinksOf(g.drawn_room);
    g.room_L = link.left;
    g.room_R = link.right;
    g.room_A = link.up;
    g.room_B = link.down;
    /**
     * The four diagonals, and the `else` halves the translation had
     * dropped.
     *
     * With no room directly above, the original still finds the two
     * rooms above-left and above-right -- by going sideways first and
     * then up -- and the same below. Without those four lines
     * `room_AL`, `room_AR`, `room_BL` and `room_BR` stayed nought
     * whenever the room had nothing over or under it, and three
     * things read them: `bumped` (`curr_room == room_BL`), which is
     * how a character bumps into a wall of the room below-left;
     * `get_trob_right_above_pos_in_drawn_room` and its twin, which is
     * how a gate or a loose floor in a diagonal room asks for its
     * redraw; and `load_leftroom`, which takes the left-hand column
     * of the row below from `room_BL`.
     */
    if (g.room_A) {
      g.room_AL = roomLinksOf(g.room_A).left;
      g.room_AR = roomLinksOf(g.room_A).right;
    } else {
      if (g.room_L) g.room_AL = roomLinksOf(g.room_L).up;
      if (g.room_R) g.room_AR = roomLinksOf(g.room_R).up;
    }
    if (g.room_B) {
      g.room_BL = roomLinksOf(g.room_B).left;
      g.room_BR = roomLinksOf(g.room_B).right;
    } else {
      if (g.room_L) g.room_BL = roomLinksOf(g.room_L).down;
      if (g.room_R) g.room_BR = roomLinksOf(g.room_R).down;
    }
  } else {
    g.room_L = 0;
    g.room_R = 0;
    g.room_A = 0;
    g.room_B = 0;
  }
}

// seg002:0035
export function get_guard_hp(): void {
  g.guardhp_max = extrastrength[g.guard_skill] + guards.hp(g.current_level);
  g.guardhp_curr = g.guardhp_max;
  g.guardhp_delta = g.guardhp_max;
}

// seg002:0064
export function check_shadow(): void {
  g.offguard = 0;
  if (g.current_level === 12) {
    // Special event: level 12's shadow.
    if (!g.united_with_shadow && g.drawn_room === 15) {
      g.Char.room = g.drawn_room;
      if (get_tile(15, 1, 0) === tiles.tiles_22_sword) return;
      g.shadow_initialized = 0;
      do_init_shad(INIT_SHAD_12, seqids.seq_7_fall);
      return;
    }
  }
  if (g.current_level === 6) {
    // Special event: level 6's shadow, who steps across the gap.
    g.Char.room = g.drawn_room;
    if (g.Char.room === 1) {
      if (g.leveldoor_open !== 0x4d) {
        out.play_sound(soundids.sound_25_presentation);
        g.leveldoor_open = 0x4d;
      }
      do_init_shad(INIT_SHAD_6, seqids.seq_2_stand);
      return;
    }
  }
  if (g.current_level === 5) {
    // Special event: level 5's shadow, who drinks the potion.
    g.Char.room = g.drawn_room;
    if (g.Char.room === 24) {
      if (get_tile(24, 3, 0) !== tiles.tiles_10_potion) return;
      do_init_shad(INIT_SHAD_5, seqids.seq_2_stand);
      return;
    }
  }
  enter_guard();
}

/**
 * `init_shad_6`, `init_shad_5` and `init_shad_12`: the first seven
 * bytes of a `char_type` -- frame, x, y, direction, column, row and
 * action -- for the shadow of each level that has one.
 */
const INIT_SHAD_6 = [0x0f, 0x51, 0x76, 0, 0, 1, 0] as const;
const INIT_SHAD_5 = [0x0f, 0x37, 0x37, 0, 0xff, 0, 0] as const;
const INIT_SHAD_12 = [0x0f, 0x51, 0xe8, 0, 0, 0, 0] as const;

// seg002:0000
export function do_init_shad(source: readonly number[], seq_index: number): void {
  g.Char.frame = source[0];
  g.Char.x = source[1];
  g.Char.y = source[2];
  g.Char.direction = sbyteOf(source[3]);
  g.Char.curr_col = sbyteOf(source[4]);
  g.Char.curr_row = sbyteOf(source[5]);
  g.Char.action = source[6];
  seqtbl_offset_char(seq_index);
  g.Char.charid = charids.charid_1_shadow;
  g.demo_time = 0;
  g.guard_skill = 3;
  g.guardhp_delta = g.guardhp_curr = g.guardhp_max = 4;
  saveshad();
}

/** `shad_drink_move`: what the shadow of level 5 does, tick by tick. */
const SHAD_DRINK_MOVE: readonly (readonly [number, number])[] = [
  [0x00, 0], [0x01, 1], [0x0e, 0], [0x12, 6],
  [0x1d, 7], [0x2d, 2], [0x31, 1], [0xff, -2],
];

// seg002:1083
export function do_auto_moves(moves: readonly (readonly [number, number])[]): void {
  if (g.demo_time >= 0xfe) return;
  ++g.demo_time;
  let demoindex = g.demo_index;
  /**
   * Past the end of the table, which `demo_moves` can reach and
   * `shad_drink_move` cannot.
   *
   * `do_auto_moves` stops at `demo_time >= 0xFE`, which is 254.
   * `shad_drink_move` ends on `{0xFF, -2}` -- a time beyond that
   * guard, so its index can never walk off the end. `demo_moves`
   * ends on `{0xE9, -1}`, which is 233, so from tick 234 the
   * original is reading whatever lies after the table: in SDLPoP
   * that is `shad_drink_move`, the next member of the same struct,
   * and in the executable it is the bytes before it, so there is no
   * one answer to copy. It is reachable: a demo whose Prince loses
   * the fight and dies goes on calling this while he lies there, and
   * before this guard the twenty-one ticks between 234 and 254 threw
   * `Cannot read properties of undefined` and took the page down.
   *
   * `-1` is what the last entry says to do, so that is what the
   * table says to go on doing -- which stops the wander instead of
   * carrying it on, the same answer `roomLinksOf` gives for a room
   * that is not a room.
   */
  if (moves[demoindex] === undefined) return;
  if (moves[demoindex]![0] <= g.demo_time) ++g.demo_index;
  else demoindex = g.demo_index - 1;
  switch (moves[demoindex]![1]) {
    case -1: break;
    case 0: move_0_nothing(); break;
    case 1: move_1_forward(); break;
    case 2: move_2_backward(); break;
    case 3: move_3_up(); break;
    case 4: move_4_down(); break;
    case 5: move_3_up(); move_1_forward(); break;
    case 6: move_6_shift(); break;
    case 7: move_7(); break;
    default: break;
  }
}

/** `draw_guard_hp` lives in seg000; linked here to avoid a cycle. */
export const hp = {
  draw_guard_hp: (_curr: number, _max: number): void => {},
  add_life: (): void => {},
};

// seg002:00DF
export function enter_guard(): void {
  const room_minus_1 = g.drawn_room - 1;
  /**
   * `level.guards_tile[drawn_room - 1] >= 30` means "no guard here",
   * and a room that is not a room has no guard either.
   *
   * The C reads the byte at that offset whatever `drawn_room` is; the
   * port's table is 24 long, so out of range it reads `undefined`,
   * `undefined >= 30` is **false**, and the function went on to make
   * a guard out of `undefined` -- `Char.curr_row = trunc(undefined /
   * 10)` is `NaN`, and the NaN spread through `Char.x`, `Guard.x` and
   * everything downstream of them. Fuzzing finds it on levels 10 and
   * 11, where falling out of the bottom of the level puts the Prince
   * in "room 128" (see `roomLinksOf`); it does not throw, it just
   * quietly stops drawing anybody.
   */
  if (room_minus_1 < 0 || room_minus_1 > 23) return;
  const guard_tile = g.level.guards_tile[room_minus_1];
  if (guard_tile >= 30) return;
  g.Char.room = g.drawn_room;
  g.Char.curr_row = Math.trunc(guard_tile / SCREEN_TILECOUNTX);
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.x = g.level.guards_x[room_minus_1];
  g.Char.curr_col = get_tile_div_mod_m7(g.Char.x);
  g.Char.direction = sbyteOf(g.level.guards_dir[room_minus_1]);
  // Only an ordinary guard is recoloured.
  curr_guard_color = guards.type(g.current_level) === 0
    ? g.level.guards_color[room_minus_1] : 0;
  curr_guard_color &= 0x0f;
  guardColor.value = curr_guard_color;
  // Level 3's guards are skeletons, and they do not die.
  g.Char.charid = guards.type(g.current_level) === 2
    ? charids.charid_4_skeleton : charids.charid_2_guard;
  const seq_hi = g.level.guards_seq_hi[room_minus_1];
  if (seq_hi === 0) {
    if (g.Char.charid === charids.charid_4_skeleton) {
      g.Char.sword = sword_status.sword_2_drawn;
      seqtbl_offset_char(seqids.seq_63_guard_active_after_fall);
    } else {
      g.Char.sword = sword_status.sword_0_sheathed;
      seqtbl_offset_char(seqids.seq_77_guard_stand_inactive);
    }
  } else {
    g.Char.curr_seq = g.level.guards_seq_lo[room_minus_1] + (seq_hi << 8);
  }
  play_seq();
  g.guard_skill = g.level.guards_skill[room_minus_1];
  if (g.guard_skill >= NUM_GUARD_SKILLS) g.guard_skill = 3;
  const frame = g.Char.frame;
  if (frame === frameids.frame_185_dead || frame === frameids.frame_177_spiked
    || frame === frameids.frame_178_chomped) {
    g.Char.alive = 1;
    hp.draw_guard_hp(0, g.guardhp_curr);
    g.guardhp_curr = 0;
  } else {
    g.Char.alive = -1;
    g.justblocked = 0;
    g.guard_refrac = 0;
    g.is_guard_notice = 0;
    get_guard_hp();
  }
  g.Char.fall_y = 0;
  g.Char.fall_x = 0;
  g.Char.action = actions.actions_1_run_jump;
  saveshad();
}

// seg002:0269
export function check_guard_fallout(): void {
  if (g.Guard.direction === directions.dir_56_none || g.Guard.y < 211) return;
  if (g.Guard.charid === charids.charid_1_shadow) {
    if (g.Guard.action !== actions.actions_4_in_freefall) return;
    loadshad();
    clear_char();
    saveshad();
  } else if (g.Guard.charid === charids.charid_4_skeleton
    && roomLinksOf(g.Guard.room).down === 3) {
    // A skeleton that falls into room 3 comes back. `Guard.room` can
    // be nought here -- a guard who falls out of the bottom of the
    // level is put there -- which is what `linksOfRoom` is for.
    g.Guard.room = roomLinksOf(g.Guard.room).down;
    g.Guard.x = 133;
    g.Guard.curr_row = 1;
    g.Guard.direction = directions.dir_0_right;
    g.Guard.alive = -1;
    leave_guard();
  } else {
    loadshad();
    on_guard_killed();
    saveshad();
    g.level.guards_tile[g.drawn_room - 1] = 0xff;
    g.Guard.direction = directions.dir_56_none;
    hp.draw_guard_hp(0, g.guardhp_curr);
    g.guardhp_curr = 0;
  }
}

// seg002:02F5
export function leave_guard(): void {
  if (g.Guard.direction === directions.dir_56_none
    || g.Guard.charid === charids.charid_1_shadow
    || g.Guard.charid === charids.charid_24_mouse) {
    return;
  }
  const room_minus_1 = g.Guard.room - 1;
  g.level.guards_tile[room_minus_1] = get_tilepos(0, g.Guard.curr_row);
  g.level.guards_color[room_minus_1] = curr_guard_color & 0x0f;
  g.level.guards_x[room_minus_1] = g.Guard.x;
  g.level.guards_dir[room_minus_1] = byteOf(g.Guard.direction);
  g.level.guards_skill[room_minus_1] = g.guard_skill;
  if (g.Guard.alive < 0) {
    g.level.guards_seq_hi[room_minus_1] = 0;
  } else {
    g.level.guards_seq_lo[room_minus_1] = g.Guard.curr_seq & 0xff;
    g.level.guards_seq_hi[room_minus_1] = g.Guard.curr_seq >> 8;
  }
  g.Guard.direction = directions.dir_56_none;
  hp.draw_guard_hp(0, g.guardhp_curr);
  g.guardhp_curr = 0;
}

// seg002:039E
export function follow_guard(): void {
  g.level.guards_tile[g.Kid.room - 1] = 0xff;
  g.level.guards_tile[g.Guard.room - 1] = 0xff;
  loadshad();
  goto_other_room(g.roomleave_result);
  saveshad();
}

// seg002:03C7
export function exit_room(): void {
  let leave = 0;
  if (g.exit_room_timer !== 0) {
    --g.exit_room_timer;
    return;
  }
  loadkid();
  load_frame_to_obj();
  set_char_collision();
  g.roomleave_result = leave_room();
  if (g.roomleave_result < 0) return;
  savekid();
  g.next_room = g.Char.room;
  if (g.Guard.direction === directions.dir_56_none) return;
  if (g.Guard.alive < 0 && g.Guard.sword === sword_status.sword_2_drawn) {
    const kid_room_m1 = g.Kid.room - 1;
    if (kid_room_m1 >= 0 && kid_room_m1 <= 23
      && (g.level.guards_tile[kid_room_m1] >= 30
        || g.level.guards_seq_hi[kid_room_m1] !== 0)) {
      if (g.roomleave_result === 0) {
        if (g.Guard.x >= 91) leave = 1;
      } else if (g.roomleave_result === 1) {
        if (g.Guard.x < 165) leave = 1;
      } else if (g.roomleave_result === 2) {
        if (g.Guard.curr_row >= 0) leave = 1;
      } else if (g.Guard.curr_row < 3) {
        leave = 1;
      }
    } else {
      leave = 1;
    }
  } else {
    leave = 1;
  }
  if (leave) leave_guard();
  else follow_guard();
}

// seg002:0486
export function goto_other_room(direction: number): number {
  /**
   * `((byte*)&level.roomlinks[Char.room - 1])[direction]`, including
   * when `Char.room` is nought.
   *
   * It can be. `goto_other_room` is what puts him in room 0 when he
   * falls out of the bottom of a level, and `fell_out` only kills him
   * for it while `Char.alive < 0`; once he is already dying the room
   * stays nought and the next `exit_room` comes back here. Fuzzing
   * level 5 reaches it in about one run in ten.
   *
   * In the C that reads `level.roomlinks[-1]`, which is the four
   * bytes in front of `roomlinks` in the level struct -- the end of
   * `doorlinks2`. It is garbage, but it is the original's own
   * garbage, and it is the same garbage every time for a given level.
   * Here the array simply has no index -1, so `link.left` threw a
   * `TypeError` and took the whole page down with it.
   */
  const link = roomLinksOf(g.Char.room);
  const other_room = [link.left, link.right, link.up, link.down][direction];
  g.Char.room = other_room;
  let opposite_dir: number;
  if (direction === 0) {
    g.Char.x = byteOf(g.Char.x + 140);
    opposite_dir = 1;
  } else if (direction === 1) {
    g.Char.x = byteOf(g.Char.x - 140);
    opposite_dir = 0;
  } else if (direction === 2) {
    g.Char.y = byteOf(g.Char.y + 189);
    g.Char.curr_row = y_to_row_mod4(g.Char.y);
    opposite_dir = 3;
  } else {
    g.Char.y = byteOf(g.Char.y - 189);
    g.Char.curr_row = y_to_row_mod4(g.Char.y);
    opposite_dir = 2;
  }
  return opposite_dir;
}

// seg002:0504
export function leave_room(): number {
  let leave_dir: number;
  const chary = g.Char.y;
  const action = g.Char.action;
  const frame = g.Char.frame;
  if (action !== actions.actions_5_bumped
    && action !== actions.actions_4_in_freefall
    && action !== actions.actions_3_in_midair
    && sbyteOf(chary) < 10 && sbyteOf(chary) > -16) {
    leave_dir = 2; // up
  } else if (chary >= 211) {
    leave_dir = 3; // down
  } else if ((frame >= frameids.frame_135_climbing_1 && frame < 150)
    || (frame >= frameids.frame_110_stand_up_from_crouch_1 && frame < 120)
    || (frame >= frameids.frame_150_parry && frame < 163)
    || (frame >= frameids.frame_166_stand_inactive && frame < 169)
    || action === actions.actions_7_turn) {
    return -1;
  } else if (g.Char.direction !== directions.dir_0_right) {
    // looking left
    if (g.char_x_left <= 54) leave_dir = 0;
    else if (g.char_x_left >= 198) leave_dir = 1;
    else return -1;
  } else {
    // looking right
    get_tile(g.Char.room, 9, g.Char.curr_row);
    if (g.curr_tile2 !== tiles.tiles_7_doortop_with_floor
      && g.curr_tile2 !== tiles.tiles_12_doortop
      && g.char_x_right >= 201) {
      leave_dir = 1;
    } else if (g.char_x_right <= 57) {
      leave_dir = 0;
    } else {
      return -1;
    }
  }
  if (leave_dir === 0) {
    play_mirr_mus();
    level3_set_chkp();
    Jaffar_exit();
  } else if (leave_dir === 1) {
    sword_disappears();
    meet_Jaffar();
  } else if (leave_dir === 3) {
    // Special event: the way out of level 6 is downwards.
    if (g.current_level === 6 && g.Char.room === 1) return -2;
  }
  goto_other_room(leave_dir);
  return leave_dir;
}

// seg002:0643
export function Jaffar_exit(): void {
  if (g.leveldoor_open === 2) {
    get_tile(24, 0, 0);
    trigger_button(0, 0, -1);
  }
}

// seg002:0665
export function level3_set_chkp(): void {
  if (g.current_level === 3 && g.Char.room === 7) {
    g.checkpoint = 1;
    g.hitp_beg_lev = g.hitp_max;
  }
}

// seg002:0680
export function sword_disappears(): void {
  if (g.current_level === 12 && g.Char.room === 18) {
    get_tile(15, 1, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.curr_room_modif[g.curr_tilepos] = 0;
  }
}

// seg002:06AE
export function meet_Jaffar(): void {
  if (g.current_level === 13 && g.leveldoor_open === 0 && g.Char.room === 3) {
    out.play_sound(soundids.sound_29_meet_Jaffar);
    g.guard_notice_timer = 28;
  }
}

// seg002:06D3
export function play_mirr_mus(): void {
  if (g.leveldoor_open !== 0 && g.leveldoor_open !== 0x4d
    && g.current_level === 4 && g.Char.curr_row === 0 && g.Char.room === 11) {
    out.play_sound(soundids.sound_25_presentation);
    g.leveldoor_open = 0x4d;
  }
}

// seg002:0706
export function move_0_nothing(): void {
  g.control_shift = CONTROL_RELEASED;
  g.control_y = CONTROL_RELEASED;
  g.control_x = CONTROL_RELEASED;
  g.control_shift2 = CONTROL_RELEASED;
  g.control_down = CONTROL_RELEASED;
  g.control_up = CONTROL_RELEASED;
  g.control_backward = CONTROL_RELEASED;
  g.control_forward = CONTROL_RELEASED;
}

// seg002:0721
export function move_1_forward(): void {
  g.control_x = CONTROL_HELD_FORWARD;
  g.control_forward = CONTROL_HELD;
}

// seg002:072A
export function move_2_backward(): void {
  g.control_backward = CONTROL_HELD;
  g.control_x = CONTROL_HELD_BACKWARD;
}

// seg002:0735
export function move_3_up(): void {
  g.control_y = CONTROL_HELD_UP;
  g.control_up = CONTROL_HELD;
}

// seg002:073E
export function move_4_down(): void {
  g.control_down = CONTROL_HELD;
  g.control_y = CONTROL_HELD_DOWN;
}

// seg002:0749
export function move_up_back(): void { g.control_up = CONTROL_HELD; move_2_backward(); }
// seg002:0753
export function move_down_back(): void { g.control_down = CONTROL_HELD; move_2_backward(); }
// seg002:075D
export function move_down_forw(): void { g.control_down = CONTROL_HELD; move_1_forward(); }

// seg002:0767
export function move_6_shift(): void {
  g.control_shift = CONTROL_HELD;
  g.control_shift2 = CONTROL_HELD;
}

// seg002:0770
export function move_7(): void { g.control_shift = CONTROL_RELEASED; }

// seg002:0776
export function autocontrol_opponent(): void {
  move_0_nothing();
  const charid = g.Char.charid;
  if (charid === charids.charid_0_kid) {
    autocontrol_kid();
    return;
  }
  if (g.justblocked) --g.justblocked;
  if (g.kid_sword_strike) --g.kid_sword_strike;
  if (g.guard_refrac) --g.guard_refrac;
  if (charid === charids.charid_24_mouse) autocontrol_mouse();
  else if (charid === charids.charid_4_skeleton) autocontrol_skeleton();
  else if (charid === charids.charid_1_shadow) autocontrol_shadow();
  else if (g.current_level === 13) autocontrol_Jaffar();
  else autocontrol_guard();
}

// seg002:07EB
export function autocontrol_mouse(): void {
  if (g.Char.direction === directions.dir_56_none) return;
  if (g.Char.action === actions.actions_0_stand) {
    if (g.Char.x >= 200) clear_char();
  } else if (g.Char.x < 166) {
    seqtbl_offset_char(seqids.seq_107_mouse_stand_up_and_go);
    play_seq();
  }
}

// seg002:081D
export function autocontrol_shadow(): void {
  if (g.current_level === 4) autocontrol_shadow_level4();
  if (g.current_level === 5) autocontrol_shadow_level5();
  if (g.current_level === 6) autocontrol_shadow_level6();
  if (g.current_level === 12) autocontrol_shadow_level12();
}

// seg002:1000
export function autocontrol_shadow_level4(): void {
  if (g.Char.room === 4) {
    if (g.Char.x < 80) clear_char();
    else move_1_forward();
  }
}

// seg002:101A
export function autocontrol_shadow_level5(): void {
  if (g.Char.room !== 24) return;
  if (g.demo_time === 0) {
    get_tile(24, 1, 0);
    // Is the door open?
    if (g.curr_room_modif[g.curr_tilepos] < 80) return;
    g.demo_index = 0;
  }
  do_auto_moves(SHAD_DRINK_MOVE);
  if (g.Char.x < 15) clear_char();
}

// seg002:1064
export function autocontrol_shadow_level6(): void {
  if (g.Char.room === 1
    && g.Kid.frame === frameids.frame_43_running_jump_4
    && g.Kid.x < 128) {
    move_6_shift();
    move_1_forward();
  }
}

// seg002:1082
export function autocontrol_shadow_level12(): void {
  if (g.Char.room === 15 && g.shadow_initialized === 0) {
    if (g.Opp.x >= 150) {
      do_init_shad(INIT_SHAD_12, seqids.seq_7_fall);
      return;
    }
    g.shadow_initialized = 1;
  }
  if (g.Char.sword >= sword_status.sword_2_drawn) {
    // If the Prince puts his sword away the shadow does the same, but
    // only once the shadow has been hurt.
    if (g.offguard === 0 || g.guard_refrac === 0) autocontrol_guard_active();
    else move_4_down();
    return;
  }
  if (g.Opp.sword >= sword_status.sword_2_drawn || g.offguard === 0) {
    let xdiff = 0x7000;
    if (g.can_guard_see_kid < 2 || (xdiff = char_opp_dist()) >= 90) {
      if (xdiff < 0) move_2_backward();
      return;
    }
    // The shadow draws his sword.
    if (g.Char.frame === 15) move_down_forw();
    return;
  }
  if (char_opp_dist() < 10) {
    // United with the shadow.
    g.flash_color = 15; // bright white
    g.flash_time = 18;
    hp.add_life();
    g.united_with_shadow = 42;
    g.Char.charid = charids.charid_0_kid;
    savekid();
    clear_char();
    return;
  }
  if (g.can_guard_see_kid === 2) {
    // If the Prince runs at the shadow, the shadow runs at him.
    const opp_frame = g.Opp.frame;
    if ((opp_frame >= frameids.frame_3_start_run && opp_frame < frameids.frame_15_stand)
      || (opp_frame >= frameids.frame_127_stepping_7 && opp_frame < 133)) {
      move_1_forward();
    }
  }
}

// seg002:0850
export function autocontrol_skeleton(): void {
  g.Char.sword = sword_status.sword_2_drawn;
  autocontrol_guard();
}

// seg002:085A
export function autocontrol_Jaffar(): void { autocontrol_guard(); }
// seg002:085F
export function autocontrol_kid(): void { autocontrol_guard(); }

// seg002:0864
export function autocontrol_guard(): void {
  if (g.Char.sword < sword_status.sword_2_drawn) autocontrol_guard_inactive();
  else autocontrol_guard_active();
}

// seg002:0876
export function autocontrol_guard_inactive(): void {
  if (g.Kid.alive >= 0) return;
  const distance = char_opp_dist();
  if (g.Opp.curr_row !== g.Char.curr_row || wordOf(distance) < wordOf(-8)) {
    if (g.is_guard_notice) {
      g.is_guard_notice = 0;
      if (distance < 0) {
        // The Prince made a noise behind him, so he turns round.
        if (wordOf(distance) < wordOf(-4)) move_4_down();
        return;
      }
    } else if (distance < 0) {
      return;
    }
  }
  if (g.can_guard_see_kid) {
    if (g.current_level !== 13 || g.guard_notice_timer === 0) move_down_forw();
  }
}

// seg002:08DC
export function autocontrol_guard_active(): void {
  const char_frame = g.Char.frame;
  if (char_frame === frameids.frame_166_stand_inactive || char_frame < 150
    || g.can_guard_see_kid === 1) {
    return;
  }
  if (g.can_guard_see_kid === 0) {
    if (droppedout !== 0) {
      guard_follows_kid_down();
    } else if (g.Char.charid !== charids.charid_4_skeleton) {
      move_down_back();
    }
    return;
  }
  // can_guard_see_kid == 2
  const opp_frame = g.Opp.frame;
  const distance = char_opp_dist();
  if (distance >= 12
    && opp_frame >= frameids.frame_102_start_fall_1
    && opp_frame < frameids.frame_118_stand_up_from_crouch_9
    && g.Opp.action === actions.actions_5_bumped) {
    return;
  }
  if (distance < 35) {
    if ((g.Char.sword < sword_status.sword_2_drawn && distance < 8) || distance < 12) {
      if (g.Char.direction === g.Opp.direction) move_2_backward();
      else move_1_forward();
    } else {
      autocontrol_guard_kid_in_sight(distance);
    }
    return;
  }
  if (g.guard_refrac !== 0) return;
  if (g.Char.direction !== g.Opp.direction) {
    if (opp_frame >= frameids.frame_7_run && opp_frame < 15) {
      if (distance < 40) move_6_shift();
      return;
    }
    if (opp_frame >= frameids.frame_34_start_run_jump_1 && opp_frame < 44) {
      if (distance < 50) move_6_shift();
      return;
    }
  }
  autocontrol_guard_kid_far();
}

// seg002:09CB
export function autocontrol_guard_kid_far(): void {
  if (tile_is_floor(get_tile_infrontof_char())
    || tile_is_floor(get_tile_infrontof2_char())) {
    move_1_forward();
  } else {
    move_2_backward();
  }
}

// seg002:09F8
export function guard_follows_kid_down(): void {
  // Called from `autocontrol_guard_active`, so `Char` is the guard.
  const opp_action = g.Opp.action;
  if (opp_action === actions.actions_2_hang_climb
    || opp_action === actions.actions_6_hang_straight) {
    return;
  }
  if (wall_type(get_tile_infrontof_char()) !== 0
    || (!tile_is_floor(g.curr_tile2)
      && ((get_tile(g.curr_room, g.tile_col, ++g.tile_row) === tiles.tiles_2_spike
        || g.curr_tile2 === tiles.tiles_11_loose
        || wall_type(g.curr_tile2) !== 0
        || !tile_is_floor(g.curr_tile2))
        || g.Char.curr_row + 1 !== g.Opp.curr_row))) {
    setDroppedout(0);
    move_2_backward();
  } else {
    move_1_forward();
  }
}

// seg002:0A93
export function autocontrol_guard_kid_in_sight(distance: number): void {
  if (g.Opp.sword === sword_status.sword_2_drawn) {
    autocontrol_guard_kid_armed(distance);
  } else if (g.guard_refrac === 0) {
    if (distance < 29) move_6_shift();
    else move_1_forward();
  }
}

// seg002:0AC1
export function autocontrol_guard_kid_armed(distance: number): void {
  if (distance < 10 || distance >= 29) {
    guard_advance();
    return;
  }
  guard_block();
  if (g.guard_refrac === 0) {
    if (distance < 12 || distance >= 29) guard_advance();
    else guard_strike();
  }
}

// seg002:0AF5
export function guard_advance(): void {
  if (g.guard_skill === 0 || g.kid_sword_strike === 0) {
    if (advprob[g.guard_skill] > prandom(255)) move_1_forward();
  }
}

// seg002:0B1D
export function guard_block(): void {
  const opp_frame = g.Opp.frame;
  if (opp_frame === frameids.frame_152_strike_2
    || opp_frame === frameids.frame_153_strike_3
    || opp_frame === frameids.frame_162_block_to_strike) {
    if (g.justblocked !== 0) {
      if (impblockprob[g.guard_skill] > prandom(255)) move_3_up();
    } else if (blockprob[g.guard_skill] > prandom(255)) {
      move_3_up();
    }
  }
}

// seg002:0B73
export function guard_strike(): void {
  const opp_frame = g.Opp.frame;
  if (opp_frame === frameids.frame_169_begin_block
    || opp_frame === frameids.frame_151_strike_1) {
    return;
  }
  const char_frame = g.Char.frame;
  if (char_frame === frameids.frame_161_parry || char_frame === frameids.frame_150_parry) {
    if (restrikeprob[g.guard_skill] > prandom(255)) move_6_shift();
  } else if (strikeprob[g.guard_skill] > prandom(255)) {
    move_6_shift();
  }
}

// seg002:0BCD
export function hurt_by_sword(): void {
  if (g.Char.alive >= 0) return;
  /** `loc_4276`: the death that is not a hit point coming off. */
  let killed = false;
  if (g.Char.sword !== sword_status.sword_2_drawn) {
    // Being hit out of a fighting pose is death.
    take_hp(100);
    seqtbl_offset_char(seqids.seq_85_stabbed_to_death);
    killed = true;
  } else if (g.Char.charid !== charids.charid_4_skeleton && take_hp(1)) {
    // A skeleton cannot be hurt at all.
    killed = true;
  }
  if (killed) {
    let distance = 0;
    if (get_tile_behind_char() !== 0
      || (distance = distance_to_edge_weight()) < 4) {
      seqtbl_offset_char(seqids.seq_85_stabbed_to_death);
      if (g.Char.charid !== charids.charid_0_kid
        && g.Char.direction < directions.dir_0_right
        && (g.curr_tile2 === tiles.tiles_4_gate
          || get_tile_at_char() === tiles.tiles_4_gate)) {
        g.Char.x = byteOf(
          x_bump[g.tile_col - (g.curr_tile2 !== tiles.tiles_4_gate ? 1 : 0)
            + FIRST_ONSCREEN_COLUMN] + TILE_MIDX,
        );
        g.Char.x = byteOf(char_dx_forward(10));
      }
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
    } else {
      g.Char.x = byteOf(char_dx_forward(distance - 20));
      load_fram_det_col();
      inc_curr_row();
      seqtbl_offset_char(seqids.seq_81_kid_pushed_off_ledge);
    }
  } else {
    seqtbl_offset_char(seqids.seq_74_hit_by_sword);
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    g.Char.fall_y = 0;
  }
  out.play_sound(g.Char.charid === charids.charid_0_kid
    ? soundids.sound_13_kid_hurt : soundids.sound_12_guard_hurt);
  play_seq();
}

// seg002:0CD4
export function check_sword_hurt(): void {
  if (g.Guard.action === actions.actions_99_hurt) {
    if (g.Kid.action === actions.actions_99_hurt) {
      g.Kid.action = actions.actions_1_run_jump;
    }
    loadshad();
    hurt_by_sword();
    saveshad();
    g.guard_refrac = refractimer[g.guard_skill];
  } else if (g.Kid.action === actions.actions_99_hurt) {
    loadkid();
    hurt_by_sword();
    savekid();
  }
}

// seg002:0D1A
export function check_sword_hurting(): void {
  const kid_frame = g.Kid.frame;
  if (kid_frame !== 0
    && (kid_frame < frameids.frame_219_exit_stairs_3 || kid_frame >= 229)) {
    loadshad_and_opp();
    check_hurting();
    saveshad_and_opp();
    loadkid_and_opp();
    check_hurting();
    savekid_and_opp();
  }
}

// seg002:0D56
export function check_hurting(): void {
  if (g.Char.sword !== sword_status.sword_2_drawn) return;
  if (g.Char.curr_row !== g.Opp.curr_row) return;
  const char_frame = g.Char.frame;
  if (char_frame !== frameids.frame_153_strike_3
    && char_frame !== frameids.frame_154_poking) {
    return;
  }
  let distance = char_opp_dist();
  const opp_frame = g.Opp.frame;
  if (distance < 0 || distance >= 29
    || (opp_frame !== frameids.frame_161_parry
      && opp_frame !== frameids.frame_150_parry)) {
    // The other one is not parrying.
    if (g.Char.frame === frameids.frame_154_poking) {
      const min_hurt_range = g.Opp.sword < sword_status.sword_2_drawn ? 8 : 12;
      distance = char_opp_dist();
      if (distance >= min_hurt_range && distance < 29) {
        g.Opp.action = actions.actions_99_hurt;
      }
    }
  } else {
    g.Opp.frame = frameids.frame_161_parry;
    if (g.Char.charid !== charids.charid_0_kid) g.justblocked = 4;
    seqtbl_offset_char(seqids.seq_69_attack_was_parried);
    play_seq();
  }
  if (g.Char.direction === directions.dir_56_none) return;
  if (g.Char.frame === frameids.frame_154_poking
    && g.Opp.frame !== frameids.frame_161_parry
    && g.Opp.action !== actions.actions_99_hurt) {
    out.play_sound(soundids.sound_11_sword_moving);
  }
}

// seg002:0E1F
export function check_skel(): void {
  // Special event: the skeleton of level 3 wakes up.
  if (g.current_level === 3
    && g.Guard.direction === directions.dir_56_none
    && g.drawn_room === 1
    && g.leveldoor_open !== 0
    && (g.Kid.curr_col === 2 || g.Kid.curr_col === 3)) {
    get_tile(g.drawn_room, 5, 1);
    if (g.curr_tile2 !== tiles.tiles_21_skeleton) return;
    // Rub the skeleton out of the floor and stand him up.
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.redraw_height = 24;
    l8.set_redraw_full.fn(g.curr_tilepos, 1);
    l8.set_wipe.fn(g.curr_tilepos, 1);
    ++g.curr_tilepos;
    l8.set_redraw_full.fn(g.curr_tilepos, 1);
    l8.set_wipe.fn(g.curr_tilepos, 1);
    g.Char.room = g.drawn_room;
    g.Char.curr_row = 1;
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    g.Char.curr_col = 5;
    g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN] + TILE_SIZEX);
    g.Char.direction = directions.dir_FF_left;
    seqtbl_offset_char(seqids.seq_88_skel_wake_up);
    play_seq();
    out.play_sound(soundids.sound_44_skel_alive);
    g.guard_skill = 2;
    g.Char.alive = -1;
    g.guardhp_max = g.guardhp_curr = 3;
    g.Char.fall_x = g.Char.fall_y = 0;
    g.is_guard_notice = g.guard_refrac = 0;
    g.Char.sword = sword_status.sword_2_drawn;
    g.Char.charid = charids.charid_4_skeleton;
    saveshad();
  }
}

// seg006:1816
export function control_guard_inactive(): void {
  if (g.Char.frame === frameids.frame_166_stand_inactive
    && g.control_down === CONTROL_HELD) {
    if (g.control_forward === CONTROL_HELD) {
      draw_sword();
    } else {
      g.control_down = CONTROL_IGNORE;
      seqtbl_offset_char(seqids.seq_80_stand_flipped);
    }
  }
}

/** `check_the_end`'s own half of the work, without the drawing. */
export function the_end_of_the_room(): boolean {
  if (g.next_room !== 0 && g.next_room !== g.drawn_room) {
    g.drawn_room = g.next_room;
    load_room_links();
    return true;
  }
  return false;
}

