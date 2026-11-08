/**
 * `reset_obj_clip`, and where a character outside the room is drawn.
 *
 * Two pieces of the original's drawing that the port did not have, both
 * of which show in the first descent of level 1 -- the Prince steps off
 * the bottom row of room 1 and falls through into room 2.
 *
 * `obj_clip_bottom` is 192. Everything drawn in the room is clipped to
 * the room's own 192 rows; the eight below them are the hit points and
 * belong to nobody else. Without the clip his feet were drawn across
 * them on the way down.
 *
 * And a character whose tile is outside the room -- a row above it, a
 * row below it, a column off either end -- comes out of
 * `get_tilepos_nominus` as tile 30, which `redraw_needed_tiles` draws
 * before any tile of the room. That is not the same as behind all of
 * it: the original redraws hardly any tiles, so what comes back over
 * him is the overlay of the ones his box covers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Surface } from '../../src/render/surface.ts';
import { RoomRenderer, type CharacterDraw } from '../../src/render/room.ts';
import { buildLevelScene } from '../../src/game/scene.ts';

const ROOM_BOTTOM_Y = 192;

const assets = new Assets(async (name) => new Uint8Array(readFileSync(join(GAME_DIR, name))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

async function renderer(): Promise<{ r: RoomRenderer; s: Surface }> {
  const scene = await buildLevelScene(assets, exe, 1);
  return {
    r: new RoomRenderer(scene.chtabs, scene.state, scene.options),
    s: new Surface(),
  };
}

/** The Prince, standing, placed by hand so the test can put him anywhere. */
function kid(y: number, row: number, extra: Partial<CharacterDraw> = {}): CharacterDraw {
  return { chtab: 'kid', image: 16, x: 200, y, direction: 0, row, ...extra };
}

function rowsBelowTheRoom(s: Surface): number {
  let n = 0;
  for (let y = ROOM_BOTTOM_Y; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) if (s.pixels[y * s.width + x] !== 0) n += 1;
  }
  return n;
}

describe('the bottom of the room', () => {
  it('is where the drawing stops', async () => {
    const { r, s } = await renderer();
    // A Prince whose feet are at y 205: a dozen rows of him are below the
    // room, and none of them may be drawn.
    r.render(s, 1, [kid(205, 2)]);
    expect(rowsBelowTheRoom(s), 'nothing below row 191').toBe(0);
  });

  it('does not stop the room itself being drawn', async () => {
    const { r, s } = await renderer();
    r.render(s, 1, [kid(205, 2)]);
    let drawn = 0;
    for (let y = 180; y < ROOM_BOTTOM_Y; y++) {
      for (let x = 0; x < s.width; x++) if (s.pixels[y * s.width + x] !== 0) drawn += 1;
    }
    expect(drawn, 'the last rows of the room are still painted').toBeGreaterThan(1000);
  });

  it('leaves the surface clip as it found it', async () => {
    const { r, s } = await renderer();
    r.render(s, 1, [kid(100, 1)]);
    expect(s.clipBottom).toBe(s.height);
  });
});

describe('a character whose tile is outside the room', () => {
  /**
   * `get_tilepos_nominus` turns a row above the room or below it into
   * tile 30, which `redraw_needed_tiles` draws before any tile of the
   * room. The port used to paint such a character before the *whole*
   * room, which hid far too much of him: the original redraws almost
   * no tiles, so what comes back over a Prince in the air is the
   * overlay of the tiles he covers and not the room. He is painted
   * with the nearest row of it instead -- see `CharacterLayer` -- and
   * `CharacterOverlay` is what takes the pixels back.
   */
  it('is drawn with the nearest row of the room', async () => {
    const below = await renderer();
    below.r.render(below.s, 1, [kid(188, 3)]);
    const inside = await renderer();
    inside.r.render(inside.s, 1, [kid(188, 2)]);
    let differing = 0;
    for (let i = 0; i < inside.s.pixels.length; i++) {
      if (inside.s.pixels[i] !== below.s.pixels[i]) differing += 1;
    }
    expect(differing, 'a row below the room draws like the bottom row').toBe(0);

    const above = await renderer();
    above.r.render(above.s, 1, [kid(60, -1)]);
    const top = await renderer();
    top.r.render(top.s, 1, [kid(60, 0)]);
    differing = 0;
    for (let i = 0; i < above.s.pixels.length; i++) {
      if (above.s.pixels[i] !== top.s.pixels[i]) differing += 1;
    }
    expect(differing, 'and a row above it like the top row').toBe(0);
  });

  /**
   * And what hides the legs of a Prince stepping off the bottom row is
   * the overlay: the tiles his box covers, drawn again over him.
   */
  it('has the floor put back over him by the overlay', async () => {
    // Row 0 of room 1 is `0 0 0 1 1 1 1 1 20 20`: column 3 is a floor
    // and the tile to its left is empty, which is the test
    // `draw_other_overlay` starts with. The Prince is at column 2,
    // reaching into column 3.
    const where = { x: 110 };
    const plain = await renderer();
    plain.r.render(plain.s, 1, [kid(62, 0, where)]);
    const covered = await renderer();
    covered.r.render(covered.s, 1, [kid(62, 0, {
      ...where,
      overlay: {
        colLeft: 2, colRight: 3, topRow: 0, bottomRow: 0,
        skipBottomRow: false, ownColumn: 2, ownRow: 0,
      },
    })]);
    let hidden = 0;
    for (let i = 0; i < plain.s.pixels.length; i++) {
      if (plain.s.pixels[i] !== covered.s.pixels[i]) hidden += 1;
    }
    expect(hidden, 'the floor takes pixels back off him').toBeGreaterThan(20);
  });
});
