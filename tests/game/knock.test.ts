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

  /**
   * And comes back up. `animateButton` counts the timer down and drops
   * the tile off the list of things to animate once it is below two, so
   * the last value ever written is one -- a plate that counted one as
   * pressed stayed sunk for the rest of the level.
   */
  /**
   * And looks like a plain floor while it is down, which means its
   * modifier has to go with its type: a button's modifier is an index
   * into the level's door links and a floor's is which of four marks to
   * put on the wall above it. A plate whose link was numbered one, two or
   * three hung a decoration in the air the moment a foot came down on it.
   * Rooms 12 and 20 of level 1 both have one.
   */
  it('looks exactly like a plain floor while it is down', async () => {
    for (const room of [12, 20]) {
      const game = await Game.start(assets, exe, 1);
      game.clearBottomText();
      game.kid.room = 0;
      game.showRoom(room);
      const tiles = game.scene.tiles as {
        doorLinkTimer?: (i: number) => number;
        typeAt(r: number, c: number, row: number): number;
        modifierAt(r: number, c: number, row: number): number;
      };
      const real = tiles.doorLinkTimer;
      tiles.doorLinkTimer = () => 5;
      const pressed = game.render().toRgb(game.scene.screenPalette.toRgba()).join(',');
      tiles.doorLinkTimer = real;
      // The same room with every plate replaced by a plain floor.
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 10; c++) {
          const t = game.scene.state.typeAt(room, c, r);
          if (t !== TILE.opener && t !== TILE.closer) continue;
          game.scene.state.setType(room, c, r, TILE.floor);
          game.scene.state.setModifier(room, c, r, 0);
        }
      }
      const plain = game.render().toRgb(game.scene.screenPalette.toRgba()).join(',');
      expect(pressed, `room ${room}`).toBe(plain);
    }
  });

  it('comes back up once the foot has gone', async () => {
    const game = await Game.start(assets, exe, 1);
    // Level 1's room 9: a plate at column 0 of the top row, with the way
    // out of the level on the end of it.
    expect(game.scene.state.typeAt(9, 0, 0)).toBe(TILE.opener);
    const kid = game.kid;
    kid.room = 9; kid.currentRow = 0; kid.currentColumn = 0;
    kid.x = standX(0); kid.y = standY(0);
    kid.direction = 0; kid.frame = 15; kid.action = 0;
    kid.fallX = 0; kid.fallY = 0;
    game.showRoom(9);
    // Twice: the first tick of a level moves nothing, as the original's
    // does, so the foot does not come down on the plate until the second.
    game.step(NOTHING);
    game.step(NOTHING);

    const picture = (): string => {
      const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
      return rgb.slice(0, 64 * 320 * 3).join(',');
    };
    const pressed = picture();

    // Off the plate, and well past the few ticks the timer runs for.
    kid.room = 0;
    const under = picture();
    expect(under, 'the plate is still down with the foot just gone')
      .not.toBe(pressed);
    for (let i = 0; i < 20; i++) game.step(NOTHING);
    const after = picture();
    expect(after, 'and up again a few ticks later').not.toBe(under);
  });
});
