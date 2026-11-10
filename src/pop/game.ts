/**
 * The seam between the translation and everything round it.
 *
 * `src/pop` is SDLPoP with its globals and its own names; the page,
 * the recorder and the whole measuring apparatus speak to a `Game`
 * object. This is the piece in between, and it is deliberately thin:
 * it loads the level with the port's own loader, hands the sprite
 * banks and the screen to the translation, turns the player's keys
 * into the three `control_` globals, and calls `play_frame` once.
 *
 * Nothing here is a translation of anything. Where it has to make a
 * decision the C makes somewhere else -- when the screen is drawn
 * whole, what `start_level` does -- it says so and says which function
 * it stands in for.
 */
import type { Assets } from '../render/assets.ts';
import { Surface, type ScreenPalette } from '../render/surface.ts';
import { buildLevelScene, type LevelScene } from '../game/scene.ts';
import { readExeTables } from '../game/exe-tables.ts';
import { flipHorizontally } from '../render/room.ts';
import { readFont, drawTextCentred, type Font } from '../render/font.ts';

import { g, newChar, resetGlobals, type RectType } from './state.ts';
import { chtabs, blitters, directions } from './types.ts';
import { setFrameTables, loadkid, savekid, loadshad, saveshad } from './seg006.ts';
import {
  setPainter, levelType as drawLevelType, mirror as drawMirror,
  redraw_room, draw_moving, draw_tables,
  get_room_address, mobs as drawMobs, FLIPPED, reset_tables, hp as drawHp,
  show_level, display_text_bottom, erase_bottom_text, type Peel,
} from './seg008.ts';
import { out as outSlots } from './link.ts';
import { clear_tile_wipes, levelType as looseLevelType, resetSeg007 } from './seg007.ts';
import { do_startpos, find_start_level_door, pos_guards, timers, dist as seg003dist, rooms as seg003rooms } from './seg003.ts';
import {
  guards as guardTables, enter_guard, char_opp_dist, goto_other_room,
  autocontrol_opponent, clear_char, on_guard_killed, inc_curr_row,
  control_guard_inactive, load_room_links, hp as guardHp, guardColor,
} from './seg002.ts';
import { control, seqtbl_offset_char, spiked, do_fall, dist as seg005dist } from './seg005.ts';
import { clear_coll_rooms, resetSeg004 } from './seg004.ts';
import {
  start_chompers, make_loose_fall, trigger_button, is_spike_harmful,
  start_anim_spike, set_wipe, set_redraw_full, set_redraw_fore, set_redraw2,
  set_redraw_floor_overlay, set_redraw_anim, died_on_button, draw_mobs,
} from './seg007.ts';
import {
  play_frame, check_the_end, screen, redraw_screen, anim_tile_modif, draw_hp,
  draw_kid_hp, draw_guard_hp, add_life, gen_palace_wall_colors,
} from './seg000.ts';
import { add_objtable, mark_obj_tile_redraw, resetSeg008 } from './seg008.ts';
import { l2, l5, l6, l7, l8, out } from './link.ts';
import { set_seed } from './seg009.ts';

/** `tbl_guard_hp` and `tbl_guard_type`, read out of PRINCE.EXE. */
import { readExeConstants } from '../game/exe-constants.ts';

export interface Controls {
  x: number;
  y: number;
  shift: boolean;
}

/** What the shell can tell the game about itself. */
export interface PopOptions {
  readonly prefix?: string;
  readonly effects?: PopEffects;
}

/** `play_sound` and `stop_sounds`, for a shell that has a speaker. */
export interface PopEffects {
  sound?(which: number): void;
  /** `check_sound_playing`: is there still something in the channel? */
  soundPlaying?(): boolean;
  /**
   * `stop_sounds`: empty the one channel.
   *
   * The game asks for this when the level door has finished opening and
   * when the Prince is put back on his feet, and the slot used to go
   * nowhere, so a sample ran on past the thing that made it.
   */
  stopSounds?(): void;
}

/** Which sprite bank each `chtab` id is. */
const CHTAB_NAME = [
  'sword', 'flameSwordPotion', 'kid', null, null, 'guard', 'environment',
  'environmentWall', null, null,
] as const;

let linked = false;

