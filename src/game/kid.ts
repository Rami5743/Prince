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
  DIR_FRONT, DIR_BEHIND, TILE_RIGHT_X, TILE_SIZE_Y, charCollision,
  tileDivModM7, weightX, distanceToEdge, wallTypeAt, distanceFromWallForward,
} from './physics.ts';
import { TILE, tileIsFloor } from './tiles.ts';
import {
  SWORD_SEQ, SWORD_DRAWN, SWORD_RANGE, isReady, facingOf, withinReach,
} from './sword.ts';
import { CONTROL, ControlLatch, type Controls } from './control-latch.ts';

/** The original's 16-bit unsigned view of a value. */
const u16 = (v: number): number => v & 0xffff;

/** Sequence ids this module uses, in the original's numbering. */
export const KID_SEQ = {
  startRun: 1,
  stand: 2,
  standingJump: 3,
  runJump: 4,
  turn: 5,
  runTurn: 6,
  fall: 7,
  /** The run a level that opens at a run starts with. */
  runEntry: 84,
  jumpUpAndGrabStraight: 8,
  hang: 9,
  climbUp: 10,
  releaseLedgeAndLand: 11,
  runStop: 13,
  jumpUpIntoCeiling: 14,
  grabLedgeMidair: 15,
  jumpUpAndGrab: 16,
  softLand: 17,
  mediumLand: 20,
  releaseLedgeAndFall: 23,
  jumpUpAndGrabForward: 24,
  hangAgainstWall: 25,
  crouchWhileRunning: 26,
  jumpUpWithNothingAbove: 28,
  /** 29..42: step forward by 1..14 units, to stop exactly at an edge. */
  stepBase: 28,
  startRunAfterTurn: 43,
  stepOnEdge: 44,
  standUpFromCrouch: 49,
  crouch: 50,
  climbDown: 68,
  climbUpToClosedGate: 73,
  /** The landing that kills: a fall of three rows or more. */
  crushed: 52,
  /** Landing on spikes: `knockDown`, `dx 4`, frame 177, `die`. */
  spiked: 51,
  unsafeStep: 39,
  /** Picking the sword up off the floor; its byte-code raises `getItem 1`. */
  pickUpSword: 91,
  /** Walking into a wall. Its own byte-code reads `action 5`, `dx -4`. */
  bump: 47,
} as const;

export const FRAME = {
  startRunFirst: 1,
  run7: 7,
  runLast: 14,
  stand: 15,
  startJumpUp: 67,
  jumpHang: 70,
  hangingFirst: 87,
  crouch: 109,
  turnFirst: 45,
  turnMid: 48,
  turnEnd: 50,
  turnLast: 52,
  run1: 7,
  run2: 11,
} as const;

/** What the player is asking for this frame. */
export type { Controls };

/** What the Prince can set off in the room around him. */
export interface TrapHooks {
  pressButton(room: number, tilePos: number): void;
  makeLooseFall(room: number, tilePos: number): void;
  startChompers(room: number, row: number): void;
  chomperHarm(room: number, tilePos: number): boolean;
  bloodyChomper(room: number, tilePos: number): void;
  startSpike(room: number, tilePos: number): void;
  /** Drive these spikes straight out, for a character landing on them. */
  impaleOnSpikes(room: number, tilePos: number): void;
  /** 0 harmless, 1 out and deadly, 2 coming out and deadly to a runner. */
  spikeHarm(room: number, tilePos: number): number;
}

export interface KidContext {
  readonly tables: ExeTables;
  readonly world: World;
  /** Sprite widths, so collisions use the real artwork. */
  spriteWidth(image: number): number;
  /** Sprite heights, so a character only fits under a gate he fits under. */
  spriteHeight(image: number): number;
  readonly effects?: SequenceEffects;
  /** What the player is pressing this frame; some checks need it mid-frame. */
  controls: Controls;
  /** Which of those presses have not been acted on yet. */
  readonly latch: ControlLatch;
  readonly traps?: TrapHooks;
  /** Take hit points off the Prince. Returns true if that killed him. */
  damage?(amount: number): boolean;
  /** The guard of the room, if there is one, for sword play. */
  opponent?(): CharacterState | null;
  /** Has the Prince picked up a sword? Without one he cannot draw. */
  hasSword?(): boolean;
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
  if (controlSwordPlay(state, controls, ctx)) return;

