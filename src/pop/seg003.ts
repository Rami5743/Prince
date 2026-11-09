/**
 * `seg003.c`: the counters, where a level starts, and what a guard can
 * see.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. The parts of that file that are
 * about the screen itself -- `draw_level_first`, `play_level_2`, the
 * timer loop -- are the shell's business and are not here; what is
 * here is what a tick of the game needs.
 */
import { g, byteOf, copyChar } from './state.ts';
import { x_bump, y_land } from './data.ts';
import {
  tiles, charids, directions, frameids, seqids, sword_status, actions, soundids,
} from './types.ts';
import {
  get_tile, get_tile_div_mod_m7, distance_to_edge_weight, play_seq, take_hp,
  savekid, loadkid, get_tilepos, tile_is_floor,
} from './seg006.ts';
import { seqtbl_offset_char } from './seg005.ts';
import { trigger_button, start_level_door, do_knock } from './seg007.ts';
import { l8, out } from './link.ts';

const TILE_SIZEX = 14;
const TILE_MIDX = 7;
const FIRST_ONSCREEN_COLUMN = 5;
const SCREEN_TILECOUNTX = 10;
const ROOMCOUNT = 24;

export let distance_mirror = 0;
/** `different_room`: the room on the screen has just changed. */
export const screen = { different_room: 0 };

/** `char_opp_dist`, which is in seg002; filled in there. */
export const dist = { char_opp_dist: (): number => 0 };
/** `goto_other_room`, which is in seg002. */
export const rooms = { goto_other_room: (_direction: number): void => {} };

// seg003:0239
export function do_startpos(): void {
  // Special event: level 3 starts at a checkpoint once he has died there.
  if (g.current_level === 3 && g.checkpoint) {
    g.level.start_dir = directions.dir_FF_left;
    g.level.start_room = 2;
    g.level.start_pos = 6;
    // Special event: the loose floor is gone.
    get_tile(7, 4, 0);
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_0_empty;
  }
  g.Char.room = g.level.start_room;
  g.next_room = g.Char.room;
  let x = g.level.start_pos;
  g.Char.curr_col = x % SCREEN_TILECOUNTX;
  g.Char.curr_row = Math.trunc(x / SCREEN_TILECOUNTX);
  g.Char.x = byteOf(x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN] + TILE_SIZEX);
  // He starts facing the wrong way and turns into the right one.
  g.Char.direction = ~g.level.start_dir;
  x = g.hitp_beg_lev;
  g.hitp_max = x;
  g.hitp_curr = x;
  if (g.current_level === 1) {
    // Special event: the button is pressed and he falls in.
    get_tile(5, 2, 0);
    trigger_button(0, 0, -1);
    seqtbl_offset_char(seqids.seq_7_fall);
  } else if (g.current_level === 13) {
    // Special event: he runs in.
    seqtbl_offset_char(seqids.seq_84_run);
  } else {
    seqtbl_offset_char(seqids.seq_5_turn);
  }
  set_start_pos();
}

// seg003:028A
export function set_start_pos(): void {
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.alive = -1;
  g.Char.charid = charids.charid_0_kid;
  g.is_screaming = 0;
  g.knock = 0;
  g.upside_down = 0;
  g.is_feather_fall = 0;
  g.Char.fall_y = 0;
  g.Char.fall_x = 0;
  g.offguard = 0;
  g.Char.sword = sword_status.sword_0_sheathed;
  play_seq();
  if (g.current_level === 7 && g.Char.room === 17) {
    // Special event: level 7 drops him in, so the room below is shown.
    rooms.goto_other_room(3);
  }
  savekid();
}

// seg003:02E6
export function find_start_level_door(): void {
  l8.get_room_address.fn(g.Kid.room);
  for (let tilepos = 0; tilepos < 30; ++tilepos) {
    if ((g.curr_room_tiles[tilepos] & 0x1f) === tiles.tiles_16_level_door_left) {
      start_level_door(g.Kid.room, tilepos);
    }
  }
}

