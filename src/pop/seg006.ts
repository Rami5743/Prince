/**
 * `seg006.c`: where a character is, what it is drawn as, and what is
 * under it.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. The frame tables it reads are not
 * SDLPoP's copies of them but the ones in PRINCE.EXE, handed in by
 * `setFrameTables`.
 *
 * SDLPoP's optional fixes are all left out: the port is a port of the
 * game as it was, and every `#ifdef FIX_` branch here takes the side
 * the original is on.
 */
import {
  g, type CharType, type FrameType, copyChar, byteOf, sbyteOf, wordOf,
} from './state.ts';
import {
  tbl_line, y_land, tile_div_tbl, tile_mod_tbl, dir_front, dir_behind, y_clip,
} from './data.ts';
import {
  tiles, charids, actions, directions, frameids, seqids, sword_status,
  frame_flags, seqtbl_instructions, seqtbl_sounds, soundids, chtabs,
} from './types.ts';
import { l2, l5, l7, l8, out } from './link.ts';

/** `TILE_SIZEX`, `TILE_SIZEY`, `TILE_RIGHTX`, `SCREENSPACE_X`. */
const TILE_SIZEX = 14;
const TILE_SIZEY = 63;
const TILE_RIGHTX = 13;
const SCREENSPACE_X = 58;
const FALLING_SPEED_ACCEL = 3;
const FALLING_SPEED_MAX = 33;

const CONTROL_HELD = -1;
const CONTROL_RELEASED = 0;
const CONTROL_IGNORE = 1;
const CONTROL_HELD_FORWARD = -1;
const CONTROL_HELD_BACKWARD = 1;
const CONTROL_HELD_UP = -1;
const CONTROL_HELD_DOWN = 1;

/** `obj_xl` and `infrontx`, which the C leaves lying about for its callers. */
export let obj_xl = 0;
export let infrontx = 0;
export let through_tile = 0;
export function setThroughTile(v: number): void { through_tile = v; }
export let fall_frame = 0;
export let droppedout = 0;

/**
 * The three frame tables, out of PRINCE.EXE.
 *
 * `seg006.c` has them as C literals; the executable has the same
 * numbers and is the thing the game actually ran on, so they come from
 * there -- see `src/game/exe-tables.ts`, which has a test of its own.
 */
let frame_table_kid: readonly FrameType[] = [];
let frame_tbl_guard: readonly FrameType[] = [];
let frame_tbl_cuts: readonly FrameType[] = [];
let seqtbl: Uint8Array = new Uint8Array(0);
let seqtbl_offsets: readonly number[] = [];

export function setFrameTables(
  kid: readonly FrameType[], guard: readonly FrameType[], cuts: readonly FrameType[],
  table: Uint8Array, offsets: readonly number[],
): void {
  frame_table_kid = kid;
  frame_tbl_guard = guard;
  frame_tbl_cuts = cuts;
  seqtbl = table;
  seqtbl_offsets = offsets;
}

export function seqByte(at: number): number {
  return seqtbl[at] ?? 0;
}

export function seqOffset(index: number): number {
  return seqtbl_offsets[index] ?? 0;
}

// seg006:0006
export function get_tile(room: number, col: number, row: number): number {
  g.curr_room = room;
  g.tile_col = col;
  g.tile_row = row;
  g.curr_room = find_room_of_tile();
  if (g.curr_room > 0) {
    l8.get_room_address.fn(g.curr_room);
    g.curr_tilepos = tbl_line[g.tile_row] + g.tile_col;
    g.curr_tile2 = g.curr_room_tiles[g.curr_tilepos] & 0x1f;
  } else {
    // wall in room 0
    g.curr_tile2 = tiles.tiles_20_wall;
  }
  return g.curr_tile2;
}

// seg006:005D
export function find_room_of_tile(): number {
  for (;;) {
    if (g.tile_col < 0) {
      g.tile_col += 10;
      if (g.curr_room) g.curr_room = g.level.roomlinks[g.curr_room - 1].left;
      continue;
    }
    if (g.tile_col >= 10) {
      g.tile_col -= 10;
      if (g.curr_room) g.curr_room = g.level.roomlinks[g.curr_room - 1].right;
      continue;
    }
    if (g.tile_row < 0) {
      g.tile_row += 3;
      if (g.curr_room) g.curr_room = g.level.roomlinks[g.curr_room - 1].up;
      continue;
    }
    if (g.tile_row >= 3) {
      g.tile_row -= 3;
      if (g.curr_room) g.curr_room = g.level.roomlinks[g.curr_room - 1].down;
      continue;
    }
    return g.curr_room;
  }
}