  if (f === FRAME.stand || (f >= FRAME.turnEnd && f < 53)) {
    controlStanding(state, controls, ctx);
  } else if (f === FRAME.turnMid) {
    controlTurning(state, controls, ctx);
  } else if (f < 4) {
    controlStartRun(state, controls, ctx);
  } else if (f >= FRAME.startJumpUp && f < FRAME.jumpHang) {
    controlJumpUp(state, controls, ctx);
  } else if (f < 15) {
    controlRunning(state, controls, ctx);
  } else if (f >= FRAME.hangingFirst && f < 100) {
    controlHanging(state, controls, ctx);
  } else if (f === FRAME.crouch) {
    controlCrouched(state, controls, ctx);
  }
}

/**
 * How close an armed guard has to be before the Prince draws. Wider than a
 * blade's reach, so that he is ready before he is in danger.
 */
const DRAW_SWORD_RANGE = SWORD_RANGE * 3;

/**
 * Sword play, which takes the controls over entirely while the blade is
 * out. Returns true when it has dealt with the frame.
 *
 * Drawing is automatic, as it is in the original: an armed guard on the
 * same row, close enough to matter, and the Prince turns to face him and
 * draws. Sheathing is automatic too, once there is nothing left to fight.
 */
function controlSwordPlay(
  state: CharacterState, controls: Controls, ctx: KidContext,
): boolean {
  const foe = ctx.opponent?.() ?? null;
  const engaged = foe !== null && foe.alive < 0 && foe.sword === SWORD_DRAWN
    && foe.room === state.room && foe.currentRow === state.currentRow
    && Math.abs(foe.x - state.x) <= DRAW_SWORD_RANGE;

  if (state.sword !== SWORD_DRAWN) {
    // No sword, no drawing it. On level 1 the Prince has not got one until
    // he picks it up, and the guard of room 3 stands between him and the
    // room it lies in -- so meeting that guard is meant to be something to
    // run away from, and a Prince who draws a blade he has never picked up
    // turns the opening level into a fight it was never meant to be.
    if (ctx.hasSword && !ctx.hasSword()) return false;
    // Drawing happens on the way in, not only from a standstill: the
    // original's Prince stops out of a run when he comes up on a guard. He
    // has to have his feet on the floor of his row, though -- a jump or a
    // fall finishes first.
    const onFoot = state.y === floorHeightOfRow(state.currentRow)
      && state.action !== ACTION.inFreefall && state.action !== ACTION.inMidair
      && state.action !== ACTION.hangClimb && state.action !== ACTION.hangStraight;
    if (!engaged || foe === null || !onFoot) return false;
    state.direction = facingOf(state, foe);
    state.sword = SWORD_DRAWN;
    startSequence(state, SWORD_SEQ.enGarde, ctx.tables);
    ctx.latch.releaseArrows();
    return true;
  }

  // Mid-move: the sequence finishes on its own.
  if (!isReady(state)) return true;

  if (!engaged || foe === null) {
    // Nothing left to fight; put it away and go back to standing.
    state.sword = 0;
    startSequence(state, SEQ.stand, ctx.tables);
    return true;
  }

  const latch = ctx.latch;
  // The original's fighting controls, as the manual gives them: Shift
  // strikes, Up parries, Down puts the blade away, forward and back close
  // and open the distance. Strike and parry are one-shot -- a held key does
  // it once -- so they go through the latch; stepping repeats, so it reads
  // the keys.
  if (latch.shift2 === CONTROL.held) {
    latch.shift2 = CONTROL.ignore;
    latch.releaseArrows();
    startSequence(state, SWORD_SEQ.strike, ctx.tables);
  } else if (latch.up === CONTROL.held) {
    latch.up = latch.releaseArrows();
    startSequence(state, SWORD_SEQ.block, ctx.tables);
  } else if (state.direction !== facingOf(state, foe)) {
    startSequence(state, SWORD_SEQ.turn, ctx.tables);
  } else if (forwardHeld(state, controls)) {
    // Only up to the point of the blade. Stepping in past that would walk
    // him through the guard, which is how a guard used to be got past:
    // hold forward, take a couple of hits, carry on.
    if (!withinReach(state, foe)) startSequence(state, SWORD_SEQ.advance, ctx.tables);
  } else if (backwardHeld(state, controls)) {
    startSequence(state, SWORD_SEQ.retreat, ctx.tables);
  }
  return true;
}

/** Looking up at the tile above, can the character take hold of it? */
function canGrab(ctx: KidContext, through: number, target: number, direction: number,
  targetModifier: number): boolean {
  if (through === TILE.wall) return false;
  if (through === TILE.doortop && direction >= 0) return false;
  if (tileIsFloor(through)) return false;
  if (target === TILE.loose && targetModifier !== 0) return false;
  if (target === TILE.doortopWithFloor && direction < 0) return false;
  if (!tileIsFloor(target)) return false;
  return true;
}

function tileAbove(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room, state.currentColumn, state.currentRow - 1);
}

