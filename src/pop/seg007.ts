/**
 * `seg007.c`: the tiles that move, and the floors that fall out of them.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. The torches, the potions, the
 * spikes, the chompers, the gates and the level door are "trobs" --
 * tile robots -- each one a room, a tile and a type, stepped once a
 * tick by `process_trobs`. A loose floor that has let go becomes a
 * "mob" instead and falls under `do_mobs`.
 *
 * Every `#ifdef FIX_` and `#ifdef USE_` branch takes the side the
 * unmodified game is on.
 */
import { g, byteOf, sbyteOf, roomLinksOf } from './state.ts';
import {
  tbl_line, y_loose_land, loose_sound, y_something, gate_close_speeds,
  door_delta, leveldoor_close_speeds, y_land,
} from './data.ts';
import { tiles, soundids, frameids, seqids, actions } from './types.ts';
import {
  get_tile, loadkid, savekid, take_hp, char_dx_forward, get_tile_behind_char,
  y_to_row_mod4, get_tilepos, get_tilepos_nominus,
} from './seg006.ts';
import { l5, l8, out } from './link.ts';
import { prandom } from './seg009.ts';

const TROBS_MAX = 30;
const MOBS_MAX = 14;

let last_loose_sound = 0;
let curmob_index = 0;
let curr_tile_temp = 0;

/** `tbl_level_type`: 0 dungeon, 1 palace. Set when a level is built. */
export const levelType = { of: (_level: number): number => 0 };

// seg007:0000
/**
 * A dead end, measured, so that it is not tried again.
 *
 * Two runs part company by one tick on a tile that was just set
 * going -- `b4ff4672`'s gate at 251 and `9b60bf3a`'s loose floor at
 * 83 -- and in both the port's tile is a tick ahead of the capture's.
 * The obvious cure is to let a trob sit out the first tick after it
 * is added. Tried: marking a new trob here and skipping its first
 * animation takes the suite from 14019 ticks of 16599 to **10982**.
 * `probeF` alone falls from 1193 to 65. Every chomper, torch, gate
 * and spike in the game is a trob, and they are all right as they
 * are.
 *
 * So whatever is a tick out in those two runs is in the tick the
 * trob is *added*, not in how it is animated afterwards.
 */
export function process_trobs(): void {
  let need_delete = false;
  if (g.trobs_count === 0) return;
  for (let index = 0; index < g.trobs_count; ++index) {
    g.trob = { ...g.trobs[index] };
    animate_tile();
    g.trobs[index].type = g.trob.type;
    if (g.trob.type < 0) need_delete = true;
  }
  if (need_delete) {
    let new_index = 0;
    for (let index = 0; index < g.trobs_count; ++index) {
      if (g.trobs[index].type >= 0) {
        g.trobs[new_index] = g.trobs[index];
        new_index++;
      }
    }
    g.trobs_count = new_index;
  }
}

// seg007:00AF
export function animate_tile(): void {
  l8.get_room_address.fn(g.trob.room);
  switch (get_curr_tile(g.trob.tilepos)) {
    case tiles.tiles_19_torch:
    case tiles.tiles_30_torch_with_debris:
      animate_torch();
      break;
    case tiles.tiles_6_closer:
    case tiles.tiles_15_opener:
      animate_button();
      break;
    case tiles.tiles_2_spike:
      animate_spike();
      break;
    case tiles.tiles_11_loose:
      animate_loose();
      break;
    case tiles.tiles_0_empty:
      animate_empty();
      break;
    case tiles.tiles_18_chomper:
      animate_chomper();
      break;
    case tiles.tiles_4_gate:
      animate_door();
      break;
    case tiles.tiles_16_level_door_left:
      animate_leveldoor();
      break;
    case tiles.tiles_10_potion:
      animate_potion();
      break;
    case tiles.tiles_22_sword:
      animate_sword();
      break;
    default:
      g.trob.type = -1;
      break;
  }
  g.curr_room_modif[g.trob.tilepos] = byteOf(g.curr_modifier);
}

// seg007:0166
export function is_trob_in_drawn_room(): number {
  if (g.trob.room !== g.drawn_room) {
    g.trob.type = -1;
    return 0;
  }
  return 1;
}

// seg007:017E
export function set_redraw_anim_right(): void {
  l8.set_redraw_anim.fn(get_trob_right_pos_in_drawn_room(), 1);
}

// seg007:018C
export function set_redraw_anim_curr(): void {
  l8.set_redraw_anim.fn(get_trob_pos_in_drawn_room(), 1);
}

// seg007:019A
export function redraw_at_trob(): void {
  g.redraw_height = 63;
  const tilepos = get_trob_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
}

