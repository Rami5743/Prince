/**
 * Walking into the last room of the last level ends the game.
 *
 * `check_the_end` runs `end_sequence()` there. The translation had
 * the rest of that function and not the test, so the Prince walked
 * into the final room and the game simply carried on. A cutscene
 * cannot be run from inside a tick, so the game says it is won and
 * the shell plays the ending -- see `tests/pop/cutscene.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { check_the_end } from '../../src/pop/seg000.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('the end of the game', () => {
  it('is the last room of the last level', async () => {
    const game = await PopGame.start(assets, exe, 14);
    expect(game.gameWon).toBe(false);
    g.next_room = 5;
    g.drawn_room = 1;
    check_the_end();
    expect(game.gameWon).toBe(true);
  });

  it('is not any other room of that level', async () => {
    const game = await PopGame.start(assets, exe, 14);
    g.next_room = 4;
    g.drawn_room = 1;
    check_the_end();
    expect(game.gameWon).toBe(false);
  });

  it('is not the same room on another level', async () => {
    const game = await PopGame.start(assets, exe, 3);
    g.next_room = 5;
    g.drawn_room = 1;
    check_the_end();
    expect(game.gameWon).toBe(false);
  });
});
