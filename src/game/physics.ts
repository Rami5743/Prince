/**
 * Where a character is, what is under it, and what is in front of it.
 *
 * All of this is in the original's internal units: a tile is 14 wide, the
 * left edge of the screen is at 58, and a character's "weight" sits a little
 * behind the sprite, which is what decides the column it counts as being in.
 */
import type { CharacterState } from './character.ts';
import { forwardX } from './character.ts';
import type { Frame } from './exe-tables.ts';
import { FRAME_FLAG } from './exe-tables.ts';
import { TILE_SIZE_X, TILE_MID_X, X_BUMP, FIRST_ONSCREEN_COLUMN, Y_LAND } from './geometry.ts';
import { TILE, TILE_TYPE_MASK, tileIsFloor } from './tiles.ts';

/** Left-most pixel of the screen, in internal units. */
export const SCREENSPACE_X = 58;
export const TILE_RIGHT_X = 13;
export const TILE_SIZE_Y = 63;

export const FALLING_SPEED_MAX = 33;
export const FALLING_SPEED_ACCEL = 3;

/** Column offset of the tile a character faces, by direction + 1. */
export const DIR_FRONT = [-1, 1] as const;
export const DIR_BEHIND = [1, -1] as const;

export const EDGE_TYPE = {
  floor: 0,
  wall: 1,
  /** A tile the character must stop short of: a button, a sword, a potion. */
  closer: 2,
} as const;

/** How far into a tile its wall stands, by wall type. */
const WALL_DIST_FROM_LEFT = [0, 10, 0, -1, 0, 0] as const;
const WALL_DIST_FROM_RIGHT = [0, 0, 10, 13, 0, 0] as const;

/** A gate's modifier when it has risen as far as it goes. */
export const GATE_FULLY_OPEN = 188;

/**
 * The gap under a gate, in pixels, which is what the renderer draws: the
 * modifier counts up to 188 as the gate rises and the game works in
 * quarters of it, so the bottom of the bars sits this far above the floor.
 */
export function gateClearance(modifier: number): number {
  return (Math.min(modifier, GATE_FULLY_OPEN) >> 2) + 1;
}

/**
 * Is this gate still low enough to walk into?
 *
 * A character fits under a gate when the gap is at least as tall as he is,
 * and not before. The port used to let him through as soon as the bars had
 * lifted six quarters -- six pixels of a forty-eight pixel opening -- which
 * is a crack, not a doorway.
 *
 * The capture settles it. In the recorded run of level 1 the Prince walks
 * left along the top of room 6 with the gate of room 8 rising ahead of him,
 * and the original stops him dead against it: he stands still, Left held,
 * from tick 240 to tick 256, while the gap grows from twenty-six pixels to
 * thirty-eight. He is forty-one pixels tall. The port let him walk straight
 * through into room 8 and the two runs never met again.
 *
 * `charHeight` is the height of the sprite the character is drawn with,
 * which is what has to fit.
 */
export function gateBlocks(modifier: number, charHeight: number): boolean {
  return gateClearance(modifier) < charHeight;
}

/**
 * `wallType`, for a tile that has been looked up, so that a gate can be
 * asked how far open it is. A gate that has risen clear of a character's
 * head is not a wall to him, and treating it as one leaves the player
 * standing in front of a door they have just opened.
 */
export function wallTypeAt(world: World, tile: TileQuery, charHeight: number): number {
  if (tile.type === TILE.gate) {
    if (tile.room === 0) return 0;
    const modifier = world.modifierAt(tile.room, tile.column, tile.row);
    if (!gateBlocks(modifier, charHeight)) return 0;
  }
  return wallType(tile.type);
}

/** Which side of a tile is solid, from its type alone. */
export function wallType(tileType: number): number {
  switch (tileType) {
    case TILE.gate:
    case TILE.doortopWithFloor:
    case TILE.doortop:
      return 1; // wall on the right
    case TILE.mirror:
      return 2; // wall on the left
    case TILE.chomper:
      return 3; // chomper on the left
    case TILE.wall:
      return 4; // wall on both sides
    default:
      return 0;
  }
}

/** The rooms and tiles a character can be standing in. */
export interface World {
  tileAt(room: number, column: number, row: number): number;
  modifierAt(room: number, column: number, row: number): number;
  linkOf(room: number, dir: number): number;
  levelEdgeHitTile: number;
}

export interface TileQuery {
  /** The tile type, after following room links out of the room. */
  type: number;
  room: number;
  column: number;
  row: number;
}

/**
 * Look up a tile, following room links when the column or row leaves the
 * room. Off the edge of the level the original returns a wall.
 */
export function getTile(
  world: World, room: number, column: number, row: number,
): TileQuery {
  let r = room;
  let col = column;
  let line = row;
  while (col < 0 && r) { r = world.linkOf(r, 0); col += 10; }
  while (col > 9 && r) { r = world.linkOf(r, 1); col -= 10; }
  while (line < 0 && r) { r = world.linkOf(r, 2); line += 3; }
  while (line > 2 && r) { r = world.linkOf(r, 3); line -= 3; }
  if (!r || col < 0 || col > 9 || line < 0 || line > 2) {
    return { type: world.levelEdgeHitTile, room: 0, column: col, row: line };
  }
  return { type: world.tileAt(r, col, line) & TILE_TYPE_MASK, room: r, column: col, row: line };
}

