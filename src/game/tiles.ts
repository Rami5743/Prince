/**
 * Tile types and the drawing table that says which images make up each one.
 *
 * A room is 10 x 3 tiles; a tile is 32 pixels wide and a row is 63 tall. Each
 * tile is drawn as several overlapping pieces, some of which belong to the
 * tile to the right or the row below, which is why the renderer walks the
 * room bottom row first and carries the neighbouring tile with it.
 */

export const TILE_WIDTH = 32;
export const ROW_HEIGHT = 63;
export const ROOM_COLUMNS = 10;
export const ROOM_ROWS = 3;

export const TILE = {
  empty: 0,
  floor: 1,
  spike: 2,
  pillar: 3,
  gate: 4,
  stuck: 5,
  closer: 6,
  doortopWithFloor: 7,
  bigPillarBottom: 8,
  bigPillarTop: 9,
  potion: 10,
  loose: 11,
  doortop: 12,
  mirror: 13,
  debris: 14,
  opener: 15,
  levelDoorLeft: 16,
  levelDoorRight: 17,
  chomper: 18,
  torch: 19,
  wall: 20,
  skeleton: 21,
  sword: 22,
  balconyLeft: 23,
  balconyRight: 24,
  latticePillar: 25,
  latticeDown: 26,
  latticeSmall: 27,
  latticeLeft: 28,
  latticeRight: 29,
  torchWithDebris: 30,
} as const;

export const TILE_TYPE_MASK = 0x1f;

/** A tile is "floor" if the Prince can stand on it. */
export function tileIsFloor(tileType: number): boolean {
  switch (tileType) {
    case TILE.empty:
    case TILE.bigPillarTop:
    case TILE.doortop:
    case TILE.wall:
    case TILE.latticeDown:
    case TILE.latticeSmall:
    case TILE.latticeLeft:
    case TILE.latticeRight:
      return false;
    default:
      return true;
  }
}

export interface TilePiece {
  baseId: number;
  floorLeft: number;
  baseY: number;
  rightId: number;
  floorRight: number;
  rightY: number;
  stripeId: number;
  topRightId: number;
  bottomId: number;
  foreId: number;
  foreX: number;
  foreY: number;
}

function piece(v: readonly number[]): TilePiece {
  return {
    baseId: v[0], floorLeft: v[1], baseY: v[2],
    rightId: v[3], floorRight: v[4], rightY: v[5],
    stripeId: v[6], topRightId: v[7], bottomId: v[8],
    foreId: v[9], foreX: v[10], foreY: v[11],
  };
}

/**
 * One entry per tile type. Values are image ids within the room-tile sprite
 * group (1-based, 0 meaning "draw nothing") plus the vertical offsets each
 * piece is drawn at.
 */
