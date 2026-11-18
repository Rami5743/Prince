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
  it('gives the background the flash colour for as long as it lasts', async () => {
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
      expect(pal.entry(0), `tick ${i} of the flash`).toEqual(yellow);
    }
    // And the ninth tick has it black again.
    game.step({ x: 0, y: 0, shift: false });
    game.render();
    expect(pal.entry(0)).toEqual(black);
  });

  it('leaves the background alone when nothing is flashing', async () => {
    const game = await PopGame.start(assets, exe, 1);
    const pal = game.scene.screenPalette;
    for (let i = 0; i < 20; i++) {
      game.step({ x: 0, y: 0, shift: false });
      game.render();
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

    const blackPixels = (): number => {
      const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
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
    game.render();
    expect(g.flash_color).toBe(4);
    expect(blackPixels(), 'not one pixel of the screen is still black').toBe(0);

    // And it all comes back.
    for (let i = 0; i < 6; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    expect(blackPixels()).toBeGreaterThan(20000);
  });
});