function tileFrontAbove(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow - 1);
}

function tileBehindAbove(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room,
    DIR_BEHIND[state.direction + 1] + state.currentColumn, state.currentRow - 1);
}

function tileBehind(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room,
    DIR_BEHIND[state.direction + 1] + state.currentColumn, state.currentRow);
}

function tileHere(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room, state.currentColumn, state.currentRow);
}

function modifierOf(ctx: KidContext, t: { room: number; column: number; row: number }): number {
  return t.room ? ctx.world.modifierAt(t.room, t.column, t.row) : 0;
}

function controlJumpUp(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (forwardHeld(state, controls) || ctx.latch.forward === CONTROL.held) {
    standingJump(state, ctx);
  }
}

function standingJump(state: CharacterState, ctx: KidContext): void {
  ctx.latch.up = CONTROL.ignore;
  ctx.latch.forward = CONTROL.ignore;
  startSequence(state, KID_SEQ.standingJump, ctx.tables);
}

/** Up: climb what is above if it can be reached, otherwise jump. */
function upPressed(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (forwardHeld(state, controls)) {
    standingJump(state, ctx);
    return;
  }
  checkJumpUp(state, ctx);
}

function checkJumpUp(state: CharacterState, ctx: KidContext): void {
  ctx.latch.up = ctx.latch.releaseArrows();
  const above = tileAbove(state, ctx);
  const frontAbove = tileFrontAbove(state, ctx);
  if (canGrab(ctx, above.type, frontAbove.type, state.direction, modifierOf(ctx, frontAbove))) {
    grabUpWithFloorBehind(state, ctx);
    return;
  }
  const behindAbove = tileBehindAbove(state, ctx);
  if (canGrab(ctx, behindAbove.type, above.type, state.direction, modifierOf(ctx, above))) {
    jumpUpOrGrab(state, ctx);
  } else {
    jumpUp(state, ctx);
  }
}

function jumpUpOrGrab(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  const distance = distanceToEdgeWeight(state, frame);
  if (distance < 6) {
    jumpUp(state, ctx);
  } else if (!tileIsFloor(tileBehind(state, ctx).type)) {
    state.x = forwardX(state, distanceToEdgeWeight(state, frame) - 10) & 0xff;
    startSequence(state, KID_SEQ.jumpUpAndGrab, ctx.tables);
  } else {
    state.x = forwardX(state, distance - 14) & 0xff;
    state.currentColumn = determineColumn(state, frame);
    grabUpWithFloorBehind(state, ctx);
  }
}

function grabUpWithFloorBehind(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  const distance = distanceToEdgeWeight(state, frame);
  const edge = getEdgeDistance(
    ctx.world, state, frame, objectX(state, frame),
    ctx.spriteWidth(frame.image), ctx.spriteHeight(frame.image),
  );
  if (distance < 4 && edge.distance < 4 && edge.edgeType !== EDGE_TYPE.wall) {
    state.x = forwardX(state, distance) & 0xff;
    startSequence(state, KID_SEQ.jumpUpAndGrabStraight, ctx.tables);
  } else {
    state.x = forwardX(state, distance - 4) & 0xff;
    startSequence(state, KID_SEQ.jumpUpAndGrabForward, ctx.tables);
  }
}

function jumpUp(state: CharacterState, ctx: KidContext): void {
  ctx.latch.up = ctx.latch.releaseArrows();
  const frame = frameOf(ctx.tables, state);
  const edge = getEdgeDistance(
    ctx.world, state, frame, objectX(state, frame),
    ctx.spriteWidth(frame.image), ctx.spriteHeight(frame.image),
  );
  if (edge.distance < 4 && edge.edgeType === EDGE_TYPE.wall) {
    state.x = forwardX(state, edge.distance - 3) & 0xff;
  }
  const column = tileDivModM7(weightX(state, frame) - 6).column;
  const above = getTile(ctx.world, state.room, column, state.currentRow - 1);
  if (above.type !== TILE.wall && !tileIsFloor(above.type)) {
    startSequence(state, KID_SEQ.jumpUpWithNothingAbove, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.jumpUpIntoCeiling, ctx.tables);
  }
}

/** Down: climb down over an edge behind, or crouch. */
function downPressed(state: CharacterState, ctx: KidContext): void {
  ctx.latch.down = CONTROL.ignore;
  const frame = frameOf(ctx.tables, state);
  const front = getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
  if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
    state.x = forwardX(state, 5) & 0xff;
    state.currentColumn = determineColumn(state, frame);
    return;
  }
  const behind = tileBehind(state, ctx);
  const here = tileHere(state, ctx);
  if (!tileIsFloor(behind.type) && distanceToEdgeWeight(state, frame) >= 8
    && canGrab(ctx, behind.type, here.type, state.direction, modifierOf(ctx, here))) {
    state.x = forwardX(state, distanceToEdgeWeight(state, frame) - 9) & 0xff;
    startSequence(state, KID_SEQ.climbDown, ctx.tables);
  } else {
    startSequence(state, KID_SEQ.crouch, ctx.tables);
    ctx.latch.down = ctx.latch.releaseArrows();
  }
}

