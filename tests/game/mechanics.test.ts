/**
 * What the game has to be able to do at all.
 *
 * The frame-by-frame comparison against the original is good at finding
 * the moment two runs part company and bad at finding a thing the port
 * simply never does: a potion nobody can drink, a blade nobody can see, a
 * blow with no animation behind it are all invisible to it, because a run
 * that never reaches them never disagrees about them.
 *
 * So this file asks the plain questions instead, one per thing the player
 * can do, on the original's own level data. Every one of them is a thing
 * the original certainly does; where the port does not, the test says so
 * rather than the player having to.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { TILE } from '../../src/game/tiles.ts';
import { SWORD_DRAWN } from '../../src/game/sword.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const NOTHING = { x: 0, y: 0, shift: false };

/** Put the Prince on his feet at a tile, with nothing in his hands. */
function stand(game: Game, room: number, column: number, row: number, direction = 0): void {
  const kid = game.kid;
  kid.room = room; kid.currentRow = row; kid.currentColumn = column;
  kid.x = standX(column); kid.y = standY(row);
  kid.direction = direction; kid.frame = 15; kid.action = 0;
  kid.fallX = 0; kid.fallY = 0;
  game.showRoom(room);
}

/** The rendered picture, as a string, so two can be compared. */
function picture(game: Game): string {
  return game.render().toRgb(game.scene.screenPalette.toRgba()).join(',');
}

/** How many pixels two pictures differ by. */
function differ(a: string, b: string): number {
  const x = a.split(','); const y = b.split(',');
  let n = 0;
  for (let i = 0; i < x.length; i += 3) {
    if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++;
  }
  return n;
}

describe('a potion', () => {
  /** Level 1 keeps one in room 5, on the floor of the bottom row. */
  const ROOM = 5; const COLUMN = 3; const ROW = 2;

  it('is there to be drunk', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.scene.state.typeAt(ROOM, COLUMN, ROW)).toBe(TILE.potion);
  });

  it('is drunk by a Prince standing on it', async () => {
    const game = await Game.start(assets, exe, 1);
    stand(game, ROOM, COLUMN, ROW);
    for (let i = 0; i < 40; i++) {
      game.step(NOTHING);
      if (game.scene.state.typeAt(ROOM, COLUMN, ROW) !== TILE.potion) break;
    }
    expect(game.scene.state.typeAt(ROOM, COLUMN, ROW), 'the flask is emptied')
      .not.toBe(TILE.potion);
  });

  it('gives a hit point back when it is the healing one', async () => {
    const game = await Game.start(assets, exe, 1);
    // Level 1's potions are all the small healing kind.
    expect(game.scene.state.modifierAt(ROOM, COLUMN, ROW) >> 3).toBe(1);
    game.damage(1);
    expect(game.hitPoints).toBe(2);
    stand(game, ROOM, COLUMN, ROW);
    for (let i = 0; i < 60 && game.hitPoints < 3; i++) game.step(NOTHING);
    expect(game.hitPoints, 'the Prince is one better off').toBe(3);
  });

  it('does not take him past his maximum', async () => {
    const game = await Game.start(assets, exe, 1);
    stand(game, ROOM, COLUMN, ROW);
    for (let i = 0; i < 60; i++) game.step(NOTHING);
    expect(game.hitPoints).toBe(game.maxHitPoints);
  });
});

describe('the sword', () => {
  /** Level 1 leaves it on the floor of room 15. */
  const ROOM = 15; const COLUMN = 2; const ROW = 2;

  it('is picked up by a Prince standing on it', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.scene.state.typeAt(ROOM, COLUMN, ROW)).toBe(TILE.sword);
    stand(game, ROOM, COLUMN, ROW);
    for (let i = 0; i < 40 && !game.hasSword; i++) game.step(NOTHING);
    expect(game.hasSword).toBe(true);
    expect(game.scene.state.typeAt(ROOM, COLUMN, ROW)).toBe(TILE.floor);
  });

  it('can be seen once it is out', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    stand(game, 15, 5, 2);
    game.hasSword = true;
    const kid = game.kid;
    // 158 is the stance the original holds between moves and 168 opens a
    // lunge. Both blades are thin -- the sprites are 28x3 and 21x5 -- so
    // the numbers are small and still the difference between a blade and
    // none at all.
    for (const [frame, least] of [[158, 20], [168, 20]] as const) {
      kid.frame = frame;
      kid.sword = 0;
      const without = picture(game);
      kid.sword = SWORD_DRAWN;
      const withIt = picture(game);
      expect(differ(without, withIt), `a blade is drawn on frame ${frame}`)
        .toBeGreaterThan(least);
    }
  });
});

