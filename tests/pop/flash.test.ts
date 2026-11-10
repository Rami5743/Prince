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
