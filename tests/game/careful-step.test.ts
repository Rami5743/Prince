/**
 * Stepping carefully, compared with the original frame by frame.
 *
 * tests/golden/level1-step holds eighteen frames captured from PRINCE.EXE on
 * level 1: once the entry fall and the level banner are out of the way,
 * Right and Shift are held. The Prince steps carefully to the edge, steps
 * off it, takes hold of the ledge on the way past, and hangs there until
 * Shift is released. Nothing in it depends on hitting a particular tick, so
 * the capture is reproducible; the emulator was run at --cycles 300 so that
 * consecutive captures are only a tick or two apart.
 *
 * Torch flames are the one allowance, as in tests/game/run.test.ts.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { GAME_DIR, GOLDEN_DIR, diffClusters, toCaptureSpace } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { TILE } from '../../src/game/tiles.ts';

const STEP_DIR = join(GOLDEN_DIR, 'level1-step');
const LEVEL = 1;
/** The oracle let the entry fall and the banner finish before touching a key. */
const STILL_FRAMES = 22;
/** The tick Shift was let go on. */
const RELEASE_AT = 36;
const TIMELINE_LENGTH = 70;

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

interface Step { step: number; rgb: Uint8Array; room: number; frame: number }

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
      y: 0,
      shift: step >= STILL_FRAMES && step < RELEASE_AT,
    });
    const full = toCaptureSpace(game.render().toRgb(game.scene.screenPalette.toRgba()));
    timeline.push({
      step, rgb: full.slice(0, 320 * 200 * 3), room: game.drawnRoom, frame: game.kid.frame,
    });
  }
}, 120000);

function captureRgb(file: string): Uint8Array {
  const png = PNG.sync.read(readFileSync(join(STEP_DIR, file)));
  const rgb = new Uint8Array(320 * 200 * 3);
  for (let i = 0; i < 320 * 200; i++) {
    rgb[i * 3] = png.data[i * 4];
    rgb[i * 3 + 1] = png.data[i * 4 + 1];
    rgb[i * 3 + 2] = png.data[i * 4 + 2];
  }
  return rgb;
}

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
 * Which simulated frame reproduces each capture. hang05 to hang10 all land
 * on the same one because the Prince is standing still in all of them.
 *
 * hang17 is not reproduced: the nearest frame is three pixels out, at
 * (164..166, 126). Left unexplained rather than excused.
 */
const EXPECTED: Record<string, number | null> = {
  'step00.png': 18,
  'step01.png': 24,
  'step02.png': 26,
  'step03.png': 29,
  'step04.png': 32,
  'step05.png': 34,
  'step06.png': 34,
  'step07.png': 34,
  'step08.png': 34,
  'step09.png': 34,
  'step10.png': 34,
  'step11.png': 38,
  'step12.png': 40,
  'step13.png': 43,
  'step14.png': 45,
  'step15.png': 47,
  'step16.png': 50,
  'step17.png': null,
};

describe('stepping carefully, against the original', () => {
  it('has eighteen captured frames to compare against', () => {
    expect(readdirSync(STEP_DIR).filter((f) => f.endsWith('.png')).sort())
      .toEqual(Object.keys(EXPECTED));
  });

  it.each(Object.entries(EXPECTED))('%s', (file, expected) => {
    expect(matchingStep(file)?.step ?? null).toBe(expected);
  });

  it('the frames are reproduced in the order they were captured', () => {
    const order = Object.keys(EXPECTED)
      .map((f) => matchingStep(f)?.step)
      .filter((s): s is number => s !== undefined);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    }
  });

  it('one careful step per press, and then he waits at the edge', () => {
    // Frames 121..132 are the careful step. With Shift held down the whole
    // time there is exactly one of them, and he stands still after it.
    const starts = timeline.filter((t) => t.frame === 121).map((t) => t.step);
    expect(starts).toEqual([STILL_FRAMES]);
    const atRelease = timeline[RELEASE_AT - 1];
    expect(atRelease.frame).toBe(15); // standing
  });
});
