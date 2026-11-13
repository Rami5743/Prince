/**
 * What a cutscene asks of the screen.
 *
 * `seg001.ts` is the translation and knows nothing about surfaces,
 * palettes or `.DAT` files; `cutscene.ts` fills these slots in, the
 * same way `link.ts`'s `out` is filled in for sound. Everything here
 * stands for one call of the C, and says which.
 */

/** `full_image_id`, in the C's own order. */
export const full_image_id = {
  TITLE_MAIN: 0,
  TITLE_PRESENTS: 1,
  TITLE_GAME: 2,
  TITLE_POP: 3,
  TITLE_MECHNER: 4,
  HOF_POP: 5,
  STORY_FRAME: 6,
  STORY_ABSENCE: 7,
  STORY_MARRY: 8,
  STORY_HAIL: 9,
  STORY_CREDITS: 10,
} as const;

/**
 * `0x6689`, the rows `make_pal_buffer_fadein` is given for a cutscene:
 * the global colours, the kid's, the two story banks and the two the
 * princess's room is drawn out of.
 */
export const FADE_CUTSCENE_ROWS = 0x6689;

/**
 * What `key_test_quit()` and `last_text_input` give `input_str` between
 * them: which of the four keys it acts on this is, and the printable
 * character the keyboard put in `last_text_input`.
 */
export interface KeyPress {
  /** `'enter'`, `'escape'`, `'backspace'`, `'delete'`, or `''` for any other. */
  readonly key: string;
  /** `last_text_input`, or `''` where the key produced no character. */
  readonly ch: string;
}

/** What `read_peel_from_screen` hands back; only the driver looks inside. */
export type ScreenPeel = unknown;

export interface ScreenOps {
  /** `method_1_blit_rect(onscreen_surface_, offscreen_surface, ...)`. */
  copy_screen_rect(left: number, top: number, right: number, bottom: number): void;
  /** The same for the whole of `screen_rect`. */
  present(): void;
  /** `draw_rect`, on whichever surface is the current target. */
  rect(left: number, top: number, right: number, bottom: number, color: number): void;
  /** `draw_rect(&screen_rect, color_0_black)`. */
  clear_screen(): void;
  /** `set_bg_attr(0, color)`, which is how `do_flash` flashes. */
  set_bg_attr(color: number): void;
  /** `make_pal_buffer_fadein` / `make_pal_buffer_fadeout`. */
  fade_start(dir: 'in' | 'out', rows: number): void;
  /** Whether the fade still has shades to go. */
  fade_active(): boolean;
  /** `method_6_blit_img_to_scr(get_image(chtab, id), x, y, blit)`. */
  blit_image(chtab: number, id: number, x: number, y: number, blit: number): void;
  /** `load_chtab_from_file` for chtabs 8, 9, 3 and 4 of a cutscene. */
  load_intro_images(which_imgs: number): void;
  /** `free_all_chtabs_from(id_chtab_3_princessinstory)`. */
  free_intro_images(): void;
  /** How long the driver has been running, in sixtieths of a second. */
  now(): number;
  /** `stop_sounds()` with the screen painted out: `clear_screen_and_sounds`. */
  clear_screen_and_sounds(): void;
  /** `draw_full_image`. */
  draw_full_image(id: number): void;
  /** `load_title_images(bgcolor)` and `release_title_images()`. */
  load_title_images(bgcolor: number): void;
  release_title_images(): void;
  /** `current_target_surface`: true is `offscreen_surface`. */
  target(offscreen: boolean): void;
  /**
   * While a `load_intro` scene is playing, nothing reaches the screen
   * below the room.
   *
   * The original composes the princess's room in the offscreen buffer
   * and puts it on the screen through `draw_proom_drects`, which
   * copies the **dirty rectangles of the tile grid** -- and that grid
   * is the 192-row gameplay area, so the eight rows under it are
   * never copied at all. They keep the black `load_intro` painted
   * over the whole screen before it began.
   *
   * The port composed the room straight into the screen, 200 rows of
   * it, and the first capture of a cutscene says what that costs:
   * every frame of the scene before level 2 differs from the
   * original's in **rows 192 to 199 and nowhere else** -- the
   * capture's are black and the port's carry on the floor of the
   * room. Rows 97 to 179 of the same pair of frames differ by five
   * pixels in all.
   *
   * It is not a blanket rule: `show_title` copies with
   * `method_1_blit_rect(onscreen, offscreen, &screen_rect, ...)`,
   * which is the whole 200 rows, and `TITLE.DAT`'s images are 320 by
   * 200 and reach the bottom. The title capture matches the port
   * there on all 426 of its changes. So the clip is `load_intro`'s
   * and is switched on and off by it.
   */
  clip_room(on: boolean): void;