/** Split an internal x into a tile column and an offset inside the tile. */
export function tileDivMod(xpos: number): { column: number; offset: number } {
  const x = xpos - SCREENSPACE_X;
  let column = Math.trunc(x / TILE_SIZE_X);
  let offset = x % TILE_SIZE_X;
  if (offset < 0) {
    column -= 1;
    offset += TILE_SIZE_X;
  }
  return { column, offset };
}

export function tileDivModM7(xpos: number): { column: number; offset: number } {
  return tileDivMod(xpos - TILE_MID_X);
}

/**
 * A character's weight is a little behind its sprite; this is the x the
 * column is worked out from.
 */
export function weightX(state: CharacterState, frame: Frame): number {
  return forwardX(state, frame.dx - (frame.flags & FRAME_FLAG.weightX));
}

export function determineColumn(state: CharacterState, frame: Frame): number {
  return tileDivModM7(weightX(state, frame)).column;
}

/** How far the character is from the near edge of the tile it is on. */
export function distanceToEdge(state: CharacterState, xpos: number): number {
  const { offset } = tileDivModM7(xpos);
  return state.direction === 0 ? TILE_RIGHT_X - offset : offset;
}

export function distanceToEdgeWeight(state: CharacterState, frame: Frame): number {
  return distanceToEdge(state, weightX(state, frame));
}

export interface Collision {
  xLeft: number;
  xRight: number;
  xLeftColl: number;
  xRightColl: number;
}

/**
 * The character's horizontal extent in internal units, from its sprite's
 * width. "Thin" frames count as four units narrower on each side.
 */
export function charCollision(
  state: CharacterState, frame: Frame, objX: number, spriteWidth: number,
): Collision {
  const halfWidth = Math.trunc((spriteWidth + 1) / 2);
  let xLeft = Math.trunc(objX / 2) + SCREENSPACE_X;
  if (state.direction >= 0) xLeft -= halfWidth;
  const xRight = xLeft + halfWidth;
  let xLeftColl = xLeft;
  let xRightColl = xRight;
  if (frame.flags & FRAME_FLAG.thin) {
    xLeftColl += 4;
    xRightColl -= 4;
  }
  return { xLeft, xRight, xLeftColl, xRightColl };
}

/** Distance from the wall the character is walking towards, or -1. */
export function distanceFromWallForward(
  state: CharacterState, tileType: number, tileColumn: number, coll: Collision,
  knownType?: number,
): number {
  const type = knownType ?? wallType(tileType);
  if (type === 0) return -1;
  const tileLeft = X_BUMP[tileColumn + FIRST_ONSCREEN_COLUMN] + TILE_MID_X;
  if (state.direction < 0) {
    return coll.xLeftColl - (tileLeft + TILE_RIGHT_X - WALL_DIST_FROM_RIGHT[type]);
  }
  return WALL_DIST_FROM_LEFT[type] + tileLeft - coll.xRightColl;
}

export interface EdgeResult {
  distance: number;
  edgeType: number;
}

/**
 * How far the character can go forward before something stops it, and what
 * that something is. A wall stops it short; an open floor does not.
 */
export function getEdgeDistance(
  world: World, state: CharacterState, frame: Frame, objX: number,
  spriteWidth: number, spriteHeight: number,
): EdgeResult {
  const coll = charCollision(state, frame, objX, spriteWidth);
  const here = getTile(world, state.room, state.currentColumn, state.currentRow);

  const classify = (distance: number): EdgeResult =>
    distance <= TILE_RIGHT_X
      ? { distance, edgeType: EDGE_TYPE.wall }
      : { distance: 11, edgeType: EDGE_TYPE.floor };

  const hereWall = wallTypeAt(world, here, spriteHeight);
  if (hereWall !== 0) {
    const d = distanceFromWallForward(
      state, here.type, state.currentColumn, coll, hereWall,
    );
    if (d >= 0) return classify(d);
  }

  const frontColumn = DIR_FRONT[state.direction + 1] + state.currentColumn;
  const front = getTile(world, state.room, frontColumn, state.currentRow);

  if (front.type === TILE.doortop && state.direction >= 0) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.closer };
  }
  const frontWall = wallTypeAt(world, front, spriteHeight);
  if (frontWall !== 0) {
    const d = distanceFromWallForward(state, front.type, frontColumn, coll, frontWall);
    if (d >= 0) return classify(d);
  }
  if (front.type === TILE.loose) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.closer };
  }
  if (front.type === TILE.closer || front.type === TILE.sword || front.type === TILE.potion) {
    const d = distanceToEdgeWeight(state, frame);
    return { distance: d, edgeType: d !== 0 ? EDGE_TYPE.closer : EDGE_TYPE.floor };
  }
  if (!tileIsFloor(front.type)) {
    return { distance: distanceToEdgeWeight(state, frame), edgeType: EDGE_TYPE.floor };
  }
  return { distance: 11, edgeType: EDGE_TYPE.floor };
}

/** Does the character have something to stand on? */
export function hasFloorUnder(world: World, state: CharacterState): boolean {
  const t = getTile(world, state.room, state.currentColumn, state.currentRow);
  return tileIsFloor(t.type);
}

export function floorHeightOfRow(row: number): number {
  return Y_LAND[row + 1];
}
