/**
 * `seg005.c`: what the player's keys do, and what a fall ends in.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. Every `#ifdef FIX_` and `#ifdef
 * USE_` branch takes the side the unmodified game is on.
 *
 * The two functions built out of `goto` -- `land` and
 * `get_edge_distance`, which is next door in `seg004` -- keep their
 * shape: a flag for the label and a straight line through it, rather
 * than a rearrangement that would be a different program.
 */
import { g, byteOf, wordOf } from './state.ts';
import { x_bump, y_land } from './data.ts';
import {
  tiles, actions, directions, frameids, seqids, charids, soundids, sword_status,
} from './types.ts';
import {
  get_tile, get_tile_at_char, get_tile_behind_char, get_tile_infrontof_char,
  get_tile_above_char, get_tile_front_above_char, get_tile_behind_above_char,
  tile_is_floor, char_dx_forward, distance_to_edge_weight, distance_to_edge,
  load_fram_det_col, play_seq, take_hp, release_arrows, can_grab, check_grab,
  do_pickup, get_tile_div_mod, get_tile_div_mod_m7, dx_weight, back_delta_x, in_wall,
  seqOffset, through_tile, setThroughTile,
} from './seg006.ts';
import {
  get_edge_distance, edge_type, EDGE_TYPE_FLOOR, EDGE_TYPE_WALL, can_bump_into_gate,
} from './seg004.ts';
import { l2, l6, l7, out } from './link.ts';

const TILE_SIZEX = 14;
const FIRST_ONSCREEN_COLUMN = 2;
const CONTROL_HELD: number = -1;
const CONTROL_RELEASED = 0;
const CONTROL_IGNORE: number = 1;
const CONTROL_HELD_FORWARD = -1;
const CONTROL_HELD_BACKWARD = 1;
const CONTROL_HELD_UP = -1;
const CONTROL_HELD_DOWN = 1;

/** `char_opp_dist`, which lives in seg002; linked in to avoid a cycle. */
export const dist = { char_opp_dist: (): number => 0 };

// seg005:000A
export function seqtbl_offset_char(seq_index: number): void {
  g.Char.curr_seq = seqOffset(seq_index);
}

// seg005:001D
export function seqtbl_offset_opp(seq_index: number): void {
  g.Opp.curr_seq = seqOffset(seq_index);
}

// seg005:0030
export function do_fall(): void {
  if (g.is_screaming === 0 && g.Char.fall_y >= 31) {
    out.play_sound(soundids.sound_1_falling);
    g.is_screaming = 1;
  }
  if (wordOf(y_land[g.Char.curr_row + 1]) > wordOf(g.Char.y)) {
    check_grab();
  } else {
    // `in_wall` re-reads the tile at the column it moves him to, and
    // the floor test below sees that one.
    if (get_tile_at_char() === tiles.tiles_20_wall) in_wall();
    if (tile_is_floor(g.curr_tile2)) land();
    else l2.inc_curr_row.fn();
  }
}