/** Fill in the slots that cross a cycle between segments. */
function link(): void {
  if (linked) return;
  linked = true;
  l7.start_chompers.fn = start_chompers;
  l7.make_loose_fall.fn = make_loose_fall;
  l7.trigger_button.fn = trigger_button;
  l7.is_spike_harmful.fn = is_spike_harmful;
  l7.start_anim_spike.fn = start_anim_spike;
  l8.set_wipe.fn = set_wipe;
  l8.set_redraw_full.fn = set_redraw_full;
  l8.set_redraw_fore.fn = set_redraw_fore;
  l8.set_redraw2.fn = set_redraw2;
  l8.set_redraw_floor_overlay.fn = set_redraw_floor_overlay;
  l8.set_redraw_anim.fn = set_redraw_anim;
  l8.get_room_address.fn = get_room_address;
  l8.add_objtable.fn = add_objtable;
  l8.mark_obj_tile_redraw.fn = mark_obj_tile_redraw;
  l5.do_fall.fn = do_fall;
  l5.spiked.fn = spiked;
  l5.control.fn = control;
  l5.seqtbl_offset_char.fn = seqtbl_offset_char;
  l6.control_guard_inactive.fn = control_guard_inactive;
  l2.autocontrol_opponent.fn = autocontrol_opponent;
  l2.clear_char.fn = clear_char;
  l2.died_on_button.fn = died_on_button;
  l2.set_start_pos.fn = () => {};
  l2.on_guard_killed.fn = on_guard_killed;
  l2.inc_curr_row.fn = inc_curr_row;
  seg003dist.char_opp_dist = char_opp_dist;
  seg005dist.char_opp_dist = char_opp_dist;
  seg003rooms.goto_other_room = goto_other_room;
  drawMobs.draw_mobs = draw_mobs;
  drawHp.draw_hp = draw_hp;
  guardHp.draw_guard_hp = draw_guard_hp;
  guardHp.add_life = add_life;
  l2.add_life.fn = add_life;
}

/** How long `play_death_music` sounds, in ticks. */
const DEATH_MUSIC_TICKS = 36;

/**
 * The strip of words under the room.
 *
 * `rect_bottom_text` is {193, 70, 202, 250} and `show_text` centres in
 * it with the line sitting on the bottom: `LEVEL 1` is forty-one pixels
 * wide and the capture has it at x 139, which is 70 + (180-41)/2.
 */
const TEXT_RECT = { top: 193, left: 70, bottom: 202, right: 250 };
const TEXT_WHITE = 15;

export class PopGame {
  readonly scene: LevelScene;
  private readonly surface = new Surface();
  private readonly levelNumber: number;
  /** `custom->intro_music_level`: the level whose opening has music. */
  private introMusicLevel = 1;
  /** `is_restart_level`, which the shell acts on between ticks. */
  restartDue = false;
  /** The first tick of a level does nothing, as the original's does. */
  private pendingFirstTick = true;
  /** The screen has to be drawn whole: `need_full_redraw`. */
  private needFullRedraw = true;
  /**
   * Whether the next full redraw paints the room out first.
   *
   * `draw_game_frame` clears only when the room has changed. The
   * shell's own look-around changes the room too, and did not say so:
   * the room before it was left underneath and the new one drawn over
   * the top, so a palace room came up with another room's torches and
   * floors showing through it.
   */
  private fullRedrawClears = false;
  /** The game's own font, out of the executable. */
  private font?: Font;
  /** `draw_level_first` has still to put the hit points up. */
  private firstDraw = false;
  /** Where `play_sound` goes, if the shell has a speaker. */
  private effects?: PopEffects;
  /** `current_target_surface`: the room's 192 rows, or the whole screen. */
  private roomTarget = false;
  /**
   * How much of the death music is left to play.
   *
   * `play_kid` counts `Char.alive` up a tick at a time once the Prince
   * is dead, starts the music at six, and will not go past seven while
   * `check_sound_playing()` says something is still sounding -- so
   * `Press Button to Continue` comes up seven ticks after the death
   * plus the length of the music. A replay has no sound, so this
   * stands in for it.
   *
   * Measured as the gap between the tick the Prince dies and the tick
   * the words appear in the captures: 25c4ebb8 46, 5920a8c2 47,
   * 756b259c 47, 9b60bf3a 49, 13ab6867 52.
   */
  private deathMusic = 0;
  private clipRect: RectType | null = null;
  /**
   * Renders that do not count against the words under the room.
   *
   * The level's opening picture is on the screen for two frames: the
   * one `draw_level_first` drew it on, and the one the level's first
   * tick does nothing in -- see `pendingFirstTick`. Neither is a
   * `draw_game_frame`, so neither spends one of `LEVEL 1`'s twenty-four
   * ticks. Measured: the capture has `LEVEL 1` on ticks 0 to 24,
   * nothing on 25, and `60 MINUTES LEFT` from 26 to 48.
   */
  private textTicksToSkip = 0;

  private constructor(scene: LevelScene, levelNumber: number) {
    this.scene = scene;
    this.levelNumber = levelNumber;
  }

  static async start(
    assets: Assets, exe: Uint8Array, levelNumber: number,
    options: PopOptions = {},
  ): Promise<PopGame> {
    // Before anything else, and before the loader fills the sprite
    // banks: a game begins with the globals the class declares, not
    // with whatever the game before it left in them.
    resetGlobals();
    resetSeg004();
    resetSeg007();
    resetSeg008();
    link();
    const scene = await buildLevelScene(assets, exe, levelNumber, options.prefix ?? 'V');
    const game = new PopGame(scene, levelNumber);
    game.effects = options.effects;
    game.install(exe);
    game.startLevel();
    return game;
  }

