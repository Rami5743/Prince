/**
 * `seg004.c`: what a character has walked into.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. Every `#ifdef FIX_` branch takes
 * the side the unmodified game is on -- including `FIX_TWO_COLL_BUG`,
 * so the two bump columns are an `else if` here as they are in the
 * game.
 */
import { g, byteOf, sbyteOf } from './state.ts';
import { x_bump, y_land } from './data.ts';
import { tiles, directions, actions, frameids, seqids, charids, soundids, sword_status } from './types.ts';
import {
  get_tile, get_tile_at_char, get_tile_div_mod_m7, get_tile_infrontof_char,
  wall_type, tile_is_floor, determine_col, load_frame_to_obj, set_char_collision,
  char_dx_forward, distance_to_edge_weight, load_fram_det_col, play_seq,
  take_hp, release_arrows, infrontx, get_tilepos,
} from './seg006.ts';
import { l5, l7, out } from './link.ts';

const TILE_SIZEX = 14;
const TILE_MIDX = 7;
const TILE_RIGHTX = 13;
const FIRST_ONSCREEN_COLUMN = 2;
const SCREEN_TILECOUNTX = 10;

export const EDGE_TYPE_FLOOR = 0;
export const EDGE_TYPE_CLOSER = 1;
export const EDGE_TYPE_WALL = 2;

/** Indexed by `wall_type`. */
const wall_dist_from_left = [0, 10, 0, -1, 0, 0];
const wall_dist_from_right = [0, 0, 10, 13, 0, 0];

let collision_row = 0;
let right_checked_col = 0;
let left_checked_col = 0;
export let edge_type = 0;

// seg004:0004
export function check_collisions(): void {
  g.bump_col_left_of_wall = -1;
  g.bump_col_right_of_wall = -1;
  if (g.Char.action === actions.actions_7_turn) return;
  collision_row = g.Char.curr_row;
  move_coll_to_prev();
  g.prev_collision_row = collision_row;
  right_checked_col = Math.min(get_tile_div_mod_m7(g.char_x_right_coll) + 2, 11);
  left_checked_col = get_tile_div_mod_m7(g.char_x_left_coll) - 1;
  get_row_collision_data(collision_row, g.curr_row_coll_room, g.curr_row_coll_flags);
  get_row_collision_data(collision_row + 1, g.below_row_coll_room, g.below_row_coll_flags);
  get_row_collision_data(collision_row - 1, g.above_row_coll_room, g.above_row_coll_flags);
  for (let column = 9; column >= 0; --column) {
    if (g.curr_row_coll_room[column] >= 0
      && g.prev_coll_room[column] === g.curr_row_coll_room[column]) {
      if ((g.prev_coll_flags[column] & 0x0f) === 0
        && (g.curr_row_coll_flags[column] & 0x0f) !== 0) {
        g.bump_col_left_of_wall = column;
      }
      if ((g.prev_coll_flags[column] & 0xf0) === 0
        && (g.curr_row_coll_flags[column] & 0xf0) !== 0) {
        g.bump_col_right_of_wall = column;
      }
    }
  }
}

// seg004:00DF
export function move_coll_to_prev(): void {
  let room_ptr: Int8Array;
  let flags_ptr: Uint8Array;
  if (collision_row === g.prev_collision_row
    || collision_row + 3 === g.prev_collision_row
    || collision_row - 3 === g.prev_collision_row) {
    room_ptr = g.curr_row_coll_room;
    flags_ptr = g.curr_row_coll_flags;
  } else if (collision_row + 1 === g.prev_collision_row
    || collision_row - 2 === g.prev_collision_row) {
    room_ptr = g.above_row_coll_room;
    flags_ptr = g.above_row_coll_flags;
  } else {
    room_ptr = g.below_row_coll_room;
    flags_ptr = g.below_row_coll_flags;
  }
  // The copy is taken first: the C copies out of the array it is about
  // to blank, one column at a time, and blanking as it goes would be a
  // different thing if the source and the destination were the same
  // array -- which they are, for the `curr_row` case.
  const room = Array.from(room_ptr);
  const flags = Array.from(flags_ptr);
  for (let column = 0; column < 10; ++column) {
    g.prev_coll_room[column] = room[column];
    g.prev_coll_flags[column] = flags[column];
    g.below_row_coll_room[column] = -1;
    g.above_row_coll_room[column] = -1;
    g.curr_row_coll_room[column] = -1;
  }
}

