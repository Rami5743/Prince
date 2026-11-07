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

/** Where the first tile of a kind is on a level, if it is on it at all. */
function findTile(game: Game, type: number): [number, number, number] | null {
  for (let room = 1; room <= 24; room++) {
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 10; column++) {
        if (game.scene.state.typeAt(room, column, row) === type) {
          return [room, column, row];
        }
      }
    }
  }
  return null;
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

  /**
   * And the flask goes, wherever he was standing when he reached for it.
   * The byte-code raises `getItem` a dozen frames into the drink and the
   * animation opens by moving him four units, so by then the column he
   * counts as standing in need not be the one the flask is on; the port
   * emptied whatever was under his feet at that moment, which left the
   * flask where it was and cleared a tile that had nothing on it.
   */
  it('goes from the tile it was on, whatever he does while drinking', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    const kid = game.kid;
    stand(game, ROOM, COLUMN, ROW);
    // Standing a few units to the right of the middle of the tile, as a
    // Prince who has just walked onto it is.
    kid.x = standX(COLUMN) + 5;
    let drank = -1;
    for (let i = 0; i < 80 && drank < 0; i++) {
      game.step(NOTHING);
      if (game.scene.state.typeAt(ROOM, COLUMN, ROW) !== TILE.potion) drank = i;
    }
    expect(drank, 'the flask he drank from is the one that empties')
      .toBeGreaterThanOrEqual(0);
    // And nothing else was taken away with it.
    expect(game.scene.state.typeAt(ROOM, COLUMN + 1, ROW)).toBe(TILE.floor);
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

/**
 * Every way the Prince can die, and the same five things after each one:
 * he is dead, a body is on screen, the body is the one the original
 * draws, the words come up, and a button starts the level again. The
 * player reports that sometimes it sticks, sometimes there is no body at
 * all and sometimes the body is the wrong picture; one test per death
 * says which.
 */
describe('every way of dying', () => {
  /** How much of the picture the body accounts for, to the nearest pixel. */
  function bodyPixels(game: Game): number {
    const kid = game.kid;
    const saved = kid.room;
    const withBody = picture(game);
    kid.room = 0;
    const without = picture(game);
    kid.room = saved;
    return differ(withBody, without);
  }

  /**
   * What every death has to do: reach the body the original draws, keep
   * it, and then let the level start again.
   *
   * The frame is the whole of the evidence for `the right body`, and the
   * four deaths draw four different ones. The port had two of them wrong
   * and these tests had the same two wrong with them, which is why the
   * player found them and the suite did not: `on a guard's sword` asked
   * for frame 178, the chomper's body, and `down a fall that breaks him`
   * asked for frame 109, which is not a body at all but the crouch he
   * lands a two-row drop in, held for thirty ticks and then stood up out
   * of. A test that names a number taken from the code it is testing says
   * nothing; these numbers come from the byte-code of the sequences the
   * original starts, which is written out beside each one.
   */
  async function diesAndRecovers(game: Game, bodyFrame: number): Promise<void> {
    expect(game.isDead, 'he is dead').toBe(true);
    expect(game.hitPoints, 'a death takes every hit point').toBe(0);
    // The death animation needs a tick or two to reach the body.
    for (let i = 0; i < 10 && game.kid.frame !== bodyFrame; i++) game.step(NOTHING);
    expect(game.kid.frame, 'the body the original draws').toBe(bodyFrame);
    expect(bodyPixels(game), 'and there is a body to see').toBeGreaterThan(60);

    // And it stays that body, in that place. The byte-code of all four
    // ends on a jump onto its own last frame, so nothing about it moves
    // again. The port let the bump push a corpse off the spikes, stagger
    // it and stand it up with no hit points.
    const resting = { frame: game.kid.frame, x: game.kid.x, y: game.kid.y };
    for (let i = 0; i < 30; i++) game.step(NOTHING);
    expect({ frame: game.kid.frame, x: game.kid.x, y: game.kid.y },
      'a body does not move or get up').toEqual(resting);

    let asked = -1;
    for (let i = 0; i < 60 && asked < 0; i++) {
      game.step(NOTHING);
      if (game.awaitingButton) asked = i;
    }
    expect(asked, 'the words come up rather than sticking').toBeGreaterThanOrEqual(0);
    expect(bodyPixels(game), 'and the body is still there under them')
      .toBeGreaterThan(60);

    let due = -1;
    for (let i = 0; i < 10 && due < 0; i++) {
      game.step({ x: 0, y: 0, shift: true });
      if (game.restartDue) due = i;
    }
    expect(due, 'a button starts the level again').toBeGreaterThanOrEqual(0);
  }

  it('on the spikes', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Level 1's room 6: run off the ledge at the top into the spikes.
    stand(game, 6, 2, 0);
    for (let i = 0; i < 40 && !game.isDead; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    // Sequence 51: `knockDown`, `dx 4`, frame 177, `die`, frame 177 and a
    // jump back onto that frame. The body on the blades, for ever.
    await diesAndRecovers(game, 177);
  });

  it('on a guard\'s sword, with nothing to fight back with', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    expect(game.hasSword, 'level 1 starts him empty-handed').toBe(false);
    // Level 1's room 3 has the first guard in the game.
    stand(game, 3, 0, 1);
    for (let i = 0; i < 80 && !game.isDead; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    // Sequence 85 is `action 5` and a jump into sequence 71, which is the
    // collapse a guard dies in as well: `die`, frames 179, 180, 181, 182,
    // 183 and 185. He goes down rather than snapping into a pose.
    await diesAndRecovers(game, 185);
  });

  it('down a fall that breaks him', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    const kid = game.kid;
    // Coming down on the floor of room 2's middle row with the speed of
    // a three-row drop behind him: a fall of more than about two rows is
    // fatal in the original, and `land` is where that is decided.
    kid.room = 2; kid.currentRow = 1; kid.currentColumn = 6;
    kid.x = standX(6); kid.y = standY(1) - 10;
    kid.direction = 0; kid.frame = 106; kid.action = 4;
    kid.fallX = 0; kid.fallY = 35;
    game.showRoom(2);
    for (let i = 0; i < 10 && !game.isDead; i++) game.step(NOTHING);
    expect(game.hitPoints, 'it takes everything').toBe(0);
    // Sequence 22: `knockDown`, `dy -2`, `dx 3`, frame 185, `die`, frame
    // 185. Not sequence 52, which is a one-byte jump into sequence 20 --
    // the landing he gets up from.
    await diesAndRecovers(game, 185);
  });

  it('in a chomper', async () => {
    const game = await Game.start(assets, exe, 3);
    game.clearBottomText();
    const found = findTile(game, TILE.chomper);
    expect(found, 'level 3 has a chomper').not.toBeNull();
    if (!found) return;
    stand(game, found[0], found[1], found[2]);
    for (let i = 0; i < 60 && !game.isDead; i++) game.step(NOTHING);
    // Sequence 54: `action 1`, frame 178, `die`, frame 178. The body the
    // port was using for a sword death too.
    await diesAndRecovers(game, 178);
  });

  /**
   * The one the player found: `death on the spikes is wrong again`.
   *
   * He falls into the pit in the bottom row of level 1's room 6, which is
   * narrow, and frame 177 has his arms out far enough to reach the wall.
   * Nothing dead walks into a wall, so nothing dead is pushed out of one;
   * the port pushed him off the blades, played the stagger and stood him
   * up, and the player saw a Prince alive on screen with no hit points
   * who would not answer the keyboard.
   */
  it('stays where it died, even in a pit it only just fits in', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    const kid = game.kid;
    kid.room = 6; kid.currentRow = 2; kid.currentColumn = 3;
    kid.x = standX(3); kid.y = standY(2) - 20;
    kid.direction = -1; kid.frame = 106; kid.action = 4;
    kid.fallX = 0; kid.fallY = 30;
    game.showRoom(6);
    for (let i = 0; i < 12 && !game.isDead; i++) game.step(NOTHING);
    expect(game.kid.frame, 'impaled').toBe(177);
    const where = { x: kid.x, y: kid.y, frame: kid.frame };
    for (let i = 0; i < 40; i++) game.step(NOTHING);
    expect({ x: kid.x, y: kid.y, frame: kid.frame }).toEqual(where);
  });
});