  /**
   * The level again, as the original restarts it after a death.
   *
   * `init_game` resets the clock and the hit points the level starts
   * with, and it is called once: the restart happens inside
   * `play_level`'s own loop, which never goes back out to it. So an
   * hour is an hour for the whole game, however many times the Prince
   * dies, and the capture of `probeF` says `59 MINUTES LEFT` where a
   * port that started the clock again says `60`.
   */
  async restart(assets: Assets, exe: Uint8Array): Promise<PopGame> {
    const carried = {
      rem_min: g.rem_min,
      rem_tick: g.rem_tick,
      hitp_beg_lev: g.hitp_beg_lev,
      checkpoint: g.checkpoint,
    };
    const game = await PopGame.start(assets, exe, this.levelNumber, { effects: this.effects });
    g.rem_min = carried.rem_min;
    g.rem_tick = carried.rem_tick;
    g.checkpoint = carried.checkpoint;
    if (carried.hitp_beg_lev !== g.hitp_beg_lev) {
      g.hitp_beg_lev = carried.hitp_beg_lev;
      g.hitp_max = carried.hitp_beg_lev;
      g.hitp_curr = carried.hitp_beg_lev;
      g.hitp_delta = 1;
    }
    // Beginning a level again is not an opening, and does not wait for
    // one: the Prince stands straight up.
    g.need_level1_music = 0;
    return game;
  }

  /** `start_level`: the level's data into the globals, once. */
  private install(exe: Uint8Array): void {
    const tables = readExeTables(exe);
    this.font = readFont(exe);
    setFrameTables(
      tables.frameTableKid, tables.frameTableGuard, tables.frameTableCutscene,
      tables.sequences, Array.from(tables.sequenceOffsets),
    );
    const constants = readExeConstants(exe);
    this.introMusicLevel = constants.introMusicLevel;
    const level = this.scene.level;
    const type = this.scene.options.levelType;
    drawLevelType.of = () => type;
    looseLevelType.of = () => type;
    drawMirror.level = constants.mirrorLevel;
    drawMirror.room = constants.mirrorRoom;
    guardTables.hp = (n) => constants.guardHitPoints[n] ?? 0;
    /**
     * `tbl_guard_type`, and it used to be two levels' worth of wrong.
     *
     * The shell's `GUARD_TYPE_BY_LEVEL` already holds the C's own
     * numbering -- 0 a guard, 1 the fat one, 2 a skeleton, 3 the
     * vizier, 4 the shadow -- and this handed the translation
     * `guardType === 4 ? 2 : 0`, which says the shadow of level 12 is
     * a skeleton and the skeletons of level 3 are ordinary guards.
     *
     * `enter_guard` reads it twice. A skeleton comes back with his
     * sword drawn and `seq_63_guard_active_after_fall`; a guard comes
     * back sheathed and standing idle. So the skeleton knocked into
     * the pit on level 3 climbed out as a guard who would not fight,
     * which is exactly what it looked like. The other reading of it
     * decides who gets recoloured, and only an ordinary guard does.
     */
    guardTables.type = () => this.scene.guardType;

    // The level's tiles are the ones `LevelState` keeps, so that the
    // page and the translation are looking at the same bytes.
    g.level = {
      fg: this.scene.state.fg,
      bg: this.scene.state.modifiers,
      doorlinks1: Uint8Array.from(level.doorLinks1),
      doorlinks2: Uint8Array.from(level.doorLinks2),
      roomlinks: Array.from({ length: 24 }, (_, i) => ({
        left: level.roomLinks[i * 4],
        right: level.roomLinks[i * 4 + 1],
        up: level.roomLinks[i * 4 + 2],
        down: level.roomLinks[i * 4 + 3],
      })),
      start_room: level.startRoom,
      start_pos: level.startPos,
      start_dir: level.startDir,
      guards_tile: Uint8Array.from(level.guards.map((x) => x.tile)),
      guards_dir: Uint8Array.from(level.guards.map((x) => x.dir & 0xff)),
      guards_x: Uint8Array.from(level.guards.map((x) => x.x)),
      guards_seq_lo: Uint8Array.from(level.guards.map((x) => x.seqLo)),
      guards_skill: Uint8Array.from(level.guards.map((x) => x.skill)),
      guards_seq_hi: Uint8Array.from(level.guards.map((x) => x.seqHi)),
      guards_color: Uint8Array.from(level.guards.map((x) => x.color)),
    };

    // `chtab_addrs[chtab]->images[id]`, and the port's own banks keep a
    // blank at index nought, so the slice is what makes `get_image`'s
    // id and this one the same id. Getting that wrong gave
    // `set_char_collision` the width of the frame before this one.
    g.chtab_addrs = CHTAB_NAME.map((name) => {
      if (!name) return null;
      const set = (this.scene.chtabs as unknown as Record<string, { images: readonly (unknown)[] } | undefined>)[name];
      return set ? (set.images.slice(1) as never) : null;
    });

    outSlots.display_text_bottom = display_text_bottom;
    outSlots.erase_bottom_text = erase_bottom_text;
    outSlots.play_death_music = () => { this.deathMusic = DEATH_MUSIC_TICKS; };
    outSlots.play_sound = (which: number) => {
      // `play_next_sound` keeps `current_sound` as it takes each one,
      // and `play_kid` reads it: a Prince who dies while a gate is
      // opening does not wait for the gate to finish sounding. The
      // translation read it and nothing ever wrote it, so that one
      // exception never applied.
      g.current_sound = which;
      this.effects?.sound?.(which);
    };
    outSlots.stop_sounds = () => { this.effects?.stopSounds?.(); };
    /**
     * `check_sound_playing`.
     *
     * The death music is still the model the capture pins were
     * measured with -- a count of ticks, not a real sound -- and it
     * stays. What is added is the shell's own answer, so that the
     * music the page really is playing holds the game where the
     * original holds it: the Prince stays crouched at the start of
     * level 1 until the opening has finished. Where there is no
     * shell, and so no sound, nothing changes.
     */
    outSlots.check_sound_playing = () => (
      this.deathMusic > 0 || this.effects?.soundPlaying?.() ? 1 : 0
    );
    setPainter({
      image: (chtab, id) => this.imageOf(chtab, id),
      blit: (chtab, id, x, y, blit) => this.blit(chtab, id, x, y, blit),
      rect: (left, top, right, bottom, color) => {
        const floor = this.roomTarget ? 192 : 200;
        const low = Math.min(bottom, floor);
        if (low > top) this.surface.fillRect(left, top, right - left, low - top, color);
      },
      clip: (rect) => this.setClip(rect),
      text: (text) => this.drawBottomText(text),
      readPeel: (left, top, right, bottom) => this.readPeel(left, top, right, bottom),
      restorePeel: (peel) => this.restorePeel(peel),
      target: (room) => { this.roomTarget = room; this.setClip(this.clipRect); },
    });

    g.current_level = this.levelNumber;
    g.next_level = this.levelNumber;
    // `prandom`'s seed is the clock in the original. A replay wants it
    // the same every time, and the capture it is measured against was
    // taken from one particular run of it, so neither value is more
    // right than the other; this one at least is reproducible.
    set_seed(1);
    g.hitp_beg_lev = constants.startHitPoints ?? 3;
    // `init_game`: the hour the level is played against.
    g.rem_min = 60;
    g.rem_tick = 719;
    g.text_time_remaining = 0;
    g.text_time_total = 0;
    g.is_show_time = 0;
    g.seamless = 0;
    g.Kid = newChar();
    g.Guard = newChar();
    g.Char = newChar();
    g.Opp = newChar();
    g.objtable = [];
    g.trobs = [];
    g.trobs_count = 0;
    g.mobs = [];
    g.mobs_count = 0;
    g.wipetable = [];
    g.wipetable_count = 0;
    g.leveldoor_open = 0;
    g.exit_room_timer = 0;
    g.have_sword = 0;
    clear_coll_rooms();
    clear_tile_wipes();
  }

