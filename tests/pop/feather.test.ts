/**
 * The green potion, which is supposed to make him fall like a feather.
 *
 * `proc_get_object` set `is_feather_fall`, played the sound and
 * flashed the screen green, and the only other reader of the flag was
 * the jump-if-feather in `play_seq`. Falling itself ignored it, so the
 * one thing the potion is for never happened: a feather gathers one
 * to the fall each tick instead of three, and never goes faster than
 * four.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { fall_accel } from '../../src/pop/seg006.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** `actions_4_in_freefall`. */
const IN_FREEFALL = 4;

function speedsOver(ticks: number): number[] {
  const out: number[] = [];
  g.Char.action = IN_FREEFALL;
  g.Char.fall_y = 0;
  for (let i = 0; i < ticks; i++) { fall_accel(); out.push(g.Char.fall_y); }
  return out;
}

describe('falling', () => {
  it('gathers three a tick and stops at thirty-three', async () => {
    await PopGame.start(assets, exe, 1);
    g.is_feather_fall = 0;
    const speeds = speedsOver(20);
    expect(speeds.slice(0, 4)).toEqual([3, 6, 9, 12]);
    expect(Math.max(...speeds)).toBe(33);
  });

  it('gathers one a tick and stops at four with the feather', async () => {
    await PopGame.start(assets, exe, 1);
    g.is_feather_fall = 1;
    const speeds = speedsOver(20);
    expect(speeds.slice(0, 4)).toEqual([1, 2, 3, 4]);
    expect(Math.max(...speeds)).toBe(4);
  });

  it('does nothing to a character who is not in freefall', async () => {
    await PopGame.start(assets, exe, 1);
    g.is_feather_fall = 0;
    g.Char.action = 0;
    g.Char.fall_y = 0;
    fall_accel();
    expect(g.Char.fall_y).toBe(0);
  });
});
