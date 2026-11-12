/**
 * The game's globals, under the C's own names.
 *
 * SDLPoP is a translation of a DOS program and keeps its state in
 * globals, which is what makes it readable against a disassembly: every
 * function takes `Char` and the tile the last `get_tile` read, and
 * leaves its answer in another global. Rewriting that into arguments and
 * return values is where a translation stops being a translation, so
 * the globals stay globals and live here.
 *
 * One game at a time, then -- which is what the shell and the tests
 * want anyway, and `reset()` is what starting a level does.
 */
import type { Piece } from './data.ts';

/** `char_type`. */
export interface CharType {
  frame: number;
  x: number;
  y: number;
  direction: number;
  curr_col: number;
  curr_row: number;
  action: number;
  fall_x: number;
  fall_y: number;
  room: number;
  repeat: number;
  charid: number;
  sword: number;
  alive: number;
  curr_seq: number;
}

export function newChar(): CharType {
  return {
    frame: 0, x: 0, y: 0, direction: 0, curr_col: 0, curr_row: 0, action: 0,
    fall_x: 0, fall_y: 0, room: 0, repeat: 0, charid: 0, sword: 0,
    alive: 0, curr_seq: 0,
  };
}

export function copyChar(to: CharType, from: CharType): void {
  to.frame = from.frame;
  to.x = from.x; to.y = from.y; to.direction = from.direction;
  to.curr_col = from.curr_col; to.curr_row = from.curr_row;
  to.action = from.action; to.fall_x = from.fall_x; to.fall_y = from.fall_y;
  to.room = from.room; to.repeat = from.repeat; to.charid = from.charid;
  to.sword = from.sword; to.alive = from.alive; to.curr_seq = from.curr_seq;
}

/** `frame_type`, as `load_frame` leaves it in `cur_frame`. */
export interface FrameType {
  image: number;
  /** 0x3F the sword's image, 0xC0 which chtab the character is in. */
  sword: number;
  dx: number;
  dy: number;
  /** 0x1F weight x, 0x20 thin, 0x40 needs floor, 0x80 even/odd pixel. */
  flags: number;
}

/** `rect_type`. */
export interface RectType {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface BackTableType {
  xh: number;
  xl: number;
  y: number;
  chtab_id: number;
  id: number;
  blit: number;
}

export interface MidTableType extends BackTableType {
  peel: number;
  clip: RectType;
}

export interface WipeTableType {
  left: number;
  bottom: number;
  height: number;
  width: number;
  color: number;
  layer: number;
}

export interface ObjTableType {
  xh: number;
  xl: number;
  y: number;
  chtab_id: number;
  id: number;
  direction: number;
  obj_type: number;
  clip: RectType;
  tilepos: number;
}

/** `trob_type`: a tile that is doing something. */
export interface TrobType {
  tilepos: number;
  room: number;
  type: number;
}

/** `mob_type`: a loose floor on its way down. */
export interface MobType {
  xh: number;
  y: number;
  room: number;
  speed: number;
  type: number;
  row: number;
}

/** `level_type`, as `seg001` reads it out of the level file. */
export interface LevelType {
  fg: Uint8Array;
  bg: Uint8Array;
  doorlinks1: Uint8Array;
  doorlinks2: Uint8Array;
  roomlinks: { left: number; right: number; up: number; down: number }[];
  start_room: number;
  start_pos: number;
  start_dir: number;
  guards_tile: Uint8Array;
  guards_dir: Uint8Array;
  guards_x: Uint8Array;
  guards_seq_lo: Uint8Array;
  guards_skill: Uint8Array;
  guards_seq_hi: Uint8Array;
  guards_color: Uint8Array;
}

const TABLES = 5;

/** Everything the C keeps at file scope. */
class Globals {
  // -------------------------------------------------------- characters
  Char: CharType = newChar();
  Opp: CharType = newChar();
  Kid: CharType = newChar();
  Guard: CharType = newChar();
  cur_frame: FrameType = { image: 0, sword: 0, dx: 0, dy: 0, flags: 0 };

