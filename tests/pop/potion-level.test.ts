/**
 * The six potions, drunk.
 *
 * `potion8` drinks level 8's blue one and it is the only potion in
 * the whole suite: the game has **one** feather, in level 7 room 1
 * row 2 column 8 with five tiles of open shaft between it and where
 * the falling entry puts the Prince, and **two** inversion potions,
 * in level 9 rooms 7 and 10 where the level starts in room 11. So
 * four of the six kinds had never been drunk by anything, and when
 * they were finally read against the C both the feather and the
 * inversion turned out to have a line missing.
 *
 * `src/dat/potion-level.ts` is the answer: one extra `LEVELS.DAT`
 * record, dropped into a copy of the file in place of level 2, with
 * all six a floor tile apart along one corridor. Nothing else
 * changes -- `PopGame`, `src/pop` and the renderer are exactly what
 * the real game uses -- so what this measures is `proc_get_object`
 * and nothing else. The same record is what `potion.html` plays.
 *
 * What the C says each case does (`seg006:1133`):
 *
 *     1 heal       stop_sounds, sound 33, hitp_delta  1, flash 4 x 2
 *     2 life       stop_sounds, sound 30, add_life,    flash 4 x 4
 *     3 feather    feather_fall(): flash 2 x 3, stop_sounds, sound 39
 *     4 inversion  toggle_upside() and nothing else at all
 *     5 hurt       stop_sounds, sound 13, hitp_delta -1, no flash
 *     6 open       get_tile(8, 0, 0); trigger_button(0, 0, -1)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { out } from '../../src/pop/link.ts';
import { soundids } from '../../src/pop/types.ts';
import {
  levelsDatWithPotionLevel, POTION_PLACES, POTION_LEVEL_NUMBER, POTION_KIND,
} from '../../src/dat/potion-level.ts';

const assets = new Assets(async (name: string) => {
  const bytes = new Uint8Array(readFileSync(join(GAME_DIR, name)));
  // The one and only difference from the game the player plays.
  return name === 'LEVELS.DAT' ? levelsDatWithPotionLevel(bytes) : bytes;
});
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** What one drink did. */
interface Drink {
  name: string;
  hp: [number, number];
  max: [number, number];
  upsideDown: [boolean, boolean];
  feather: boolean;
  /** `flash_color` and `flash_time`, read before the frame is drawn. */
  flash: [number, number] | null;
  /** Every `play_sound` between the Shift and the end of the drink. */
  sounds: number[];
  /** The tile the potion was on, afterwards. */
  tile: number;
}

/**
 * Walk onto each potion in turn and drink it.
 *
 * A potion is drunk by standing in front of it and pressing Shift:
 * `control_standing` is
 * `if (control_shift2 == CONTROL_HELD && control_shift == CONTROL_HELD
 * && check_get_item()) return;`, and `control_shift2` is a latch, so
 * the key has to go down again rather than be held. `check_get_item`
 * takes him standing **on** the tile as well as one short of it.
 */
async function drinkAll(): Promise<Drink[]> {
  const game = await PopGame.start(assets, exe, POTION_LEVEL_NUMBER);
  const sounds: number[] = [];
  const asked = out.play_sound;
  out.play_sound = (which: number): void => { sounds.push(which); asked(which); };
  /** One tick. The flash is read between the tick and the frame. */
  let flash: [number, number] | null = null;
  const step = (x = 0, shift = false): void => {
    game.step({ x, y: 0, shift });
    if (g.flash_time && !flash) flash = [g.flash_color, g.flash_time];
    game.render();
  };
  const stand = (): void => { for (let i = 0; i < 40 && g.Char.frame !== 15; i++) step(); };
  const got: Drink[] = [];
  try {
    for (const potion of POTION_PLACES) {
      for (let i = 0; i < 40; i++) {
        const here = g.Char.room === potion.room && g.Char.curr_row === potion.row;
        if (here && (g.Char.curr_col === potion.column - 1
          || g.Char.curr_col === potion.column)) break;
        step(1); // one tap of Right is one step
        stand();
      }
      expect(g.Char.room, `could not reach the ${potion.name} potion`).toBe(potion.room);
      sounds.length = 0;
      flash = null;
      const before = {
        hp: game.hitPoints, max: game.maxHitPoints, up: game.upsideDown,
      };
      for (let t = 0; t < 90; t++) {
        step(0, t % 4 === 1 || t % 4 === 2);
        if (game.scene.state.typeAt(potion.room, potion.column, potion.row) !== 10
          && g.Char.frame === 15) break;
      }
      got.push({
        name: potion.name,
        hp: [before.hp, game.hitPoints],
        max: [before.max, game.maxHitPoints],
        upsideDown: [before.up, game.upsideDown],
        feather: g.is_feather_fall !== 0,
        flash,
        sounds: [...sounds],
        tile: game.scene.state.typeAt(potion.room, potion.column, potion.row),
      });
      stand();
    }
  } finally {
    out.play_sound = asked;
  }
  return got;
}

