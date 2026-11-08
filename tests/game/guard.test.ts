/**
 * The guards.
 *
 * tests/golden/level2-guard.png is a frame captured from the original with
 * the Prince and a guard facing each other, swords out. The guard's own
 * state was recovered from it the same way the Prince's was: render the room
 * with nobody in it, and search the guard frame table and a window of
 * positions for the one that makes the leftover vanish. It does, exactly --
 * which checks the guard's sprite set, the recolouring of his clothes, the
 * offset between his frame numbers and his table, and the separate placement
 * of the sword in his hand.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, goldenFrame, toCaptureSpace } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Surface } from '../../src/render/surface.ts';
import { Game } from '../../src/game/game.ts';
import {
  NO_DIRECTION, guardFrame, GUARD_TYPE_BY_LEVEL, GUARD_REACH,
} from '../../src/game/guard.ts';
import { placeSword } from '../../src/game/character.ts';
import { toScreenX, standX, standY } from '../../src/game/geometry.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Where the capture shows the guard of level 2, room 4. */
const CAPTURED = { frame: 164, direction: 0, x: 102, y: 118 };

describe('guards', () => {
  it('stands where the level data puts him when the room is entered', async () => {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(4);
    expect(game.guard.room).toBe(4);
    expect(game.guard.direction).not.toBe(NO_DIRECTION);
    // Tile 10 is row 1, column 0; the standing position of column 0 is 72.
    expect(game.guard.currentRow).toBe(1);
    expect(game.guard.currentColumn).toBe(0);
    expect(game.guard.x).toBe(72);
    expect(game.guard.y).toBe(118);
    expect(game.guard.frame).toBe(166); // standing, sword not yet drawn
  });

  it('takes his skill, colour and hit points from the level', async () => {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(4);
    expect(game.guard.skill).toBe(1);
    expect(game.guard.colour).toBe(1);
    expect(game.guard.hitPoints).toBe(game.guard.maxHitPoints);
    expect(game.guard.hitPoints).toBeGreaterThan(0);
  });

  it('is put back into the level when his room is left, and is there on return', async () => {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(4);
    game.guard.x = 120;
    game.guard.frame = 158;
    game.showRoom(5);
    expect(game.guard.direction).toBe(NO_DIRECTION);
    game.showRoom(4);
    expect(game.guard.x).toBe(120);
  });

  it('has no guard in a room that has none', async () => {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(5);
    expect(game.guard.direction).toBe(NO_DIRECTION);
  });

  it('is drawn exactly as the original draws him, sword and all', async () => {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(4);
    const golden = goldenFrame('level2-guard.png');

    // The room with nobody in it, then the guard put back exactly where the
    // capture had him.
    game.kid.room = 0;
    Object.assign(game.guard, CAPTURED);

    const surface: Surface = game.render();
    const got = toCaptureSpace(surface.toRgb(game.scene.screenPalette.toRgba()));

    // Only the guard's own area is compared: the Prince is elsewhere in the
    // frame, and he is checked by his own tests.
    const frame = guardFrame(game.guard, game.tables)!;
    const sprite = game.scene.chtabs.guard!.images[frame.image + 1]!;
    const sword = placeSword(game.guard, frame, game.tables.swordTable, toScreenX);
    const left = toScreenX((game.guard.x + frame.dx) * 2 - 116) - sprite.width - 2;
    const right = (sword ? sword.x : left + sprite.width) + 20;
    const bottom = frame.dy + game.guard.y + 2;
    const top = bottom - sprite.height - 34;

    let differing = 0;
    for (let y = Math.max(0, top); y <= Math.min(191, bottom); y++) {
      for (let x = Math.max(0, left); x <= Math.min(319, right); x++) {
        const i = (y * 320 + x) * 3;
        if (got[i] !== golden.rgb[i] || got[i + 1] !== golden.rgb[i + 1]
          || got[i + 2] !== golden.rgb[i + 2]) differing++;
      }
    }
    expect(differing).toBe(0);
  });

  it('knows which enemy each level has', () => {
    // Skeletons on level 3, a fat guard on 6, the shadow on 12, Jaffar on 13.
    expect(GUARD_TYPE_BY_LEVEL[3]).toBe(2);
    expect(GUARD_TYPE_BY_LEVEL[6]).toBe(1);
    expect(GUARD_TYPE_BY_LEVEL[12]).toBe(4);
    expect(GUARD_TYPE_BY_LEVEL[13]).toBe(3);
    expect(GUARD_TYPE_BY_LEVEL[14]).toBe(-1);
  });

  it('loads the enemy sprites each level calls for', async () => {
    for (const [level, expected] of [[2, true], [3, true], [14, false]] as const) {
      const game = await Game.start(assets, exe, level);
      expect(Boolean(game.scene.chtabs.guard), `level ${level}`).toBe(expected);
    }
  });
});

/**
 * What a guard does on his own.
 *
 * `tests/golden/session-level2-meet` is a capture of the Prince walking up
 * to the guard of level 2's room 4. It shows him idle, then coming on
 * guard, then leaving his corner and closing the distance a step at a time
 * until the two are within a sword's length, and holding there. These pin
 * the shape of that. The fight that follows it in the capture -- the
 * striking, the blocking, the hit that costs the Prince a point -- is not
 * written yet.
 */
