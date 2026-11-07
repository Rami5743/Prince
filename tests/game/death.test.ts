/**
 * Dying, and starting the level again.
 *
 * The original kills the Prince outright when he falls out of the bottom of
 * the level, and takes a hit point off a fall of more than about a tile. The
 * port has to do the same: without it a Prince who falls out of the world
 * falls for ever, and the player is left holding keys that do nothing.
 *
 * No level lets the Prince simply walk out of the world -- the bottom row of
 * every room is walled, and he is stopped at a wall before he reaches the
 * edge. These tests therefore put him somewhere he will fall out of, rather
 * than walking him there. An earlier version of this file held Right on
 * level 3 and waited for a death; that only ever worked because the Prince
 * walked straight through the wall at the end of room 12, which he no longer
 * does -- see `checkBumped` in src/game/kid.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game, RESTART_PROMPT_DELAY, RESTART_DELAY } from '../../src/game/game.ts';
import { TILE } from '../../src/game/tiles.ts';
import { standX, standY } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const FORWARD = { x: 1, y: 0, shift: false };

describe('dying', () => {
  /**
   * Room 8 of level 3 has no room below it and nothing to stand on along
   * most of its bottom row, so a Prince put there falls out of the world.
   */
  function dropOutOfTheWorld(game: Game): void {
    const kid = game.kid;
    kid.room = 8; kid.currentRow = 2; kid.currentColumn = 5;
    kid.x = standX(5); kid.y = standY(2);
    kid.direction = 0; kid.frame = 15; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    game.drawnRoom = 8;
  }

  it('falling out of the bottom of the level ends in a death, not an endless fall',
    async () => {
      const game = await Game.start(assets, exe, 3);
      dropOutOfTheWorld(game);
      let died = -1;
      for (let step = 0; step < 200 && died < 0; step++) {
        game.step(FORWARD);
        if (game.isDead) died = step;
      }
      expect(died).toBeGreaterThan(0);
      expect(game.hitPoints).toBe(0);
      expect(game.kid.room).toBe(0); // out of the level altogether
    });

  it('a level started again has the Prince back at its start, unhurt', async () => {
    const game = await Game.start(assets, exe, 3);
    const startRoom = game.kid.room;
    const startX = game.kid.x;
    const full = game.hitPoints;
    dropOutOfTheWorld(game);
    for (let step = 0; step < 200 && !game.isDead; step++) game.step(FORWARD);
    expect(game.isDead).toBe(true);

    const again = await game.restart(assets, exe);
    expect(again.isDead).toBe(false);
    expect(again.hitPoints).toBe(full);
    expect(again.kid.room).toBe(startRoom);
    expect(again.kid.x).toBe(startX);
  });

  /**
   * A fall of about two storeys costs a hit point and puts the Prince in a
   * long crouch before he stands up again. The crouch is 29 ticks of one
   * frame, which the executable stores packed; read unpacked it came out as
   * seven wrong frames, one of them with no sprite, so he flickered and
   * vanished for a tick on every such landing.
   */
  it('a two-storey fall costs a hit point and ends in a long crouch', async () => {
    // Room 16 of level 3: floor along the top row up to column 6, nothing at
    // column 7 or below it until the bottom row. Walking right off column 6
    // is a genuine two-storey drop onto a plain floor.
    const game = await Game.start(assets, exe, 3);
    const kid = game.kid;
    kid.room = 16; kid.currentRow = 0; kid.currentColumn = 6;
    kid.x = standX(6); kid.y = standY(0);
    kid.direction = 0; kid.frame = 15; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    game.drawnRoom = 16;

    const frames: number[] = [];
    for (let i = 0; i < 70; i++) {
      game.step(FORWARD);
      frames.push(kid.frame);
    }
    expect(game.hitPoints).toBe(2);
    expect(game.isDead).toBe(false);

    // Frame 108 is the landing; 109 is the crouch, held 29 times; 110..119
    // are standing up. Nothing else gets a look in.
    const land = frames.indexOf(108);
    expect(land).toBeGreaterThan(0);
    expect(frames.slice(land + 1, land + 30)).toEqual(Array<number>(29).fill(109));
    expect(frames.slice(land + 30, land + 33)).toEqual([110, 110, 110]);
    // Through the landing and the stand-up, nothing but landing frames gets
    // a look in -- this is what the flicker showed up as. After that he is
    // on his feet and free to run on, so the window stops there.
    for (const f of frames.slice(land, land + 33)) expect(f).toBeGreaterThanOrEqual(108);
  });

  it('the hit points shown never go below none', async () => {
    const game = await Game.start(assets, exe, 3);
    game.damage(100);
    expect(game.hitPoints).toBe(0);
    game.damage(100);
    expect(game.hitPoints).toBe(0);
  });

  /**
   * Dying does not at once offer the level again. The original waits and
   * then puts `Press Button to Continue` up, and until it does, nothing
   * starts the level over: in the grabbed video the Prince is struck down
   * at tick 177, the words appear at 221, and the player's four direction
   * presses in between do nothing at all.
   */
  it('waits before it will take the button', async () => {
    const game = await Game.start(assets, exe, 3);
    const none = { x: 0, y: 0, shift: false };
    game.damage(100);
    expect(game.isDead).toBe(true);
    expect(game.awaitingButton, 'not straight away').toBe(false);
    for (let i = 0; i < RESTART_PROMPT_DELAY - 1; i++) game.step(none);
    expect(game.awaitingButton, 'nor a tick early').toBe(false);
    game.step(none);
    expect(game.awaitingButton, 'but then yes').toBe(true);
  });

  it('takes six ticks over starting the level again', async () => {
    const game = await Game.start(assets, exe, 3);
    const none = { x: 0, y: 0, shift: false };
    game.damage(100);
    for (let i = 0; i < RESTART_PROMPT_DELAY; i++) game.step(none);
    expect(game.awaitingButton).toBe(true);
    game.pressButton();
    expect(game.awaitingButton, 'the prompt goes once it is taken').toBe(false);
    const due: boolean[] = [];
    for (let i = 0; i < RESTART_DELAY + 2; i++) {
      game.step(none);
      due.push(game.restartDue);
    }
    // Nothing for the first four, then the one tick it falls due on.
    expect(due.indexOf(true)).toBe(RESTART_DELAY - 1);
    expect(due.filter(Boolean)).toHaveLength(1);
  });

  /**
   * Blades that are out kill whoever is standing in them. The rule used to
   * be the other way round -- a runner, and only while they were on their
   * way up -- so the Prince could stand in a full set of them for ever. A
   * grabbed video of the recorded play has the original killing him on the
   * spot in this very room while the port had him standing there unhurt.
   */
  it('standing in spikes that are out is fatal', async () => {
    const game = await Game.start(assets, exe, 1);
    const none = { x: 0, y: 0, shift: false };
    // Level 1, room 6: column 3 of the bottom row is a spike.
    expect(game.scene.state.typeAt(6, 3, 2)).toBe(TILE.spike);
    game.showRoom(6);
    const kid = game.kid;
    kid.room = 6; kid.currentRow = 2; kid.currentColumn = 3;
    kid.x = standX(3); kid.y = standY(2);
    kid.direction = 0; kid.frame = 15; kid.action = 0;
    kid.fallX = 0; kid.fallY = 0;
    for (let i = 0; i < 20 && !game.isDead; i++) game.step(none);
    expect(game.isDead, 'the spikes come out and he is on them').toBe(true);
  });

  it('is not waiting for the button while he is alive', async () => {
    const game = await Game.start(assets, exe, 3);
    for (let i = 0; i < RESTART_PROMPT_DELAY * 2; i++) {
      game.step({ x: 0, y: 0, shift: false });
    }
    expect(game.isDead).toBe(false);
    expect(game.awaitingButton).toBe(false);
  });
});

