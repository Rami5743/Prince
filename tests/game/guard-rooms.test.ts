/**
 * Where a guard is when nobody is looking at him.
 *
 * The level keeps one box per room -- tile, x, direction, skill, colour
 * and sequence -- and a guard is in exactly one of two places: on the
 * screen, or in the box of the room he is in. `leave_guard` puts him
 * away when the view moves off his room and `enter_guard` takes the new
 * room's guard out.
 *
 * The port's `leaveGuard` wrote everything into the box except the one
 * field that says a guard is in it: the tile. That is survivable until
 * something empties it, and `follow_guard` does -- when a guard comes
 * after the Prince through a door it empties the boxes of both rooms,
 * because the guard is now on the screen and belongs to neither. So the
 * first time a guard followed, he left the level for good: the player's
 * "he is also not there when you come back".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { SWORD_DRAWN } from '../../src/game/sword.ts';
import { NO_DIRECTION, stepGuard } from '../../src/game/guard.ts';
import type { CharacterState } from '../../src/game/character.ts';
import { standX } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Level 1: room 3 holds the first guard in the game, room 2 is its left. */
const ROOM = 3;
const LEFT = 2;

describe('a guard the view has moved away from', () => {
  it('is still there when the view comes back', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    expect(game.guard.room).toBe(ROOM);
    game.showRoom(LEFT);
    expect(game.guard.direction, 'room 2 has no guard').toBe(NO_DIRECTION);
    game.showRoom(ROOM);
    expect(game.guard.room, 'and room 3 still has his').toBe(ROOM);
    expect(game.guard.direction).not.toBe(NO_DIRECTION);
  });

  it('keeps the row he had reached, not the one he started in', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    const row = game.guard.currentRow;
    game.guard.currentRow = row === 2 ? 1 : row + 1;
    const moved = game.guard.currentRow;
    game.showRoom(LEFT);
    game.showRoom(ROOM);
    expect(game.guard.currentRow).toBe(moved);
  });

  /**
   * `enter_guard` takes the column from his x -- `get_tile_div_mod_m7`
   * -- and not from the box, whose column `leave_guard` always writes as
   * nought. The port read the box, so a guard put away at column six
   * came back out at column nought and set about walking across the room
   * to a Prince who was standing next to him.
   */
  it('comes back out where his x says, not at column nought', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    game.guard.x = standX(6);
    game.guard.currentColumn = 6;
    game.showRoom(LEFT);
    game.showRoom(ROOM);
    expect(game.guard.x).toBe(standX(6));
    expect(game.guard.currentColumn).toBe(6);
  });

  /** The bug the player hit: follow once, and he is gone for ever. */
  it('is still in the level after he has followed the Prince out of a room', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    game.guard.sword = SWORD_DRAWN;
    game.guard.currentColumn = 1;
    game.guard.x = 88;
    game.showRoom(LEFT);
    expect(game.guard.room, 'he came with him').toBe(LEFT);
    expect(game.guards.tile[ROOM - 1], 'and room 3 is empty while he is out')
      .toBeGreaterThanOrEqual(30);
    // Now the Prince goes back, from far enough into room 2 that the
    // guard does not follow him a second time, and the guard is put away
    // in the room he is standing in.
    game.guard.x = standX(5);
    game.guard.currentColumn = 5;
    game.showRoom(ROOM);
    expect(game.guards.tile[LEFT - 1], 'he is in room 2 now').toBeLessThan(30);
    game.showRoom(LEFT);
    expect(game.guard.room, 'and he is there when the view comes back').toBe(LEFT);
    expect(game.guard.direction).not.toBe(NO_DIRECTION);
  });
});

/**
 * Losing sight of the Prince.
 *
 * `autocontrol_guard_active` answers a `can_guard_see_kid` of nought
 * with `move_down_back`, which holds the original's `control_down` and
 * `control_backward` together. `swordfight` reads them in that order,
 * and down wins: a guard on one of the three stance frames sheathes his
 * blade and goes through sequence 87 into the inactive stand. The step
 * back is never reached.
 *
 * The port read `move_down_back` as a step back, so a guard who lost
 * sight walked away across the room with his sword still up. The
 * capture of `probeF` settles it: at tick 261 the Prince climbs out of
 * the guard's row, the original's guard lowers his blade and never moves
 * again, and the port's backed off a tile every three ticks. Putting
 * this right took that run from 250 of its 1194 ticks pixel-exact to
 * 735.
 */