/**
 * A key that is still held after the move it started has finished.
 *
 * Both of these came from the player, within a few minutes of each
 * other, and they are the same fault: the latch that stops a held key
 * repeating was left set by a move that had not finished, and nothing
 * clears it until the key comes back up. The game stops answering the
 * keyboard, which is what he called it.
 */
describe('a key that is held down', () => {
  it('turns him round after a wall has cut the turn short', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Level 1's room 1, bottom left: run at the wall and press the other
    // way just before reaching it, so the run-turn is interrupted by the
    // bump. Measured against the original with the probe
    // `14.,11l,36r,30.`: it is turning four ticks after the bump and
    // running six after that, where the port stood still for twenty-nine.
    const LEFT = { x: -1, y: 0, shift: false };
    const RIGHT = { x: 1, y: 0, shift: false };
    for (let i = 0; i < 25; i++) game.step(LEFT);
    expect(game.kid.direction, 'running left').toBe(-1);
    let turned = -1;
    for (let i = 0; i < 25 && turned < 0; i++) {
      game.step(RIGHT);
      if (game.kid.direction === 0) turned = i;
    }
    expect(turned, 'he turns while the key is still down')
      .toBeGreaterThanOrEqual(0);
    // And goes on into a run, rather than standing there.
    for (let i = 0; i < 12; i++) game.step(RIGHT);
    expect(game.kid.frame, 'and runs').toBeGreaterThanOrEqual(1);
    expect(game.kid.frame).toBeLessThan(15);
  });

  it('goes on down a shaft rather than stopping after one ledge', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Level 1's room 15, column 5: three floors one above the other,
    // which is the shape the player was describing.
    stand(game, 15, 5, 0, 0);
    const DOWN = { x: 0, y: 1, shift: false };
    const rows: string[] = [];
    for (let i = 0; i < 60; i++) {
      game.step(DOWN);
      const where = `${game.kid.room}:${game.kid.currentRow}`;
      if (rows[rows.length - 1] !== where) rows.push(where);
    }
    expect(rows, 'one ledge after another while the key is held')
      .toEqual(['15:0', '15:1', '15:2']);
  });
});