function controlCrouched(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (controls.y <= 0) startSequence(state, KID_SEQ.standUpFromCrouch, ctx.tables);
}

function controlHanging(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (state.alive >= 0) {
    hangFall(state, ctx);
    return;
  }
  // Up itself, not the latch. The latch was spent by the jump that got him
  // here -- `checkJumpUp` releases it -- so a player who presses Up at a
  // ledge and keeps it down would never climb, which is what the original
  // plainly does: with Up held and no Shift at all it takes hold and pulls
  // him up. The grab timer is what keeps the two ways of reaching a ledge
  // apart: a ledge caught while falling sets it, and until it runs down the
  // grip is Shift's to keep, which is what the careful-step captures pin.
  if (state.grabTimer === 0 && controls.y < 0) {
    canClimbUp(state, ctx);
    return;
  }
  if (controls.shift) {
    const here = tileHere(state, ctx);
    const againstWall = here.type === TILE.wall
      || (state.direction < 0
        && (here.type === TILE.doortopWithFloor || here.type === TILE.doortop));
    if (state.action !== ACTION.hangStraight && againstWall) {
      startSequence(state, KID_SEQ.hangAgainstWall, ctx.tables);
    } else if (!tileIsFloor(tileAbove(state, ctx).type)) {
      hangFall(state, ctx);
    }
    return;
  }
  hangFall(state, ctx);
}

function canClimbUp(state: CharacterState, ctx: KidContext): void {
  ctx.latch.shift2 = CONTROL.ignore;
  // The arrows are forgotten, but Up is not marked as used: the original
  // keeps going while it is held, jumping again as soon as the Prince is
  // back on his feet, and the level1-grab captures pin that. What must not
  // happen is the same thing after the key has been let go -- that is the
  // latch's own business, and `ControlLatch.step` clears a release.
  ctx.latch.releaseArrows();
  const above = tileAbove(state, ctx);
  let seq: number = KID_SEQ.climbUp;
  if (((above.type === TILE.mirror || above.type === TILE.chomper) && state.direction === 0)
    || (above.type === TILE.gate && state.direction !== 0
      && (modifierOf(ctx, above) >> 2) < 6)) {
    seq = KID_SEQ.climbUpToClosedGate;
  }
  startSequence(state, seq, ctx.tables);
}

function hangFall(state: CharacterState, ctx: KidContext): void {
  ctx.latch.down = ctx.latch.releaseArrows();
  const behind = tileBehind(state, ctx);
  const here = tileHere(state, ctx);
  if (!tileIsFloor(behind.type) && !tileIsFloor(here.type)) {
    startSequence(state, KID_SEQ.releaseLedgeAndFall, ctx.tables);
    return;
  }
  if (here.type === TILE.wall
    || (state.direction < 0
      && (here.type === TILE.doortopWithFloor || here.type === TILE.doortop))) {
    state.x = forwardX(state, -7) & 0xff;
  }
  startSequence(state, KID_SEQ.releaseLedgeAndLand, ctx.tables);
}

/**
 * While falling, Shift takes hold of a ledge if one is within reach and the
 * fall is not yet too fast.
 */
