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
    for (let i = 0; i < 25; i++) game.step({ x: 0, y: -1, shift: true });
    expect(HANGING(game.kid.frame)).toBe(false);
    expect(game.kid.frame).toBe(15); // standing on the ledge again
  });
});
