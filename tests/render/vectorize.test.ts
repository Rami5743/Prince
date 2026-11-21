/**
 * The art traced into outlines.
 *
 * The three rules of `src/render/vectorize.ts`, each as arithmetic:
 * nothing is lost, there are no seams, and a mixture of the two is
 * what decides the index of every pixel. The last of those is checked
 * **by rasterizing the paths here**, with a point-in-polygon walk
 * rather than a browser, so that the property holds of the geometry
 * and not of one rasterizer's rounding.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  vectorize, TOLERANCE, SPECK, CORNER_ANGLE, DENOISE, MERGE,
} from '../../src/render/vectorize.ts';
import { DatFile } from '../../src/dat/container.ts';
import { decodeImage, isImage, isEmptyPlaceholder } from '../../src/dat/image.ts';
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

/** The `M x y L x y ... Z` of a sharp path, as closed loops of points. */
function loopsOf(path: string): number[][] {
  const out: number[][] = [];
  for (const piece of path.split('M').slice(1)) {
    const nums = piece.replace(/Z/g, '').split('L').flatMap((p) => {
      const [a, b] = p.trim().split(/\s+/);
      return [Number(a), Number(b)];
    });
    out.push(nums);
  }
  return out;
}

/** Nonzero winding: positive inside, nought outside, holes taken out. */
function winding(loops: readonly number[][], x: number, y: number): number {
  let w = 0;
  for (const loop of loops) {
    const n = loop.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = loop[i * 2]!; const ay = loop[i * 2 + 1]!;
      const bx = loop[j * 2]!; const by = loop[j * 2 + 1]!;
      if (ay <= y) {
        if (by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      } else if (by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
    }
  }
  return w;
}

describe('the tracer', () => {
  it('traces a single pixel as its own square', () => {
    const { ix, w, h } = pic(['000', '010', '000']);
    const v = vectorize(ix, w, h, { transparent: 0, sharp: true });
    expect(v.layers.length).toBe(1);
    expect(v.layers[0]!.index).toBe(1);
    expect(v.layers[0]!.path).toBe('M1 1L2 1L2 2L1 2Z');
  });

  it('takes a hole out of a ring, by winding and not by luck', () => {
    const { ix, w, h } = pic(['111', '101', '111']);
    const v = vectorize(ix, w, h, { transparent: 0, sharp: true });
    const loops = loopsOf(v.layers[0]!.path);
    expect(loops.length, 'the outside and the hole').toBe(2);
    expect(winding(loops, 1.5, 1.5), 'the middle is outside').toBe(0);
    expect(winding(loops, 0.5, 0.5), 'the ring is inside').not.toBe(0);
  });

  it('keeps a pixel that only touches its neighbour at a corner', () => {
    // The right-hand rule joins the diagonal, so this is one region
    // and not two -- but either way neither pixel may be lost.
    const { ix, w, h } = pic(['0000', '0100', '0010', '0000']);
    const v = vectorize(ix, w, h, { transparent: 0, sharp: true });
    const loops = loopsOf(v.layers[0]!.path);
    expect(winding(loops, 1.5, 1.5)).not.toBe(0);
    expect(winding(loops, 2.5, 2.5)).not.toBe(0);
    expect(winding(loops, 2.5, 1.5), 'and nothing between them').toBe(0);
  });

  it('stacks its layers, so that no seam can show between two indices', () => {
    const { ix, w, h } = pic(['1122', '1122']);
    const v = vectorize(ix, w, h, { sharp: true });
    expect(v.layers.length).toBe(2);
    // The first layer covers the whole picture; the second paints over
    // its own half. Nothing is left for the background to show through.
    const first = loopsOf(v.layers[0]!.path);
    for (const x of [0.5, 1.5, 2.5, 3.5]) {
      expect(winding(first, x, 0.5), `x ${x} of the bottom layer`).not.toBe(0);
    }
  });

  it('is the settings the sheets were chosen with', () => {
    expect(TOLERANCE).toBe(1);
    expect(SPECK).toBe(2.5);
    expect(CORNER_ANGLE, 'gentler than this is carried by one curve').toBe(72);
    expect(DENOISE, 'a patch this small may be the artist\'s dither').toBe(4);
    expect(MERGE, 'and only if its colour is this close to its neighbour').toBe(170);
  });

  /**
   * The dither goes and the face stays, which is the whole of the
   * denoise and is the thing that was got wrong twice: once too
   * timid -- the background got a vote, so a speck on the silhouette
   * edge read as half air and nothing dissolved -- and once too
   * greedy, which took the Prince's eye with it.
   */
  it('dissolves a speck of a near colour and keeps one of a far colour', () => {
    const near = new Uint8Array(256 * 4);
    near[1 * 4] = 250; near[1 * 4 + 1] = 250; near[1 * 4 + 2] = 240;
    near[2 * 4] = 230; near[2 * 4 + 1] = 230; near[2 * 4 + 2] = 220;
    near[3 * 4] = 40; near[3 * 4 + 1] = 20; near[3 * 4 + 2] = 20;
    const { ix, w, h } = pic([
      '11111',
      '11211',
      '11111',
      '11311',
      '11111',
    ]);
    const v = vectorize(ix, w, h, { palette: near });
    const indices = new Set(v.layers.map((l) => l.index));
    expect(indices.has(2), 'the dither speck is gone').toBe(false);
    expect(indices.has(3), 'the dark speck stays').toBe(true);
  });
});

describe('the Prince, traced', () => {
  const kid = new DatFile(
    new Uint8Array(readFileSync(join(GAME_DIR, 'KID.DAT'))), 'KID.DAT',
  );
  const sprites: { id: number; w: number; h: number; px: Uint8Array }[] = [];
  for (const entry of kid.entries.slice().sort((a, b) => a.id - b.id)) {
    if (entry.id <= 400) continue;
    const payload = kid.get(entry.id);
    if (isEmptyPlaceholder(payload) || payload.length === 100 || !isImage(payload)) continue;
    try {
      const img = decodeImage(payload);
      sprites.push({ id: entry.id, w: img.width, h: img.height, px: img.pixels });
    } catch { /* not a picture */ }
  }

  it('is all 218 of him', () => {
    expect(sprites.length).toBe(218);
  });

  it('gives every sprite a layer for every colour it uses', () => {
    for (const s of sprites) {
      const used = new Set(s.px);
      used.delete(0);
      const v = vectorize(s.px, s.w, s.h, { transparent: 0, denoise: 0 });
      expect(new Set(v.layers.map((l) => l.index)), `sprite ${s.id}`).toEqual(used);
    }
  });

  /**
   * With the dither dissolved a sprite keeps fewer colours, and that
   * is the point. What may **not** happen is a colour the sprite is
   * actually drawn in going away: a colour whose largest connected
   * patch is bigger than `DENOISE` is still a layer. A colour that
   * exists only as scattered single pixels is dither by definition,
   * however many of them there are, and it goes.
   */
  it('dissolves only small patches, never a colour the sprite is made of', () => {
    for (const s of sprites) {
      const biggest = new Map<number, number>();
      const seen = new Int32Array(s.w * s.h).fill(-1);
      for (let seed = 0; seed < s.w * s.h; seed++) {
        if (seen[seed] !== -1) continue;
        const index = s.px[seed]!;
        const stack = [seed];
        seen[seed] = seed;
        let n = 0;
        while (stack.length > 0) {
          const cell = stack.pop()!;
          n++;
          const x = cell % s.w; const y = (cell - x) / s.w;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = x + dx; const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
            const to = ny * s.w + nx;
            if (seen[to] !== -1 || s.px[to] !== index) continue;
            seen[to] = seed;
            stack.push(to);
          }
        }
        if (index !== 0) biggest.set(index, Math.max(biggest.get(index) ?? 0, n));
      }
      const v = vectorize(s.px, s.w, s.h, { transparent: 0 });
      const kept = new Set(v.layers.map((l) => l.index));
      for (const [index, n] of biggest) {
        if (n > DENOISE) expect(kept.has(index), `sprite ${s.id} index ${index}`).toBe(true);
      }
      for (const index of kept) {
        expect(biggest.has(index), `sprite ${s.id} invented index ${index}`).toBe(true);
      }
    }
  });

  /**
   * The whole of the first rule, as arithmetic.
   *
   * Every pixel centre is put through the stack -- the last layer that
   * contains it wins, exactly as a painter would -- and the index that
   * comes out has to be the index that went in. A speck dropped, a
   * seam left between two regions or a layer in the wrong order all
   * fail it. The browser says the same thing from the other end
   * (`tools/dev/vector-sheets.ts --sharp --exact`: 0 pixels wrong over
   * all 218), and this says it of the geometry.
   */
  it('puts every pixel of a sprite back, index for index', () => {
    // Twelve, chosen across the sheet rather than at random: standing,
    // running, hanging, the sword, the blood, the star, the crumbs.
    const some = [401, 424, 440, 462, 478, 500, 533, 569, 593, 611, 617, 619];
    for (const id of some) {
      const s = sprites.find((q) => q.id === id)!;
      expect(s, `sprite ${id}`).toBeDefined();
      const v = vectorize(s.px, s.w, s.h, { transparent: 0, sharp: true });
      const loops = v.layers.map((l) => loopsOf(l.path));
      let wrong = 0;
      for (let y = 0; y < s.h; y++) {
        for (let x = 0; x < s.w; x++) {
          let got = 0;
          for (let k = 0; k < loops.length; k++) {
            if (winding(loops[k]!, x + 0.5, y + 0.5) !== 0) got = v.layers[k]!.index;
          }
          if (got !== s.px[y * s.w + x]) wrong++;
        }
      }
      expect(wrong, `sprite ${id}`).toBe(0);
    }
  }, 120000);

  /**
   * Smoothing may soften an edge; it may not move the shape.
   *
   * Measured over every sprite: no point of any smoothed path is more
   * than `TOLERANCE + ROUND` outside the sprite's own box, and the
   * traced area is within a fifth of the pixel count. A tolerance that
   * started eating the art would fail the second of those long before
   * an eye could see it on a contact sheet.
   */
  it('stays inside the sprite it came from, and keeps its weight', () => {
    for (const s of sprites) {
      const v = vectorize(s.px, s.w, s.h, { transparent: 0 });
      // A spline's control points may reach a little outside the
      // sprite's own box; the curve itself does not go far.
      for (const layer of v.layers) {
        for (const n of layer.path.match(/-?\d+(\.\d+)?/g) ?? []) {
          expect(Number(n), `sprite ${s.id}`).toBeGreaterThanOrEqual(-2);
        }
      }
      const opaque = [...s.px].filter((p) => p !== 0).length;
      const base = vectorize(s.px, s.w, s.h, { transparent: 0, sharp: true });
      // The bottom layer is the silhouette; its area is the sprite's.
      const sharpArea = Math.abs(shoelace(loopsOf(base.layers[0]!.path)));
      expect(sharpArea, `sprite ${s.id}`).toBeCloseTo(opaque, 6);
    }
  }, 120000);
});

/** The signed area of a set of loops. */
function shoelace(loops: readonly number[][]): number {
  let total = 0;
  for (const loop of loops) {
    const n = loop.length / 2;
    let a = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      a += loop[i * 2]! * loop[j * 2 + 1]! - loop[j * 2]! * loop[i * 2 + 1]!;
    }
    total += a / 2;
  }
  return total;
}
