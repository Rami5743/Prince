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

  /**
   * A dead Prince is out of sight like any other, and the guard stands
   * down over the body. `autocontrol_guard` asks only whether the
   * *guard* is alive; the Prince being dead makes `can_guard_see_kid`
   * nought, and nought is `move_down_back`.
   *
   * The port returned early instead, so the guard stood over the body
   * en garde for the whole of the death screen. In the capture of
   * `probeF` that is ninety ticks, every one of them wrong, and
   * putting it right took the run from 363 of its 1195 ticks
   * pixel-exact to 453.
   */
  it('stands down over a dead Prince', async () => {
    const game = await onGuardInRoom3();
    const guard = game.guard;
    // `Char.alive` of nought and up is the original's dead; it is what
    // `check_can_guard_see_kid` reads, and what the death sequence sets.
    game.kid.alive = 0;
    for (let i = 0; i < 10; i++) game.step({ x: 0, y: 0, shift: false });
    expect(guard.sword, 'the blade goes down').toBe(0);
    expect(guard.frame, 'and he stands inactive').toBe(166);
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
 * `play_guard_frame` is two halves. `play_guard` decides what the
 * guard is to do and runs wherever he is; `play_seq` and the physics
 * under it run only for a guard in the room on the screen, and the
 * physics only while his x is between 44 and 211.
 *
 * Both gates matter the moment he follows the Prince through a door:
 * he is shifted by the width of a room, which puts him outside it, and
 * for a tick he is in a room the screen has not caught up with.
 *
 * The port used to stand him still for two ticks instead, which was
 * measured on `probeF` and was the right answer there for the wrong
 * reason. What really shuts the door for two ticks is
 * `exit_room_timer`, which `redraw_screen` sets to 2 and `exit_room`
 * counts down -- so for two ticks after the screen is drawn whole
 * nobody changes room at all, while everything else about those ticks
 * goes on as usual.
 */
describe('a guard outside the room on the screen', () => {
  it('is decided about but not played', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    const guard = game.guard;
    const before = { x: guard.x, y: guard.y, frame: guard.frame };
    for (let i = 0; i < 4; i++) {
      stepGuard(guard, { tables: game.tables, kid: game.kid, drawnRoom: guard.room + 1 });
    }
    expect({ x: guard.x, y: guard.y, frame: guard.frame }).toEqual(before);
  });

  it('is played, but not moved by the floors, once past the edge', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    const guard = game.guard;
    // Where following the Prince out of the left-hand door puts him:
    // a room's width to the right of a guard who was beside it.
    guard.x = 226;
    // `determine_column` is inside the gate, so it does not run: the
    // column stays whatever it was, wrong or not. The control below is
    // the same guard a few pixels nearer, inside the room.
    guard.currentColumn = 99;
    stepGuard(guard, { tables: game.tables, kid: game.kid, drawnRoom: guard.room });
    expect(guard.currentColumn, 'nothing puts him on a tile').toBe(99);

    guard.x = 200;
    stepGuard(guard, { tables: game.tables, kid: game.kid, drawnRoom: guard.room });
    expect(guard.currentColumn, 'and inside the room it does').not.toBe(99);
  });
});