// seg004:0185
export function get_row_collision_data(
  row: number, room_ptr: Int8Array, flags_ptr: Uint8Array,
): void {
  const room = g.Char.room;
  g.coll_tile_left_xpos = x_bump[left_checked_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX;
  for (let column = left_checked_col; column <= right_checked_col; ++column) {
    const left_wall_xpos = get_left_wall_xpos(room, column, row);
    const right_wall_xpos = get_right_wall_xpos(room, column, row);
    let curr_flags = (left_wall_xpos < g.char_x_right_coll ? 1 : 0) * 0x0f;
    curr_flags |= (right_wall_xpos > g.char_x_left_coll ? 1 : 0) * 0xf0;
    flags_ptr[g.tile_col] = curr_flags;
    room_ptr[g.tile_col] = g.curr_room;
    g.coll_tile_left_xpos += TILE_SIZEX;
  }
}

// seg004:0226
export function get_left_wall_xpos(room: number, column: number, row: number): number {
  const type = wall_type(get_tile(room, column, row));
  if (type) return wall_dist_from_left[type] + g.coll_tile_left_xpos;
  return 0xff;
}

// seg004:025F
export function get_right_wall_xpos(room: number, column: number, row: number): number {
  const type = wall_type(get_tile(room, column, row));
  if (type) return g.coll_tile_left_xpos - wall_dist_from_right[type] + TILE_RIGHTX;
  return 0;
}

// seg004:029D
export function check_bumped(): void {
  if (g.Char.action !== actions.actions_2_hang_climb
    && g.Char.action !== actions.actions_6_hang_straight
    && (g.Char.frame < frameids.frame_135_climbing_1 || g.Char.frame >= 149)) {
    if (g.bump_col_left_of_wall >= 0) {
      check_bumped_look_right();
    } else if (g.bump_col_right_of_wall >= 0) {
      check_bumped_look_left();
    }
  }
}

// seg004:02D2
export function check_bumped_look_left(): void {
  if ((g.Char.sword === sword_status.sword_2_drawn
    || g.Char.direction < directions.dir_0_right)
    && is_obstacle_at_col(g.bump_col_right_of_wall)) {
    bumped(
      sbyteOf(get_right_wall_xpos(g.curr_room, g.tile_col, g.tile_row) - g.char_x_left_coll),
      directions.dir_0_right,
    );
  }
}

// seg004:030A
export function check_bumped_look_right(): void {
  if ((g.Char.sword === sword_status.sword_2_drawn
    || g.Char.direction === directions.dir_0_right)
    && is_obstacle_at_col(g.bump_col_left_of_wall)) {
    bumped(
      sbyteOf(get_left_wall_xpos(g.curr_room, g.tile_col, g.tile_row) - g.char_x_right_coll),
      directions.dir_FF_left,
    );
  }
}

// seg004:0343
export function is_obstacle_at_col(tile_col: number): number {
  let tile_row = g.Char.curr_row;
  if (tile_row < 0) tile_row += 3;
  if (tile_row >= 3) tile_row -= 3;
  get_tile(g.curr_row_coll_room[tile_col], tile_col, tile_row);
  return is_obstacle();
}

// seg004:037E
export function is_obstacle(): number {
  if (g.curr_tile2 === tiles.tiles_10_potion) {
    return 0;
  } else if (g.curr_tile2 === tiles.tiles_4_gate) {
    if (!can_bump_into_gate()) return 0;
  } else if (g.curr_tile2 === tiles.tiles_18_chomper) {
    if (g.curr_room_modif[g.curr_tilepos] !== 2) return 0;
  } else if (g.curr_tile2 === tiles.tiles_13_mirror
    && g.Char.charid === charids.charid_0_kid
    && g.Char.frame >= frameids.frame_39_start_run_jump_6
    && g.Char.frame < frameids.frame_44_running_jump_5
    && g.Char.direction < directions.dir_0_right) {
    g.curr_room_modif[g.curr_tilepos] = 0x56; // broken mirror
    g.jumped_through_mirror = -1;
    return 0;
  }
  g.coll_tile_left_xpos = xpos_in_drawn_room(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN]) + TILE_MIDX;
  return 1;
}