function checkGrab(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (!controls.shift || state.fallY >= 32 || state.alive >= 0) return;
  if (u16(floorHeightOfRow(state.currentRow)) > u16(state.y + 25)) return;
  const frame = frameOf(ctx.tables, state);
  const oldX = state.x;
  state.x = forwardX(state, -8) & 0xff;
  state.currentColumn = determineColumn(state, frame);
  const above = tileAbove(state, ctx);
  const frontAbove = tileFrontAbove(state, ctx);
  if (!canGrab(ctx, above.type, frontAbove.type, state.direction, modifierOf(ctx, frontAbove))) {
    state.x = oldX;
    state.currentColumn = determineColumn(state, frame);
    return;
  }
  state.x = forwardX(state, distanceToEdgeWeight(state, frame)) & 0xff;
  state.y = floorHeightOfRow(state.currentRow);
  state.fallY = 0;
  startSequence(state, KID_SEQ.grabLedgeMidair, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  state.grabTimer = 12;
}

function controlStanding(state: CharacterState, controls: Controls, ctx: KidContext): void {
  const latch = ctx.latch;
  if (controls.shift) {
    if (latch.backward === CONTROL.held) {
      backPressed(state, ctx);
    } else if (latch.up === CONTROL.held) {
      upPressed(state, controls, ctx);
    } else if (latch.down === CONTROL.held) {
      downPressed(state, ctx);
    } else if (forwardHeld(state, controls) && latch.forward === CONTROL.held) {
      // One careful step for each press of the key, not one a frame.
      safeStep(state, ctx);
    }
    return;
  }
  if (latch.forward === CONTROL.held) {
    if (latch.up === CONTROL.held) standingJump(state, ctx);
    else forwardPressed(state, ctx);
  } else if (latch.backward === CONTROL.held) {
    backPressed(state, ctx);
  } else if (latch.up === CONTROL.held) {
    if (latch.forward === CONTROL.held) standingJump(state, ctx);
    else upPressed(state, controls, ctx);
  } else if (latch.down === CONTROL.held) {
    downPressed(state, ctx);
  } else if (forwardHeld(state, controls)) {
    // Holding the key does keep him walking, even once the latch is spent.
    forwardPressed(state, ctx);
  }
}

/** Backward: turn round. */
function backPressed(state: CharacterState, ctx: KidContext): void {
  startSequence(state, KID_SEQ.turn, ctx.tables);
  ctx.latch.backward = ctx.latch.releaseArrows();
}

function controlTurning(state: CharacterState, controls: Controls, ctx: KidContext): void {
  // The turn can roll straight into a run if the player keeps pushing the
  // way he is now facing.
  if (!controls.shift && forwardHeld(state, controls) && controls.y >= 0) {
    startSequence(state, KID_SEQ.startRunAfterTurn, ctx.tables);
  }
}

function controlStartRun(state: CharacterState, controls: Controls, ctx: KidContext): void {
  if (controls.y < 0 && forwardHeld(state, controls)) standingJump(state, ctx);
}

function controlRunning(state: CharacterState, controls: Controls, ctx: KidContext): void {
  const latch = ctx.latch;
  if (controls.x === 0 && (state.frame === FRAME.run1 || state.frame === FRAME.run2)) {
    latch.forward = latch.releaseArrows();
    startSequence(state, KID_SEQ.runStop, ctx.tables);
  } else if (backwardHeld(state, controls)) {
    latch.backward = latch.releaseArrows();
    startSequence(state, KID_SEQ.runTurn, ctx.tables);
  } else if (controls.y < 0 && latch.up === CONTROL.held) {
    runJump(state, ctx);
  } else if (latch.down === CONTROL.held) {
    latch.down = CONTROL.ignore;
    startSequence(state, KID_SEQ.crouchWhileRunning, ctx.tables);
  }
}

/**
 * A running jump, lined up with the edge of the floor so that the Prince
 * leaves the ground from the right spot however he was running.
 */
function runJump(state: CharacterState, ctx: KidContext): void {
  if (state.frame < FRAME.run7) return;
  const xpos = forwardX(state, 4);
  let column = tileDivModM7(xpos).column;
  for (let ahead = 0; ahead < 2; ahead++) {
    column += DIR_FRONT[state.direction + 1];
    const t = getTile(ctx.world, state.room, column, state.currentRow);
    if (t.type !== TILE.spike && tileIsFloor(t.type)) continue;
    // There is an edge within two tiles: line up with it, or refuse the
    // jump. The original's test is an unsigned one, which lets through only
    // an adjustment of -8..-1; anything else either cancels the jump or,
    // past 127, becomes a fixed step back.
    let adjust = distanceToEdge(state, xpos) + 14 * ahead - 14;
    if ((adjust & 0xffff) < 0xfff8 || adjust >= 2) {
      if (adjust < 128) return; // too far from the edge to jump from here
      adjust = -3;
    }
    state.x = forwardX(state, adjust + 4) & 0xff;
    break;
  }
  ctx.latch.up = ctx.latch.releaseArrows();
  startSequence(state, KID_SEQ.runJump, ctx.tables);
}

function forwardPressed(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world, state, frame, objX, ctx.spriteWidth(frame.image),
    ctx.spriteHeight(frame.image),
  );
  const front = getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
  if (edgeType === EDGE_TYPE.wall && front.type !== TILE.chomper && distance < 8) {
    // Too close to a wall to break into a run; take a step instead -- and
    // only one, however long the key is held.
    safeStep(state, ctx);
  } else {
    startSequence(state, KID_SEQ.startRun, ctx.tables);
  }
}

