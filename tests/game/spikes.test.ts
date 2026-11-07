/**
 * What spikes do, and what they do not do.
 *
 * `check_spiked` is a short list and the port had it as a long one. The
 * original kills on four frames of running and six of the start of a
 * run-jump, and only while the blades are on their way up; or on the two
 * frames a jump lands on, at any stage of the blades. A landing out of a
 * fall is not in that list at all -- `land` has its own test for it --
 * and nothing else is in it either.
 *
 * The port killed him on every frame that was not one of the running
 * ones. That is standing, walking, turning, climbing, and frames 40, 41
 * and 42, which are the middle of a running jump: the player's "they
 * kill even when you jump over them".
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

/**
 * Put him on his feet properly: the frame alone is not enough, because
 * the byte-code pointer would still be wherever the level's opening drop
 * left it and he would carry on with that instead of standing.
 */
async function standing(
  level: number, room: number, column: number, row: number, direction = 0,
): Promise<Game> {
  const game = await Game.start(assets, exe, level);
  const kid = game.kid;
  kid.room = room; kid.currentRow = row; kid.currentColumn = column;
  kid.x = standX(column); kid.y = standY(row);
  kid.direction = direction; kid.action = 0;
  kid.fallX = 0; kid.fallY = 0;
  startSequence(kid, SEQ.stand, game.tables);
  game.showRoom(room);
  return game;
}

/** Level 1, room 13, top row: one spike with a torch tile -- which is
 *  floor you can stand on -- on both sides, so he can run at it and he
 *  can jump it. */
const ROOM = 13;
const ROW = 0;
const SPIKE = 5;

describe('spikes', () => {
  it('are where this test thinks they are', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.scene.state.typeAt(ROOM, SPIKE, ROW)).toBe(TILE.spike);
    expect(game.scene.state.typeAt(ROOM, SPIKE - 1, ROW)).toBe(TILE.torch);
    expect(game.scene.state.typeAt(ROOM, SPIKE + 1, ROW)).toBe(TILE.torch);
  });

  it('kill a Prince who runs into them', async () => {
    const game = await standing(1, ROOM, 1, ROW);
    for (let i = 0; i < 40 && !game.isDead; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    expect(game.isDead, 'running over the blades').toBe(true);
    expect(game.kid.frame, 'and the body is the impaled one').toBe(177);
  });

  /**
   * The one the player reported. A running jump across them spends its
   * middle on frames 40 to 42, which are in nobody's list, and comes down
   * past them.
   */
  it('do not kill a Prince who jumps over them', async () => {
    const game = await standing(1, ROOM, 1, ROW);
    for (let i = 0; i < 40 && !game.isDead; i++) {
      const kid = game.kid;
      // Up with Right, a few tiles out, is the running jump.
      const jump = kid.currentColumn >= SPIKE - 2 && kid.currentColumn <= SPIKE - 1;
      game.step({ x: 1, y: jump ? -1 : 0, shift: false });
      if (kid.room !== ROOM) break;
    }
    expect(game.isDead, 'he clears them').toBe(false);
    expect(game.hitPoints).toBe(3);
  });

  /**
   * And standing on them is safe, which is not an oversight: it is how a
   * careful step across a set of blades works in the original, and the
   * port used to kill him for it. The blades below go all the way out --
   * the modifier runs 0, 1, 2, 3, 4 and then 143, fully extended -- and
   * he stands there.
   */
  it('do not kill a Prince who is standing in them', async () => {
    const game = await standing(1, 6, 3, 2);
    expect(game.scene.state.typeAt(6, 3, 2)).toBe(TILE.spike);
    for (let i = 0; i < 30; i++) game.step({ x: 0, y: 0, shift: false });
    expect(game.scene.state.modifierAt(6, 3, 2), 'the blades are out').toBe(143);
    expect(game.isDead, 'and he is alive on top of them').toBe(false);
  });

  /**
   * A fall into them is `land`'s business, not `check_spiked`'s: he comes
   * down on frames 107 and up, which are in no list. The capture of level
   * 1 has the Prince run off the ledge at the top of room 6 and die on
   * the blades of the bottom row.
   */
  it('kill a Prince who falls into them', async () => {
    const game = await standing(1, 6, 2, 0);
    for (let i = 0; i < 40 && !game.isDead; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    expect(game.isDead).toBe(true);
    expect(game.kid.currentRow).toBe(2);
    expect(game.kid.frame).toBe(177);
  });
});
