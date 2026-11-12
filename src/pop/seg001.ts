/**
 * `seg001.c`: the cutscenes, and the story the game tells round them.
 *
 * A translation, function for function and name for name, of
 * https://github.com/NagyD/SDLPoP. What is here is the princess's
 * room -- the six between-level scenes, the hourglass when the hour
 * runs out, and the embrace at the end -- together with `show_title`
 * and `end_sequence`, which live in `seg000.c` and `seg001.c` and
 * tell the same story with the full-screen pictures of `TITLE.DAT`.
 *
 * ## How the C's blocking loops are written here
 *
 * The C plays a cutscene by blocking: `proc_cutscene_frame(n)` draws
 * a frame, spins on a timer, and comes back `n` frames later. A page
 * cannot block, so every one of these procedures is a **generator**
 * and every `proc_cutscene_frame(n)` is a `yield*` of one. What a
 * generator yields is how long to wait before it is resumed again,
 * in the original's own unit: one sixtieth of a second, which is
 * what `set_timer_length` counts. `cutscene_frame_time` is 6 of them
 * -- ten frames a second -- and `pop_wait(timer_0, 900)` is fifteen
 * seconds. `src/pop/cutscene.ts` is the driver that runs them.
 *
 * So the shape of each procedure is the C's, line for line, and only
 * the waiting is spelled differently.
 */
import { g, type RectType } from './state.ts';
import { charids, directions, blitters, chtabs, seqids, soundids } from './types.ts';
import {
  loadkid, savekid, loadshad, saveshad, loadshad_and_opp, play_seq,
  load_frame_to_obj,
} from './seg006.ts';
import { seqtbl_offset_char } from './seg005.ts';
import {
  reset_tables, add_objtable, add_backtable, add_foretable, add_midtable,
  redraw_needed_tiles, draw_tables,
} from './seg008.ts';
import { get_torch_frame, clear_tile_wipes } from './seg007.ts';
import { prandom, input_str, type StrBuffer } from './seg009.ts';
import { out } from './link.ts';
import { scr, FADE_CUTSCENE_ROWS, full_image_id } from './screen.ts';

/** What a cutscene yields: how long to wait, in sixtieths of a second. */
export type Scene = Generator<number, void, void>;

// data:4CB4
let cutscene_wait_frames = 0;
// data:3D14
export let cutscene_frame_time = 6;
// data:588C
export let disable_keys = 0;
// data:436A
let hourglass_sandflow = -1;
// data:5964
let hourglass_state = 0;
// data:4CC4
let which_torch = 0;

const N_STARS = 6;

// ---------------------------------------------------------------------------
// The hall of fame.
// ---------------------------------------------------------------------------

/** `hof_type`: twenty-five bytes of name and two shorts, packed to 29. */
export interface HofEntry { name: string; min: number; tick: number }

export const MAX_HOF_COUNT = 6;
/** One entry is `char name[25]; short min, tick;` with no padding. */
export const HOF_ENTRY_BYTES = 29;

// data:589A
export const hof: HofEntry[] = Array.from(
  { length: MAX_HOF_COUNT }, () => ({ name: '', min: 0, tick: 0 }),
);
// data:...
export let hof_count = 0;

// data:0D92
export const hof_rects: readonly RectType[] = [
  { top: 84, left: 72, bottom: 96, right: 248 },
  { top: 98, left: 72, bottom: 110, right: 248 },
  { top: 112, left: 72, bottom: 124, right: 248 },
  { top: 126, left: 72, bottom: 138, right: 248 },
  { top: 140, left: 72, bottom: 152, right: 248 },
  { top: 154, left: 72, bottom: 166, right: 248 },
];

// seg001:0FC3
/** `show_hof_text`: the text, and its black shadow a pixel down and right. */
export function show_hof_text(
  rect: RectType, x_align: number, y_align: number, text: string,
): void {
  const text_color = 0xB7; // graphics_mode == gmMcgaVga
  const shadow_color = 0;
  // `offset2_rect(&rect2, rect, 1, 1)`.
  scr.show_text(rect.left + 1, rect.top + 1, rect.right + 1, rect.bottom + 1,
    x_align, y_align, text, shadow_color);
  scr.show_text(rect.left, rect.top, rect.right, rect.bottom,
    x_align, y_align, text, text_color);
}