  // -------------------------------------------------------- the level
  level!: LevelType;
  current_level = 0;
  next_level = 0;
  start_level = 0;
  is_restart_level = 0;
  checkpoint = 0;
  hitp_beg_lev = 0;
  /** The room the screen is showing, which need not be the Prince's. */
  drawn_room = 0;
  next_room = 0;
  loaded_room = 0;
  room_L = 0;
  room_R = 0;
  room_A = 0;
  room_B = 0;
  room_AL = 0;
  room_AR = 0;
  room_BL = 0;
  room_BR = 0;
  curr_room_tiles!: Uint8Array;
  curr_room_modif!: Uint8Array;
  leftroom_ = [0, 1, 2].map(() => ({ tiletype: 0, modifier: 0 }));
  row_below_left_ = Array.from({ length: 10 }, () => ({ tiletype: 0, modifier: 0 }));

  // -------------------------------------------------------- the tile just read
  curr_tile = 0;
  curr_tile2 = 0;
  curr_modifier = 0;
  curr_tilepos = 0;
  curr_room = 0;
  tile_col = 0;
  tile_row = 0;
  tile_left = 0;
  modifier_left = 0;

  // -------------------------------------------------------- the character's box
  char_x_left = 0;
  char_x_left_coll = 0;
  char_x_right = 0;
  char_x_right_coll = 0;
  char_top_y = 0;
  char_top_row = 0;
  char_bottom_row = 0;
  char_col_left = 0;
  char_col_right = 0;
  char_width_half = 0;
  char_height = 0;
  prev_char_top_row = 0;
  prev_char_col_right = 0;
  prev_char_col_left = 0;

  // -------------------------------------------------------- collisions
  prev_coll_room = new Int8Array(10).fill(-1);
  prev_coll_flags = new Uint8Array(10);
  curr_row_coll_room = new Int8Array(10).fill(-1);
  curr_row_coll_flags = new Uint8Array(10);
  below_row_coll_room = new Int8Array(10).fill(-1);
  below_row_coll_flags = new Uint8Array(10);
  above_row_coll_room = new Int8Array(10).fill(-1);
  above_row_coll_flags = new Uint8Array(10);
  prev_collision_row = -1;
  bump_col_left_of_wall = 0;
  bump_col_right_of_wall = 0;
  coll_tile_left_xpos = 0;

  // -------------------------------------------------------- the object table
  obj_direction = 0;
  obj_chtab = 0;
  obj_id = 0;
  obj_x = 0;
  obj_xh = 0;
  obj_xl = 0;
  obj_y = 0;
  obj_tilepos = 0;
  obj_clip_left = 0;
  obj_clip_top = 0;
  obj_clip_right = 0;
  obj_clip_bottom = 0;
  obj2_clip_left = 0;
  obj2_clip_top = 0;
  obj2_clip_right = 0;
  obj2_clip_bottom = 0;
  objtable: ObjTableType[] = [];
  objtable_count = 0;

  // -------------------------------------------------------- the draw tables
  backtable: BackTableType[] = [];
  foretable: BackTableType[] = [];
  midtable: MidTableType[] = [];
  table_counts = new Int16Array(TABLES);
  wipetable: WipeTableType[] = [];
  wipetable_count = 0;
  /** Which of `backtable` and `foretable` `ptr_add_table` points at. */
  ptr_add_table: 'back' | 'fore' | 'mid' = 'back';
  draw_xh = 0;
  draw_main_y = 0;
  draw_bottom_y = 0;
  drawn_row = 0;
  drawn_col = 0;
  draw_mode = 0;
  leveldoor_open = 0;
  leveldoor_right = 0;
  leveldoor_ybottom = 0;

