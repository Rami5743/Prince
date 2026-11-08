/**
 * `seg008.c`: the drawing.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. Every `#ifdef FIX_` and `#ifdef
 * USE_` branch takes the side the unmodified game is on, including the
 * gate-drawing bug and the one where a gate erases the corner of the
 * tile below-left of it.
 *
 * The original does not paint as it goes. It fills four tables --
 * back, mid, fore and wipe -- while it walks the room, and `draw_tables`
 * paints them in that order afterwards. That is what decides what is in
 * front of what, so the tables stay tables here.
 *
 * The pixels themselves are not translated: `blit` hands the work to
 * the port's own `Surface`, which already has the five blitters the
 * game uses and is checked against the original's own pictures.
 */
import { g, byteOf, sbyteOf, type RectType } from './state.ts';
import {
  tbl_line, col_xh, x_bump, tile_table, chtab_flip_clip,
  doortop_fram_top, door_fram_top, blueline_fram1, blueline_fram_y,
  blueline_fram3, doortop_fram_bot, spikes_fram_right, loose_fram_right,
  wall_fram_bottom, loose_fram_bottom, loose_fram_left, spikes_fram_left,
  potion_fram_bubb, chomper_fram1, chomper_fram_bot, chomper_fram_top,
  chomper_fram_y, spikes_fram_fore, chomper_fram_for, wall_fram_main,
  door_fram_slice, floor_left_overlay, sword_tbl,
} from './data.ts';
import { tiles, chtabs, blitters, directions, frameids, charids, soundids } from './types.ts';
import {
  get_tile_div_mod, reset_obj_clip, load_frame, load_frame_to_obj,
  set_char_collision, set_objtile_at_char, clip_char, stuck_lower,
  loadkid, loadshad, load_fram_det_col, obj_dx_forward, x_to_xh_and_xl,
  tile_is_floor,
} from './seg006.ts';
import { redraw_at_char, redraw_at_char2 } from './seg003.ts';
import { get_doorlink_timer, clear_tile_wipes, get_curr_tile } from './seg007.ts';
import { load_room_links } from './seg002.ts';
import { prandom } from './seg009.ts';
import { out } from './link.ts';

const TILE_SIZEX = 14;

/** What the port's renderer gives this module. */
export interface Painter {
  /** An image from a sprite bank, or null. */
  image(chtab: number, id: number): { width: number; height: number } | null;
  /** One of the game's blitters, onto the screen. */
  blit(chtab: number, id: number, x: number, y: number, blit: number): void;
  /** A solid rectangle, for `draw_wipe`. */
  rect(left: number, top: number, right: number, bottom: number, color: number): void;
  /** `set_clip_rect` / `reset_clip_rect`. */
  clip(rect: RectType | null): void;
}

let paint: Painter;
export function setPainter(p: Painter): void { paint = p; }

/** `tbl_level_type`: 0 dungeon, 1 palace. */
export const levelType = { of: (_level: number): number => 0 };

let n_curr_objs = 0;
const curr_objs: number[] = [];
let gate_top_y = 0;
let gate_openness = 0;
let gate_bottom_y = 0;

// seg008:0000
export function redraw_room(): void {
  g.table_counts.fill(0);
  g.backtable.length = 0;
  g.foretable.length = 0;
  g.midtable.length = 0;
  reset_obj_clip();
  draw_room();
  clear_tile_wipes();
}

// seg008:0125
export function draw_room(): void {
  load_leftroom();
  for (g.drawn_row = 2; g.drawn_row >= 0; g.drawn_row--) {
    load_rowbelow();
    g.draw_bottom_y = 63 * g.drawn_row + 65;
    g.draw_main_y = g.draw_bottom_y - 3;
    for (g.drawn_col = 0; g.drawn_col < 10; g.drawn_col++) {
      load_curr_and_left_tile();
      draw_tile();
    }
  }
  const saved_room = g.drawn_room;
  g.drawn_room = g.room_A;
  load_room_links();
  load_leftroom();
  g.drawn_row = 2;
  load_rowbelow();
  for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
    load_curr_and_left_tile();
    g.draw_main_y = -1;
    g.draw_bottom_y = 2;
    draw_tile_aboveroom();
  }
  g.drawn_room = saved_room;
  load_room_links();
}

// seg008:01C7
export function draw_tile(): void {
  draw_tile_floorright();
  draw_tile_anim_topright();
  draw_tile_right();
  draw_tile_anim_right();
  draw_tile_bottom(0);
  draw_loose(0);
  draw_tile_base();
  draw_tile_anim();
  draw_tile_fore();
}

// seg008:01F2
export function draw_tile_aboveroom(): void {
  draw_tile_floorright();
  draw_tile_anim_topright();
  draw_tile_right();
  draw_tile_bottom(0);
  draw_loose(0);
  draw_tile_fore();
}

// seg008:0211
export function redraw_needed(tilepos: number): void {
  if (g.wipe_frames[tilepos]) {
    --g.wipe_frames[tilepos];
    draw_tile_wipe(g.wipe_heights[tilepos]);
  }
  if (g.redraw_frames_full[tilepos]) {
    --g.redraw_frames_full[tilepos];
    draw_tile();
  } else if (g.redraw_frames_anim[tilepos]) {
    --g.redraw_frames_anim[tilepos];
    draw_tile_anim_topright();
    draw_tile_anim_right();
    draw_tile_anim();
  }
  if (g.redraw_frames2[tilepos]) {
    --g.redraw_frames2[tilepos];
    draw_other_overlay();
  } else if (g.redraw_frames_floor_overlay[tilepos]) {
    --g.redraw_frames_floor_overlay[tilepos];
    draw_floor_overlay();
  }
  if (g.tile_object_redraw[tilepos]) {
    if (g.tile_object_redraw[tilepos] === 0xff) {
      draw_objtable_items_at_tile(tilepos - 1);
    }
    draw_objtable_items_at_tile(tilepos);
    g.tile_object_redraw[tilepos] = 0;
  }
  if (g.redraw_frames_fore[tilepos]) {
    --g.redraw_frames_fore[tilepos];
    draw_tile_fore();
  }
}

// seg008:02C1
export function redraw_needed_above(column: number): void {
  if (g.redraw_frames_above[column] !== 0) {
    --g.redraw_frames_above[column];
    draw_tile_wipe(3);
    draw_tile_floorright();
    draw_tile_anim_topright();
    draw_tile_right();
    draw_tile_bottom(1);
    draw_loose(1);
    draw_tile_fore();
  }
}

