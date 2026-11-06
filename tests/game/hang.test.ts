/**
 * Taking hold of a ledge with Shift, and what happens next.
 *
 * The original lets the Prince grab a ledge he is falling past for as long
 * as he is not falling too fast: `check_grab` is called both from the first
 * frames of a fall and, every frame after that, from `do_fall`. Missing the
 * second of those is what made Shift do nothing once the fall was properly
 * under way.
 *
 * These are not compared against a capture. Every grab that can be reached
 * from a level start either crosses a room boundary -- where the original
 * blanks the screen and the port does not -- or runs into a guard, and the
 * ones that do not need the key pressed on an exact tick, which the capture
 * harness cannot do. The behaviour here follows the original's `do_fall`
 * and `check_grab`; the frames it uses are checked against captures
 * elsewhere.
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

/** A ledge in level 1 the Prince can run off and catch. */
const LEDGE = { level: 1, room: 1, row: 2, column: 6, direction: -1 };
const HANGING = (frame: number): boolean => frame >= 87 && frame < 100;

async function atTheLedge(): Promise<Game> {
  const game = await Game.start(assets, exe, LEDGE.level);
  const kid = game.kid;
  kid.room = LEDGE.room;
  kid.currentRow = LEDGE.row;
  kid.currentColumn = LEDGE.column;
  kid.x = standX(LEDGE.column);
  kid.y = standY(LEDGE.row);
  kid.direction = LEDGE.direction;
  kid.frame = 15; // standing
  kid.action = 0;
  kid.fallX = 0;
  kid.fallY = 0;
  game.drawnRoom = LEDGE.room;
  return game;
}

/** Run forward, with Shift held or not, and report what he ends up doing. */
function play(game: Game, ticks: number, shift: boolean): number[] {
  const frames: number[] = [];
  for (let i = 0; i < ticks; i++) {
    game.step({ x: LEDGE.direction < 0 ? -1 : 1, y: 0, shift });
    frames.push(game.kid.frame);
  }
  return frames;
}

describe('taking hold of a ledge', () => {
  it('Shift catches the ledge on the way down', async () => {
    const game = await atTheLedge();
    const frames = play(game, 30, true);
    expect(frames.some(HANGING)).toBe(true);
  });

  it('without Shift he falls past it', async () => {
    const game = await atTheLedge();
    const frames = play(game, 30, false);
    expect(frames.some(HANGING)).toBe(false);
  });

  it('he hangs on while Shift is held, and lets go when it is released', async () => {
    const game = await atTheLedge();
    play(game, 30, true);
    expect(HANGING(game.kid.frame)).toBe(true);
    // Still there after a while.
    for (let i = 0; i < 20; i++) game.step({ x: 0, y: 0, shift: true });
    expect(HANGING(game.kid.frame)).toBe(true);
    // Let go of Shift and he drops.
    for (let i = 0; i < 6; i++) game.step({ x: 0, y: 0, shift: false });
    expect(HANGING(game.kid.frame)).toBe(false);
  });

  it('Up while hanging climbs back onto the ledge', async () => {
    const game = await atTheLedge();
    play(game, 30, true);
    expect(HANGING(game.kid.frame)).toBe(true);
    // He is hanging from the floor of the room above, having dropped into
    // this one through the loose tile, so the climb takes him back up into
    // it. y is measured within a room, so the room is what to watch.
    const hangingRoom = game.kid.room;
    expect(game.scene.tiles.linkOf(hangingRoom, 2)).toBeGreaterThan(0);
    const above = game.scene.tiles.linkOf(hangingRoom, 2);
    for (let i = 0; i < 25; i++) game.step({ x: 0, y: -1, shift: true });
    expect(HANGING(game.kid.frame)).toBe(false);
    expect(game.kid.room).toBe(above);
    // Let the key go and he settles on his feet.
    for (let i = 0; i < 20; i++) game.step({ x: 0, y: 0, shift: false });
    expect(game.kid.frame).toBe(15);
  });

  /**
   * Holding Up does not stop at the top. The original carries on while the
   * key is down -- it jumps again as soon as the Prince is back on his feet
   * -- which the climbing session catches it doing: after the climb it is
   * off along the floor above while a port that waited for a fresh press
   * stood still. See `canClimbUp` in src/game/kid.ts.
   */
  it('a held Up carries on once he is up', async () => {
    const game = await atTheLedge();
    play(game, 30, true);
    expect(HANGING(game.kid.frame)).toBe(true);
    const frames: number[] = [];
    for (let i = 0; i < 45; i++) {
      game.step({ x: 0, y: -1, shift: true });
      frames.push(game.kid.frame);
    }
    // The climb itself, and then a jump begun without the key being let go.
    expect(frames.some((f) => f >= 135 && f < 150)).toBe(true);
    expect(frames.indexOf(67)).toBeGreaterThan(frames.lastIndexOf(149));
  });

  /**
   * And an Up that has been let go does not. The latch keeps a press that
   * nothing has acted on yet, which is how a careful step happens once per
   * press; what it must not do is keep one whose key is already back up.
   * It did, and the press that climbed the ledge was still sitting there
   * afterwards: the next direction read as Up+forward and the Prince
   * jumped along the floor above instead of walking it.
   */
  it('an Up let go of before the climb ends does not jump afterwards', async () => {
    const game = await atTheLedge();
    play(game, 30, true);
    expect(HANGING(game.kid.frame)).toBe(true);
    // Up for one tick to start the climb, then nothing: the key is up long
    // before he is.
    game.step({ x: 0, y: -1, shift: false });
    const frames: number[] = [];
    for (let i = 0; i < 24; i++) {
      game.step({ x: 0, y: 0, shift: false });
      frames.push(game.kid.frame);
    }
    expect(frames.some((f) => f >= 135 && f < 150), 'he should climb').toBe(true);
    // On his feet, and now walked along the floor he has just reached.
    for (let i = 0; i < 20; i++) {
      game.step({ x: game.kid.direction === 0 ? 1 : -1, y: 0, shift: false });
      frames.push(game.kid.frame);
    }
    expect(frames.some((f) => f >= 67 && f <= 85), 'and never jump').toBe(false);
  });
});
