/**
 * The demo level, which the title falls into.
 *
 * `show_title` ends in `init_game(0)`: level 0 of `LEVELS.DAT` plays
 * itself from `demo_moves` in `PRINCE.EXE`, the Prince fights the
 * guard of room 4 and runs out into room 24, and the game goes back
 * to the title. Nothing of that was in the port, and no capture can
 * see any of it -- every recording is one level of an ordinary run.
 *
 * Nothing here is invented: the level is `LEVELS.DAT`'s own resource
 * 2000, and the timeline, the hit points and the end room all come
 * out of the executable.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { set_seed } from '../../src/pop/seg009.ts';
import { readExeConstants } from '../../src/game/exe-constants.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

interface Run {
  rooms: number[];
  ticks: number;
  finished: boolean;
  restarted: boolean;
  died: boolean;
}

/** Play the demo out on a fixed seed. */
async function playDemo(seed: number, limit = 2000): Promise<Run> {
  const game = await PopGame.start(assets, exe, 0);
  set_seed(seed);
  const rooms: number[] = [];
  let ticks = 0;
  for (; ticks < limit; ticks++) {
    game.step({ x: 0, y: 0, shift: false });
    // `draw_game_frame` is where the C counts the bottom text down
    // and starts the game again when it expires, so a run that never
    // draws never sees the demo end.
    game.render();
    if (rooms[rooms.length - 1] !== g.Kid.room) rooms.push(g.Kid.room);
    if (game.demoFinished || game.restartGameDue) break;
  }
  return {
    rooms, ticks,
    finished: game.demoFinished,
    restarted: game.restartGameDue,
    died: g.hitp_curr === 0,
  };
}

describe('demo_moves', () => {
  it('is read out of PRINCE.EXE and nowhere else', () => {
    const { demoMoves, demoHitPoints, demoEndRoom } = readExeConstants(exe);
    // `auto_move_type demo_moves[25]`, at 0x1B8EE of the 123 335-byte
    // release -- the same offset SDLPoP's `options.c` reads it from.
    expect(demoMoves.length).toBe(25);
    expect(demoMoves[0]).toEqual([0, 0]);
    expect(demoMoves[1]).toEqual([1, 1]);
    // The last pair is a time of 0xE9 and a move of -1, which
    // `do_auto_moves` reads as "do nothing at all".
    expect(demoMoves[24]).toEqual([0xE9, -1]);
    // The times only ever go up, which is what `do_auto_moves`
    // walking the table one entry at a time depends on.
    for (let i = 1; i < demoMoves.length; i++) {
      expect(demoMoves[i][0]).toBeGreaterThan(demoMoves[i - 1][0]);
    }
    // `custom->demo_hitp` and `custom->demo_end_room`.
    expect(demoHitPoints).toBe(4);
    expect(demoEndRoom).toBe(24);
  });
});

describe('the demo level', () => {
  it('starts with the demo\'s own four flasks, not the game\'s three', async () => {
    const game = await PopGame.start(assets, exe, 0);
    expect(game.isDemo).toBe(true);
    // `do_startpos`: `x = current_level != 0 ? hitp_beg_lev : demo_hitp`.
    expect(g.hitp_curr).toBe(4);
    expect(g.hitp_max).toBe(4);
    // `have_sword = (level_number == 0 || level_number >= 2)`.
    expect(game.hasSword).toBe(true);
    // `level.start_room`, out of LEVELS.DAT's resource for level 0.
    expect(g.Kid.room).toBe(1);
  });

  it('plays itself along the recorded timeline, with nothing pressed',
    async () => {
      // Every seed takes the same path to the guard: the moves are a
      // recording and nothing random happens before the fight.
      for (const seed of [1, 2, 3]) {
        const run = await playDemo(seed);
        // Room 1, left into room 2, over the gap and left again into
        // room 4, where the guard is.
        expect(run.rooms.slice(0, 3)).toEqual([1, 2, 4]);
      }
    }, 60000);

  it('reaches room 24 when the Prince wins the fight', async () => {
    // The fight is `autocontrol_opponent` and reads `prandom`, so the
    // Prince wins some runs and loses others -- which is the C, whose
    // seed is the clock. Seed 4 * 7919 + 1 is one he wins.
    const run = await playDemo(4 * 7919 + 1);
    expect(run.finished).toBe(true);
    // `on_guard_killed` sets `checkpoint` on level 0, and from there
    // `do_demo` just runs him forward out of the room.
    expect(g.checkpoint).toBe(1);
    expect(g.guardhp_curr).toBe(0);
    // `demo_end_room`, which is what `play_frame` watches for.
    expect(run.rooms[run.rooms.length - 1]).toBe(24);
  }, 60000);

  it('goes back to the title when the Prince loses it', async () => {
    // Seed 1 is a run he loses. A death on level 0 is
    // `text_time_total = 36` and no `Press Button to Continue`, and
    // the text expiring is `start_level = -1; start_game()`.
    const run = await playDemo(1);
    expect(run.died).toBe(true);
    expect(run.finished).toBe(false);
    expect(run.restarted).toBe(true);
    expect(g.text_time_total).toBe(36);
  }, 60000);

  it('never leaves the page sitting on a dead Prince', async () => {
    // Either way out, within a minute and a half of game time.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const run = await playDemo(seed * 7919 + 1);
      expect(run.finished || run.restarted, `seed ${seed} ended`).toBe(true);
      expect(run.ticks).toBeLessThan(1100);
    }
  }, 120000);
});

describe('`Press Button to Continue`, left unanswered', () => {
  it('goes back to the title after its 288 ticks', async () => {
    const game = await PopGame.start(assets, exe, 1);
    // Let the level open, then kill him where he stands: `play_kid`
    // puts the words up a few ticks later and `text_time_total` is
    // their 288.
    for (let i = 0; i < 40; i++) { game.step({ x: 0, y: 0, shift: false }); game.render(); }
    g.hitp_curr = 0;
    let ticks = 0;
    for (; ticks < 1000 && !game.restartGameDue; ticks++) {
      game.step({ x: 0, y: 0, shift: false });
      game.render();
    }
    expect(game.restartGameDue).toBe(true);
    expect(g.text_time_total).toBe(288);
    // The words come up a few ticks after the death and stay 288.
    expect(ticks).toBeGreaterThan(288);
    expect(ticks).toBeLessThan(400);
  }, 60000);
});