// seg005:0090
export function land(): void {
  let seq_id = 0;
  g.is_screaming = 0;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  /** `goto loc_5EE6`: he came down on spikes. */
  let onSpikes = false;
  if (get_tile_at_char() !== tiles.tiles_2_spike) {
    if (!tile_is_floor(get_tile_infrontof_char()) && distance_to_edge_weight() < 3) {
      g.Char.x = byteOf(char_dx_forward(-3));
    }
    l7.start_chompers.fn(g.Char.room, g.Char.curr_row);
  } else {
    onSpikes = true;
  }
  if (!onSpikes && g.Char.alive >= 0) {
    // dead already: `loc_5F6C`.
    take_hp(100);
    out.play_sound(soundids.sound_0_fell_to_death);
    seq_id = seqids.seq_22_crushed;
    seqtbl_offset_char(seq_id);
    play_seq();
    g.Char.fall_y = 0;
    return;
  }
  if (onSpikes
    || (distance_to_edge_weight() >= 12 && get_tile_behind_char() === tiles.tiles_2_spike)
    || get_tile_at_char() === tiles.tiles_2_spike) {
    if (l7.is_spike_harmful.fn()) {
      spiked();
      return;
    }
  }
  // `loc_5EFD`, which the two-row case jumps back into for a shadow.
  const landedOneRow = (): number => {
    let id: number;
    if (g.Char.charid >= charids.charid_2_guard
      || g.Char.sword === sword_status.sword_2_drawn) {
      g.Char.sword = sword_status.sword_2_drawn;
      id = seqids.seq_63_guard_active_after_fall;
    } else {
      id = seqids.seq_17_soft_land;
    }
    if (g.Char.charid === charids.charid_0_kid) {
      out.play_sound(soundids.sound_17_soft_land);
      g.is_guard_notice = 1;
    }
    return id;
  };
  /** `loc_5F6C`: a hundred points and the crushed sequence. */
  let crushed = false;
  /** `loc_5F75`: the same without the hundred, the hit point having done it. */
  let crushedNoHp = false;
  if (g.Char.fall_y < 22) {
    seq_id = landedOneRow();
  } else if (g.Char.fall_y < 33) {
    // fell two rows
    if (g.Char.charid === charids.charid_1_shadow) {
      seq_id = landedOneRow();
    } else if (g.Char.charid === charids.charid_2_guard) {
      crushed = true;
    } else if (!take_hp(1)) {
      out.play_sound(soundids.sound_16_medium_land);
      g.is_guard_notice = 1;
      seq_id = seqids.seq_20_medium_land;
    } else {
      crushedNoHp = true;
    }
  } else {
    // fell three rows or more
    crushed = true;
  }
  if (crushed) take_hp(100);
  if (crushed || crushedNoHp) {
    out.play_sound(soundids.sound_0_fell_to_death);
    seq_id = seqids.seq_22_crushed;
  }
  seqtbl_offset_char(seq_id);
  play_seq();
  g.Char.fall_y = 0;
}

// seg005:01B7
export function spiked(): void {
  g.curr_room_modif[g.curr_tilepos] = 0xff;
  g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
  g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN] + 10);
  g.Char.x = byteOf(char_dx_forward(8));
  g.Char.fall_y = 0;
  out.play_sound(soundids.sound_48_spiked);
  take_hp(100);
  seqtbl_offset_char(seqids.seq_51_spiked);
  play_seq();
}

// seg005:0213
export function control(): void {
  const char_frame = g.Char.frame;
  if (g.Char.alive >= 0) {
    if (char_frame === frameids.frame_15_stand
      || char_frame === frameids.frame_166_stand_inactive
      || char_frame === frameids.frame_158_stand_with_sword
      || char_frame === frameids.frame_171_stand_with_sword) {
      seqtbl_offset_char(seqids.seq_71_dying);
    }
    return;
  }
  const char_action = g.Char.action;
  if (char_action === actions.actions_5_bumped
    || char_action === actions.actions_4_in_freefall) {
    release_arrows();
  } else if (g.Char.sword === sword_status.sword_2_drawn) {
    control_with_sword();
  } else if (g.Char.charid >= charids.charid_2_guard) {
    l6.control_guard_inactive.fn();
  } else if (char_frame === frameids.frame_15_stand
    || (char_frame >= frameids.frame_50_turn && char_frame < 53)) {
    control_standing();
  } else if (char_frame === frameids.frame_48_turn) {
    control_turning();
  } else if (char_frame < 4) {
    control_startrun();
  } else if (char_frame >= frameids.frame_67_start_jump_up_1
    && char_frame < frameids.frame_70_jumphang) {
    control_jumpup();
  } else if (char_frame < 15) {
    control_running();
  } else if (char_frame >= frameids.frame_87_hanging_1 && char_frame < 100) {
    control_hanging();
  } else if (char_frame === frameids.frame_109_crouch) {
    control_crouched();
  }
}

// seg005:02EB
export function control_crouched(): void {
  if (g.need_level1_music !== 0 && g.current_level === 1) {
    // Special event: the music while he is crouched at the start.
    if (!out.check_sound_playing()) {
      if (g.need_level1_music === 1) {
        out.play_sound(soundids.sound_25_presentation);
        g.need_level1_music = 2;
      } else {
        g.need_level1_music = 0;
      }
    }
    return;
  }
  g.need_level1_music = 0;
  if (g.control_shift2 === CONTROL_HELD && check_get_item()) return;
  if (g.control_y !== CONTROL_HELD_DOWN) {
    seqtbl_offset_char(seqids.seq_49_stand_up_from_crouch);
  } else if (g.control_forward === CONTROL_HELD) {
    g.control_forward = CONTROL_IGNORE;
    seqtbl_offset_char(seqids.seq_79_crouch_hop);
  }
}

