/**
 * The two potions nothing had ever drunk: the feather and the
 * inversion.
 *
 * `potion8` drinks level 8's, which is the one that **hurts**, and it
 * is the only potion in the suite. The green one and the
 * upside-down one were written out of the C with no capture and no
 * test behind them, and both had a line missing.
 *
 * Where they are, measured off `LEVELS.DAT` (`tiles_10_potion` with
 * `curr_room_modif >> 3` for the kind):
 *
 *     feather     level  7 room  1 row 2 col 8, modifier 27  -- the only one
 *     inversion   level  9 room  7 row 1 col 7, modifier 32
 *                 level  9 room 10 row 0 col 4, modifier 32  -- the only two
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { out } from '../../src/pop/link.ts';
import { proc_get_object } from '../../src/pop/seg006.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Every `tiles_10_potion` of a level, with the kind `do_pickup` reads. */
async function potionsOf(level: number): Promise<{ room: number; row: number; col: number; kind: number }[]> {
  const game = await PopGame.start(assets, exe, level);
  const st = game.scene.state;
  const out: { room: number; row: number; col: number; kind: number }[] = [];
  for (let room = 1; room <= 24; room++) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 10; col++) {
        if (st.typeAt(room, col, row) !== 10) continue;
        out.push({ room, row, col, kind: st.modifierAt(room, col, row) >> 3 });
      }
    }
  }
  return out;
}

describe('where the potions are', () => {
  it('puts the two inversion potions in level 9, and no others anywhere', async () => {
    const nine = (await potionsOf(9)).filter((p) => p.kind === 4);
    expect(nine).toEqual([
      { room: 7, row: 1, col: 7, kind: 4 },
      { room: 10, row: 0, col: 4, kind: 4 },
    ]);
    for (const level of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14]) {
      expect((await potionsOf(level)).filter((p) => p.kind === 4), `level ${level}`).toEqual([]);
    }
  });

  it('puts the one feather potion in level 7, and no others anywhere', async () => {
    expect((await potionsOf(7)).filter((p) => p.kind === 3))
      .toEqual([{ room: 1, row: 2, col: 8, kind: 3 }]);
    for (const level of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]) {
      expect((await potionsOf(level)).filter((p) => p.kind === 3), `level ${level}`).toEqual([]);
    }
  });
});

/**
 * `proc_get_object` case 4 is `toggle_upside();` and nothing else.
 *
 * No `stop_sounds`, no `play_sound`, no flash -- the only potion of
 * the six that makes no noise. And `toggle_upside` (`seg000:15E9`)
 * is two lines, of which the port had one:
 *
 *     upside_down = ~upside_down;
 *     need_redraw_because_flipped = 1;
 */
