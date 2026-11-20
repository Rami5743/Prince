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

/**
 * Every `tiles_10_potion` of a level, with the kind `do_pickup` reads.
 *
 * `1 .. used_rooms`, which is the walk `alter_mods_allrm` makes and
 * so the only rooms whose modifier byte means anything:
 *
 *     if (level.used_rooms > 24) level.used_rooms = 24;
 *     for (word room = 1; room <= level.used_rooms; room++) { ... }
 *
 * Eleven of the sixteen records say 25 and are capped to 24, but
 * **level 10 says 21, level 14 says 7 and level 15 says 9**, and the
 * rooms past the count keep whatever raw byte the file has -- level
 * 14's rooms 8, 12, 13 and 18 have a potion tile among them, with a
 * raw byte that reads as an inversion once it is shifted and does
 * not once it is left alone.
 *
 * Nothing can reach them, and that is measured rather than assumed:
 * walking `roomlinks` from each level's start room reaches
 * **no room past `used_rooms` on any of the sixteen records**
 * (level 10 reaches 19 of its 21, level 14 six of its 7, level 15
 * six of its 9).
 */
async function potionsOf(level: number): Promise<{ room: number; row: number; col: number; kind: number }[]> {
  const game = await PopGame.start(assets, exe, level);
  const st = game.scene.state;
  const rooms = Math.min(game.scene.level.usedRooms, 24);
  const out: { room: number; row: number; col: number; kind: number }[] = [];
  for (let room = 1; room <= rooms; room++) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 10; col++) {
        if (st.typeAt(room, col, row) !== 10) continue;
        out.push({ room, row, col, kind: st.modifierAt(room, col, row) >> 3 });
      }
    }
  }
  return out;
}

describe('the rooms a level really has', () => {
  /**
   * **`alter_mods_allrm` walks `1 .. used_rooms`, not `1 .. 24`**,
   * and three of the sixteen records say less than 24: level 10
   * says 21, level 14 says 7 and level 15 says 9. The port used to
   * pass a flat 24, so a gate with modifier 1 in one of those rooms
   * became 188 where the original leaves it 1, and a potion was
   * shifted where the original leaves it alone. 47 tiles of level
   * 10 and 278 of level 14 are altered by the difference.
   *
   * It is unobservable in play, and that is the measurement rather
   * than an assumption: walking `roomlinks` from the start room
   * reaches no room past `used_rooms` on any of the sixteen.
   */
  it('never links to a room past used_rooms', async () => {
    for (let level = 0; level <= 15; level++) {
      const game = await PopGame.start(assets, exe, level);
      const { roomLinks, usedRooms, startRoom } = game.scene.level;
      const used = Math.min(usedRooms, 24);
      const seen = new Set<number>([startRoom]);
      const queue = [startRoom];
      while (queue.length) {
        const room = queue.pop()!;
        for (let dir = 0; dir < 4; dir++) {
          const next = roomLinks[(room - 1) * 4 + dir];
          if (next >= 1 && next <= 24 && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].filter((r) => r > used), `level ${level}`).toEqual([]);
    }
  });

  it('says 21 rooms on level 10, 7 on level 14 and 9 on level 15', async () => {
    const used = [];
    for (const level of [10, 14, 15]) {
      used.push((await PopGame.start(assets, exe, level)).scene.level.usedRooms);
    }
    expect(used).toEqual([21, 7, 9]);
  });
});

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

  /**
   * **And "drawn whole" has to mean the room painted out first.**
   *
   * `redraw_screen` is
   * `redraw_room(); is_blind_mode = 1; draw_tables(); is_blind_mode = 0;
   * memset(table_counts, ...); draw_moving(); draw_tables();` and the
   * port had the two `draw_tables` and not the flag. `draw_tables`
   * opens with `if (is_blind_mode) draw_rect(&rect_top,
   * color_0_black)`, so the flag held up for that one call is the
   * only thing in `redraw_screen(0)` that blacks the room --
   * `redraw_room` fills the tables and `tiles_0_empty` draws nothing,
   * so the open air of a room is never painted over.
   *
   * Without it the flip tick redrew the room around whoever was
   * standing in it, and `redraw_room`'s own `free_peels()` had just
   * thrown away the rectangle that would have rubbed him out -- so
   * the next `add_peel` read his pixels as the background and put
   * them back the moment he moved. The round that put
   * `need_redraw_because_flipped` in measured `shift+i` with the
   * Prince **standing still**, which is the one case that cannot
   * show it, and wrote down "no tick differs, not one pixel".
   *
   * Measured again with him walking -- `shift+i` on tick 60, Right
   * held throughout, the picture at rest against the room drawn
   * whole -- the pixels left behind were
   *
   *     level  1   2   9  13
   *     walking   45  92  39  92
   *     standing   0   0   0   0
   *
   * so it was never the potion level's and never the dungeon's:
   * level 9, where the player says he did not meet it, had it too.
   */
  it('leaves nobody behind when the screen turns over while he walks', async () => {
    for (const level of [1, 2, 9, 13]) {
      const game = await PopGame.start(assets, exe, level);
      let last = new Uint8Array(320 * 200 * 3);
      const step = (x: number): void => {
        game.step({ x, y: 0, shift: false });
        last = new Uint8Array(game.render().toRgb(game.scene.screenPalette.toRgba()));
      };
      for (let t = 0; t < 60; t++) step(1);
      game.cheat('shift+i');
      for (let t = 0; t < 40; t++) step(1);
      for (let t = 0; t < 12; t++) step(0); // and come to rest
      const priv = game as unknown as { needFullRedraw: boolean; fullRedrawClears: boolean };
      priv.needFullRedraw = true;
      priv.fullRedrawClears = true;
      const whole = new Uint8Array(game.render().toRgb(game.scene.screenPalette.toRgba()));
      let n = 0;
      for (let i = 0; i < 320 * 192; i++) {
        if (last[i * 3] !== whole[i * 3] || last[i * 3 + 1] !== whole[i * 3 + 1]
          || last[i * 3 + 2] !== whole[i * 3 + 2]) n++;
      }
      expect(n, `level ${level}`).toBe(0);
    }
  }, 60000);

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
