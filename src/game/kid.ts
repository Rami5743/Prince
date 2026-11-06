/**
 * The Prince: what the controls do to him, and what one frame of the game
 * does to him.
 *
 * This follows the original's shape. Once a frame, his sequence is consulted
 * for what he may do next (`control`), then the sequence byte-code is run for
 * one frame, then gravity and the floor are applied. Movement itself is not
 * computed here at all -- it comes out of the byte-code, which is the
 * original's own.
 *
 * What is implemented so far: standing, turning, running, stopping, stepping
 * up to an edge, and falling with its landings. Jumping, climbing, crouching
 * and sword play are not yet here.
 */
import type { CharacterState } from './character.ts';
import { forwardX } from './character.ts';
import type { ExeTables, Frame } from './exe-tables.ts';
import { startSequence, playSequence, SEQ, ACTION, type SequenceEffects } from './sequence.ts';
import {
  type World, EDGE_TYPE, getEdgeDistance, getTile, determineColumn,
  distanceToEdgeWeight, floorHeightOfRow, FALLING_SPEED_ACCEL, FALLING_SPEED_MAX,
  DIR_FRONT, TILE_RIGHT_X, TILE_SIZE_Y, charCollision,
} from './physics.ts';
import { TILE, tileIsFloor } from './tiles.ts';

/** Sequence ids this module uses, in the original's numbering. */
export const KID_SEQ = {
  startRun: 1,
  stand: 2,
  turn: 5,
  runTurn: 6,
  fall: 7,
  runStop: 13,
  softLand: 17,
  mediumLand: 20,
  /** 29..42: step forward by 1..14 units, to stop exactly at an edge. */
  stepBase: 28,
  startRunAfterTurn: 43,
  stepOnEdge: 44,
  unsafeStep: 39,
} as const;

export const FRAME = {
  startRunFirst: 1,
  runLast: 14,
  stand: 15,
  turnFirst: 45,
  turnMid: 48,
  turnEnd: 50,
  turnLast: 52,
  run1: 7,
  run2: 11,
  run9: 9,
  run13: 13,
} as const;

/** What the player is asking for this frame. */
export interface Controls {
  /** -1 left, 0 none, 1 right. */
  x: number;
  /** -1 up, 0 none, 1 down. */
  y: number;
  shift: boolean;
}

export interface KidContext {
  readonly tables: ExeTables;
  readonly world: World;
  /** Sprite widths, so collisions use the real artwork. */
  spriteWidth(image: number): number;
  readonly effects?: SequenceEffects;
}

function frameOf(tables: ExeTables, state: CharacterState): Frame {
  return tables.frameTableKid[state.frame] ?? tables.frameTableKid[0];
}

/** obj_x, the horizontal position the renderer and collisions both use. */
export function objectX(state: CharacterState, frame: Frame): number {
  let x = (forwardX(state, frame.dx) << 1) - 116;
  if ((((frame.flags ^ state.direction) << 24) >> 24) >= 0) x += 1;
  return x;
}

/** Is the character facing the way the player is pushing? */
function forwardHeld(state: CharacterState, controls: Controls): boolean {
  if (controls.x === 0) return false;
  return state.direction < 0 ? controls.x < 0 : controls.x > 0;
}

function backwardHeld(state: CharacterState, controls: Controls): boolean {
  if (controls.x === 0) return false;
  return state.direction < 0 ? controls.x > 0 : controls.x < 0;
}

/**
 * Decide what the Prince does next, from what he is doing now and what the
 * player is pressing. This is the original's `control`, restricted to the
 * moves that are implemented.
 */
export function control(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (state.alive >= 0) return;
  const f = state.frame;
  if (state.action === ACTION.bumped || state.action === ACTION.inFreefall) return;

  if (f === FRAME.stand || (f >= FRAME.turnEnd && f < 53)) {
    controlStanding(state, controls, ctx);
  } else if (f === FRAME.turnMid) {
    controlTurning(state, controls, ctx);
  } else if (f < 4) {
    controlStartRun(state, controls, ctx);
  } else if (f < 15) {
    controlRunning(state, controls, ctx);
  }
}

