/**
 * The way out of a level.
 *
 * The player: "the way up to level 2 is broken". It was, in three ways
 * at once. The port ran a `checkLevelDoor` of its own every tick out of
 * `play_kid_frame`, so the Prince left the level the moment he set foot
 * on the door's tile, without being asked; nothing put him where the
 * original puts him before the animation starts; and nothing turned him
 * round, so sequence 70 -- whose byte-code is written for a Prince
 * facing left -- carried him *out* of the doorway instead of into it.
 *
 * The original has no such function. Leaving is the first branch of
 * `up_pressed`: Up, standing at an open level door that is not the one
 * he came in by, and `go_up_leveldoor` snaps him to the door's column,
 * faces him left and starts sequence 70.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { startSequence, SEQ } from '../../src/game/sequence.ts';
import { TILE } from '../../src/game/tiles.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Level 1's exit: room 9, the middle row, columns 3 and 4. */
const ROOM = 9;
const ROW = 1;
const DOOR = 3;
const OPEN = 43;

async function atTheDoor(column: number, open: boolean): Promise<Game> {
  const game = await Game.start(assets, exe, 1);
  const kid = game.kid;
  kid.room = ROOM; kid.currentRow = ROW; kid.currentColumn = column;
  kid.x = standX(column); kid.y = standY(ROW);
  kid.direction = 0; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
  startSequence(kid, SEQ.stand, game.tables);
  game.showRoom(ROOM);
  if (open) game.scene.state.setModifierAtPos(ROOM, ROW * 10 + DOOR, OPEN);
  return game;
}

/** Walk right to the door, stop, and then do as asked. */
function walkThenPress(game: Game, up: boolean, ticks = 60): void {
  for (let i = 0; i < ticks; i++) {
    game.step({ x: i < 13 ? 1 : 0, y: up && i >= 22 ? -1 : 0, shift: false });
  }
}

describe('the level door', () => {
  it('is where this test thinks it is', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.scene.state.typeAt(ROOM, DOOR, ROW)).toBe(TILE.levelDoorLeft);
    expect(game.scene.state.typeAt(ROOM, DOOR + 1, ROW)).toBe(TILE.levelDoorRight);
    expect(game.scene.state.modifierAt(ROOM, DOOR, ROW), 'shut to begin with').toBe(0);
  });

  /** The bug: he used to walk in by himself. */
  it('does not take him out of the level until he asks', async () => {
    const game = await atTheDoor(1, true);
    walkThenPress(game, false);
    expect(game.levelFinished).toBe(false);
    expect(game.kid.frame, 'standing in the doorway, waiting').toBe(15);
  });

  it('takes him out of the level when he presses Up at it', async () => {
    const game = await atTheDoor(1, true);
    walkThenPress(game, true);
    expect(game.levelFinished).toBe(true);
  });

  /**
   * `go_up_leveldoor` faces him left and sequence 70 walks him backwards,
   * which is forwards through the door: the port had him facing right
   * and walking out of it.
   */
  it('turns him to face left and carries him into the doorway', async () => {
    const game = await atTheDoor(1, true);
    const kid = game.kid;
    let started = -1;
    let xAtStart = 0;
    for (let i = 0; i < 60; i++) {
      game.step({ x: i < 13 ? 1 : 0, y: i >= 22 ? -1 : 0, shift: false });
      if (started < 0 && kid.frame === 217) { started = i; xAtStart = kid.x; }
    }
    expect(started, 'sequence 70 starts on the tick Up is read').toBe(22);
    expect(kid.direction, 'facing left').toBe(-1);
    // `Char.x = x_bump[tile_col + FIRST_ONSCREEN_COLUMN] + 10`, which is
    // four short of where he stands on that column, and then the first
    // frame of sequence 70 has already carried him five further on by
    // the time the tick ends.
    expect(xAtStart, 'snapped to the door column').toBe(standX(DOOR) - 4 + 5);
    expect(kid.x, 'and he ends up further right than he started')
      .toBeGreaterThan(xAtStart);
    expect(kid.currentColumn, 'in the doorway itself').toBe(DOOR + 1);
  });

  it('does nothing at a door that has not opened', async () => {
    const game = await atTheDoor(1, false);
    walkThenPress(game, true);
    expect(game.levelFinished).toBe(false);
  });

  /**
   * The original reads three tiles -- the one he is on, the one behind
   * and the one in front -- so he does not have to be exactly on it.
   */
  it('reads the tile behind him as well as the one he is on', async () => {
    const game = await atTheDoor(1, true);
    const kid = game.kid;
    // Stand one past the door, facing right: the door is behind him.
    kid.currentColumn = DOOR + 1; kid.x = standX(DOOR + 1);
    startSequence(kid, SEQ.stand, game.tables);
    for (let i = 0; i < 40; i++) game.step({ x: 0, y: i >= 2 ? -1 : 0, shift: false });
    expect(game.levelFinished).toBe(true);
  });

  /**
   * `level.start_room != drawn_room`: the door of the room the level
   * starts in is the one he came in by, and Up there is an ordinary
   * jump.
   */
  it('is not a way out in the room the level starts in', async () => {
    const game = await Game.start(assets, exe, 2);
    const start = game.kid.room;
    const state = game.scene.state;
    let found: { column: number; row: number } | null = null;
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 10; column++) {
        if (state.typeAt(start, column, row) === TILE.levelDoorLeft) found = { column, row };
      }
    }
    expect(found, 'level 2 starts in the room it is entered through').not.toBeNull();
    state.setModifierAtPos(start, found!.row * 10 + found!.column, OPEN);
    const kid = game.kid;
    kid.currentRow = found!.row; kid.currentColumn = found!.column;
    kid.x = standX(found!.column); kid.y = standY(found!.row);
    kid.direction = 0; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    startSequence(kid, SEQ.stand, game.tables);
    game.showRoom(start);
    for (let i = 0; i < 40; i++) game.step({ x: 0, y: i >= 2 ? -1 : 0, shift: false });
    expect(game.levelFinished).toBe(false);
  });
});