// seg003:0576
export function redraw_at_char(): void {
  if (g.Char.sword >= sword_status.sword_2_drawn) {
    // A drawn sword makes the box bigger.
    if (g.Char.direction >= directions.dir_0_right) {
      ++g.char_col_right;
      if (g.char_col_right > 9) g.char_col_right = 9;
    } else {
      --g.char_col_left;
      if (g.char_col_left < 0) g.char_col_left = 0;
    }
  }
  let x_top_row: number;
  let x_col_right: number;
  let x_col_left: number;
  if (g.Char.charid === charids.charid_0_kid) {
    x_top_row = Math.min(g.char_top_row, g.prev_char_top_row);
    x_col_right = Math.max(g.char_col_right, g.prev_char_col_right);
    x_col_left = Math.min(g.char_col_left, g.prev_char_col_left);
  } else {
    x_top_row = g.char_top_row;
    x_col_right = g.char_col_right;
    x_col_left = g.char_col_left;
  }
  for (let tile_row = x_top_row; tile_row <= g.char_bottom_row; ++tile_row) {
    for (let tile_col = x_col_left; tile_col <= x_col_right; ++tile_col) {
      l8.set_redraw_fore.fn(get_tilepos(tile_col, tile_row), 1);
    }
  }
  if (g.Char.charid === charids.charid_0_kid) {
    g.prev_char_top_row = g.char_top_row;
    g.prev_char_col_right = g.char_col_right;
    g.prev_char_col_left = g.char_col_left;
  }
}

// seg003:0645
export function redraw_at_char2(): void {
  const char_action = g.Char.action;
  const char_frame = g.Char.frame;
  let redraw_func: (tilepos: number, frames: number) => void = l8.set_redraw2.fn;
  if (char_frame < frameids.frame_78_jumphang || char_frame >= frameids.frame_80_jumphang) {
    if (char_frame >= frameids.frame_137_climbing_3
      && char_frame < frameids.frame_145_climbing_11) {
      redraw_func = l8.set_redraw_floor_overlay.fn;
    } else if (char_action !== actions.actions_2_hang_climb
      && char_action !== actions.actions_3_in_midair
      && char_action !== actions.actions_4_in_freefall
      && char_action !== actions.actions_6_hang_straight
      && (char_action !== actions.actions_5_bumped
        || char_frame < frameids.frame_102_start_fall_1
        || char_frame > frameids.frame_106_fall)) {
      return;
    }
  }
  for (g.tile_col = g.char_col_right; g.tile_col >= g.char_col_left; --g.tile_col) {
    if (char_action !== 2) {
      redraw_func(get_tilepos(g.tile_col, g.char_bottom_row), 1);
    }
    if (g.char_top_row !== g.char_bottom_row) {
      redraw_func(get_tilepos(g.tile_col, g.char_top_row), 1);
    }
  }
}

// seg003:0706
export function check_knock(): void {
  if (g.knock) {
    do_knock(g.Char.room, g.Char.curr_row - (g.knock > 0 ? 1 : 0));
    g.knock = 0;
  }
}

// seg003:0735
export function timers(): void {
  if (g.united_with_shadow > 0) {
    --g.united_with_shadow;
    if (g.united_with_shadow === 0) --g.united_with_shadow;
  }
  if (g.guard_notice_timer > 0) --g.guard_notice_timer;
  if (g.resurrect_time > 0) --g.resurrect_time;
  if (g.is_feather_fall) g.is_feather_fall++;
  if (g.is_feather_fall && (!out.check_sound_playing() || g.is_feather_fall > 225)) {
    g.is_feather_fall = 0;
  }
  // Special event: the mouse of level 8.
  if (g.current_level === 8 && g.Char.room === 16 && g.leveldoor_open) {
    ++g.leveldoor_open;
    if (g.leveldoor_open === 150) do_mouse();
  }
}

// seg003:0798
export function check_mirror(): void {
  if (g.jumped_through_mirror === -1) {
    jump_through_mirror();
  }
}

// seg003:07FC
export function jump_through_mirror(): void {
  g.jumped_through_mirror = 0;
  loadkid();
  check_mirror_image();
  g.Guard.charid = charids.charid_1_shadow;
  // The glass going. The translation never asked for it, so the one
  // moment on the level that ought to make a noise made none.
  out.play_sound(soundids.sound_45_jump_through_mirror);
  g.guardhp_max = g.hitp_max;
  g.guardhp_curr = g.guardhp_max;
  copyChar(g.Guard, g.Char);
  loadkid();
}

