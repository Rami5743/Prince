/**
 * Level records from LEVELS.DAT — resource ids 2000..2015.
 *
 * 2000 is the demo level, 2001..2014 are levels 1..14, 2015 is level 15.
 * Each payload is 2305 bytes, except resource 2015, which is 2304: the
 * original file is one padding byte short on the last level.
 *
 * A level is 24 rooms of 10 x 3 tiles.
 */

export const ROOM_COUNT = 24;
export const ROOM_WIDTH = 10;
export const ROOM_HEIGHT = 3;
export const TILES_PER_ROOM = ROOM_WIDTH * ROOM_HEIGHT; // 30
export const LEVEL_TILE_COUNT = ROOM_COUNT * TILES_PER_ROOM; // 720
export const LEVEL_PAYLOAD_SIZE = 2305;

export const FIRST_LEVEL_RESOURCE = 2000;
export const LAST_LEVEL_RESOURCE = 2015;

export interface GuardSpec {
  readonly tile: number;
  readonly dir: number;
  readonly x: number;
  readonly seqLo: number;
  readonly skill: number;
  readonly seqHi: number;
  readonly color: number;
}

export interface Level {
  readonly resourceId: number;
  /** Foreground tile code of every tile, room-major. */
  readonly fg: Uint8Array;
  /** Modifier byte of every tile, room-major. */
  readonly bg: Uint8Array;
  readonly doorLinks1: Uint8Array;
  readonly doorLinks2: Uint8Array;
  /** roomLinks[room*4 + dir], dir = 0 left, 1 right, 2 up, 3 down. 0 = none. */
  readonly roomLinks: Uint8Array;
  readonly usedRooms: number;
  readonly roomXs: Uint8Array;
  readonly roomYs: Uint8Array;
  readonly startRoom: number;
  readonly startPos: number;
  /** -1 facing left, 0 facing right. */
  readonly startDir: number;
  readonly guards: readonly GuardSpec[];
}

const OFF_FG = 0;
const OFF_BG = 720;
const OFF_DOORLINKS1 = 1440;
const OFF_DOORLINKS2 = 1696;
const OFF_ROOMLINKS = 1952;
const OFF_USED_ROOMS = 2048;
const OFF_ROOM_XS = 2049;
const OFF_ROOM_YS = 2073;
const OFF_START_ROOM = 2112;
const OFF_START_POS = 2113;
const OFF_START_DIR = 2114;
const OFF_GUARDS = 2119;

/** Pad a short payload (resource 2015) so field reads stay in range. */
function normalise(payload: Uint8Array): Uint8Array {
  if (payload.length >= LEVEL_PAYLOAD_SIZE) return payload;
  const out = new Uint8Array(LEVEL_PAYLOAD_SIZE);
  out.fill(0xff);
  out.set(payload);
  return out;
}

export function parseLevel(payload: Uint8Array, resourceId: number): Level {
  if (payload.length < LEVEL_PAYLOAD_SIZE - 1) {
    throw new Error(
      `level payload is ${payload.length} bytes, expected ${LEVEL_PAYLOAD_SIZE}`,
    );
  }
  const d = normalise(payload);
  const guards: GuardSpec[] = [];
  for (let i = 0; i < ROOM_COUNT; i++) {
    guards.push({
      tile: d[OFF_GUARDS + i],
      dir: d[OFF_GUARDS + 24 + i],
      x: d[OFF_GUARDS + 48 + i],
      seqLo: d[OFF_GUARDS + 72 + i],
      skill: d[OFF_GUARDS + 96 + i],
      seqHi: d[OFF_GUARDS + 120 + i],
      color: d[OFF_GUARDS + 144 + i],
    });
  }
  return {
    resourceId,
    fg: d.slice(OFF_FG, OFF_FG + LEVEL_TILE_COUNT),
    bg: d.slice(OFF_BG, OFF_BG + LEVEL_TILE_COUNT),
    doorLinks1: d.slice(OFF_DOORLINKS1, OFF_DOORLINKS1 + 256),
    doorLinks2: d.slice(OFF_DOORLINKS2, OFF_DOORLINKS2 + 256),
    roomLinks: d.slice(OFF_ROOMLINKS, OFF_ROOMLINKS + 96),
    usedRooms: d[OFF_USED_ROOMS],
    roomXs: d.slice(OFF_ROOM_XS, OFF_ROOM_XS + ROOM_COUNT),
    roomYs: d.slice(OFF_ROOM_YS, OFF_ROOM_YS + ROOM_COUNT),
    startRoom: d[OFF_START_ROOM],
    startPos: d[OFF_START_POS],
    startDir: (d[OFF_START_DIR] << 24) >> 24,
    guards,
  };
}

/** Level number 1..15, or 0 for the demo level. */
export function levelNumberOf(resourceId: number): number {
  return resourceId - FIRST_LEVEL_RESOURCE;
}

export function resourceIdOfLevel(levelNumber: number): number {
  return FIRST_LEVEL_RESOURCE + levelNumber;
}

/** Tile codes carry the type in the low 5 bits and modifier flags above. */
export const TILE_TYPE_MASK = 0x1f;
