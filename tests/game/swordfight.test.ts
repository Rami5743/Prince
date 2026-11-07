/**
 * The fight.
 *
 * Both characters fight out of the same byte-code -- 55 draws, 56 steps in,
 * 57 steps back, 58 lunges, 62 blocks, 74 is the recoil and 71 is a guard
 * going down -- and this checks the fight those sequences add up to: the
 * Prince draws when a guard with his sword out comes near, a lunge that
 * reaches an opponent who is not blocking costs him a hit point, and the
 * last of them kills.
 *
 * The *timing* is not the original's and is not claimed to be. How long a
 * guard waits between lunges, how its skill changes that, and exactly when
 * the original counts a blow as landed are all unmeasured; see the head of
 * src/game/sword.ts. What is pinned here is that the fight happens, that it
 * can be won and that it can be lost.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import type { Controls } from '../../src/game/kid.ts';
import { SWORD_DRAWN } from '../../src/game/sword.ts';
// `Game` and the fixtures above are shared with the cases at the end.

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const NOTHING: Controls = { x: 0, y: 0, shift: false };
const LEFT: Controls = { x: -1, y: 0, shift: false };
const UP: Controls = { x: 0, y: -1, shift: false };
/** Shift is the strike key once the blade is out; Up is the parry. */
const STRIKE: Controls = { x: 0, y: 0, shift: true };

/** Level 2 opens one room to the right of a guard; run at him. */
async function walkUpToTheGuard(): Promise<Game> {
  const game = await Game.start(assets, exe, 2);
  for (let i = 0; i < 8; i++) game.step(NOTHING);
  for (let i = 0; i < 40; i++) game.step(LEFT);
  for (let i = 0; i < 10; i++) game.step(NOTHING);
  return game;
}

describe('sword fighting', () => {
  it('the Prince draws when he comes up on an armed guard', async () => {
    const game = await walkUpToTheGuard();
    expect(game.guard.sword).toBe(SWORD_DRAWN);
    expect(game.kid.sword).toBe(SWORD_DRAWN);
    expect(game.kid.room).toBe(game.guard.room);
  });

  it('standing still in front of one costs hit points', async () => {
    const game = await walkUpToTheGuard();
    const before = game.hitPoints;
    for (let i = 0; i < 80 && !game.isDead; i++) game.step(NOTHING);
    expect(game.hitPoints).toBeLessThan(before);
  });

  it('pressing Shift kills the guard', async () => {
    const game = await walkUpToTheGuard();
    expect(game.guard.hitPoints).toBeGreaterThan(0);
    // Press and release: one lunge per press, as everywhere else, so a
    // player who wants to keep attacking has to keep tapping.
    for (let i = 0; i < 220 && game.guard.alive < 0 && !game.isDead; i++) {
      game.step(i % 2 === 0 ? STRIKE : NOTHING);
    }
    expect(game.guard.hitPoints).toBe(0);
    expect(game.guard.alive).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('pressing Up parries instead of striking', async () => {
    const game = await walkUpToTheGuard();
    const before = game.guard.hitPoints;
    for (let i = 0; i < 220 && game.guard.alive < 0 && !game.isDead; i++) {
      game.step(i % 2 === 0 ? UP : NOTHING);
    }
    // Up is the block: it keeps the guard's blows off and lands none of
    // its own, so the guard is no worse off at the end of it.
    expect(game.guard.hitPoints).toBe(before);
  }, 30000);

  it('a guard far away is left alone, and the sword goes away with him',
    async () => {
      const game = await Game.start(assets, exe, 2);
      for (let i = 0; i < 30; i++) game.step(NOTHING);
      // Still in room 5; the guard of room 4 is not his problem yet.
      expect(game.kid.sword).toBe(0);
    });
});

describe('a guard in the way', () => {
  it('cannot be walked past', async () => {
    const game = await Game.start(assets, exe, 2);
    for (let i = 0; i < 8; i++) game.step(NOTHING);
    let leftTheRoom = false;
    for (let i = 0; i < 140 && !game.isDead; i++) {
      game.step(LEFT);
      if (game.kid.room !== 4 && game.kid.room !== 5) leftTheRoom = true;
    }
    // Holding forward into him is not a way through: either he is still
    // there, or the Prince is dead for having tried it.
    expect(leftTheRoom).toBe(false);
  }, 30000);
});

/**
 * Level 1, where the Prince has no sword.
 *
 * It lies on the floor of room 15 and the guard of room 3 stands between
 * him and it, so the first guard in the game is one he cannot fight.
 * `tests/golden/session-level1-guard` shows what the original makes of
 * that: the guard stands his ground while the Prince runs at him, strikes
 * once when he arrives, and the hit point markers go out altogether.
 */
describe('a Prince with no sword', () => {
  it('starts level 1 without one, and later levels with one', async () => {
    expect((await Game.start(assets, exe, 1)).hasSword).toBe(false);
    expect((await Game.start(assets, exe, 2)).hasSword).toBe(true);
  });

  it('cannot draw one he has not got', async () => {
    const game = await Game.start(assets, exe, 1);
    game.showRoom(3);
    const kid = game.kid;
    kid.room = 3; kid.currentRow = 1; kid.currentColumn = 0;
    kid.x = 72; kid.y = 118; kid.direction = 0; kid.frame = 15;
    kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    for (let i = 0; i < 20; i++) game.step(NOTHING);
    expect(game.guard.sword, 'the guard draws his').toBe(SWORD_DRAWN);
    expect(game.kid.sword, 'the Prince has none to draw').toBe(0);
  });

  it('is walked at, and one blow finishes him', async () => {
    const game = await Game.start(assets, exe, 1);
    game.showRoom(3);
    const kid = game.kid;
    kid.room = 3; kid.currentRow = 1; kid.currentColumn = 0;
    kid.x = 72; kid.y = 118; kid.direction = 0; kid.frame = 15;
    kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    const guardStart = game.guard.x;
    let died = -1;
    for (let i = 0; i < 60 && died < 0; i++) {
      game.step({ x: 1, y: 0, shift: false });
      if (game.isDead) died = i;
    }
    expect(died, 'running at him unarmed is fatal').toBeGreaterThan(0);
    expect(game.hitPoints, 'and it takes everything at once').toBe(0);
    expect(guardStart).toBeGreaterThan(0);
  });

  /**
   * And he comes to meet a Prince who stays where he is. A grabbed video
   * of this very room shows the guard walking in from x 273 to x 100 on
   * the screen over fifty ticks while the Prince, who has no sword on
   * level 1, stands in front of him.
   *
   * It is a separate test from the one above because the original kills
   * a Prince who runs at a guard before the guard has taken many steps:
   * `autocontrol_guard_active` puts a running one under the blade at a
   * distance of forty and one in a running jump at fifty.
   */
  it('is walked towards while he stands still', async () => {
    const game = await Game.start(assets, exe, 1);
    game.showRoom(3);
    const kid = game.kid;
    kid.room = 3; kid.currentRow = 1; kid.currentColumn = 0;
    kid.x = 72; kid.y = 118; kid.direction = 0; kid.frame = 15;
    kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    const guardStart = game.guard.x;
    for (let i = 0; i < 40; i++) game.step({ x: 0, y: 0, shift: false });
    expect(game.guard.x, 'the guard closes on him')
      .toBeLessThan(guardStart - 14);
  });
});