// seg008:02FE
export function get_tile_to_draw(
  room: number, column: number, row: number, tile_room0: number,
): { tiletype: number; modifier: number } {
  const tilepos = tbl_line[row] + column;
  let tiletype: number;
  let modifier: number;
  if (column === -1) {
    tiletype = g.leftroom_[row].tiletype;
    modifier = g.leftroom_[row].modifier;
  } else if (room) {
    tiletype = g.curr_room_tiles[tilepos] & 0x1f;
    modifier = g.curr_room_modif[tilepos];
  } else {
    modifier = 0;
    tiletype = tile_room0;
  }
  // A button that is down is drawn as something else.
  const type = tiletype & 0x1f;
  if (type === tiles.tiles_6_closer) {
    if (get_doorlink_timer(modifier) > 1) tiletype = tiles.tiles_5_stuck;
  } else if (type === tiles.tiles_15_opener) {
    if (get_doorlink_timer(modifier) > 1) {
      modifier = 0;
      tiletype = tiles.tiles_1_floor;
    }
  }
  return { tiletype, modifier };
}

// seg008:03BB
export function load_curr_and_left_tile(): void {
  const outside = g.drawn_row === 2 ? tiles.tiles_1_floor : tiles.tiles_20_wall;
  const here = get_tile_to_draw(g.drawn_room, g.drawn_col, g.drawn_row, outside);
  g.curr_tile = here.tiletype;
  g.curr_modifier = here.modifier;
  const left = get_tile_to_draw(g.drawn_room, g.drawn_col - 1, g.drawn_row, outside);
  g.tile_left = left.tiletype;
  g.modifier_left = left.modifier;
  g.draw_xh = col_xh[g.drawn_col];
}

// seg008:041A
export function load_leftroom(): void {
  get_room_address(g.room_L);
  for (let row = 0; row < 3; ++row) {
    const t = get_tile_to_draw(g.room_L, 9, row, tiles.tiles_20_wall);
    g.leftroom_[row].tiletype = t.tiletype;
    g.leftroom_[row].modifier = t.modifier;
  }
}

// seg008:0460
export function load_rowbelow(): void {
  let row_below: number;
  let room: number;
  let room_left: number;
  if (g.drawn_row === 2) {
    room = g.room_B;
    room_left = g.room_BL;
    row_below = 0;
  } else {
    room = g.drawn_room;
    room_left = g.room_L;
    row_below = g.drawn_row + 1;
  }
  get_room_address(room);
  for (let column = 1; column < 10; ++column) {
    const t = get_tile_to_draw(room, column - 1, row_below, tiles.tiles_0_empty);
    g.row_below_left_[column].tiletype = t.tiletype;
    g.row_below_left_[column].modifier = t.modifier;
  }
  get_room_address(room_left);
  const t = get_tile_to_draw(room_left, 9, row_below, tiles.tiles_20_wall);
  g.row_below_left_[0].tiletype = t.tiletype;
  g.row_below_left_[0].modifier = t.modifier;
  get_room_address(g.drawn_room);
}

// seg008:04FA
export function draw_tile_floorright(): void {
  if (!can_see_bottomleft()) return;
  draw_tile_topright();
  if (tile_table[g.tile_left].floor_right === 0) return;
  add_backtable(chtabs.id_chtab_6_environment, 42, g.draw_xh, 0,
    tile_table[tiles.tiles_1_floor].right_y + g.draw_main_y, blitters.blitters_9_black, 1);
}

// seg008:053A
export function can_see_bottomleft(): boolean {
  return g.curr_tile === tiles.tiles_0_empty
    || g.curr_tile === tiles.tiles_9_bigpillar_top
    || g.curr_tile === tiles.tiles_12_doortop
    || g.curr_tile === tiles.tiles_26_lattice_down;
}

// seg008:055A
export function draw_tile_topright(): void {
  const tiletype = g.row_below_left_[g.drawn_col].tiletype;
  if (tiletype === tiles.tiles_7_doortop_with_floor || tiletype === tiles.tiles_12_doortop) {
    if (levelType.of(g.current_level) === 0) return;
    add_backtable(chtabs.id_chtab_6_environment,
      doortop_fram_top[g.row_below_left_[g.drawn_col].modifier],
      g.draw_xh, 0, g.draw_bottom_y, blitters.blitters_2_or, 0);
  } else if (tiletype === tiles.tiles_20_wall) {
    add_backtable(chtabs.id_chtab_7_environmentwall, 2, g.draw_xh, 0,
      g.draw_bottom_y, blitters.blitters_2_or, 0);
  } else {
    add_backtable(chtabs.id_chtab_6_environment, tile_table[tiletype].topright_id,
      g.draw_xh, 0, g.draw_bottom_y, blitters.blitters_2_or, 0);
  }
}

// seg008:05D1
export function draw_tile_anim_topright(): void {
  if ((g.curr_tile === tiles.tiles_0_empty
    || g.curr_tile === tiles.tiles_9_bigpillar_top
    || g.curr_tile === tiles.tiles_12_doortop)
    && g.row_below_left_[g.drawn_col].tiletype === tiles.tiles_4_gate) {
    add_backtable(chtabs.id_chtab_6_environment, 68, g.draw_xh, 0,
      g.draw_bottom_y, blitters.blitters_40h_mono, 0);
    let modifier = g.row_below_left_[g.drawn_col].modifier;
    if (modifier > 188) modifier = 188;
    add_backtable(chtabs.id_chtab_6_environment, door_fram_top[(modifier >> 2) % 8],
      g.draw_xh, 0, g.draw_bottom_y, blitters.blitters_2_or, 0);
  }
}

