/**
 * Dying, and starting the level again.
 *
 * The original kills the Prince outright when he falls out of the bottom of
 * the level, and takes a hit point off a fall of more than about a tile. The
 * port has to do the same: without it a Prince who runs off the edge falls
 * for ever, and the player is left holding keys that do nothing.
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
const FORWARD = { x: 1, y: 0, shift: false };

describe('dying', () => {
  it('running off the edge of level 3 ends in a death, not an endless fall', async () => {
    const game = await Game.start(assets, exe, 3);
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
    const game = await Game.start(assets, exe, 1);
    const kid = game.kid;
    kid.room = 1; kid.currentRow = 0; kid.currentColumn = 4;
    kid.x = standX(4); kid.y = standY(0);
    kid.direction = 0; kid.frame = 15; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    game.drawnRoom = 1;

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
    // Every frame after the landing is one of the landing frames.
    for (const f of frames.slice(land)) expect(f).toBeGreaterThanOrEqual(108);
  });

  it('the hit points shown never go below none', async () => {
    const game = await Game.start(assets, exe, 3);
    game.damage(100);
    expect(game.hitPoints).toBe(0);
    game.damage(100);
    expect(game.hitPoints).toBe(0);
  });
});
