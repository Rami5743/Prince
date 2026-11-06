/**
 * The animation tables, read out of the original executable.
 *
 * How the Prince moves is not in the data files either. PRINCE.EXE carries
 * a frame table -- for each of 241 frames, which sprite to draw and how far
 * it shifts the character -- and a sequence table, a little byte-code
 * program per movement that steps through frames and issues commands. Both
 * are read from the executable here so the port animates from the original's
 * own tables rather than from a transcription of them.
 */
import { checkExe } from './exe-constants.ts';

export interface Frame {
  /** Sprite id within the character's group; 255 means draw nothing. */
  readonly image: number;
  /** Low 6 bits: the sword sprite. High 2 bits: which group the sprite is in. */
  readonly sword: number;
  /** Forward shift of the sprite, in the internal horizontal units. */
  readonly dx: number;
  readonly dy: number;
  /**
   * 0x1F weight-x, 0x20 thin, 0x40 needs floor, 0x80 the sprite starts on an
   * odd pixel.
   */
  readonly flags: number;
}

export const FRAME_FLAG = {
  weightX: 0x1f,
  thin: 0x20,
  needsFloor: 0x40,
  evenOddPixel: 0x80,
} as const;

/** Offsets into the 123 335-byte release. */
const OFF = {
  swordTable: 0x1c0d7,
  frameTableKid: 0x1b9a5,
  frameTableGuard: 0x1be5b,
  frameTableCutscene: 0x1bf29,
  sequenceOffsets: 0x1c177,
  sequences: 0x1c25b,
} as const;

const COUNT = {
  swordTable: 51,
  frameTableKid: 241,
  frameTableGuard: 41,
  frameTableCutscene: 86,
  /** Sequence ids are 1-based; index 0 is unused. */
  sequences: 114,
  sequenceBytes: 2282,
} as const;

/**
 * The sequence byte-code is stored with its long holds squeezed out.
 *
 * Where a frame is held for many ticks in a row, the table carries a block
 * of seven bytes in place of the repeats: a 16-bit tally of the plain bytes
 * since the end of the previous block, then 0xB2, the frame, how many times
 * to show it, 0x00, and 0xB0. There are four of them, and the first is in
 * the landing that costs a hit point, where the Prince holds his crouch for
 * 29 ticks.
 *
 * Read as plain byte-code a block gives seven wrong frames -- one of them
 * invisible, so the Prince disappears for a tick -- and leaves every address
 * after it short of where the offsets table says it is. Expanding it puts
 * both right: the offsets are written for the expanded table, which is how
 * the blocks can be found at all. The tally is checked before a block is
 * believed, so an ordinary stretch of byte-code cannot be taken for one.
 *
 * @param packed the bytes as the executable stores them
 * @param before how many bytes of the enclosing block come before these;
 *   the first tally counts from there rather than from the byte-code
 */
function expandSequenceRuns(packed: Uint8Array, before: number): Uint8Array {
  const out: number[] = [];
  let plain = before;
  for (let i = 0; i < packed.length; i++) {
    const block = i + 6 < packed.length
      && packed[i + 2] === 0xb2 && packed[i + 5] === 0x00 && packed[i + 6] === 0xb0
      && (packed[i] | (packed[i + 1] << 8)) === plain;
    if (block) {
      for (let k = packed[i + 4]; k > 0; k--) out.push(packed[i + 3]);
      i += 6;
      plain = 0;
      continue;
    }
    out.push(packed[i]);
    plain += 1;
  }
  return Uint8Array.from(out);
}

/**
 * Jump destinations inside the sequence table are addresses in the original's
 * data segment; this is where the table itself sat.
 */
export const SEQUENCE_BASE = 0x196e;

/**
 * Once the packed holds are expanded, every entry of the offsets table
 * points inside the byte-code. Kept as a record: before the holds were
 * understood, entries 101 and 107 pointed past the end of it.
 */
export const SEQUENCES_WITH_BAD_OFFSET: readonly number[] = [];

/**
 * Sequences that run off the end of the byte-code. There are none: every one
 * of the 114 decodes and ends in a jump. Kept as a record -- while the
 * packed holds were being read as plain byte-code, six of them (the mouse's
 * and the princess's, among others) ran past the end, which is what first
 * showed that the table was not being read as the original reads it.
 */
export const SEQUENCES_THAT_RUN_OFF: readonly number[] = [];

/** Where a drawn sword sits relative to the hand holding it. */
export interface SwordPlacement {
  /** Sprite id in the sword group; 255 means no sword is drawn. */
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface ExeTables {
  readonly swordTable: readonly SwordPlacement[];
  readonly frameTableKid: readonly Frame[];
  readonly frameTableGuard: readonly Frame[];
  readonly frameTableCutscene: readonly Frame[];
  /** The byte-code. Index with `address - SEQUENCE_BASE`. */
  readonly sequences: Uint8Array;
  /** Start address of each sequence, by sequence id (1-based). */
  readonly sequenceOffsets: Uint16Array;
}

function readFrames(exe: Uint8Array, offset: number, count: number): Frame[] {
  const out: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const o = offset + i * 5;
    out.push({
      image: exe[o],
      sword: exe[o + 1],
      dx: (exe[o + 2] << 24) >> 24,
      dy: (exe[o + 3] << 24) >> 24,
      flags: exe[o + 4],
    });
  }
  return out;
}

export function readExeTables(exe: Uint8Array): ExeTables {
  checkExe(exe);
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const sequenceOffsets = new Uint16Array(COUNT.sequences + 1);
  for (let i = 1; i <= COUNT.sequences; i++) {
    sequenceOffsets[i] = dv.getUint16(OFF.sequenceOffsets + (i - 1) * 2, true);
  }
  const swordTable: SwordPlacement[] = [];
  for (let i = 0; i < COUNT.swordTable; i++) {
    const o = OFF.swordTable + i * 3;
    swordTable.push({
      id: exe[o],
      x: (exe[o + 1] << 24) >> 24,
      y: (exe[o + 2] << 24) >> 24,
    });
  }

  return {
    swordTable,
    frameTableKid: readFrames(exe, OFF.frameTableKid, COUNT.frameTableKid),
    frameTableGuard: readFrames(exe, OFF.frameTableGuard, COUNT.frameTableGuard),
    frameTableCutscene: readFrames(exe, OFF.frameTableCutscene, COUNT.frameTableCutscene),
    sequences: expandSequenceRuns(
      exe.slice(OFF.sequences, OFF.sequences + COUNT.sequenceBytes),
      OFF.sequences - OFF.sequenceOffsets,
    ),
    sequenceOffsets,
  };
}