// seg006:00EC
export function get_tilepos(tile_col: number, tile_row: number): number {
  if (tile_row < 0) return -(tile_col + 1);
  if (tile_row >= 3 || tile_col >= 10 || tile_col < 0) return 30;
  return tbl_line[tile_row] + tile_col;
}

// seg006:0124
export function get_tilepos_nominus(tile_col: number, tile_row: number): number {
  const tilepos = get_tilepos(tile_col, tile_row);
  return tilepos < 0 ? 30 : tilepos;
}

// seg006:0144
export function load_fram_det_col(): void {
  load_frame();
  determine_col();
}

// seg006:014D
export function determine_col(): void {
  g.Char.curr_col = get_tile_div_mod_m7(dx_weight());
}

const BLANK_FRAME: FrameType = { image: 255, sword: 0, dx: 0, dy: 0, flags: 0 };

function get_frame(table: readonly FrameType[], frame: number): void {
  const f = frame >= 0 && frame < table.length ? table[frame] : BLANK_FRAME;
  g.cur_frame = { image: f.image, sword: f.sword, dx: f.dx, dy: f.dy, flags: f.flags };
}

// seg006:015A
export function load_frame(): void {
  const frame = g.Char.frame;
  let add_frame = 0;
  switch (g.Char.charid) {
    case charids.charid_0_kid:
    case charids.charid_24_mouse:
      get_frame(frame_table_kid, frame);
      break;
    case charids.charid_2_guard:
    case charids.charid_4_skeleton:
      if (frame >= 102 && frame < 107) add_frame = 70;
      get_frame(frame_tbl_guard, frame + add_frame - 149);
      break;
    case charids.charid_1_shadow:
      if (frame < 150 || frame >= 190) get_frame(frame_table_kid, frame);
      else get_frame(frame_tbl_guard, frame - 149);
      break;
    case charids.charid_5_princess:
    case charids.charid_6_vizier:
      get_frame(frame_tbl_cuts, frame);
      break;
    default:
      get_frame(frame_table_kid, frame);
      break;
  }
}

// seg006:01F5
export function dx_weight(): number {
  const offset = sbyteOf(g.cur_frame.dx - (g.cur_frame.flags & frame_flags.FRAME_WEIGHT_X));
  return char_dx_forward(offset);
}

// seg006:0213
export function char_dx_forward(delta_x: number): number {
  if (g.Char.direction < directions.dir_0_right) delta_x = -delta_x;
  return delta_x + g.Char.x;
}

// seg006:0234
export function obj_dx_forward(delta_x: number): number {
  if (g.obj_direction < directions.dir_0_right) delta_x = -delta_x;
  g.obj_x += delta_x;
  return g.obj_x;
}

// seg006:0254
export function play_seq(): void {
  for (;;) {
    const command = seqByte(g.Char.curr_seq);
    g.Char.curr_seq++;
    switch (command) {
      case seqtbl_instructions.SEQ_DX:
        g.Char.x = byteOf(char_dx_forward(sbyteOf(seqByte(g.Char.curr_seq))));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_DY:
        g.Char.y = byteOf(g.Char.y + sbyteOf(seqByte(g.Char.curr_seq)));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_FLIP:
        g.Char.direction = ~g.Char.direction;
        break;
      case seqtbl_instructions.SEQ_JMP_IF_FEATHER:
        if (!g.is_feather_fall) {
          g.Char.curr_seq += 2;
          break;
        }
        // fallthrough
      case seqtbl_instructions.SEQ_JMP:
        g.Char.curr_seq = seqByte(g.Char.curr_seq) | (seqByte(g.Char.curr_seq + 1) << 8);
        break;
      case seqtbl_instructions.SEQ_UP:
        --g.Char.curr_row;
        l7.start_chompers.fn(g.Char.room, g.Char.curr_row);
        break;
      case seqtbl_instructions.SEQ_DOWN:
        l2.inc_curr_row.fn();
        l7.start_chompers.fn(g.Char.room, g.Char.curr_row);
        break;
      case seqtbl_instructions.SEQ_ACTION:
        g.Char.action = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_SET_FALL:
        g.Char.fall_x = sbyteOf(seqByte(g.Char.curr_seq));
        g.Char.curr_seq++;
        g.Char.fall_y = sbyteOf(seqByte(g.Char.curr_seq));
        g.Char.curr_seq++;
        break;
      case seqtbl_instructions.SEQ_KNOCK_UP:
        g.knock = 1;
        break;
      case seqtbl_instructions.SEQ_KNOCK_DOWN:
        g.knock = -1;
        break;
      case seqtbl_instructions.SEQ_SOUND: {
        const which_sound = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        switch (which_sound) {
          case seqtbl_sounds.SND_SILENT:
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_FOOTSTEP:
            out.play_sound(soundids.sound_23_footstep);
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_BUMP:
            out.play_sound(soundids.sound_8_bumped);
            g.is_guard_notice = 1;
            break;
          case seqtbl_sounds.SND_DRINK:
            out.play_sound(soundids.sound_18_drink);
            break;
          case seqtbl_sounds.SND_LEVEL:
            if (g.current_level === 4) out.play_sound(soundids.sound_32_shadow_music);
            else if (g.current_level !== 13 && g.current_level !== 15) {
              out.play_sound(soundids.sound_41_end_level_music);
            }
            break;
          default:
            break;
        }
        break;
      }
      case seqtbl_instructions.SEQ_END_LEVEL:
        ++g.next_level;
        break;
      case seqtbl_instructions.SEQ_GET_ITEM: {
        const which_item = seqByte(g.Char.curr_seq);
        g.Char.curr_seq++;
        if (which_item === 1) proc_get_object();
        break;
      }
      case seqtbl_instructions.SEQ_DIE:
        break;
      default:
        g.Char.frame = command;
        return;
    }
  }
}