/**
 * Falling into spikes.
 *
 * `checkSpiked` asks whether the blades are out and lets anything airborne
 * past, which is right for a running jump across a set of them and wrong
 * for a landing: the blades come out *because* something is coming down on
 * them. The capture of the recorded run of level 1 settles it -- the Prince
 * runs off the ledge at the top of room 6, lands on the spikes of the
 * bottom row, and the original impales him there (first blood at tick 284)
 * and has the level running again by 301. The port charged him one hit
 * point and let him walk away with two, and the two runs had nothing to do
 * with each other after that.
 */
describe('spikes under a fall', () => {
  it('kill the Prince who lands in them', async () => {
    const game = await Game.start(assets, exe, 1);
    const kid = game.kid;
    // The top row of room 6, at the lip of the hole over the spikes.
    expect(game.scene.state.typeAt(6, 3, 2)).toBe(TILE.spike);
    kid.room = 6; kid.currentRow = 0; kid.currentColumn = 2;
    kid.x = standX(2); kid.y = standY(0);
    kid.direction = 0; kid.frame = 15; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    game.showRoom(6);
    for (let i = 0; i < 40 && !game.isDead; i++) game.step(FORWARD);
    expect(game.isDead).toBe(true);
    game.step({ x: 0, y: 0, shift: false });
    expect(kid.currentRow).toBe(2);
    // Sequence 51's own frame: the body on the blades.
    expect(kid.frame).toBe(177);
  });
});