// seg005:0358
export function control_standing(): void {
  if (g.control_shift2 === CONTROL_HELD && g.control_shift === CONTROL_HELD
    && check_get_item()) {
    return;
  }
  if (g.Char.charid !== charids.charid_0_kid
    && g.control_down === CONTROL_HELD && g.control_forward === CONTROL_HELD) {
    draw_sword();
    return;
  }
  /** `goto loc_6213`: skip the Shift branch and take the plain one. */
  let plain = false;
  if (g.have_sword) {
    if (g.offguard !== 0 && g.control_shift >= CONTROL_RELEASED) {
      plain = true;
    } else if (g.can_guard_see_kid >= 2) {
      const distance = dist.char_opp_dist();
      if (distance >= -10 && distance < 90) {
        g.holding_sword = 1;
        if (wordOf(distance) < wordOf(-6)) {
          if (g.Opp.charid === charids.charid_1_shadow
            && (g.Opp.action === actions.actions_3_in_midair
              || (g.Opp.frame >= frameids.frame_107_fall_land_1 && g.Opp.frame < 118))) {
            g.offguard = 0;
          } else {
            draw_sword();
            return;
          }
        } else {
          back_pressed();
          return;
        }
      }
    } else {
      g.offguard = 0;
    }
  }
  if (!plain && g.control_shift === CONTROL_HELD) {
    if (g.control_backward === CONTROL_HELD) back_pressed();
    else if (g.control_up === CONTROL_HELD) up_pressed();
    else if (g.control_down === CONTROL_HELD) down_pressed();
    else if (g.control_x === CONTROL_HELD_FORWARD && g.control_forward === CONTROL_HELD) {
      safe_step();
    }
    return;
  }
  if (g.control_forward === CONTROL_HELD) {
    forward_pressed();
  } else if (g.control_backward === CONTROL_HELD) {
    back_pressed();
  } else if (g.control_up === CONTROL_HELD) {
    up_pressed();
  } else if (g.control_down === CONTROL_HELD) {
    down_pressed();
  } else if (g.control_x === CONTROL_HELD_FORWARD) {
    forward_pressed();
  }
}

// seg005:0482
export function up_pressed(): void {
  let leveldoor_tilepos = -1;
  if (get_tile_at_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  else if (get_tile_behind_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  else if (get_tile_infrontof_char() === tiles.tiles_16_level_door_left) leveldoor_tilepos = g.curr_tilepos;
  if (leveldoor_tilepos !== -1
    && g.level.start_room !== g.drawn_room
    && g.leveldoor_open) {
    go_up_leveldoor();
    return;
  }
  if (g.control_x === CONTROL_HELD_FORWARD) standing_jump();
  else check_jump_up();
}

// seg005:04C7
export function down_pressed(): void {
  g.control_down = CONTROL_IGNORE;
  if (!tile_is_floor(get_tile_infrontof_char()) && distance_to_edge_weight() < 3) {
    g.Char.x = byteOf(char_dx_forward(5));
    load_fram_det_col();
    return;
  }
  if (!tile_is_floor(get_tile_behind_char()) && distance_to_edge_weight() >= 8) {
    setThroughTile(get_tile_behind_char());
    get_tile_at_char();
    if (can_grab()
      && (g.Char.direction >= directions.dir_0_right
        || get_tile_at_char() !== tiles.tiles_4_gate
        || (g.curr_room_modif[g.curr_tilepos] >> 2) >= 6)) {
      g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight() - 9));
      seqtbl_offset_char(seqids.seq_68_climb_down);
      return;
    }
  }
  crouch();
}

// seg005:0574
export function go_up_leveldoor(): void {
  g.Char.x = byteOf(x_bump[g.tile_col + FIRST_ONSCREEN_COLUMN] + 10);
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_70_go_up_on_level_door);
}

// seg005:058F
export function control_turning(): void {
  if (g.control_shift >= CONTROL_RELEASED
    && g.control_x === CONTROL_HELD_FORWARD
    && g.control_y >= CONTROL_RELEASED) {
    seqtbl_offset_char(seqids.seq_43_start_run_after_turn);
  }
}