// seg004:0405
export function xpos_in_drawn_room(xpos: number): number {
  if (g.curr_room !== g.drawn_room) {
    if (g.curr_room === g.room_L || g.curr_room === g.room_BL) {
      xpos -= TILE_SIZEX * SCREEN_TILECOUNTX;
    } else if (g.curr_room === g.room_R || g.curr_room === g.room_BR) {
      xpos += TILE_SIZEX * SCREEN_TILECOUNTX;
    }
  }
  return xpos;
}

// seg004:0448
export function bumped(delta_x: number, push_direction: number): void {
  if (g.Char.alive < 0 && g.Char.frame !== frameids.frame_177_spiked) {
    g.Char.x = byteOf(g.Char.x + delta_x);
    if (push_direction < directions.dir_0_right) {
      if (g.curr_tile2 === tiles.tiles_20_wall) {
        get_tile(g.curr_room, --g.tile_col, g.tile_row);
      }
    } else if (g.curr_tile2 === tiles.tiles_12_doortop
      || g.curr_tile2 === tiles.tiles_7_doortop_with_floor
      || g.curr_tile2 === tiles.tiles_20_wall) {
      ++g.tile_col;
      if (g.curr_room === 0 && g.tile_col === 10) {
        g.curr_room = g.Char.room;
        g.tile_col = 0;
      }
      get_tile(g.curr_room, g.tile_col, g.tile_row);
    }
    if (tile_is_floor(g.curr_tile2)) bumped_floor(push_direction);
    else bumped_fall();
  }
}

// seg004:04E4
export function bumped_fall(): void {
  const action = g.Char.action;
  g.Char.x = byteOf(char_dx_forward(-4));
  if (action === actions.actions_4_in_freefall) {
    g.Char.fall_x = 0;
  } else {
    l5.seqtbl_offset_char.fn(seqids.seq_45_bumpfall);
    play_seq();
  }
  bumped_sound();
}

// seg004:0520
export function bumped_floor(push_direction: number): void {
  let seq_index: number;
  if (g.Char.sword !== sword_status.sword_2_drawn
    && ((y_land[g.Char.curr_row + 1] - g.Char.y) & 0xffff) >= 15) {
    bumped_fall();
    return;
  }
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  if (g.Char.fall_y >= 22) {
    g.Char.x = byteOf(char_dx_forward(-5));
    return;
  }
  g.Char.fall_y = 0;
  // `if (Char.alive < 0)`, which is the original's "alive": a body
  // counting up through the death frames has `alive >= 0` and is not
  // staggered.
  if (g.Char.alive >= 0) return;
  if (g.Char.sword === sword_status.sword_2_drawn) {
    if (push_direction === g.Char.direction) {
      l5.seqtbl_offset_char.fn(seqids.seq_65_bump_forward_with_sword);
      play_seq();
      g.Char.x = byteOf(char_dx_forward(1));
      return;
    }
    seq_index = seqids.seq_64_pushed_back_with_sword;
  } else {
    const frame = g.Char.frame;
    if (frame === 24 || frame === 25
      || (frame >= 40 && frame < 43)
      || (frame >= frameids.frame_102_start_fall_1 && frame < 107)) {
      seq_index = seqids.seq_46_hardbump;
    } else {
      seq_index = seqids.seq_47_bump;
    }
  }
  l5.seqtbl_offset_char.fn(seq_index);
  play_seq();
  bumped_sound();
}