  /** `start_level` proper: `do_startpos` and the room it opens in. */
  private startLevel(): void {
    // `init_game`'s last few lines, which run before `do_startpos`.
    g.united_with_shadow = 0;
    g.flash_time = 0;
    g.leveldoor_open = 0;
    g.guardhp_curr = 0;
    g.hitp_delta = 0;
    g.Guard.charid = 2; // charid_2_guard
    g.Guard.direction = 0x56; // dir_56_none
    loadkid();
    do_startpos();
    // `have_sword = (level_number == 0 || level_number >= 2)`: the
    // Prince starts every level but the first with a sword in his hand.
    g.have_sword = (this.levelNumber === 0 || this.levelNumber >= 2) ? 1 : 0;
    /**
     * `need_level1_music = (level == custom->intro_music_level)`.
     *
     * It holds the Prince crouched at the start of the level while the
     * opening plays, and `control_crouched` lets him up when the
     * channel falls quiet. `restart` clears it, because beginning a
     * level again is not an opening and does not wait for one.
     *
     * Only where there is a speaker. A shell with no sound -- the
     * measuring apparatus, every test that is not the browser's --
     * would still spend the two ticks it takes to find that the
     * channel is empty, and those two ticks are at the start of every
     * level-1 recording the captures are compared against.
     */
    g.need_level1_music = this.effects?.sound && this.levelNumber === this.introMusicLevel
      ? 1 : 0;
    g.drawn_room = g.Kid.room;
    load_room_links();
    get_room_address(g.drawn_room);
    find_start_level_door();
    pos_guards();
    anim_tile_modif();
    loadkid();
    start_chompers();
    enter_guard();
    // `draw_level_first`: a palace wall's brick colours are rolled
    // once for the room, before the room is drawn.
    if (drawLevelType.of(g.current_level)) gen_palace_wall_colors();
    redraw_screen();
    // `draw_level_first`: the whole screen black, the level's number in
    // the strip under the room, the room drawn, the hit points put up.
    this.surface.clear(0);
    show_level();
    this.firstDraw = true;
    this.textTicksToSkip = 1;
  }