// seg005:05AD
export function crouch(): void {
  seqtbl_offset_char(seqids.seq_50_crouch);
  g.control_down = release_arrows();
}

// seg005:05BE
export function back_pressed(): void {
  let seq_id: number;
  g.control_backward = release_arrows();
  if (g.have_sword === 0
    || g.can_guard_see_kid < 2
    || dist.char_opp_dist() > 0
    || distance_to_edge_weight() < 2) {
    seq_id = seqids.seq_5_turn;
  } else {
    g.Char.sword = sword_status.sword_2_drawn;
    g.offguard = 0;
    seq_id = seqids.seq_89_turn_draw_sword;
  }
  seqtbl_offset_char(seq_id);
}

// seg005:060F
export function forward_pressed(): void {
  const distance = get_edge_distance();
  if (edge_type === EDGE_TYPE_WALL && g.curr_tile2 !== tiles.tiles_18_chomper && distance < 8) {
    if (g.control_forward === CONTROL_HELD) safe_step();
  } else {
    seqtbl_offset_char(seqids.seq_1_start_run);
  }
}

// seg005:0649
export function control_running(): void {
  if (g.control_x === CONTROL_RELEASED
    && (g.Char.frame === frameids.frame_7_run || g.Char.frame === frameids.frame_11_run)) {
    g.control_forward = release_arrows();
    seqtbl_offset_char(seqids.seq_13_stop_run);
  } else if (g.control_x === CONTROL_HELD_BACKWARD) {
    g.control_backward = release_arrows();
    seqtbl_offset_char(seqids.seq_6_run_turn);
  } else if (g.control_y === CONTROL_HELD_UP && g.control_up === CONTROL_HELD) {
    run_jump();
  } else if (g.control_down === CONTROL_HELD) {
    g.control_down = CONTROL_IGNORE;
    seqtbl_offset_char(seqids.seq_26_crouch_while_running);
  }
}

// seg005:06A8
export function safe_step(): void {
  g.control_shift2 = CONTROL_IGNORE;
  g.control_forward = CONTROL_IGNORE;
  const distance = get_edge_distance();
  if (distance) {
    g.Char.repeat = 1;
    seqtbl_offset_char(distance + 28); // 29..42: safe step to edge
  } else if (edge_type !== EDGE_TYPE_WALL && g.Char.repeat !== 0) {
    g.Char.repeat = 0;
    seqtbl_offset_char(seqids.seq_44_step_on_edge);
  } else {
    seqtbl_offset_char(seqids.seq_39_safe_step_11);
  }
}

// seg005:06F0
export function check_get_item(): number {
  if (get_tile_at_char() === tiles.tiles_10_potion
    || g.curr_tile2 === tiles.tiles_22_sword) {
    if (!tile_is_floor(get_tile_behind_char())) return 0;
    g.Char.x = byteOf(char_dx_forward(-14));
    load_fram_det_col();
  }
  if (get_tile_infrontof_char() === tiles.tiles_10_potion
    || g.curr_tile2 === tiles.tiles_22_sword) {
    get_item();
    return 1;
  }
  return 0;
}

// seg005:073E
export function get_item(): void {
  if (g.Char.frame !== frameids.frame_109_crouch) {
    const distance = get_edge_distance();
    if (edge_type !== EDGE_TYPE_FLOOR) {
      g.Char.x = byteOf(char_dx_forward(distance));
    }
    if (g.Char.direction >= directions.dir_0_right) {
      g.Char.x = byteOf(char_dx_forward(
        (g.curr_tile2 === tiles.tiles_10_potion ? 1 : 0) - 2,
      ));
    }
    crouch();
  } else if (g.curr_tile2 === tiles.tiles_22_sword) {
    do_pickup(-1);
    seqtbl_offset_char(seqids.seq_91_get_sword);
  } else {
    do_pickup(g.curr_room_modif[g.curr_tilepos] >> 3);
    seqtbl_offset_char(seqids.seq_78_drink);
  }
}

// seg005:07FF
export function control_startrun(): void {
  if (g.control_y === CONTROL_HELD_UP && g.control_x === CONTROL_HELD_FORWARD) {
    standing_jump();
  }
}

// seg005:0812
export function control_jumpup(): void {
  if (g.control_x === CONTROL_HELD_FORWARD || g.control_forward === CONTROL_HELD) {
    standing_jump();
  }
}