// seg007:01C5
export function redraw_21h(): void { g.redraw_height = 0x21; redraw_tile_height(); }
// seg007:01D0
export function redraw_11h(): void { g.redraw_height = 0x11; redraw_tile_height(); }
// seg007:01DB
export function redraw_20h(): void { g.redraw_height = 0x20; redraw_tile_height(); }

// seg007:01E6
export function draw_trob(): void {
  const tilepos = get_trob_right_pos_in_drawn_room();
  l8.set_redraw_anim.fn(tilepos, 1);
  l8.set_redraw_fore.fn(tilepos, 1);
  l8.set_redraw_anim.fn(get_trob_right_above_pos_in_drawn_room(), 1);
}

// seg007:0218
export function redraw_tile_height(): void {
  let tilepos = get_trob_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
  tilepos = get_trob_right_pos_in_drawn_room();
  set_redraw_full(tilepos, 1);
  set_wipe(tilepos, 1);
}

// seg007:0258
export function get_trob_pos_in_drawn_room(): number {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.room_A) {
    if (tilepos >= 20 && tilepos < 30) tilepos = 19 - tilepos; // 20..29 -> -1..-10
    else tilepos = 30;
  } else if (g.trob.room !== g.drawn_room) {
    tilepos = 30;
  }
  return tilepos;
}

// seg007:029D
export function get_trob_right_pos_in_drawn_room(): number {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.drawn_room) {
    if (tilepos % 10 !== 9) ++tilepos;
    else tilepos = 30;
  } else if (g.trob.room === g.room_L) {
    if (tilepos % 10 === 9) tilepos -= 9;
    else tilepos = 30;
  } else if (g.trob.room === g.room_A) {
    if (tilepos >= 20 && tilepos < 29) tilepos = 18 - tilepos; // 20..28 -> -2..-10
    else tilepos = 30;
  } else if (g.trob.room === g.room_AL && tilepos === 29) {
    tilepos = -1;
  } else {
    tilepos = 30;
  }
  return tilepos;
}

// seg007:032C
export function get_trob_right_above_pos_in_drawn_room(): number {
  let tilepos = g.trob.tilepos;
  if (g.trob.room === g.drawn_room) {
    if (tilepos % 10 !== 9) {
      if (tilepos < 10) tilepos = -(tilepos + 2); // 0..8 -> -2..-10
      else tilepos -= 9;
    } else {
      tilepos = 30;
    }
  } else if (g.trob.room === g.room_L) {
    if (tilepos === 9) tilepos = -1;
    else if (tilepos % 10 === 9) tilepos -= 19;
    else tilepos = 30;
  } else if (g.trob.room === g.room_B) {
    if (tilepos < 9) tilepos += 21;
    else tilepos = 30;
  } else if (g.trob.room === g.room_BL && tilepos === 9) {
    tilepos = 20;
  } else {
    tilepos = 30;
  }
  return tilepos;
}

// seg007:03CF
export function animate_torch(): void {
  // The rightmost column of the room to the left is on the screen too.
  if (g.trob.room === g.drawn_room
    || (g.trob.room === g.room_L && g.trob.tilepos % 10 === 9)) {
    g.curr_modifier = get_torch_frame(g.curr_modifier);
    set_redraw_anim_right();
  } else {
    g.trob.type = -1;
  }
}

// seg007:03E9
export function animate_potion(): void {
  if (g.trob.type >= 0 && is_trob_in_drawn_room()) {
    const type = g.curr_modifier & 0xf8;
    g.curr_modifier = bubble_next_frame(g.curr_modifier & 0x07) | type;
    set_redraw_anim_curr();
  }
}

// seg007:0425
export function animate_sword(): void {
  if (is_trob_in_drawn_room()) {
    --g.curr_modifier;
    if (g.curr_modifier === 0) g.curr_modifier = (prandom(255) & 0x3f) + 0x28;
    set_redraw_anim_curr();
  }
}

// seg007:0448
export function animate_chomper(): void {
  if (g.trob.type >= 0) {
    const blood = g.curr_modifier & 0x80;
    let frame = (g.curr_modifier & 0x7f) + 1;
    if (frame > 15) frame = 1;
    g.curr_modifier = blood | frame;
    if (frame === 2) out.play_sound(soundids.sound_47_chomper);
    if ((g.trob.room !== g.drawn_room
      || Math.trunc(g.trob.tilepos / 10) !== g.Kid.curr_row
      || (g.Kid.alive >= 0 && blood === 0))
      && (g.curr_modifier & 0x7f) >= 6) {
      g.trob.type = -1;
    }
  }
  if ((g.curr_modifier & 0x7f) < 6) redraw_at_trob();
}