// seg008:066A
export function draw_tile_right(): void {
  if (g.curr_tile === tiles.tiles_20_wall) return;
  switch (g.tile_left) {
    case tiles.tiles_0_empty:
      if (g.modifier_left > 3) return;
      add_backtable(chtabs.id_chtab_6_environment, blueline_fram1[g.modifier_left],
        g.draw_xh, 0, blueline_fram_y[g.modifier_left] + g.draw_main_y,
        blitters.blitters_2_or, 0);
      break;
    case tiles.tiles_1_floor: {
      ptr_add_table(chtabs.id_chtab_6_environment, 42, g.draw_xh, 0,
        tile_table[g.tile_left].right_y + g.draw_main_y, blitters.blitters_10h_transp, 0);
      let num = g.modifier_left;
      if (num > 3) num = 0;
      if (num === (levelType.of(g.current_level) ? 1 : 0)) return;
      add_backtable(chtabs.id_chtab_6_environment, blueline_fram3[num], g.draw_xh, 0,
        g.draw_main_y - 20, blitters.blitters_0_no_transp, 0);
      break;
    }
    case tiles.tiles_7_doortop_with_floor:
    case tiles.tiles_12_doortop:
      if (levelType.of(g.current_level) === 0) return;
      add_backtable(chtabs.id_chtab_6_environment, doortop_fram_bot[g.modifier_left],
        g.draw_xh, 0, tile_table[g.tile_left].right_y + g.draw_main_y,
        blitters.blitters_2_or, 0);
      break;
    case tiles.tiles_20_wall:
      if (levelType.of(g.current_level) && (g.modifier_left & 0x80) === 0) {
        add_backtable(chtabs.id_chtab_6_environment, 84, g.draw_xh + 3, 0,
          g.draw_main_y - 27, blitters.blitters_0_no_transp, 0);
      }
      add_backtable(chtabs.id_chtab_7_environmentwall, 1, g.draw_xh, 0,
        tile_table[g.tile_left].right_y + g.draw_main_y, blitters.blitters_2_or, 0);
      break;
    default: {
      let id = tile_table[g.tile_left].right_id;
      if (id) {
        let blit: number;
        if (g.tile_left === tiles.tiles_5_stuck) {
          blit = blitters.blitters_10h_transp;
          if (g.curr_tile === tiles.tiles_0_empty || g.curr_tile === tiles.tiles_5_stuck
            || !tile_is_floor(g.curr_tile)) {
            id = 42;
          }
        } else {
          blit = blitters.blitters_2_or;
        }
        add_backtable(chtabs.id_chtab_6_environment, id, g.draw_xh, 0,
          tile_table[g.tile_left].right_y + g.draw_main_y, blit, 0);
      }
      if (levelType.of(g.current_level) !== 0) {
        add_backtable(chtabs.id_chtab_6_environment, tile_table[g.tile_left].stripe_id,
          g.draw_xh, 0, g.draw_main_y - 27, blitters.blitters_2_or, 0);
      }
      if (g.tile_left === tiles.tiles_19_torch
        || g.tile_left === tiles.tiles_30_torch_with_debris) {
        add_backtable(chtabs.id_chtab_6_environment, 146, g.draw_xh, 0,
          g.draw_bottom_y - 28, blitters.blitters_0_no_transp, 0);
      }
      break;
    }
  }
}

// seg008:08A0
export function get_spike_frame(modifier: number): number {
  return (modifier & 0x80) ? 5 : modifier;
}

// seg008:08B5
export function draw_tile_anim_right(): void {
  switch (g.tile_left) {
    case tiles.tiles_2_spike:
      add_backtable(chtabs.id_chtab_6_environment,
        spikes_fram_right[get_spike_frame(g.modifier_left)], g.draw_xh, 0,
        g.draw_main_y - 7, blitters.blitters_10h_transp, 0);
      break;
    case tiles.tiles_4_gate:
      draw_gate_back();
      break;
    case tiles.tiles_11_loose:
      add_backtable(chtabs.id_chtab_6_environment,
        loose_fram_right[get_loose_frame(g.modifier_left)], g.draw_xh, 0,
        g.draw_bottom_y - 1, blitters.blitters_2_or, 0);
      break;
    case tiles.tiles_16_level_door_left:
      draw_leveldoor();
      break;
    case tiles.tiles_19_torch:
    case tiles.tiles_30_torch_with_debris:
      if (g.modifier_left < 9) {
        // Images 1..9 are the flames.
        add_backtable(chtabs.id_chtab_1_flameswordpotion, g.modifier_left + 1,
          g.draw_xh + 1, 0, g.draw_main_y - 40, blitters.blitters_0_no_transp, 0);
      }
      break;
    default:
      break;
  }
}

// seg008:0971
export function draw_tile_bottom(arg_0: number): void {
  let id = 0;
  let blit: number = blitters.blitters_0_no_transp;
  let chtab_id: number = chtabs.id_chtab_6_environment;
  if (g.curr_tile === tiles.tiles_20_wall) {
    if (levelType.of(g.current_level) === 0) {
      id = wall_fram_bottom[g.curr_modifier & 0x7f];
    }
    chtab_id = chtabs.id_chtab_7_environmentwall;
  } else {
    if (g.curr_tile === tiles.tiles_12_doortop) blit = blitters.blitters_2_or;
    id = tile_table[g.curr_tile].bottom_id;
  }
  if (ptr_add_table(chtab_id, id, g.draw_xh, 0, g.draw_bottom_y, blit, 0) && arg_0) {
    add_foretable(chtab_id, id, g.draw_xh, 0, g.draw_bottom_y, blit, 0);
  }
  if (chtab_id === chtabs.id_chtab_7_environmentwall) wall_pattern(0, 0);
}

// seg008:0A38
export function draw_loose(_arg_0: number): void {
  if (g.curr_tile === tiles.tiles_11_loose) {
    const id = loose_fram_bottom[get_loose_frame(g.curr_modifier)];
    add_backtable(chtabs.id_chtab_6_environment, id, g.draw_xh, 0, g.draw_bottom_y,
      blitters.blitters_0_no_transp, 0);
    add_foretable(chtabs.id_chtab_6_environment, id, g.draw_xh, 0, g.draw_bottom_y,
      blitters.blitters_0_no_transp, 0);
  }
}

// seg008:0A8E
export function draw_tile_base(): void {
  let id: number;
  let ybottom = g.draw_main_y;
  if (g.tile_left === tiles.tiles_26_lattice_down && g.curr_tile === tiles.tiles_12_doortop) {
    id = 6; // lattice and door A
    ybottom += 3;
  } else if (g.curr_tile === tiles.tiles_11_loose) {
    id = loose_fram_left[get_loose_frame(g.curr_modifier)];
  } else if (g.curr_tile === tiles.tiles_15_opener
    && g.tile_left === tiles.tiles_0_empty
    && levelType.of(g.current_level) === 0) {
    id = 148; // the left half of a button with no floor beside it
  } else {
    id = tile_table[g.curr_tile].base_id;
  }
  ptr_add_table(chtabs.id_chtab_6_environment, id, g.draw_xh, 0,
    tile_table[g.curr_tile].base_y + ybottom, blitters.blitters_10h_transp, 0);
}