describe('a blow that does not kill', () => {
  it('takes a hit point and plays the stagger', async () => {
    const game = await Game.start(assets, exe, 2);
    const kid = game.kid;
    // Level 2's room 4 has a guard at its left end. Put the Prince in
    // front of him, armed, and let the two of them get on with it.
    stand(game, 4, 6, 1, -1);
    game.hasSword = true;
    const before = game.hitPoints;
    expect(before).toBeGreaterThan(1);
    let struck = -1;
    let stagger = -1;
    for (let i = 0; i < 200 && (struck < 0 || i < struck + 6); i++) {
      game.step(NOTHING);
      if (kid.frame >= 172 && kid.frame <= 177) stagger = i;
      if (struck < 0 && game.hitPoints < before) struck = i;
    }
    expect(struck, 'the guard lands a blow').toBeGreaterThanOrEqual(0);
    expect(game.hitPoints, 'and it costs one hit point').toBe(before - 1);
    expect(game.isDead, 'and does not kill him').toBe(false);
    // Sequence 74 is the stagger, frames 172 to 177.
    expect(stagger, 'and the stagger is on screen').toBeGreaterThanOrEqual(0);
  });
});

describe('dying', () => {
  /** Level 1's room 6 has spikes under the ledge at the top of the room. */
  async function killOnSpikes(): Promise<Game> {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    stand(game, 6, 2, 0);
    for (let i = 0; i < 40 && !game.isDead; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    return game;
  }

  it('leaves a body on screen, and the same one from tick to tick', async () => {
    const game = await killOnSpikes();
    expect(game.isDead).toBe(true);
    game.step(NOTHING);
    const body = picture(game);
    const empty = (() => {
      const saved = game.kid.room;
      game.kid.room = 0;
      const p = picture(game);
      game.kid.room = saved;
      return p;
    })();
    expect(differ(body, empty), 'there is a body to see').toBeGreaterThan(80);
    // Only the body: the torches flicker and a gate he opened on the way
    // is still going up, and neither is the body's business.
    const bodyOnly = (): string => {
      const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
      const out: number[] = [];
      for (let y = 150; y < 192; y++) {
        for (let x = 96; x < 200; x++) {
          const i = (y * 320 + x) * 3;
          out.push(rgb[i], rgb[i + 1], rgb[i + 2]);
        }
      }
      return out.join(',');
    };
    const was = bodyOnly();
    for (let i = 0; i < 10; i++) {
      game.step(NOTHING);
      expect(bodyOnly(), 'and it does not flicker').toBe(was);
    }
  });

  it('asks for a button and then begins again', async () => {
    const game = await killOnSpikes();
    let asked = -1;
    for (let i = 0; i < 40 && asked < 0; i++) {
      game.step(NOTHING);
      if (game.awaitingButton) asked = i;
    }
    expect(asked, 'the words come up').toBeGreaterThanOrEqual(0);
    let due = -1;
    for (let i = 0; i < 10 && due < 0; i++) {
      game.step({ x: 0, y: 0, shift: true });
      if (game.restartDue) due = i;
    }
    expect(due, 'and a button starts the level again').toBeGreaterThanOrEqual(0);
  });

  it('is not escaped by holding a direction', async () => {
    const game = await killOnSpikes();
    for (let i = 0; i < 20; i++) game.step({ x: 1, y: 0, shift: false });
    expect(game.isDead, 'still dead').toBe(true);
    expect(game.kid.frame, 'and still the body').toBe(177);
  });
});