// seg007:04D3
export function animate_spike(): void {
  if (g.trob.type >= 0) {
    if (g.curr_modifier === 0xff) return; // a disabled spike
    if (g.curr_modifier & 0x80) {
      --g.curr_modifier;
      if (g.curr_modifier & 0x7f) return;
      g.curr_modifier = 6;
    } else {
      ++g.curr_modifier;
      if (g.curr_modifier === 5) {
        g.curr_modifier = 0x8f;
      } else if (g.curr_modifier === 9) {
        g.curr_modifier = 0;
        g.trob.type = -1;
      }
    }
  }
  redraw_21h();
}

// seg007:0522
export function animate_door(): void {
  let anim_type = g.trob.type;
  if (anim_type >= 0) {
    if (anim_type >= 3) {
      // closing fast
      if (anim_type < 8) {
        ++anim_type;
        g.trob.type = anim_type;
      }
      const new_mod = g.curr_modifier - gate_close_speeds[anim_type];
      g.curr_modifier = new_mod;
      if (new_mod < 0) {
        g.curr_modifier = 0;
        g.trob.type = -1;
        out.play_sound(soundids.sound_6_gate_closing_fast);
      }
    } else if (g.curr_modifier !== 0xff) {
      g.curr_modifier = byteOf(g.curr_modifier + door_delta[anim_type]);
      if (anim_type === 0) {
        // closing
        if (g.curr_modifier !== 0) {
          if (g.curr_modifier < 188 && (g.curr_modifier & 3) === 3) {
            play_door_sound_if_visible(soundids.sound_4_gate_closing);
          }
        } else {
          gate_stop();
        }
      } else if (g.curr_modifier < 188) {
        if ((g.curr_modifier & 7) === 0) out.play_sound(soundids.sound_5_gate_opening);
      } else if (anim_type < 2) {
        // after a regular open
        g.curr_modifier = 238;
        g.trob.type = 0; // closing
        out.play_sound(soundids.sound_7_gate_stop);
      } else {
        // after a permanent open
        g.curr_modifier = 0xff;
        gate_stop();
      }
    } else {
      gate_stop();
    }
  }
  draw_trob();
}

// seg007:05E3
export function gate_stop(): void {
  g.trob.type = -1;
  play_door_sound_if_visible(soundids.sound_7_gate_stop);
}

// seg007:05F1
export function animate_leveldoor(): void {
  if (g.trob.type >= 0) {
    if (g.trob.type >= 3) {
      // closing
      ++g.trob.type;
      g.curr_modifier = byteOf(g.curr_modifier - leveldoor_close_speeds[g.trob.type - 3]);
      if (sbyteOf(g.curr_modifier) < 0) {
        g.curr_modifier = 0;
        g.trob.type = -1;
        out.play_sound(soundids.sound_14_leveldoor_closing);
      } else if (g.trob.type === 4) {
        out.play_sound(soundids.sound_15_leveldoor_sliding);
      }
    } else {
      // opening
      ++g.curr_modifier;
      if (g.curr_modifier >= 43) {
        g.trob.type = -1;
        out.stop_sounds();
        if (g.leveldoor_open === 0 || g.leveldoor_open === 2) {
          g.leveldoor_open = 1;
          if (g.current_level === 4) {
            // Special event: the mirror appears.
            get_tile(4, 4, 0);
            g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_13_mirror;
          }
        }
      } else {
        out.play_sound(soundids.sound_15_leveldoor_sliding);
      }
    }
  }
  set_redraw_anim_right();
}

// seg007:06AD
export function bubble_next_frame(curr: number): number {
  const next = curr + 1;
  return next >= 8 ? 1 : next;
}

// seg007:06CD
export function get_torch_frame(curr: number): number {
  let next = prandom(255);
  if (next !== curr) {
    if (next < 9) return next;
    next = curr;
  }
  ++next;
  if (next >= 9) next = 0;
  return next;
}

// seg007:070A
export function set_redraw_anim(tilepos: number, frames: number): void {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_anim[tilepos] = frames;
    }
  }
}

// seg007:0738
export function set_redraw2(tilepos: number, frames: number): void {
  if (tilepos < 30) {
    if (tilepos < 0) {
      // A loose floor on its way out of the room ends up at -2..-11.
      tilepos = -tilepos - 1;
      if (tilepos > 9) tilepos = 9;
      g.redraw_frames_above[tilepos] = frames;
    } else {
      g.redraw_frames2[tilepos] = frames;
    }
  }
}

