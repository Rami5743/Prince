/**
 * 1.4's artwork, and the measurement that says what it really is.
 *
 * The player supplied a copy of the last DOS release believing it
 * might hold a different map. **It does not**, and that is the first
 * thing pinned here: its `LEVELS.DAT` is byte for byte this
 * repository's own, so the map, the hour, the hit points and every
 * starting position are 1.0's.
 *
 * What 1.4 really changed is narrower than its file sizes suggest,
 * and the difference between "the bytes differ" and "the picture
 * differs" is the whole of it: `VDUNGEON.DAT` has 72 of its 218
 * resources byte-different and **not one of them decodes to a
 * different picture** -- the later release merely re-packed them,
 * which is where its 3287 saved bytes went. So the dungeon art is
 * identical and the green dungeon of 1.3 and 1.4 is **not** redrawn
 * tiles: it is `PRINCE.DAT` resource 20, the five alternate level
 * palettes, which 1.0 has not got at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatFile } from '../../src/dat/container.ts';
import { decodeImage } from '../../src/dat/image.ts';
import { REPO } from '../helpers/fixtures.ts';

const ONE = join(REPO, 'original/prince1');
const FOUR = join(REPO, 'original/prince14');
const read = (dir: string, name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(dir, name)));
const dat = (dir: string, name: string): DatFile => new DatFile(read(dir, name), name);

/** The five that 1.4 draws differently, and nothing else is copied. */
const COPIED = ['PRINCE.DAT', 'TITLE.DAT', 'VDUNGEON.DAT', 'VPALACE.DAT', 'SKEL.DAT'];

describe("1.4's artwork", () => {
  it('is five files, all of them present', () => {
    for (const f of COPIED) expect(existsSync(join(FOUR, f)), f).toBe(true);
  });

  it('is NOT a different map: LEVELS.DAT was identical, so it is not copied', () => {
    expect(existsSync(join(FOUR, 'LEVELS.DAT'))).toBe(false);
  });

  it('leaves every character and every sound of 1.0 alone', () => {
    // These were compared against the player's own copy of 1.4 and
    // were identical, which is why none of them is here.
    for (const f of ['KID.DAT', 'GUARD.DAT', 'PV.DAT', 'VIZIER.DAT', 'SHADOW.DAT',
      'FAT.DAT', 'IBM_SND1.DAT', 'IBM_SND2.DAT', 'LEVELS.DAT']) {
      expect(existsSync(join(FOUR, f)), f).toBe(false);
    }
  });

  it('redraws no dungeon tile at all -- the 72 that differ are re-packed', () => {
    const a = dat(ONE, 'VDUNGEON.DAT');
    const b = dat(FOUR, 'VDUNGEON.DAT');
    let bytes = 0;
    let pictures = 0;
    for (const id of a.ids()) {
      if (!b.has(id)) continue;
      const x = a.get(id);
      const y = b.get(id);
      if (x.length === y.length && x.every((v, k) => v === y[k])) continue;
      bytes++;
      const ia = decodeImage(x);
      const ib = decodeImage(y);
      if (ia.width !== ib.width || ia.height !== ib.height
        || !ia.pixels.every((v, k) => v === ib.pixels[k])) pictures++;
    }
    expect(bytes).toBe(72);
    expect(pictures).toBe(0);
    expect(read(FOUR, 'VDUNGEON.DAT').length)
      .toBeLessThan(read(ONE, 'VDUNGEON.DAT').length);
  });

  it('does redraw nine palace tiles, three title pictures and five skeletons', () => {
    const count = (name: string): number => {
      const a = dat(ONE, name);
      const b = dat(FOUR, name);
      let n = 0;
      for (const id of a.ids()) {
        if (!b.has(id)) continue;
        const x = a.get(id);
        const y = b.get(id);
        if (x.length === y.length && x.every((v, k) => v === y[k])) continue;
        let ia; let ib;
        try { ia = decodeImage(x); ib = decodeImage(y); } catch { continue; }
        if (ia.width !== ib.width || ia.height !== ib.height
          || !ia.pixels.every((v, k) => v === ib.pixels[k])) n++;
      }
      return n;
    };
    expect(count('VPALACE.DAT')).toBe(9);
    expect(count('TITLE.DAT')).toBe(3);
    expect(count('SKEL.DAT')).toBe(5);
  });

  it('carries resource 20, the five alternate level palettes 1.0 has not got', () => {
    const a = dat(ONE, 'PRINCE.DAT');
    const b = dat(FOUR, 'PRINCE.DAT');
    expect(a.has(20)).toBe(false);
    expect(b.has(20)).toBe(true);
    const r = b.get(20);
    expect(r.length).toBe(240); // five palettes of sixteen RGB triples
    expect(r.length / 0x30).toBe(5);
    // and the table that reads it never asks for a sixth
    const TBL = [0, 0, 0, 1, 0, 0, 0, 1, 2, 2, 0, 0, 3, 3, 4, 0];
    expect(Math.max(...TBL)).toBe(5 - 1);
  });

  it('keeps the two resources the port reads out of PRINCE.DAT', () => {
    // 10 is the guard's seven liveries, and 150 and 700 are sprite
    // groups. If 1.4 had moved any of them, serving its PRINCE.DAT
    // would change more than the colours.
    const a = dat(ONE, 'PRINCE.DAT');
    const b = dat(FOUR, 'PRINCE.DAT');
    for (const id of [10, 150, 700]) {
      expect(b.has(id), String(id)).toBe(true);
      const x = a.get(id);
      const y = b.get(id);
      expect(x.length === y.length && x.every((v, k) => v === y[k]), String(id)).toBe(true);
    }
  });
});