export const TILE_TABLE: readonly TilePiece[] = [
  [  0,  0,   0,   0,  0,  0,   0,   0,   0,   0,  0,   0], // empty
  [ 41,  1,   0,  42,  1,  2, 145,   0,  43,   0,  0,   0], // floor
  [127,  1,   0, 133,  1,  2, 145,   0,  43,   0,  0,   0], // spike
  [ 92,  1,   0,  93,  1,  2,   0,  94,  43,  95,  1,   0], // pillar
  [ 46,  1,   0,  47,  1,  2,   0,  48,  43,  49,  3,   0], // gate
  [ 41,  1,   1,  35,  1,  3, 145,   0,  36,   0,  0,   0], // stuck floor
  [ 41,  1,   0,  42,  1,  2, 145,   0,  96,   0,  0,   0], // close button
  [ 46,  1,   0,   0,  0,  2,   0,   0,  43,  49,  3,   0], // door top with floor
  [ 86,  1,   0,  87,  1,  2,   0,   0,  43,  88,  1,   0], // big pillar bottom
  [  0,  0,   0,  89,  0,  3,   0,  90,   0,  91,  1,   3], // big pillar top
  [ 41,  1,   0,  42,  1,  2, 145,   0,  43,  12,  2,  -3], // potion
  [  0,  1,   0,   0,  0,  0, 145,   0,   0,   0,  0,   0], // loose floor
  [  0,  0,   0,   0,  0,  2,   0,   0,  85,  49,  3,   0], // door top
  [ 75,  1,   0,  42,  1,  2,   0,   0,  43,  77,  0,   0], // mirror
  [ 97,  1,   0,  98,  1,  2, 145,   0,  43, 100,  0,   0], // debris
  [147,  1,   0,  42,  1,  1, 145,   0, 149,   0,  0,   0], // open button
  [ 41,  1,   0,  37,  0,  0,   0,  38,  43,   0,  0,   0], // level door left
  [  0,  0,   0,  39,  1,  2,   0,  40,  43,   0,  0,   0], // level door right
  [  0,  0,   0,  42,  1,  2, 145,   0,  43,   0,  0,   0], // chomper
  [ 41,  1,   0,  42,  1,  2,   0,   0,  43,   0,  0,   0], // torch
  [  0,  0,   0,   1,  1,  2,   0,   2,   0,   0,  0,   0], // wall
  [ 30,  1,   0,  31,  1,  2,   0,   0,  43,   0,  0,   0], // skeleton
  [ 41,  1,   0,  42,  1,  2, 145,   0,  43,   0,  0,   0], // sword
  [ 41,  1,   0,  10,  0,  0,   0,  11,  43,   0,  0,   0], // balcony left
  [  0,  0,   0,  12,  1,  2,   0,  13,  43,   0,  0,   0], // balcony right
  [ 92,  1,   0,  42,  1,  2, 145,   0,  43,  95,  1,   0], // lattice pillar
  [  1,  0,   0,   0,  0,  0,   0,   0,   2,   9,  0, -53], // lattice down
  [  3,  0, -10,   0,  0,  0,   0,   0,   0,   9,  0, -53], // lattice small
  [  4,  0, -10,   0,  0,  0,   0,   0,   0,   9,  0, -53], // lattice left
  [  5,  0, -10,   0,  0,  0,   0,   0,   0,   9,  0, -53], // lattice right
  [ 97,  1,   0,  98,  1,  2,   0,   0,  43, 100,  0,   0], // debris with torch
].map(piece);

/** Wall modifier bits: which neighbours are also walls. */
export const WALL_SWS = 0; // neither
export const WALL_SWW = 1; // right only
export const WALL_WWS = 2; // left only
export const WALL_WWW = 3; // both

/**
 * The level data stores raw modifiers; the original rewrites them once, when
 * a level is loaded, into the form the renderer and the game logic expect.
 * For walls this records which neighbours are walls, which is what the wall
 * pattern is drawn from.
 */
export function alterModifiers(
  fg: Uint8Array,
  bg: Uint8Array,
  roomLinks: Uint8Array,
  roomCount: number,
): Uint8Array {
  const mod = bg.slice();
  const rooms = Math.min(roomCount, 24);
  const typeAt = (index: number) => fg[index] & TILE_TYPE_MASK;

  for (let room = 1; room <= rooms; room++) {
    const roomL = roomLinks[(room - 1) * 4 + 0];
    const roomR = roomLinks[(room - 1) * 4 + 1];
    for (let tilepos = 0; tilepos < 30; tilepos++) {
      const index = (room - 1) * 30 + tilepos;
      const type = typeAt(index);
      switch (type) {
        case TILE.gate:
          mod[index] = mod[index] === 1 ? 188 : 0;
          break;
        case TILE.loose:
          mod[index] = 0;
          break;
        case TILE.potion:
          mod[index] = (mod[index] << 3) & 0xff;
          break;
        case TILE.wall: {
          // The "no blue" flag moves to the most significant bit; the two
          // lowest bits then record the wall connections.
          mod[index] = mod[index] === 1 ? 0x80 : 0;
          let wallLeft = true;
          let wallRight = true;
          if (tilepos % 10 === 0) {
            if (roomL) wallLeft = typeAt((roomL - 1) * 30 + tilepos + 9) === TILE.wall;
          } else {
            wallLeft = typeAt(index - 1) === TILE.wall;
          }
          if (tilepos % 10 === 9) {
            if (roomR) wallRight = typeAt((roomR - 1) * 30 + tilepos - 9) === TILE.wall;
          } else {
            wallRight = typeAt(index + 1) === TILE.wall;
          }
          if (wallLeft && wallRight) mod[index] |= WALL_WWW;
          else if (wallLeft) mod[index] |= WALL_WWS;
          else if (wallRight) mod[index] |= WALL_SWW;
          break;
        }
        default:
          break;
      }
    }
  }
  return mod;
}