// seg008:0B2B
export function draw_tile_anim(): void {
  let pot_size = 0;
  let color = 12; // red
  switch (g.curr_tile) {
    case tiles.tiles_2_spike:
      ptr_add_table(chtabs.id_chtab_6_environment,
        spikes_fram_left[get_spike_frame(g.curr_modifier)], g.draw_xh, 0,
        g.draw_main_y - 2, blitters.blitters_10h_transp, 0);
      break;
    case tiles.tiles_10_potion:
      switch ((g.curr_modifier & 0xf8) >> 3) {
        case 0: return; // empty
        case 5:
        case 6:
          color = 9; // blue
          break;
        case 3:
        case 4:
          color = 10; // green
          pot_size = 1;
          break;
        case 2:
          pot_size = 1;
          break;
        default:
          break;
      }
      add_backtable(chtabs.id_chtab_1_flameswordpotion, 23, g.draw_xh + 3, 1,
        g.draw_main_y - (pot_size << 2) - 14, blitters.blitters_40h_mono, 0);
      add_foretable(chtabs.id_chtab_1_flameswordpotion,
        potion_fram_bubb[g.curr_modifier & 0x7], g.draw_xh + 3, 1,
        g.draw_main_y - (pot_size << 2) - 14, color + blitters.blitters_40h_mono, 0);
      break;
    case tiles.tiles_22_sword:
      add_midtable(chtabs.id_chtab_1_flameswordpotion,
        (g.curr_modifier === 1 ? 1 : 0) + 10, g.draw_xh, 0, g.draw_main_y - 3,
        blitters.blitters_10h_transp, g.curr_modifier === 1 ? 1 : 0);
      break;
    case tiles.tiles_18_chomper: {
      const chomper_num = chomper_fram1[Math.min(g.curr_modifier & 0x7f, 6)];
      add_backtable(chtabs.id_chtab_6_environment, chomper_fram_bot[chomper_num],
        g.draw_xh, 0, g.draw_main_y, blitters.blitters_10h_transp, 0);
      if (g.curr_modifier & 0x80) { // blood
        add_backtable(chtabs.id_chtab_6_environment, chomper_num + 114, g.draw_xh + 1, 4,
          g.draw_main_y - 6, blitters.blitters_4Ch_mono_12, 0);
      }
      add_backtable(chtabs.id_chtab_6_environment, chomper_fram_top[chomper_num],
        g.draw_xh, 0, g.draw_main_y - chomper_fram_y[chomper_num],
        blitters.blitters_10h_transp, 0);
      break;
    }
    default:
      break;
  }
}

// seg008:0D15
export function draw_tile_fore(): void {
  if (g.tile_left === tiles.tiles_4_gate && g.Kid.curr_row === g.drawn_row
    && g.Kid.curr_col === g.drawn_col - 1 && g.Kid.room !== g.room_R) {
    draw_gate_fore();
  }
  switch (g.curr_tile) {
    case tiles.tiles_2_spike:
      add_foretable(chtabs.id_chtab_6_environment,
        spikes_fram_fore[get_spike_frame(g.curr_modifier)], g.draw_xh, 0,
        g.draw_main_y - 2, blitters.blitters_10h_transp, 0);
      return;
    case tiles.tiles_18_chomper: {
      const chomper_num = chomper_fram1[Math.min(g.curr_modifier & 0x7f, 6)];
      add_foretable(chtabs.id_chtab_6_environment, chomper_fram_for[chomper_num],
        g.draw_xh, 0, g.draw_main_y, blitters.blitters_10h_transp, 0);
      if (g.curr_modifier & 0x80) {
        add_foretable(chtabs.id_chtab_6_environment, chomper_num + 119, g.draw_xh + 1, 4,
          g.draw_main_y - 6, blitters.blitters_4Ch_mono_12, 0);
      }
      return;
    }
    case tiles.tiles_20_wall:
      if (levelType.of(g.current_level) === 0) {
        add_foretable(chtabs.id_chtab_7_environmentwall,
          wall_fram_main[g.curr_modifier & 0x7f], g.draw_xh, 0, g.draw_main_y,
          blitters.blitters_0_no_transp, 0);
      }
      wall_pattern(1, 1);
      return;
    default:
      break;
  }
  let id = tile_table[g.curr_tile].fore_id;
  if (id === 0) return;
  if (g.curr_tile === tiles.tiles_10_potion) {
    // The big flask is for types 2, 3 and 4.
    const potion_type = (g.curr_modifier & 0xf8) >> 3;
    if (potion_type < 5 && potion_type >= 2) id = 13;
  }
  const xh = tile_table[g.curr_tile].fore_x + g.draw_xh;
  const ybottom = tile_table[g.curr_tile].fore_y + g.draw_main_y;
  if (g.curr_tile === tiles.tiles_10_potion) {
    if (levelType.of(g.current_level) !== 0) id += 2;
    add_foretable(chtabs.id_chtab_1_flameswordpotion, id, xh, 6, ybottom,
      blitters.blitters_10h_transp, 0);
  } else if ((g.curr_tile === tiles.tiles_3_pillar && levelType.of(g.current_level) === 0)
    || (g.curr_tile >= tiles.tiles_27_lattice_small
      && g.curr_tile < tiles.tiles_30_torch_with_debris)) {
    add_foretable(chtabs.id_chtab_6_environment, id, xh, 0, ybottom,
      blitters.blitters_0_no_transp, 0);
  } else {
    add_foretable(chtabs.id_chtab_6_environment, id, xh, 0, ybottom,
      blitters.blitters_10h_transp, 0);
  }
}

// seg008:0FF6
export function get_loose_frame(modifier: number): number {
  if (modifier & 0x80) {
    modifier &= 0x7f;
    if (modifier > 10) return 1;
  }
  return modifier;
}

/** `ptr_add_table`: which of the three tables the tile pieces go into. */
function ptr_add_table(
  chtab_id: number, id: number, xh: number, xl: number, ybottom: number,
  blit: number, peel: number,
): number {
  if (g.ptr_add_table === 'mid') return add_midtable(chtab_id, id, xh, xl, ybottom, blit, peel);
  if (g.ptr_add_table === 'fore') return add_foretable(chtab_id, id, xh, xl, ybottom, blit, peel);
  return add_backtable(chtab_id, id, xh, xl, ybottom, blit, peel);
}

// seg008:1000
export function add_backtable(
  chtab_id: number, id: number, xh: number, xl: number, ybottom: number,
  blit: number, _peel: number,
): number {
  if (id === 0) return 0;
  if (g.backtable.length >= 200) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  g.backtable.push({
    xh, xl, chtab_id, id: id - 1, y: ybottom - image.height + 1, blit,
  });
  g.table_counts[0] = g.backtable.length;
  return 1;
}

// seg008:1017
export function add_foretable(
  chtab_id: number, id: number, xh: number, xl: number, ybottom: number,
  blit: number, _peel: number,
): number {
  if (id === 0) return 0;
  if (g.foretable.length >= 200) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  g.foretable.push({
    xh, xl, chtab_id, id: id - 1, y: ybottom - image.height + 1, blit,
  });
  g.table_counts[1] = g.foretable.length;
  return 1;
}

