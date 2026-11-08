/**
 * Every recording the player sends, replayed, with the invariants held
 * against it.
 *
 * This file exists because of a question he asked, and the question was
 * fair. A recording of his turned up with the guard of room 3 arriving
 * in room 2 at column 19, wrapping to column -2 and killing the Prince
 * from three tiles away through a wall -- and the whole suite passed,
 * because the one test of that code asserted the arithmetic the code
 * happened to do rather than the thing that had to be true.
 *
 * So: the recordings are replayed here, and what is checked is not what
 * the port does but what no version of the game may do. A recording that
 * is in `tools/oracle/recordings` is covered from the moment it is put
 * there; nothing has to be written for it.
 *
 * It does not check that the run matches the original -- that is what the
 * DOSBox oracle is for, and it needs a capture. It checks that the run is
 * not nonsense.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame as Game } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { TILE, tileIsFloor } from '../../src/game/tiles.ts';
import { ACTION } from '../../src/game/sequence.ts';
import { standY } from '../../src/game/geometry.ts';
/**
 * `dir_56_none`, the C's own name for it: 0x56, not the decimal 56 the
 * hand-written port read it as.
 */
const NO_DIRECTION = 0x56;

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
/** The most a guard can move in one tick without a door being involved. */
const GUARD_STRIDE = 12;

const DIR = join(import.meta.dirname, '..', '..', 'tools', 'oracle', 'recordings');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')) : [];

