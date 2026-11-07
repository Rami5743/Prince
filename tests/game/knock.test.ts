/**
 * Two things the player sees when a foot comes down.
 *
 * A heavy landing shakes the loose floors around it, and a button with a
 * foot on it has its plate pressed flush. Neither happened: the byte-code
 * raises `knockUp` and `knockDown` on the landing frames and nothing was
 * listening, and the plate's raised pixel is spread over four of the
 * pieces a tile is drawn from, so sinking some of them left it half down.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { TILE } from '../../src/game/tiles.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const NOTHING = { x: 0, y: 0, shift: false };
const UP = { x: 0, y: -1, shift: false };

describe('a landing', () => {
  it('shakes the loose floors on its row', async () => {
    const game = await Game.start(assets, exe, 1);
    // Level 1, room 1: the loose floor is column 6 of the bottom row and
    // columns 7 and 8 beside it are solid.
    expect(game.scene.state.typeAt(1, 6, 2)).toBe(TILE.loose);
    const kid = game.kid;
    kid.room = 1; kid.currentRow = 2; kid.currentColumn = 8;
    kid.x = standX(8); kid.y = standY(2);
    kid.direction = 0; kid.frame = 15; kid.action = 0;
    kid.fallX = 0; kid.fallY = 0;
    game.showRoom(1);
    expect(game.scene.state.modifierAt(1, 6, 2)).toBe(0);
    // A standing jump: up for a moment, then let him come down.
    let shook = false;
    for (let i = 0; i < 40 && !shook; i++) {
      game.step(i < 3 ? UP : NOTHING);
      if (game.scene.state.modifierAt(1, 6, 2) !== 0) shook = true;
    }
    expect(shook, 'landing two tiles away shakes it').toBe(true);
    // And he never went near it.
    expect(kid.currentColumn).toBe(8);
  });
});

describe('a button with a foot on it', () => {
  it('has its plate flush with the floor', async () => {
    const game = await Game.start(assets, exe, 1);
    // Level 1's room 5 has three of them along the top row.
    game.showRoom(5);
    game.kid.room = 0; // nobody in the picture, so only the tiles differ
    const tiles = game.scene.tiles as { doorLinkTimer?: (i: number) => number };
    const real = tiles.doorLinkTimer;
    tiles.doorLinkTimer = () => 0;
    const up = game.render().toRgb(game.scene.screenPalette.toRgba()).slice();
    tiles.doorLinkTimer = () => 5;
    const down = game.render().toRgb(game.scene.screenPalette.toRgba()).slice();
    tiles.doorLinkTimer = real;

    let differ = 0;
    const rows = new Set<number>();
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 3;
        if (up[i] !== down[i] || up[i + 1] !== down[i + 1] || up[i + 2] !== down[i + 2]) {
          differ += 1;
          rows.add(y);
        }
      }
    }
    // Every piece of the plate moves, not just the one the tile draws
    // itself: sinking the base and the bottom alone changed 287 pixels
    // and left it looking half pressed.
    expect(differ, 'the plate visibly sinks').toBeGreaterThan(380);
    expect(rows.size, 'over the depth of a plate, not one row')
      .toBeGreaterThan(10);
  });
});