// seg005:0825
export function standing_jump(): void {
  g.control_up = CONTROL_IGNORE;
  g.control_forward = CONTROL_IGNORE;
  seqtbl_offset_char(seqids.seq_3_standing_jump);
}

// seg005:0836
export function check_jump_up(): void {
  g.control_up = release_arrows();
  setThroughTile(get_tile_above_char());
  get_tile_front_above_char();
  if (can_grab()) {
    grab_up_with_floor_behind();
    return;
  }
  setThroughTile(get_tile_behind_above_char());
  get_tile_above_char();
  if (can_grab()) jump_up_or_grab();
  else jump_up();
}

// seg005:087B
export function jump_up_or_grab(): void {
  const distance = distance_to_edge_weight();
  if (distance < 6) {
    jump_up();
  } else if (!tile_is_floor(get_tile_behind_char())) {
    grab_up_no_floor_behind();
  } else {
    g.Char.x = byteOf(char_dx_forward(distance - TILE_SIZEX));
    load_fram_det_col();
    grab_up_with_floor_behind();
  }
}

// seg005:08C7
export function grab_up_no_floor_behind(): void {
  get_tile_above_char();
  g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight() - 10));
  seqtbl_offset_char(seqids.seq_16_jump_up_and_grab);
}

// seg005:08E6
export function jump_up(): void {
  g.control_up = release_arrows();
  const distance = get_edge_distance();
  if (distance < 4 && edge_type === EDGE_TYPE_WALL) {
    g.Char.x = byteOf(char_dx_forward(distance - 3));
  }
  get_tile(g.Char.room, get_tile_div_mod(back_delta_x(0) + dx_weight() - 6), g.Char.curr_row - 1);
  if (g.curr_tile2 !== tiles.tiles_20_wall && !tile_is_floor(g.curr_tile2)) {
    seqtbl_offset_char(seqids.seq_28_jump_up_with_nothing_above);
  } else {
    seqtbl_offset_char(seqids.seq_14_jump_up_into_ceiling);
  }
}

// seg005:0968
export function control_hanging(): void {
  if (g.Char.alive >= 0) {
    hang_fall();
    return;
  }
  if (g.grab_timer === 0 && g.control_y === CONTROL_HELD) {
    can_climb_up();
  } else if (g.control_shift === CONTROL_HELD) {
    if (g.Char.action !== actions.actions_6_hang_straight
      && (get_tile_at_char() === tiles.tiles_20_wall
        || (g.Char.direction === directions.dir_FF_left
          && (g.curr_tile2 === tiles.tiles_7_doortop_with_floor
            || g.curr_tile2 === tiles.tiles_12_doortop)))) {
      if (g.grab_timer === 0) out.play_sound(soundids.sound_8_bumped);
      seqtbl_offset_char(seqids.seq_25_hang_against_wall);
    } else if (!tile_is_floor(get_tile_above_char())) {
      hang_fall();
    }
  } else {
    hang_fall();
  }
}

// seg005:09DF
export function can_climb_up(): void {
  let seq_id: number = seqids.seq_10_climb_up;
  g.control_up = release_arrows();
  g.control_shift2 = g.control_up;
  get_tile_above_char();
  if (((g.curr_tile2 === tiles.tiles_13_mirror || g.curr_tile2 === tiles.tiles_18_chomper)
    && g.Char.direction === directions.dir_0_right)
    || (g.curr_tile2 === tiles.tiles_4_gate
      && g.Char.direction !== directions.dir_0_right
      && (g.curr_room_modif[g.curr_tilepos] >> 2) < 6)) {
    seq_id = seqids.seq_73_climb_up_to_closed_gate;
  }
  seqtbl_offset_char(seq_id);
}

// seg005:0A46
export function hang_fall(): void {
  g.control_down = release_arrows();
  if (!tile_is_floor(get_tile_behind_char()) && !tile_is_floor(get_tile_at_char())) {
    seqtbl_offset_char(seqids.seq_23_release_ledge_and_fall);
    return;
  }
  if (get_tile_at_char() === tiles.tiles_20_wall
    || (g.Char.direction < directions.dir_0_right
      && (g.curr_tile2 === tiles.tiles_7_doortop_with_floor
        || g.curr_tile2 === tiles.tiles_12_doortop))) {
    g.Char.x = byteOf(char_dx_forward(-7));
  }
  seqtbl_offset_char(seqids.seq_11_release_ledge_and_land);
}

