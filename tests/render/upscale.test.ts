/**
 * The picture enlarged for `quality: high`.
 *
 * The one property that matters is that **no index is invented**: the
 * game rewrites the palette while it plays, so a pixel that is the
 * average of two indices would have nothing left to change and would
 * stay bright through a fade. Everything else here is Scale2x's and
 * Scale3x's own published rules, and a run over fourteen real rooms
 * of the game to say the property holds on the art and not only on a
 * three-by-three test pattern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scale2x, scale3x, upscale } from '../../src/render/upscale.ts';
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