/**
 * The room drawn whole -- `redraw_screen(1)`, which fills the room
 * with black before it draws it again.
 *
 * It is the ground truth for "is anything left behind": the picture
 * the game would have if nothing had ever been drawn on top of it.
 * An incremental tick that has rubbed out everything it owed draws
 * exactly this.
 */
function wholeRoom(game: PopGame): Uint8Array {
  const priv = game as unknown as { needFullRedraw: boolean; fullRedrawClears: boolean };
  priv.needFullRedraw = true;
  priv.fullRedrawClears = true;
  return new Uint8Array(game.render().toRgb(game.scene.screenPalette.toRgba()));
}

/**
 * Walk to one potion, drink it, stand still for twenty ticks, and
 * count the pixels of the room that the incremental picture has and
 * the room drawn whole has not.
 */
async function leftBehind(which: string): Promise<number> {
  const game = await PopGame.start(assets, exe, POTION_LEVEL_NUMBER);
  let last = new Uint8Array(320 * 200 * 3);
  const step = (x = 0, shift = false): void => {
    game.step({ x, y: 0, shift });
    last = new Uint8Array(game.render().toRgb(game.scene.screenPalette.toRgba()));
  };
  const stand = (): void => { for (let i = 0; i < 40 && g.Char.frame !== 15; i++) step(); };
  for (const potion of POTION_PLACES) {
    for (let i = 0; i < 40; i++) {
      const here = g.Char.room === potion.room && g.Char.curr_row === potion.row;
      if (here && (g.Char.curr_col === potion.column - 1
        || g.Char.curr_col === potion.column)) break;
      step(1);
      stand();
    }
    for (let t = 0; t < 90; t++) {
      step(0, t % 4 === 1 || t % 4 === 2);
      if (game.scene.state.typeAt(potion.room, potion.column, potion.row) !== 10
        && g.Char.frame === 15) break;
    }
    if (potion.name === which) {
      for (let i = 0; i < 20; i++) step();
      break;
    }
    stand();
  }
  const whole = wholeRoom(game);
  let n = 0;
  // The room, not the strip of words and hit points under it.
  for (let i = 0; i < 320 * 192; i++) {
    if (last[i * 3] !== whole[i * 3] || last[i * 3 + 1] !== whole[i * 3 + 1]
      || last[i * 3 + 2] !== whole[i * 3 + 2]) n++;
  }
  return n;
}

/**
 * **The ghost of the Prince drinking, which the player found.**
 *
 * Drink the upside-down potion and a copy of him in the drinking
 * pose was left standing in the corridor for the rest of the level.
 *
 * `toggle_upside` sets `need_redraw_because_flipped` and
 * `draw_game_frame` turns it into `redraw_screen(0)`, whose middle is
 *
 *     redraw_room();
 *     is_blind_mode = 1;
 *     draw_tables();
 *     is_blind_mode = 0;
 *     memset(table_counts, 0, sizeof(table_counts));
 *     draw_moving();
 *     draw_tables();
 *
 * and the port had the two `draw_tables` and not the flag.
 * `draw_tables` opens with
 * `if (is_blind_mode) draw_rect(&rect_top, color_0_black)`, so that
 * one line is how `redraw_screen` **blacks the room**: `redraw_room`
 * only fills the tables, and `tiles_0_empty` draws nothing at all, so
 * the open air of a room is never painted over. Without it the flip
 * tick redrew the room *around* the Prince already standing in it,
 * `redraw_room`'s `free_peels()` threw away the rectangle that would
 * have rubbed him out, and the next `add_peel` read his own pixels as
 * if they were the background -- so the moment he moved, two ticks
 * later, they were painted back and stayed.
 *
 * Measured against the original. `potion1` drunk under
 * `dosbox_oracle.py --game`, grabbed at 30fps, counting the pixels
 * brighter than 60 in the box x 90..140 y 68..118 -- the black air
 * the Prince stands in -- the capture beside the port, tick for tick:
 *
 *     tick       489   491   493   495 .. 515
 *     PRINCE.EXE 572   872   855   803
 *     the port   572   872   855   803    with this fix
 *     the port   572   872  1007   972    without it
 *
 * The flip is tick 490 and the ghost is **169 pixels** the original
 * never draws, from the third tick after it and for ever.
 */