/** Step forward exactly as far as the edge allows. */
function safeStep(state: CharacterState, ctx: KidContext): void {
  ctx.latch.shift2 = CONTROL.ignore;
  ctx.latch.forward = CONTROL.ignore;
  const frame = frameOf(ctx.tables, state);
  const objX = objectX(state, frame);
  const { distance, edgeType } = getEdgeDistance(
    ctx.world, state, frame, objX, ctx.spriteWidth(frame.image),
    ctx.spriteHeight(frame.image),
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
  ctx.traps?.startChompers(state.room, state.currentRow);
  startSequence(state, KID_SEQ.fall, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  const frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);
}

function land(state: CharacterState, ctx: KidContext): void {
  state.y = floorHeightOfRow(state.currentRow);
  ctx.traps?.startChompers(state.room, state.currentRow);
  // Spikes kill whatever falls into them, out or not. `checkSpiked` cannot
  // do this: it asks whether the blades are already deadly and lets anyone
  // in the air past, which is right for a leap across a set of them and
  // wrong for a landing. The capture of level 1 has the Prince run off the
  // ledge in room 6 and come down on the spikes of the bottom row; the
  // original impales him there and restarts the level, while the port
  // charged him one hit point and let him walk away with two.
  const under = tileHere(state, ctx);
  if (under.type === TILE.spike && under.room) {
    ctx.traps?.impaleOnSpikes(under.room, under.row * 10 + under.column);
    state.fallY = 0;
    state.fallX = 0;
    state.alive = 0;
    startSequence(state, KID_SEQ.spiked, ctx.tables);
    return;
  }
  const frame = frameOf(ctx.tables, state);
  const front = getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
  if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
    // Landed with his toes over the edge: shuffle back onto the floor.
    state.x = forwardX(state, -3) & 0xff;
  }
  // How far he fell decides what it costs him: one row is free, two rows
  // cost a hit point, three or more are fatal.
  if (state.fallY < 22) {
    startSequence(state, KID_SEQ.softLand, ctx.tables);
  } else if (state.fallY < 33) {
    if (ctx.damage?.(1)) {
      state.alive = 0;
      startSequence(state, KID_SEQ.crushed, ctx.tables);
    } else {
      startSequence(state, KID_SEQ.mediumLand, ctx.tables);
    }
  } else {
    ctx.damage?.(100);
    state.alive = 0;
    startSequence(state, KID_SEQ.crushed, ctx.tables);
  }
  state.fallY = 0;
  state.fallX = 0;
}

function doFall(state: CharacterState, ctx: KidContext): void {
  // The original compares these as unsigned words, which matters above the
  // top row, whose floor height is -8: as a word that is larger than any y,
  // so a character up there counts as still in the air.
  if (u16(floorHeightOfRow(state.currentRow)) > u16(state.y)) {
    // Still in the air, and so still able to take hold of a ledge.
    checkGrab(state, ctx.controls, ctx);
    return;
  }
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
    if (state.frame >= 102 && state.frame < 106) checkGrab(state, ctx.controls, ctx);
  } else if (action !== ACTION.hangClimb) {
    checkOnFloor(state, ctx);
  }
}

/**
 * Whatever the Prince is standing on, hanging from, or has just jumped into
 * gets a chance to react: buttons go down, loose floors start to give.
 */
function checkPress(state: CharacterState, ctx: KidContext): void {
  if (!ctx.traps) return;
  const frame = frameOf(ctx.tables, state);
  const f = state.frame;
  let tile: { type: number; room: number; column: number; row: number };
  if ((f >= FRAME.hangingFirst && f < 100) || (f >= 135 && f < 141)) {
    // What he is hanging from is what he presses.
    tile = tileAbove(state, ctx);
  } else if (state.action === ACTION.turning || state.action === ACTION.bumped
    || state.action < ACTION.hangClimb) {
    if (f === 79 && tileAbove(state, ctx).type === TILE.loose) {
      const above = tileAbove(state, ctx);
      ctx.traps.makeLooseFall(above.room, above.row * 10 + above.column);
      return;
    }
    if (!(frame.flags & 0x40)) return;
    tile = tileHere(state, ctx);
  } else {
    return;
  }
  if (!tile.room) return;
  const tilePos = tile.row * 10 + tile.column;
  if (tile.type === TILE.opener || tile.type === TILE.closer) {
    ctx.traps.pressButton(tile.room, tilePos);
  } else if (tile.type === TILE.loose) {
    ctx.traps.makeLooseFall(tile.room, tilePos);
  }
}

/**
 * Spikes under the Prince come out. The original walks down from his row
 * through empty tiles, so spikes a floor or two below still wake up.
 */