// seg007:0766
export function set_redraw_floor_overlay(tilepos: number, frames: number): void {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_floor_overlay[tilepos] = frames;
    }
  }
}

// seg007:0794
export function set_redraw_full(tilepos: number, frames: number): void {
  if (tilepos < 30) {
    if (tilepos < 0) {
      ++tilepos;
      g.redraw_frames_above[-tilepos] = frames;
    } else {
      g.redraw_frames_full[tilepos] = frames;
    }
  }
}

// seg007:07C2
export function set_redraw_fore(tilepos: number, frames: number): void {
  if (tilepos < 30 && tilepos >= 0) g.redraw_frames_fore[tilepos] = frames;
}

// seg007:07DF
export function set_wipe(tilepos: number, frames: number): void {
  if (tilepos < 30 && tilepos >= 0) {
    if (g.wipe_frames[tilepos] !== 0) {
      g.redraw_height = Math.max(g.wipe_heights[tilepos], g.redraw_height);
    }
    g.wipe_heights[tilepos] = g.redraw_height;
    g.wipe_frames[tilepos] = frames;
  }
}

// seg007:081E
export function start_anim_torch(room: number, tilepos: number): void {
  g.curr_room_modif[tilepos] = prandom(8);
  add_trob(room, tilepos, 1);
}

// seg007:0847
export function start_anim_potion(room: number, tilepos: number): void {
  g.curr_room_modif[tilepos] &= 0xf8;
  g.curr_room_modif[tilepos] |= prandom(6) + 1;
  add_trob(room, tilepos, 1);
}

// seg007:087C
export function start_anim_sword(room: number, tilepos: number): void {
  g.curr_room_modif[tilepos] = prandom(0xff) & 0x1f;
  add_trob(room, tilepos, 1);
}

// seg007:08A7
export function start_anim_chomper(room: number, tilepos: number, modifier: number): void {
  const old_modifier = g.curr_room_modif[tilepos];
  if (old_modifier === 0 || old_modifier >= 6) {
    g.curr_room_modif[tilepos] = byteOf(modifier);
    add_trob(room, tilepos, 1);
  }
}

// seg007:08E3
export function start_anim_spike(room: number, tilepos: number): void {
  const old_modifier = sbyteOf(g.curr_room_modif[tilepos]);
  if (old_modifier <= 0) {
    if (old_modifier === 0) {
      add_trob(room, tilepos, 1);
      out.play_sound(soundids.sound_49_spikes);
    } else if (old_modifier !== -1) {
      // -1 (0xFF) is a spike that has been used up.
      g.curr_room_modif[tilepos] = 0x8f;
    }
  }
}

// seg007:092C
export function trigger_gate(_room: number, tilepos: number, button_type: number): number {
  const modifier = g.curr_room_modif[tilepos];
  if (button_type === tiles.tiles_15_opener) {
    if (modifier === 0xff) return -1; // permanently open
    if (modifier >= 188) {
      g.curr_room_modif[tilepos] = 238; // keep it open for a while
      return -1;
    }
    g.curr_room_modif[tilepos] = (modifier + 3) & 0xfc;
    return 1; // regular open
  }
  if (button_type === tiles.tiles_14_debris) {
    if (modifier < 188) return 2; // permanent open
    g.curr_room_modif[tilepos] = 0xff;
    return -1;
  }
  return modifier !== 0 ? 3 : -1; // close fast, or already closed
}

// seg007:0999
export function trigger_1(
  target_type: number, room: number, tilepos: number, button_type: number,
): number {
  if (target_type === tiles.tiles_4_gate) return trigger_gate(room, tilepos, button_type);
  if (target_type === tiles.tiles_16_level_door_left) {
    return g.curr_room_modif[tilepos] !== 0 ? -1 : 1;
  }
  return -1;
}

// seg007:09E5
export function do_trigger_list(index: number, button_type: number): void {
  for (;;) {
    const room = get_doorlink_room(index);
    l8.get_room_address.fn(room);
    const tilepos = get_doorlink_tile(index);
    const target_type = g.curr_room_tiles[tilepos] & 0x1f;
    const trigger_result = trigger_1(target_type, room, tilepos, button_type);
    if (trigger_result >= 0) add_trob(room, tilepos, trigger_result);
    if (get_doorlink_next(index) === 0) break;
    index++;
  }
}

// seg007:0A5A
export function add_trob(room: number, tilepos: number, type: number): void {
  if (g.trobs_count >= TROBS_MAX) return;
  g.trob = { room, tilepos, type };
  const found = find_trob();
  if (found === -1) {
    g.trobs[g.trobs_count] = { ...g.trob };
    g.trobs_count++;
  } else {
    g.trobs[found].type = g.trob.type;
  }
}

