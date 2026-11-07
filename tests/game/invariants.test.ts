/**
 * Things that must be true however the game is played.
 *
 * The other tests ask whether the port does a particular thing the way
 * the original does it. This one asks whether it ever does something no
 * version of the game should: stand inside a wall, fall through a floor,
 * die without a body, run the byte-code off the end of its table.
 *
 * It finds those by playing. Two hundred short runs of made-up input on
 * level 1, from a fixed seed so that a failure can be repeated, and after
 * every tick a handful of checks. It is the cheapest way there is of
 * covering the corners of the level that nobody thinks to write a test
 * for -- the running jump that ends inside the wall of room 1 was found
 * this way once the check for it existed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { TILE, tileIsFloor } from '../../src/game/tiles.ts';
import { ACTION } from '../../src/game/sequence.ts';
import { standY } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** A small deterministic generator, so a failing run can be run again. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A run of made-up input: a few ticks of one thing, then a few of another. */
function inputs(seed: number, ticks: number) {
  const next = rng(seed);
  const out: { x: number; y: number; shift: boolean }[] = [];
  while (out.length < ticks) {
    const n = 1 + Math.floor(next() * 10);
    const c = {
      x: Math.floor(next() * 3) - 1,
      y: Math.floor(next() * 3) - 1,
      shift: next() < 0.25,
    };
    for (let i = 0; i < n && out.length < ticks; i++) out.push(c);
  }
  return out;
}

describe('however it is played', () => {
  it('never leaves the Prince standing inside a wall', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const game = await Game.start(assets, exe, 1);
      game.clearBottomText();
      const keys = inputs(seed, 200);
      for (let t = 0; t < keys.length; t++) {
        game.step(keys[t]);
        if (game.restartDue) break;
        const kid = game.kid;
        if (kid.alive >= 0 || kid.room === 0) break;
        // Only when he is standing on the floor of the row he is in:
        // mid-air he passes over tiles on his way.
        if (kid.y !== standY(kid.currentRow)) continue;
        if (kid.action === ACTION.hangClimb || kid.action === ACTION.hangStraight) continue;
        if (kid.currentColumn < 0 || kid.currentColumn > 9) continue;
        // Standing or running, and nothing else. Climbing and jumping
        // frames count the tile he is moving out of or into as the one he
        // is in, so he is legitimately `in` a wall for a frame or two of
        // pulling himself up past one.
        const walking = kid.frame === 15 || (kid.frame >= 1 && kid.frame <= 14);
        if (!walking) continue;
        const here = game.scene.state.typeAt(kid.room, kid.currentColumn, kid.currentRow);
        if (here === TILE.wall) {
          bad.push(`seed ${seed} tick ${t}: room ${kid.room} `
            + `column ${kid.currentColumn} row ${kid.currentRow} frame ${kid.frame}`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * The one the player reported as passing through a wall. A wall tile is
   * floor to ceiling, so nothing can get from one side of one to the
   * other without changing row: not walking, and not in the middle of a
   * running jump either, which is how he used to do it.
   */
  it('never carries him through a wall', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const game = await Game.start(assets, exe, 1);
      game.clearBottomText();
      const keys = inputs(seed + 20000, 260);
      let was = { room: 0, row: 0, column: 0 };
      for (let t = 0; t < keys.length; t++) {
        game.step(keys[t]);
        if (game.restartDue) break;
        const kid = game.kid;
        if (kid.alive >= 0 || kid.room === 0) break;
        const now = { room: kid.room, row: kid.currentRow, column: kid.currentColumn };
        if (now.room === was.room && now.row === was.row && now.column !== was.column) {
          const lo = Math.min(now.column, was.column);
          const hi = Math.max(now.column, was.column);
          for (let c = lo + 1; c < hi; c++) {
            if (c < 0 || c > 9) continue;
            if (game.scene.state.typeAt(now.room, c, now.row) === TILE.wall) {
              bad.push(`seed ${seed} tick ${t}: room ${now.room} row ${now.row} `
                + `column ${was.column} to ${now.column} across the wall at ${c} `
                + `(frame ${kid.frame})`);
              break;
            }
          }
          if (bad.length) break;
        }
        was = now;
      }
      if (bad.length) break;
    }
    expect(bad).toEqual([]);
  });

  it('never stands him on nothing', async () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const game = await Game.start(assets, exe, 1);
      game.clearBottomText();
      const keys = inputs(seed + 5000, 200);
      for (let t = 0; t < keys.length; t++) {
        game.step(keys[t]);
        if (game.restartDue) break;
        const kid = game.kid;
        if (kid.alive >= 0 || kid.room === 0) break;
        // Standing still, on the floor level, with his weight in the room.
        if (kid.frame !== 15 || kid.y !== standY(kid.currentRow)) continue;
        if (kid.currentColumn < 0 || kid.currentColumn > 9) continue;
        const here = game.scene.state.typeAt(kid.room, kid.currentColumn, kid.currentRow);
        if (!tileIsFloor(here) && here !== TILE.wall) {
          bad.push(`seed ${seed} tick ${t}: room ${kid.room} `
            + `column ${kid.currentColumn} row ${kid.currentRow} tile ${here}`);
          break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('always gets from a death to a body and a prompt', async () => {
    const deaths: number[] = [];
    const bad: string[] = [];
    for (let seed = 1; seed <= 200 && deaths.length < 12; seed++) {
      const game = await Game.start(assets, exe, 1);
      game.clearBottomText();
      const keys = inputs(seed + 9000, 320);
      let died = -1;
      for (let t = 0; t < keys.length; t++) {
        game.step(keys[t]);
        if (died < 0 && game.isDead) died = t;
        if (died >= 0 && t > died + 40) break;
      }
      if (died < 0) continue;
      deaths.push(seed);
      if (game.hitPoints !== 0) {
        bad.push(`seed ${seed}: dead with ${game.hitPoints} hit points left`);
      }
      // One of the bodies the original draws, held still -- or frame 106,
      // which is a Prince still falling: out of the bottom of the level
      // there is no floor to come down on and nothing to draw him on.
      const BODIES = [177, 178, 185, 15, 106];
      if (!BODIES.includes(game.kid.frame)) {
        bad.push(`seed ${seed}: died on frame ${game.kid.frame}`);
      }
      let asked = false;
      for (let i = 0; i < 80 && !asked; i++) {
        game.step({ x: 0, y: 0, shift: false });
        asked = game.awaitingButton;
      }
      if (!asked) bad.push(`seed ${seed}: never asked for a button`);
    }
    expect(deaths.length, 'the made-up runs do kill him').toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});