function controlStanding(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (controls.shift) {
    if (backwardHeld(state, controls)) {
      startSequence(state, KID_SEQ.turn, ctx.tables);
    } else if (forwardHeld(state, controls)) {
      safeStep(state, ctx);
    }
    return;
  }
  if (forwardHeld(state, controls)) {
    forwardPressed(state, ctx);
  } else if (backwardHeld(state, controls)) {
    startSequence(state, KID_SEQ.turn, ctx.tables);
  }
}

function controlTurning(state: CharacterState, controls: Controls, ctx: KidContext): void {
  // The turn can roll straight into a run if the player keeps pushing the
  // way he is now facing.
  if (!controls.shift && forwardHeld(state, controls) && controls.y >= 0) {
    startSequence(state, KID_SEQ.startRunAfterTurn, ctx.tables);
  }
}

function controlStartRun(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (backwardHeld(state, controls)) {
    startSequence(state, KID_SEQ.turn, ctx.tables);
  }
}

function controlRunning(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (controls.x === 0 && (state.frame === FRAME.run1 || state.frame === FRAME.run2)) {
    startSequence(state, KID_SEQ.runStop, ctx.tables);
  } else if (backwardHeld(state, controls)) {
    startSequence(state, KID_SEQ.runTurn, ctx.tables);
  }
}

function forwardPressed(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world, state, frame, objX, ctx.spriteWidth(frame.image),
  );
  const front = getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
  if (edgeType === EDGE_TYPE.wall && front.type !== TILE.chomper && distance < 8) {
    // Too close to a wall to break into a run; take a step instead.
    safeStep(state, ctx);
  } else {
    startSequence(state, KID_SEQ.startRun, ctx.tables);
  }
}

/** Step forward exactly as far as the edge allows. */
function safeStep(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world, state, frame, objX, ctx.spriteWidth(frame.image),
  );
  if (distance) {
    state.repeat = 1;
    startSequence(state, KID_SEQ.stepBase + Math.min(distance, 14), ctx.tables);
  } else if (edgeType !== EDGE_TYPE.wall && state.repeat !== 0) {
    state.repeat = 0;
    startSequence(state, KID_SEQ.stepOnEdge, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.unsafeStep, ctx.tables);
  }
}

/** Begin falling from wherever the character is standing. */
export function startFall(state: CharacterState, ctx: KidContext): void {
  state.sword = 0;
  state.currentRow += 1;
  startSequence(state, KID_SEQ.fall, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  const frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);
}

function land(state: CharacterState, ctx: KidContext): void {
  state.y = floorHeightOfRow(state.currentRow);
  const frame = frameOf(ctx.tables, state);
  const front = getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
  if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
    // Landed with his toes over the edge: shuffle back onto the floor.
    state.x = forwardX(state, -3) & 0xff;
  }
  startSequence(state, state.fallY < 22 ? KID_SEQ.softLand : KID_SEQ.mediumLand, ctx.tables);
  state.fallY = 0;
  state.fallX = 0;
}

function doFall(state: CharacterState, ctx: KidContext): void {
  if (floorHeightOfRow(state.currentRow) > state.y) return; // still in the air
  if (hasFloorAt(state, ctx)) land(state, ctx);
  else state.currentRow += 1;
}

function hasFloorAt(state: CharacterState, ctx: KidContext): boolean {
  const t = getTile(ctx.world, state.room, state.currentColumn, state.currentRow);
  return tileIsFloor(t.type);
}

function checkOnFloor(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  if (!(frame.flags & 0x40)) return; // this frame does not need a floor
  if (!hasFloorAt(state, ctx)) startFall(state, ctx);
}

/**
 * What to check after a frame, by what the character is doing. Only a
 * character that is meant to be supported is tested against the floor, which
 * is why the frames of a fall do not start another fall.
 */
function checkAction(state: CharacterState, ctx: KidContext): void {
  const action = state.action;
  if (action === ACTION.hangStraight || action === ACTION.bumped) {
    if (state.frame === 109) checkOnFloor(state, ctx);
  } else if (action === ACTION.inFreefall) {
    doFall(state, ctx);
  } else if (action === ACTION.inMidair) {
    // frames 102..105 are the start of a fall, where the original checks
    // whether the character can grab a ledge. Grabbing is not implemented.
  } else if (action !== ACTION.hangClimb) {
    checkOnFloor(state, ctx);
  }
}