// seg006:03DE
export function get_tile_div_mod_m7(xpos: number): number {
  return get_tile_div_mod(xpos - 7);
}

// seg006:0433
export function get_tile_div_mod(xpos: number): number {
  // The tables are indexed by a byte, and the C indexes them with the
  // raw x; out of range it reads whatever is next in memory, which is
  // not something to reproduce. Clamping is what the game's own range
  // of x never notices.
  const i = xpos & 0xff;
  obj_xl = tile_mod_tbl[i];
  return tile_div_tbl[i];
}

// seg006:0448
export function y_to_row_mod4(ypos: number): number {
  return Math.trunc((ypos + 60) / TILE_SIZEY) % 4 - 1;
}

// seg006:044F
export function loadkid(): void { copyChar(g.Char, g.Kid); }
// seg006:0464
export function savekid(): void { copyChar(g.Kid, g.Char); }
// seg006:0479
export function loadshad(): void { copyChar(g.Char, g.Guard); }
// seg006:048E
export function saveshad(): void { copyChar(g.Guard, g.Char); }
// seg006:04A3
export function loadkid_and_opp(): void { loadkid(); copyChar(g.Opp, g.Guard); }
// seg006:04BC
export function savekid_and_opp(): void { savekid(); copyChar(g.Guard, g.Opp); }
// seg006:04D5
export function loadshad_and_opp(): void { loadshad(); copyChar(g.Opp, g.Kid); }
// seg006:04EE
export function saveshad_and_opp(): void { saveshad(); copyChar(g.Kid, g.Opp); }

// seg006:0507
export function reset_obj_clip(): void {
  g.obj_clip_left = 0;
  g.obj_clip_top = 0;
  g.obj_clip_right = 320;
  g.obj_clip_bottom = 192;
}

// seg006:051C
export function x_to_xh_and_xl(xpos: number): { xh: number; xl: number } {
  if (xpos < 0) {
    return {
      xh: sbyteOf(-((Math.abs(-xpos) >> 3) + 1)),
      xl: sbyteOf(-((-xpos - 1) % 8 - 7)),
    };
  }
  return { xh: sbyteOf(Math.abs(xpos) >> 3), xl: sbyteOf(xpos % 8) };
}

// seg006:057C
export function fall_accel(): void {
  if (g.Char.action === actions.actions_4_in_freefall) {
    g.Char.fall_y += FALLING_SPEED_ACCEL;
    if (g.Char.fall_y > FALLING_SPEED_MAX) g.Char.fall_y = FALLING_SPEED_MAX;
  }
}

// seg006:05AE
export function fall_speed(): void {
  g.Char.y = byteOf(g.Char.y + g.Char.fall_y);
  if (g.Char.action === actions.actions_4_in_freefall) {
    g.Char.x = byteOf(char_dx_forward(g.Char.fall_x));
    load_fram_det_col();
  }
}

// seg006:05CD
export function check_action(): void {
  const action = g.Char.action;
  const frame = g.Char.frame;
  if (action === actions.actions_6_hang_straight || action === actions.actions_5_bumped) {
    if (frame === frameids.frame_109_crouch) check_on_floor();
  } else if (action === actions.actions_4_in_freefall) {
    l5.do_fall.fn();
  } else if (action === actions.actions_3_in_midair) {
    if (frame >= frameids.frame_102_start_fall_1 && frame < frameids.frame_106_fall) {
      check_grab();
    }
  } else if (action !== actions.actions_2_hang_climb) {
    check_on_floor();
  }
}

