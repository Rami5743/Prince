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

/**
 * `seamless` is a global in the C: `play_frame` sets it on level 12,
 * `start_level` does not touch it and `show_level` is the only thing
 * that reads and then clears it. Here every level is a fresh
 * `PopGame` whose globals are cleared, so the flag has to be handed
 * across -- and `install` used to write a flat nought over it.
 *
 * Without it level 13 announced `LEVEL 12` under the room, which the
 * original does not do when 13 is run into at speed, and `do_startpos`
 * handed the Prince a fresh set of flasks in the middle of the run.
 */
describe('the level run into carries the flag', () => {
  it('a seamless start says nothing and keeps what he is carrying', async () => {
    const game = await PopGame.start(assets, exe, 13, { seamless: true });
    expect(g.seamless).toBe(0); // `show_level` has read and cleared it
    expect(g.text_time_total).toBe(0); // and said nothing
    // `do_startpos` left his strength alone, so the shell can put the
    // flasks he ran in with back.
    game.carryHitPoints(2, 5);
    expect(g.hitp_curr).toBe(2);
    expect(g.hitp_max).toBe(5);
  });

  it('an ordinary start announces the level', async () => {
    await PopGame.start(assets, exe, 13);
    expect(g.text_time_total).toBe(24);
  });
});
