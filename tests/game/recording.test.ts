/**
 * Recordings made in the browser, replayed.
 *
 * The page can record every key of a session and save it as a file. The
 * game is deterministic, so feeding those keys back in has to reproduce
 * the states the page recorded alongside them, tick for tick. That makes a
 * recording two things at once: an account of a real session that can be
 * looked at, and a regression test that fails if the engine stops doing
 * what it did when the recording was made.
 *
 * Drop a file in `tests/recordings/` and it is replayed by this, with
 * nothing else to write.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, REPO } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import {
  encodeTimeline, decodeTimeline, parseRecording, tokenOf, controlsOf,
} from '../../src/game/recording.ts';
import type { Controls } from '../../src/game/control-latch.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const RECORDINGS = join(REPO, 'tests', 'recordings');

describe('the recording format', () => {
  it('writes every combination of keys and reads it back', () => {
    const all: Controls[] = [];
    for (const x of [-1, 0, 1]) {
      for (const y of [-1, 0, 1]) {
        for (const shift of [false, true]) all.push({ x, y, shift });
      }
    }
    expect(new Set(all.map(tokenOf)).size).toBe(all.length);
    for (const c of all) expect(controlsOf(tokenOf(c))).toEqual(c);
    expect(decodeTimeline(encodeTimeline(all))).toEqual(all);
  });

  it('runs equal ticks together', () => {
    const ticks = [
      ...Array<Controls>(12).fill({ x: 0, y: 0, shift: false }),
      ...Array<Controls>(3).fill({ x: 1, y: 0, shift: false }),
      { x: 1, y: -1, shift: true },
    ];
    expect(encodeTimeline(ticks)).toBe('12.,3r,1rus');
    expect(decodeTimeline('12.,3r,1rus')).toEqual(ticks);
  });

  it('refuses something that is not a recording', () => {
    expect(() => parseRecording('{"format":"something else"}')).toThrow();
    expect(() => parseRecording('{}')).toThrow();
  });
});

const files = existsSync(RECORDINGS)
  ? readdirSync(RECORDINGS).filter((f) => f.endsWith('.json')).sort()
  : [];

describe.skipIf(files.length === 0)('recorded sessions, replayed', () => {
  for (const file of files) {
    it(`${file} replays to the states it recorded`, async () => {
      const rec = parseRecording(readFileSync(join(RECORDINGS, file), 'utf8'));
      const ticks = decodeTimeline(rec.timeline);
      expect(ticks.length).toBeGreaterThan(0);
      if (rec.states.length === 0) return; // nothing to check it against
      const game = await Game.start(assets, exe, rec.level);
      for (let t = 0; t < ticks.length; t++) {
        game.step(ticks[t]);
        const want = rec.states[t];
        if (!want) continue;
        const got = {
          tick: t,
          frame: game.kid.frame,
          room: game.kid.room,
          x: game.kid.x,
          y: game.kid.y,
          hitPoints: game.hitPoints,
        };
        expect(got, `${file} disagrees at tick ${t}`).toEqual(want);
      }
    }, 120000);
  }
});
