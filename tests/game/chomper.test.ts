/**
 * Chompers.
 *
 * Two things were missing and between them they made a chomper harmless
 * scenery. It only ever started snapping when the Prince *landed* on its
 * row -- `startFall` and `land` ask for that -- so walking onto the row
 * from the side left it asleep. And nothing anywhere let one hurt him, so
 * even a snapping chomper was something to stroll through.
 *
 * The phase runs 1 to 15, one a frame. Phases 1 to 5 are the shut part of
 * the cycle: `startChompers` will not restart a chomper that is in them,
 * because it is in the middle of a snap, and those are the ones that cut.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Level 3, room 5, top row: a chomper at column 4 with floor leading to it. */
const LEVEL = 3;
const ROOM = 5;
const ROW = 0;
const COLUMN = 4;
const START = COLUMN - 3;

async function atTheChomper(): Promise<Game> {
  const game = await Game.start(assets, exe, LEVEL);
  const kid = game.kid;
  kid.room = ROOM;
  kid.currentRow = ROW;
  kid.currentColumn = START;
  kid.x = standX(START);
  kid.y = standY(ROW);
  kid.direction = 0;
  kid.frame = 15;
  kid.action = 0;
  kid.fallX = 0;
  kid.fallY = 0;
  game.showRoom(ROOM);
  return game;
}

/** Wait `delay` frames, then run right. Returns true if he was cut down. */
async function runAt(delay: number): Promise<boolean> {
  const game = await atTheChomper();
  for (let i = 0; i < delay; i++) game.step({ x: 0, y: 0, shift: false });
  for (let i = 0; i < 40; i++) {
    game.step({ x: 1, y: 0, shift: false });
    if (game.isDead) return true;
  }
  return false;
}

describe('a chomper', () => {
  it('starts snapping when the Prince arrives on its row, however he gets there',
    async () => {
      const game = await atTheChomper();
      const phases = new Set<number>();
      for (let i = 0; i < 20; i++) {
        game.step({ x: 0, y: 0, shift: false });
        phases.add(game.scene.state.modifierAt(ROOM, COLUMN, ROW) & 0x7f);
      }
      // He never lands and never leaves the floor; it has to snap anyway.
      expect(phases.size).toBeGreaterThan(10);
    });

  it('can be run past, or not, depending on when you go', async () => {
    const outcomes: boolean[] = [];
    for (let delay = 0; delay < 15; delay++) outcomes.push(await runAt(delay));
    const cut = outcomes.filter(Boolean).length;
    // Neither a wall nor scenery: some of the fifteen get through, some do
    // not. The exact split is the port's and is pinned to catch a change.
    expect(cut).toBe(7);
    expect(outcomes.length - cut).toBe(8);
  }, 60000);

  it('leaves its mark on the tile when it catches him', async () => {
    let delay = 0;
    while (delay < 15 && !(await runAt(delay))) delay++;
    expect(delay).toBeLessThan(15);
    const game = await atTheChomper();
    for (let i = 0; i < delay; i++) game.step({ x: 0, y: 0, shift: false });
    for (let i = 0; i < 40 && !game.isDead; i++) game.step({ x: 1, y: 0, shift: false });
    expect(game.isDead).toBe(true);
    expect(game.scene.state.modifierAt(ROOM, COLUMN, ROW) & 0x80).toBe(0x80);
  }, 60000);
});
