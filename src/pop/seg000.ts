/**
 * `seg000.c`: one tick of the game.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP, of the part of that file that is
 * the game rather than the program: `play_frame` and the three it is
 * built out of. The menus, the sound driver, the joystick and the
 * startup are the shell's business and are not here.
 *
 * The order of the calls in `play_frame` is the whole of the game's
 * timing, which is why this file is short and worth being exact
 * about.
 */
import { g, copyChar } from './state.ts';
import { tiles, charids, actions, directions, frameids, soundids } from './types.ts';
import {
  loadkid, loadkid_and_opp, savekid_and_opp, loadshad_and_opp, saveshad_and_opp,
  load_fram_det_col, play_seq, play_kid, play_guard, fell_out, is_dead,
  check_action, check_press, check_spiked, check_spike_below, take_hp,
  fall_accel, fall_speed, load_frame_to_obj, set_char_collision, control_kid,
  savekid, saveshad, get_tile,
} from './seg006.ts';
import {
  check_collisions, check_bumped, check_gate_push, check_guard_bumped,
  check_chomped_kid, check_chomped_guard, clear_coll_rooms,
} from './seg004.ts';
import {
  check_sword_hurting, check_sword_hurt, check_guard_fallout, exit_room,
  check_skel, enter_guard, check_shadow, load_room_links,
} from './seg002.ts';
import {
  check_can_guard_see_kid, check_knock, timers, check_mirror, bump_into_opponent,
} from './seg003.ts';
import {
  do_mobs, process_trobs, start_chompers, start_anim_potion, start_anim_torch,
  start_anim_sword, get_curr_tile, make_loose_fall,
} from './seg007.ts';
import { get_room_address } from './seg008.ts';
import { prandom } from './seg009.ts';
import { out } from './link.ts';

/** `different_room`: the screen has to be drawn whole this tick. */
export const screen = { different_room: 0 };

// seg000:08EB
export function play_frame(): void {
  do_mobs();
  process_trobs();
  check_skel();
  check_can_guard_see_kid();
  if (play_kid_frame()) return;
  play_guard_frame();
  if (g.resurrect_time === 0) {
    check_sword_hurting();
    check_sword_hurt();
  }
  check_sword_vs_sword();
  do_delta_hp();
  exit_room();
  check_the_end();
  check_guard_fallout();
}

// seg000:0EA8
export function play_kid_frame(): number {
  loadkid_and_opp();
  load_fram_det_col();
  check_killed_shadow();
  play_kid();
  if (g.is_restart_level) return 1;
  if (g.Char.room !== 0) {
    play_seq();
    fall_accel();
    fall_speed();
    load_frame_to_obj();
    load_fram_det_col();
    set_char_collision();
    bump_into_opponent();
    check_collisions();
    check_bumped();
    check_gate_push();
    check_action();
    check_press();
    check_spike_below();
    if (g.resurrect_time === 0) {
      check_spiked();
      check_chomped_kid();
    }
    check_knock();
  }
  savekid_and_opp();
  return 0;
}

// seg000:0F48
export function play_guard_frame(): void {
  if (g.Guard.direction !== directions.dir_56_none) {
    loadshad_and_opp();
    load_fram_det_col();
    check_killed_shadow();
    play_guard();
    if (g.Char.room === g.drawn_room) {
      play_seq();
      if (g.Char.x >= 44 && g.Char.x < 211) {
        fall_accel();
        fall_speed();
        load_frame_to_obj();
        load_fram_det_col();
        set_char_collision();
        check_guard_bumped();
        check_action();
        check_press();
        check_spike_below();
        check_spiked();
        check_chomped_guard();
      }
    }
    saveshad_and_opp();
  }
}

// seg000:0FBD
export function check_the_end(): void {
  if (g.next_room !== 0 && g.next_room !== g.drawn_room) {
    g.drawn_room = g.next_room;
    load_room_links();
    screen.different_room = 1;
    loadkid();
    anim_tile_modif();
    start_chompers();
    check_fall_flo();
    check_shadow();
  }
}

// seg000:1009
export function check_fall_flo(): void {
  // Special event: the floors of level 13 fall of their own accord.
  if (g.current_level === 13 && (g.drawn_room === 23 || g.drawn_room === 16)) {
    g.curr_room = g.room_A;
    get_room_address(g.curr_room);
    for (g.curr_tilepos = 22; g.curr_tilepos <= 27; ++g.curr_tilepos) {
      make_loose_fall(-(prandom(0xff) & 0x0f));
    }
  }
}

// seg000:0B12
export function anim_tile_modif(): void {
  for (let tilepos = 0; tilepos < 30; ++tilepos) {
    switch (get_curr_tile(tilepos)) {
      case tiles.tiles_10_potion:
        start_anim_potion(g.drawn_room, tilepos);
        break;
      case tiles.tiles_19_torch:
      case tiles.tiles_30_torch_with_debris:
        start_anim_torch(g.drawn_room, tilepos);
        break;
      case tiles.tiles_22_sword:
        start_anim_sword(g.drawn_room, tilepos);
        break;
      default:
        break;
    }
  }
  // The torches in the rightmost column of the room to the left are on
  // the screen too, so they are animated as well.
  for (let row = 0; row <= 2; row++) {
    const t = get_tile(g.room_L, 9, row);
    if (t === tiles.tiles_19_torch || t === tiles.tiles_30_torch_with_debris) {
      start_anim_torch(g.room_L, row * 10 + 9);
    }
  }
}

// seg000:1352
export function check_sword_vs_sword(): void {
  if (g.Kid.frame === 167 || g.Guard.frame === 167) {
    out.play_sound(soundids.sound_10_sword_vs_sword);
  }
}

// seg000:12C5
export function do_delta_hp(): void {
  // Level 12: a hurt shadow hurts the Prince too.
  if (g.Opp.charid === charids.charid_1_shadow && g.current_level === 12
    && g.guardhp_delta !== 0) {
    g.hitp_delta = g.guardhp_delta;
  }
  g.hitp_curr = Math.min(Math.max(g.hitp_curr + g.hitp_delta, 0), g.hitp_max);
  g.guardhp_curr = Math.min(Math.max(g.guardhp_curr + g.guardhp_delta, 0), g.guardhp_max);
}

// seg006:1931
export function check_killed_shadow(): void {
  if (g.current_level === 12) {
    if ((g.Char.charid | g.Opp.charid) === charids.charid_1_shadow
      && g.Char.alive < 0 && g.Opp.alive >= 0) {
      g.flash_color = 15;
      g.flash_time = 5;
      take_hp(100);
    }
  }
}

/**
 * `redraw_screen`, with the drawing left to the shell.
 *
 * The one thing it does that the game depends on is the last line:
 * `exit_room_timer = 2`, which holds the doorway shut for two ticks
 * after the screen has been drawn whole.
 */
export function redraw_screen(): void {
  g.exit_room_timer = 2;
}

export { copyChar, enter_guard, timers, check_mirror, clear_coll_rooms, control_kid,
  savekid, saveshad, is_dead, fell_out, actions, frameids };
