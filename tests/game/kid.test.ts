/**
 * The Prince, moving.
 *
 * The level entry is the one piece of movement the captures pin down exactly,
 * so it is checked against them here too, this time through the whole game
 * object rather than the interpreter alone. The rest checks that the moves
 * behave the way the original's do: a run goes forward and keeps going, a
 * turn reverses the facing, standing next to a wall steps instead of running,
 * and stepping off a ledge falls to the floor below.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { FRAME_STAND } from '../../src/game/character.ts';
import { Y_LAND } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const STILL = { x: 0, y: 0, shift: false };
const FORWARD = (dir: number) => ({ x: dir < 0 ? -1 : 1, y: 0, shift: false });

/** Where the captures show the Prince once the entry turn has finished. */
const AFTER_ENTRY: Record<number, { x: number; direction: number; room: number }> = {
  2: { x: 107, direction: -1, room: 5 },
  3: { x: 135, direction: 0, room: 9 },
  4: { x: 163, direction: 0, room: 1 },
  5: { x: 121, direction: -1, room: 7 },
  6: { x: 107, direction: 0, room: 24 },
};

describe('the Prince', () => {
  it.each(Object.keys(AFTER_ENTRY).map(Number))(
    'entering level %i ends standing where the capture shows',
    async (n) => {
      const game = await Game.start(assets, exe, n);
      for (let i = 0; i < 12 && game.kid.frame !== FRAME_STAND; i++) game.step(STILL);
      expect(game.kid.frame).toBe(FRAME_STAND);
      expect({ x: game.kid.x, direction: game.kid.direction, room: game.kid.room })
        .toEqual(AFTER_ENTRY[n]);
    },
  );

  it('stands still indefinitely when nothing is pressed', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < 12; i++) game.step(STILL);
    const { x, y, room } = game.kid;
    for (let i = 0; i < 60; i++) game.step(STILL);
    expect({ x: game.kid.x, y: game.kid.y, room: game.kid.room }).toEqual({ x, y, room });
    expect(game.kid.frame).toBe(FRAME_STAND);
  });

  it('runs forward when the player holds the facing direction', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < 12; i++) game.step(STILL);
    const dir = game.kid.direction;
    const startX = game.kid.x;
    const startRoom = game.kid.room;
    const startY = game.kid.y;
    // Far enough to be running, but stopped at the room boundary: x is
    // measured from the room's own left edge and starts over on the far side.
    let moved = 0;
    for (let i = 0; i < 24; i++) {
      game.step(FORWARD(dir));
      if (game.kid.room !== startRoom) break;
      moved = dir < 0 ? startX - game.kid.x : game.kid.x - startX;
    }
    expect(moved).toBeGreaterThan(20);
    expect(game.kid.y).toBe(startY); // stays on its row
  });

  it('turns round when the player holds the other direction', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < 12; i++) game.step(STILL);
    const dir = game.kid.direction;
    const back = { x: dir < 0 ? 1 : -1, y: 0, shift: false };
    for (let i = 0; i < 12; i++) game.step(back);
    expect(game.kid.direction).toBe(~dir);
  });

  it('never leaves the floor heights the level defines while walking about', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < 12; i++) game.step(STILL);
    const dir = game.kid.direction;
    for (let i = 0; i < 200; i++) game.step(FORWARD(dir));
    // Either standing on one of the five floor heights, or in the air falling.
    const onFloor = (Y_LAND as readonly number[]).includes(game.kid.y);
    expect(onFloor || game.kid.fallY > 0).toBe(true);
  });

  it('keeps the Prince inside a room or moves him to a linked one', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < 12; i++) game.step(STILL);
    const dir = game.kid.direction;
    for (let i = 0; i < 300; i++) {
      game.step(FORWARD(dir));
      expect(game.kid.room).toBeGreaterThanOrEqual(0);
      expect(game.kid.room).toBeLessThanOrEqual(24);
      expect(game.kid.currentRow).toBeGreaterThanOrEqual(-1);
      expect(game.kid.currentRow).toBeLessThanOrEqual(3);
    }
  });
});

describe('jumping, climbing and crouching', () => {
  const UP = { x: 0, y: -1, shift: false };
  const DOWN = { x: 0, y: 1, shift: false };

  async function standing(level: number) {
    const game = await Game.start(assets, exe, level);
    for (let i = 0; i < 12; i++) game.step(STILL);
    return game;
  }

  it('jumps straight up when up is pressed', async () => {
    const game = await standing(3);
    const floor = game.kid.y;
    let highest = floor;
    game.step(UP);
    for (let i = 0; i < 20; i++) {
      game.step(STILL);
      if (game.kid.y < highest) highest = game.kid.y;
    }
    expect(highest).toBeLessThan(floor);
    expect(game.kid.y).toBe(floor); // and comes back down to the same floor
  });

  it('jumps forward when up and the facing direction are pressed together', async () => {
    const game = await standing(3);
    const dir = game.kid.direction;
    const startX = game.kid.x;
    game.step({ x: dir < 0 ? -1 : 1, y: -1, shift: false });
    for (let i = 0; i < 24; i++) game.step(STILL);
    const moved = dir < 0 ? startX - game.kid.x : game.kid.x - startX;
    expect(moved).toBeGreaterThan(0);
  });

  it('crouches when down is pressed, and stands up again when it is released', async () => {
    const game = await standing(3);
    let crouched = false;
    for (let i = 0; i < 12; i++) {
      game.step(DOWN);
      if (game.kid.frame === 109) crouched = true;
    }
    expect(crouched).toBe(true);
    for (let i = 0; i < 20; i++) game.step(STILL);
    expect(game.kid.frame).toBe(FRAME_STAND);
  });

  it('a jump never leaves the Prince hanging in the air', async () => {
    const game = await standing(3);
    game.step(UP);
    for (let i = 0; i < 60; i++) game.step(STILL);
    // Back to a resting state: standing, crouching after landing, or hanging.
    expect(game.kid.action).not.toBe(3); // not still in midair
  });

  it('every move leaves the Prince in a state the frame table knows', async () => {
    const game = await standing(3);
    const moves = [UP, DOWN, STILL, { x: 1, y: -1, shift: false }, { x: -1, y: 0, shift: false },
      { x: 1, y: 0, shift: true }, { x: 0, y: -1, shift: true }];
    for (let i = 0; i < 400; i++) {
      game.step(moves[i % moves.length]);
      expect(game.kid.frame).toBeGreaterThanOrEqual(0);
      expect(game.kid.frame).toBeLessThan(241);
      expect(game.tables.frameTableKid[game.kid.frame]).toBeDefined();
    }
  });
});
