/**
 * The Prince's reflection in the mirror of level 4.
 *
 * `check_mirror` has two halves. One deals with the tick he jumps
 * through the glass; the other runs every tick he stands on the
 * mirror tile, works out where the glass would show him, and adds
 * that to the object table clipped to the frame of the mirror. The
 * translation had the first half and not the second, so the mirror
 * reflected nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { check_mirror } from '../../src/pop/seg003.ts';
import { l8 } from '../../src/pop/link.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** `tiles_13_mirror`. */
const MIRROR = 13;

describe('the mirror of level 4', () => {
  it('reflects the Prince while he stands in it', async () => {
    await PopGame.start(assets, exe, 4);

    // The mirror is not in the level data: the original puts it there
    // when the Prince runs past, which `seg007` does. For this it is
    // enough to have a mirror tile and the Prince standing on it.
    const room = 1;
    const tilepos = 14; // row 1, column 4
    g.level.fg[(room - 1) * 30 + tilepos] = MIRROR;

    g.drawn_room = room;
    g.Kid.room = room;
    g.Kid.curr_row = Math.trunc(tilepos / 10);
    g.Kid.curr_col = tilepos % 10;
    g.Kid.x = 58 + g.Kid.curr_col * 32 + 10;
    g.Kid.y = 55 + g.Kid.curr_row * 63;
    g.Kid.frame = 15; // standing
    g.Kid.direction = -1;
    // `check_mirror` runs where `Char` is already the Prince, as
    // `draw_game_frame` leaves him.
    Object.assign(g.Char, g.Kid);
    g.jumped_through_mirror = 0;

    const added: number[] = [];
    const real = l8.add_objtable.fn;
    l8.add_objtable.fn = (kind: number) => { added.push(kind); };
    try {
      check_mirror();
    } finally {
      l8.add_objtable.fn = real;
    }

    // `add_objtable(4)`: the mirror image.
    expect(added).toContain(4);
  });

  it('adds nothing when he is not on the mirror tile', async () => {
    await PopGame.start(assets, exe, 4);
    g.jumped_through_mirror = 0;
    g.Kid.curr_col = 0;
    g.Kid.curr_row = 0;
    Object.assign(g.Char, g.Kid);

    const added: number[] = [];
    const real = l8.add_objtable.fn;
    l8.add_objtable.fn = (kind: number) => { added.push(kind); };
    try {
      check_mirror();
    } finally {
      l8.add_objtable.fn = real;
    }
    expect(added).toEqual([]);
  });
});
