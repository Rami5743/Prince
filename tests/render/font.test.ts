/**
 * The font out of the executable, and the two things it is used for.
 *
 * Both are pinned against the grabbed video of the recorded run of level 1,
 * where the words are drawn in white on rows 193 to 199 of the bottom
 * strip:
 *
 *   tick 0    `LEVEL 1`, 41 pixels wide, from x 139
 *   tick 298  `Press Button to Continue`, 150 pixels wide, from x 85
 *
 * Centring each of those in the three hundred and twenty gives exactly the
 * x the capture has, so the widths are the whole of the evidence and there
 * is nothing else to measure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { readFont, textWidth, drawTextCentred } from '../../src/render/font.ts';
import { Surface } from '../../src/render/surface.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game, LEVEL_TITLE_TICKS, MINUTE_TICKS } from '../../src/game/game.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const font = readFont(exe);
const NOTHING = { x: 0, y: 0, shift: false };

/** Which columns of the bottom strip have ink in them. */
function inkedColumns(surface: Surface, color: number): { x0: number; x1: number; n: number } {
  let x0 = 320, x1 = -1, n = 0;
  for (let y = 192; y < 200; y++) {
    for (let x = 0; x < 320; x++) {
      if (surface.pixels[y * 320 + x] !== color) continue;
      n += 1;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
  }
  return { x0, x1, n };
}

describe('the font in the executable', () => {
  it('is the original\'s, with its own measurements', () => {
    expect(font.firstChar).toBe(32);
    expect(font.lastChar).toBe(131);
    expect(font.heightAbove).toBe(7);
    expect(font.heightBelow).toBe(2);
    expect(font.charSpacing).toBe(1);
    // Every character the game can print has a bitmap.
    expect(font.glyphs.filter((g) => g === null)).toHaveLength(0);
  });

  it('draws a capital seven rows tall and a tail two rows below it', () => {
    const P = font.glyphs['P'.charCodeAt(0) - font.firstChar]!;
    const y = font.glyphs['y'.charCodeAt(0) - font.firstChar]!;
    expect([P.height, P.width]).toEqual([7, 6]);
    expect([y.height, y.width]).toEqual([9, 6]);
    // The top left of a P is ink and its middle right is not.
    expect(P.sprite.pixels[0]).toBe(1);
    expect(P.sprite.pixels[4 * 6 + 5]).toBe(0);
  });

  it('measures the two lines the game prints as the capture has them', () => {
    expect(textWidth(font, 'LEVEL 1')).toBe(41);
    expect(textWidth(font, 'Press Button to Continue')).toBe(150);
  });

  it('centres them where the capture has them', () => {
    const surface = new Surface();
    surface.clear();
    drawTextCentred(surface, font, 'LEVEL 1', 0, 319, 193, 15);
    expect(inkedColumns(surface, 15)).toMatchObject({ x0: 139, x1: 179 });
    surface.clear();
    drawTextCentred(surface, font, 'Press Button to Continue', 0, 319, 193, 15);
    expect(inkedColumns(surface, 15)).toMatchObject({ x0: 85, x1: 234 });
  });
});

describe('the words under the room', () => {
  /**
   * Measured off the grabbed video of the recorded run: `LEVEL 1` from
   * tick 0 to 23, nothing at all on 24, `60 MINUTES LEFT` from 25 to 48,
   * and nothing from 49 on. The port said `LEVEL 1` for forty-nine ticks
   * and never mentioned the hour, which is the whole point of it.
   */
  it('say the level and then how much of the hour is left', async () => {
    const game = await Game.start(assets, exe, 1);
    const seen: (string | null)[] = [];
    const where = (): string | null => {
      const c = inkedColumns(game.render(), 15);
      return c.n === 0 ? null : `${c.x0}-${c.x1}`;
    };
    // The picture of a tick is the one the game draws after stepping it,
    // which is how the replay harness takes them too; the first of those
    // steps moves nothing and shows what the level's start put on the
    // screen, and the original's tick 0 is that same picture.
    //
    // All ten captures agree to the tick: the level's number on 0 to 23,
    // nothing on 24, the hour on 25 to 47, nothing from 48. The second
    // message is a tick shorter than the first.
    for (let t = 0; t < 52; t++) {
      game.step(NOTHING);
      seen.push(where());
    }
    const level = '139-179';
    const hour = '113-206';
    expect(seen.slice(0, 24), 'the level number first').toEqual(Array(24).fill(level));
    expect(seen[24], 'then a tick of nothing').toBeNull();
    expect(seen.slice(25, 48), 'then the hour').toEqual(Array(23).fill(hour));
    expect(seen.slice(48), 'and then nothing').toEqual([null, null, null, null]);
  });

  it('count the hour down as it goes, and not restart it on a death', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.remainingTicks).toBe(MINUTE_TICKS * 60);
    game.step(NOTHING); // the level start's own tick, which runs nothing
    for (let i = 0; i < MINUTE_TICKS; i++) game.step(NOTHING);
    expect(game.remainingTicks).toBe(MINUTE_TICKS * 59);
    const again = await game.restart(assets, exe);
    expect(again.remainingTicks, 'the hour runs on across a death')
      .toBe(MINUTE_TICKS * 59);
  });

  it('ask for a button once the Prince is dead', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.damage(3);
    game.kid.alive = 0;
    // Nothing is said at once: the original waits, and the capture puts
    // the first blood on the spikes at tick 284 and the words at 298.
    game.step(NOTHING);
    expect(inkedColumns(game.render(), 15).n).toBe(0);
    for (let i = 0; i < 20 && !game.awaitingButton; i++) game.step(NOTHING);
    expect(game.awaitingButton).toBe(true);
    expect(inkedColumns(game.render(), 15)).toMatchObject({ x0: 85, x1: 234 });
  });
});
