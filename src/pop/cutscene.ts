/**
 * The driver that plays a cutscene, and everything round it that is a
 * surface, a palette or a file rather than a line of the C.
 *
 * `seg001.ts` is the translation: it draws by filling the same four
 * tables `seg008.ts` fills for a room, and it waits by yielding a
 * number of sixtieths of a second. This runs those generators on a
 * clock, holds the two surfaces the original holds -- `offscreen_surface`,
 * where the picture is composed, and `onscreen_surface_`, which is what
 * the player sees -- and loads the banks of sprites out of `PV.DAT`
 * and `TITLE.DAT`.
 *
 * Nothing here invents a picture. Every pixel comes out of the game's
 * own files, through the same `Assets` the rooms are loaded with.
 */
import type { Assets, SpriteSet } from '../render/assets.ts';
import { Surface, ScreenPalette } from '../render/surface.ts';
import { readExeTables } from '../game/exe-tables.ts';
import { readExeConstants } from '../game/exe-constants.ts';
import {
  readFont, charWidth, lineWidth, textCenterY, drawTextCharacter, drawTextInRect,
  type Font,
} from '../render/font.ts';
import { flipHorizontally } from '../render/room.ts';

import { g, newChar, type RectType } from './state.ts';
import { blitters, chtabs } from './types.ts';
import { setFrameTables } from './seg006.ts';
import { setPainter, FLIPPED, free_peels, reset_tables, type Peel } from './seg008.ts';
import { out } from './link.ts';
import { setScreen, full_image_id } from './screen.ts';
import { link } from './wire.ts';
import {
  type Scene, show_title, end_sequence, expired, load_intro, tbl_cutscenes,
  reset_stars, hof_read, keysDisabled, frameTime,
} from './seg001.ts';
import type { KeyPress, ScreenPeel } from './screen.ts';

/** One sixtieth of a second: `BASE_FPS` is 60 and every timer counts it. */
export const UNIT_MS = 1000 / 60;

/**
 * Where `PRINCE.HOF` goes.
 *
 * The original writes the hall of fame to a file of that name beside
 * the game's own. A page has no such place, so the same 176 bytes --
 * see `hof_write` -- go into `localStorage` under this key, base64
 * encoded because `localStorage` holds strings. It is the one
 * substitution in the translation of the ending.
 */
export const HOF_STORAGE_KEY = 'PRINCE.HOF';

/**
 * Which sixteen-colour row of the 256-colour palette each bank sits in.
 *
 * These are the `1 << n` masks the C hands `load_chtab_from_file` and
 * `load_sprites_from_file`, which is what `set_loaded_palette` turns
 * into a row: `1<<13` is row 13 and so colours 208 to 223.
 */
const ROW = {
  sword: 2, flame: 3, kid: 7,
  princessInStory: 9, jaffarInStory: 10,
  title40: 11, title50: 12,
  princessRoom: 13, princessBed: 14,
} as const;

/** `full_image[]`: which bank, which image, where and with what blitter. */
const FULL_IMAGE: readonly {
  id: number; bank: 40 | 50; blit: number; xpos: number; ypos: number;
}[] = [
  { id: 0, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 0, ypos: 0 },
  { id: 1, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 96, ypos: 106 },
  { id: 2, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 96, ypos: 122 },
  { id: 3, bank: 50, blit: blitters.blitters_10h_transp, xpos: 24, ypos: 107 },
  { id: 4, bank: 50, blit: blitters.blitters_0_no_transp, xpos: 48, ypos: 184 },
  { id: 3, bank: 50, blit: blitters.blitters_10h_transp, xpos: 24, ypos: 24 },
  { id: 0, bank: 40, blit: blitters.blitters_0_no_transp, xpos: 0, ypos: 0 },
  { id: 1, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 2, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 3, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 25 },
  { id: 4, bank: 40, blit: blitters.blitters_white, xpos: 24, ypos: 26 },
];

/**
 * `get_text_color(15, color_15_brightwhite, 0x800)`: the story text is
 * a mono blit in colour 15 of the story bank's own row, which is 191.
 */
const STORY_TEXT_COLOR = ROW.title40 * 16 + 15;

/** Which scene the player is playing, for the shell and for a test. */
export type SceneName =
  | { kind: 'title' }
  | { kind: 'ending' }
  | { kind: 'expired' }
  | { kind: 'level'; level: number };

export interface CutsceneEffects {
  sound?(which: number): void;
  soundPlaying?(): boolean;
  stopSounds?(): void;
}

/** A level with nothing in it, which is what the C's `level` holds here. */
function blankLevel(): typeof g.level {
  return {
    fg: new Uint8Array(24 * 30),
    bg: new Uint8Array(24 * 30),
    doorlinks1: new Uint8Array(256),
    doorlinks2: new Uint8Array(256),
    roomlinks: Array.from({ length: 24 }, () => ({ left: 0, right: 0, up: 0, down: 0 })),
    start_room: 1,
    start_pos: 0,
    start_dir: 0,
    guards_tile: new Uint8Array(24).fill(30),
    guards_dir: new Uint8Array(24),
    guards_x: new Uint8Array(24),
    guards_seq_lo: new Uint8Array(24),
    guards_skill: new Uint8Array(24),
    guards_seq_hi: new Uint8Array(24),
    guards_color: new Uint8Array(24),
  };
}

