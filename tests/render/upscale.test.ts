/**
 * The picture enlarged for `quality: high`.
 *
 * Two halves. `scale2x`/`scale3x` are the shape, and they invent no
 * index -- that is Scale2x's and Scale3x's own published rules, with
 * a run over fourteen real rooms to say it holds on the art and not
 * only on a three-by-three test pattern.
 *
 * `antialias` is the colour, and it is allowed to invent one, which
 * the first version of this file was not and which is why it was
 * rejected: an edge made only of the original's own colours is a
 * staircase however finely it is cut. What it may **not** do is
 * invent a colour that stops obeying the palette -- the game rewrites
 * the palette while it plays -- so the mixtures are kept as indices
 * and the test that matters is that halving the palette halves the
 * picture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  scale2x, scale3x, upscale, antialias, composeAntialiased, AA_FACTOR, MIX_PARTS,
} from '../../src/render/upscale.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { GAME_DIR } from '../helpers/fixtures.ts';

/** A little picture from rows of characters, one character a pixel. */
function pic(rows: readonly string[]): { ix: Uint8Array; w: number; h: number } {
  const w = rows[0]!.length;
  const ix = new Uint8Array(w * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) ix[y * w + x] = row.charCodeAt(x) - 48;
  });
  return { ix, w, h: rows.length };
}

function show(ix: Uint8Array, w: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < ix.length / w; y++) {
    out.push([...ix.slice(y * w, y * w + w)].map((v) => String.fromCharCode(48 + v)).join(''));
  }
  return out;
}

describe('Scale2x', () => {
  it('leaves a flat area flat', () => {
    const { ix, w, h } = pic(['111', '111', '111']);
    expect(show(scale2x(ix, w, h), w * 2)).toEqual([
      '111111', '111111', '111111', '111111', '111111', '111111',
    ]);
  });

  it('rounds the inside corner of a step, and nothing else', () => {
    // Worked through by hand at the pixel the rule fires on, which is
    // the 0 at (1,1): B=0, H=1, D=0, F=1, so `B !== H && D !== F`
    // holds, and of the four corners only `H === F` is true -- so the
    // one subpixel that changes is the bottom right of that pixel,
    // and the other fifteen of the block are copies.
    const { ix, w, h } = pic(['0011', '0011', '1111', '1111']);
    expect(show(scale2x(ix, w, h), w * 2)).toEqual([
      '00001111',
      '00001111',
      '00001111',
      '00011111',
      '11111111',
      '11111111',
      '11111111',
      '11111111',
    ]);
  });

  it('cuts the corner of a diagonal', () => {
    const { ix, w, h } = pic(['000', '100', '110']);
    // At the 1 at (0,1): B=0, H=1, D=1 (the edge clamps), F=0, so
    // `B === F` cuts its top right away and `D === H` fills its
    // bottom left -- the step turns into a slope.
    expect(show(scale2x(ix, w, h), w * 2)).toEqual([
      '000000',
      '000000',
      '100000',
      '111000',
      '111000',
      '111100',
    ]);
  });

  it('keeps a one-pixel line, which is what the B !== H guard is for', () => {
    const { ix, w, h } = pic(['010', '010', '010']);
    expect(show(scale2x(ix, w, h), w * 2)).toEqual([
      '001100', '001100', '001100', '001100', '001100', '001100',
    ]);
    expect(show(scale3x(ix, w, h), w * 3)[4]).toBe('000111000');
  });
});

describe('Scale3x', () => {
  it('always keeps the pixel itself in the middle', () => {
    // A single 2 among 1s: Scale3x's centre is unconditionally E, so
    // the speckles in the dungeon brick survive.
    const { ix, w, h } = pic(['111', '121', '111']);
    const out = scale3x(ix, w, h);
    expect(out[4 * (w * 3) + 4]).toBe(2);
  });

  it('leaves a flat area flat', () => {
    const { ix, w, h } = pic(['111', '111', '111']);
    expect(new Set(scale3x(ix, w, h))).toEqual(new Set([1]));
  });

  it('rounds a diagonal three ways where Scale2x rounds it one', () => {
    const { ix, w, h } = pic(['000', '100', '110']);
    expect(show(scale3x(ix, w, h), w * 3)).toEqual([
      '000000000',
      '000000000',
      '000000000',
      '100000000',
      '111000000',
      '111100000',
      '111110000',
      '111110000',
      '111111000',
    ]);
  });
});

describe('upscale', () => {
  it('gives the size asked for', () => {
    const { ix, w, h } = pic(['01', '10']);
    expect(upscale(ix, w, h, 1).length).toBe(4);
    expect(upscale(ix, w, h, 2).length).toBe(16);
    expect(upscale(ix, w, h, 3).length).toBe(36);
    expect(upscale(ix, w, h, 6).length).toBe(144);
  });

  it('invents no index, on fourteen real rooms of the game', async () => {
    const assets = new Assets(
      async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))),
    );
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    for (let level = 1; level <= 14; level++) {
      const game = await PopGame.start(assets, exe, level, { minutesLeft: 60, seed: 1 });
      for (let t = 0; t < 20; t++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
      const surface = game.render();
      const had = new Set(surface.pixels);
      for (const factor of [2, 3, 6] as const) {
        const out = upscale(surface.pixels, surface.width, surface.height, factor);
        expect(out.length, `level ${level} x${factor}`)
          .toBe(surface.width * surface.height * factor * factor);
        for (const v of new Set(out)) {
          expect(had.has(v), `level ${level} x${factor} invented index ${v}`).toBe(true);
        }
      }
    }
  }, 120000);
});