// seg003:0848
export function check_mirror_image(): void {
  const xpos = x_bump[g.Char.curr_col + FIRST_ONSCREEN_COLUMN] + 10;
  let distance = distance_to_edge_weight();
  if (g.Char.direction >= directions.dir_0_right) {
    distance = (~distance) + TILE_SIZEX;
  }
  distance_mirror = distance - 2;
  g.Char.x = byteOf((xpos << 1) - g.Char.x);
  g.Char.direction = ~g.Char.direction;
}

// seg003:08AA
export function bump_into_opponent(): void {
  // Called from `play_kid_frame`, so `Char` is the Prince and `Opp` the guard.
  if (g.can_guard_see_kid >= 2
    && g.Char.sword === sword_status.sword_0_sheathed
    && g.Opp.sword !== sword_status.sword_0_sheathed
    && g.Opp.action < 2
    && g.Char.direction !== g.Opp.direction) {
    const distance = dist.char_opp_dist();
    if (Math.abs(distance) <= 15) {
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
      seqtbl_offset_char(seqids.seq_47_bump);
      play_seq();
    }
  }
}

// seg003:0913
export function pos_guards(): void {
  for (let room1 = 0; room1 < ROOMCOUNT; ++room1) {
    const guard_tile = g.level.guards_tile[room1];
    if (guard_tile < 30) {
      g.level.guards_x[room1] = byteOf(
        x_bump[(guard_tile % 10) + FIRST_ONSCREEN_COLUMN] + TILE_SIZEX,
      );
      g.level.guards_seq_hi[room1] = 0;
    }
  }
}

// seg003:0959
export function check_can_guard_see_kid(): void {
  const kid_frame = g.Kid.frame;
  if (g.Guard.charid === charids.charid_24_mouse) {
    g.can_guard_see_kid = 0;
    return;
  }
  if ((g.Guard.charid !== charids.charid_1_shadow || g.current_level === 12)
    && kid_frame !== 0
    && (kid_frame < frameids.frame_219_exit_stairs_3 || kid_frame >= 229)
    && g.Guard.direction !== directions.dir_56_none
    && g.Kid.alive < 0 && g.Guard.alive < 0
    && g.Kid.room === g.Guard.room
    && g.Kid.curr_row === g.Guard.curr_row) {
    g.can_guard_see_kid = 2;
    let left_pos = x_bump[g.Kid.curr_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX;
    let right_pos = x_bump[g.Guard.curr_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX;
    if (left_pos > right_pos) {
      const temp = left_pos;
      left_pos = right_pos;
      right_pos = temp;
    }
    // A chomper sits on the left of its tile, so it does not count.
    if (get_tile_at_kid(left_pos) === tiles.tiles_18_chomper) left_pos += TILE_SIZEX;
    // A gate sits on the right of its tile, so it does not either.
    if (get_tile_at_kid(right_pos) === tiles.tiles_4_gate) right_pos -= TILE_SIZEX;
    while (left_pos <= right_pos) {
      // Cannot see through these at all.
      if (get_tile_at_kid(left_pos) === tiles.tiles_20_wall
        || g.curr_tile2 === tiles.tiles_7_doortop_with_floor
        || g.curr_tile2 === tiles.tiles_12_doortop) {
        g.can_guard_see_kid = 0;
        return;
      }
      // Can see through these, but will not walk through them.
      if (g.curr_tile2 === tiles.tiles_11_loose
        || g.curr_tile2 === tiles.tiles_18_chomper
        || (g.curr_tile2 === tiles.tiles_4_gate && g.curr_room_modif[g.curr_tilepos] < 112)
        || !tile_is_floor(g.curr_tile2)) {
        g.can_guard_see_kid = 1;
      }
      left_pos += TILE_SIZEX;
    }
  } else {
    g.can_guard_see_kid = 0;
  }
}

// seg003:0A99
export function get_tile_at_kid(xpos: number): number {
  return get_tile(g.Kid.room, get_tile_div_mod_m7(xpos), g.Kid.curr_row);
}

// seg003:0ABA
export function do_mouse(): void {
  loadkid();
  g.Char.charid = charids.charid_24_mouse;
  g.Char.x = 200;
  g.Char.curr_row = 0;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.alive = -1;
  g.Char.direction = directions.dir_FF_left;
  g.guardhp_curr = 1;
  seqtbl_offset_char(seqids.seq_105_mouse_forward);
  play_seq();
  copyChar(g.Guard, g.Char);
  loadkid();
}