// seg001:0E94
/**
 * `show_hof`: the names down the left of the frame and the times down
 * the right.
 *
 * SDLPoP's `ALLOW_INFINITE_TIME` branch -- a negative `min` meaning the
 * clock ran forward from nought -- is one of its own options and not
 * the original's, so what is here is the `#else`: the branch the C
 * marks "from PoP 1.4", which turns an expired clock into `0:00`.
 */
export function show_hof(): void {
  for (let index = 0; index < hof_count; ++index) {
    const entry = hof[index]!;
    // if the time limit expired (from PoP 1.4)
    if (entry.min === 0) { entry.min = 1; entry.tick = 0; }
    const seconds = Math.trunc(entry.tick / 12);
    const time_text = `${entry.min - 1}:${String(seconds).padStart(2, '0')}`;
    show_hof_text(hof_rects[index]!, -1, 0, entry.name);
    show_hof_text(hof_rects[index]!, 1, 0, time_text);
  }
}

// seg001:0F17
/**
 * `hof_write`: `hof_count` as two bytes and then the six entries.
 *
 * The bytes are the original's exactly -- a 16-bit count, then six
 * records of twenty-five bytes of name, a 16-bit `min` and a 16-bit
 * `tick`, 176 in all -- and the one thing that is not the original's
 * is where they go: `PRINCE.HOF` beside the game's files has no
 * equivalent in a browser, so `cutscene.ts` keeps them in
 * `localStorage`.
 */
export function hof_write(): void {
  const bytes = new Uint8Array(2 + MAX_HOF_COUNT * HOF_ENTRY_BYTES);
  const dv = new DataView(bytes.buffer);
  dv.setInt16(0, hof_count, true);
  for (let i = 0; i < MAX_HOF_COUNT; i++) {
    const at = 2 + i * HOF_ENTRY_BYTES;
    const entry = hof[i]!;
    for (let c = 0; c < 25 && c < entry.name.length; c++) {
      bytes[at + c] = entry.name.charCodeAt(c) & 0xff;
    }
    dv.setInt16(at + 25, entry.min, true);
    dv.setInt16(at + 27, entry.tick, true);
  }
  scr.hof_write_file(bytes);
}