// seg006:0628
export function tile_is_floor(tiletype: number): boolean {
  switch (tiletype) {
    case tiles.tiles_0_empty:
    case tiles.tiles_9_bigpillar_top:
    case tiles.tiles_12_doortop:
    case tiles.tiles_20_wall:
    case tiles.tiles_26_lattice_down:
    case tiles.tiles_27_lattice_small:
    case tiles.tiles_28_lattice_left:
    case tiles.tiles_29_lattice_right:
      return false;
    default:
      return true;
  }
}

// seg006:0658
export function check_spiked(): void {
  const frame = g.Char.frame;
  if (get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row) === tiles.tiles_2_spike) {
    const harmful = l7.is_spike_harmful.fn();
    if (
      (harmful >= 2 && ((frame >= frameids.frame_7_run && frame < 15)
        || (frame >= frameids.frame_34_start_run_jump_1 && frame < 40)))
      || ((frame === frameids.frame_43_running_jump_4
        || frame === frameids.frame_26_standing_jump_11) && harmful !== 0)
    ) {
      l5.spiked.fn();
    }
  }
}

// seg006:06BD
export function take_hp(count: number): number {
  let dead = 0;
  if (g.Char.charid === charids.charid_0_kid) {
    if (count >= g.hitp_curr) {
      g.hitp_delta = -g.hitp_curr;
      dead = 1;
    } else {
      g.hitp_delta = -count;
    }
  } else if (count >= g.guardhp_curr) {
    g.guardhp_delta = -g.guardhp_curr;
    dead = 1;
  } else {
    g.guardhp_delta = -count;
  }
  return dead;
}

// seg006:070D
export function get_tile_at_char(): number {
  return get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row);
}

// seg006:0722
export function set_char_collision(): void {
  const image = g.chtab_addrs[g.obj_chtab]?.[g.obj_id];
  if (!image) {
    g.char_width_half = 0;
    g.char_height = 0;
  } else {
    g.char_width_half = (image.width + 1) >> 1;
    g.char_height = image.height;
  }
  g.char_x_left = Math.trunc(g.obj_x / 2) + 58;
  if (g.Char.direction >= directions.dir_0_right) {
    g.char_x_left -= g.char_width_half;
  }
  g.char_x_left_coll = g.char_x_left;
  g.char_x_right = g.char_x_left + g.char_width_half;
  g.char_x_right_coll = g.char_x_right;
  g.char_top_y = g.obj_y - g.char_height + 1;
  if (g.char_top_y >= 192) g.char_top_y = 0;
  g.char_top_row = y_to_row_mod4(g.char_top_y);
  g.char_bottom_row = y_to_row_mod4(g.obj_y);
  if (g.char_bottom_row === -1) g.char_bottom_row = 3;
  g.char_col_left = Math.max(get_tile_div_mod(g.char_x_left), 0);
  g.char_col_right = Math.min(get_tile_div_mod(g.char_x_right), 9);
  if (g.cur_frame.flags & frame_flags.FRAME_THIN) {
    g.char_x_left_coll += 4;
    g.char_x_right_coll -= 4;
  }
}

// seg006:07EB
export function check_on_floor(): void {
  if (g.cur_frame.flags & frame_flags.FRAME_NEEDS_FLOOR) {
    if (get_tile_at_char() === tiles.tiles_20_wall) in_wall();
    if (!tile_is_floor(g.curr_tile2)) {
      // Special event: the floors of level 12 appear.
      if (g.current_level === 12 && g.united_with_shadow < 0 && g.Char.curr_row === 0
        && (g.Char.room === 2 || (g.Char.room === 13 && g.tile_col >= 6))) {
        g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
        l8.set_wipe.fn(g.curr_tilepos, 1);
        l8.set_redraw_full.fn(g.curr_tilepos, 1);
        ++g.curr_tilepos;
        l8.set_wipe.fn(g.curr_tilepos, 1);
        l8.set_redraw_full.fn(g.curr_tilepos, 1);
      } else {
        start_fall();
      }
    }
  }
}