function checkSpikeBelow(state: CharacterState, ctx: KidContext): void {
  if (!ctx.traps) return;
  const frame = frameOf(ctx.tables, state);
  const coll = charCollision(state, frame, objectX(state, frame), ctx.spriteWidth(frame.image));
  const rightColumn = tileDivModM7(coll.xRight).column;
  if (rightColumn < 0) return;
  for (let column = tileDivModM7(coll.xLeft).column; column <= rightColumn; column++) {
    let row = state.currentRow;
    for (let guard = 0; guard < 4; guard++) {
      const t = getTile(ctx.world, state.room, column, row);
      if (t.type === TILE.spike) {
        ctx.traps.startSpike(t.room, t.row * 10 + t.column);
        break;
      }
      if (tileIsFloor(t.type) || t.room === 0 || row > 2) break;
      row += 1;
    }
  }
}

/**
 * Spikes that are out kill whoever is standing in them.
 *
 * This used to be the other way round -- only a *runner* was killed, and
 * only by spikes on their way up -- which let the Prince stand in a full
 * set of blades indefinitely. A grabbed video of the recorded play shows
 * what the original does with that: he walks into the spikes of level 1's
 * room 6, is killed on the spot, and the words come up. The port had him
 * standing in them for forty ticks, unhurt, and the two runs had nothing
 * to do with each other from there on.
 *
 * What is safe is running across. That is the trick the original is known
 * for and `spikeHarm` is built around it: 1 means the blades are out and
 * a runner clears them, 2 means they are coming up and catch even him.
 * Clearing them in the air is safe too, except on the two frames that
 * land in them.
 */
function checkSpiked(state: CharacterState, ctx: KidContext): void {
  if (!ctx.traps) return;
  const t = tileHere(state, ctx);
  if (t.type !== TILE.spike || !t.room) return;
  const harm = ctx.traps.spikeHarm(t.room, t.row * 10 + t.column);
  if (harm === 0) return;
  const f = state.frame;
  if (f === 43 || f === 26) { // coming down into them
    state.alive = 0;
    return;
  }
  if (state.action === ACTION.inFreefall || state.action === ACTION.inMidair) return;
  const running = (f >= 7 && f < 15) || (f >= 34 && f < 40);
  if (harm >= 2 || !running) state.alive = 0;
}

/**
 * The sword on the floor. Standing on it picks it up: sequence 91 is the
 * original's own animation for it, and its byte-code raises `getItem 1`,
 * which is what tells the game the Prince is armed from now on.
 */
function checkPickUpSword(state: CharacterState, ctx: KidContext): void {
  if (state.alive >= 0 || !ctx.hasSword || ctx.hasSword()) return;
  if (state.frame !== FRAME.stand) return;
  const tile = tileHere(state, ctx);
  if (tile.type !== TILE.sword || !tile.room) return;
  startSequence(state, KID_SEQ.pickUpSword, ctx.tables);
}

/** A chomper whose blade is down cuts whatever is standing in it. */
function checkChomped(state: CharacterState, ctx: KidContext): void {
  if (!ctx.traps || state.alive >= 0) return;
  const tile = tileHere(state, ctx);
  if (tile.type !== TILE.chomper || !tile.room) return;
  const tilePos = tile.row * 10 + tile.column;
  if (!ctx.traps.chomperHarm(tile.room, tilePos)) return;
  ctx.traps.bloodyChomper(tile.room, tilePos);
  state.alive = 0;
}

/** Advance the Prince by one frame of the game. */
export function stepKid(state: CharacterState, controls: Controls, ctx: KidContext): void {
  ctx.controls = controls;
  if (state.grabTimer > 0) state.grabTimer -= 1;
  ctx.latch.read(controls, state.direction);
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

  // Before the floor is tested, not after: a character that has walked into
  // a wall has also walked off the floor, and the original pushes it back
  // first, so the floor test sees where it really ends up.
  checkBumped(state, ctx);
  checkAction(state, ctx);

  const leave = leaveDirection(state, ctx);
  if (leave >= 0) {
    gotoOtherRoom(state, leave, ctx);
    state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
  }

  checkPress(state, ctx);
  checkSpikeBelow(state, ctx);
  checkSpiked(state, ctx);
  checkChomped(state, ctx);
  checkPickUpSword(state, ctx);

  // Falling out of the level is fatal, as it is in the original.
  if (state.room === 0 && state.alive < 0) {
    ctx.damage?.(100);
    state.alive = 0;
  }
}

