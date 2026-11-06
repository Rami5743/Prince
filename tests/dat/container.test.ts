import { describe, it, expect } from 'vitest';
import { ALL_DATS, dat } from '../helpers/fixtures.ts';
import { parsePalette } from '../../src/dat/palette.ts';
import {
  SPRITE_GROUPS, TILESET_FILES, TILESET_GROUPS, GUARD_SPRITES, GUARD_PALETTE_FILES,
} from '../../src/dat/groups.ts';

describe('DAT container', () => {
  it.each(ALL_DATS)('%s has a self-consistent index', (name) => {
    const d = dat(name);
    expect(d.indexSize).toBe(2 + 8 * d.entries.length);
    expect(d.indexOffset + d.indexSize).toBe(d.bytes.length);
  });

  it.each(ALL_DATS)('%s: every resource checksum is correct', (name) => {
    const d = dat(name);
    const bad = d.entries.filter((e) => !d.verify(e.id)).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  // Index entries are sorted by id, which in a few files is not the order
  // the payloads were written in; in offset order there is never a gap.
  it.each(ALL_DATS)('%s: resources tile the file with no gaps', (name) => {
    const d = dat(name);
    let pos = 6;
    for (const e of [...d.entries].sort((a, b) => a.offset - b.offset)) {
      expect(e.offset).toBe(pos);
      pos = e.offset + e.size + 1;
    }
    expect(pos).toBe(d.indexOffset);
  });

  it('reports the resource counts recorded in the inventory', () => {
    const expected: Record<string, number> = {
      'LEVELS.DAT': 16, 'KID.DAT': 220, 'TITLE.DAT': 12, 'PRINCE.DAT': 62,
      'PV.DAT': 103, 'GUARD.DAT': 34, 'FAT.DAT': 35, 'SKEL.DAT': 29,
      'VIZIER.DAT': 35, 'SHADOW.DAT': 33, 'GUARD1.DAT': 1, 'GUARD2.DAT': 1,
      'VDUNGEON.DAT': 218, 'VPALACE.DAT': 238,
    };
    for (const [name, n] of Object.entries(expected)) {
      expect(dat(name).entries.length, name).toBe(n);
    }
  });

  it('the two guard palettes differ only in their CGA and EGA tables', () => {
    const a = dat('GUARD1.DAT').get(750);
    const b = dat('GUARD2.DAT').get(750);
    expect(a.length).toBe(100);
    expect(b.length).toBe(100);
    expect([...a.subarray(0, 52)]).toEqual([...b.subarray(0, 52)]);
    expect([...a.subarray(52)]).not.toEqual([...b.subarray(52)]);
  });
});

describe('sprite groups', () => {
  it('each group header declares exactly the number of images that follow', () => {
    for (const g of SPRITE_GROUPS) {
      const d = dat(g.file);
      const header = d.get(g.header);
      expect(header.length, `${g.file}:${g.header}`).toBe(100);
      const pal = parsePalette(header);
      expect(pal.imageCount, `${g.file}:${g.header} (${g.what})`).toBe(g.imageCount);
      // the declared images are the next imageCount consecutive ids
      for (let i = 1; i <= g.imageCount; i++) {
        expect(d.has(g.header + i), `${g.file}: missing id ${g.header + i}`).toBe(true);
      }
      expect(d.has(g.header + g.imageCount + 1)).toBe(false);
    }
  });

  it('every tile-set file has the same two groups', () => {
    for (const file of TILESET_FILES) {
      const d = dat(file);
      for (const g of TILESET_GROUPS) {
        const pal = parsePalette(d.get(g.header));
        for (let i = 1; i <= pal.imageCount; i++) {
          expect(d.has(g.header + i), `${file}: missing id ${g.header + i}`).toBe(true);
        }
      }
      // every variant holds the same 151 room tiles
      expect(parsePalette(d.get(200)).imageCount, file).toBe(151);
    }
  });

  it('the guard palette files describe the 34 sprites held in GUARD.DAT', () => {
    const guard = dat(GUARD_SPRITES.file);
    for (let i = 0; i < GUARD_SPRITES.imageCount; i++) {
      expect(guard.has(GUARD_SPRITES.firstImage + i)).toBe(true);
    }
    expect(guard.has(GUARD_SPRITES.firstImage + GUARD_SPRITES.imageCount)).toBe(false);
    for (const f of GUARD_PALETTE_FILES) {
      const d = dat(f);
      expect(d.entries.length).toBe(1);
      expect(parsePalette(d.get(750)).imageCount).toBe(GUARD_SPRITES.imageCount);
    }
  });
});