// seg001:0F6C
/** `hof_read`: and `hof_count` stays nought where there is no file. */
export function hof_read(): void {
  hof_count = 0;
  for (const entry of hof) { entry.name = ''; entry.min = 0; entry.tick = 0; }
  const bytes = scr.hof_read_file();
  if (bytes === null) return;
  if (bytes.length !== 2 + MAX_HOF_COUNT * HOF_ENTRY_BYTES) { hof_count = 0; return; }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  hof_count = dv.getInt16(0, true);
  if (hof_count < 0 || hof_count > MAX_HOF_COUNT) { hof_count = 0; return; }
  for (let i = 0; i < MAX_HOF_COUNT; i++) {
    const at = 2 + i * HOF_ENTRY_BYTES;
    let name = '';
    for (let c = 0; c < 25; c++) {
      const b = bytes[at + c]!;
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    hof[i] = { name, min: dv.getInt16(at + 25, true), tick: dv.getInt16(at + 27, true) };
  }
}

// seg001:0004
/**
 * `proc_cutscene_frame`.
 *
 * The C returns 1 when the player interrupted it and 2 when a fade
 * finished; the first is the shell's business here and the second is
 * read off `scr.fade_active()` by the one caller that cares.
 */
export function* proc_cutscene_frame(wait_frames: number): Scene {
  cutscene_wait_frames = wait_frames;
  do {
    play_both_seq();
    draw_proom_drects();
    if (g.flash_time) {
      do_flash(g.flash_color);
    }
    if (g.flash_time) {
      --g.flash_time;
      remove_flash();
    }
    // `play_next_sound`. The C queues a sound in `next_sound` and
    // plays it at the top of the next frame; this port's `play_sound`
    // goes straight to the speaker, so the queue has nothing to do.
    yield cutscene_frame_time;
    --cutscene_wait_frames;
  } while (cutscene_wait_frames);
}

// seg001:00DD
export function play_both_seq(): void {
  play_kid_seq();
  play_opp_seq();
}

// seg001:00E6
export function draw_proom_drects(): void {
  draw_princess_room_bg();
  // `while (drects_count) copy_screen_rect(...)`: the original composes
  // the room in `offscreen_surface` and copies the rectangles that
  // changed to the screen. Here the composed surface *is* the screen,
  // so the whole of it is presented and there is nothing to copy.
  scr.present();
  if (cutscene_wait_frames & 1) {
    draw_star(prandom(N_STARS - 1), 1);
  }
}

// seg001:0128
export function play_kid_seq(): void {
  loadkid();
  if (g.Char.frame) {
    play_seq();
    savekid();
  }
}

// seg001:013F
export function play_opp_seq(): void {
  // `loadshad_and_opp()`, which is `loadshad(); Opp = Kid;` -- the
  // translation had the first line and not the second.
  loadshad_and_opp();
  if (g.Char.frame) {
    play_seq();
    saveshad();
  }
}

// seg001:0156
export function draw_princess_room_bg(): void {
  reset_tables();
  loadkid();
  if (g.Char.frame) {
    load_frame_to_obj();
    g.obj_tilepos = 30;
    add_objtable(0);
  }
  loadshad();
  if (g.Char.frame) {
    load_frame_to_obj();
    g.obj_tilepos = 30;
    add_objtable(0);
  }
  // Nothing in a cutscene is a room, and `reset_cutscene` has cleared
  // every tile's redraw count, so the only thing this does here is its
  // two `draw_objtable_items_at_tile` calls -- which is what puts the
  // princess and the mouse into the mid table.
  redraw_needed_tiles();
  add_foretable(chtabs.id_chtab_8_princessroom, 2 /* pillar piece */, 30, 0, 167,
    blitters.blitters_10h_transp, 0);
  princess_room_torch();
  draw_hourglass();
  draw_tables();
}

// seg001:01E0
export function seqtbl_offset_shad_char(seq_index: number): void {
  loadshad();
  seqtbl_offset_char(seq_index);
  saveshad();
}

// seg001:01F9
export function seqtbl_offset_kid_char(seq_index: number): void {
  loadkid();
  seqtbl_offset_char(seq_index);
  savekid();
}

// seg001:0212
export function init_mouse_cu8(): void {
  init_mouse_go();
  g.Char.x = 144;
  seqtbl_offset_char(seqids.seq_106_mouse);
  play_seq();
}

// seg001:022A
export function init_mouse_go(): void {
  g.Char.charid = charids.charid_24_mouse;
  g.Char.x = 199;
  g.Char.y = 167;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_105_mouse_forward);
  play_seq();
}

// seg001:024D
export function princess_crouching(): void {
  init_princess();
  g.Char.x = 131;
  g.Char.y = 169;
  seqtbl_offset_char(seqids.seq_110_princess_crouching_PV2);
  play_seq();
}

// seg001:026A
export function princess_stand(): void {
  init_princess_right();
  g.Char.x = 144;
  g.Char.y = 169;
  seqtbl_offset_char(seqids.seq_94_princess_stand_PV1);
  play_seq();
}

// seg001:0287
export function init_princess_x156(): void {
  init_princess();
  g.Char.x = 156;
}

// seg001:0291
export function princess_lying(): void {
  init_princess();
  g.Char.x = 92;
  g.Char.y = 162;
  seqtbl_offset_char(seqids.seq_103_princess_lying_PV2);
  play_seq();
}

// seg001:02AE
export function init_princess_right(): void {
  init_princess();
  g.Char.direction = directions.dir_0_right;
}

