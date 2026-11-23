/**
 * The repainted Prince: the fade, the mask, and the seam he arrives
 * through.
 *
 * The artwork of `graphics/kid-10x/` is full-colour RGBA and the game
 * is sixteen palette indices, so two things have to be true of it that
 * are not true of a picture simply drawn on top:
 *
 * * it has to **fade with the screen**, because the palette is the
 *   whole of how this game fades, and a finished RGB pixel has no
 *   index left to move. `fadeOf` is that, as arithmetic;
 * * it has to go **behind** whatever the game drew after him -- a
 *   pillar, a gate, the level door -- without being cut back to the
 *   blocky silhouette the mask is made of. That is the two-part test
 *   in `draw`, and the second half of it is what this file is mostly
 *   about.
 *
 * And the seam itself: `onKidSprite` is optional and nothing in
 * `src/pop` passes one, so every headless tool and every capture
 * comparison is unmoved **by construction**. The last test here is
 * that it is unmoved in fact as well -- the same sixty ticks with the
 * callback and without draw the same surface, byte for byte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame, KID_FIRST_RESOURCE } from '../../src/pop/game.ts';
import { Surface } from '../../src/render/surface.ts';
import { KidHiRes, fadeOf, KID_BANK, SWORD_BANK,
  KID_HIRES_SCALE } from '../../src/render/kid-hires.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** An `ImageData` in a test runner that has no DOM. */