// seg006:08B9
export function start_fall(): void {
  let seq_id: number;
  const frame = g.Char.frame;
  g.Char.sword = sword_status.sword_0_sheathed;
  l2.inc_curr_row.fn();
  l7.start_chompers.fn(g.Char.room, g.Char.curr_row);
  fall_frame = frame;
  if (frame === frameids.frame_9_run) {
    seq_id = seqids.seq_7_fall;
  } else if (frame === frameids.frame_13_run) {
    seq_id = seqids.seq_19_fall;
  } else if (frame === frameids.frame_26_standing_jump_11) {
    seq_id = seqids.seq_18_fall_after_standing_jump;
  } else if (frame === frameids.frame_44_running_jump_5) {
    seq_id = seqids.seq_21_fall_after_running_jump;
  } else if (frame >= frameids.frame_81_hangdrop_1 && frame < 86) {
    seq_id = seqids.seq_19_fall;
    g.Char.x = byteOf(char_dx_forward(5));
    load_fram_det_col();
  } else if (frame >= 150 && frame < 180) {
    if (g.Char.charid === charids.charid_2_guard) {
      if (g.Char.curr_row === 3 && g.Char.curr_col === 10) {
        l2.clear_char.fn();
        return;
      }
      if (g.Char.fall_x < 0) {
        seq_id = seqids.seq_82_guard_pushed_off_ledge;
        if (g.Char.direction < directions.dir_0_right && distance_to_edge_weight() <= 7) {
          g.Char.x = byteOf(char_dx_forward(-5));
        }
      } else {
        droppedout = 0;
        seq_id = seqids.seq_83_guard_fall;
      }
    } else {
      droppedout = 1;
      if (g.Char.direction < directions.dir_0_right && distance_to_edge_weight() <= 7) {
        g.Char.x = byteOf(char_dx_forward(-5));
      }
      seq_id = seqids.seq_81_kid_pushed_off_ledge;
    }
  } else {
    seq_id = seqids.seq_7_fall;
  }
  l5.seqtbl_offset_char.fn(seq_id);
  play_seq();
  load_fram_det_col();
  if (get_tile_at_char() === tiles.tiles_20_wall) {
    in_wall();
    return;
  }
  if (get_tile_infrontof_char() === tiles.tiles_20_wall) {
    if (fall_frame !== 44 || distance_to_edge_weight() >= 6) {
      g.Char.x = byteOf(char_dx_forward(-1));
    } else {
      l5.seqtbl_offset_char.fn(seqids.seq_104_start_fall_in_front_of_wall);
      play_seq();
    }
    load_fram_det_col();
  }
}

// seg006:0A19
export function check_grab(): void {
  const MAX_GRAB_FALLING_SPEED = 32;
  if (g.control_shift === CONTROL_HELD
    && g.Char.fall_y < MAX_GRAB_FALLING_SPEED
    && g.Char.alive < 0
    && wordOf(y_land[g.Char.curr_row + 1]) <= wordOf(g.Char.y + 25)
  ) {
    const old_x = g.Char.x;
    g.Char.x = byteOf(char_dx_forward(-8));
    load_fram_det_col();
    if (!can_grab_front_above()) {
      g.Char.x = old_x;
    } else {
      g.Char.x = byteOf(char_dx_forward(distance_to_edge_weight()));
      g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
      g.Char.fall_y = 0;
      l5.seqtbl_offset_char.fn(seqids.seq_15_grab_ledge_midair);
      play_seq();
      g.grab_timer = 12;
      out.play_sound(soundids.sound_9_grab);
      g.is_screaming = 0;
    }
  }
}

// seg006:0AA8
export function can_grab_front_above(): number {
  through_tile = get_tile_above_char();
  get_tile_front_above_char();
  return can_grab();
}

// seg006:0ACD
export function in_wall(): void {
  let delta_x = distance_to_edge_weight();
  if (delta_x >= 8 || get_tile_infrontof_char() === tiles.tiles_20_wall) {
    delta_x = 6 - delta_x;
  } else {
    delta_x += 4;
  }
  g.Char.x = byteOf(char_dx_forward(delta_x));
  load_fram_det_col();
  get_tile_at_char();
}

// seg006:0B0C
export function get_tile_infrontof_char(): number {
  infrontx = dir_front[g.Char.direction + 1] + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row);
}

// seg006:0B30
export function get_tile_infrontof2_char(): number {
  const direction = dir_front[g.Char.direction + 1];
  infrontx = (direction << 1) + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row);
}

// seg006:0B66
export function get_tile_behind_char(): number {
  return get_tile(g.Char.room, dir_behind[g.Char.direction + 1] + g.Char.curr_col, g.Char.curr_row);
}

// seg006:0B8A
export function distance_to_edge_weight(): number {
  return distance_to_edge(dx_weight());
}

// seg006:0B94
export function distance_to_edge(xpos: number): number {
  get_tile_div_mod_m7(xpos);
  let distance = obj_xl;
  if (g.Char.direction === directions.dir_0_right) distance = TILE_RIGHTX - distance;
  return distance;
}

// seg006:0BC4
export function fell_out(): void {
  if (g.Char.alive < 0 && g.Char.room === 0) {
    take_hp(100);
    g.Char.alive = 0;
    out.erase_bottom_text(1);
    g.Char.frame = frameids.frame_185_dead;
  }
}

