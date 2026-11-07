/**
 * Walking at a gate.
 *
 * A gate is a portcullis: its modifier is how far it has risen, 0 to 188,
 * and the game works in quarters of that, so the gap under it is one to
 * forty-eight pixels. Whether it is something to walk into depends on that
 * number, and the port was not asking -- `wallType` answered from the
 * tile's type alone, so every gate was a wall. Once characters started
 * bumping into walls that meant a player could press the button, watch the
 * gate go up, and still be stopped dead by it.
 *
 * Asking was only half of it. The first answer was "six quarters is
 * enough", which is a six pixel crack, and a Prince forty-one pixels tall
 * walked through it. The capture of level 1 shows the original holding him
 * against a gate whose gap had grown to thirty-eight.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { gateBlocks, gateClearance, GATE_FULLY_OPEN } from '../../src/game/physics.ts';
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
  return runAt(modifier, START_COLUMN, 0);
}

/**
 * The capture's own situation: the top row of room 6, running left at the
 * gate that stands in column 9 of room 8 next door. Reports whether he got
 * out of room 6.
 */
async function reachesTheRoomBeyond(modifier: number): Promise<boolean> {
  const game = await Game.start(assets, exe, 1);
  game.scene.state.setModifier(8, 9, 0, modifier);
  const kid = game.kid;
  kid.room = 6;
  kid.currentRow = 0;
  // Column 1, not 2: column 2 is the raise-button that opens this very
  // gate, and starting on it winds the gate up before he gets there.
  kid.currentColumn = 1;
  kid.x = standX(1);
  kid.y = standY(0);
  kid.direction = -1;
  kid.frame = 15;
  kid.action = 0;
  kid.fallX = 0;
  kid.fallY = 0;
  game.showRoom(6);
  for (let i = 0; i < 40; i++) {
    game.step({ x: -1, y: 0, shift: false });
    if (kid.room !== 6) return true;
  }
  return false;
}

async function runAt(
  modifier: number, startColumn: number, direction: number,
): Promise<number> {
  const game = await Game.start(assets, exe, 1);
  game.scene.state.setModifier(ROOM, GATE_COLUMN, ROW, modifier);
  const kid = game.kid;
  kid.room = ROOM;
  kid.currentRow = ROW;
  kid.currentColumn = startColumn;
  kid.x = standX(startColumn);
  kid.y = standY(ROW);
  kid.direction = direction;
  kid.frame = 15;
  kid.action = 0;
  kid.fallX = 0;
  kid.fallY = 0;
  game.showRoom(ROOM);
  let furthest = kid.currentColumn;
  for (let i = 0; i < 40; i++) {
    game.step({ x: direction < 0 ? -1 : 1, y: 0, shift: false });
    if (kid.room !== ROOM) return direction < 0 ? -1 : 10;
    if (direction < 0 ? kid.currentColumn < furthest : kid.currentColumn > furthest) {
      furthest = kid.currentColumn;
    }
  }
  return furthest;
}

describe('a gate', () => {
  it('counts as open once the gap is as tall as the character', () => {
    // The gap in pixels, which is what the renderer draws under the bars.
    expect(gateClearance(0)).toBe(1);
    expect(gateClearance(GATE_FULLY_OPEN)).toBe(48);
    expect(gateBlocks(0, 41)).toBe(true);
    expect(gateBlocks(148, 41)).toBe(true); // the capture: 38 pixels, blocked
    expect(gateBlocks(160, 41)).toBe(false); // 41 pixels, he fits
    expect(gateBlocks(GATE_FULLY_OPEN, 41)).toBe(false);
  });

  it('that has been opened can be walked through', async () => {
    expect(await runAtTheGate(GATE_FULLY_OPEN)).toBeGreaterThan(GATE_COLUMN);
    expect(await reachesTheRoomBeyond(GATE_FULLY_OPEN)).toBe(true);
  });

  /**
   * Measured off the recorded run of level 1: the Prince walks left along
   * the top of room 6 into the rising gate of room 8 and the original
   * stops him there, Left held, for sixteen ticks. The port walked him
   * through into room 8 and the two runs never met again.
   */
  it('that is part way up stops a Prince who does not fit under it', async () => {
    expect(await reachesTheRoomBeyond(148)).toBe(false);
  });

  /**
   * Known wrong, and recorded rather than excused. A shut gate ought to
   * stop him and does not when he comes at it from the left: the wall it
   * presents is ten units into the tile, he bumps into it, is pushed back
   * the few units the bump is worth, and the next stride carries him past
   * that face in one frame -- after which his column is the far side of it
   * and nothing checks the tile behind him. Coming from the right, which
   * is where the capture has him, the face is the tile's own edge and he
   * is stopped properly.
   */
  it('that is shut does not stop him yet', async () => {
    expect(await runAtTheGate(0)).toBeGreaterThanOrEqual(GATE_COLUMN);
    expect(await reachesTheRoomBeyond(0)).toBe(false);
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
