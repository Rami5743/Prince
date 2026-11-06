import { describe, it, expect } from 'vitest';
import { dat } from '../helpers/fixtures.ts';
import {
  parseLevel, FIRST_LEVEL_RESOURCE, LAST_LEVEL_RESOURCE, LEVEL_PAYLOAD_SIZE,
  LEVEL_TILE_COUNT, ROOM_COUNT,
} from '../../src/dat/level.ts';

const levels = dat('LEVELS.DAT');
const ids = Array.from(
  { length: LAST_LEVEL_RESOURCE - FIRST_LEVEL_RESOURCE + 1 },
  (_, i) => FIRST_LEVEL_RESOURCE + i,
);
/** 2000 is the demo level and 2015 is the unplayed "potions" level. */
const PLAYABLE = ids.filter((id) => id >= 2001 && id <= 2014);

describe('levels', () => {
  it('holds exactly 16 level resources, 2000..2015', () => {
    expect(levels.ids()).toEqual(ids);
  });

  it('every level is 2305 bytes except the last, which is one byte short', () => {
    for (const id of ids) {
      const want = id === LAST_LEVEL_RESOURCE ? LEVEL_PAYLOAD_SIZE - 1 : LEVEL_PAYLOAD_SIZE;
      expect(levels.get(id).length, `resource ${id}`).toBe(want);
    }
  });

  it.each(ids)('resource %i parses', (id) => {
    const lv = parseLevel(levels.get(id), id);
    expect(lv.fg.length).toBe(LEVEL_TILE_COUNT);
    expect(lv.bg.length).toBe(LEVEL_TILE_COUNT);
    expect(lv.roomLinks.length).toBe(ROOM_COUNT * 4);
    expect(lv.guards.length).toBe(ROOM_COUNT);
  });

  it.each(ids)('resource %i has a usable starting position', (id) => {
    const lv = parseLevel(levels.get(id), id);
    expect(lv.startRoom).toBeGreaterThanOrEqual(1);
    expect(lv.startRoom).toBeLessThanOrEqual(ROOM_COUNT);
    expect(lv.startPos).toBeGreaterThanOrEqual(0);
    expect(lv.startPos).toBeLessThan(30);
    expect([-1, 0]).toContain(lv.startDir);
  });

  it.each(PLAYABLE)('resource %i links only to rooms that exist', (id) => {
    const lv = parseLevel(levels.get(id), id);
    for (let i = 0; i < lv.roomLinks.length; i++) {
      expect(lv.roomLinks[i], `roomLinks[${i}]`).toBeLessThanOrEqual(ROOM_COUNT);
    }
  });

  it('level 1 starts in room 1 on tile 0 facing left', () => {
    const lv = parseLevel(levels.get(2001), 2001);
    expect(lv.startRoom).toBe(1);
    expect(lv.startPos).toBe(0);
    expect(lv.startDir).toBe(-1);
  });

  /**
   * Recorded, not required. Room links are stored per direction and the
   * shipped levels are full of one-way pairs, so a renderer must follow the
   * link it is given rather than assume the reverse link agrees.
   */
  it('room links are directional: most levels contain asymmetric pairs', () => {
    const opposite = [1, 0, 3, 2];
    const counts: Record<number, number> = {};
    for (const id of ids) {
      const lv = parseLevel(levels.get(id), id);
      let n = 0;
      for (let room = 1; room <= ROOM_COUNT; room++) {
        for (let dir = 0; dir < 4; dir++) {
          const other = lv.roomLinks[(room - 1) * 4 + dir];
          if (other === 0 || other > ROOM_COUNT) continue;
          const back = lv.roomLinks[(other - 1) * 4 + opposite[dir]];
          if (back !== 0 && back !== room) n++;
        }
      }
      counts[id] = n;
    }
    expect(counts).toEqual({
      2000: 3, 2001: 5, 2002: 0, 2003: 4, 2004: 0, 2005: 3, 2006: 15, 2007: 0,
      2008: 3, 2009: 0, 2010: 7, 2011: 1, 2012: 0, 2013: 5, 2014: 2, 2015: 0,
    });
  });

  /**
   * usedRooms is an artefact of the level editor, not a room count: it reads
   * 25 on most levels and 7 on level 14. Nothing may rely on it.
   */
  it('usedRooms is recorded but is not a room count', () => {
    const got = Object.fromEntries(
      ids.map((id) => [id, parseLevel(levels.get(id), id).usedRooms]),
    );
    expect(got).toEqual({
      2000: 25, 2001: 24, 2002: 25, 2003: 24, 2004: 25, 2005: 25, 2006: 25,
      2007: 25, 2008: 25, 2009: 25, 2010: 21, 2011: 25, 2012: 25, 2013: 25,
      2014: 7, 2015: 9,
    });
  });
});