// seg001:02B8
export function init_ending_princess(): void {
  init_princess();
  g.Char.x = 136;
  g.Char.y = 164;
  seqtbl_offset_char(seqids.seq_109_princess_stand_PV2);
  play_seq();
}

// seg001:02D5
export function init_mouse_1(): void {
  init_mouse_go();
  g.Char.x -= 2;
  g.Char.y = 164;
}

// seg001:02E4
export function init_princess(): void {
  g.Char.charid = charids.charid_5_princess;
  g.Char.x = 120;
  g.Char.y = 166;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_94_princess_stand_PV1);
  play_seq();
}

// seg001:0307
export function init_vizier(): void {
  g.Char.charid = charids.charid_6_vizier;
  g.Char.x = 198;
  g.Char.y = 166;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_95_Jaffar_stand_PV1);
  play_seq();
}

// seg001:032A
export function init_ending_kid(): void {
  g.Char.charid = charids.charid_0_kid;
  g.Char.x = 198;
  g.Char.y = 164;
  g.Char.direction = directions.dir_FF_left;
  seqtbl_offset_char(seqids.seq_1_start_run);
  play_seq();
}

// seg001:034D
export function* cutscene_8(): Scene {
  out.play_sound(soundids.sound_35_cutscene_8_9);
  set_hourglass_state(hourglass_frame());
  init_mouse_cu8();
  savekid();
  princess_crouching();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(20);
  seqtbl_offset_kid_char(seqids.seq_107_mouse_stand_up_and_go);
  yield* proc_cutscene_frame(20);
  seqtbl_offset_shad_char(seqids.seq_111_princess_stand_up_PV2);
  yield* proc_cutscene_frame(20);
  g.Kid.frame = 0;
  yield* fade_out_1();
}

// seg001:03B7
export function* cutscene_9(): Scene {
  out.play_sound(soundids.sound_35_cutscene_8_9);
  set_hourglass_state(hourglass_frame());
  princess_stand();
  saveshad();
  yield* fade_in_1();
  init_mouse_go();
  savekid();
  yield* proc_cutscene_frame(5);
  seqtbl_offset_shad_char(seqids.seq_112_princess_crouch_down_PV2);
  yield* proc_cutscene_frame(9);
  seqtbl_offset_kid_char(seqids.seq_114_mouse_stand);
  yield* proc_cutscene_frame(58);
  yield* fade_out_1();
}

// seg001:041C
export function* end_sequence_anim(): Scene {
  disable_keys = 1;
  scr.present();
  out.play_sound(soundids.sound_26_embrace);
  init_ending_princess();
  saveshad();
  init_ending_kid();
  savekid();
  yield* proc_cutscene_frame(8);
  seqtbl_offset_shad_char(seqids.seq_108_princess_turn_and_hug);
  yield* proc_cutscene_frame(5);
  seqtbl_offset_kid_char(seqids.seq_13_stop_run);
  yield* proc_cutscene_frame(2);
  g.Kid.frame = 0;
  yield* proc_cutscene_frame(39);
  init_mouse_1();
  savekid();
  yield* proc_cutscene_frame(9);
  seqtbl_offset_kid_char(seqids.seq_101_mouse_stands_up);
  yield* proc_cutscene_frame(41);
  yield* fade_out_1();
  while (out.check_sound_playing()) yield 1;
}

// seg001:04D3
export function* time_expired(): Scene {
  disable_keys = 1;
  set_hourglass_state(7);
  hourglass_sandflow = -1;
  out.play_sound(soundids.sound_36_out_of_time);
  yield* fade_in_1();
  yield* proc_cutscene_frame(2);
  yield* proc_cutscene_frame(100);
  yield* fade_out_1();
  while (out.check_sound_playing()) yield 1;
}

// seg001:0525
export function* cutscene_12(): Scene {
  const frame_num = hourglass_frame();
  if (frame_num >= 6) {
    set_hourglass_state(frame_num);
    init_princess_x156();
    saveshad();
    out.play_sound(soundids.sound_40_cutscene_12_short_time);
    yield* fade_in_1();
    yield* proc_cutscene_frame(2);
    seqtbl_offset_shad_char(98); // princess turn around [PV1]
    yield* proc_cutscene_frame(24);
    yield* fade_out_1();
  } else {
    yield* cutscene_2_6();
  }
}