// seg008:113A
export function add_midtable(
  chtab_id: number, id: number, xh: number, xl: number, ybottom: number,
  blit: number, peel: number,
): number {
  if (id === 0) return 0;
  if (g.midtable.length >= 50) return 0;
  const image = paint.image(chtab_id, id - 1);
  if (image === null) return 0;
  if (g.obj_direction === directions.dir_0_right && chtab_flip_clip[chtab_id] !== 0) {
    blit += 0x80;
  }
  g.midtable.push({
    xh, xl, chtab_id, id: id - 1, y: ybottom - image.height + 1, blit, peel,
    clip: {
      left: g.obj_clip_left, right: g.obj_clip_right,
      top: g.obj_clip_top, bottom: g.obj_clip_bottom,
    },
  });
  g.table_counts[3] = g.midtable.length;
  return 1;
}

// seg008:1254
export function add_wipetable(
  layer: number, left: number, bottom: number, height: number,
  width: number, color: number,
): void {
  if (g.wipetable.length >= 300) return;
  g.wipetable.push({ left, bottom: bottom + 1, height, width, color, layer });
  g.wipetable_count = g.wipetable.length;
}

// seg008:12BB
export function draw_table(which_table: number): void {
  const count = g.table_counts[which_table];
  for (let index = 0; index < count; ++index) {
    if (which_table === 3) draw_mid(index);
    else draw_back_fore(which_table, index);
  }
}

// seg008:12FE
export function draw_wipes(which: number): void {
  for (let index = 0; index < g.wipetable.length; ++index) {
    if (which === g.wipetable[index].layer) draw_wipe(index);
  }
}

// seg008:133B
export function draw_back_fore(which_table: number, index: number): void {
  const entry = which_table === 0 ? g.backtable[index] : g.foretable[index];
  if (!entry) return;
  draw_image(entry.chtab_id, entry.id, entry.xh * 8 + entry.xl, entry.y, entry.blit);
}

// seg008:140C
export function draw_mid(index: number): void {
  const entry = g.midtable[index];
  if (!entry) return;
  const chtab_id = entry.chtab_id;
  let xpos = entry.xh * 8 + entry.xl;
  const ypos = entry.y;
  let blit = entry.blit;
  let blit_flip = false;
  if (blit & 0x80) {
    blit_flip = true;
    blit &= 0x7f;
  }
  if (chtab_flip_clip[chtab_id]) {
    paint.clip(entry.clip);
    if (chtab_id !== chtabs.id_chtab_0_sword) xpos = calc_screen_x_coord(xpos);
  }
  if (blit_flip) {
    const image = paint.image(chtab_id, entry.id);
    xpos -= image ? image.width : 0;
    blit |= FLIPPED;
  }
  draw_image(chtab_id, entry.id, xpos, ypos, blit);
  if (chtab_flip_clip[chtab_id]) paint.clip(null);
}

/** The flag the painter reads for "draw this one mirrored". */
export const FLIPPED = 0x8000;

// seg008:167B
export function draw_image(
  chtab_id: number, id: number, xpos: number, ypos: number, blit: number,
): void {
  paint.blit(chtab_id, id, xpos, ypos, blit);
}

// seg008:1730
export function draw_wipe(index: number): void {
  const w = g.wipetable[index];
  paint.rect(w.left, w.bottom - w.height, w.left + w.width, w.bottom, w.color);
}

// seg008:178E
export function calc_gate_pos(): void {
  gate_top_y = g.draw_bottom_y - 62;
  gate_openness = (Math.min(g.modifier_left, 188) >> 2) + 1;
  gate_bottom_y = g.draw_main_y - gate_openness;
}

// seg008:17B7
export function draw_gate_back(): void {
  calc_gate_pos();
  if (gate_bottom_y + 12 < g.draw_main_y) {
    add_backtable(chtabs.id_chtab_6_environment, 50, g.draw_xh, 0, gate_bottom_y,
      blitters.blitters_0_no_transp, 0);
  } else {
    // This line erases the top-right of the tile below-left of the gate,
    // because it is drawn without transparency. The original does it and
    // so does this.
    add_backtable(chtabs.id_chtab_6_environment, tile_table[tiles.tiles_4_gate].right_id,
      g.draw_xh, 0, tile_table[tiles.tiles_4_gate].right_y + g.draw_main_y,
      blitters.blitters_0_no_transp, 0);
    // And this tries to put it back, and fails if it was a gate or a pillar.
    if (can_see_bottomleft()) draw_tile_topright();
    draw_tile_bottom(0);
    draw_loose(0);
    draw_tile_base();
    add_backtable(chtabs.id_chtab_6_environment, 51, g.draw_xh, 0, gate_bottom_y - 2,
      blitters.blitters_10h_transp, 0);
  }
  let ybottom = gate_bottom_y - 12;
  if (ybottom < 192) {
    for (; ybottom >= 0 && ybottom > 7 && ybottom - 7 > gate_top_y; ybottom -= 8) {
      add_backtable(chtabs.id_chtab_6_environment, 52, g.draw_xh, 0, ybottom,
        blitters.blitters_0_no_transp, 0);
    }
  }
  const gate_frame = ybottom - gate_top_y + 1;
  if (gate_frame > 0 && gate_frame < 9) {
    add_backtable(chtabs.id_chtab_6_environment, door_fram_slice[gate_frame],
      g.draw_xh, 0, ybottom, blitters.blitters_0_no_transp, 0);
  }
}

// seg008:18BE
export function draw_gate_fore(): void {
  calc_gate_pos();
  add_foretable(chtabs.id_chtab_6_environment, 51, g.draw_xh, 0, gate_bottom_y - 2,
    blitters.blitters_10h_transp, 0);
  let ybottom = gate_bottom_y - 12;
  if (ybottom < 192) {
    for (; ybottom >= 0 && ybottom > 7 && ybottom - 7 > gate_top_y; ybottom -= 8) {
      add_foretable(chtabs.id_chtab_6_environment, 52, g.draw_xh, 0, ybottom,
        blitters.blitters_10h_transp, 0);
    }
  }
}

// seg008:1AF8
export function draw_moving(): void {
  draw_mobs();
  draw_people();
  redraw_needed_tiles();
}