/**
 * A sweep hook for the cutscene fade's rate, and nothing else.
 *
 * The rate a cutscene's fade runs at is not in the code -- its
 * `wait_time` is nought -- so it is read off a capture, and reading
 * it off again means running `scene-report.ts` at several values.
 * Nought, which is what a browser gives, means "use the measured
 * one". It is read through `globalThis` because `process` does not
 * exist on a page.
 */
/**
 * Sixtieths a shade of a **cutscene** fade takes, by
 * `cutscene_frame_time`, as captures of the original measure it.
 *
 * There is no third value to find in the code: `fade_in_1` and
 * `fade_out_1` pass `wait_time` nought, so `fade_out_frame`'s
 * `do_simple_wait(timer_1)` returns at once and
 * `proc_cutscene_frame`'s inner loop spins as fast as the machine
 * can compute and write a palette until the cutscene frame's own
 * timer stops. A faster machine fades faster, and the original on
 * real hardware faster than either; what a capture can say is what
 * the oracle's DOSBox at 20000 cycles does, and these are the two
 * frame times any scene uses.
 *
 * Six is every scene but one, and three shades fit in its six
 * sixtieths -- the same two sixtieths a shade that `wait_time` 2
 * would have given, which is why the six cutscenes never showed
 * this. Seven is what `pv_scene` switches to before Jaffar
 * conjures, and there the capture is unambiguous: 63 shades over 54
 * video frames, stepping 1, 1, 1, 1, 1, 2 without a break, which is
 * seven shades every six frames. `ceil(T / 2)` shades in T
 * sixtieths -- four in seven, 1.75 -- is the arithmetic of the
 * `do..while` and predicts it to two per cent; the capture is kept
 * because the capture is the authority, and it is worth eleven
 * frames of the title (575 against 586).
 */
const CUTSCENE_FADE_RATE: Record<number, number> = { 6: 2, 7: 12 / 7 };

const CUTSCENE_FADE_SWEEP = Number(
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.POP_CUTSCENE_FADE_UNITS ?? '') || 0;

export class CutscenePlayer {
  /** `offscreen_surface`, where the picture is composed. */
  private readonly offscreen = new Surface();
  /** `onscreen_surface_`, which is what the page shows. */
  private readonly onscreen = new Surface();
  private target: Surface = this.offscreen;
  readonly palette = new ScreenPalette();

  private readonly banks = new Map<number, SpriteSet>();
  private title40?: SpriteSet;
  private title50?: SpriteSet;
  /** The two halves of chtab 4: 850 in the story, 900 in a cutscene. */
  private jaffarInStory?: SpriteSet;
  private princessInCutscenes?: SpriteSet;
  private readonly vgaPalette: readonly { r: number; g: number; b: number }[];

  private gen: Scene | null = null;
  private pending = 0;
  private owed = 0;
  private elapsed = 0;
  private fadeOwed = 0;
  private clipRect: RectType | null = null;
  private effects?: CutsceneEffects;
  private scene: SceneName = { kind: 'title' };

  /** Palette rows mid-fade, and the ones to put back when it is over. */
  private fade: {
    dir: 'in' | 'out'; rows: number; pos: number;
    original: Uint8Array; faded: Uint8Array;
  } | null = null;

  /** The background colour `do_flash` took, put back by `remove_flash`. */
  private savedBackground: [number, number, number] | null = null;
  /** `remove_flash` has been asked for and is owed the next frame. */
  private flashPending = false;
  /** The sixtieths of `do_flash`'s own wait that are still to run. */
  private flashOwed = 0;
  /** `delay_ticks(1)`: what `proc_cutscene_frame` waits with the colour up. */
  private static readonly FLASH_UNITS = 2;

  private readonly exe: Uint8Array;
  /** The game's own font, out of the executable, for the hall of fame. */
  private font?: Font;
  /** What the shell has typed and `input_str` has not taken yet. */
  private readonly keys: KeyPress[] = [];
  /** `SDL_StartTextInput()` is in, `SDL_StopTextInput()` is out. */
  private textInput = false;

  private constructor(
    exe: Uint8Array,
    vgaPalette: readonly { r: number; g: number; b: number }[],
  ) {
    this.exe = exe;
    this.vgaPalette = vgaPalette;
  }