// seg007:0ACA
export function find_trob(): number {
  for (let index = 0; index < g.trobs_count; ++index) {
    if (g.trobs[index].tilepos === g.trob.tilepos && g.trobs[index].room === g.trob.room) {
      return index;
    }
  }
  return -1;
}

// seg007:0B0A
export function clear_tile_wipes(): void {
  g.redraw_frames_full.fill(0);
  g.wipe_frames.fill(0);
  g.wipe_heights.fill(0);
  g.redraw_frames_anim.fill(0);
  g.redraw_frames_fore.fill(0);
  g.redraw_frames2.fill(0);
  g.redraw_frames_floor_overlay.fill(0);
  g.tile_object_redraw.fill(0);
  g.redraw_frames_above.fill(0);
}

// seg007:0BB6
export function get_doorlink_timer(index: number): number {
  return g.level.doorlinks2[index] & 0x1f;
}

// seg007:0BCD
export function set_doorlink_timer(index: number, value: number): number {
  g.level.doorlinks2[index] &= 0xe0;
  g.level.doorlinks2[index] |= value & 0x1f;
  return g.level.doorlinks2[index];
}

// seg007:0BF2
export function get_doorlink_tile(index: number): number {
  return g.level.doorlinks1[index] & 0x1f;
}

// seg007:0C09
export function get_doorlink_next(index: number): number {
  return g.level.doorlinks1[index] & 0x80 ? 0 : 1;
}

// seg007:0C26
export function get_doorlink_room(index: number): number {
  return ((g.level.doorlinks1[index] & 0x60) >> 5)
    + ((g.level.doorlinks2[index] & 0xe0) >> 3);
}

// seg007:0C53
export function trigger_button(playsound: number, button_type: number, modifier: number): void {
  get_curr_tile(g.curr_tilepos);
  if (button_type === 0) button_type = g.curr_tile;
  if (modifier === -1) modifier = g.curr_modifier;
  const link_timer = get_doorlink_timer(modifier);
  if (link_timer !== 0x1f) {
    set_doorlink_timer(modifier, 5);
    if (link_timer < 2) {
      add_trob(g.curr_room, g.curr_tilepos, 1);
      redraw_11h();
      g.is_guard_notice = 1;
      if (playsound) out.play_sound(soundids.sound_3_button_pressed);
    }
    do_trigger_list(modifier, button_type);
  }
}

// seg007:0CD9
export function died_on_button(): void {
  let button_type = get_curr_tile(g.curr_tilepos);
  const modifier = g.curr_modifier;
  if (g.curr_tile === tiles.tiles_15_opener) {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_1_floor;
    g.curr_room_modif[g.curr_tilepos] = 0;
    button_type = tiles.tiles_14_debris; // force a permanent open
  } else {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_5_stuck;
  }
  trigger_button(1, button_type, modifier);
}

// seg007:0D3A
export function animate_button(): void {
  if (g.trob.type >= 0) {
    const timer = get_doorlink_timer(g.curr_modifier) - 1;
    set_doorlink_timer(g.curr_modifier, timer);
    if (timer < 2) {
      g.trob.type = -1;
      redraw_11h();
    }
  }
}

// seg007:0D72
export function start_level_door(room: number, tilepos: number): void {
  g.curr_room_modif[tilepos] = 43; // start fully open
  add_trob(room, tilepos, 3);
}

// seg007:0D93
export function animate_empty(): void {
  g.trob.type = -1;
  redraw_20h();
}

// seg007:0D9D
export function animate_loose(): void {
  const anim_type = g.trob.type;
  if (anim_type >= 0) {
    ++g.curr_modifier;
    if (g.curr_modifier & 0x80) {
      // just shaking
      if (g.current_level === 13) return;
      if (g.curr_modifier >= 0x84) {
        g.curr_modifier = 0;
        g.trob.type = -1;
      }
      loose_shake(g.curr_modifier ? 0 : 1);
    } else if (g.curr_modifier >= 11) {
      const room = g.trob.room;
      const tilepos = g.trob.tilepos;
      g.curr_modifier = remove_loose(room, tilepos);
      g.trob.type = -1;
      const row = Math.trunc(tilepos / 10);
      g.curmob = {
        xh: (tilepos % 10) << 2,
        y: y_loose_land[row + 1],
        room,
        speed: 0,
        type: 0,
        row,
      };
      add_mob();
    } else {
      loose_shake(0);
    }
  }
  redraw_20h();
}

