/**
 * The Prince running, compared with the original frame by frame.
 *
 * tests/golden/level3-run holds eleven frames captured from PRINCE.EXE while
 * the Right key was held on level 3. The port is given the same input and
 * every simulated frame is rendered; each capture then has to be reproduced
 * by one of them, pixel for pixel -- the whole 320x200 screen, the hit point
 * markers below the room included.
 *
 * The one allowance is torch flames. The original picks each flame's phase
 * at random when a room is entered and mostly advances it by one per tick,
 * so no simulation can be expected to agree on it. Differences inside a
 * flame's box are therefore ignored -- and only there. Everything else, the
 * Prince included, must match exactly.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { GAME_DIR, GOLDEN_DIR, diffClusters, toCaptureSpace } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { TILE } from '../../src/game/tiles.ts';

const RUN_DIR = join(GOLDEN_DIR, 'level3-run');
const LEVEL = 3;
/** The oracle let the entry turn finish, then held Right. */
const STILL_FRAMES = 12;
const TIMELINE_LENGTH = 90;

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

interface Step { step: number; rgb: Uint8Array; room: number; state: string }

let timeline: Step[] = [];
let flameBoxesOf: (room: number) => { x0: number; y0: number; x1: number; y1: number }[];

beforeAll(async () => {
  const game = await Game.start(assets, exe, LEVEL);
  game.clearBottomText();

  flameBoxesOf = (room) => {
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const add = (column: number, row: number): void => {
      const drawX = column * 32;
      const mainY = 63 * row + 65 - 3;
      out.push({ x0: drawX + 6, y0: mainY - 60, x1: drawX + 26, y1: mainY - 38 });
    };
    const isTorch = (t: number) => t === TILE.torch || t === TILE.torchWithDebris;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 10; c++) {
        if (isTorch(game.scene.tiles.typeAt(room, c, r))) add(c + 1, r);
      }
      const left = game.scene.tiles.linkOf(room, 0);
      if (left && isTorch(game.scene.tiles.typeAt(left, 9, r))) add(0, r);
    }
    return out;
  };

  timeline = [];
  for (let step = 0; step < TIMELINE_LENGTH; step++) {
    game.step(step < STILL_FRAMES
      ? { x: 0, y: 0, shift: false }
      : { x: 1, y: 0, shift: false });
    const full = toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()));
    timeline.push({
      step,
      rgb: full.slice(0, 320 * 200 * 3),
      room: game.drawnRoom,
      state: `frame ${game.kid.frame} room ${game.kid.room} x ${game.kid.x}`,
    });
  }
}, 120000);

function captureRgb(file: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(join(RUN_DIR, file)));
  const rgb = new Uint8Array(320 * 200 * 3);
  for (let i = 0; i < 320 * 200; i++) {
    rgb[i * 3] = png.data[i * 4];
    rgb[i * 3 + 1] = png.data[i * 4 + 1];
    rgb[i * 3 + 2] = png.data[i * 4 + 2];
  }
  return rgb;
}

/** The step that reproduces a capture everywhere except inside a flame. */
function matchingStep(file: string): Step | null {
  const want = captureRgb(file);
  for (const t of timeline) {
    const boxes = flameBoxesOf(t.room);
    const outside = diffClusters(t.rgb, want, 320, 200)
      .filter((c) => !boxes.some(
        (b) => c.x0 >= b.x0 && c.x1 <= b.x1 && c.y0 >= b.y0 && c.y1 <= b.y1,
      ))
      .reduce((a, c) => a + c.count, 0);
    if (outside === 0) return t;
  }
  return null;
}

/**
 * Which simulated frame reproduces each capture. Pinned, so that a change to
 * the engine that shifts the timing shows up here.
 *
 * All eleven are reproduced. The last three used to be put down to the view
 * not following the Prince out of the room; they were in fact the missing
 * bump -- the original stops him at the wall at the far end of room 12 and
 * the port ran him through it. See `checkBumped` in src/game/kid.ts.
 *
 * Those same three moved a tick earlier when `checkBumped` was rewritten
 * to the original's own `check_collisions`, which reports a bump on the
 * tick the character's edge first crosses the face of the wall rather
 * than on the tick after. All three are still reproduced exactly; it is
 * the step they are reproduced on that moved.
 */
const EXPECTED: Record<string, number | null> = {
  'run00.png': 8,
  'run01.png': 8,
  'run02.png': 17,
  'run03.png': 23,
  'run04.png': 30,
  'run05.png': 35,
  'run06.png': 41,
  'run07.png': 48,
  'run08.png': 54,
  'run09.png': 60,
  'run10.png': 61,
};

describe('running, against the original', () => {
  it('has eleven captured frames to compare against', () => {
    expect(readdirSync(RUN_DIR).filter((f) => f.endsWith('.png')).sort())
      .toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))('%s', (file, expected) => {
    const found = matchingStep(file);
    expect(found?.step ?? null).toBe(expected);
  });

  it('the frames of the run are reproduced in the order they were captured', () => {
    const order = [
      'run02.png', 'run03.png', 'run04.png', 'run05.png', 'run06.png',
      'run07.png', 'run08.png', 'run09.png', 'run10.png',
    ].map((f) => matchingStep(f)?.step ?? -1);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it('reproduces the run across a room boundary', () => {
    // run04 is still in the starting room, run05 is in the next one.
    expect(matchingStep('run04.png')?.room).toBe(9);
    expect(matchingStep('run05.png')?.room).toBe(12);
  });
});