  static async create(
    assets: Assets, exe: Uint8Array, effects?: CutsceneEffects,
  ): Promise<CutscenePlayer> {
    const constants = readExeConstants(exe);
    const player = new CutscenePlayer(exe, constants.vgaPalette);
    player.effects = effects;
    // `load_chtab_from_file`, once: a page cannot stop in the middle
    // of a cutscene to fetch a file, so every bank any of them asks
    // for is read in here.
    player.banks.set(chtabs.id_chtab_0_sword,
      await assets.group('PRINCE.DAT', 700, ROW.sword * 16));
    player.banks.set(chtabs.id_chtab_1_flameswordpotion,
      await assets.group('PRINCE.DAT', 150, ROW.flame * 16));
    player.banks.set(chtabs.id_chtab_2_kid,
      await assets.group('KID.DAT', 400, ROW.kid * 16));
    player.banks.set(chtabs.id_chtab_3_princessinstory,
      await assets.group('PV.DAT', 800, ROW.princessInStory * 16));
    player.jaffarInStory = await assets.group('PV.DAT', 850, ROW.jaffarInStory * 16);
    player.princessInCutscenes = await assets.group('PV.DAT', 900, ROW.jaffarInStory * 16);
    player.banks.set(chtabs.id_chtab_8_princessroom,
      await assets.group('PV.DAT', 950, ROW.princessRoom * 16));
    player.banks.set(chtabs.id_chtab_9_princessbed,
      await assets.group('PV.DAT', 980, ROW.princessBed * 16));
    player.title40 = await assets.group('TITLE.DAT', 40, ROW.title40 * 16);
    player.title50 = await assets.group('TITLE.DAT', 50, ROW.title50 * 16);
    player.font = readFont(exe);
    // `init_game_main`: the hall of fame is read once, when the game
    // starts, and `end_sequence` and `show_title` both read what it
    // left. Only the two file slots are needed for that, and
    // `install` fills in the same two again for every scene.
    setScreen({
      hof_read_file: () => readHofFile(),
      hof_write_file: (bytes) => { writeHofFile(bytes); },
    });
    hof_read();
    return player;
  }

  /** `tbl_cutscenes[level]`: is there a scene before this level at all? */
  static hasCutsceneFor(level: number): boolean {
    return tbl_cutscenes[level] != null;
  }

  get running(): boolean { return this.gen !== null; }
  /**
   * `input_str` is waiting for a name: every key belongs to it, and
   * none of them to the shell's own "a key skips the scene".
   */
  get wantsText(): boolean { return this.textInput; }
  /** A key the player pressed, for `key_test_quit()` to find. */
  pushKey(key: string, ch: string): void { this.keys.push({ key, ch }); }
  get playing(): SceneName { return this.scene; }
  /**
   * A key during the title starts the game rather than skipping to
   * what comes next, which is what `process_key` does while
   * `start_level < 0`.
   */
  get skippable(): boolean { return this.scene.kind === 'title'; }

  /**
   * `disable_keys`: the scene will not let a key cut it short.
   *
   * `proc_cutscene_frame`'s loop is
   * `if (!disable_keys && do_paused()) { stop_sounds(); ...; return 1; }`
   * and `do_paused` returns `key || control_shift` -- so **any** key,
   * shift included, ends a scene. Only `end_sequence_anim` and
   * `time_expired` set the flag, which is the ending and the
   * hourglass; the title and all six scenes between the levels take
   * a key.
   *
   * The shell took Escape and nothing else, so the player sat
   * through every transition: "a long pause that cannot be skipped",
   * and it is not like that in the original.
   */
  get keysDisabled(): boolean { return keysDisabled() !== 0; }

  render(): Surface { return this.onscreen; }

  /**
   * Start one. `level` plays `tbl_cutscenes[level]` before that level
   * is loaded, exactly as `play_level` does.
   */
  begin(scene: SceneName): void {
    this.scene = scene;
    this.install();
    const body = (): Scene => {
      switch (scene.kind) {
        case 'title': return show_title();
        case 'ending': return end_sequence();
        case 'expired': return expired();
        default: {
          const func = tbl_cutscenes[scene.level];
          if (!func) return (function* (): Scene {})();
          return load_intro(scene.level > 2 ? 1 : 0, func, 1);
        }
      }
    };
    this.gen = body();
    this.elapsed = 0;
    this.owed = 0;
    this.fadeOwed = 0;
    this.pending = 0;
    this.step();
  }

  /** Stop where it stands: a key during the title, or the page moving on. */
  cancel(): void {
    this.gen = null;
    this.fade = null;
  }

  /**
   * Run the clock on by `ms`. Answers whether the scene is still going.
   *
   * The fade is stepped **here**, off the wall clock, and not where
   * the generator finishes a wait. In the C it has a timer of its
   * own: `proc_cutscene_frame`'s inner busy loop calls
   * `proc_fade_frame` over and over until the cutscene frame's
   * `timer_0` has run out, and each of those spends `timer_1`, which
   * is two sixtieths. So a cutscene frame of six sixtieths holds
   * three shades, one after another, each on the screen for two.
   *
   * Stepping them where the generator yields put all three up at once
   * and left the screen still for the other two thirds of the frame.
   * The capture says which: the princess-room scene of the title
   * fades in over **fifty-three consecutive video frames, one change
   * each**, where the port changed every third frame.
   */
  advance(ms: number): boolean {
    if (!this.gen) return false;
    // `remove_flash`, two sixtieths late on purpose -- see `takeFlashDown`.
    if (this.flashPending && this.flashOwed <= 0) this.takeFlashDown();
    const units = ms / UNIT_MS;
    this.owed += units;
    this.fadeClock(units);
    let guard = 0;
    while (this.gen && this.owed >= this.pending && guard++ < 20000) {
      this.owed -= this.pending;
      // `elapsed` is the *generator's* clock, which is what
      // `start_timer` and `do_wait` are written against, so it counts
      // the waits the scene has actually finished and not the
      // sixtieths that have gone by. The two come to the same total;
      // keeping them apart is what stops a `do_wait` coming out a
      // sixtieth short because the fade had already been given the
      // leftover.
      this.elapsed += this.pending;
      this.step();
    }
    // The flash's own wait runs from the frame it was asked on.
    if (this.flashPending) this.flashOwed -= units;
    return this.gen !== null;
  }