function image(width: number, height: number, fill: (x: number, y: number) => number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fill(x, y) as [number, number, number, number];
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return { width, height, data, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('fadeOf', () => {
  const base: number[] = [];
  for (let i = 0; i < 16; i++) base.push(4 * i, 8 * i, 12 * i);

  const live = (scale: number): Uint8Array => {
    const out = new Uint8Array(256 * 4);
    for (let i = 0; i < 16; i++) {
      const at = (KID_BANK + i) * 4;
      out[at] = base[i * 3]! * scale;
      out[at + 1] = base[i * 3 + 1]! * scale;
      out[at + 2] = base[i * 3 + 2]! * scale;
      out[at + 3] = 255;
    }
    return out;
  };

  it('is 1 when the palette is the one the art was painted for', () => {
    expect(fadeOf(live(1), base)).toBe(1);
  });

  it('halves when the palette halves, which is what a fade does', () => {
    expect(fadeOf(live(0.5), base)).toBeCloseTo(0.5, 2);
  });

  it('is nought on a black screen', () => {
    expect(fadeOf(new Uint8Array(256 * 4), base)).toBe(0);
  });

  it('never exceeds 1, so a flash cannot blow the painting out', () => {
    expect(fadeOf(live(4), base)).toBe(1);
  });
});

describe('the mask', () => {
  const S = KID_HIRES_SCALE;
  // Four game pixels across: two solid, one half-transparent (the soft
  // edge a painted outline has and the original's blit has not), one
  // empty.
  const alphaOf = (col: number): number => (col < 2 ? 255 : col === 2 ? 100 : 0);
  const art = image(4 * S, 2 * S, (x) => [255, 0, 0, alphaOf((x / S) | 0)]);

  /** An 8 by 8 surface, every pixel some other bank's, except as given. */
  function scene(kid: ReadonlyArray<readonly [number, number]>): Surface {
    const surface = new Surface(8, 8);
    surface.pixels.fill(5);
    for (const [x, y] of kid) surface.pixels[y * 8 + x] = KID_BANK + 3;
    return surface;
  }

  function paint(surface: Surface, fade = 1): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 0; i < 8 * 8; i++) { rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
    const kid = new KidHiRes();
    kid.put(401, art);
    kid.draw(rgba, 1, surface, [{ id: 401, x: 0, y: 0, flipped: false }], fade);
    return rgba;
  }

  const red = (rgba: Uint8ClampedArray, x: number, y: number): number => rgba[(y * 8 + x) * 4]!;

  it('paints where the surface still holds one of his own sixteen', () => {
    expect(red(paint(scene([[0, 0], [1, 0]])), 0, 0)).toBe(255);
  });

  it('leaves a solid pixel alone where something else was drawn over him', () => {
    // Row 1 is nobody's: the pillar in front of him.
    expect(red(paint(scene([[0, 0], [1, 0]])), 0, 1)).toBe(0);
  });

  /**
   * **This is the one the first attempt got wrong.** Masking on the
   * index alone gave the painting its staircase back: his smooth edge
   * falls outside the blocky silhouette the game blitted, so every
   * soft pixel was thrown away. The occlusion test applies only where
   * the artwork itself was solid.
   */
  it('paints the soft edge even where the surface is not his', () => {
    const rgba = paint(scene([[0, 0], [1, 0]]));
    expect(red(rgba, 2, 0)).toBeGreaterThan(80);
    expect(red(rgba, 2, 1)).toBeGreaterThan(80);
  });

  /**
   * **The ghost.** On five ticks of the climb at the top of level 1's
   * room 1 the game draws no Prince at all -- the ledge is over the
   * whole of him, 326 of his 326 solid pixels are somebody else's --
   * and a rule that guards only the solid pixels drew his outline in
   * mid-air over the stone.
   */
  it('draws nothing at all when none of him survived', () => {
    const kid = new KidHiRes();
    kid.put(401, art);
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    const drawn = kid.draw(rgba, 1, scene([]), [{ id: 401, x: 0, y: 0, flipped: false }], 1);
    expect(drawn).toBe(0);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });

  it('leaves the fully transparent part of the box untouched', () => {
    expect(red(paint(scene([[0, 0], [1, 0]])), 3, 0)).toBe(0);
  });

  it('dims with the palette, which is how it fades with the screen', () => {
    expect(red(paint(scene([[0, 0], [1, 0]]), 0.5), 0, 0)).toBe(128);
  });

  it('draws nothing at all for a frame it has no artwork for', () => {
    const kid = new KidHiRes();
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    expect(kid.draw(rgba, 1, scene([]), [{ id: 402, x: 0, y: 0, flipped: false }], 1)).toBe(0);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });
});

/**
 * The fighting frames are painted a second time **with the sword**,
 * at an offset of their own, because the blade reaches out of the box
 * the engine blits him in.
 */
describe('the sword', () => {
  const S = KID_HIRES_SCALE;
  // Two game pixels of body, and a blade three to its left, in a
  // painting that begins four pixels left of the body's own box.
  const body = image(2 * S, 1 * S, () => [200, 180, 150, 255]);
  const armed = image(6 * S, 1 * S, (x) => {
    const cell = (x / S) | 0;
    if (cell >= 4) return [200, 180, 150, 255];   // the body
    if (cell >= 1) return [120, 120, 130, 255];   // the blade
    return [0, 0, 0, 0];
  });

  function paint(indices: ReadonlyArray<number>): Uint8ClampedArray {
    const surface = new Surface(10, 2);
    surface.pixels.fill(5);
    indices.forEach((v, x) => { surface.pixels[x] = v; });
    const rgba = new Uint8ClampedArray(10 * 2 * 4);
    const kid = new KidHiRes();
    kid.put(401, body);
    kid.putSword(401, armed, -4 * S, 0);
    kid.draw(rgba, 1, surface, [{ id: 401, x: 4, y: 0, flipped: false }], 1);
    return rgba;
  }
  const blue = (rgba: Uint8ClampedArray, x: number): number => rgba[x * 4 + 2]!;

  it('paints the blade where the engine drew its own sword', () => {
    // x 0..3 is the painting's blade, 4..5 his body. The engine's
    // sword is one pixel thinner, which is exactly the case the
    // slack is for: it is at 2 and 3 and the painting reaches 1.
    const rgba = paint([5, 5, SWORD_BANK + 1, SWORD_BANK + 1, KID_BANK + 1, KID_BANK + 1]);
    expect(blue(rgba, 1)).toBeGreaterThan(100);
    expect(blue(rgba, 2)).toBeGreaterThan(100);
    expect(blue(rgba, 3)).toBeGreaterThan(100);
  });

  it('does not paint a blade the engine drew nowhere near', () => {
    const rgba = paint([5, 5, 5, 5, KID_BANK + 1, KID_BANK + 1]);
    expect(blue(rgba, 1)).toBe(0);
    expect(blue(rgba, 2)).toBe(0);
  });

  it('keeps the body on the exact test, so a pillar still cuts him', () => {
    // His own second body pixel is somebody else's: it stays theirs.
    const rgba = paint([5, 5, SWORD_BANK + 1, SWORD_BANK + 1, KID_BANK + 1, 5]);
    expect(rgba[4 * 4]).toBeGreaterThan(100);
    expect(rgba[5 * 4]).toBe(0);
  });
});

describe('the seam', () => {
  async function run(sprites?: Array<[number, number, number, boolean]>): Promise<Uint8Array> {
    const game = await PopGame.start(assets, exe, 1, sprites
      ? { onKidSprite: (id, x, y, flipped) => { sprites.push([id, x, y, flipped]); } }
      : {});
    let last = game.render();
    for (let t = 0; t < 60; t++) {
      game.step({ x: t > 20 ? 1 : 0, y: 0, shift: false });
      last = game.render();
    }
    return Uint8Array.from(last.pixels);
  }

  it('reports the Prince and moves not one pixel of the picture', async () => {
    const seen: Array<[number, number, number, boolean]> = [];
    const withIt = await run(seen);
    const without = await run();
    expect(withIt).toEqual(without);
    expect(seen.length).toBeGreaterThan(50);
    for (const [id, x, y] of seen) {
      expect(id).toBeGreaterThanOrEqual(KID_FIRST_RESOURCE);
      expect(id).toBeLessThan(KID_FIRST_RESOURCE + 219);
      expect(x).toBeGreaterThan(-64);
      expect(y).toBeGreaterThan(-64);
    }
  });
});