// seg006:0CD1 -- the part of `control_kid` that is not the demo or the menu.
export function control_kid(): void {
  if (g.Char.alive < 0 && g.hitp_curr === 0) g.Char.alive = 0;
  if (g.grab_timer !== 0) --g.grab_timer;
  read_user_control();
  user_control();
}

// seg006:0D3E
export function play_guard(): void {
  if (g.Char.charid === charids.charid_24_mouse) {
    l2.autocontrol_opponent.fn();
    return;
  }
  if (g.Char.alive < 0) {
    if (g.guardhp_curr === 0) {
      g.Char.alive = 0;
      l2.on_guard_killed.fn();
      return;
    }
  } else if (g.Char.charid === charids.charid_1_shadow) {
    l2.clear_char.fn();
  }
  l2.autocontrol_opponent.fn();
  l5.control.fn();
}

// seg006:0DC0
export function user_control(): void {
  if (g.Char.direction >= directions.dir_0_right) {
    flip_control_x();
    l5.control.fn();
    flip_control_x();
  } else {
    l5.control.fn();
  }
}

// seg006:0DDC
export function flip_control_x(): void {
  g.control_x = -g.control_x;
  const temp = g.control_forward;
  g.control_forward = g.control_backward;
  g.control_backward = temp;
}

// seg006:0E00
export function release_arrows(): number {
  g.control_backward = CONTROL_RELEASED;
  g.control_forward = CONTROL_RELEASED;
  g.control_up = CONTROL_RELEASED;
  g.control_down = CONTROL_RELEASED;
  return 1;
}

// seg006:0E12
export function save_ctrl_1(): void {
  g.ctrl1_forward = g.control_forward;
  g.ctrl1_backward = g.control_backward;
  g.ctrl1_up = g.control_up;
  g.ctrl1_down = g.control_down;
  g.ctrl1_shift2 = g.control_shift2;
}

// seg006:0E31
export function rest_ctrl_1(): void {
  g.control_forward = g.ctrl1_forward;
  g.control_backward = g.ctrl1_backward;
  g.control_up = g.ctrl1_up;
  g.control_down = g.ctrl1_down;
  g.control_shift2 = g.ctrl1_shift2;
}

// seg006:0E8E
export function clear_saved_ctrl(): void {
  g.ctrl1_forward = CONTROL_RELEASED;
  g.ctrl1_backward = CONTROL_RELEASED;
  g.ctrl1_up = CONTROL_RELEASED;
  g.ctrl1_down = CONTROL_RELEASED;
  g.ctrl1_shift2 = CONTROL_RELEASED;
}

// seg006:0EAF
export function read_user_control(): void {
  if (g.control_forward >= CONTROL_RELEASED) {
    if (g.control_x === CONTROL_HELD_FORWARD) {
      if (g.control_forward === CONTROL_RELEASED) g.control_forward = CONTROL_HELD;
    } else {
      g.control_forward = CONTROL_RELEASED;
    }
  }
  if (g.control_backward >= CONTROL_RELEASED) {
    if (g.control_x === CONTROL_HELD_BACKWARD) {
      if (g.control_backward === CONTROL_RELEASED) g.control_backward = CONTROL_HELD;
    } else {
      g.control_backward = CONTROL_RELEASED;
    }
  }
  if (g.control_up >= CONTROL_RELEASED) {
    if (g.control_y === CONTROL_HELD_UP) {
      if (g.control_up === CONTROL_RELEASED) g.control_up = CONTROL_HELD;
    } else {
      g.control_up = CONTROL_RELEASED;
    }
  }
  if (g.control_down >= CONTROL_RELEASED) {
    if (g.control_y === CONTROL_HELD_DOWN) {
      if (g.control_down === CONTROL_RELEASED) g.control_down = CONTROL_HELD;
    } else {
      g.control_down = CONTROL_RELEASED;
    }
  }
  if (g.control_shift2 >= CONTROL_RELEASED) {
    if (g.control_shift === CONTROL_HELD) {
      if (g.control_shift2 === CONTROL_RELEASED) g.control_shift2 = CONTROL_HELD;
    } else {
      g.control_shift2 = CONTROL_RELEASED;
    }
  }
}

// seg006:0F55
export function can_grab(): number {
  const modifier = g.curr_room_modif[g.curr_tilepos];
  if (through_tile === tiles.tiles_20_wall) return 0;
  if (through_tile === tiles.tiles_12_doortop && g.Char.direction >= directions.dir_0_right) return 0;
  if (tile_is_floor(through_tile)) return 0;
  if (g.curr_tile2 === tiles.tiles_11_loose && modifier !== 0) return 0;
  if (g.curr_tile2 === tiles.tiles_7_doortop_with_floor
    && g.Char.direction < directions.dir_0_right) return 0;
  if (!tile_is_floor(g.curr_tile2)) return 0;
  return 1;
}

