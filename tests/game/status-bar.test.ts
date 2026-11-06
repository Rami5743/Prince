/**
 * The strip below the room.
 *
 * The original draws the Prince's hit points there, as small sprites from
 * his own group: a full marker for each point he has, an empty one for each
 * he has lost. Every captured frame shows three full markers, because the
 * executable says a level starts with three hit points.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, goldenFrame, toCaptureSpace } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const CASES: [number, string][] = [
  [1, 'level01-start.png'],
  [2, 'level02-start.png'],
  [3, 'level03-start.png'],
  [4, 'level04-start.png'],
  [5, 'level05-start.png'],
  [6, 'level06-start.png'],
];

describe('the status bar', () => {
  it.each(CASES)('level %i matches the original', async (level, file) => {
    const game = await Game.start(assets, exe, level);
    const got = toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()));
    const want = goldenFrame(file).rgb;
    let differing = 0;
    for (let y = 192; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 3;
        if (got[i] !== want[i] || got[i + 1] !== want[i + 1] || got[i + 2] !== want[i + 2]) {
          differing++;
        }
      }
    }
    expect(differing).toBe(0);
  });

  it('starts every level with the hit points the executable says', async () => {
    const game = await Game.start(assets, exe, 1);
    expect(game.hitPoints).toBe(3);
    expect(game.maxHitPoints).toBe(3);
    expect(game.hitPoints).toBe(game.scene.constants.startHitPoints);
  });
});
