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
import { NO_DIRECTION } from '../../src/game/guard.ts';
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