// seg006:0FC3
export function wall_type(tiletype: number): number {
  switch (tiletype) {
    case tiles.tiles_4_gate:
    case tiles.tiles_7_doortop_with_floor:
    case tiles.tiles_12_doortop:
      return 1; // wall at right
    case tiles.tiles_13_mirror:
      return 2; // wall at left
    case tiles.tiles_18_chomper:
      return 3; // chomper at left
    case tiles.tiles_20_wall:
      return 4; // wall at both sides
    default:
      return 0;
  }
}

// seg006:1005
export function get_tile_above_char(): number {
  return get_tile(g.Char.room, g.Char.curr_col, g.Char.curr_row - 1);
}

// seg006:1020
export function get_tile_behind_above_char(): number {
  return get_tile(g.Char.room, dir_behind[g.Char.direction + 1] + g.Char.curr_col, g.Char.curr_row - 1);
}

// seg006:1049
export function get_tile_front_above_char(): number {
  infrontx = dir_front[g.Char.direction + 1] + g.Char.curr_col;
  return get_tile(g.Char.room, infrontx, g.Char.curr_row - 1);
}

// seg006:1072
export function back_delta_x(delta_x: number): number {
  return g.Char.direction < directions.dir_0_right ? delta_x : -delta_x;
}

// seg006:108A
export function do_pickup(obj_type: number): void {
  g.pickup_obj_type = obj_type;
  g.control_shift2 = CONTROL_IGNORE;
  g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
  g.curr_room_modif[g.curr_tilepos] = 0;
  g.redraw_height = 35;
  l8.set_wipe.fn(g.curr_tilepos, 1);
  l8.set_redraw_full.fn(g.curr_tilepos, 1);
}

// seg006:10E6
export function check_press(): void {
  const frame = g.Char.frame;
  const action = g.Char.action;
  if ((frame >= frameids.frame_87_hanging_1 && frame < 100)
    || (frame >= frameids.frame_135_climbing_1 && frame < frameids.frame_141_climbing_7)) {
    get_tile_above_char();
  } else if (action === actions.actions_7_turn || action === actions.actions_5_bumped
    || action < actions.actions_2_hang_climb) {
    if (frame === frameids.frame_79_jumphang
      && get_tile_above_char() === tiles.tiles_11_loose) {
      l7.make_loose_fall.fn(1);
      return;
    }
    if (!(g.cur_frame.flags & frame_flags.FRAME_NEEDS_FLOOR)) return;
    get_tile_at_char();
  } else {
    return;
  }
  if (g.curr_tile2 === tiles.tiles_15_opener || g.curr_tile2 === tiles.tiles_6_closer) {
    if (g.Char.alive < 0) l7.trigger_button.fn(1, 0, -1);
    else l2.died_on_button.fn();
  } else if (g.curr_tile2 === tiles.tiles_11_loose) {
    g.is_guard_notice = 1;
    l7.make_loose_fall.fn(1);
  }
}

// seg006:1199
export function check_spike_below(): void {
  const right_col = get_tile_div_mod_m7(g.char_x_right);
  if (right_col < 0) return;
  const room = g.Char.room;
  for (let col = get_tile_div_mod_m7(g.char_x_left); col <= right_col; ++col) {
    let row = g.Char.curr_row;
    let not_finished: boolean;
    do {
      not_finished = false;
      if (get_tile(room, col, row) === tiles.tiles_2_spike) {
        l7.start_anim_spike.fn(g.curr_room, g.curr_tilepos);
      } else if (!tile_is_floor(g.curr_tile2) && g.curr_room !== 0 && room === g.curr_room) {
        ++row;
        not_finished = true;
      }
    } while (not_finished);
  }
}

