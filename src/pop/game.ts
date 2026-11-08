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

import { g, newChar, type RectType } from './state.ts';
import { chtabs, blitters, directions } from './types.ts';
import { setFrameTables, loadkid, savekid, loadshad, saveshad } from './seg006.ts';
import {
  setPainter, levelType as drawLevelType, redraw_room, draw_moving, draw_tables,
  get_room_address, mobs as drawMobs, FLIPPED, reset_tables, hp as drawHp,
  show_level, display_text_bottom, erase_bottom_text, type Peel,
} from './seg008.ts';
import { clear_tile_wipes, levelType as looseLevelType } from './seg007.ts';
import { do_startpos, find_start_level_door, pos_guards, timers, dist as seg003dist, rooms as seg003rooms } from './seg003.ts';
import {
  guards as guardTables, enter_guard, char_opp_dist, goto_other_room,
  autocontrol_opponent, clear_char, on_guard_killed, inc_curr_row,
  control_guard_inactive, load_room_links,
} from './seg002.ts';
import { control, seqtbl_offset_char, spiked, do_fall, dist as seg005dist } from './seg005.ts';
import { clear_coll_rooms } from './seg004.ts';
import {
  start_chompers, make_loose_fall, trigger_button, is_spike_harmful,
  start_anim_spike, set_wipe, set_redraw_full, set_redraw_fore, set_redraw2,
  set_redraw_floor_overlay, set_redraw_anim, died_on_button, draw_mobs,
} from './seg007.ts';
import {
  play_frame, check_the_end, screen, redraw_screen, anim_tile_modif, draw_hp,
  draw_kid_hp,
} from './seg000.ts';
import { add_objtable, mark_obj_tile_redraw } from './seg008.ts';
import { l2, l5, l6, l7, l8, out } from './link.ts';
import { set_seed } from './seg009.ts';

/** `tbl_guard_hp` and `tbl_guard_type`, read out of PRINCE.EXE. */
import { readExeConstants } from '../game/exe-constants.ts';

export interface Controls {
  x: number;
  y: number;
  shift: boolean;
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
}

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
  /** `is_restart_level`, which the shell acts on between ticks. */
  restartDue = false;
  /** The first tick of a level does nothing, as the original's does. */
  private pendingFirstTick = true;
  /** The screen has to be drawn whole: `need_full_redraw`. */
  private needFullRedraw = true;
  /** The game's own font, out of the executable. */
  private font?: Font;
  /** `draw_level_first` has still to put the hit points up. */
  private firstDraw = false;
  /** `current_target_surface`: the room's 192 rows, or the whole screen. */
  private roomTarget = false;
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
    assets: Assets, exe: Uint8Array, levelNumber: number, prefix = 'V',
  ): Promise<PopGame> {
    link();
    const scene = await buildLevelScene(assets, exe, levelNumber, prefix);
    const game = new PopGame(scene, levelNumber);
    game.install(exe);
    game.startLevel();
    return game;
  }

  async restart(assets: Assets, exe: Uint8Array): Promise<PopGame> {
    return PopGame.start(assets, exe, this.levelNumber);
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
    const level = this.scene.level;
    const type = this.scene.options.levelType;
    drawLevelType.of = () => type;
    looseLevelType.of = () => type;
    guardTables.hp = (n) => constants.guardHitPoints[n] ?? 0;
    guardTables.type = () => this.scene.guardType === 4 ? 2 : 0;

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

    g.chtab_addrs = CHTAB_NAME.map((name) => {
      if (!name) return null;
      const set = (this.scene.chtabs as unknown as Record<string, { images: readonly (unknown)[] } | undefined>)[name];
      return set ? (set.images as never) : null;
    });

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
    loadkid();
    do_startpos();
    g.drawn_room = g.Kid.room;
    load_room_links();
    get_room_address(g.drawn_room);
    find_start_level_door();
    pos_guards();
    anim_tile_modif();
    loadkid();
    start_chompers();
    enter_guard();
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
    } else {
      this.surface.clipTop = 0;
      this.surface.clipBottom = floor;
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
    timers();
    play_frame();
    if (g.is_restart_level) {
      g.is_restart_level = 0;
      this.restartDue = true;
    }
  }

  /** `redraw_screen(drawing_different_room)`. */
  private redrawScreen(differentRoom: boolean): void {
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
  }

  /** `draw_game_frame`. */
  render(): Surface {
    if (this.needFullRedraw) {
      this.needFullRedraw = false;
      this.redrawScreen(false);
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
      this.redrawScreen(true);
    } else {
      reset_tables();
      draw_moving();
      draw_tables();
    }
    this.tickBottomText();
    return this.surface;
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
  get guard() { return g.Guard; }
  get drawnRoom() { return g.drawn_room; }
  get hitPoints() { return g.hitp_curr; }
  get maxHitPoints() { return g.hitp_max; }
}

export { loadkid, savekid, loadshad, saveshad, directions, chtabs, out, check_the_end };
