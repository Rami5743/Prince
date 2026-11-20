/**
 * The screen flashes.
 *
 * `play_level` runs `flash_if_hurt` and `remove_flash_if_hurt` right
 * after `draw_game_frame`, and the original does it by filling the
 * screen with a colour and putting the frame back over it with black
 * punched out -- which is the background entry of the palette taking
 * that colour for the frame that has just been drawn.
 *
 * The translation set `flash_time` and `flash_color` in all the right
 * places and drew neither, so picking up the sword, drinking a potion
 * and Jaffar's fall all happened in silence on a black background.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('the hour', () => {
  it('is up when the clock reaches nought, and not on Jaffar\'s level', async () => {
    const game = await PopGame.start(assets, exe, 1);
    expect(game.timeExpired).toBe(false);
    game.remainingTicks = 1;
    game.step({ x: 0, y: 0, shift: false });
    expect(game.timeExpired).toBe(true);

    // `expiring doesn't count on Jaffar/princess level`.
    const jaffar = await PopGame.start(assets, exe, 13);
    jaffar.remainingTicks = 1;
    jaffar.step({ x: 0, y: 0, shift: false });
    expect(jaffar.timeExpired).toBe(false);
  });
});

describe('the flash', () => {
  it('is owed for as many ticks as `flash_time`, and is a blink in each', async () => {
    const game = await PopGame.start(assets, exe, 1);
    const pal = game.scene.screenPalette;
    // Past the opening picture, which `draw_level_first` draws and
    // which is not a `draw_game_frame`.
    for (let i = 0; i < 4; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    const black = pal.entry(0);
    expect(black).toEqual([0, 0, 0]);

    // `proc_get_object` on a sword: eight ticks of bright yellow.
    g.flash_color = 14;
    g.flash_time = 8;
    const yellow = pal.entry(14);
    expect(yellow).not.toEqual(black);

    for (let i = 0; i < 8; i++) {
      game.step({ x: 0, y: 0, shift: false });
      game.render();
      // `draw_game_frame` leaves the screen alone: the colour goes
      // up in `flash_if_hurt`, after it, and comes off a sixtieth
      // later, which is four fifths of the tick with it off. That
      // is the picture the capture's splitter keeps.
      expect(pal.entry(0), `tick ${i}, drawn`).toEqual(black);
      expect(game.flashColour, `tick ${i}, owed`).toBe(14);
      game.raiseFlash();
      expect(pal.entry(0), `tick ${i} of the flash`).toEqual(yellow);
      game.dropFlash();
      expect(pal.entry(0), `tick ${i}, taken down`).toEqual(black);
    }
    // And the ninth tick is owed nothing.
    game.step({ x: 0, y: 0, shift: false });
    game.render();
    expect(game.flashColour).toBe(0);
    game.raiseFlash();
    expect(pal.entry(0)).toEqual(black);
  });

  /**
   * The colour is the hardcoded sixteen, which the room's palette
   * holds unchanged in entries 0 to 15.
   *
   * `set_bg_attr`'s commented-out original line reads
   * `vga_palette[hc_pal_index]` where SDLPoP's stand-in reads
   * `palette[hc_pal_index]`. For the four colours a flash ever takes
   * the two are the same on all fourteen levels, which is why
   * `pal.entry(flash_color)` is right.
   */
  it('takes the hardcoded VGA colour, which is what the room holds too', async () => {
    const vga: Record<number, [number, number, number]> = {
      2: [0, 42, 0], 4: [42, 0, 0], 14: [63, 63, 21], 15: [63, 63, 63],
    };
    for (const level of [1, 2, 8, 13, 14]) {
      const game = await PopGame.start(assets, exe, level);
      const pal = game.scene.screenPalette;
      for (const [i, want] of Object.entries(vga)) {
        expect(pal.entry(Number(i)), `level ${level}, entry ${i}`).toEqual(want);
      }
    }
  });

  it('leaves the background alone when nothing is flashing', async () => {
    const game = await PopGame.start(assets, exe, 1);
    const pal = game.scene.screenPalette;
    for (let i = 0; i < 20; i++) {
      game.step({ x: 0, y: 0, shift: false });
      game.render();
      game.raiseFlash();
      expect(pal.entry(0)).toEqual([0, 0, 0]);
    }
  });
});

/**
 * And every black pixel, not only the ones that use entry nought.
 *
 * The original's `set_bg_attr(0, color)` fills the screen with the
 * colour and puts the frame back over it with black punched out, so
 * what flashes is every black *pixel*. A sprite drawn with
 * `blitters_0_no_transp` does not use entry nought for its black: it
 * uses its own bank's `paletteBase + 0`, which is black in the
 * palette and is a different entry. The torch flames are drawn
 * exactly that way, so each of them kept a black box around it while
 * the rest of the room went red -- "the flash is wrong, especially in
 * the area of the torches".
 *
 * Measured against a capture of `PRINCE.EXE` taking `shift+t` on
 * level 2, as the share of the screen still black on the flash frame:
 * the original 0.0% of the room and 0.0% of the strip under it, the
 * port 2.9% and 1.9% before this and 0.0% and 0.0% after, against
 * 40.8% and 97.2% on the frames either side in both.
 */
describe('the flash, over the torches', () => {
  it('leaves nothing on the screen black', async () => {
    const game = await PopGame.start(assets, exe, 2);
    for (let i = 0; i < 6; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }

    // The surface the last `render()` handed back, read again with
    // whatever is in the palette now: `render()` is
    // `draw_game_frame`, so calling it again would spend a tick of
    // the flash it is being asked about.
    let shown = game.render();
    const blackPixels = (): number => {
      const rgb = shown.toRgb(game.scene.screenPalette.toRgba());
      let n = 0;
      for (let i = 0; i < rgb.length; i += 3) {
        if (rgb[i] < 30 && rgb[i + 1] < 30 && rgb[i + 2] < 30) n += 1;
      }
      return n;
    };

    // Level 2's first room has two torches in it, so there is
    // something here that is black and is not entry nought.
    const before = blackPixels();
    expect(before, 'the room is mostly black').toBeGreaterThan(20000);

    // `add_life`: four ticks of red.
    game.cheat('shift+t');
    game.step({ x: 0, y: 0, shift: false });
    shown = game.render();
    expect(g.flash_color).toBe(4);
    expect(game.flashColour).toBe(4);
    game.raiseFlash();
    expect(blackPixels(), 'not one pixel of the screen is still black').toBe(0);
    game.dropFlash();

    // And it all comes back.
    for (let i = 0; i < 6; i++) { game.step({ x: 0, y: 0, shift: false }); shown = game.render(); }
    expect(blackPixels()).toBeGreaterThan(20000);
  });
});
