/**
 * The two levels that are left by something other than their door.
 *
 * Level 6 is left by falling out of the bottom of room 1: `leave_room`
 * answers -2 there and nowhere else, and `play_frame` moves on.
 * Level 12 is left at a run, by reaching room 23, which also sets
 * `seamless` -- the flag that tells `do_startpos` to leave his
 * strength alone and the frame not to announce a new level.
 *
 * The translation had neither, so level 6 could not be fallen out of
 * and level 12 could not be run out of.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { play_frame } from '../../src/pop/seg000.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('the way out of level 12', () => {
  it('is room 23, at a run, and it is seamless', async () => {
    await PopGame.start(assets, exe, 12);
    const was = g.next_level;
    expect(g.seamless).toBe(0);
    g.Kid.room = 23;
    play_frame();
    expect(g.next_level).toBe(was + 1);
    expect(g.seamless).toBe(1);
  });

  it('is not any other room of it', async () => {
    await PopGame.start(assets, exe, 12);
    const was = g.next_level;
    g.Kid.room = 22;
    play_frame();
    expect(g.next_level).toBe(was);
    expect(g.seamless).toBe(0);
  });

  it('is not room 23 of another level', async () => {
    await PopGame.start(assets, exe, 11);
    const was = g.next_level;
    g.Kid.room = 23;
    play_frame();
    expect(g.next_level).toBe(was);
    expect(g.seamless).toBe(0);
  });
});
