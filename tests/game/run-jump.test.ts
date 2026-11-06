/**
 * The running jump, compared with the original frame by frame.
 *
 * tests/golden/level3-runjump holds thirteen frames captured from PRINCE.EXE
 * on level 3: Right held until the Prince is running, then Up pressed while
 * he is still running. The emulator was run slowly (--cycles 400) so that
 * consecutive captures are only a tick or two apart; at full speed the whole
 * jump falls between two captures and is never seen.
 *
 * The port is given the same input and every simulated frame is rendered;
 * each capture then has to be reproduced by one of them, pixel for pixel.
 * Torch flames are the one allowance, as in tests/game/run.test.ts: their
 * phase is chosen at random when a room is entered, so differences inside a
 * flame's box are ignored, and only there.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { GAME_DIR, GOLDEN_DIR, diffClusters, toCaptureSpace } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { TILE } from '../../src/game/tiles.ts';

const JUMP_DIR = join(GOLDEN_DIR, 'level3-runjump');
const LEVEL = 3;
/** The oracle let the entry turn finish, then held Right. */
const STILL_FRAMES = 12;
/** The tick Up was pressed on, and how long it was held. */
const UP_AT = 19;
const UP_FOR = 3;
const TIMELINE_LENGTH = 60;

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

interface Step { step: number; rgb: Uint8Array; room: number; state: string }

let timeline: Step[] = [];
let flameBoxesOf: (room: number) => { x0: number; y0: number; x1: number; y1: number }[];

beforeAll(async () => {
  const game = await Game.start(assets, exe, LEVEL);

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
    game.step({
      x: step < STILL_FRAMES ? 0 : 1,
      y: step >= UP_AT && step < UP_AT + UP_FOR ? -1 : 0,
      shift: false,
    });
    const full = toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()));
    timeline.push({
      step,
      rgb: full.slice(0, 320 * 200 * 3),
      room: game.drawnRoom,
      state: `frame ${game.kid.frame} room ${game.kid.room} x ${game.kid.x} y ${game.kid.y}`,
    });
  }
}, 120000);

function captureRgb(file: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(join(JUMP_DIR, file)));
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
 * jump05, jump06 and jump07 are the blank the original shows while it
 * changes room -- black everywhere but the hit points along the bottom.
 * All three fall inside one tick of the port's clock, which is why they
 * reproduce on the same frame: at the speed these were captured, three
 * captures can land inside a single tick.
 */
const EXPECTED: Record<string, number | null> = {
  'jump00.png': 7,
  'jump01.png': 14,
  'jump02.png': 18,
  'jump03.png': 21,
  'jump04.png': 24,
  'jump05.png': 27,
  'jump06.png': 27,
  'jump07.png': 27,
  'jump08.png': 28,
  'jump09.png': 31,
  'jump10.png': 35,
  'jump11.png': 38,
  'jump12.png': 41,
};

describe('the running jump, against the original', () => {
  it('has thirteen captured frames to compare against', () => {
    expect(readdirSync(JUMP_DIR).filter((f) => f.endsWith('.png')).sort())
      .toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))('%s', (file, expected) => {
    expect(matchingStep(file)?.step ?? null).toBe(expected);
  });

  it('the frames of the jump are reproduced in the order they were captured', () => {
    // The three blank frames share a tick, so they are compared as a group
    // rather than against each other.
    const order = [
      'jump02.png', 'jump03.png', 'jump04.png', 'jump05.png', 'jump08.png',
      'jump09.png',
    ].map((f) => matchingStep(f)?.step ?? -1);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });

  it('is a jump: the Prince leaves the ground and lands in the next room', () => {
    const airborne = timeline.slice(UP_AT, 30).filter((t) => t.state.includes('y 16')
      || t.state.includes('y 17'));
    expect(airborne.length).toBeGreaterThan(0);
    expect(matchingStep('jump04.png')?.room).toBe(9);
    expect(matchingStep('jump08.png')?.room).toBe(12);
  });
});
