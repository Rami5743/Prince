/**
 * The 4-D modification's map, and exactly how much of it is new.
 *
 * Its own `FILE_ID.DIZ` says "100% new levels and FX!", and that is
 * the claim this measures. Six of its levels are new and five are
 * the original's own, and it has eleven where the game has sixteen --
 * so the map the page plays is **built** from both files and neither
 * is served whole.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatFile } from '../../src/dat/container.ts';
import { parseLevel, FIRST_LEVEL_RESOURCE, LAST_LEVEL_RESOURCE } from '../../src/dat/level.ts';
import {
  levelsDatWithFourD, FOURD_FIRST, FOURD_LAST, FOURD_NEW_LEVELS,
} from '../../src/dat/fourd-level.ts';
import { REPO } from '../helpers/fixtures.ts';

const original = new Uint8Array(
  readFileSync(join(REPO, 'original/prince1/LEVELS.DAT')));
const kirill = new Uint8Array(
  readFileSync(join(REPO, 'original/fourd/KIRILL.DAT')));

describe("the 4-D modification's map", () => {
  it('has eleven level records where the game has sixteen', () => {
    const src = new DatFile(kirill, 'KIRILL.DAT');
    const real = src.entries.filter((e) => e.size > 0);
    expect(real.length).toBe(11);
    expect(real[0]!.id).toBe(FOURD_FIRST);
    expect(real[real.length - 1]!.id).toBe(FOURD_LAST);
    // and the five it has not got are written as blanks, not left out
    expect(src.entries.length).toBe(16);
    expect(src.entries.filter((e) => e.size === 0).length).toBe(5);
    // the same file length and the same record size as the original's
    expect(kirill.length).toBe(original.length);
    for (const e of real) expect(e.size).toBe(2305);
  });

  it('rewrote levels 2 to 7 and left the rest of its eleven alone', () => {
    const a = new DatFile(original, 'LEVELS.DAT');
    const b = new DatFile(kirill, 'KIRILL.DAT');
    const changed: number[] = [];
    for (let id = FOURD_FIRST; id <= FOURD_LAST; id++) {
      const x = parseLevel(a.get(id), id);
      const y = parseLevel(b.get(id), id);
      let n = 0;
      for (let i = 0; i < x.fg.length; i++) if (x.fg[i] !== y.fg[i]) n++;
      if (n > 0) changed.push(id - FIRST_LEVEL_RESOURCE + 1);
    }
    expect(changed).toEqual([...FOURD_NEW_LEVELS]);
  });

  it('builds a whole sixteen-level map, the mod for eleven and the game for five', () => {
    const merged = levelsDatWithFourD(original, kirill);
    expect(merged.length).toBe(original.length);
    const m = new DatFile(merged, 'LEVELS.DAT');
    const a = new DatFile(original, 'LEVELS.DAT');
    const b = new DatFile(kirill, 'KIRILL.DAT');
    for (let id = FIRST_LEVEL_RESOURCE; id <= LAST_LEVEL_RESOURCE; id++) {
      const got = m.get(id);
      const want = id <= FOURD_LAST ? b.get(id) : a.get(id);
      expect(got.length, `resource ${id}`).toBe(want.length);
      expect(got.every((v, k) => v === want[k]), `resource ${id}`).toBe(true);
    }
    // every record still parses, including the five taken from the game
    for (let id = FIRST_LEVEL_RESOURCE; id <= LAST_LEVEL_RESOURCE; id++) {
      expect(() => parseLevel(m.get(id), id), `resource ${id}`).not.toThrow();
    }
  });

  it('leaves the two files on disc alone', () => {
    const before = original.slice();
    levelsDatWithFourD(original, kirill);
    expect(original.every((v, i) => v === before[i])).toBe(true);
    expect(new Uint8Array(readFileSync(join(REPO, 'original/prince1/LEVELS.DAT')))
      .every((v, i) => v === before[i])).toBe(true);
  });

  it('keeps every record checksummed, which is how the game reads one', () => {
    const m = new DatFile(levelsDatWithFourD(original, kirill), 'LEVELS.DAT');
    for (const e of m.entries) {
      let sum = 0;
      for (const v of m.get(e.id)) sum = (sum + v) & 0xff;
      const check = levelsDatWithFourD(original, kirill)[e.offset]!;
      expect((check + sum) & 0xff, `resource ${e.id}`).toBe(0xff);
    }
  });
});