  /**
   * `remove_flash`, put off by the two sixtieths the C waits.
   *
   * `proc_cutscene_frame` sets the background colour, waits
   * `delay_ticks(1)` -- two sixtieths -- and puts it back, all inside
   * one cutscene frame. A driver that draws once a frame has nothing
   * in between to show that on, so the colour goes back once the
   * scene's own clock has run those two sixtieths on, which is the
   * next frame of a thirtieth-of-a-second replay and the frame after
   * that of a sixtieth one.
   *
   * It used to go back in `step()`, where the next frame is the next
   * **cutscene** frame, and Jaffar conjuring the hourglass in
   * `pv_scene` is the one place that shows: `cutscene_frame_time` is
   * 7 there and `flash_time` is 5, so the white stayed up for five
   * cutscene frames end to end. In the port's own video frames that
   * is **seventeen frames of white**, mean brightness 168 against
   * the room's 84 on every one of them (2104 to 2120 of the title).
   * The original blinks five times: a capture of it reads 84 on
   * every frame around them and 168 on two (the sixty-a-second grab
   * catches the two-sixtieth flash, `--untear` halves it back to
   * thirty, and three of the five fall in the half that goes).
   * `scene-report` title 586 -> 588.
   */
  private takeFlashDown(): void {
    if (!this.flashPending) return;
    this.flashPending = false;
    if (this.savedBackground) {
      this.palette.setEntry(0, ...this.savedBackground);
      this.savedBackground = null;
    }
  }

  private step(): void {
    const r = this.gen!.next();
    if (r.done) { this.gen = null; this.pending = 0; return; }
    this.pending = r.value;
  }

  /**
   * The sixtieths that have gone by: the fade moves a shade every two.
   *
   * `make_pal_buffer_fadein` and `make_pal_buffer_fadeout` are both
   * given `wait_time` **2**, and `fade_in_frame` spends it round one
   * shade of the sixty-four -- `start_timer(timer_1, wait_time)` at
   * the top and `do_simple_wait(timer_1)` at the bottom. So a whole
   * fade is 128 sixtieths, which is 2.13 seconds and 64 frames of a
   * thirty-a-second capture. This stepped a shade per sixtieth and so
   * faded in half the time, which nothing in the repository could see
   * until the title screen was captured: the original's opening fade
   * occupies video frames 5 to 64 of that capture, sixty of them,
   * where the port's took thirty-two.
   *
   * Every fade in the game is the same two calls -- `fade_in_1` and
   * `fade_out_1` reach the same step through `proc_cutscene_frame`'s
   * inner busy loop -- which is why the arithmetic belongs here and
   * not in the four generators.
   *
   * ### The odd frames of a fade are the capture, not the game
   *
   * With this right, the port draws the capture's fade **exactly on
   * every even frame** and matches no odd one, all the way from 17 to
   * 63, and `tools/dev/scene-report.ts` reports the fade that way.
   * That is the grab catching the DAC half written. A step is two
   * sixtieths, 33.3ms, and the grab is thirty frames a second, 33.3ms:
   * the two beat together exactly, so one grab lands after
   * `set_pal_arr` has walked all sixteen entries of the row and the
   * next lands in the middle of it. The capture's odd frames have
   * some components of some entries advanced and others not -- at
   * (0,0) between frames 18 and 19 the green of one entry moves a DAC
   * unit and the red of the same entry does not, which no arithmetic
   * on a palette can produce and a half-finished write can.
   *
   * Two shades every four sixtieths was tried, because it fits that
   * one pixel's reading of 8, 8, 16, 16; it scores **92 of the
   * capture's 606 changes against 108**, and moves the alternation's
   * parity rather than removing it. It is not kept.
   */
  private static readonly FADE_UNITS = 2;