/**
 * A wall met in mid-air.
 *
 * Sequence 4, the running jump, moves the Prince 12, 8, 8, 4 and 4 units
 * on its last five frames. Nothing was looking at the tiles he crossed
 * while it did, so on level 1 he cleared the gap at the right of room 1
 * and flew through the three wall tiles beyond it, which is what the
 * player reported as passing through a wall.
 *
 * Measured with the probe `14.,14r,6ru,46.`: the original drops straight
 * down the gap and lands on the bottom row at about screen x 155, where
 * the port sailed on to x 230 and came down three tiles further along.
 */
describe('a running jump at a wall', () => {
  it('stops at it and drops, instead of flying through it', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    const RUN = { x: 1, y: 0, shift: false };
    const JUMP = { x: 1, y: -1, shift: false };
    // He drops into the level over the first fourteen ticks.
    for (let i = 0; i < 14; i++) game.step(NOTHING);
    for (let i = 0; i < 14; i++) game.step(RUN);
    for (let i = 0; i < 6; i++) game.step(JUMP);
    let landed = -1;
    for (let i = 0; i < 25 && landed < 0; i++) {
      game.step(NOTHING);
      if (game.kid.currentRow === 2 && game.kid.y === standY(2)) {
        landed = game.kid.currentColumn;
      }
    }
    // Room 1's middle row is floor out to column 4 and wall from 5 on;
    // the bottom row under column 4 is where the original puts him.
    expect(game.kid.room).toBe(1);
    expect(landed, 'he comes down in the gap, not three tiles beyond it')
      .toBe(4);
  });

  it('never leaves him standing inside a wall', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    const JUMP = { x: 1, y: -1, shift: false };
    for (let i = 0; i < 14; i++) game.step(NOTHING);
    for (let i = 0; i < 14; i++) game.step({ x: 1, y: 0, shift: false });
    for (let i = 0; i < 6; i++) game.step(JUMP);
    for (let i = 0; i < 40; i++) {
      game.step(NOTHING);
      const kid = game.kid;
      if (kid.currentColumn < 0 || kid.room === 0) continue;
      const here = game.scene.state.typeAt(kid.room, kid.currentColumn, kid.currentRow);
      expect(here, `tick ${i}: standing in a wall`).not.toBe(TILE.wall);
    }
  });
});