// seg005:0AA8
export function grab_up_with_floor_behind(): void {
  const distance = distance_to_edge_weight();
  const edge_distance = get_edge_distance();
  if (distance < 4 && edge_distance < 4 && edge_type !== EDGE_TYPE_CLOSER_VALUE) {
    g.Char.x = byteOf(char_dx_forward(distance));
    seqtbl_offset_char(seqids.seq_8_jump_up_and_grab_straight);
  } else {
    g.Char.x = byteOf(char_dx_forward(distance - 4));
    seqtbl_offset_char(seqids.seq_24_jump_up_and_grab_forward);
  }
}

/** The C writes `edge_type != 1` here, which is `EDGE_TYPE_CLOSER`. */
const EDGE_TYPE_CLOSER_VALUE = 1;

// seg005:0AF7
export function run_jump(): void {
  if (g.Char.frame >= frameids.frame_7_run) {
    const xpos = char_dx_forward(4);
    let col = get_tile_div_mod_m7(xpos);
    for (let tiles_forward = 0; tiles_forward < 2; ++tiles_forward) {
      col += [-1, 1][g.Char.direction + 1];
      get_tile(g.Char.room, col, g.Char.curr_row);
      if (g.curr_tile2 === tiles.tiles_2_spike || !tile_is_floor(g.curr_tile2)) {
        let pos_adjustment = distance_to_edge(xpos) + TILE_SIZEX * tiles_forward - TILE_SIZEX;
        if (wordOf(pos_adjustment) < wordOf(-8) || pos_adjustment >= 2) {
          if (pos_adjustment < 128) return;
          pos_adjustment = -3;
        }
        g.Char.x = byteOf(char_dx_forward(pos_adjustment + 4));
        break;
      }
    }
    g.control_up = release_arrows();
    seqtbl_offset_char(seqids.seq_4_run_jump);
  }
}

// seg005:0BB5
export function back_with_sword(): void {
  const frame = g.Char.frame;
  if (frame === frameids.frame_158_stand_with_sword
    || frame === frameids.frame_170_stand_with_sword
    || frame === frameids.frame_171_stand_with_sword) {
    g.control_backward = CONTROL_IGNORE;
    seqtbl_offset_char(seqids.seq_57_back_with_sword);
  }
}

// seg005:0BE3
export function forward_with_sword(): void {
  const frame = g.Char.frame;
  if (frame === frameids.frame_158_stand_with_sword
    || frame === frameids.frame_170_stand_with_sword
    || frame === frameids.frame_171_stand_with_sword) {
    g.control_forward = CONTROL_IGNORE;
    if (g.Char.charid !== charids.charid_0_kid) {
      seqtbl_offset_char(seqids.seq_56_guard_forward_with_sword);
    } else {
      seqtbl_offset_char(seqids.seq_86_forward_with_sword);
    }
  }
}

// seg005:0C1D
export function draw_sword(): void {
  let seq_id: number = seqids.seq_55_draw_sword;
  g.control_forward = release_arrows();
  g.control_shift2 = g.control_forward;
  if (g.Char.charid === charids.charid_0_kid) {
    out.play_sound(soundids.sound_19_draw_sword);
    g.offguard = 0;
  } else if (g.Char.charid !== charids.charid_1_shadow) {
    seq_id = seqids.seq_90_en_garde;
  }
  g.Char.sword = sword_status.sword_2_drawn;
  seqtbl_offset_char(seq_id);
}

// seg005:0C67
export function control_with_sword(): void {
  if (g.Char.action >= actions.actions_2_hang_climb) return;
  if (get_tile_at_char() === tiles.tiles_11_loose || g.can_guard_see_kid >= 2) {
    const distance = dist.char_opp_dist();
    if (wordOf(distance) < wordOf(90)) {
      swordfight();
      return;
    }
    if (distance < 0) {
      if (wordOf(distance) < wordOf(-4)) {
        seqtbl_offset_char(seqids.seq_60_turn_with_sword);
      } else {
        swordfight();
      }
      return;
    }
  }
  if (g.Char.charid === charids.charid_0_kid && g.Char.alive < 0) {
    g.holding_sword = 0;
  }
  if (g.Char.charid < charids.charid_2_guard) {
    if (g.Char.frame === frameids.frame_171_stand_with_sword) {
      g.Char.sword = sword_status.sword_0_sheathed;
      seqtbl_offset_char(seqids.seq_92_put_sword_away);
    }
  } else {
    swordfight();
  }
}