// seg007:0E55
export function loose_shake(arg_0: number): void {
  if (arg_0 || loose_sound[g.curr_modifier & 0x7f]) {
    let sound_id: number;
    do {
      sound_id = prandom(2) + soundids.sound_20_loose_shake_1;
    } while (sound_id === last_loose_sound);
    // For the original's sake a roll is spent here and thrown away.
    prandom(2);
    last_loose_sound = sound_id;
    out.play_sound(sound_id);
  }
}

// seg007:0EB8
export function remove_loose(_room: number, tilepos: number): number {
  g.curr_room_tiles[tilepos] = tiles.tiles_0_empty;
  // The level's own type decides what the gap left behind looks like.
  return levelType.of(g.current_level);
}

// seg007:0ED5
/**
 * The tick a loose floor is told to go, which is one earlier here.
 *
 * Measured on `9b60bf3a`: exact to 78, 49 pixels out at 79, exact at
 * 80 to 82, 478 pixels out at 83 in the strip the falling tile
 * occupies, one tick apart from 84 to 91, and exact again at 92.
 * Eight ticks, and nothing else in the run.
 *
 * What the port does: the Prince steps on room 1's tile 26 at tick
 * 65, this adds the trob with modifier 1, `animate_loose` adds one a
 * tick, the modifier reaches 11 at tick 75 and the tile becomes a mob
 * at y 191. It falls y 2, 8, 17, 29, 44, 62, 83, 107 on speeds 3 to
 * 24 and lands at the end of 83. The capture lands at 84.
 *
 * None of the machinery is the fault -- `move_mob`, `move_loose` with
 * its row crossing, `loose_fall`, `loose_land`, `mob_down_a_row`,
 * `animate_loose` with its shake branch and its `>= 11`, this
 * function, `loose_shake` down to the roll it throws away, `add_trob`,
 * `find_trob`, `process_trobs`, and `do_mobs` before `process_trobs`
 * in `play_frame` -- all read against the C and all faithful. The two
 * callers here are the two vanilla ones; SDLPoP's other three are
 * inside `USE_JUMP_GRAB` and `USE_SUPER_HIGH_JUMP`.
 *
 * So what is left is the tick `check_press` fires on. The Prince's own
 * frames are identical on either side of it.
 */
export function make_loose_fall(modifier: number): void {
  // Is it a "solid" loose floor, which never falls?
  if ((g.curr_room_tiles[g.curr_tilepos] & 0x20) === 0) {
    if (sbyteOf(g.curr_room_modif[g.curr_tilepos]) <= 0) {
      g.curr_room_modif[g.curr_tilepos] = modifier;
      add_trob(g.curr_room, g.curr_tilepos, 0);
      redraw_20h();
    }
  }
}

// seg007:0F13
export function start_chompers(): void {
  let timing = 15;
  if (byteOf(g.Char.curr_row) < 3) {
    l8.get_room_address.fn(g.Char.room);
    let tilepos = tbl_line[g.Char.curr_row];
    for (let column = 0; column < 10; ++column, ++tilepos) {
      if (get_curr_tile(tilepos) === tiles.tiles_18_chomper) {
        const modifier = g.curr_modifier & 0x7f;
        if (modifier === 0 || modifier >= 6) {
          start_anim_chomper(g.Char.room, tilepos, timing | (g.curr_modifier & 0x80));
          timing = next_chomper_timing(timing);
        }
      }
    }
  }
}

// seg007:0F9A
export function next_chomper_timing(timing: number): number {
  // 15,12,9,6,13,10,7,14,11,8, and round again
  timing -= 3;
  if (timing < 6) timing += 10;
  return timing;
}

// seg007:0FB4
export function loose_make_shake(): void {
  if (g.curr_room_modif[g.curr_tilepos] === 0 && g.current_level !== 13) {
    g.curr_room_modif[g.curr_tilepos] = 0x80;
    add_trob(g.curr_room, g.curr_tilepos, 1);
  }
}

// seg007:0FE0
export function do_knock(room: number, tile_row: number): void {
  for (let tile_col = 0; tile_col < 10; ++tile_col) {
    if (get_tile(room, tile_col, tile_row) === tiles.tiles_11_loose) loose_make_shake();
  }
}

// seg007:1010
export function add_mob(): void {
  if (g.mobs_count >= MOBS_MAX) return;
  g.mobs[g.mobs_count] = { ...g.curmob };
  g.mobs_count++;
}

// seg007:1041
export function get_curr_tile(tilepos: number): number {
  g.curr_modifier = g.curr_room_modif[tilepos];
  g.curr_tile = g.curr_room_tiles[tilepos] & 0x1f;
  return g.curr_tile;
}