  /**
   * And the cutscene fade, which has no wait of its own.
   *
   * `make_pal_buffer_fadein` is given `wait_time` 2 by `fade_in_2`
   * and **0** by `fade_in_1` -- SDLPoP writes the second one
   * `/*0*\/ 2`, keeping the original's value in the comment beside
   * its own substitution. With nought there is no timer between two
   * shades, so what paces a cutscene's fade is not `wait_time` but
   * `proc_cutscene_frame`'s own loop:
   *
   *     do { ... proc_fade_frame(...) ... }
   *     while (!has_timer_stopped(timer_0));
   *
   * -- a `do..while`, so a cutscene frame of `cutscene_frame_time`
   * sixtieths fits **ceil(T / 2)** shades in, the last of them
   * started with one sixtieth still to run. At the six sixtieths
   * every scene but one uses that is three shades in six, which is
   * the two sixtieths a shade `fade_in_2` has anyway and is why the
   * six cutscenes never showed it. At **seven**, which `pv_scene`
   * switches to before Jaffar conjures, it is four shades in seven.
   *
   * The capture says the same thing without the arithmetic. One of
   * the title, grabbed at sixty and untorn, measures `pv_scene`'s
   * fade-out shade by shade against the port's own frames:
   *
   *     cap frame  2373 2374 2375 2376 2377 2378 2379 2380 ...
   *     shade         0    2    3    4    5    6    8    9
   *
   * -- 63 shades over 54 video frames, 1, 1, 1, 1, 1, 2 without a
   * break, which is 1.71 sixtieths a shade against this model's
   * 1.75; and the same capture's `fade_in_2` of the story screen
   * forty frames later steps one shade per video frame exactly,
   * which is `wait_time` 2. Two rates in one capture, from the two
   * `wait_time`s, and the port keeps both.
   *
   * Flat rates were swept and all of them lose, because they move
   * the six cutscenes' fades as well:
   *
   *     2 (every fade)        scenes 2029 of 2236
   *     1.7143 (every fade)          1818 of 2232
   *     1.75   (every fade)          1833 of 2230
   *     1.6667 (every fade)          1829 of 2221
   */
  private cutsceneFadeUnits(): number {
    if (CUTSCENE_FADE_SWEEP) return CUTSCENE_FADE_SWEEP;
    const t = frameTime();
    return CUTSCENE_FADE_RATE[t] ?? t / Math.ceil(t / 2);
  }

  /** The `wait_time` the fade now running was started with. */
  private fadeUnits = CutscenePlayer.FADE_UNITS;

  private fadeClock(units: number): void {
    this.fadeOwed += units;
    while (this.fadeOwed >= this.fadeUnits) {
      this.fadeOwed -= this.fadeUnits;
      this.fadeStep();
    }
  }

  // -- everything below is what `screen.ts` and `seg008.ts` ask for ----------

