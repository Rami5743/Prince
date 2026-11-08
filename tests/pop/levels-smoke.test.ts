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