  // -------------------------------------------------------- redraw flags
  redraw_frames_full = new Uint8Array(30);
  redraw_frames2 = new Uint8Array(30);
  redraw_frames_anim = new Uint8Array(30);
  redraw_frames_floor_overlay = new Uint8Array(30);
  redraw_frames_above = new Uint8Array(10);
  redraw_frames_fore = new Uint8Array(30);
  wipe_frames = new Uint8Array(30);
  wipe_heights = new Uint8Array(30);
  tile_object_redraw = new Uint8Array(30);
  redraw_height = 0;
  need_full_redraw = 0;

  // -------------------------------------------------------- tiles that move
  trobs: TrobType[] = [];
  trobs_count = 0;
  trob: TrobType = { tilepos: 0, room: 0, type: 0 };
  mobs: MobType[] = [];
  mobs_count = 0;
  curmob: MobType = { xh: 0, y: 0, room: 0, speed: 0, type: 0, row: 0 };

  // -------------------------------------------------------- the player
  control_x = 0;
  control_y = 0;
  control_shift = 0;
  control_forward = 0;
  control_backward = 0;
  control_up = 0;
  control_down = 0;
  control_shift2 = 0;
  ctrl1_forward = 0;
  ctrl1_backward = 0;
  ctrl1_up = 0;
  ctrl1_down = 0;
  ctrl1_shift2 = 0;
  is_paused = 0;

  // -------------------------------------------------------- hit points
  hitp_curr = 0;
  hitp_max = 0;
  hitp_delta = 0;
  guardhp_curr = 0;
  guardhp_max = 0;
  guardhp_delta = 0;
  flash_color = 0;
  flash_time = 0;
  resurrect_time = 0;

  // -------------------------------------------------------- the fight
  guard_skill = 0;
  guard_refrac = 0;
  justblocked = 0;
  kid_sword_strike = 0;
  can_guard_see_kid = 0;
  holding_sword = 0;
  offguard = 0;
  have_sword = 0;
  united_with_shadow = 0;
  guard_notice_timer = 0;
  is_guard_notice = 0;
  guard_refrac_timer = 0;

  // -------------------------------------------------------- odds and ends
  is_screaming = 0;
  is_feather_fall = 0;
  knock = 0;
  exit_room_timer = 0;
  roomleave_result = 0;
  pickup_obj_type = 0;
  jumped_through_mirror = 0;
  grab_timer = 0;
  rem_min = 0;
  rem_tick = 0;

  // ------------------------------------------------ the strip of words
  /** `text_time_remaining`, `text_time_total`: how long a message stays. */
  text_time_remaining = 0;
  text_time_total = 0;
  /** `is_show_time`: the clock has something to say. */
  is_show_time = 0;
  /** `seamless`: level 12's running exit, which shows no level number. */
  seamless = 0;
  /** `current_sound`: which sound is playing, or -1. */
  current_sound = -1;
  random_seed = 0;
  /** `end_sequence` has been reached: the last room of the last level. */
  game_won = 0;
  /**
   * `expired()` has been reached.
   *
   * In the C `expired` never returns -- it ends in `start_game`,
   * which `longjmp`s out of the whole game -- so a `goto` is all it
   * is. Here the shell watches this and plays the hourglass.
   */
  game_expired = 0;
  /**
   * The demo level has been run out of.
   *
   * `play_frame`'s `current_level == 0` branch ends in
   * `start_level = -1; start_game()` -- back to the title -- and the
   * shell does that where the C does it directly.
   */
  demo_finished = 0;
  upside_down = 0;
  need_level1_music = 0;
  is_blind_mode = 0;
  torch_colors: Uint8Array[] = [];
  palace_wall_colors = new Uint8Array(44 * 3);
  demo_index = 0;
  demo_time = 0;
  /** `shadow_initialized`: level 12's shadow has been put in the room. */
  shadow_initialized = 0;

