/**
 * The sequence interpreter, checked against the original's own behaviour.
 *
 * Every level but the first starts the Prince with a turn: the game faces him
 * the wrong way and then plays the turn sequence. The captures in
 * tests/golden show where he ended up. Running the original's byte-code from
 * the position the level data gives has to land on exactly those numbers --
 * which is a check on the interpreter, the frame table and the level reader
 * at once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, dat } from '../helpers/fixtures.ts';
import { readExeTables } from '../../src/game/exe-tables.ts';
import { newCharacter, FRAME_STAND } from '../../src/game/character.ts';
import { startSequence, playSequence, SEQ, SEQ_OP } from '../../src/game/sequence.ts';
import { SEQUENCES_THAT_RUN_OFF } from '../../src/game/exe-tables.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { parseLevel, resourceIdOfLevel } from '../../src/dat/level.ts';

const tables = readExeTables(new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE'))));
const levels = dat('LEVELS.DAT');

function level(n: number) {
  const id = resourceIdOfLevel(n);
  return parseLevel(levels.get(id), id);
}

/** Run the entry turn and report where the Prince ends up. */
function playEntryTurn(n: number) {
  const lv = level(n);
  const column = lv.startPos % 10;
  const row = Math.floor(lv.startPos / 10);
  const state = newCharacter({
    x: standX(column), y: standY(row),
    // The game faces him the wrong way, then turns him round.
    direction: ~lv.startDir,
    room: lv.startRoom, currentColumn: column, currentRow: row,
  });
  startSequence(state, SEQ.turn, tables);
  const frames: number[] = [];
  for (let i = 0; i < 20; i++) {
    if (!playSequence(state, { tables })) break;
    frames.push(state.frame);
    if (state.frame === FRAME_STAND) break;
  }
  return { state, frames, startX: standX(column), startDir: lv.startDir };
}

describe('the sequence interpreter', () => {
  /** Where the captures show the Prince after the entry turn. */
  const OBSERVED: Record<number, { x: number; direction: number }> = {
    2: { x: 107, direction: -1 },
    3: { x: 135, direction: 0 },
    4: { x: 163, direction: 0 },
    5: { x: 121, direction: -1 },
    6: { x: 107, direction: 0 },
  };

  it.each(Object.keys(OBSERVED).map(Number))(
    'the entry turn on level %i ends where the capture shows',
    (n) => {
      const { state } = playEntryTurn(n);
      expect({ x: state.x, direction: state.direction }).toEqual(OBSERVED[n]);
    },
  );

  it('the entry turn always moves half a tile and ends facing the level start direction', () => {
    for (const n of Object.keys(OBSERVED).map(Number)) {
      const { state, startX, startDir } = playEntryTurn(n);
      expect(state.direction, `level ${n}`).toBe(startDir);
      expect(state.x - startX, `level ${n}`).toBe(startDir < 0 ? -7 : 7);
    }
  });

  it('the turn runs the same nine frames every time, ending on the standing frame', () => {
    for (const n of Object.keys(OBSERVED).map(Number)) {
      const { frames } = playEntryTurn(n);
      expect(frames, `level ${n}`).toEqual([45, 46, 47, 48, 49, 50, 51, 52, FRAME_STAND]);
    }
  });

  it('standing still holds the standing frame indefinitely', () => {
    const state = newCharacter({ x: 100, y: 118 });
    startSequence(state, SEQ.stand, tables);
    for (let i = 0; i < 30; i++) {
      expect(playSequence(state, { tables })).toBe(true);
      expect(state.frame).toBe(FRAME_STAND);
    }
    expect(state.x).toBe(100);
  });

  it('a run starts from a standing position and keeps moving forward', () => {
    const state = newCharacter({ x: 100, y: 118, direction: 0 });
    startSequence(state, SEQ.startRun, tables);
    const xs: number[] = [];
    for (let i = 0; i < 12; i++) {
      expect(playSequence(state, { tables })).toBe(true);
      xs.push(state.x);
    }
    // Facing right, every step must move right or hold, never backwards.
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]);
    expect(xs[xs.length - 1]).toBeGreaterThan(100);
  });

  it('every sequence that is reachable decodes without running off the table', () => {
    const broken: number[] = [];
    for (let id = 1; id <= 114; id++) {
      const at = tables.sequenceOffsets[id];
      const state = newCharacter({ x: 100, y: 118 });
      state.currentSequence = at;
      let ok = true;
      try {
        for (let step = 0; step < 60; step++) {
          if (!playSequence(state, { tables })) { ok = false; break; }
        }
      } catch {
        ok = false;
      }
      if (!ok) broken.push(id);
    }
    // The only ones that fail belong to the cut-scene characters, the mouse
    // and the princess, which this release never animates in a level.
    expect(broken).toEqual([...SEQUENCES_THAT_RUN_OFF]);
  });

  it('exposes the opcodes with the original numbering', () => {
    expect(SEQ_OP.jump).toBe(0xff);
    expect(SEQ_OP.dx).toBe(0xfb);
    expect(SEQ_OP.dy).toBe(0xfa);
    expect(SEQ_OP.flip).toBe(0xfe);
  });
});