// seg001:0584
export function* cutscene_4(): Scene {
  out.play_sound(soundids.sound_27_cutscene_2_4_6_12);
  set_hourglass_state(hourglass_frame());
  princess_lying();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(26);
  yield* fade_out_1();
}

// seg001:05B8
export function* cutscene_2_6(): Scene {
  out.play_sound(soundids.sound_27_cutscene_2_4_6_12);
  set_hourglass_state(hourglass_frame());
  init_princess_right();
  saveshad();
  yield* fade_in_1();
  yield* proc_cutscene_frame(26);
  yield* fade_out_1();
}

// seg001:05EC
export function* pv_scene(): Scene {
  init_princess();
  saveshad();
  yield* fade_in_1();
  init_vizier();
  savekid();
  yield* proc_cutscene_frame(2);
  out.play_sound(soundids.sound_50_story_2_princess);
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  cutscene_frame_time = 8;
  yield* proc_cutscene_frame(5);
  out.play_sound(soundids.sound_4_gate_closing);
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  out.play_sound(soundids.sound_51_princess_door_opening);
  yield* proc_cutscene_frame(3);
  seqtbl_offset_shad_char(98); // princess turn around [PV1]
  yield* proc_cutscene_frame(5);
  seqtbl_offset_kid_char(96); // Jaffar walk [PV1]
  yield* proc_cutscene_frame(6);
  out.play_sound(soundids.sound_53_story_3_Jaffar_comes);
  seqtbl_offset_kid_char(97); // Jaffar stop [PV1]
  yield* proc_cutscene_frame(4);
  yield* proc_cutscene_frame(18);
  seqtbl_offset_kid_char(96); // Jaffar walk [PV1]
  yield* proc_cutscene_frame(30);
  seqtbl_offset_kid_char(97); // Jaffar stop [PV1]
  yield* proc_cutscene_frame(35);
  seqtbl_offset_kid_char(102); // Jaffar conjuring [PV1]
  cutscene_frame_time = 7;
  yield* proc_cutscene_frame(1);
  seqtbl_offset_shad_char(99); // princess step back [PV1]
  yield* proc_cutscene_frame(17);
  hourglass_state = 1;
  g.flash_time = 5;
  g.flash_color = 15; // white
  do {
    yield* proc_cutscene_frame(1);
  } while (out.check_sound_playing());
  seqtbl_offset_kid_char(100); // Jaffar end conjuring and walk [PV1]
  hourglass_sandflow = 0;
  yield* proc_cutscene_frame(6);
  out.play_sound(soundids.sound_52_story_4_Jaffar_leaves);
  yield* proc_cutscene_frame(24);
  hourglass_state = 2;
  yield* proc_cutscene_frame(9);
  seqtbl_offset_shad_char(113); // princess look down [PV1]
  yield* proc_cutscene_frame(28);
  yield* fade_out_1();
}

// seg001:07C7
export function set_hourglass_state(state: number): void {
  hourglass_sandflow = 0;
  hourglass_state = state;
}

// data:0DEC
const time_bound = [6, 17, 33, 65] as const;

// seg001:07DA
export function hourglass_frame(): number {
  let bound_index: number;
  for (bound_index = 0; bound_index < 4; ++bound_index) {
    if (time_bound[bound_index] > g.rem_min) break;
  }
  return 6 - bound_index;
}

// data:0DF4
const princess_torch_pos_xh = [11, 26] as const;
// data:0DF8
const princess_torch_pos_xl = [5, 3] as const;
// data:0DFC
const princess_torch_frame = [1, 6];

