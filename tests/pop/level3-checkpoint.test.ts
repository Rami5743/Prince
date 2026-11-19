/**
 * Level 3's checkpoint, which never worked.
 *
 * The player reported it: die after the big jump and the game puts
 * you back at the top of the level instead of just past it.
 *
 * `do_startpos` opens on
 * `if (current_level == 3 && checkpoint) { start_room = 2;
 * start_pos = 6; ... }` and also takes the loose floor at row 0
 * column 4 of room 7 away. `level3_set_chkp` sets `checkpoint` when
 * the Prince leaves room 7 to the left, and that part was right.
 *
 * **What was wrong was the order.** In the C there is no restart:
 * `play_level`'s own loop goes back to `start_level` with every
 * global where it stood. Here a restart is a fresh `PopGame` with
 * fresh globals, and `PopGame.restart` carried `checkpoint` across
 * *after* `PopGame.start` had already run `startLevel()` -- so
 * `do_startpos` had read a zero every time. `hitp_beg_lev` was the
 * same fault and had been papered over with a patch applied
 * afterwards; the carried set goes in before `startLevel` now and
 * the patch is gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { level3_set_chkp } from '../../src/pop/seg002.ts';
import { tiles } from '../../src/pop/types.ts';
import { get_tile } from '../../src/pop/seg006.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe("level 3's checkpoint", () => {
  it('starts at the top of the level with no checkpoint', async () => {
    await PopGame.start(assets, exe, 3);
    expect(g.checkpoint).toBe(0);
    expect(g.Kid.room).toBe(g.level.start_room);
    expect(g.Kid.room).not.toBe(2);
  });

  it('`level3_set_chkp` fires on leaving room 7 to the left', async () => {
    await PopGame.start(assets, exe, 3);
    g.Char.room = 7;
    g.hitp_max = 2;
    level3_set_chkp();
    expect(g.checkpoint).toBe(1);
    // `hitp_beg_lev = hitp_max`: the level begins again with what he
    // had when he passed the checkpoint, not with the three he came
    // into the level on.
    expect(g.hitp_beg_lev).toBe(2);
  });

  it('does not fire in another room, or on another level', async () => {
    await PopGame.start(assets, exe, 3);
    g.Char.room = 6;
    level3_set_chkp();
    expect(g.checkpoint).toBe(0);
    await PopGame.start(assets, exe, 4);
    g.Char.room = 7;
    level3_set_chkp();
    expect(g.checkpoint).toBe(0);
  });

  it('restarts past the big jump once the checkpoint is set', async () => {
    const first = await PopGame.start(assets, exe, 3);
    const startRoom = g.level.start_room;
    g.Char.room = 7;
    g.hitp_max = 2;
    level3_set_chkp();
    g.rem_min = 57;
    g.rem_tick = 400;
    await first.restart(assets, exe);
    // `do_startpos`'s own three lines, which it only reaches with
    // `checkpoint` set.
    expect(g.checkpoint).toBe(1);
    expect(g.Kid.room).toBe(2);
    expect(g.Kid.room).not.toBe(startRoom);
    expect(g.level.start_pos).toBe(6);
    expect(g.level.start_dir).toBe(-1); // dir_FF_left
    // "Special event: the loose floor is gone."
    get_tile(7, 4, 0);
    expect(g.curr_room_tiles[g.curr_tilepos]).toBe(tiles.tiles_0_empty);
    // And the flasks he passed the checkpoint with, not the level's.
    expect(g.hitp_beg_lev).toBe(2);
    expect(g.hitp_max).toBe(2);
    expect(g.hitp_curr).toBe(2);
    // The hour is still the hour: `init_game` runs once.
    expect(g.rem_min).toBe(57);
    expect(g.rem_tick).toBe(400);
  });
});
