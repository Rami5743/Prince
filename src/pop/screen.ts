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
}

function missing(name: string): never {
  throw new Error(`screen.${name} has not been linked in`);
}

export const scr: ScreenOps = {
  copy_screen_rect: () => missing('copy_screen_rect'),
  present: () => missing('present'),
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
};

/** `cutscene.ts` installs itself here. */
export function setScreen(ops: Partial<ScreenOps>): void {
  Object.assign(scr, ops);
}