// seg001:0808
export function princess_room_torch(): void {
  for (let which = 2; which--;) {
    which_torch = which_torch ? 0 : 1;
    princess_torch_frame[which_torch] = get_torch_frame(princess_torch_frame[which_torch]);
    add_backtable(
      chtabs.id_chtab_1_flameswordpotion, princess_torch_frame[which_torch] + 1,
      princess_torch_pos_xh[which_torch], princess_torch_pos_xl[which_torch], 116, 0, 0,
    );
  }
}

// seg001:0863
export function draw_hourglass(): void {
  if (hourglass_sandflow >= 0) {
    hourglass_sandflow = (hourglass_sandflow + 1) % 3;
    if (hourglass_state >= 7) return;
    add_foretable(chtabs.id_chtab_8_princessroom, hourglass_sandflow + 10, 20, 0, 164,
      blitters.blitters_10h_transp, 0);
  }
  if (hourglass_state) {
    add_midtable(chtabs.id_chtab_8_princessroom, hourglass_state + 2, 19, 0, 168,
      blitters.blitters_10h_transp, 1);
  }
}

// seg001:08CA
export function reset_cutscene(): void {
  g.Guard.frame = 0;
  g.Kid.frame = 0;
  which_torch = 0;
  disable_keys = 0;
  hourglass_state = 0;
  hourglass_sandflow = -1;
  cutscene_frame_time = 6;
  clear_tile_wipes();
}

// seg001:0908
/**
 * `do_flash`, and `remove_flash` after it.
 *
 * The C sets the background colour, waits two sixtieths of a second
 * and puts it back inside the same frame. A page draws once per
 * frame and has nothing in between to show that on, so the driver
 * puts the colour back at the top of the next frame instead and the
 * flash lasts the frame it was asked for -- a tenth of a second
 * rather than a thirtieth. Jaffar conjuring the hourglass in
 * `pv_scene` is the one place it happens.
 */
export function do_flash(color: number): void {
  if (color) scr.set_bg_attr(color);
}

// seg001:0981
export function remove_flash(): void {
  scr.set_bg_attr(0);
}

/**
 * `fade_in_1` and `fade_out_1`.
 *
 * The C hands the fade to `proc_cutscene_frame`, whose inner busy loop
 * steps the palette one shade at a time while the outer loop goes on
 * playing frames; the driver steps the fade on its own clock for the
 * same reason, so this is the same two loops.
 */
export function* fade_in_1(): Scene {
  scr.fade_start('in', FADE_CUTSCENE_ROWS);
  while (scr.fade_active()) {
    yield* proc_cutscene_frame(1);
  }
}

export function* fade_out_1(): Scene {
  scr.fade_start('out', FADE_CUTSCENE_ROWS);
  while (scr.fade_active()) {
    yield* proc_cutscene_frame(1);
  }
}

// data:0DC2
const stars = [
  { x: 20, y: 97, color: 0 },
  { x: 16, y: 104, color: 1 },
  { x: 23, y: 110, color: 2 },
  { x: 17, y: 116, color: 3 },
  { x: 24, y: 120, color: 4 },
  { x: 18, y: 128, color: 0 },
];
const N_STAR_COLORS = 5;
// data:0DE6
const star_colors = [8, 7, 15, 15, 7] as const;

// seg001:0E1C
export function draw_star(which_star: number, _mark_dirty: number): void {
  // The stars in the window of the princess's room.
  const star = stars[which_star];
  star.color = (star.color + 1) % N_STAR_COLORS;
  scr.rect(star.x, star.y, star.x + 1, star.y + 1, star_colors[star.color]);
}

/** Every star once, the way `load_intro` lays them down. */
export function draw_all_stars(): void {
  for (let current_star = 0; current_star < N_STARS; ++current_star) {
    draw_star(current_star, 0);
  }
}

/** `stars[].color`, which `load_intro` does not reset but a replay wants to. */
export function reset_stars(): void {
  const initial = [0, 1, 2, 3, 4, 0];
  for (let i = 0; i < stars.length; i++) stars[i].color = initial[i];
}

// data:0FA0
/**
 * `tbl_cutscenes`: which scene is played before which level.
 *
 * The index is the level about to be loaded, so level 2 and level 6
 * get the same one and levels 1, 3, 5, 7, 10, 11, 13 and 14 get none.
 */
