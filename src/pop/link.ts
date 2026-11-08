/**
 * The seams between one segment and the next.
 *
 * The C is one program: `seg006.c` calls `start_chompers` in `seg007.c`
 * and `seg007.c` calls `get_tile` back in `seg006.c`, and the linker
 * sorts it out. Modules do not link, they import, and a cycle of
 * imports that is innocent in C can leave a module half-built here.
 *
 * So the handful of calls that actually cross a cycle go through these
 * slots instead. Each segment fills in its own as it loads; a call to
 * one that has not been filled in is a mistake and says so rather than
 * failing quietly.
 *
 * Everything that does not cross a cycle is imported in the ordinary
 * way: this is a list of the seams, not of the calls.
 */

type Fn = (...args: never[]) => unknown;

function missing(name: string): never {
  throw new Error(`${name} has not been linked in`);
}

function slot<T extends Fn>(name: string): { fn: T } {
  return { fn: (() => missing(name)) as unknown as T };
}

/** `seg007.c`. */
export const l7 = {
  start_chompers: slot<() => void>('start_chompers'),
  make_loose_fall: slot<(modifier: number) => void>('make_loose_fall'),
  trigger_button: slot<(process_shadow: number, tilepos: number, button_type: number) => void>('trigger_button'),
  is_spike_harmful: slot<() => number>('is_spike_harmful'),
  start_anim_spike: slot<(room: number, tilepos: number) => void>('start_anim_spike'),
};

/** `seg008.c`. */
export const l8 = {
  set_wipe: slot<(tilepos: number, frames: number) => void>('set_wipe'),
  set_redraw_full: slot<(tilepos: number, frames: number) => void>('set_redraw_full'),
  set_redraw_fore: slot<(tilepos: number, frames: number) => void>('set_redraw_fore'),
  set_redraw2: slot<(tilepos: number, frames: number) => void>('set_redraw2'),
  set_redraw_floor_overlay: slot<(tilepos: number, frames: number) => void>('set_redraw_floor_overlay'),
  set_redraw_anim: slot<(tilepos: number, frames: number) => void>('set_redraw_anim'),
  get_room_address: slot<(room: number) => void>('get_room_address'),
  add_objtable: slot<(obj_type: number) => void>('add_objtable'),
  mark_obj_tile_redraw: slot<(index: number) => void>('mark_obj_tile_redraw'),
};

/** `seg005.c`. */
export const l5 = {
  do_fall: slot<() => void>('do_fall'),
  spiked: slot<() => void>('spiked'),
  control: slot<() => void>('control'),
  seqtbl_offset_char: slot<(seq_index: number) => void>('seqtbl_offset_char'),
};

/** `seg006.c`'s guard half, which seg002 fills in. */
export const l6 = {
  control_guard_inactive: slot<() => void>('control_guard_inactive'),
};

/** `seg002.c`. */
export const l2 = {
  autocontrol_opponent: slot<() => void>('autocontrol_opponent'),
  clear_char: slot<() => void>('clear_char'),
  died_on_button: slot<() => void>('died_on_button'),
  set_start_pos: slot<() => void>('set_start_pos'),
  on_guard_killed: slot<() => void>('on_guard_killed'),
  inc_curr_row: slot<() => void>('inc_curr_row'),
};

/**
 * What the game tells the world about: a sound to play, the level
 * being over. The shell fills these in; by default they do nothing,
 * because a replay being measured against a capture has no sound.
 */
export const out = {
  play_sound: (_which: number): void => {},
  stop_sounds: (): void => {},
  check_sound_playing: (): number => 0,
  display_text_bottom: (_text: string): void => {},
  erase_bottom_text: (_arg: number): void => {},
  /** `play_death_music`, which `play_kid` then waits out. */
  play_death_music: (): void => {},
};