/**
 * `at that distance he should follow me to the next screen`.
 *
 * Every room keeps its own guard, and changing room used to put that
 * room's guard on the screen and the old one back in his box -- so the
 * Prince could walk out of a fight and leave the guard standing where he
 * was. Level 1's room 3 holds the first guard in the game and room 2 is
 * the room to its left.
 */
describe('a guard with his sword out', () => {
  const ROOM = 3; const LEFT = 2;

  it('comes after the Prince into the next room', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    expect(game.guard.room, 'room 3 has the guard').toBe(ROOM);
    game.guard.sword = SWORD_DRAWN;
    const was = game.guard.x;
    game.showRoom(LEFT);
    expect(game.guard.room, 'and he comes with him').toBe(LEFT);
    expect(game.guard.x, 'in at the edge the Prince went out of')
      .toBe((was + 140) & 0xff);
    // And he is not left behind in the room he came from as well: going
    // back meets the same guard, not a second one standing where the
    // first one was.
    expect(game.guards.tile[ROOM - 1], 'his box in room 3 is empty')
      .toBeGreaterThanOrEqual(30);
    game.showRoom(ROOM);
    expect(game.guard.room).toBe(ROOM);
    expect(game.guard.x, 'the same guard, back through the same door')
      .toBe(was);
  });

  it('stays put while his sword is sheathed', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(ROOM);
    game.guard.sword = 0;
    game.showRoom(LEFT);
    expect(game.guard.room, 'room 2 has no guard of its own').not.toBe(LEFT);
  });
});

describe('the way out of a level', () => {
  it('opens when the Prince stands on its button, and lets him through', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Level 1: the plate in room 9 opens the door in the middle row.
    expect(game.scene.state.typeAt(9, 0, 0)).toBe(TILE.opener);
    expect(game.scene.state.typeAt(9, 3, 1)).toBe(TILE.levelDoorLeft);
    stand(game, 9, 0, 0);
    for (let i = 0; i < 80; i++) game.step(NOTHING);
    expect(game.scene.state.modifierAt(9, 3, 1), 'the door is up').toBe(43);
  });

  it('ends the level when he walks into it', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Open the door first, then walk into it along the middle row.
    game.scene.state.setModifier(9, 3, 1, 43);
    stand(game, 9, 1, 1);
    for (let i = 0; i < 80 && !game.levelFinished; i++) {
      game.step({ x: 1, y: 0, shift: false });
    }
    expect(game.levelFinished, 'the level is over').toBe(true);
  });
});

describe('a loose floor', () => {
  it('shakes, comes away and leaves rubble', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    // Level 1, room 1: the loose floor is column 6 of the bottom row.
    expect(game.scene.state.typeAt(1, 6, 2)).toBe(TILE.loose);
    stand(game, 1, 6, 2);
    let fell = -1;
    for (let i = 0; i < 60 && fell < 0; i++) {
      game.step(NOTHING);
      if (game.scene.state.typeAt(1, 6, 2) !== TILE.loose) fell = i;
    }
    expect(fell, 'it gives way under him').toBeGreaterThanOrEqual(0);
    // And what is left is the hole, not a floor he can stand on.
    expect(game.scene.state.typeAt(1, 6, 2)).not.toBe(TILE.floor);
  });
});