  /** `chtab_addrs`: the sprite banks, filled in by the loader. */
  chtab_addrs: (readonly { width: number; height: number; data: Uint8Array }[] | null)[]
    = Array.from({ length: 10 }, () => null);

  tile_table: readonly Piece[] = [];
}

export const g = new Globals();

/**
 * Every global back to what it is before a game is loaded.
 *
 * `g` is one object for the life of the process, which is what makes
 * the translation readable against the disassembly, and `startLevel`
 * sets by hand the fields a level begins with. Anything it does not
 * name is left as the last game left it -- and that showed: scoring
 * `gate2` on its own gave 235 ticks of 1309 and scoring it after the
 * twenty-one recordings before it in the same process gave 616. The
 * same digest, the same port, a different answer, which makes the
 * suite's numbers depend on the order its cases run in.
 *
 * So a game starts by putting every field back to the value the class
 * declares. It has to run before the loader fills `chtab_addrs` and
 * `tile_table`, which is why `PopGame.start` calls it first of all.
 */
export function resetGlobals(): void {
  const fresh = new Globals() as unknown as Record<string, unknown>;
  const live = g as unknown as Record<string, unknown>;
  // Two of them belong to the run of the program and not to the game:
  // the cheats the player turned on. `upside_down` and `is_blind_mode`
  // are set from the keyboard in the C and nothing in `start_level`
  // puts them back, so turning the screen over and then walking
  // through the level door has to leave it over.
  const keep = { upside_down: g.upside_down, is_blind_mode: g.is_blind_mode };
  for (const key of Object.keys(fresh)) live[key] = fresh[key];
  g.upside_down = keep.upside_down;
  g.is_blind_mode = keep.is_blind_mode;
}

/** The C's `(byte)`, `(sbyte)` and `(word)` casts, which it relies on. */
/**
 * `level.roomlinks[room - 1]`, for a `room` that need not be a room.
 *
 * The C indexes the array with `room - 1` and never checks, so it
 * reads whatever is at that offset in the `level` struct. Two rooms
 * that are not rooms turn up in play:
 *
 * * **nought.** `goto_other_room` puts the Prince -- and a guard --
 *   there when they fall out of the bottom of a level, and
 *   `fell_out` only kills him for it while `Char.alive < 0`, so once
 *   he is dying the room stays nought and the next `exit_room` comes
 *   back for its links. The C then reads the four bytes in front of
 *   `roomlinks`, which is the end of `doorlinks2`; those are
 *   reproduced here exactly.
 * * **anything at all.** Those four bytes are 128 on level 10, so
 *   the original walks out of room 0 into "room 128" and reads
 *   `roomlinks[127]`, four hundred bytes past the array and into the
 *   guard tables. That cannot be reproduced without the level's raw
 *   image, which the port does not keep, so this answers with no
 *   links at all -- which is what the level data uses for the edge of
 *   the world, and stops the wandering instead of carrying it on.
 *
 * It exists because in JavaScript the array simply has no index -1
 * or 127: reading a field off `undefined` throws a `TypeError`, and
 * that stops the page dead where the original merely wanders.
 * Fuzzing found both -- level 5 about one run in ten, level 10 about
 * one in five.
 */
export function roomLinksOf(room: number): {
  left: number; right: number; up: number; down: number;
} {
  if (room >= 1 && room <= 24) return g.level.roomlinks[room - 1];
  if (room === 0) {
    return {
      left: g.level.doorlinks2[252],
      right: g.level.doorlinks2[253],
      up: g.level.doorlinks2[254],
      down: g.level.doorlinks2[255],
    };
  }
  return { left: 0, right: 0, up: 0, down: 0 };
}

export const byteOf = (v: number): number => v & 0xff;
export const sbyteOf = (v: number): number => ((v & 0xff) << 24) >> 24;
export const wordOf = (v: number): number => v & 0xffff;
export const shortOf = (v: number): number => ((v & 0xffff) << 16) >> 16;