// seg007:1063
export function do_mobs(): void {
  const n_mobs = g.mobs_count;
  for (curmob_index = 0; n_mobs > curmob_index; ++curmob_index) {
    g.curmob = { ...g.mobs[curmob_index] };
    move_mob();
    check_loose_fall_on_kid();
    g.mobs[curmob_index] = { ...g.curmob };
  }
  let new_index = 0;
  for (let index = 0; index < g.mobs_count; ++index) {
    if (g.mobs[index].speed !== -1) {
      g.mobs[new_index] = g.mobs[index];
      new_index++;
    }
  }
  g.mobs_count = new_index;
}

// seg007:110F
export function move_mob(): void {
  if (g.curmob.type === 0) move_loose();
  if (g.curmob.speed <= 0) ++g.curmob.speed;
}

// seg007:1126
export function move_loose(): void {
  if (g.curmob.speed < 0) return;
  if (g.curmob.speed < 29) g.curmob.speed += 3;
  g.curmob.y += g.curmob.speed;
  if (g.curmob.room === 0) {
    if (g.curmob.y >= 210) g.curmob.speed = -2;
    return;
  }
  if (g.curmob.y < 226 && y_something[g.curmob.row + 1] <= g.curmob.y) {
    // fell into a different row
    curr_tile_temp = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
    if (curr_tile_temp === tiles.tiles_11_loose) loose_fall();
    if (curr_tile_temp === tiles.tiles_0_empty || curr_tile_temp === tiles.tiles_11_loose) {
      mob_down_a_row();
      return;
    }
    out.play_sound(soundids.sound_2_tile_crashing);
    do_knock(g.curmob.room, g.curmob.row);
    g.curmob.y = y_something[g.curmob.row + 1];
    g.curmob.speed = -2;
    loose_land();
  }
}

// seg007:11E8
export function loose_land(): void {
  let button_type = 0;
  let tiletype = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
  /**
   * The C is one `switch` with two fallthroughs, and the tile it
   * switched on is not the tile the last case tests.
   *
   * `case tiles_15_opener` falls into `case tiles_6_closer`, which
   * presses the button and then *re-reads* `tiletype`, and falls on
   * into the floor case -- which the switch has already chosen, so it
   * runs whatever the re-read says. Re-testing the new `tiletype`
   * instead, which this did, loses the whole last case for a raise
   * button: the tile was set to debris two lines earlier, the re-read
   * therefore says debris, debris is not in the list, and the
   * `redraw_at_cur_mob` never happened. A loose floor that fell on a
   * raise button left the button on the screen until something else
   * redrew the tile.
   */
  let fellThrough = false;
  if (tiletype === tiles.tiles_15_opener) {
    g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_14_debris;
    button_type = tiles.tiles_14_debris;
    fellThrough = true;
  }
  if (fellThrough || tiletype === tiles.tiles_6_closer) {
    trigger_button(1, button_type, -1);
    tiletype = get_tile(g.curmob.room, g.curmob.xh >> 2, g.curmob.row);
    fellThrough = true;
  }
  if (fellThrough
    || tiletype === tiles.tiles_1_floor || tiletype === tiles.tiles_2_spike
    || tiletype === tiles.tiles_10_potion || tiletype === tiles.tiles_19_torch
    || tiletype === tiles.tiles_30_torch_with_debris) {
    if (tiletype === tiles.tiles_19_torch || tiletype === tiles.tiles_30_torch_with_debris) {
      g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_30_torch_with_debris;
    } else {
      g.curr_room_tiles[g.curr_tilepos] = tiles.tiles_14_debris;
    }
    redraw_at_cur_mob();
    if (g.tile_col !== 0) set_redraw_full(g.curr_tilepos - 1, 1);
  }
}

// seg007:12CB
export function loose_fall(): void {
  g.curr_room_modif[g.curr_tilepos] = remove_loose(g.curr_room, g.curr_tilepos);
  g.curmob.speed >>= 1;
  g.mobs[curmob_index] = { ...g.curmob };
  g.curmob.y += 6;
  mob_down_a_row();
  add_mob();
  g.curmob = { ...g.mobs[curmob_index] };
  redraw_at_cur_mob();
}

// seg007:132C
export function redraw_at_cur_mob(): void {
  if (g.curmob.room === g.drawn_room) {
    g.redraw_height = 0x20;
    set_redraw_full(g.curr_tilepos, 1);
    set_wipe(g.curr_tilepos, 1);
    if ((g.curr_tilepos % 10) + 1 < 10) {
      set_redraw_full(g.curr_tilepos + 1, 1);
      set_wipe(g.curr_tilepos + 1, 1);
    }
  }
}