describe('antialias', () => {
  const flatPalette = (): Uint8Array => {
    // index 0 black, index 1 white, index 2 mid grey.
    const p = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) p[i * 4 + 3] = 255;
    p[4] = 255; p[5] = 255; p[6] = 255;
    p[8] = 128; p[9] = 128; p[10] = 128;
    return p;
  };

  it('finds no mixture in a flat picture', () => {
    const { ix, w, h } = pic(['111', '111', '111']);
    const aa = antialias(ix, w, h);
    expect(aa.width).toBe(w * AA_FACTOR);
    expect(aa.height).toBe(h * AA_FACTOR);
    expect(aa.mixCount).toBe(0);
    expect(new Set(aa.base)).toEqual(new Set([1]));
  });

  it('mixes along a diagonal, nine ninths every time', () => {
    const { ix, w, h } = pic(['0000', '1000', '1100', '1110']);
    const aa = antialias(ix, w, h);
    expect(aa.mixCount, 'a diagonal has edges to soften').toBeGreaterThan(5);
    for (let k = 0; k < aa.mixCount; k++) {
      let sum = 0;
      for (let j = 0; j < MIX_PARTS; j++) sum += aa.mixWeights[k * MIX_PARTS + j]!;
      expect(sum, `mixture ${k}`).toBe(9);
      // A mixture that is all centre would not be a mixture.
      expect(aa.mixWeights[k * MIX_PARTS]).toBeLessThan(9);
    }
  });

  it('puts colours on the edge that the palette does not hold', () => {
    const { ix, w, h } = pic(['0000', '1000', '1100', '1110']);
    const aa = antialias(ix, w, h);
    const out = new Uint8ClampedArray(aa.width * aa.height * 4);
    composeAntialiased(aa, flatPalette(), out);
    const greys = new Set<number>();
    for (let i = 0; i < out.length; i += 4) greys.add(out[i]!);
    expect(greys.has(0), 'the black is still black').toBe(true);
    expect(greys.has(255), 'the white is still white').toBe(true);
    // And in between: the whole point of the round.
    const between = [...greys].filter((v) => v > 0 && v < 255);
    expect(between.length, `only ${[...greys].join()}`).toBeGreaterThan(2);
  });

  it('halves when the palette halves, which is what a fade is', () => {
    const { ix, w, h } = pic(['0000', '1000', '1100', '1110']);
    const aa = antialias(ix, w, h);
    const full = flatPalette();
    const half = new Uint8Array(full);
    for (let i = 0; i < 256; i++) {
      for (let c = 0; c < 3; c++) half[i * 4 + c] = full[i * 4 + c]! >> 1;
    }
    const a = new Uint8ClampedArray(aa.width * aa.height * 4);
    const b = new Uint8ClampedArray(aa.width * aa.height * 4);
    composeAntialiased(aa, full, a);
    composeAntialiased(aa, half, b);
    for (let i = 0; i < a.length; i += 4) {
      // Within a unit of half, which is the rounding of the halved
      // palette entries themselves.
      expect(Math.abs(b[i]! - a[i]! / 2), `pixel ${i / 4}`).toBeLessThanOrEqual(1.5);
    }
  });

  it('invents no colour outside the ones the frame uses, on real rooms', async () => {
    const assets = new Assets(
      async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))),
    );
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    for (const level of [1, 4, 9, 13]) {
      const game = await PopGame.start(assets, exe, level, { minutesLeft: 60, seed: 1 });
      for (let t = 0; t < 20; t++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
      const surface = game.render();
      const pal = game.scene.screenPalette.toRgba();
      const aa = antialias(surface.pixels, surface.width, surface.height);
      const out = new Uint8ClampedArray(aa.width * aa.height * 4);
      composeAntialiased(aa, pal, out);

      // Every channel of every output pixel is inside the range the
      // frame's own palette entries span, so nothing is a new hue --
      // it is a mixture of what was there.
      const used = new Set(surface.pixels);
      let lo = [255, 255, 255]; let hi = [0, 0, 0];
      for (const i of used) {
        for (let c = 0; c < 3; c++) {
          const v = pal[i * 4 + c]!;
          if (v < lo[c]!) lo[c] = v;
          if (v > hi[c]!) hi[c] = v;
        }
      }
      const colours = new Set<number>();
      for (let i = 0; i < out.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          expect(out[i + c]!, `level ${level} channel ${c}`).toBeGreaterThanOrEqual(lo[c]! - 1);
          expect(out[i + c]!, `level ${level} channel ${c}`).toBeLessThanOrEqual(hi[c]! + 1);
        }
        colours.add((out[i]! << 16) | (out[i + 1]! << 8) | out[i + 2]!);
      }
      // And there really are more of them than the frame started with:
      // this is the measurement the round turns on.
      expect(colours.size, `level ${level}`).toBeGreaterThan(used.size * 3);
      expect(aa.mixCount / (aa.width * aa.height), `level ${level} mixed share`)
        .toBeLessThan(0.25);
    }
  }, 120000);
});