// seg004:05F1
export function bumped_sound(): void {
  g.is_guard_notice = 1;
  out.play_sound(soundids.sound_8_bumped);
}

// seg004:0601
export function clear_coll_rooms(): void {
  g.prev_coll_room.fill(-1);
  g.curr_row_coll_room.fill(-1);
  g.below_row_coll_room.fill(-1);
  g.above_row_coll_room.fill(-1);
  g.prev_collision_row = -1;
}

// seg004:0657
export function can_bump_into_gate(): boolean {
  return (g.curr_room_modif[g.curr_tilepos] >> 2) + 6 < g.char_height;
}

// seg004:067C
export function get_edge_distance(): number {
  let distance = 0;
  determine_col();
  load_frame_to_obj();
  set_char_collision();
  let tiletype = get_tile_at_char();
  let settled = false;
  if (wall_type(tiletype) !== 0) {
    g.tile_col = g.Char.curr_col;
    distance = dist_from_wall_forward(tiletype);
    if (distance >= 0) {
      distance = fromWall(distance);
      settled = true;
    }
  }
  if (!settled) {
    tiletype = get_tile_infrontof_char();
    if (tiletype === tiles.tiles_12_doortop && g.Char.direction >= directions.dir_0_right) {
      edge_type = EDGE_TYPE_CLOSER;
      distance = distance_to_edge_weight();
    } else {
      let closer = false;
      if (wall_type(tiletype) !== 0) {
        g.tile_col = infrontx;
        distance = dist_from_wall_forward(tiletype);
        if (distance >= 0) {
          distance = fromWall(distance);
          settled = true;
        }
      }
      if (!settled) {
        if (tiletype === tiles.tiles_11_loose) {
          closer = true;
        } else if (tiletype === tiles.tiles_6_closer
          || tiletype === tiles.tiles_22_sword
          || tiletype === tiles.tiles_10_potion) {
          distance = distance_to_edge_weight();
          if (distance !== 0) {
            edge_type = EDGE_TYPE_CLOSER;
          } else {
            edge_type = EDGE_TYPE_FLOOR;
            distance = 11;
          }
        } else if (tile_is_floor(tiletype)) {
          edge_type = EDGE_TYPE_FLOOR;
          distance = 11;
        } else {
          closer = true;
        }
        if (closer) {
          edge_type = EDGE_TYPE_CLOSER;
          distance = distance_to_edge_weight();
        }
      }
    }
  }
  g.curr_tile2 = tiletype;
  return distance;
}

/** `loc_59DD`: a distance that came off a wall. */
function fromWall(distance: number): number {
  if (distance <= TILE_RIGHTX) {
    edge_type = EDGE_TYPE_WALL;
    return distance;
  }
  edge_type = EDGE_TYPE_FLOOR;
  return 11;
}

// seg004:076B
export function check_chomped_kid(): void {
  const tile_row = g.Char.curr_row;
  for (let tile_col = 0; tile_col < 10; ++tile_col) {
    if (g.curr_row_coll_flags[tile_col] === 0xff
      && get_tile(g.curr_row_coll_room[tile_col], tile_col, tile_row) === tiles.tiles_18_chomper
      && (g.curr_room_modif[g.curr_tilepos] & 0x7f) === 2) {
      chomped();
    }
  }
}

// seg004:07BF
export function chomped(): void {
  g.curr_room_modif[g.curr_tilepos] |= 0x80; // put blood
  if (g.Char.frame !== frameids.frame_178_chomped && g.Char.room === g.curr_room) {
    g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX);
    g.Char.x = byteOf(char_dx_forward(7 - (g.Char.direction ? 0 : 1)));
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    take_hp(100);
    out.play_sound(soundids.sound_46_chomped);
    l5.seqtbl_offset_char.fn(seqids.seq_54_chomped);
    play_seq();
  }
}

