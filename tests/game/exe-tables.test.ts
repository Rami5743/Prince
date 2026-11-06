import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import {
  readExeTables, SEQUENCE_BASE, SEQUENCES_WITH_BAD_OFFSET,
} from '../../src/game/exe-tables.ts';
import { FRAME_STAND } from '../../src/game/character.ts';

const tables = readExeTables(new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE'))));
const cracked = readExeTables(new Uint8Array(readFileSync(join(GAME_DIR, 'PRINCE.EXE'))));

describe('animation tables read from the original executable', () => {
  it('has a frame table for the Prince, the guards and the cut-scenes', () => {
    expect(tables.frameTableKid.length).toBe(241);
    expect(tables.frameTableGuard.length).toBe(41);
    expect(tables.frameTableCutscene.length).toBe(86);
  });

  it('every frame names a sprite that exists', () => {
    // KID.DAT holds 219 sprites; 255 is the "draw nothing" marker.
    for (const [i, f] of tables.frameTableKid.entries()) {
      expect(f.image === 255 || f.image < 219, `kid frame ${i} image ${f.image}`).toBe(true);
    }
    for (const [i, f] of tables.frameTableGuard.entries()) {
      expect(f.image === 255 || f.image < 219, `guard frame ${i}`).toBe(true);
    }
  });

  it('frame 0 of each table is the blank frame', () => {
    for (const t of [tables.frameTableKid, tables.frameTableGuard, tables.frameTableCutscene]) {
      expect(t[0]).toEqual({ image: 255, sword: 0, dx: 0, dy: 0, flags: 0 });
    }
  });

  it('the standing frame is the one the captures show', () => {
    expect(tables.frameTableKid[FRAME_STAND])
      .toEqual({ image: 14, sword: 9, dx: 0, dy: 0, flags: 67 });
  });

  it('holds 114 sequences, every one of them starting inside the byte-code', () => {
    // True only once the packed holds are expanded: before that, two of the
    // offsets pointed past the end.
    expect(tables.sequenceOffsets.length - 1).toBe(114);
    const outside: number[] = [];
    for (let i = 1; i <= 114; i++) {
      const at = tables.sequenceOffsets[i] - SEQUENCE_BASE;
      if (at < 0 || at >= tables.sequences.length) outside.push(i);
    }
    expect(outside).toEqual([...SEQUENCES_WITH_BAD_OFFSET]);
  });

  /**
   * The byte-code is stored with its long holds squeezed out: a seven-byte
   * block stands in for a frame repeated many times. Expanding them is what
   * makes every offset land inside the table, and it is what the landing
   * that costs a hit point needs -- without it the Prince flickers through
   * seven wrong frames, one of which has no sprite at all.
   */
  it('expands the packed holds, so the painful landing is a long crouch', () => {
    const start = tables.sequenceOffsets[20] - SEQUENCE_BASE;
    const code = [...tables.sequences.subarray(start, start + 40)];
    // act 5, knock down, dy -2, dx 1, dx 2, then frame 108.
    expect(code.slice(0, 10)).toEqual([0xf9, 0x05, 0xf4, 0xfa, 0xfe, 0xfb, 0x01, 0xfb, 0x02, 108]);
    // Then the crouch, held for 29 ticks, and no stray frames at all.
    expect(code.slice(10, 39)).toEqual(Array<number>(29).fill(109));
    expect(code[39]).toBe(0xfb); // dx, as he starts to stand up
  });

  it('is 28 bytes longer expanded than the executable stores it', () => {
    expect(tables.sequences.length).toBe(2282 + 28);
  });

  it('the first sequence is the one the original lists first', () => {
    expect(tables.sequenceOffsets[1]).toBe(0x1973);
    expect([...tables.sequences.subarray(0, 8)])
      .toEqual([0xf9, 0x01, 0xff, 0x81, 0x19, 0xf9, 0x01, 0x01]);
  });

  it('the crack did not touch the animation tables', () => {
    expect(cracked.frameTableKid).toEqual(tables.frameTableKid);
    expect([...cracked.sequences]).toEqual([...tables.sequences]);
    expect([...cracked.sequenceOffsets]).toEqual([...tables.sequenceOffsets]);
  });
});