// seg008:1B06
export function redraw_needed_tiles(): void {
  load_leftroom();
  draw_objtable_items_at_tile(30);
  for (g.drawn_row = 2; g.drawn_row >= 0; g.drawn_row--) {
    load_rowbelow();
    g.draw_bottom_y = 63 * g.drawn_row + 65;
    g.draw_main_y = g.draw_bottom_y - 3;
    for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
      load_curr_and_left_tile();
      redraw_needed(tbl_line[g.drawn_row] + g.drawn_col);
    }
  }
  const saved_drawn_room = g.drawn_room;
  g.drawn_room = g.room_A;
  load_room_links();
  load_leftroom();
  g.drawn_row = 2;
  load_rowbelow();
  for (g.drawn_col = 0; g.drawn_col < 10; ++g.drawn_col) {
    load_curr_and_left_tile();
    g.draw_main_y = -1;
    g.draw_bottom_y = 2;
    redraw_needed_above(g.drawn_col);
  }
  g.drawn_room = saved_drawn_room;
  load_room_links();
  draw_objtable_items_at_tile(-1);
}

// seg008:1BCB
export function draw_tile_wipe(height: number): void {
  add_wipetable(0, g.draw_xh * 8, g.draw_bottom_y, height, 4 * 8, 0);
}

// seg008:1BEB
export function draw_tables(): void {
  draw_wipes(0);
  draw_table(0); // backtable
  draw_table(3); // midtable
  draw_wipes(1);
  draw_table(1); // foretable
}

// seg008:1DC3
export function draw_leveldoor(): void {
  const ybottom = g.draw_main_y - 13;
  g.leveldoor_right = (g.draw_xh << 3) + 48;
  if (levelType.of(g.current_level)) g.leveldoor_right += 8;
  add_backtable(chtabs.id_chtab_6_environment, 99, g.draw_xh + 1, 0, ybottom,
    blitters.blitters_0_no_transp, 0);
  if (g.modifier_left) {
    if (g.level.start_room !== g.drawn_room) {
      add_backtable(chtabs.id_chtab_6_environment, 144, g.draw_xh + 1, 0, ybottom - 4,
        blitters.blitters_0_no_transp, 0);
    } else {
      const leveldoor_width = levelType.of(g.current_level) === 0 ? 39 : 48;
      const x_low = levelType.of(g.current_level) === 0 ? 2 : 0;
      add_wipetable(0, 8 * (g.draw_xh + 1) + x_low, ybottom - 4, 45, leveldoor_width, 0);
    }
  }
  g.leveldoor_ybottom = ybottom - (g.modifier_left & 3) - 48;
  const y = ybottom - g.modifier_left;
  for (;;) {
    add_backtable(chtabs.id_chtab_6_environment, 33, g.draw_xh + 1, 0,
      g.leveldoor_ybottom, blitters.blitters_0_no_transp, 0);
    if (y > g.leveldoor_ybottom) g.leveldoor_ybottom += 4;
    else break;
  }
  add_backtable(chtabs.id_chtab_6_environment, 34, g.draw_xh + 1, 0,
    g.draw_main_y - 64, blitters.blitters_0_no_transp, 0);
}

// seg008:1E0C
export function get_room_address(room: number): void {
  g.loaded_room = room;
  if (room) {
    g.curr_room_tiles = g.level.fg.subarray((room - 1) * 30, room * 30);
    g.curr_room_modif = g.level.bg.subarray((room - 1) * 30, room * 30);
  }
}

// seg008:1E4A
export function draw_floor_overlay(): void {
  if (g.tile_left !== tiles.tiles_0_empty) return;
  if (g.curr_tile === tiles.tiles_1_floor || g.curr_tile === tiles.tiles_3_pillar
    || g.curr_tile === tiles.tiles_5_stuck || g.curr_tile === tiles.tiles_19_torch) {
    if (g.Kid.frame >= frameids.frame_137_climbing_3
      && g.Kid.frame <= frameids.frame_144_climbing_10) {
      add_midtable(chtabs.id_chtab_6_environment,
        floor_left_overlay[g.Kid.frame - 137], g.draw_xh, 0,
        (g.curr_tile === tiles.tiles_5_stuck ? 1 : 0) + g.draw_main_y,
        blitters.blitters_10h_transp, 0);
    }
    g.ptr_add_table = 'mid';
    draw_tile_bottom(0);
    g.ptr_add_table = 'back';
  } else {
    draw_other_overlay();
  }
}

// seg008:1EB5
export function draw_other_overlay(): void {
  if (g.tile_left === tiles.tiles_0_empty) {
    g.ptr_add_table = 'mid';
    draw_tile2();
  } else if (g.curr_tile !== tiles.tiles_0_empty && g.drawn_col > 0
    && get_tile_to_draw(g.drawn_room, g.drawn_col - 2, g.drawn_row,
      tiles.tiles_0_empty).tiletype === tiles.tiles_0_empty) {
    g.ptr_add_table = 'mid';
    draw_tile2();
    g.ptr_add_table = 'back';
    draw_tile2();
    g.tile_object_redraw[tbl_line[g.drawn_row] + g.drawn_col] = 0xff;
  }
  g.ptr_add_table = 'back';
}

// seg008:1F48
export function draw_tile2(): void {
  draw_tile_right();
  draw_tile_anim_right();
  draw_tile_base();
  draw_tile_anim();
  draw_tile_bottom(0);
  draw_loose(0);
}

// seg008:1F67
export function draw_objtable_items_at_tile(tilepos: number): void {
  const obj_count = g.objtable.length;
  if (!obj_count) return;
  n_curr_objs = 0;
  curr_objs.length = 0;
  for (let obj_index = obj_count - 1; obj_index >= 0; --obj_index) {
    if (g.objtable[obj_index].tilepos === tilepos) {
      curr_objs[n_curr_objs] = obj_index;
      n_curr_objs++;
    }
  }
  if (n_curr_objs) {
    sort_curr_objs();
    for (let obj_index = 0; obj_index < n_curr_objs; ++obj_index) {
      draw_objtable_item(curr_objs[obj_index]);
    }
  }
}

// seg008:1FDE
export function sort_curr_objs(): void {
  const last = n_curr_objs - 1;
  let swapped: boolean;
  do {
    swapped = false;
    for (let index = 0; index < last; ++index) {
      if (compare_curr_objs(index, index + 1)) {
        const temp = curr_objs[index];
        curr_objs[index] = curr_objs[index + 1];
        curr_objs[index + 1] = temp;
        swapped = true;
      }
    }
  } while (swapped);
}

// seg008:203C
export function compare_curr_objs(index1: number, index2: number): boolean {
  const obj_index1 = curr_objs[index1];
  if (g.objtable[obj_index1].obj_type === 1) return true;
  const obj_index2 = curr_objs[index2];
  if (g.objtable[obj_index2].obj_type === 1) return false;
  if (g.objtable[obj_index1].obj_type === 0x80
    && g.objtable[obj_index2].obj_type === 0x80) {
    return g.objtable[obj_index1].y < g.objtable[obj_index2].y;
  }
  return g.objtable[obj_index1].y > g.objtable[obj_index2].y;
}