describe('a guard who can no longer see the Prince', () => {
  /**
   * The guard of room 3 on his stance frame, with the Prince four tiles
   * off in his own row.
   */
  async function onGuardInRoom3(): Promise<Game> {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    const guard = game.guard;
    game.kid.room = ROOM;
    game.kid.currentRow = guard.currentRow;
    game.kid.currentColumn = guard.currentColumn - 4;
    game.kid.x = standX(game.kid.currentColumn);
    for (let i = 0; i < 40 && guard.frame !== 158; i++) {
      game.step({ x: 0, y: 0, shift: false });
    }
    expect(guard.sword, 'he has drawn').toBe(SWORD_DRAWN);
    expect(guard.frame, 'and is in the stance').toBe(158);
    return game;
  }

  /**
   * The Prince one row up, which is out of sight. He is stepped by hand
   * here rather than by the game: `stepKid` works his row out again from
   * his y every tick, so moving him with the game running moves him
   * straight back.
   */
  function outOfSight(game: Game): CharacterState {
    const row = game.guard.currentRow;
    return { ...game.kid, currentRow: row === 0 ? 1 : row - 1 };
  }

  it('puts his sword away and stands, rather than backing off', async () => {
    const game = await onGuardInRoom3();
    const guard = game.guard;
    const wasX = guard.x;
    const kid = outOfSight(game);
    stepGuard(guard, { tables: game.tables, kid });
    expect(guard.sword, 'the blade goes down at once').toBe(0);
    for (let i = 0; i < 6; i++) stepGuard(guard, { tables: game.tables, kid });
    expect(guard.frame, 'and he ends up in the inactive stand').toBe(166);
    expect(guard.x, 'without having moved a unit').toBe(wasX);
  });

  it('comes back on guard when he can see him again', async () => {
    const game = await onGuardInRoom3();
    const guard = game.guard;
    const kid = outOfSight(game);
    for (let i = 0; i < 8; i++) stepGuard(guard, { tables: game.tables, kid });
    expect(guard.frame).toBe(166);
    game.step({ x: 0, y: 0, shift: false });
    expect(guard.sword, 'the Prince is back in his row').toBe(SWORD_DRAWN);
  });
});

/**
 * A guard who has just followed the Prince through a door is in a room
 * the screen has not caught up with, and `play_guard_frame` runs his
 * byte-code only while `Char.room == drawn_room`. Two of his ticks go by
 * unplayed.
 *
 * Measured against the capture of `probeF`, where the guard follows out
 * of room 3 at tick 190 and walks back on from the right-hand edge of
 * room 2: every sprite of his is the port's exactly, and every one of
 * them two ticks late.
 */
describe('a guard who has just followed the Prince', () => {
  it('stands still for two ticks and then walks on', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    const guard = game.guard;
    const kid = game.kid;
    kid.room = ROOM;
    kid.currentRow = guard.currentRow;
    kid.currentColumn = guard.currentColumn - 4;
    kid.x = standX(kid.currentColumn);
    for (let i = 0; i < 40 && guard.frame !== 158; i++) {
      game.step({ x: 0, y: 0, shift: false });
    }
    expect(guard.frame).toBe(158);
    // Near enough to the left-hand door to come through it after him.
    guard.currentColumn = 1;
    guard.x = 88;

    game.showRoom(LEFT);
    expect(guard.room, 'he came through the door').toBe(LEFT);
    // The Prince comes with him, or the guard loses sight and stands down.
    kid.room = LEFT;
    kid.currentColumn = 9;
    kid.x = standX(9);
    const frozen = { x: guard.x, frame: guard.frame };
    game.step({ x: 0, y: 0, shift: false });
    expect({ x: guard.x, frame: guard.frame }, 'first tick, nothing').toEqual(frozen);
    game.step({ x: 0, y: 0, shift: false });
    expect({ x: guard.x, frame: guard.frame }, 'second tick, nothing').toEqual(frozen);
    game.step({ x: 0, y: 0, shift: false });
    expect({ x: guard.x, frame: guard.frame }, 'and then he moves')
      .not.toEqual(frozen);
  });
});