export const tbl_cutscenes: (null | (() => Scene))[] = [
  null,
  null,
  cutscene_2_6,
  null,
  cutscene_4,
  null,
  cutscene_2_6,
  null,
  cutscene_8,
  cutscene_9,
  null,
  null,
  cutscene_12,
  null,
  null,
  null,
];

/** `cutscene_frame_time`, for the driver. */
export function frameTime(): number { return cutscene_frame_time; }

// ---------------------------------------------------------------------------
// The story round the cutscenes: the title, the ending and the hour running
// out. `end_sequence`, `expired` and `load_intro` are seg001.c's;
// `show_title` is seg000.c's and is here because it tells the same story
// out of the same two banks of pictures.
// ---------------------------------------------------------------------------

/** `start_timer(timer_0, n)`: the unit is a sixtieth of a second. */
function start_timer(length: number): number {
  return scr.now() + length;
}

/** `do_wait(timer_0)`: whatever is left of it. */
function* do_wait(deadline: number): Scene {
  const left = deadline - scr.now();
  if (left > 0) yield left;
}

/** `pop_wait(timer_0, time)`. */
function* pop_wait(time: number): Scene {
  yield* do_wait(start_timer(time));
}

// seg009:1A2E / seg009:1CC9
/**
 * `fade_in_2` and `fade_out_2`.
 *
 * Sixty-four shades, one each sixtieth of a second: `fade_in_frame`
 * ends on `do_simple_wait(1)` whatever `wait_time` says.
 */
function* fade_in_2(which_rows: number): Scene {
  scr.fade_start('in', which_rows);
  while (scr.fade_active()) yield 1;
}

function* fade_out_2(which_rows: number): Scene {
  scr.fade_start('out', which_rows);
  while (scr.fade_active()) yield 1;
}

// seg000:1BB3
/**
 * `transition_ltr`: the picture wiped on from the left, two pixels at
 * a time. SDLPoP runs it at 120 frames a second, which is half a
 * sixtieth per column.
 */
function* transition_ltr(): Scene {
  for (let position = 0; position < 320; position += 2) {
    scr.copy_screen_rect(position, 0, position + 2, 200);
    yield 0.5;
  }
}

// seg001:0CCD
export function* load_intro(
  which_imgs: number, func: () => Scene, _free_sounds: number,
): Scene {
  scr.clear_screen();
  scr.load_intro_images(which_imgs);
  scr.target(true);
  scr.blit_image(chtabs.id_chtab_8_princessroom, 0, 0, 0, 0);
  scr.blit_image(chtabs.id_chtab_9_princessbed, 0, 0, 142, blitters.blitters_2_or);
  draw_all_stars();
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  reset_cutscene();
  yield* func();
  scr.free_intro_images();
  scr.clear_screen();
}

// seg001:09D7
/**
 * `end_sequence`: the Prince reaches the princess, and then the hall
 * of fame.
 *
 * The one thing here that is not the C is where `hof_write` puts its
 * bytes: see `hof_write`.
 */