// seg008:20CA
export function draw_objtable_item(index: number): void {
  const obj_type = load_obj_from_objtable(index);
  switch (obj_type) {
    case 0: // the Prince
    case 4: // his reflection
      if (g.obj_id === 0xff) return;
      if (g.united_with_shadow && (g.united_with_shadow % 2) === 0) {
        drawShadow();
        return;
      }
    // fallthrough
    case 2: // a guard
    case 3: // a sword
    case 5: // the hurt splash
      add_midtable(g.obj_chtab, g.obj_id + 1, g.obj_xh, g.obj_xl, g.obj_y,
        blitters.blitters_10h_transp, 1);
      break;
    case 1:
      drawShadow();
      break;
    case 0x80: // a loose floor
      g.obj_direction = directions.dir_FF_left;
      add_midtable(g.obj_chtab, loose_fram_left[g.obj_id], g.obj_xh, g.obj_xl,
        g.obj_y - 3, blitters.blitters_10h_transp, 1);
      add_midtable(g.obj_chtab, loose_fram_bottom[g.obj_id], g.obj_xh, g.obj_xl,
        g.obj_y, 0, 1);
      add_midtable(g.obj_chtab, loose_fram_right[g.obj_id], g.obj_x + 4, g.obj_xl,
        g.obj_y - 1, blitters.blitters_10h_transp, 1);
      break;
    default:
      break;
  }
}

function drawShadow(): void {
  if (g.united_with_shadow === 2) out.play_sound(soundids.sound_41_end_level_music);
  add_midtable(g.obj_chtab, g.obj_id + 1, g.obj_xh, g.obj_xl, g.obj_y,
    blitters.blitters_2_or, 1);
  add_midtable(g.obj_chtab, g.obj_id + 1, g.obj_xh, g.obj_xl + 1, g.obj_y,
    blitters.blitters_3_xor, 1);
}

// seg008:2228
export function load_obj_from_objtable(index: number): number {
  const curr_obj = g.objtable[index];
  g.obj_x = curr_obj.xh;
  g.obj_xh = curr_obj.xh;
  g.obj_xl = curr_obj.xl;
  g.obj_y = curr_obj.y;
  g.obj_id = curr_obj.id;
  g.obj_chtab = curr_obj.chtab_id;
  g.obj_direction = curr_obj.direction;
  g.obj_clip_top = curr_obj.clip.top;
  g.obj_clip_bottom = curr_obj.clip.bottom;
  g.obj_clip_left = curr_obj.clip.left;
  g.obj_clip_right = curr_obj.clip.right;
  return curr_obj.obj_type;
}

// seg008:228A
export function draw_people(): void {
  draw_kid();
  draw_guard();
  reset_obj_clip();
}

// seg008:22A2
export function draw_kid(): void {
  if (g.Kid.room !== 0 && g.Kid.room === g.drawn_room) {
    add_kid_to_objtable();
    if (g.hitp_delta < 0) draw_hurt_splash();
    add_sword_to_objtable();
  }
}

// seg008:22C9
export function draw_guard(): void {
  if (g.Guard.direction !== directions.dir_56_none && g.Guard.room === g.drawn_room) {
    add_guard_to_objtable();
    if (g.guardhp_delta < 0) draw_hurt_splash();
    add_sword_to_objtable();
  }
}

// seg008:22F0
export function add_kid_to_objtable(): void {
  loadkid();
  load_fram_det_col();
  load_frame_to_obj();
  stuck_lower();
  set_char_collision();
  set_objtile_at_char();
  redraw_at_char();
  redraw_at_char2();
  clip_char();
  add_objtable(0);
}

// seg008:2324
export function add_guard_to_objtable(): void {
  loadshad();
  load_fram_det_col();
  load_frame_to_obj();
  stuck_lower();
  set_char_collision();
  set_objtile_at_char();
  redraw_at_char();
  redraw_at_char2();
  clip_char();
  add_objtable(g.Char.charid === charids.charid_1_shadow ? 1 : 2);
}

// seg008:2388
export function add_objtable(obj_type: number): void {
  if (g.objtable.length >= 50) return;
  const { xh, xl } = x_to_xh_and_xl(g.obj_x);
  g.objtable.push({
    obj_type,
    xh,
    xl,
    y: g.obj_y,
    clip: {
      top: g.obj_clip_top, bottom: g.obj_clip_bottom,
      left: g.obj_clip_left, right: g.obj_clip_right,
    },
    chtab_id: g.obj_chtab,
    id: g.obj_id,
    direction: g.obj_direction,
    tilepos: 30,
  });
  g.objtable_count = g.objtable.length;
  mark_obj_tile_redraw(g.objtable.length - 1);
}

// seg008:2423
export function mark_obj_tile_redraw(index: number): void {
  g.objtable[index].tilepos = g.obj_tilepos;
  if (g.obj_tilepos < 30 && g.obj_tilepos >= 0) {
    g.tile_object_redraw[g.obj_tilepos] = 1;
  }
}

// seg006:1897 -- `draw_hurt_splash`, which belongs with the drawing.
export function draw_hurt_splash(): void {
  const frame = g.Char.frame;
  if (frame === frameids.frame_178_chomped) return;
  const saved = {
    x: g.obj_x, y: g.obj_y, id: g.obj_id, chtab: g.obj_chtab,
    tilepos: g.obj_tilepos, direction: g.obj_direction,
  };
  g.obj_tilepos = -1;
  if (frame === frameids.frame_185_dead
    || (frame >= frameids.frame_106_fall && frame < 111)) {
    g.obj_y += 4;
    obj_dx_forward(5);
  } else if (frame === frameids.frame_177_spiked) {
    obj_dx_forward(-5);
  } else {
    g.obj_y -= ((g.Char.charid === charids.charid_0_kid ? 1 : 0) << 2) + 11;
    obj_dx_forward(5);
  }
  if (g.Char.charid === charids.charid_0_kid) {
    g.obj_chtab = chtabs.id_chtab_2_kid;
    g.obj_id = 218; // the star
  } else {
    g.obj_chtab = chtabs.id_chtab_5_guard;
    g.obj_id = 1;
  }
  reset_obj_clip();
  add_objtable(5);
  g.obj_x = saved.x;
  g.obj_y = saved.y;
  g.obj_id = saved.id;
  g.obj_chtab = saved.chtab;
  g.obj_tilepos = saved.tilepos;
  g.obj_direction = saved.direction;
}