  /**
   * `show_text(&rect_bottom_text, halign_center, valign_bottom, ...)`,
   * and `draw_rect(&rect_bottom_text, color_0_black)` before it.
   */
  private drawBottomText(text: string | null): void {
    this.surface.fillRect(
      TEXT_RECT.left, TEXT_RECT.top,
      TEXT_RECT.right - TEXT_RECT.left, TEXT_RECT.bottom - TEXT_RECT.top, 0,
    );
    if (text === null || !this.font) return;
    drawTextCentred(
      this.surface, this.font, text,
      TEXT_RECT.left, TEXT_RECT.right - 1, TEXT_RECT.top, TEXT_WHITE,
    );
  }

  private imageOf(chtab: number, id: number): { width: number; height: number } | null {
    const name = CHTAB_NAME[chtab];
    if (!name) return null;
    const set = (this.scene.chtabs as unknown as Record<string, { images: readonly ({ width: number; height: number } | null)[] } | undefined>)[name];
    return set?.images[id + 1] ?? null;
  }

  private spriteOf(chtab: number, id: number) {
    const name = CHTAB_NAME[chtab];
    if (!name) return null;
    const set = (this.scene.chtabs as unknown as Record<string, { images: readonly ({ width: number; height: number; pixels: Uint8Array } | null)[]; paletteBase: number } | undefined>)[name];
    const image = set?.images[id + 1];
    return image ? { image, base: set!.paletteBase } : null;
  }

  private setClip(rect: RectType | null): void {
    this.clipRect = rect;
    const floor = this.roomTarget ? 192 : 200;
    if (rect) {
      this.surface.clipTop = rect.top;
      this.surface.clipBottom = Math.min(rect.bottom, floor);
      this.surface.clipLeft = rect.left;
      this.surface.clipRight = rect.right;
    } else {
      this.surface.clipTop = 0;
      this.surface.clipBottom = floor;
      this.surface.clipLeft = 0;
      this.surface.clipRight = 320;
    }
  }

  private blit(chtab: number, id: number, x: number, y: number, blit: number): void {
    const found = this.spriteOf(chtab, id);
    if (!found) return;
    let sprite = found.image;
    if (blit & FLIPPED) {
      sprite = flipHorizontally(sprite);
      blit &= ~FLIPPED;
    }
    if (blit === blitters.blitters_9_black) {
      this.surface.blitMono(sprite, x, y, 0);
      return;
    }
    if (blit === blitters.blitters_3_xor) {
      this.surface.blitXor(sprite, x, y, found.base);
      return;
    }
    if (blit === blitters.blitters_46h_mono_6
      && chtab === chtabs.id_chtab_7_environmentwall) {
      // The decals between a palace wall's bricks.
      //
      // They are asked for with a mono blitter, and filling them with
      // the sixth colour of the screen paints them a hard orange-red:
      // measured against a capture of level 4, every one of the 620
      // pixels that differed was that red where the original has one
      // pale sand, and drawing the sprite in its own colours leaves
      // 407 of them one shade too light. The shade the capture has is
      // colour 14 of the wall's own bank, so that is what they are
      // filled with.
      this.surface.blitMono(sprite, x, y, found.base + 14);
      return;
    }
    if (blit >= blitters.blitters_40h_mono) {
      // A mono blit in one of the sixteen colours: the low bits are the
      // colour and the rest is the flag.
      this.surface.blitMono(sprite, x, y, blit & 0x0f);
      return;
    }
    if (blit === blitters.blitters_10h_transp || blit === blitters.blitters_2_or) {
      this.surface.blitTransparent(sprite, x, y, found.base);
      return;
    }
    this.surface.blitOpaque(sprite, x, y, found.base);
  }