/**
 * Walking into a wall.
 *
 * `distanceFromWallForward` measures how far the character still has to go
 * before the wall it is walking towards; once the body has crossed the
 * wall's face the measurement comes out negative, which is the original's
 * signal that the character is inside the wall. It is then pushed back out
 * by exactly that much and sequence 47 is started -- the original's own bump,
 * whose byte-code opens `action 5`, `dx -4`, frames 50, 51, 52.
 *
 * Without this the Prince walks straight through the wall at the edge of a
 * room, and since there is no floor out there, falls: on level 1 he runs off
 * the right of the bottom room and drops into the room below.
 *
 * Climbing, hanging and anything in mid-air are left alone, as is a
 * character already bumped -- the original does not interrupt those -- and so
 * is the edge of the level, which is not a wall to walk into but a way out of
 * the world.
 */
function checkBumped(state: CharacterState, ctx: KidContext): void {
  if (state.action === ACTION.hangClimb || state.action === ACTION.hangStraight
    || state.action === ACTION.bumped || state.action === ACTION.inFreefall
    || state.action === ACTION.inMidair) {
    return;
  }
  // Not while he is climbing, landing or hanging. These are the frames
  // `leaveDirection` refuses to carry across a room boundary, for the same
  // reason: between them the character is moving from one tile to another
  // and is not simply walking about. A climb begins `action 1`, so the
  // action alone does not tell them apart -- and bumping mid-climb knocks
  // him off the ledge he is pulling himself onto.
  const f = state.frame;
  if ((f >= 135 && f < 150) || (f >= 110 && f < 120) || (f >= 150 && f < 163)
    || (f >= 166 && f < 169) || (f >= FRAME.hangingFirst && f < 100)) {
    return;
  }
  // Only with both feet on the floor of the row he counts as being in.
  // Bumping into something in mid-air is a different move in the original --
  // sequences 45 and 46, which knock the character down -- and neither is
  // written yet. Pushing a falling character sideways instead walks him into
  // the wall column and he falls through the floor, which is what happened
  // when this guard was missing.
  if (state.y !== floorHeightOfRow(state.currentRow)) return;
  const frame = frameOf(ctx.tables, state);
  const coll = charCollision(state, frame, objectX(state, frame), ctx.spriteWidth(frame.image));

  const penetration = (column: number): number => {
    const tile = getTile(ctx.world, state.room, column, state.currentRow);
    // Only a wall the level actually has. Off the edge of the level
    // `getTile` reports a wall too, but the original does not stop the
    // Prince there -- he runs out of the level and dies.
    if (tile.room === 0) return 0;
    // A chomper is not something to walk into. Its blades are a hazard to
    // run between, not a wall -- `safeStep` already refuses to treat one as
    // an edge to stop at -- and bumping off it would make every chomper
    // impassable.
    if (tile.type === TILE.chomper) return 0;
    const wall = wallTypeAt(ctx.world, tile, ctx.spriteHeight(frame.image));
    if (wall === 0) return 0;
    const d = distanceFromWallForward(state, tile.type, column, coll, wall);
    return d < 0 ? d : 0;
  };

  // The wall may be the tile the character counts as standing on, or the one
  // it is walking towards.
  const here = penetration(state.currentColumn);
  const front = penetration(DIR_FRONT[state.direction + 1] + state.currentColumn);
  const push = Math.min(here, front);
  if (push === 0) return;

  state.x = forwardX(state, push) & 0xff;
  state.currentColumn = determineColumn(state, frame);
  startSequence(state, KID_SEQ.bump, ctx.tables);
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
  ctx: KidContext, level = 0,
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
  // Two levels open differently. Level 1 drops the Prince in, and the gate
  // behind him is opened by a button pressed on his behalf as he arrives;
  // level 13 has him come in at a run.
  let entry: number = KID_SEQ.turn;
  if (level === ENTRY_FALL_LEVEL) {
    entry = KID_SEQ.fall;
    ctx.traps?.pressButton(ENTRY_BUTTON_ROOM, ENTRY_BUTTON_TILEPOS);
  } else if (level === ENTRY_RUN_LEVEL) {
    entry = KID_SEQ.runEntry;
  }
  startSequence(state, entry, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
}

/** The level that begins with a fall, and the button its arrival presses. */
const ENTRY_FALL_LEVEL = 1;
const ENTRY_BUTTON_ROOM = 5;
const ENTRY_BUTTON_TILEPOS = 2; // column 2 of row 0
/** The level that begins at a run. */
const ENTRY_RUN_LEVEL = 13;

function X_BUMP_START(column: number): number {
  // standX, inlined to avoid a cycle with geometry's screen helpers.
  const X_BUMP = [
    -12, 2, 16, 30, 44, 58, 72, 86, 100, 114,
    128, 142, 156, 170, 184, 198, 212, 226, 240, 254,
  ];
  return X_BUMP[column + 5] + 14;
}

export { TILE_RIGHT_X };