  private install(): void {
    link();
    // A fresh `PRINCE.EXE` is what a cutscene is played by, so the
    // characters start where the C's BSS has them and no peel of the
    // level before is left waiting to be put back.
    g.Kid = newChar();
    g.Guard = newChar();
    g.Char = newChar();
    g.Opp = newChar();
    g.level = blankLevel();
    g.drawn_room = 1;
    g.room_L = 0; g.room_R = 0; g.room_A = 0; g.room_B = 0;
    g.room_AL = 0; g.room_AR = 0; g.room_BL = 0; g.room_BR = 0;
    g.is_blind_mode = 0;
    g.upside_down = 0;
    g.flash_time = 0;
    g.flash_color = 0;
    this.savedBackground = null;
    this.flashPending = false;
    this.flashOwed = 0;
    this.fade = null;
    this.roomOnly = false;
    free_peels();
    reset_tables();
    reset_stars();

    const tables = readExeTables(this.exe);
    setFrameTables(
      tables.frameTableKid, tables.frameTableGuard, tables.frameTableCutscene,
      tables.sequences, Array.from(tables.sequenceOffsets),
    );
    g.chtab_addrs = Array.from({ length: 10 }, (_, i) => {
      const set = this.banks.get(i);
      return set ? (set.images.slice(1) as never) : null;
    });

    this.palette.loadBlock(0, this.vgaPalette);
    for (const set of this.banks.values()) {
      this.palette.loadBlock(set.paletteBase, set.palette.vga);
    }

    out.play_sound = (which: number) => {
      g.current_sound = which;
      this.effects?.sound?.(which);
    };
    out.stop_sounds = () => { this.effects?.stopSounds?.(); };
    out.check_sound_playing = () => (this.effects?.soundPlaying?.() ? 1 : 0);

    setPainter({
      image: (chtab, id) => this.imageOf(chtab, id),
      blit: (chtab, id, x, y, blit) => this.blitSprite(chtab, id, x, y, blit),
      rect: (left, top, right, bottom, color) => {
        if (bottom > top) this.target.fillRect(left, top, right - left, bottom - top, color);
      },
      clip: (rect) => this.setClip(rect),
      text: () => {},
      readPeel: (left, top, right, bottom) => this.readPeel(left, top, right, bottom),
      restorePeel: (peel) => this.restorePeel(peel),
      target: (offscreen) => {
        this.target = offscreen ? this.offscreen : this.onscreen;
        this.setClip(this.clipRect);
      },
    });

    setScreen({
      copy_screen_rect: (l, t, r, b) => this.copyRect(l, t, r, b),
      present: () => this.copyRect(0, 0, 320, 200),
      /**
       * `load_intro` asks for the clip; only a scene played **before
       * a level** gets it.
       *
       * Three captures, three answers, and nothing but the captures
       * decides this. Rows 192 to 199, right through the
       * princess-room scene:
       *
       *     show_title's own pv_scene    (152,96,88) -- the floor
       *     expired()'s hourglass        (152,96,88) -- the floor
       *     the scene before level 2     black on every frame
       *
       * and in the last of those they were the **only** rows that
       * differed from the port at all: rows 97 to 179 of the same
       * pair of frames differ by five pixels in all, and with the
       * clip in they are the same picture to the pixel.
       *
       * What differs is the buffer the room is composed in.
       * `show_title` frees the offscreen and makes its own
       * (`make_offscreen_buffer(&screen_rect)`), which is the whole
       * 320 by 200, so `TITLE.DAT`'s 320 by 200 images and the
       * princess room both reach the bottom. A scene played where
       * `play_level` plays one gets the game's own offscreen, which
       * is the 192-row gameplay buffer -- the same 192
       * `copy_screen_rect` mirrors about when the screen is upside
       * down, which `invert2` settled -- so the room image is
       * clipped at 191 and the eight rows under it keep the black
       * `load_intro` painted over the screen before it began. Why
       * `expired()`, which is reached from `show_time` in the middle
       * of a level, draws all two hundred is not accounted for; the
       * capture says it does.
       *
       * **`end_sequence` clips, and that is a capture and not a
       * guess.** It had never been captured when this was written.
       * It has now -- thirteen `shift+l` and then four `h`, because
       * `check_the_end` runs `end_sequence()` when the *drawn* room
       * of level 14 is 5 and `h` is what sets `next_room` -- and the
       * frames of the princess's room come out matching the port
       * everywhere above row 192 and differing on **every one of the
       * 320 pixels of rows 192 to 199**, which are black in the
       * capture and the floor of the room in the port. Frame for
       * frame, 2560 of the 3100 pixels that differed were those
       * eight rows. It is the same fault the six level cutscenes had
       * and the same cure, and it is a thing the player sees: the
       * end of the game is the one scene he has earned.
       */
      clip_room: (on) => {
        this.roomOnly = on
          && (this.scene.kind === 'level' || this.scene.kind === 'ending');
      },
      rect: (l, t, r, b, color) => {
        this.target.fillRect(l, t, r - l, b - t, color);
      },
      clear_screen: () => {
        this.offscreen.clear(0);
        this.onscreen.clear(0);
      },
      clear_screen_and_sounds: () => {
        out.stop_sounds();
        this.offscreen.clear(0);
        this.onscreen.clear(0);
      },
      set_bg_attr: (color) => this.setBackground(color),
      fade_start: (dir, rows, waitTime) => this.fadeStart(dir, rows, waitTime),
      fade_active: () => this.fade !== null,
      blit_image: (chtab, id, x, y, blit) => this.blitSprite(chtab, id, x, y, blit),
      load_intro_images: (which) => this.loadIntroImages(which),
      free_intro_images: () => {},
      now: () => this.elapsed,
      draw_full_image: (id) => this.drawFullImage(id),
      load_title_images: (bgcolor) => this.loadTitleImages(bgcolor),
      release_title_images: () => {},
      target: (offscreen) => {
        this.target = offscreen ? this.offscreen : this.onscreen;
        this.setClip(this.clipRect);
      },
      show_text: (l, t, r, b, xa, ya, text, color) => {
        if (!this.font) return;
        drawTextInRect(this.target, this.font, text, l, t, r, b, xa, ya, color);
      },
      text_center_y: (t, b) => (this.font ? textCenterY(this.font, t, b) : 0),
      char_width: (ch) => (this.font ? charWidth(this.font, ch.charCodeAt(0)) : 0),
      cstring_width: (text) => (this.font ? lineWidth(this.font, text) : 0),
      draw_text_character: (x, y, ch, color) => (this.font
        ? drawTextCharacter(this.target, this.font, ch.charCodeAt(0), x, y, color)
        : 0),
      read_peel: (l, t, r, b) => this.readTargetPeel(l, t, r, b),
      restore_peel: (peel) => this.restoreTargetPeel(peel),
      start_text_input: () => { this.textInput = true; this.keys.length = 0; },
      stop_text_input: () => { this.textInput = false; this.keys.length = 0; },
      take_key: () => this.keys.shift() ?? null,
      /**
       * `clear_kbd_buf()` is `last_key_scancode = last_text_input = 0`:
       * it drops the one key that was just read, which `take_key` has
       * already taken off the queue. Emptying the queue here instead
       * loses every key the player typed before the scene's clock next
       * ran, which on a page is most of a quickly typed name.
       */
      clear_kbd_buf: () => {},
      hof_read_file: () => readHofFile(),
      hof_write_file: (bytes) => { writeHofFile(bytes); },
    });
  }