// seg004:0833
export function check_gate_push(): void {
  const frame = g.Char.frame;
  if (g.Char.action === actions.actions_7_turn
    || frame === frameids.frame_15_stand
    || (frame >= frameids.frame_108_fall_land_2 && frame < 111)) {
    get_tile_at_char();
    const orig_col = g.tile_col;
    if ((g.curr_tile2 === tiles.tiles_4_gate
      || get_tile(g.curr_room, --g.tile_col, g.tile_row) === tiles.tiles_4_gate)
      && (g.curr_row_coll_flags[g.tile_col] & g.prev_coll_flags[g.tile_col]) === 0xff
      && can_bump_into_gate()) {
      bumped_sound();
      // push left when the gate is his own tile, right when it is the
      // tile beside him.
      g.Char.x = byteOf(g.Char.x + 5 - (orig_col <= g.tile_col ? 1 : 0) * 10);
    }
  }
}

// seg004:08C3
export function check_guard_bumped(): void {
  if (g.Char.action === actions.actions_1_run_jump
    && g.Char.alive < 0
    && g.Char.sword >= sword_status.sword_2_drawn) {
    if (get_tile_at_char() === tiles.tiles_20_wall
      || g.curr_tile2 === tiles.tiles_7_doortop_with_floor
      || (g.curr_tile2 === tiles.tiles_4_gate && can_bump_into_gate())
      || (g.Char.direction >= directions.dir_0_right
        && (get_tile(g.curr_room, --g.tile_col, g.tile_row) === tiles.tiles_7_doortop_with_floor
          || (g.curr_tile2 === tiles.tiles_4_gate && can_bump_into_gate())))) {
      load_frame_to_obj();
      set_char_collision();
      if (is_obstacle()) {
        const delta_x = dist_from_wall_behind(g.curr_tile2);
        if (delta_x < 0 && delta_x > -13) {
          g.Char.x = byteOf(char_dx_forward(-delta_x));
          l5.seqtbl_offset_char.fn(seqids.seq_65_bump_forward_with_sword);
          play_seq();
          load_fram_det_col();
        }
      }
    }
  }
}

// seg004:0989
export function check_chomped_guard(): void {
  get_tile_at_char();
  if (!check_chomped_here()) {
    get_tile(g.curr_room, ++g.tile_col, g.tile_row);
    check_chomped_here();
  }
}

// seg004:09B0
export function check_chomped_here(): number {
  if (g.curr_tile2 === tiles.tiles_18_chomper
    && (g.curr_room_modif[g.curr_tilepos] & 0x7f) === 2) {
    g.coll_tile_left_xpos = x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX;
    if (get_left_wall_xpos(g.curr_room, g.tile_col, g.tile_row) < g.char_x_right_coll
      && get_right_wall_xpos(g.curr_room, g.tile_col, g.tile_row) > g.char_x_left_coll) {
      chomped();
      return 1;
    }
    return 0;
  }
  return 0;
}

// seg004:0A10
export function dist_from_wall_forward(tiletype: number): number {
  if (tiletype === tiles.tiles_4_gate && !can_bump_into_gate()) return -1;
  g.coll_tile_left_xpos = x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN] + TILE_MIDX;
  const type = wall_type(tiletype);
  if (type === 0) return -1;
  if (g.Char.direction < directions.dir_0_right) {
    return g.char_x_left_coll - (g.coll_tile_left_xpos + TILE_RIGHTX - wall_dist_from_right[type]);
  }
  return wall_dist_from_left[type] + g.coll_tile_left_xpos - g.char_x_right_coll;
}

// seg004:0A7B
export function dist_from_wall_behind(tiletype: number): number {
  const type = wall_type(tiletype);
  if (type === 0) return 99;
  if (g.Char.direction >= directions.dir_0_right) {
    return g.char_x_left_coll - (g.coll_tile_left_xpos + TILE_RIGHTX - wall_dist_from_right[type]);
  }
  return wall_dist_from_left[type] + g.coll_tile_left_xpos - g.char_x_right_coll;
}

/** `bump_into_opponent` is in seg002; the port keeps its own there. */
export const COLLISION_UNUSED = { release_arrows, get_tilepos, l7 };
