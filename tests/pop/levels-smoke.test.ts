/**
 * Every level starts, plays and draws.
 *
 * Not a comparison with anything: a guard against the translation
 * throwing or going black on a level no capture reaches. Level 11 did
 * throw until `find_room_of_tile` stopped following a link out of a
 * room that is not a room -- `check_chomped_kid` asks for room -1, as
 * the C's own comment says -- and the whole of levels 4, 5, 6 and 12
 * needs the shadow, who was a stub.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Enough of a wander to walk off a ledge, climb and meet what is there. */
const CONTROLS = (t: number): { x: number; y: number; shift: boolean } => (
  t % 7 === 0 ? { x: -1, y: 0, shift: false }
    : t % 5 === 0 ? { x: 1, y: 0, shift: false }
      : t % 11 === 0 ? { x: 0, y: -1, shift: false }
        : { x: 0, y: 0, shift: false });

describe('every level plays', () => {
  for (let level = 1; level <= 14; level++) {
    it(`level ${level} runs three hundred ticks and draws every room`, async () => {
      let game = await PopGame.start(assets, exe, level);
      game.render();
      for (let t = 0; t < 300; t++) {
        game.step(CONTROLS(t));
        if (game.restartDue) game = await game.restart(assets, exe);
        const surface = game.render();
        expect(surface.pixels.some((p) => p !== 0), `level ${level} tick ${t} is black`)
          .toBe(true);
      }
      for (let room = 1; room <= 24; room++) {
        game.showRoom(room);
        expect(game.render().pixels.some((p) => p !== 0), `level ${level} room ${room} is black`)
          .toBe(true);
      }
    }, 60000);
  }
});

/**
 * The same thing played badly, with the cheats, through the doors.
 *
 * The 300-tick wander above is a fixed pattern and never reaches the
 * odd corners. Random keys do: this is what found the two
 * `TypeError`s in `tests/pop/fell-out.test.ts`, where the Prince
 * falls out of the bottom of a level, is already dying so `fell_out`
 * will not take him, and the next `exit_room` asks for the links of a
 * room that is not a room. One run of level 5 in ten and one of level
 * 10 in five.
 *
 * It is a seeded stream, so it is the same play every time; the
 * assertion is only that nothing throws and nothing goes black.
 */
describe('played badly', () => {
  it('fourteen levels of random keys, cheats and doors throw nothing', async () => {
    let seed = 20261112;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let start = 1; start <= 14; start++) {
      let level = start;
      let game = await PopGame.start(assets, exe, level);
      let hold = { x: 0, y: 0, shift: false };
      let left = 0;
      for (let t = 0; t < 1000; t++) {
        if (left-- <= 0) {
          const r = rnd();
          hold = {
            x: r < 0.3 ? -1 : r < 0.6 ? 1 : 0,
            y: rnd() < 0.25 ? -1 : rnd() < 0.15 ? 1 : 0,
            shift: rnd() < 0.2,
          };
          left = 1 + Math.floor(rnd() * 14);
        }
        const c = rnd();
        if (c < 0.002) game.toggleUpsideDown();
        if (c > 0.9985) game.featherFall();
        if (c > 0.996 && c < 0.997) game.killGuard();
        if (c > 0.995 && c < 0.996) game.resurrect();
        if (c > 0.994 && c < 0.995) game.addLife();
        if (c > 0.993 && c < 0.994) game.heal();
        if (hold.shift && !(t % 97)) game.pressButton();
        game.step(hold);
        if (game.restartDue) game = await game.restart(assets, exe);
        expect(game.render().pixels.some((p) => p !== 0),
          `level ${level} tick ${t} is black`).toBe(true);
        if (game.gameWon) break;
        if (game.levelFinished) {
          // What `web/main.ts` carries from one level to the next.
          const carried = {
            ticks: game.remainingTicks,
            sword: game.hasSword,
            lives: game.maxHitPoints,
            seamless: game.seamlessExit,
            hp: game.hitPoints,
          };
          level = level >= 14 ? 1 : level + 1;
          game = await PopGame.start(assets, exe, level, { seamless: carried.seamless });
          game.remainingTicks = carried.ticks;
          game.hasSword = carried.sword || game.hasSword;
          game.beginningHitPoints = carried.lives;
          if (carried.seamless) game.carryHitPoints(carried.hp, carried.lives);
        }
      }
    }
  }, 180000);
});
