/**
 * Room drawing, compared against the original game.
 *
 * Each case renders one room and requires that it equal a DOSBox capture of
 * the same room pixel for pixel, except in regions the test names explicitly.
 * Right now the only such region is the Prince himself, who is not drawn yet;
 * the test pins his exact bounding box and pixel count so that the exception
 * cannot quietly grow.
 *
 * Tiles whose look depends on live state -- torch flames pick a random frame,
 * gates are part way through opening, potion bubbles rise -- are given the
 * state the captured frame was in. Those values were found by searching each
 * tile's small range of states against the capture, and are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GAME_DIR, goldenFrame, toCaptureSpace, diffClusters, type DiffCluster,
} from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Surface } from '../../src/render/surface.ts';
import { RoomRenderer, type RoomTiles } from '../../src/render/room.ts';
import { buildLevelScene } from '../../src/game/scene.ts';

const ROOM_AREA_HEIGHT = 192; // below this is the status bar, drawn separately

const assets = new Assets(async (name) => new Uint8Array(readFileSync(join(GAME_DIR, name))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** [room, column, row, modifier] for the animated tiles in the capture. */
type Mod = [number, number, number, number];

interface Case {
  level: number;
  room: number;
  golden: string;
  what: string;
  modifiers: Mod[];
  expected: DiffCluster[];
}

/** A 10x41 box is the Prince standing still; he is not drawn yet. */
const CASES: Case[] = [
  {
    level: 1, room: 1, golden: 'level01-start.png', what: 'dungeon: walls, torches, loose floor, debris',
    modifiers: [[5, 9, 0, 0], [1, 0, 1, 2], [1, 1, 1, 0]],
    expected: [{ x0: 32, y0: 78, x1: 41, y1: 118, count: 278 }],
  },
  {
    level: 2, room: 5, golden: 'level02-start.png', what: 'dungeon: big pillars and the level door',
    modifiers: [[5, 1, 1, 8], [5, 4, 1, 0]],
    expected: [{ x0: 114, y0: 78, x1: 123, y1: 118, count: 278 }],
  },
  {
    level: 3, room: 9, golden: 'level03-start.png', what: 'dungeon: a plain room',
    modifiers: [[9, 7, 2, 5]],
    expected: [{ x0: 165, y0: 141, x1: 174, y1: 181, count: 270 }],
  },
  {
    level: 4, room: 1, golden: 'level04-start.png', what: 'palace: generated wall colours and brick edges',
    modifiers: [[1, 0, 1, 4], [1, 4, 1, 2], [1, 7, 1, 4], [1, 9, 1, 0], [8, 9, 1, 0]],
    expected: [{ x0: 229, y0: 78, x1: 238, y1: 118, count: 278 }],
  },
  {
    level: 5, room: 7, golden: 'level05-start.png', what: 'palace: gates, a potion and a level door',
    modifiers: [
      [7, 7, 0, 8], [7, 8, 0, 0], [8, 9, 0, 188],
      [7, 0, 2, 1], [7, 7, 2, 0], [7, 8, 2, 0], [8, 9, 2, 188],
    ],
    expected: [
      { x0: 146, y0: 141, x1: 155, y1: 181, count: 278 },
      // The three pixels of the potion's rising bubble. Its shape and
      // position are exact; only the colour is not yet settled -- the
      // original draws it from a palette entry whose source has not been
      // identified in any of the game's files.
      { x0: 250, y0: 42, x1: 252, y1: 44, count: 2 },
      { x0: 250, y0: 47, x1: 250, y1: 47, count: 1 },
    ],
  },
  {
    level: 6, room: 24, golden: 'level06-start.png', what: 'palace: another generated wall',
    modifiers: [[24, 0, 1, 7], [24, 3, 1, 8], [2, 9, 1, 0]],
    expected: [{ x0: 101, y0: 78, x1: 110, y1: 118, count: 278 }],
  },
];

async function renderCase(c: Case): Promise<{ got: Uint8Array; want: Uint8Array }> {
  const scene = await buildLevelScene(assets, exe, c.level);
  const pinned = new Map(c.modifiers.map(([r, col, row, v]) => [`${r},${col},${row}`, v]));
  const tiles: RoomTiles = {
    typeAt: (r, col, row) => scene.tiles.typeAt(r, col, row),
    modifierAt: (r, col, row) =>
      pinned.get(`${r},${col},${row}`) ?? scene.tiles.modifierAt(r, col, row),
    linkOf: (r, d) => scene.tiles.linkOf(r, d),
  };
  const surface = new Surface();
  new RoomRenderer(scene.chtabs, tiles, scene.options).render(surface, c.room);

  const full = toCaptureSpace(surface.toRgb(scene.screenPalette.toRgba()));
  const golden = goldenFrame(c.golden);
  const n = 320 * ROOM_AREA_HEIGHT * 3;
  return { got: full.subarray(0, n), want: golden.rgb.subarray(0, n) };
}

describe('room drawing against the original', () => {
  for (const c of CASES) {
    it(`level ${c.level} room ${c.room} — ${c.what}`, async () => {
      const { got, want } = await renderCase(c);
      const clusters = diffClusters(got, want, 320, ROOM_AREA_HEIGHT);
      expect(clusters).toEqual(c.expected);
    });
  }

  it('every case differs from the original only where it says it does', async () => {
    for (const c of CASES) {
      const { got, want } = await renderCase(c);
      const total = diffClusters(got, want, 320, ROOM_AREA_HEIGHT)
        .reduce((a, d) => a + d.count, 0);
      const allowed = c.expected.reduce((a, d) => a + d.count, 0);
      expect(total, `level ${c.level}`).toBe(allowed);
    }
  });
});
