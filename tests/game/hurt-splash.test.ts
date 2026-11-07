/**
 * The star at the point of impact.
 *
 * `draw_hurt_splash` is sprite 218 of the Prince's group (sprite 1 of a
 * guard's), drawn over whoever lost hit points on the tick they lost
 * them. It is the only thing on the screen that marks a hit as a hit: a
 * sword fight without it is two men waving at each other, and the player
 * reported exactly that -- "in the sword fight the hit animation, a star
 * at the point of impact, is missing; it is missing in other places
 * too". The other places are every other way of losing a hit point: a
 * two-row fall, the spikes, the chomper, a guard's blade.
 *
 * The port drew it nowhere at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { placeHurtSplash } from '../../src/game/character.ts';
import { standX, standY } from '../../src/game/geometry.ts';
import { startSequence, SEQ } from '../../src/game/sequence.ts';
import type { CharacterDraw } from '../../src/render/room.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Sprite ids, as the port numbers them: one more than the original's. */
const KID_SPLASH = 219;
const GUARD_SPLASH = 2;

function body(direction: number): CharacterDraw {
  return { chtab: 'kid', image: 30, x: 100, y: 120, direction, row: 1 };
}

describe('where the splash goes', () => {
  it('is five forward and four down over a body on the ground', () => {
    for (const frame of [185, 106, 107, 108, 109, 110]) {
      const right = placeHurtSplash(body(0), frame)!;
      expect({ x: right.x, y: right.y }, `frame ${frame} facing right`)
        .toEqual({ x: 105, y: 124 });
      const left = placeHurtSplash(body(-1), frame)!;
      expect({ x: left.x, y: left.y }, `frame ${frame} facing left`)
        .toEqual({ x: 95, y: 124 });
    }
  });

  it('is five *backward* and level over a body on the spikes', () => {
    expect(placeHurtSplash(body(0), 177)).toMatchObject({ x: 95, y: 120 });
    expect(placeHurtSplash(body(-1), 177)).toMatchObject({ x: 105, y: 120 });
  });

  /**
   * Anywhere else it goes up by eleven, and the Prince is four pixels
   * taller than a guard, so his goes up by fifteen -- the original
   * writes it as `((charid == kid) << 2) + 11`.
   */
  it('is five forward and fifteen up over a Prince on his feet', () => {
    expect(placeHurtSplash(body(0), 15)).toMatchObject({ x: 105, y: 105 });
    expect(placeHurtSplash(body(-1), 15)).toMatchObject({ x: 95, y: 105 });
  });

  it('is eleven up over a guard, and comes from the guard group', () => {
    const g = placeHurtSplash({ ...body(0), chtab: 'guard' }, 15, 'guard')!;
    expect({ x: g.x, y: g.y }).toEqual({ x: 105, y: 109 });
    expect(g.chtab).toBe('guard');
    expect(g.image).toBe(GUARD_SPLASH);
  });

  it('comes from the Prince group for the Prince', () => {
    expect(placeHurtSplash(body(0), 15)!.image).toBe(KID_SPLASH);
  });

  /** There is no point of impact to mark: he is inside the blades. */
  it('is not drawn over a Prince in the chomper', () => {
    expect(placeHurtSplash(body(0), 178)).toBeNull();
  });

  it('is a real sprite in both groups', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.scene.chtabs.kid!.images[KID_SPLASH]).toBeTruthy();
    expect(game.scene.chtabs.guard!.images[GUARD_SPLASH]).toBeTruthy();
  });
});

describe('when the splash is drawn', () => {
  it('is nothing at all while nobody is being hurt', async () => {
    const game = await Game.start(assets, exe, 1);
    for (let i = 0; i < 60; i++) {
      game.step({ x: 0, y: 0, shift: false });
      expect(game.hurtSplashDraw(), `tick ${i}`).toBeNull();
    }
  });

  /**
   * A two-row fall costs one hit point. The splash shows on that tick
   * and on no other -- the original clears `hitp_delta` at the top of
   * every tick, so it does not linger over the crouch that follows.
   */
  it('is on the screen for the one tick a fall costs a hit point', async () => {
    const game = await Game.start(assets, exe, 1);
    const kid = game.kid;
    // Room 11 of level 1: run off the top row at column 1 and come down
    // two rows, which costs one hit point and no more.
    kid.room = 11; kid.currentRow = 0; kid.currentColumn = 1;
    kid.x = standX(1); kid.y = standY(0);
    kid.direction = 0; kid.action = 0; kid.fallX = 0; kid.fallY = 0;
    startSequence(kid, SEQ.stand, game.tables);
    game.showRoom(11);
    let hurtTicks = 0;
    let hpDropTicks = 0;
    for (let i = 0; i < 60; i++) {
      const before = game.hitPoints;
      game.step({ x: 1, y: 0, shift: false });
      const splash = game.hurtSplashDraw();
      if (game.hitPoints < before) {
        hpDropTicks += 1;
        expect(splash, `tick ${i} took a hit point and must show it`).not.toBeNull();
      } else {
        expect(splash, `tick ${i} lost nothing`).toBeNull();
      }
      if (splash) hurtTicks += 1;
    }
    expect(hpDropTicks, 'the fall costs exactly one hit point').toBe(1);
    expect(hurtTicks).toBe(hpDropTicks);
  });

  /**
   * And it is really painted, not merely computed: the same room drawn
   * with and without the hit differs, and every pixel of the difference
   * is inside the splash's own box.
   */
  it('changes the picture, inside its own box and nowhere else', async () => {
    const plain = await Game.start(assets, exe, 1);
    const hurt = await Game.start(assets, exe, 1);
    for (let i = 0; i < 20; i++) {
      plain.step({ x: 0, y: 0, shift: false });
      hurt.step({ x: 0, y: 0, shift: false });
    }
    hurt.damage(1);
    const splash = hurt.hurtSplashDraw();
    expect(splash).not.toBeNull();
    const a = Uint8Array.from(plain.render().pixels);
    const b = Uint8Array.from(hurt.render().pixels);
    const width = plain.render().width;
    // The hit points along the bottom change too; the room is above them.
    const roomBottom = 192;
    let differing = 0;
    let outside = 0;
    const sprite = plain.scene.chtabs.kid!.images[KID_SPLASH]!;
    // A character's x is stretched from internal units on the way to the
    // screen, the same way `addCharacter` does it.
    const left = Math.floor((splash!.x * 320) / 280) - sprite.width;
    const right = Math.ceil((splash!.x * 320) / 280) + sprite.width;
    const top = splash!.y - sprite.height - 2;
    const bottom = splash!.y + 2;
    for (let y = 0; y < roomBottom; y++) {
      for (let x = 0; x < width; x++) {
        if (a[y * width + x] === b[y * width + x]) continue;
        differing += 1;
        if (x < left || x > right || y < top || y > bottom) outside += 1;
      }
    }
    expect(differing, 'the splash is painted').toBeGreaterThan(40);
    expect(outside, 'and nothing else moved').toBe(0);
  });
});
