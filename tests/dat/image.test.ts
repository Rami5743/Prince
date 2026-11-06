import { describe, it, expect } from 'vitest';
import { GRAPHICS_DATS, dat } from '../helpers/fixtures.ts';
import {
  decodeImage, isImage, isEmptyPlaceholder, readImageHeader, CompressionMethod,
} from '../../src/dat/image.ts';
import { parsePalette } from '../../src/dat/palette.ts';
import { SPRITE_GROUPS, TILESET_FILES, TILESET_GROUPS } from '../../src/dat/groups.ts';

/** Resource ids that head a sprite group rather than holding an image. */
function groupHeaderIds(file: string): Set<number> {
  const ids = new Set<number>(
    SPRITE_GROUPS.filter((g) => g.file === file).map((g) => g.header),
  );
  if ((TILESET_FILES as readonly string[]).includes(file)) {
    for (const g of TILESET_GROUPS) ids.add(g.header);
  }
  return ids;
}

interface Census {
  images: number;
  placeholders: number;
  headers: number;
  unexplained: string[];
}

function census(file: string): Census {
  const d = dat(file);
  const headers = groupHeaderIds(file);
  const out: Census = { images: 0, placeholders: 0, headers: 0, unexplained: [] };
  for (const e of d.entries) {
    const p = d.get(e.id);
    if (headers.has(e.id)) {
      parsePalette(p);
      out.headers++;
    } else if (isEmptyPlaceholder(p)) {
      out.placeholders++;
    } else if (isImage(p)) {
      out.images++;
    } else {
      out.unexplained.push(`${e.id} (${p.length} bytes)`);
    }
  }
  return out;
}

describe('image decoding', () => {
  it.each(GRAPHICS_DATS)('%s: every resource is a header, a placeholder or an image', (file) => {
    const c = census(file);
    expect(c.unexplained).toEqual([]);
    expect(c.images).toBeGreaterThan(0);
  });

  it.each(GRAPHICS_DATS)('%s: every image decodes to exactly its stated size', (file) => {
    const d = dat(file);
    const headers = groupHeaderIds(file);
    const failures: string[] = [];
    for (const e of d.entries) {
      const p = d.get(e.id);
      if (headers.has(e.id) || isEmptyPlaceholder(p) || !isImage(p)) continue;
      try {
        const img = decodeImage(p);
        if (img.pixels.length !== img.width * img.height) {
          failures.push(`${e.id}: ${img.pixels.length} pixels for ${img.width}x${img.height}`);
        }
        // The decoder must never read past the payload it was handed.
        if (img.bytesConsumed > p.length - 6) {
          failures.push(`${e.id}: read ${img.bytesConsumed} of ${p.length - 6} available`);
        }
      } catch (err) {
        failures.push(`${e.id}: ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it.each(GRAPHICS_DATS)('%s: no pixel exceeds the bit depth it was packed at', (file) => {
    const d = dat(file);
    const headers = groupHeaderIds(file);
    for (const e of d.entries) {
      const p = d.get(e.id);
      if (headers.has(e.id) || isEmptyPlaceholder(p) || !isImage(p)) continue;
      const img = decodeImage(p);
      const limit = 1 << img.depth;
      let max = 0;
      for (let i = 0; i < img.pixels.length; i++) if (img.pixels[i] > max) max = img.pixels[i];
      expect(max, `${file} id ${e.id} depth ${img.depth}`).toBeLessThan(limit);
    }
  });

  it('all five compression methods are exercised by the shipped data', () => {
    const seen = new Set<number>();
    for (const file of GRAPHICS_DATS) {
      const d = dat(file);
      const headers = groupHeaderIds(file);
      for (const e of d.entries) {
        const p = d.get(e.id);
        if (headers.has(e.id) || isEmptyPlaceholder(p) || !isImage(p)) continue;
        seen.add(readImageHeader(p).method);
      }
    }
    expect([...seen].sort()).toEqual([
      CompressionMethod.Raw,
      CompressionMethod.RleRowMajor,
      CompressionMethod.RleColumnMajor,
      CompressionMethod.LzRowMajor,
      CompressionMethod.LzColumnMajor,
    ]);
  });

  it('the two full-screen title images are 320x200 at 4 bits per pixel', () => {
    const d = dat('TITLE.DAT');
    for (const id of [41, 51]) {
      const h = readImageHeader(d.get(id));
      expect([h.width, h.height, h.depth]).toEqual([320, 200, 4]);
    }
  });

  /**
   * The tile sets are mostly 16-colour art, with a handful of 1-bit images
   * used as masks (one among the room tiles, nine among the palace walls).
   * A renderer has to handle both depths.
   */
  it('tile sets mix 16-colour images with 1-bit masks', () => {
    const counts: Record<string, Record<number, number>> = {};
    for (const [file, lo, hi, label] of [
      ['VDUNGEON.DAT', 201, 351, 'dungeon tiles'],
      ['VDUNGEON.DAT', 361, 377, 'dungeon walls'],
      ['VPALACE.DAT', 201, 351, 'palace tiles'],
      ['VPALACE.DAT', 361, 377, 'palace walls'],
    ] as const) {
      const d = dat(file);
      const byDepth: Record<number, number> = {};
      for (let id = lo; id <= hi; id++) {
        if (!d.has(id)) continue;
        const p = d.get(id);
        if (isEmptyPlaceholder(p)) continue;
        const h = readImageHeader(p);
        byDepth[h.depth] = (byDepth[h.depth] ?? 0) + 1;
      }
      counts[label] = byDepth;
    }
    expect(counts).toEqual({
      'dungeon tiles': { 1: 1, 4: 62 },
      'dungeon walls': { 4: 17 },
      'palace tiles': { 1: 1, 4: 63 },
      'palace walls': { 1: 9, 4: 8 },
    });
  });

  it('the widest room tiles are a full 32-pixel tile', () => {
    const d = dat('VDUNGEON.DAT');
    let max = 0;
    for (let id = 201; id <= 351; id++) {
      const p = d.get(id);
      if (isEmptyPlaceholder(p)) continue;
      max = Math.max(max, readImageHeader(p).width);
    }
    expect(max).toBe(42);
  });
});