// seg005:0CDB
export function swordfight(): void {
  let seq_id: number;
  const frame = g.Char.frame;
  const charid = g.Char.charid;
  if (frame === frameids.frame_161_parry && g.control_shift2 >= 0) {
    seqtbl_offset_char(seqids.seq_57_back_with_sword);
    return;
  }
  if (g.control_shift2 === CONTROL_HELD) {
    if (charid === charids.charid_0_kid) g.kid_sword_strike = 15;
    sword_strike();
    if (g.control_shift2 === CONTROL_IGNORE) return;
  }
  if (g.control_down === CONTROL_HELD) {
    if (frame === frameids.frame_158_stand_with_sword
      || frame === frameids.frame_170_stand_with_sword
      || frame === frameids.frame_171_stand_with_sword) {
      g.control_down = CONTROL_IGNORE;
      g.Char.sword = sword_status.sword_0_sheathed;
      if (charid === charids.charid_0_kid) {
        g.offguard = 1;
        g.guard_refrac = 9;
        g.holding_sword = 0;
        seq_id = seqids.seq_93_put_sword_away_fast;
      } else if (charid === charids.charid_1_shadow) {
        seq_id = seqids.seq_92_put_sword_away;
      } else {
        seq_id = seqids.seq_87_guard_become_inactive;
      }
      seqtbl_offset_char(seq_id);
    }
  } else if (g.control_up === CONTROL_HELD) {
    parry();
  } else if (g.control_forward === CONTROL_HELD) {
    forward_with_sword();
  } else if (g.control_backward === CONTROL_HELD) {
    back_with_sword();
  }
}

// seg005:0DB0
export function sword_strike(): void {
  const frame = g.Char.frame;
  let seq_id: number;
  if (frame === frameids.frame_157_walk_with_sword
    || frame === frameids.frame_158_stand_with_sword
    || frame === frameids.frame_170_stand_with_sword
    || frame === frameids.frame_171_stand_with_sword
    || frame === frameids.frame_165_walk_with_sword) {
    seq_id = g.Char.charid === charids.charid_0_kid
      ? seqids.seq_75_strike : seqids.seq_58_guard_strike;
  } else if (frame === frameids.frame_150_parry || frame === frameids.frame_161_parry) {
    seq_id = seqids.seq_66_strike_after_parry;
  } else {
    return;
  }
  g.control_shift2 = CONTROL_IGNORE;
  seqtbl_offset_char(seq_id);
}

// seg005:0E0F
export function parry(): void {
  const char_frame = g.Char.frame;
  const opp_frame = g.Opp.frame;
  const char_charid = g.Char.charid;
  let seq_id: number = seqids.seq_62_parry;
  let do_play_seq = false;
  if (char_frame === frameids.frame_158_stand_with_sword
    || char_frame === frameids.frame_170_stand_with_sword
    || char_frame === frameids.frame_171_stand_with_sword
    || char_frame === frameids.frame_168_back
    || char_frame === frameids.frame_165_walk_with_sword) {
    if (dist.char_opp_dist() >= 32 && char_charid !== charids.charid_0_kid) {
      back_with_sword();
      return;
    }
    if (char_charid === charids.charid_0_kid) {
      if (opp_frame === frameids.frame_168_back) return;
      if (opp_frame !== frameids.frame_151_strike_1
        && opp_frame !== frameids.frame_152_strike_2
        && opp_frame !== frameids.frame_162_block_to_strike) {
        if (opp_frame === frameids.frame_153_strike_3) do_play_seq = true;
      }
    } else if (opp_frame !== frameids.frame_152_strike_2) {
      return;
    }
  } else {
    if (char_frame !== frameids.frame_167_blocked) return;
    seq_id = seqids.seq_61_parry_after_strike;
  }
  g.control_up = CONTROL_IGNORE;
  seqtbl_offset_char(seq_id);
  if (do_play_seq) play_seq();
}

/** Keeps the unused import honest while seg002 is still to come. */
export const PENDING = { can_bump_into_gate, through_tile };