// seg006:1231
export function clip_char(): void {
  const frame = g.Char.frame;
  const action = g.Char.action;
  const room = g.Char.room;
  const row = g.Char.curr_row;
  reset_obj_clip();
  if (frame >= frameids.frame_224_exit_stairs_8 && frame < 229) {
    g.obj_clip_top = g.leveldoor_ybottom + 1;
    g.obj_clip_right = g.leveldoor_right;
    return;
  }
  if (get_tile(room, g.char_col_left, g.char_top_row) === tiles.tiles_20_wall
    || tile_is_floor(g.curr_tile2)) {
    if ((action === actions.actions_0_stand
      && (frame === frameids.frame_79_jumphang || frame === frameids.frame_81_hangdrop_1))
      || get_tile(room, g.char_col_right, g.char_top_row) === tiles.tiles_20_wall
      || tile_is_floor(g.curr_tile2)) {
      const clip_row = row + 1;
      const clip_y = y_clip[clip_row];
      if (clip_row === 1 || (clip_y < g.obj_y && clip_y - 15 < g.char_top_y)) {
        g.char_top_y = clip_y;
        g.obj_clip_top = clip_y;
      }
    }
  }
  const col = get_tile_div_mod(g.char_x_left_coll - 4);
  if (get_tile(room, col + 1, row) === tiles.tiles_7_doortop_with_floor
    || g.curr_tile2 === tiles.tiles_12_doortop) {
    g.obj_clip_right = (g.tile_col << 5) + 32;
  } else if ((get_tile(room, col, row) !== tiles.tiles_7_doortop_with_floor
      && g.curr_tile2 !== tiles.tiles_12_doortop)
    || action === actions.actions_3_in_midair
    || (action === actions.actions_4_in_freefall && frame === frameids.frame_106_fall)
    || (action === actions.actions_5_bumped && frame === frameids.frame_107_fall_land_1)) {
    // nothing is clipped
  } else {
    g.obj_clip_right = (g.tile_col << 5) + 32;
  }
}

// seg006:13D3
export function stuck_lower(): void {
  if (get_tile_at_char() === tiles.tiles_5_stuck) ++g.Char.y;
}

// seg006:13F3
export function set_objtile_at_char(): void {
  const char_frame = g.Char.frame;
  const char_action = g.Char.action;
  if (char_action === actions.actions_1_run_jump) {
    g.tile_row = g.char_bottom_row;
    g.tile_col = g.char_col_left;
  } else {
    g.tile_row = g.Char.curr_row;
    g.tile_col = g.Char.curr_col;
  }
  if ((char_frame >= frameids.frame_135_climbing_1 && char_frame < 149)
    || char_action === actions.actions_2_hang_climb
    || char_action === actions.actions_3_in_midair
    || char_action === actions.actions_4_in_freefall
    || char_action === actions.actions_6_hang_straight) {
    --g.tile_col;
  }
  g.obj_tilepos = get_tilepos_nominus(g.tile_col, g.tile_row);
}

/** `seg006:1463`, as far as the port's levels need it. */
export function proc_get_object(): void {
  if (g.Char.charid !== charids.charid_0_kid || g.pickup_obj_type === 0) return;
  if (g.pickup_obj_type === -1) {
    g.have_sword = -1;
    out.play_sound(soundids.sound_37_victory);
    g.flash_color = 14; // bright yellow
    g.flash_time = 8;
  } else {
    switch (g.pickup_obj_type) {
      case 1: // health
        if (g.hitp_curr !== g.hitp_max) {
          out.stop_sounds();
          out.play_sound(soundids.sound_33_small_potion);
          g.hitp_delta = 1;
          g.flash_color = 4; // red
          g.flash_time = 2;
        }
        break;
      case 2: // life
        out.stop_sounds();
        out.play_sound(soundids.sound_30_big_potion);
        g.flash_color = 4;
        g.flash_time = 4;
        g.hitp_max++;
        g.hitp_delta = g.hitp_max;
        break;
      case 3: // feather
        g.is_feather_fall = 1;
        g.flash_color = 2; // green
        g.flash_time = 3;
        out.stop_sounds();
        out.play_sound(soundids.sound_39_low_weight);
        break;
      case 4: // poison
        out.stop_sounds();
        out.play_sound(soundids.sound_38_blink);
        g.flash_color = 15; // white
        g.flash_time = 5;
        take_hp(1);
        break;
      default:
        break;
    }
  }
  g.pickup_obj_type = 0;
}

// seg006:1599
export function is_dead(): boolean {
  return g.Char.frame >= frameids.frame_177_spiked
    && (g.Char.frame <= frameids.frame_178_chomped
      || g.Char.frame === frameids.frame_185_dead);
}

// seg006:2448
export function load_frame_to_obj(): void {
  const chtab_base = chtabs.id_chtab_2_kid;
  reset_obj_clip();
  load_frame();
  g.obj_direction = g.Char.direction;
  g.obj_id = g.cur_frame.image;
  g.obj_chtab = chtab_base + (g.cur_frame.sword >> 6);
  g.obj_x = (char_dx_forward(g.cur_frame.dx) << 1) - 116;
  g.obj_y = g.cur_frame.dy + g.Char.y;
  if (sbyteOf(g.cur_frame.flags ^ g.obj_direction) >= 0) ++g.obj_x;
}

/** The C leaves `Char` itself in a global; this is for the adapter. */
export function charOf(which: 'Kid' | 'Guard'): CharType {
  return which === 'Kid' ? g.Kid : g.Guard;
}
