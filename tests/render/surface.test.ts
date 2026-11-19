/**
 * The blitters, and the one that was not the VGA's.
 */
import { describe, it, expect } from 'vitest';
import { Surface } from '../../src/render/surface.ts';

describe('`blitters_3_xor` and the sprite pixels it leaves alone', () => {
  /**
   * The shadow, and the box the player saw behind him on level 12.
   *
   * The VGA's XOR write-mode XORs the sprite's byte into the one on
   * the screen, and a sprite pixel of nought therefore changes
   * nothing: `d ^ 0 == d`. The port XORed `base + v`, so every
   * **transparent** pixel of the sprite's box had the bank's palette
   * base XORed into whatever was behind it -- 112 for the Kid's
   * bank.
   *
   * The only thing in the game drawn this way is the shadow:
   * `draw_objtable_item` puts him up as a `blitters_2_or` and a
   * `blitters_3_xor` of the same frame a pixel apart. On level 12 he
   * carries a sword, which puts him in a bank whose base is not
   * nought, and the box showed.
   *
   * `shadow6` went 279 of 280 to **280, exact** with this, and
   * nothing else in the suite moved; `shadow5` was already 300 of
   * 300 and stayed.
   */
  it('leaves a pixel the sprite left at nought exactly as it was', () => {
    const s = new Surface(4, 1);
    s.pixels.set([10, 20, 30, 40]);
    const sprite = { width: 4, height: 1, pixels: Uint8Array.from([0, 0, 1, 2]) };
    s.blitXor(sprite, 0, 0, 112);
    expect(Array.from(s.pixels)).toEqual([10, 20, 30 ^ 113, 40 ^ 114]);
  });

  it('and `blitters_2_or` does the same with its own nought', () => {
    const s = new Surface(4, 1);
    s.pixels.set([10, 20, 30, 40]);
    const sprite = { width: 4, height: 1, pixels: Uint8Array.from([0, 0, 1, 2]) };
    s.blitOr(sprite, 0, 0, 112);
    expect(Array.from(s.pixels)).toEqual([10, 20, 30 | 113, 40 | 114]);
  });
});