  /**
   * `read_peel_from_screen` and `restore_peel`, which both work on
   * `current_target_surface`. The ending reads its peel off the
   * offscreen surface and puts it back on the onscreen one, which is
   * where `input_str` has just been drawing.
   */
  private readTargetPeel(
    left: number, top: number, right: number, bottom: number,
  ): ScreenPeel {
    const x0 = Math.max(0, Math.min(320, left));
    const x1 = Math.max(x0, Math.min(320, right));
    const y0 = Math.max(0, Math.min(200, top));
    const y1 = Math.max(y0, Math.min(200, bottom));
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      pixels.set(this.target.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width);
    }
    return { left: x0, top: y0, width, height, pixels } satisfies Peel;
  }

  private restoreTargetPeel(peel: ScreenPeel): void {
    const p = peel as Peel | null;
    if (!p) return;
    for (let y = 0; y < p.height; y++) {
      this.target.pixels.set(
        p.pixels.subarray(y * p.width, (y + 1) * p.width),
        (p.top + y) * 320 + p.left,
      );
    }
  }

  /**
   * `load_chtab_from_file(id_chtab_4_..., 50*which_imgs + 850, ...)`.
   *
   * The one bank a cutscene picks between: 850 is Jaffar for the
   * story the title tells, 900 the princess for every other scene.
   */
  private loadIntroImages(which_imgs: number): void {
    const set = which_imgs ? this.princessInCutscenes : this.jaffarInStory;
    if (!set) return;
    this.banks.set(chtabs.id_chtab_4_jaffarinstory_princessincutscenes, set);
    g.chtab_addrs[chtabs.id_chtab_4_jaffarinstory_princessincutscenes] =
      set.images.slice(1) as never;
    this.palette.loadBlock(set.paletteBase, set.palette.vga);
  }

  /**
   * `load_title_images(bgcolor)`: the two banks of `TITLE.DAT`, and
   * the one colour the original pokes into the story bank by hand --
   * the frame's background, dark blue for the opening and dark red
   * for the ending.
   */
  private loadTitleImages(bgcolor: number): void {
    if (this.title40) this.palette.loadBlock(this.title40.paletteBase, this.title40.palette.vga);
    if (this.title50) this.palette.loadBlock(this.title50.paletteBase, this.title50.palette.vga);
    const at = ROW.title40 * 16 + 14;
    if (bgcolor) this.palette.setEntry(at, 0x04, 0x00, 0x18);
    else this.palette.setEntry(at, 0x20, 0x00, 0x00);
  }

  // seg000:1DF8
  private drawFullImage(id: number): void {
    const spec = FULL_IMAGE[id];
    if (!spec) return;
    const bank = spec.bank === 40 ? this.title40 : this.title50;
    const image = bank?.images[spec.id + 1];
    if (!bank || !image) return;
    if (spec.blit === blitters.blitters_white) {
      this.target.blitMono(image, spec.xpos, spec.ypos, STORY_TEXT_COLOR);
    } else if (spec.blit === blitters.blitters_10h_transp) {
      this.target.blitTransparent(image, spec.xpos, spec.ypos, bank.paletteBase);
    } else {
      this.target.blitOpaqueBlack(image, spec.xpos, spec.ypos, bank.paletteBase);
    }
  }

  /** `method_1_blit_rect(onscreen_surface_, offscreen_surface, ...)`. */
  /** `clip_room`: a `load_intro` scene never reaches past row 191. */
  private roomOnly = false;

  private copyRect(left: number, top: number, right: number, bottom: number): void {
    const x0 = Math.max(0, left);
    const x1 = Math.min(320, right);
    const y0 = Math.max(0, top);
    const y1 = Math.min(this.roomOnly ? 192 : 200, bottom);
    for (let y = y0; y < y1; y++) {
      this.onscreen.pixels.set(
        this.offscreen.pixels.subarray(y * 320 + x0, y * 320 + x1), y * 320 + x0,
      );
    }
  }

  private setBackground(color: number): void {
    if (color === 0) {
      // `remove_flash`: taken at the top of the next frame, so that
      // the frame this was asked on is drawn with the colour up.
      this.flashPending = this.savedBackground !== null;
      this.flashOwed = CutscenePlayer.FLASH_UNITS;
      return;
    }
    if (!this.savedBackground) this.savedBackground = this.palette.entry(0);
    this.palette.setEntry(0, ...this.palette.entry(color));
  }

  // seg009:1A51 / seg009:1D28
  private fadeStart(dir: 'in' | 'out', rows: number, waitTime = 2): void {
    this.fadeUnits = waitTime === 0 ? this.cutsceneFadeUnits() : waitTime;
    this.fadeOwed = 0;
    const original = this.palette.rgb6.slice();
    const faded = original.slice();
    this.copyRect(0, 0, 320, 200);
    if (dir === 'in') {
      for (let row = 0; row < 16; row++) {
        if (!(rows & (1 << row))) continue;
        faded.fill(0, row * 16 * 3, (row * 16 + 16) * 3);
      }
      this.applyFade(faded, rows);
    }
    this.fade = { dir, rows, pos: dir === 'in' ? 0x40 : 0, original, faded };
  }

  // seg009:1B88 / seg009:1DF7
  private fadeStep(): void {
    const f = this.fade;
    if (!f) return;
    if (f.dir === 'in') {
      --f.pos;
      for (let row = 0; row < 16; row++) {
        if (!(f.rows & (1 << row))) continue;
        for (let i = row * 16 * 3; i < (row * 16 + 16) * 3; i++) {
          if (f.original[i] > f.pos) ++f.faded[i];
        }
      }
      this.applyFade(f.faded, f.rows);
      if (f.pos === 0) {
        this.palette.loadBlock(0, this.rowsOf(f.original, 0, 256));
        this.fade = null;
        this.copyRect(0, 0, 320, 200);
      }
      return;
    }
    let finished = true;
    for (let row = 0; row < 16; row++) {
      if (!(f.rows & (1 << row))) continue;
      for (let i = row * 16 * 3; i < (row * 16 + 16) * 3; i++) {
        if (f.faded[i] !== 0) { --f.faded[i]; finished = false; }
      }
    }
    this.applyFade(f.faded, f.rows);
    if (finished) {
      this.palette.loadBlock(0, this.rowsOf(f.original, 0, 256));
      this.fade = null;
      // `pal_restore_free_fadeout`: the screen is left black.
      this.onscreen.clear(0);
    }
  }

  private rowsOf(rgb6: Uint8Array, from: number, count: number) {
    const outp = [];
    for (let i = from; i < from + count; i++) {
      outp.push({ r: rgb6[i * 3], g: rgb6[i * 3 + 1], b: rgb6[i * 3 + 2] });
    }
    return outp;
  }

  private applyFade(faded: Uint8Array, rows: number): void {
    for (let row = 0; row < 16; row++) {
      if (!(rows & (1 << row))) continue;
      this.palette.loadBlock(row * 16, this.rowsOf(faded, row * 16, 16));
    }
  }

  private imageOf(chtab: number, id: number): { width: number; height: number } | null {
    return this.banks.get(chtab)?.images[id + 1] ?? null;
  }

  private blitSprite(chtab: number, id: number, x: number, y: number, blit: number): void {
    const bank = this.banks.get(chtab);
    const found = bank?.images[id + 1];
    if (!bank || !found) return;
    let sprite: { width: number; height: number; pixels: Uint8Array } = found;
    const base = bank.paletteBase;
    if (blit & FLIPPED) {
      sprite = flipHorizontally(sprite);
      blit &= ~FLIPPED;
    }
    if (blit === blitters.blitters_9_black) this.target.blitMono(sprite, x, y, 0);
    else if (blit === blitters.blitters_3_xor) this.target.blitXor(sprite, x, y, base);
    else if (blit >= blitters.blitters_40h_mono) this.target.blitMono(sprite, x, y, blit & 0x0f);
    else if (blit === blitters.blitters_2_or) this.target.blitOr(sprite, x, y, base);
    else if (blit === blitters.blitters_10h_transp) this.target.blitTransparent(sprite, x, y, base);
    else this.target.blitOpaqueBlack(sprite, x, y, base);
  }

  private setClip(rect: RectType | null): void {
    this.clipRect = rect;
    const s = this.target;
    s.clipTop = rect ? rect.top : 0;
    s.clipBottom = rect ? Math.min(rect.bottom, 200) : 200;
    s.clipLeft = rect ? rect.left : 0;
    s.clipRight = rect ? rect.right : 320;
  }

  private readPeel(left: number, top: number, right: number, bottom: number): Peel {
    const x0 = Math.max(0, Math.min(320, left));
    const x1 = Math.max(x0, Math.min(320, right));
    const y0 = Math.max(0, Math.min(200, top));
    const y1 = Math.max(y0, Math.min(200, bottom));
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      pixels.set(this.offscreen.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width);
    }
    return { left: x0, top: y0, width, height, pixels };
  }

  private restorePeel(peel: Peel): void {
    for (let y = 0; y < peel.height; y++) {
      this.offscreen.pixels.set(
        peel.pixels.subarray(y * peel.width, (y + 1) * peel.width),
        (peel.top + y) * 320 + peel.left,
      );
    }
  }
}

/**
 * `fopen(hof_path, "rb")` and the two `fread`s, over `localStorage`.
 *
 * Every one of these can throw: a page opened in private browsing
 * throws on the first touch of `localStorage` in some browsers, and
 * one served from a file URL has none at all. The original treats a
 * `PRINCE.HOF` it cannot open as an empty hall of fame and carries on,
 * and so does this -- the player still types a name and still gets
 * out of the screen, and nothing is kept.
 */
function readHofFile(): Uint8Array | null {
  try {
    const stored = globalThis.localStorage?.getItem(HOF_STORAGE_KEY);
    if (stored == null) return null;
    const binary = atob(stored);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** `fopen(hof_path, "wb")` and the two `fwrite`s. */
function writeHofFile(bytes: Uint8Array): void {
  try {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    globalThis.localStorage?.setItem(HOF_STORAGE_KEY, btoa(binary));
  } catch {
    // `perror(hof_path)`: the original says so and goes on.
  }
}

export { full_image_id };