  // -- the hall of fame: text, a peel and the keyboard --------------------

  /** `show_text_with_color(rect, x_align, y_align, text, color)`. */
  show_text(
    left: number, top: number, right: number, bottom: number,
    x_align: number, y_align: number, text: string, color: number,
  ): void;
  /** `get_text_center_y(rect)`. */
  text_center_y(top: number, bottom: number): number;
  /** `get_char_width(character)`. */
  char_width(ch: string): number;
  /** `get_cstring_width(text)`. */
  cstring_width(text: string): number;
  /**
   * `set_curr_pos(x, y)` and then `draw_text_character(ch)`: one glyph
   * with its baseline at `y`. Answers what `current_x` moves by.
   */
  draw_text_character(x: number, y: number, ch: string, color: number): number;
  /** `read_peel_from_screen(rect)`, off whichever surface is the target. */
  read_peel(left: number, top: number, right: number, bottom: number): ScreenPeel;
  /** `restore_peel(peel)`, on to whichever surface is the target. */
  restore_peel(peel: ScreenPeel): void;
  /** `SDL_SetTextInputRect(rect)` and `SDL_StartTextInput()`. */
  start_text_input(left: number, top: number, right: number, bottom: number): void;
  /** `SDL_StopTextInput()`. */
  stop_text_input(): void;
  /** `key_test_quit()` with `last_text_input`, or null for no key. */
  take_key(): KeyPress | null;
  /** `clear_kbd_buf()`: the key just read, not the queue behind it. */
  clear_kbd_buf(): void;
  /**
   * `fread` of `PRINCE.HOF`, or null where there is no such file.
   *
   * A page has no file beside the game's, so the driver keeps those
   * same bytes in `localStorage`; see `cutscene.ts`.
   */
  hof_read_file(): Uint8Array | null;
  /** `fwrite` of `PRINCE.HOF`. */
  hof_write_file(bytes: Uint8Array): void;
}

function missing(name: string): never {
  throw new Error(`screen.${name} has not been linked in`);
}

export const scr: ScreenOps = {
  copy_screen_rect: () => missing('copy_screen_rect'),
  present: () => missing('present'),
  clip_room: () => missing('clip_room'),
  rect: () => missing('rect'),
  clear_screen: () => missing('clear_screen'),
  set_bg_attr: () => missing('set_bg_attr'),
  fade_start: () => missing('fade_start'),
  fade_active: () => false,
  blit_image: () => missing('blit_image'),
  load_intro_images: () => missing('load_intro_images'),
  free_intro_images: () => missing('free_intro_images'),
  now: () => 0,
  clear_screen_and_sounds: () => missing('clear_screen_and_sounds'),
  draw_full_image: () => missing('draw_full_image'),
  load_title_images: () => missing('load_title_images'),
  release_title_images: () => missing('release_title_images'),
  target: () => missing('target'),
  show_text: () => missing('show_text'),
  text_center_y: () => 0,
  char_width: () => 0,
  cstring_width: () => 0,
  draw_text_character: () => 0,
  read_peel: () => null,
  restore_peel: () => {},
  start_text_input: () => {},
  stop_text_input: () => {},
  take_key: () => null,
  clear_kbd_buf: () => {},
  hof_read_file: () => null,
  hof_write_file: () => {},
};

/** `cutscene.ts` installs itself here. */
export function setScreen(ops: Partial<ScreenOps>): void {
  Object.assign(scr, ops);
}