describe('a guard left to himself', () => {
  async function inRoomFour(): Promise<Game> {
    const game = await Game.start(assets, exe, 2);
    game.showRoom(4);
    return game;
  }

  it('stands idle until the Prince turns up on his row', async () => {
    const game = await inRoomFour();
    expect(game.guard.sword).toBe(0);
    // The Prince is still in room 5; the guard has no reason to stir.
    for (let i = 0; i < 20; i++) game.step({ x: 0, y: 0, shift: false });
    expect(game.guard.sword).toBe(0);
    expect(game.guard.frame).toBe(166);
  });

  /**
   * A guard's frames are looked up in `frameTableGuard` and drawn out of
   * the guard sprite set, which between them cover a narrow span of frame
   * numbers. Nothing in the engine complains when a guard reaches a frame
   * outside it -- the renderer finds no image and quietly draws nothing --
   * so a guard sent through one of the Prince's sequences goes invisible
   * for as long as it lasts. This walks every guard in the game through
   * meeting the Prince and insists that each frame on the way is one he
   * can actually be seen in.
   */
  it('never reaches a frame it has no sprite for', async () => {
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      const game = await Game.start(assets, exe, level);
      const set = game.scene.chtabs.guard;
      if (!set) continue;
      for (let room = 1; room <= 24; room++) {
        game.showRoom(room);
        if (game.guard.direction === NO_DIRECTION) continue;
        // Stand the Prince in front of him so that he stirs.
        game.kid.room = room;
        game.kid.currentRow = game.guard.currentRow;
        game.kid.currentColumn = game.guard.currentColumn + 3;
        game.kid.x = standX(game.kid.currentColumn);
        game.kid.y = standY(game.kid.currentRow);
        for (let i = 0; i < 60; i++) {
          game.step({ x: 0, y: 0, shift: false });
          if (game.guard.direction === NO_DIRECTION) break;
          const frame = guardFrame(game.guard, game.tables);
          expect(frame, `level ${level} room ${room}: no frame for ${game.guard.frame}`)
            .not.toBeNull();
          expect(
            set.images[frame!.image],
            `level ${level} room ${room}: guard frame ${game.guard.frame} `
            + `wants image ${frame!.image}, and the set has ${set.images.length}`,
          ).toBeDefined();
        }
      }
    }
  }, 60000);

  it('comes on guard when the Prince is in his room on his row', async () => {
    const game = await inRoomFour();
    game.kid.room = 4;
    game.kid.currentRow = game.guard.currentRow;
    const frames: number[] = [];
    for (let i = 0; i < 12; i++) {
      game.step({ x: 0, y: 0, shift: false });
      frames.push(game.guard.frame);
    }
    expect(game.guard.sword).toBe(2);
    // Every frame of it has to be one a guard has a sprite for -- 149 to
    // 189, the span of `frameTableGuard`. The Prince's own draw runs
    // through 207..210, which a guard cannot show at all: sending him
    // through it left him missing for those four frames.
    expect(frames.every((f) => f >= 149 && f <= 189), `frames ${frames}`).toBe(true);
    // And he is on guard at once. `seq_90_en_garde` is one instruction,
    // `jmp(ready)`, so a guard goes straight to 158 and then into the
    // stance at 170/171 -- there is no flourish for him to make. The
    // port had him on sequence 69, which is `attack was parried` and
    // takes four frames he should never have spent: by the time he was
    // ready the Prince was a tile further on, and in the player's
    // recording `e209b01a` that tile is the difference between a guard
    // who follows him into the next room and one who stays behind.
    expect(frames.slice(0, 3)).toEqual([166, 158, 163]);
    expect(frames[frames.length - 1]).toBeGreaterThanOrEqual(150);
    expect(frames[frames.length - 1]).toBeLessThanOrEqual(171);
  });

  it('closes the distance and then holds', async () => {
    const game = await inRoomFour();
    // Column 6 of that row is plain floor. Columns 7 and 8 are loose, and
    // a Prince parked on one of those drops through it, which ends the
    // test for a reason that has nothing to do with guards.
    const STAND = standX(6);
    const hold = (): void => {
      game.kid.room = 4;
      game.kid.currentRow = game.guard.currentRow;
      game.kid.x = STAND;
      game.kid.y = standY(game.guard.currentRow);
      game.kid.fallY = 0;
    };
    hold();
    const startX = game.guard.x;
    for (let i = 0; i < 80; i++) {
      game.step({ x: 0, y: 0, shift: false });
      hold(); // this test is about the guard; keep the Prince put
    }
    expect(game.guard.x).toBeGreaterThan(startX);
    expect(Math.abs(STAND - game.guard.x)).toBeLessThanOrEqual(GUARD_REACH);
  });
});

/**
 * `hurt_by_sword` ends with `play_seq()`, so the first frame of being run
 * through is drawn in the tick the blade lands, not the tick after. The
 * port set the sequence and left the frame for the next tick, which put
 * the whole of the Prince's death a tick behind the original's: six
 * ticks of the capture of `probeF`, from the blow to the body coming to
 * rest.
 */
describe('a blow that lands', () => {
  it('changes the frame in the tick it lands in', async () => {
    const game = await Game.start(assets, exe, 1);
    game.clearBottomText();
    game.showRoom(3);
    const guard = game.guard;
    const kid = game.kid;
    kid.room = 3;
    kid.currentRow = guard.currentRow;
    kid.currentColumn = guard.currentColumn - 4;
    kid.x = standX(kid.currentColumn);
    kid.y = standY(kid.currentRow);
    const was = kid.frame;
    let hit = -1;
    for (let i = 0; i < 120 && hit < 0; i++) {
      game.step({ x: 0, y: 0, shift: false });
      if (game.hitPoints < 3) hit = i;
    }
    expect(hit, 'the guard gets him in the end').toBeGreaterThan(0);
    // The tick the hit points come off is the tick he is already on his
    // way down -- not still standing as he was.
    expect(kid.frame).not.toBe(was);
    expect(kid.frame).toBeGreaterThanOrEqual(170);
  });
});