// seg006:1943 -- `add_sword_to_objtable`.
export function add_sword_to_objtable(): void {
  const frame = g.Char.frame;
  if ((frame >= frameids.frame_229_found_sword && frame < 238)
    || g.Char.sword !== 0
    || (g.Char.charid === charids.charid_2_guard && g.Char.alive < 0)) {
    const sword_frame = g.cur_frame.sword & 0x3f;
    if (sword_frame) {
      const entry = sword_tbl[sword_frame];
      if (entry && entry.id !== 0xff) {
        g.obj_id = entry.id;
        g.obj_x = calc_screen_x_coord(g.obj_x);
        obj_dx_forward(entry.x);
        g.obj_y += entry.y;
        g.obj_chtab = chtabs.id_chtab_0_sword;
        add_objtable(3);
      }
    }
  }
}

// seg008:2503
export function calc_screen_x_coord(logical_x: number): number {
  return Math.trunc((logical_x * 320) / 280);
}

// seg008:2749 -- the brickwork of a dungeon wall.
export function wall_pattern(which_part: number, which_table: number): void {
  const saved_sim = g.ptr_add_table;
  g.ptr_add_table = which_table === 0 ? 'back' : 'fore';
  const saved_prng_state = g.random_seed;
  // The pattern of a wall is fixed: its seed is where the tile is.
  g.random_seed = g.drawn_room + tbl_line[g.drawn_row] + g.drawn_col;
  prandom(1); // a roll is fetched and thrown away
  const middle_divider = prandom(1);
  const middle_divider_offset = prandom(4);
  const bottom_divider = prandom(1);
  const bottom_divider_offset = prandom(4);
  const RSET_WALL = chtabs.id_chtab_7_environmentwall;
  const RES_WALL_RNDBLOCK = 11;
  const RES_WALL_DIVIDER1 = 13;
  const BLIT_TRANS = blitters.blitters_10h_transp;
  const BLIT_NO_TRANS = blitters.blitters_0_no_transp;
  const bg_modifier = g.curr_modifier & 0x7f;
  if (bg_modifier === 3) {
    // walls to the left and to the right
    if (which_part !== 0) {
      if (prandom(4) === 0) {
        ptr_add_table(RSET_WALL, RES_WALL_RNDBLOCK, g.draw_xh, 0,
          g.draw_bottom_y - 42, BLIT_NO_TRANS, 0);
      }
      ptr_add_table(RSET_WALL, RES_WALL_DIVIDER1 + middle_divider, g.draw_xh + 1,
        middle_divider_offset, g.draw_bottom_y - 21, BLIT_TRANS, 0);
    }
    ptr_add_table(RSET_WALL, RES_WALL_DIVIDER1 + bottom_divider, g.draw_xh,
      bottom_divider_offset, g.draw_bottom_y, BLIT_TRANS, 0);
    if (which_part !== 0) {
      if (prandom(4) === 0) draw_right_mark(prandom(3), middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(prandom(4), middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider);
      }
    }
  } else if (bg_modifier === 0) {
    // no wall either side
    if (which_part !== 0 && prandom(6) === 0) {
      draw_left_mark(prandom(1), middle_divider_offset - middle_divider,
        bottom_divider_offset - bottom_divider);
    }
  } else if (bg_modifier === 1) {
    // a wall to the right only
    if (which_part !== 0) {
      if (prandom(4) === 0) {
        ptr_add_table(RSET_WALL, RES_WALL_RNDBLOCK, g.draw_xh, 0,
          g.draw_bottom_y - 42, BLIT_NO_TRANS, 0);
      }
      ptr_add_table(RSET_WALL, RES_WALL_DIVIDER1 + middle_divider, g.draw_xh + 1,
        middle_divider_offset, g.draw_bottom_y - 21, BLIT_TRANS, 0);
      if (prandom(4) === 0) draw_right_mark(prandom(3), middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(prandom(3), middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider);
      }
    }
  } else if (bg_modifier === 2) {
    // a wall to the left only
    if (which_part !== 0) {
      ptr_add_table(RSET_WALL, RES_WALL_DIVIDER1 + middle_divider, g.draw_xh + 1,
        middle_divider_offset, g.draw_bottom_y - 21, BLIT_TRANS, 0);
    }
    ptr_add_table(RSET_WALL, RES_WALL_DIVIDER1 + bottom_divider, g.draw_xh,
      bottom_divider_offset, g.draw_bottom_y, BLIT_TRANS, 0);
    if (which_part !== 0) {
      if (prandom(4) === 0) draw_right_mark(prandom(1) + 2, middle_divider_offset);
      if (prandom(4) === 0) {
        draw_left_mark(prandom(4), middle_divider_offset - middle_divider,
          bottom_divider_offset - bottom_divider);
      }
    }
  }
  g.random_seed = saved_prng_state;
  g.ptr_add_table = saved_sim;
}

const LPOS = [58, 41, 37, 20, 16];
const RPOS = [52, 42, 31, 21];
const RES_WALL_MARK_TL = 17;
const RES_WALL_MARK_BL = 18;
const RES_WALL_MARK_TR = 19;
const RES_WALL_MARK_BR = 20;

export function draw_left_mark(decal_variant: number, arg2: number, arg1: number): void {
  let image_id = RES_WALL_MARK_TL;
  let lv2 = 0;
  if (decal_variant % 2) image_id = RES_WALL_MARK_BL;
  if (decal_variant > 3) lv2 = arg1 + 6;
  else if (decal_variant > 1) lv2 = arg2 + 6;
  ptr_add_table(chtabs.id_chtab_7_environmentwall, image_id,
    g.draw_xh + ((decal_variant === 2 || decal_variant === 3) ? 1 : 0), lv2,
    g.draw_bottom_y - LPOS[decal_variant], blitters.blitters_10h_transp, 0);
}

export function draw_right_mark(decal_variant: number, arg1: number): void {
  let image_id = RES_WALL_MARK_TR;
  if (decal_variant % 2) image_id = RES_WALL_MARK_BR;
  ptr_add_table(chtabs.id_chtab_7_environmentwall, image_id, g.draw_xh + 3,
    decal_variant > 1 ? arg1 : 0,
    g.draw_bottom_y - RPOS[decal_variant], blitters.blitters_10h_transp, 0);
}

/** `draw_mobs` lives in seg007; linked here to avoid a cycle. */
export const mobs = { draw_mobs: (): void => {} };
function draw_mobs(): void { mobs.draw_mobs(); }

export const UNUSED = {
  get_tile_div_mod, load_frame, get_curr_tile, x_bump, byteOf, sbyteOf, TILE_SIZEX,
};