describe('what the screen turning over leaves behind', () => {
  for (const potion of POTION_PLACES) {
    it(`leaves no copy of him behind after the ${potion.name} one`, async () => {
      expect(await leftBehind(potion.name)).toBe(0);
    }, 120000);
  }
});

describe('the potion level', () => {
  let drunk: Drink[];
  let by: Record<string, Drink>;
  beforeAll(async () => {
    drunk = await drinkAll();
    by = Object.fromEntries(drunk.map((d) => [d.name, d]));
  }, 120000);

  it('has all six kinds, a floor tile apart, and the Prince next to the first', async () => {
    expect(POTION_PLACES.map((p) => p.kind)).toEqual([
      POTION_KIND.hurt, POTION_KIND.heal, POTION_KIND.life,
      POTION_KIND.feather, POTION_KIND.inversion, POTION_KIND.open,
    ]);
    const game = await PopGame.start(assets, exe, POTION_LEVEL_NUMBER);
    for (const p of POTION_PLACES) {
      expect(game.scene.state.typeAt(p.room, p.column, p.row),
             `${p.name} is a potion tile`).toBe(10);
      expect(game.scene.state.modifierAt(p.room, p.column, p.row) >> 3,
             `${p.name}'s kind`).toBe(p.kind);
    }
    // Room 1, row 1, column 1, facing right: one step from the first.
    expect(g.Char.room).toBe(1);
    expect(g.Char.curr_col).toBe(1);
    expect(g.Char.curr_row).toBe(1);
    expect(g.Char.direction).toBe(0); // dir_0_right
  }, 60000);

  it('drinks every one of the six', () => {
    expect(drunk.map((d) => d.name)).toEqual(
      ['hurt', 'heal', 'life', 'feather', 'inversion', 'open']);
    // The tile is a plain floor afterwards, every time.
    for (const d of drunk) expect(d.tile, `${d.name}'s tile`).toBe(1);
    // `seq_78_drink`'s own `SND_SILENT` is `sound_18_drink`, which is
    // the Prince swallowing and is played by every one of the six.
    for (const d of drunk) {
      expect(d.sounds, `${d.name}`).toContain(soundids.sound_18_drink);
    }
  });

  it('takes a hit point for the blue one, with no flash', () => {
    expect(by.hurt.hp).toEqual([3, 2]);
    expect(by.hurt.max).toEqual([3, 3]);
    expect(by.hurt.sounds).toContain(soundids.sound_13_kid_hurt);
    expect(by.hurt.flash, 'case 5 sets no flash').toBeNull();
  });

  it('gives one back for the small red one, and flashes red twice', () => {
    expect(by.heal.hp).toEqual([2, 3]);
    expect(by.heal.max).toEqual([3, 3]);
    expect(by.heal.sounds).toContain(soundids.sound_33_small_potion);
    expect(by.heal.flash).toEqual([4, 2]);
  });

  it('adds a flask for the big red one, and flashes red four times', () => {
    expect(by.life.hp).toEqual([3, 4]);
    expect(by.life.max).toEqual([3, 4]);
    expect(by.life.sounds).toContain(soundids.sound_30_big_potion);
    expect(by.life.flash).toEqual([4, 4]);
  });

  it('makes him light for the green one, and flashes green three times', () => {
    expect(by.feather.feather, 'is_feather_fall').toBe(true);
    expect(by.feather.sounds).toContain(soundids.sound_39_low_weight);
    expect(by.feather.flash).toEqual([2, 3]);
    expect(by.feather.hp, 'the feather costs nothing').toEqual([4, 4]);
  });

  it('turns the screen over for the upside-down one, with no flash and no noise', () => {
    expect(by.inversion.upsideDown).toEqual([false, true]);
    expect(by.inversion.flash, 'case 4 is `toggle_upside()` and nothing else').toBeNull();
    // Only the swallow: `proc_get_object` case 4 plays nothing.
    expect(by.inversion.sounds).toEqual([soundids.sound_18_drink]);
  });

  it('makes no noise and no flash for the one that opens the gates', () => {
    expect(by.open.flash).toBeNull();
    expect(by.open.sounds).toEqual([soundids.sound_18_drink]);
    expect(by.open.hp).toEqual([4, 4]);
  });
});