describe('the inversion potion', () => {
  it('turns the screen over, asks for the redraw, and makes no noise', async () => {
    const game = await PopGame.start(assets, exe, 9);
    for (let i = 0; i < 4; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    const asked: number[] = [];
    const wasPlay = out.play_sound;
    const wasStop = out.stop_sounds;
    let stopped = 0;
    out.play_sound = (which: number) => { asked.push(which); wasPlay(which); };
    out.stop_sounds = () => { stopped += 1; wasStop(); };
    try {
      g.flash_time = 0;
      g.flash_color = 0;
      g.need_redraw_because_flipped = 0;
      g.Char.charid = 0; // charid_0_kid
      g.pickup_obj_type = 4;
      proc_get_object();
    } finally {
      out.play_sound = wasPlay;
      out.stop_sounds = wasStop;
    }
    expect(game.upsideDown, 'the screen is over').toBe(true);
    expect(g.need_redraw_because_flipped, 'and the whole screen is owed').toBe(1);
    expect(asked, 'no sound').toEqual([]);
    expect(stopped, 'and nothing is stopped either').toBe(0);
    expect(g.flash_time, 'and no flash').toBe(0);
  });

  it('spends the flag on the next picture, which is drawn whole', async () => {
    const game = await PopGame.start(assets, exe, 9);
    for (let i = 0; i < 4; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    game.cheat('shift+i');
    game.step({ x: 0, y: 0, shift: false });
    expect(g.need_redraw_because_flipped, 'set by `toggle_upside`').toBe(1);
    game.render();
    expect(g.need_redraw_because_flipped, 'and spent by `draw_game_frame`').toBe(0);
  });

  /**
   * `play_kid_frame`: `if (upside_down && Char.alive >= 0)
   * { upside_down = 0; need_redraw_because_flipped = 1; }`.
   *
   * The port had `need_full_redraw = 1` there, and `need_full_redraw`
   * was a global nothing in `src/` ever read.
   */
  it('puts the screen back when the Prince dies, and asks for the redraw', async () => {
    const game = await PopGame.start(assets, exe, 9);
    for (let i = 0; i < 4; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    game.cheat('shift+i');
    game.step({ x: 0, y: 0, shift: false });
    game.render();
    expect(game.upsideDown).toBe(true);
    g.hitp_curr = 0;
    g.Char.alive = 0;
    g.Kid.alive = 0;
    game.step({ x: 0, y: 0, shift: false });
    expect(game.upsideDown, 'the right way up again').toBe(false);
    expect(g.need_redraw_because_flipped, 'and the whole screen is owed').toBe(1);
  });

  /**
   * `set_start_pos` is `upside_down = custom->start_upside_down`,
   * which is nought, and `play_level` runs it at the top of every
   * level. So the inversion never survives a level door.
   */
  it('does not survive the start of a level', async () => {
    const game = await PopGame.start(assets, exe, 9);
    for (let i = 0; i < 4; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    game.cheat('shift+i');
    game.step({ x: 0, y: 0, shift: false });
    expect(game.upsideDown).toBe(true);
    const next = await PopGame.start(assets, exe, 10);
    expect(next.upsideDown, '`set_start_pos` puts it back').toBe(false);
  });
});

/**
 * The feather's length is a *sound's* length.
 *
 * `timers` (`seg003:0735`) is `if (is_feather_fall) is_feather_fall++;`
 * and then clears the flag the moment `check_sound_playing()` goes
 * quiet or it passes 225. A headless port that hears nothing cleared
 * it on the tick after the potion was drunk, so the feather did
 * nothing at all: on level 7 the Prince takes `shift+w` hanging in
 * room 1, lets go, and is dead on the floor of room 3 with nought
 * hit points.
 */
describe('the feather potion', () => {
  it('lasts as long as sound 39, and brings him down alive', async () => {
    const game = await PopGame.start(assets, exe, 7);
    // Hold Shift to grab the ledge of room 1 on the way down.
    for (let t = 0; t < 12; t++) { game.step({ x: 0, y: 0, shift: true }); game.render(); }
    expect(game.kid.room, 'hanging in room 1').toBe(1);
    expect(game.hitPoints, 'with all three flasks').toBe(3);

    game.cheat('shift+w');
    game.step({ x: 0, y: 0, shift: true });
    game.render();
    expect(g.is_feather_fall, 'the flag is up').toBe(1);
    expect(g.flash_color, 'green').toBe(2);
    expect(g.flash_time, 'for three ticks, counted down by the first picture').toBe(2);

    // Let go and come down.
    for (let t = 0; t < 120; t++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    expect(game.hitPoints, 'he lands alive').toBe(3);
    expect(game.kid.room, 'on the floor of room 3').toBe(3);
    // 223 ticks of `IBM_SND1.DAT`'s sound 39, a couple short of the
    // C's own cap of 225.
    expect(g.is_feather_fall, 'and the feather is still running').toBeGreaterThan(100);
    for (let t = 0; t < 120; t++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    expect(g.is_feather_fall, 'until the sound runs out').toBe(0);
  });

  it('gathers one to the fall a tick instead of three', async () => {
    const slow = await PopGame.start(assets, exe, 7);
    for (let t = 0; t < 12; t++) { slow.step({ x: 0, y: 0, shift: true }); slow.render(); }
    slow.cheat('shift+w');
    for (let t = 0; t < 40; t++) { slow.step({ x: 0, y: 0, shift: false }); slow.render(); }
    const withFeather = slow.kid.room;

    const fast = await PopGame.start(assets, exe, 7);
    for (let t = 0; t < 12; t++) { fast.step({ x: 0, y: 0, shift: true }); fast.render(); }
    for (let t = 0; t < 40; t++) { fast.step({ x: 0, y: 0, shift: false }); fast.render(); }
    expect(fast.hitPoints, 'without it the same drop kills him').toBe(0);
    expect(withFeather, 'with it he is still coming down').toBeGreaterThan(0);
  });
});