/** Advance the Prince by one frame of the game. */
export function stepKid(state: CharacterState, controls: Controls, ctx: KidContext): void {
  control(state, controls, ctx);

  playSequence(state, { tables: ctx.tables, effects: ctx.effects });

  // Gravity: the speed builds only in free fall, but whatever speed the
  // character has is always applied.
  if (state.action === ACTION.inFreefall) {
    state.fallY = Math.min(state.fallY + FALLING_SPEED_ACCEL, FALLING_SPEED_MAX);
  }
  state.y = (state.y + state.fallY) & 0xff;
  if (state.action === ACTION.inFreefall) {
    state.x = forwardX(state, state.fallX) & 0xff;
  }

  const frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);

  checkAction(state, ctx);

  const leave = leaveDirection(state, ctx);
  if (leave >= 0) {
    gotoOtherRoom(state, leave, ctx);
    state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
  }

  // Falling out of the level is fatal, as it is in the original.
  if (state.room === 0 && state.alive < 0) {
    state.alive = 0;
  }
}

/** Row a given height falls in, counting the row above the room as -1. */
export function yToRow(y: number): number {
  return (Math.trunc((y + 60) / TILE_SIZE_Y) % 4) - 1;
}

/**
 * Which way the character is leaving the room, or -1 if it is staying.
 * The original refuses to change rooms during certain animations, which is
 * why a climb or a turn never carries you across a boundary.
 */
function leaveDirection(state: CharacterState, ctx: KidContext): number {
  const y = state.y;
  const sy = (y << 24) >> 24;
  const f = state.frame;
  if (state.action !== ACTION.bumped && state.action !== ACTION.inFreefall
    && state.action !== ACTION.inMidair && sy < 10 && sy > -16) {
    return 2; // up
  }
  if (y >= 211) return 3; // down
  if ((f >= 135 && f < 150) || (f >= 110 && f < 120) || (f >= 150 && f < 163)
    || (f >= 166 && f < 169) || state.action === ACTION.turning) {
    return -1;
  }
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const coll = charCollision(state, frame, objX, ctx.spriteWidth(frame.image));
  if (state.direction !== 0) {
    if (coll.xLeft <= 54) return 0;
    if (coll.xLeft >= 198) return 1;
    return -1;
  }
  const edge = getTile(ctx.world, state.room, 9, state.currentRow);
  if (edge.type !== TILE.doortopWithFloor && edge.type !== TILE.doortop
    && coll.xRight >= 201) {
    return 1;
  }
  if (coll.xRight <= 57) return 0;
  return -1;
}

/** Move the character into the neighbouring room. */
function gotoOtherRoom(state: CharacterState, direction: number, ctx: KidContext): void {
  state.room = ctx.world.linkOf(state.room, direction);
  if (direction === 0) state.x = (state.x + 140) & 0xff;
  else if (direction === 1) state.x = (state.x - 140) & 0xff;
  else if (direction === 2) {
    state.y = (state.y + 189) & 0xff;
    state.currentRow = yToRow(state.y);
  } else {
    state.y = (state.y - 189) & 0xff;
    state.currentRow = yToRow(state.y);
  }
}

/** Put the Prince where a level says he starts, and face him the right way. */
export function enterLevel(
  state: CharacterState, startRoom: number, startPos: number, startDir: number,
  ctx: KidContext,
): void {
  state.room = startRoom;
  state.currentColumn = startPos % 10;
  state.currentRow = Math.floor(startPos / 10);
  state.x = (X_BUMP_START(state.currentColumn)) & 0xff;
  state.y = floorHeightOfRow(state.currentRow);
  // The game faces him the wrong way, then plays the turn that rights him.
  state.direction = ~startDir;
  state.alive = -1;
  state.fallX = 0;
  state.fallY = 0;
  startSequence(state, KID_SEQ.turn, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
}

function X_BUMP_START(column: number): number {
  // standX, inlined to avoid a cycle with geometry's screen helpers.
  const X_BUMP = [
    -12, 2, 16, 30, 44, 58, 72, 86, 100, 114,
    128, 142, 156, 170, 184, 198, 212, 226, 240, 254,
  ];
  return X_BUMP[column + 5] + 14;
}

export { TILE_RIGHT_X };