// seg007:1387
export function mob_down_a_row(): void {
  ++g.curmob.row;
  if (g.curmob.row >= 3) {
    g.curmob.y -= 192;
    g.curmob.row = 0;
    g.curmob.room = roomLinksOf(g.curmob.room).down;
  }
}

// seg007:13AE
export function draw_mobs(): void {
  for (let index = 0; index < g.mobs_count; ++index) {
    g.curmob = { ...g.mobs[index] };
    draw_mob();
  }
}

// seg007:13E5
export function draw_mob(): void {
  let ypos = g.curmob.y;
  if (g.curmob.room === g.drawn_room) {
    if (g.curmob.y >= 210) return;
  } else if (g.curmob.room === g.room_B) {
    if (Math.abs(sbyteOf(ypos)) >= 18) return;
    g.curmob.y += 192;
    ypos = g.curmob.y;
  } else if (g.curmob.room === g.room_A) {
    if (g.curmob.y < 174) return;
    ypos = g.curmob.y - 189;
  } else {
    return;
  }
  let tile_col = g.curmob.xh >> 2;
  const tile_row = y_to_row_mod4(ypos);
  g.obj_tilepos = get_tilepos_nominus(tile_col, tile_row);
  ++tile_col;
  let tilepos = get_tilepos(tile_col, tile_row);
  set_redraw2(tilepos, 1);
  set_redraw_fore(tilepos, 1);
  const top_row = y_to_row_mod4(ypos - 18);
  if (top_row !== tile_row) {
    tilepos = get_tilepos(tile_col, top_row);
    set_redraw2(tilepos, 1);
    set_redraw_fore(tilepos, 1);
  }
  add_mob_to_objtable(ypos);
}

// seg007:14DE
export function add_mob_to_objtable(ypos: number): void {
  g.objtable.push({
    obj_type: g.curmob.type | 0x80,
    xh: g.curmob.xh,
    xl: 0,
    y: ypos,
    chtab_id: 6, // id_chtab_6_environment
    id: 10,
    direction: 0,
    clip: { top: 0, bottom: 0, left: 0, right: 40 },
    tilepos: 30,
  });
  g.objtable_count = g.objtable.length;
  l8.mark_obj_tile_redraw.fn(g.objtable.length - 1);
}

// seg007:1578
export function is_spike_harmful(): number {
  const modifier = sbyteOf(g.curr_room_modif[g.curr_tilepos]);
  if (modifier === 0 || modifier === -1) return 0;
  if (modifier < 0) return 1;
  if (modifier < 5) return 2;
  return 0;
}

// seg007:1591
export function check_loose_fall_on_kid(): void {
  loadkid();
  if (g.Char.room === g.curmob.room
    && g.Char.curr_col === (g.curmob.xh >> 2)
    && g.curmob.y < g.Char.y
    && g.Char.y - 30 < g.curmob.y) {
    fell_on_your_head();
    savekid();
  }
}

// seg007:15D3
export function fell_on_your_head(): void {
  const frame = g.Char.frame;
  const action = g.Char.action;
  // A loose floor hurts a runner only on level 13.
  if ((g.current_level === 13 || frame < frameids.frame_5_start_run || frame >= 15)
    && (action < actions.actions_2_hang_climb || action === actions.actions_7_turn)) {
    g.Char.y = byteOf(y_land[g.Char.curr_row + 1]);
    if (take_hp(1)) {
      l5.seqtbl_offset_char.fn(seqids.seq_22_crushed);
      if (frame === frameids.frame_177_spiked) {
        g.Char.x = byteOf(char_dx_forward(-12));
      }
    } else if (frame !== frameids.frame_109_crouch) {
      if (get_tile_behind_char() === 0) g.Char.x = byteOf(char_dx_forward(-2));
      l5.seqtbl_offset_char.fn(seqids.seq_52_loose_floor_fell_on_kid);
    }
  }
}

// seg007:1669
export function play_door_sound_if_visible(sound_id: number): void {
  const tilepos = g.trob.tilepos;
  const gate_room = g.trob.room;
  const visible = gate_room === g.room_L
    ? tilepos % 10 === 9
    : gate_room === g.drawn_room && tilepos % 10 !== 9;
  // Special event: the gates of room 2 on level 3 are heard wherever
  // the Prince is, and the translation had only the visibility test,
  // so they closed in silence unless he happened to be looking at
  // them.
  const alwaysHeard = g.current_level === 3 && gate_room === 2;
  if (visible || alwaysHeard) out.play_sound(sound_id);
}

/** The file's own statics, back to where a fresh run has them. */
export function resetSeg007(): void {
  last_loose_sound = 0;
  curmob_index = 0;
  curr_tile_temp = 0;
}
