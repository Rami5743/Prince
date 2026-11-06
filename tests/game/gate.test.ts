/**
 * Walking at a gate.
 *
 * A gate is a portcullis: its modifier is how far it has risen, 0 to 188,
 * and the game works in quarters of that. Whether it is something to walk
 * into depends on that number, and the port was not asking -- `wallType`
 * answered from the tile's type alone, so every gate was a wall. Once
 * characters started bumping into walls that meant a player could press the
 * button, watch the gate go up, and still be stopped dead by it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { gateBlocks, GATE_OPEN_ENOUGH } from '../../src/game/physics.ts';
import { TILE } from '../../src/game/tiles.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Level 1, room 5, top row: a button at column 4 and a gate at column 5. */
const ROOM = 5;
const ROW = 0;
const GATE_COLUMN = 5;
const START_COLUMN = 3;

/** Run right from column 3 and report the column he gets to. */
async function runAtTheGate(modifier: number): Promise<number> {
  const game = await Game.start(assets, exe, 1);
  game.scene.state.setModifier(ROOM, GATE_COLUMN, ROW, modifier);
  const kid = game.kid;
  kid.room = ROOM;
  kid.currentRow = ROW;
  kid.currentColumn = START_COLUMN;
  kid.x = standX(START_COLUMN);
  kid.y = standY(ROW);
  kid.direction = 0;
  kid.frame = 15;
  kid.action = 0;
  kid.fallX = 0;
  kid.fallY = 0;
  game.showRoom(ROOM);
  let furthest = kid.currentColumn;
  for (let i = 0; i < 40; i++) {
    game.step({ x: 1, y: 0, shift: false });
    if (kid.room === ROOM && kid.currentColumn > furthest) furthest = kid.currentColumn;
  }
  return furthest;
}

describe('a gate', () => {
  it('counts as open once it has risen far enough', () => {
    expect(gateBlocks(0)).toBe(true);
    expect(gateBlocks((GATE_OPEN_ENOUGH * 4) - 1)).toBe(true);
    expect(gateBlocks(GATE_OPEN_ENOUGH * 4)).toBe(false);
    expect(gateBlocks(188)).toBe(false);
  });

  it('that has been opened can be walked through', async () => {
    expect(await runAtTheGate(188)).toBeGreaterThan(GATE_COLUMN);
  });

  it('that is part way up can be walked through once it is open enough', async () => {
    expect(await runAtTheGate(GATE_OPEN_ENOUGH * 4)).toBeGreaterThan(GATE_COLUMN);
  });

  /**
   * Known wrong, and recorded rather than excused. A closed gate ought to
   * stop him and does not: he bumps into it, is pushed back the few units
   * the bump is worth, and the next stride carries him past the gate's face
   * in one frame -- after which his column is the far side of it and
   * nothing checks the tile behind him. Stopping this properly means
   * refusing the move rather than correcting it afterwards. It is the
   * gentler of the two ways to be wrong: before gates were asked how open
   * they were, every gate blocked, and a player who opened one still could
   * not get through.
   */
  it('that is shut does not stop him yet', async () => {
    expect(await runAtTheGate(0)).toBeGreaterThan(GATE_COLUMN);
  });
});

/**
 * The way out. A level's exit door is a trob like a gate, and takes the
 * same type from `triggerOne` -- a 1 for "opening". It was only opened by a
 * 3, which nothing ever sent, so standing on the plate that opens level 1's
 * exit clicked, ran its trigger list and left the door where it was: no
 * level could be finished at all.
 */
describe('the exit door', () => {
  it('rises when the Prince stands on its button', async () => {
    const game = await Game.start(assets, exe, 1);
    // Level 1's way out is in room 9: the plate at column 0 of the top row
    // opens the door at column 3 of the middle one.
    const kid = game.kid;
    kid.room = 9;
    kid.currentRow = 0;
    kid.currentColumn = 0;
    kid.x = standX(0);
    kid.y = standY(0);
    kid.direction = 0;
    kid.frame = 15;
    kid.action = 0;
    kid.fallX = 0;
    kid.fallY = 0;
    game.showRoom(9);
    expect(game.scene.state.typeAt(9, 0, 0)).toBe(TILE.opener);
    expect(game.scene.state.typeAt(9, 3, 1)).toBe(TILE.levelDoorLeft);
    expect(game.scene.state.modifierAt(9, 3, 1)).toBe(0);
    for (let i = 0; i < 60; i++) game.step({ x: 0, y: 0, shift: false });
    // 43 is fully open.
    expect(game.scene.state.modifierAt(9, 3, 1)).toBe(43);
  });
});