describe('the recordings, replayed', () => {
  it('there are some', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} breaks none of the rules`, async () => {
      const rec = parseRecording(readFileSync(join(DIR, file), 'utf8'));
      const ticks = decodeTimeline(rec.timeline);
      let game = await Game.start(assets, exe, rec.level);
      const bad: string[] = [];
      const say = (t: number, m: string) => {
        if (bad.length < 6) bad.push(`tick ${t}: ${m}`);
      };
      let was: { room: number; row: number; column: number } | null = null;
      let wasGuard: { room: number; x: number; direction: number } | null = null;
      let dead: { t: number; frame: number; x: number; y: number } | null = null;
      let resting: { frame: number; x: number; y: number } | null = null;
      for (let t = 0; t < ticks.length; t++) {
        // The page restarts the level when a button is pressed after a
        // death, and so does the recorder.
        if (ticks[t].shift && !ticks[t - 1]?.shift) game.pressButton();
        game.step(ticks[t]);
        if (game.restartDue) {
          game = await game.restart(assets, exe);
          was = null;
          wasGuard = null;
          dead = null;
          resting = null;
          continue;
        }

        // A guard in play is in the room being drawn, on it, and his feet
        // are on one of its three rows.
        const guard = game.guard;
        if (guard.direction !== NO_DIRECTION) {
          if (guard.room !== game.drawnRoom) {
            say(t, `the guard is in room ${guard.room} and room `
              + `${game.drawnRoom} is on the screen`);
          }
          // A guard who has just come through a door is beyond the edge
          // of the room he arrived in and walks the rest of the way: the
          // original's own thresholds put him anywhere from three tiles
          // short of it to two past it. Outside that he is nowhere.
          if (guard.curr_col < -4 || guard.curr_col > 13) {
            say(t, `the guard is at column ${guard.curr_col}`);
          }
          if (guard.curr_row < 0 || guard.curr_row > 2) {
            say(t, `the guard is on row ${guard.curr_row}`);
          }
          // And he got where he is by walking or by stepping through a
          // door. A stride is a few units; a door is the width of a room,
          // a hundred and forty, and the room changes with it. Anything
          // else is a guard who has been moved by arithmetic that went
          // wrong -- which is how the one in `33e8ace7` crossed room 2.
          // Not on the tick he turned round. `Char.x` is measured from
          // the direction a character faces, so `SEQ_FLIP` re-expresses
          // it -- a guard standing on the spot and turning has his x
          // moved by the width of his own frame without going anywhere.
          if (wasGuard !== null && guard.direction === wasGuard.direction) {
            const moved = (guard.x - wasGuard.x) & 0xff;
            if (guard.room === wasGuard.room) {
              if (moved > GUARD_STRIDE && moved < 256 - GUARD_STRIDE) {
                say(t, `the guard moved ${((moved + 128) & 0xff) - 128} units `
                  + `in one tick, inside room ${guard.room}`);
              }
            } else {
              // A door, and whatever stride he took in the same tick
              // before going through it. Counted the way x itself counts,
              // round the byte.
              const apart = (a: number, b: number): number => {
                const d = Math.abs(a - b);
                return Math.min(d, 256 - d);
              };
              const over = Math.min(apart(moved, 140), apart(moved, 256 - 140));
              if (over > GUARD_STRIDE) {
                say(t, `the guard went from room ${wasGuard.room} to `
                  + `${guard.room} and his x moved by ${moved}, `
                  + 'which is not a door and a step');
              }
            }
          }
          wasGuard = { room: guard.room, x: guard.x, direction: guard.direction };
        } else {
          wasGuard = null;
        }

        const kid = game.kid;
        if (game.isDead) {
          // A death takes every hit point, settles on one of the bodies
          // the original draws, and then nothing about it moves again.
          if (game.hitPoints !== 0) {
            say(t, `dead with ${game.hitPoints} hit points left`);
          }
          dead = dead === null ? { t, frame: kid.frame, x: kid.x, y: kid.y } : dead;
          if (t > dead.t + 20) {
            const BODIES = [177, 178, 185, 106];
            if (!BODIES.includes(kid.frame)) {
              say(t, `dead on frame ${kid.frame}, which is not a body`);
            }
            // Unless he fell out of the level: room 0 is not a room, it
            // has no floor, and the original goes on dropping the body
            // through it for as long as the level lasts. Nobody sees it.
            if (kid.room === 0) resting = null;
            else if (resting === null) resting = { frame: kid.frame, x: kid.x, y: kid.y };
            else if (resting.frame !== kid.frame || resting.x !== kid.x
              || resting.y !== kid.y) {
              say(t, `the body moved: frame ${resting.frame} at ${resting.x},`
                + `${resting.y} became frame ${kid.frame} at ${kid.x},${kid.y}`);
              resting = { frame: kid.frame, x: kid.x, y: kid.y };
            }
          }
        } else {
          dead = null;
          resting = null;
        }
        if (kid.alive >= 0 || kid.room === 0) { was = null; continue; }
        // Not on the tick the room changed. `goto_other_room` moves `x`
        // across and leaves `curr_col` as it was; the original reads the
        // column off the new x at the top of the *next* frame, in
        // `load_fram_det_col`, so for one tick the two disagree and the
        // Prince appears to be standing in whatever the old column holds
        // in the new room.
        if (was !== null && was.room !== kid.room) { was = null; continue; }
        const walking = kid.frame === 15 || (kid.frame >= 1 && kid.frame <= 14);
        const onFloor = kid.y === standY(kid.curr_row)
          && kid.curr_col >= 0 && kid.curr_col <= 9
          && kid.action !== ACTION.hangClimb && kid.action !== ACTION.hangStraight;
        if (onFloor) {
          const here = game.scene.state.typeAt(kid.room, kid.curr_col, kid.curr_row);
          if (walking && here === TILE.wall) say(t, 'the Prince is standing in a wall');
          if (kid.frame === 15 && !tileIsFloor(here) && here !== TILE.wall) {
            say(t, `the Prince is standing on tile ${here}`);
          }
        }
        const now = { room: kid.room, row: kid.curr_row, column: kid.curr_col };
        if (was && now.room === was.room && now.row === was.row
          && now.column !== was.column) {
          const lo = Math.min(now.column, was.column);
          const hi = Math.max(now.column, was.column);
          for (let c = lo + 1; c < hi; c++) {
            if (c < 0 || c > 9) continue;
            if (game.scene.state.typeAt(now.room, c, now.row) === TILE.wall) {
              say(t, `the Prince went from column ${was.column} to ${now.column} `
                + `across the wall at ${c}`);
              break;
            }
          }
        }
        was = now;
      }
      expect(bad).toEqual([]);
    }, 60000);
  }
});