  /**
   * `read_peel_from_screen` and `restore_peel`.
   *
   * How the original rubs out a moving thing: before a character is
   * drawn, the rectangle it is about to cover is read off the screen,
   * and at the top of the next frame's `draw_tables` it is put back.
   * Nothing else erases a character -- `redraw_at_char` only marks the
   * tiles whose *foreground* has to go on again -- so without this the
   * Prince leaves a copy of himself behind on every tick.
   */
  private readPeel(left: number, top: number, right: number, bottom: number) {
    const x0 = Math.max(0, Math.min(320, left));
    const x1 = Math.max(x0, Math.min(320, right));
    const y0 = Math.max(0, Math.min(200, top));
    const y1 = Math.max(y0, Math.min(200, bottom));
    const width = x1 - x0;
    const height = y1 - y0;
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      pixels.set(
        this.surface.pixels.subarray((y0 + y) * 320 + x0, (y0 + y) * 320 + x1),
        y * width,
      );
    }
    return { left: x0, top: y0, width, height, pixels };
  }

  private restorePeel(peel: Peel): void {
    for (let y = 0; y < peel.height; y++) {
      this.surface.pixels.set(
        peel.pixels.subarray(y * peel.width, (y + 1) * peel.width),
        (peel.top + y) * 320 + peel.left,
      );
    }
  }

  /** The player pressing the button after a death. */
  pressButton(): void {
    if (g.Kid.alive >= 0) this.restartDue = true;
  }

  step(controls: Controls): void {
    if (this.pendingFirstTick) {
      this.pendingFirstTick = false;
      return;
    }
    g.control_x = controls.x < 0 ? -1 : controls.x > 0 ? 1 : 0;
    g.control_y = controls.y < 0 ? -1 : controls.y > 0 ? 1 : 0;
    g.control_shift = controls.shift ? -1 : 0;
    g.guardhp_delta = 0;
    g.hitp_delta = 0;
    if (this.deathMusic > 0) --this.deathMusic;
    timers();
    play_frame();
    if (g.is_restart_level) {
      g.is_restart_level = 0;
      this.restartDue = true;
    }
  }

  /** `redraw_screen(drawing_different_room)`. */
  /**
   * `set_chtab_palette(chtab_addrs[id_chtab_5_guard], &guard_palettes[
   * 0x30 * curr_guard_color - 0x30], 0x10)`, at the top of
   * `redraw_screen`: a guard's clothes are recoloured per room from the
   * palettes PRINCE.DAT keeps. Colour nought leaves the bank as it is,
   * as the original does.
   */
  private applyGuardColour(): void {
    const colour = guardColor.value;
    const set = this.scene.chtabs.guard;
    const palettes = this.scene.guardPalettes;
    if (!set) return;
    if (!palettes || colour === 0) {
      this.scene.screenPalette.loadBlock(set.paletteBase, set.palette.vga);
      return;
    }
    const at = (colour - 1) * 0x30;
    const colours = [];
    for (let i = 0; i < 16; i++) {
      colours.push({
        r: palettes[at + i * 3] ?? 0,
        g: palettes[at + i * 3 + 1] ?? 0,
        b: palettes[at + i * 3 + 2] ?? 0,
      });
    }
    this.scene.screenPalette.loadBlock(set.paletteBase, colours);
  }

  private redrawScreen(differentRoom: boolean): void {
    this.applyGuardColour();
    if (differentRoom) {
      // `draw_rect(&rect_top, color_0_black)`: the room, not the strip
      // of words and hit points under it.
      this.surface.fillRect(0, 0, 320, 192, 0);
    }
    screen.different_room = 0;
    redraw_room();
    draw_tables();
    reset_tables();
    draw_moving();
    draw_tables();
    // The last line of `redraw_screen`, whatever branch it took.
    redraw_screen();
  }

  /** `draw_game_frame`. */
  render(): Surface {
    if (this.needFullRedraw) {
      this.needFullRedraw = false;
      const clears = this.fullRedrawClears;
      this.fullRedrawClears = false;
      this.redrawScreen(clears);
      if (this.firstDraw) {
        // `draw_level_first` is not `draw_game_frame`: it draws the
        // level's opening picture without spending a tick of the words
        // under it. The capture has `LEVEL 1` on ticks 0 to 23.
        this.firstDraw = false;
        draw_kid_hp(g.hitp_curr, g.hitp_max);
        return this.surface;
      }
    } else if (screen.different_room) {
      g.drawn_room = g.next_room;
      if (drawLevelType.of(g.current_level)) gen_palace_wall_colors();
      this.redrawScreen(true);
    } else {
      reset_tables();
      draw_moving();
      draw_tables();
    }
    this.tickBottomText();
    this.flash();
    return this.surface;
  }

  /** The background colour a flash took, to put back on the next tick. */
  private savedBackground: [number, number, number] | null = null;

  /**
   * `flash_if_hurt` and `remove_flash_if_hurt`, which the port never
   * had at all.
   *
   * `play_level` runs the two of them straight after
   * `draw_game_frame`, so the flash is on the frame that has just been
   * drawn and the countdown happens after it. The original does it by
   * filling the screen with the colour and blitting the frame back
   * over it with black punched out, which is the same as giving the
   * background entry of the palette that colour for one frame.
   *
   * Eight ticks of bright yellow for a sword picked up, four or two of
   * red for a hit point lost or gained, three of green for a potion,
   * eighteen of white when Jaffar falls. Every one of them was set in
   * `g` and none of them ever reached the screen.
   *
   * `flash_if_hurt` has a second branch -- red whenever `hitp_delta`
   * is negative, whether or not `flash_time` was set -- and it is
   * deliberately left out. The captures say the original does not do
   * it. `3764b76d` loses three hit points at tick 195 and not one of
   * the 17670 black pixels of its screen changes colour on that tick
   * or any other in the run; swept over the whole capture, no frame
   * has even half its usual count of black. Putting that branch in
   * costs one to three ticks on thirteen of the twenty-five
   * recordings -- 14069 of 16599 down to 14045 -- which is the
   * measurement saying the same thing twice.
   */
  private flash(): void {
    const pal = this.scene.screenPalette;
    if (this.savedBackground) {
      pal.setEntry(0, ...this.savedBackground);
      this.savedBackground = null;
    }
    const colour = g.flash_time !== 0 ? g.flash_color : 0;
    if (colour > 0) {
      this.savedBackground = pal.entry(0);
      pal.setEntry(0, ...pal.entry(colour));
    }
    if (g.flash_time !== 0) --g.flash_time;
  }

  /**
   * The tail of `draw_game_frame`: a message counts down and is rubbed
   * out, and `Press Button to Continue` blinks for its last six
   * seconds.
   */
  private tickBottomText(): void {
    if (this.textTicksToSkip > 0) {
      --this.textTicksToSkip;
      return;
    }
    if (g.text_time_remaining === 1) {
      if (g.text_time_total === 36 || g.text_time_total === 288) {
        // The original starts the game again here; the shell's business.
        erase_bottom_text(1);
      } else {
        erase_bottom_text(1);
      }
      return;
    }
    if (g.text_time_remaining !== 0 && g.text_time_total !== 1188) {
      --g.text_time_remaining;
      if (g.text_time_total === 288 && g.text_time_remaining < 72) {
        const blink_frame = g.text_time_remaining % 12;
        if (blink_frame > 3) {
          erase_bottom_text(0);
        } else if (blink_frame === 3) {
          display_text_bottom('Press Button to Continue');
        }
      }
    }
  }

  get kid() { return g.Kid; }
  /**
   * The guard, with his hit points beside him.
   *
   * The C keeps a guard's strength in `guardhp_curr` rather than in the
   * character, and the shell reads it off the guard, so this puts the
   * two together.
   */
  get guard() {
    return Object.assign(Object.create(Object.getPrototypeOf(g.Guard) as object), g.Guard, {
      hitPoints: g.guardhp_curr,
      maxHitPoints: g.guardhp_max,
    }) as typeof g.Guard & { hitPoints: number; maxHitPoints: number };
  }
  get hitPoints() { return g.hitp_curr; }
  get maxHitPoints() { return g.hitp_max; }

  /**
   * `hitp_beg_lev`: how many flasks the Prince starts a level with.
   *
   * `start_level` sets it from the executable's `start_hitp` every
   * time, so a level of its own always begins with three. What carries
   * it is the shell: a death keeps it -- `restart` already did -- and
   * so must the door out of a level, or every flask the player found
   * is taken off him at the next one.
   *
   * The shell hands it the `hitp_max` of the level just finished, not
   * that level's own `hitp_beg_lev`: a flask raises the first and
   * leaves the second where it was.
   */
  get beginningHitPoints() { return g.hitp_beg_lev; }
  set beginningHitPoints(n: number) {
    if (n <= g.hitp_beg_lev) return;
    g.hitp_beg_lev = n;
    g.hitp_max = n;
    g.hitp_curr = n;
    // So that the row of flasks under the room is drawn again.
    g.hitp_delta = 1;
  }

  /** `drawn_room`, which the shell also sets to look round the level. */
  get drawnRoom() { return g.drawn_room; }
  set drawnRoom(room: number) { this.showRoom(room); }

  /** `Char.alive >= 0`: the death animation has begun. */
  get isDead() { return g.Kid.alive >= 0; }

  /** `Press Button to Continue` is up: `text_time_total` is its 288. */
  get awaitingButton() { return g.text_time_total === 288 && g.text_time_remaining !== 0; }

  /** The level's door has been gone through: `next_level` moved on. */
  get levelFinished() { return g.next_level !== g.current_level; }

  /** `rem_min` and `rem_tick` as one number, for the shell's clock. */
  get remainingTicks() { return g.rem_min * 720 + g.rem_tick; }
  set remainingTicks(ticks: number) {
    g.rem_min = Math.max(0, Math.floor(ticks / 720));
    g.rem_tick = Math.max(1, ticks - g.rem_min * 720);
  }

  /**
   * `if (current_level < 13 && rem_min == 0) expired();`
   *
   * The last line of the original's `play_frame`. `expired()` throws
   * the screen away, plays the hourglass out and starts the game from
   * the title again, and the cutscene is the shell's business -- but
   * nothing in this port watched the clock at all, so the hour ran
   * out and the game simply carried on. The shell asks this each tick
   * and goes back to the title.
   *
   * Not on level 13 or after: the original says expiring does not
   * count on Jaffar's level or the princess's.
   */
  get timeExpired() { return g.current_level < 13 && g.rem_min === 0; }

  /** `have_sword`, which the shell carries from one level to the next. */
  get hasSword() { return g.have_sword !== 0; }
  set hasSword(has: boolean) { g.have_sword = has ? 1 : 0; }

  /**
   * `process_key`, less what belongs to a DOS machine.
   *
   * The original reads the keyboard twice: `read_keyb_control` turns
   * the arrows and Shift into the three `control_` globals the game
   * plays on, and `process_key` handles everything else -- the pause,
   * the clock, the restart, the cheats. The first of those is the
   * shell's `step`; these are the second. What is left out is what a
   * browser has no business doing or cannot do: quitting, saving to
   * disc, the joystick, redefining the keys.
   *
   * Each one says which case of the C's switch it stands for.
   */

  /** Space: `is_show_time = 1`. */
  showTime(): void { g.is_show_time = 1; }

  /** Esc: `is_paused`. The shell stops stepping while it is set. */
  get paused() { return g.is_paused !== 0; }
  set paused(on: boolean) {
    g.is_paused = on ? 1 : 0;
    if (on) this.say('GAME PAUSED', 0);
    else erase_bottom_text(1);
  }

  /**
   * `display_text_bottom(answer_text)` with the twenty-four ticks
   * `process_key` gives an answer. `ticks` of nought leaves it up
   * until something takes it away, which is what the pause wants.
   */
  say(text: string, ticks = 24): void {
    display_text_bottom(text);
    g.text_time_total = ticks;
    g.text_time_remaining = ticks;
  }

  /** Ctrl+A: start the level again. Level 15 is the potions level. */
  restartLevel(): void {
    if (this.levelNumber === 15) return;
    out.stop_sounds();
    g.is_restart_level = 1;
  }

  /**
   * Shift+L: on to the next level.
   *
   * Without the cheats the original allows it only below level 4, and
   * takes the clock down to fifteen minutes if more than that is left.
   */
  skipLevel(cheats: boolean): boolean {
    if (!(this.levelNumber < 4 || cheats)) return false;
    if (this.levelNumber === 14) g.next_level = 1;
    else {
      g.next_level = this.levelNumber + 1;
      if (!cheats && g.rem_min > 15) { g.rem_min = 15; g.rem_tick = 719; }
    }
    out.stop_sounds();
    return true;
  }

  /** `c` and Shift+C: the numbers of the rooms around this one. */
  get roomsAround() {
    return `S${g.drawn_room} L${g.room_L} R${g.room_R} A${g.room_A} B${g.room_B}`;
  }
  get roomsDiagonal() {
    return `AL${g.room_AL} AR${g.room_AR} BL${g.room_BL} BR${g.room_BR}`;
  }
  /** H, J, U, N and Ctrl+B, as room numbers. */
  get roomLeft() { return g.room_L; }
  get roomRight() { return g.room_R; }
  get roomAbove() { return g.room_A; }
  get roomBelow() { return g.room_B; }

  /** '+' and '-': a minute on the clock either way. */
  addMinutes(n: number): void {
    g.rem_min = Math.max(1, g.rem_min + n);
    g.text_time_total = 0;
    g.text_time_remaining = 0;
    g.is_show_time = 1;
  }

  /** R: the Prince gets up again. */
  resurrect(): void {
    if (g.Kid.alive <= 0) return;
    g.resurrect_time = 20;
    g.Kid.alive = -1;
    erase_bottom_text(1);
  }

  /** K: the guard falls over. A skeleton cannot be killed. */
  killGuard(): void {
    if (g.Guard.charid === 4) return; // charid_4_skeleton
    g.guardhp_delta = -g.guardhp_curr;
    g.Guard.alive = 0;
  }

  /** Shift+S: one hit point back, with the small potion's red flash. */
  heal(): void {
    if (g.hitp_curr === g.hitp_max) return;
    out.play_sound(33); // sound_33_small_potion
    g.hitp_delta = 1;
    g.flash_color = 4;
    g.flash_time = 2;
  }

  /** Shift+T: another flask on the bar. */
  addLife(): void {
    out.play_sound(30); // sound_30_big_potion
    g.flash_color = 4;
    g.flash_time = 4;
    add_life();
  }

  /** Shift+W: the feather, with the green flash and the low note. */
  featherFall(): void {
    g.is_feather_fall = 1;
    g.flash_color = 2;
    g.flash_time = 3;
    out.stop_sounds();
    out.play_sound(39); // sound_39_low_weight
  }

  /** Shift+B: the room goes dark and the Prince plays on without it. */
  toggleBlind(): void {
    g.is_blind_mode = g.is_blind_mode ? 0 : 1;
    this.needFullRedraw = true;
  }

  /** Shift+I: the screen turns over. The shell does the turning. */
  toggleUpsideDown(): void { g.upside_down = g.upside_down ? 0 : -1; }
  get upsideDown() { return g.upside_down !== 0; }

  /**
   * Show another room without playing: the view-the-level keys.
   *
   * `next_room = room` and the screen drawn whole, which is what the
   * original's H, J, U and N do.
   */
  showRoom(room: number): void {
    if (room === g.drawn_room) return;
    g.drawn_room = room;
    g.next_room = room;
    if (drawLevelType.of(g.current_level)) gen_palace_wall_colors();
    load_room_links();
    get_room_address(room);
    anim_tile_modif();
    start_chompers();
    this.needFullRedraw = true;
    this.fullRedrawClears = true;
  }
}

export { loadkid, savekid, loadshad, saveshad, directions, chtabs, out, check_the_end };
