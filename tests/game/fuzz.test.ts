/**
 * Playing badly, on purpose, and checking the Prince never ends up somewhere
 * the game has no meaning for.
 *
 * The comparisons against the original say whether a move looks right. They
 * say nothing about the moves nobody thought to capture, and the two worst
 * bugs found so far -- the Prince walking through the wall at the end of a
 * room, and then, once that was stopped, being pushed sideways through the
 * floor while falling -- were both of that kind: reachable in a few seconds
 * of ordinary play, and invisible to every capture in the suite.
 *
 * So this plays each level with a seeded stream of plausible input -- keys
 * held for a few frames at a time, the way a person holds them -- and
 * asserts the handful of things that must be true however badly it is
 * played. It is deterministic: a failure names the level and the seed, and
 * tools/dev/play.ts replays it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import type { Controls } from '../../src/game/kid.ts';
import { Y_LAND } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** A small deterministic generator, so a failure can be replayed exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Input the way a person gives it: one choice held for several frames, not a
 * fresh random key every frame. Holding is what the control latch is for,
 * and a per-frame scramble would never exercise it.
 */
function* plausibleInput(seed: number, frames: number): Generator<Controls> {
  const next = rng(seed);
  const choices: Controls[] = [
    { x: 0, y: 0, shift: false },
    { x: 1, y: 0, shift: false },
    { x: -1, y: 0, shift: false },
    { x: 0, y: -1, shift: false },
    { x: 0, y: 1, shift: false },
    { x: 1, y: 0, shift: true },
    { x: -1, y: 0, shift: true },
    { x: 0, y: -1, shift: true },
    { x: 0, y: 1, shift: true },
    { x: 0, y: 0, shift: true },
  ];
  let sent = 0;
  while (sent < frames) {
    const c = choices[Math.floor(next() * choices.length)];
    const hold = 2 + Math.floor(next() * 12);
    for (let i = 0; i < hold && sent < frames; i++, sent++) yield c;
  }
}

/** The rows a character can be in: the three of a room, plus one either side
 *  while it is crossing into the room above or below. */
const ROW_MIN = -1;
const ROW_MAX = 3;
/** Floor heights run from -8 to 244; a little either side is the most any
 *  legal fall or jump reaches. */
const Y_MIN = Y_LAND[0] - 80;
const Y_MAX = Y_LAND[Y_LAND.length - 1] + 80;
/** A fall of three rows is fatal, so nothing legal falls for long. */
const MAX_AIRBORNE = 60;

const LEVELS = [1, 2, 3, 4, 5];
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const FRAMES = 600;

describe('played badly, the Prince stays inside the world', () => {
  for (const level of LEVELS) {
    it(`level ${level}, ${SEEDS.length} seeds of ${FRAMES} frames`, async () => {
      for (const seed of SEEDS) {
        const game = await Game.start(assets, exe, level);
        const where = (t: number): string =>
          `level ${level} seed ${seed} frame ${t}: `
          + `kid frame ${game.kid.frame} action ${game.kid.action} `
          + `room ${game.kid.room} x ${game.kid.x} y ${game.kid.y} `
          + `column ${game.kid.currentColumn} row ${game.kid.currentRow}`;

        let airborne = 0;
        let t = 0;
        for (const controls of plausibleInput(seed, FRAMES)) {
          game.step(controls);
          t++;
          if (game.isDead) break;

          expect(game.kid.currentRow, where(t)).toBeGreaterThanOrEqual(ROW_MIN);
          expect(game.kid.currentRow, where(t)).toBeLessThanOrEqual(ROW_MAX);
          expect(game.kid.y, where(t)).toBeGreaterThanOrEqual(Y_MIN);
          expect(game.kid.y, where(t)).toBeLessThanOrEqual(Y_MAX);
          // Room 0 is outside the level; the only way out of it is death,
          // which `isDead` above would have caught.
          expect(game.kid.room, where(t)).toBeGreaterThan(0);

          // Falling has to end: in a landing, a grab, or a death.
          const falling = game.kid.fallY > 0;
          airborne = falling ? airborne + 1 : 0;
          expect(airborne, `${where(t)}: still falling`).toBeLessThan(MAX_AIRBORNE);
        }
      }
    }, 120000);
  }
});
