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
 * Jump destinations inside the sequence table are addresses in the original's
 * data segment; this is where the table itself sat.
 */
export const SEQUENCE_BASE = 0x196e;

/**
 * Two entries of the offsets table point past the end of the byte-code
 * altogether, at data that does not decode as a sequence.
 */
export const SEQUENCES_WITH_BAD_OFFSET: readonly number[] = [101, 107];

/**
 * Sequences that run off the end of the byte-code into the table that
 * follows it. They are the mouse's and the princess's -- the characters of
 * the cut-scenes, which this release never animates in a level -- so nothing
 * in play reaches them. Extending the extracted range does not help: what
 * follows really is another table. Recorded rather than patched over; if the
 * cut-scene characters are ever implemented, this is where to start.
 */
export const SEQUENCES_THAT_RUN_OFF: readonly number[] = [101, 106, 107, 111, 112, 114];

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
    sequences: exe.slice(OFF.sequences, OFF.sequences + COUNT.sequenceBytes),
    sequenceOffsets,
  };
}