export function* end_sequence(): Scene {
  let color = 0;
  let bgcolor = 15;
  yield* load_intro(1, end_sequence_anim, 1);
  scr.clear_screen_and_sounds();
  out.play_sound(soundids.sound_56_ending_music);
  scr.load_title_images(0);
  scr.target(true);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_HAIL);
  yield* fade_in_2(0x800);
  yield* pop_wait(900);
  const timer = start_timer(240);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* transition_ltr();
  yield* do_wait(timer);
  let hof_index = 0;
  for (hof_index = 0; hof_index < hof_count; ++hof_index) {
    const entry = hof[hof_index]!;
    if (entry.min < g.rem_min
      || (entry.min === g.rem_min && entry.tick < g.rem_tick)) break;
  }
  if (hof_index < MAX_HOF_COUNT && hof_index <= hof_count) {
    yield* fade_out_2(0x1000);
    let i = 5;
    for (i = 5; hof_index + 1 <= i; --i) hof[i] = { ...hof[i - 1]! };
    hof[i] = { name: '', min: g.rem_min, tick: g.rem_tick };
    if (hof_count < MAX_HOF_COUNT) ++hof_count;
    scr.draw_full_image(full_image_id.STORY_FRAME);
    scr.draw_full_image(full_image_id.HOF_POP);
    show_hof();
    // `offset4_rect_add(&rect, &hof_rects[hof_index], -4, -1, -40, -1)`.
    const row = hof_rects[hof_index]!;
    const rect: RectType = {
      left: row.left - 4, top: row.top - 1, right: row.right - 40, bottom: row.bottom - 1,
    };
    const peel = scr.read_peel(rect.left, rect.top, rect.right, rect.bottom);
    color = 0xBE; // graphics_mode == gmMcgaVga
    bgcolor = 0xB7;
    scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
    yield* fade_in_2(0x1800);
    scr.target(false);
    const buffer: StrBuffer = { text: hof[hof_index]!.name };
    let typed = 0;
    do {
      typed = yield* input_str(rect, buffer, 24, '', 0, 4, color, bgcolor);
    } while (typed <= 0);
    hof[hof_index]!.name = buffer.text;
    scr.restore_peel(peel);
    show_hof_text(hof_rects[hof_index]!, -1, 0, hof[hof_index]!.name);
    hof_write();
    yield* pop_wait(120);
    scr.target(true);
    scr.draw_full_image(full_image_id.TITLE_MAIN);
    yield* transition_ltr();
  }
  while (out.check_sound_playing()) yield 1;
  yield* fade_out_2(0x1000);
  scr.release_title_images();
}

// seg001:0C94
export function* expired(): Scene {
  scr.clear_screen_and_sounds();
  yield* load_intro(1, time_expired, 1);
}

// seg000:17E6
/** `show_title`: the opening titles and the story that leads into them. */
export function* show_title(): Scene {
  scr.load_title_images(1);
  scr.target(true);

  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* fade_in_2(0x1000);
  scr.present();
  out.play_sound(soundids.sound_54_intro_music);
  let timer = start_timer(0x82);
  scr.draw_full_image(full_image_id.TITLE_PRESENTS);
  yield* do_wait(timer);

  timer = start_timer(0xCD);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* do_wait(timer);

  timer = start_timer(0x41);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_GAME);
  yield* do_wait(timer);

  timer = start_timer(0x10E);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  yield* do_wait(timer);

  timer = start_timer(0xEB);
  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_POP);
  scr.draw_full_image(full_image_id.TITLE_MECHNER);
  yield* do_wait(timer);

  scr.copy_screen_rect(24, 106, 296, 195);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_ABSENCE);
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  out.play_sound(soundids.sound_55_story_1_absence);
  yield* transition_ltr();
  yield* pop_wait(0x258);
  yield* fade_out_2(0x800);
  scr.release_title_images();

  yield* load_intro(0, pv_scene, 0);

  scr.load_title_images(1);
  scr.target(true);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_MARRY);
  yield* fade_in_2(0x800);
  scr.draw_full_image(full_image_id.TITLE_MAIN);
  scr.draw_full_image(full_image_id.TITLE_POP);
  scr.draw_full_image(full_image_id.TITLE_MECHNER);
  while (out.check_sound_playing()) yield 1;
  yield* transition_ltr();
  yield* pop_wait(0x78);
  scr.draw_full_image(full_image_id.STORY_FRAME);
  scr.draw_full_image(full_image_id.STORY_CREDITS);
  yield* transition_ltr();
  yield* pop_wait(0x168);
  if (hof_count) {
    scr.draw_full_image(full_image_id.STORY_FRAME);
    scr.draw_full_image(full_image_id.HOF_POP);
    show_hof();
    yield* transition_ltr();
    yield* pop_wait(0xF0);
  }
  scr.target(false);
  while (out.check_sound_playing()) yield 1;
  yield* fade_out_2(0x1800);
  scr.release_title_images();
}
