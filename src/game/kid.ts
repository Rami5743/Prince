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
  tileDivModM7, weightX, distanceToEdge, wallTypeAt, wallType, distanceFromWallForward,
  checkCollisions, WALL_DIST_FROM_LEFT, WALL_DIST_FROM_RIGHT, type Collision,
  collisionRoomAt, xposInDrawnRoom,
} from './physics.ts';
import { X_BUMP, FIRST_ONSCREEN_COLUMN, TILE_MID_X } from './geometry.ts';
import { TILE, tileIsFloor } from './tiles.ts';
import {
  SWORD_SEQ, SWORD_DRAWN, isReady, facingOf, withinReach, charOppDist,
} from './sword.ts';
import { CONTROL, ControlLatch, type Controls } from './control-latch.ts';

/** The original's 16-bit unsigned view of a value. */
const u16 = (v: number): number => v & 0xffff;

/** Sequence ids this module uses, in the original's numbering. */
/**
 * The sequences `start_fall` chooses between.
 *
 * 7 is the common one -- off a stand, a walk, a crouch or the first of
 * the two run frames -- and the others belong to the frame they are
 * named for. The port used 7 for every one of them.
 */
const SEQ_FALL_FROM_RUN = 19;
const SEQ_FALL_AFTER_STANDING_JUMP = 18;
const SEQ_FALL_AFTER_RUNNING_JUMP = 21;
const SEQ_PUSHED_OFF_LEDGE = 81;
const SEQ_START_FALL_AT_WALL = 104;

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
  /**
   * The landing that kills: a fall of three rows or more.
   *
   * 22, not 52. Sequence 52 is one byte -- `jump 8282` -- and 8282 is
   * where sequence 20, the hard landing, begins: `frame 108`, then frame
   * 109 thirty times, then 110..119 and back on his feet. So `crushed:
   * 52` was literally the survivable landing, and a fall of three rows
   * left the Prince lying in the living crouch and then getting up with
   * no hit points, which is what the player saw and reported as `no body,
   * and it looks as though he survived`. Sequence 22 is the one that
   * kills: `knockDown`, `dy -2`, `dx 3`, frame 185, `die`, frame 185 and
   * a jump back onto itself -- the body, held for ever.
   */
  crushed: 22,
  /** Landing on spikes: `knockDown`, `dx 4`, frame 177, `die`. */
  spiked: 51,
  /**
   * Cut in half by a chomper: `action 1`, frame 178, `die`, frame 178 for
   * ever. Frame 178 is the chomper's own body, and it is the one the port
   * was using for a sword death as well -- which is how the player knew
   * something was wrong: `that is what a body looks like after the
   * guillotine, not after a guard`.
   */
  chomped: 54,
  unsafeStep: 39,
  /** Picking the sword up off the floor; its byte-code raises `getItem 1`. */
  pickUpSword: 91,
  /** Drinking a potion; its byte-code raises `getItem 1` as well. */
  drink: 78,
  /** Walking out of the level; its byte-code raises `endLevel`. */
  leaveLevel: 70,
  /** Walking into a wall. Its own byte-code reads `action 5`, `dx -4`. */
  bump: 47,
  /** Meeting one in mid-air: the fall frames and then a real fall. */
  bumpFall: 45,
  /** Meeting one at the end of a jump: hands down, then the crouch. */
  hardBump: 46,
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
  /**
   * The two frames of the stride a runner can pull up on --
   * `control_running` takes the key only on frame 7 or frame 11, and
   * carries on to one of them otherwise.
   */
  run1: 7,
  run2: 11,
  /** The body the original leaves when the Prince falls out of the level. */
  dead: 185,
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
  /**
   * Remember which tile the thing he is reaching for is on. The byte-code
   * raises `getItem` a dozen frames after the animation starts, and both
   * animations move him on the way -- the drink opens with `dx 4` -- so by
   * then the column he counts as standing in need not be the one the
   * flask is on. Taking it from under his feet at that moment emptied the
   * wrong tile and left the flask where it was.
   */
  markItem?(room: number, column: number, row: number): void;
  /** Which room is on the screen; x is measured in its coordinates. */
  drawnRoom?(): number;
  /** The room the level starts in; the level door there is not a way out. */
  startRoom?: number;
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
/**
 * How near an armed guard has to be before the Prince draws.
 *
 * Ninety, and it is the original's own number: `control_standing` asks
 * for `can_guard_see_kid >= 2` and a distance in `[-10, 90)`, measured
 * forwards -- the guard behind him counts for ten units and in front of
 * him for ninety. The port had three times a blade's reach, which is
 * seventy-two and even, so he drew late and on the wrong side.
 */
const DRAW_SWORD_RANGE = 90;
const DRAW_SWORD_BEHIND = -10;

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
  const distance = foe === null ? 0 : charOppDist(state, foe);
  const engaged = foe !== null && foe.alive < 0 && foe.sword === SWORD_DRAWN
    && foe.room === state.room && foe.currentRow === state.currentRow
    && distance >= DRAW_SWORD_BEHIND && distance < DRAW_SWORD_RANGE;

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

function tileFront(state: CharacterState, ctx: KidContext) {
  return getTile(ctx.world, state.room,
    DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
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
  if (goUpLevelDoor(state, ctx)) return;
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
  // The arrows are forgotten, but Down is not marked as used, for the
  // reason `canClimbUp` gives about Up: the original goes on acting on a
  // key that is still held once the move it started has finished. A
  // player who holds Down at the top of a shaft climbs down one ledge
  // after another; the port climbed down one and then stood there, for
  // as long as the key was held, because `releaseLedgeAndLand` had
  // marked Down used and nothing clears that until the key comes up.
  ctx.latch.releaseArrows();
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
    // Holding the key does keep him running; the once-per-press rule
    // belongs to the careful step inside `forwardPressed`, not here.
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

/** Which frames of the stride a running jump may be taken from. */
const RUN_JUMP_FIRST = FRAME.run7;

/**
 * A running jump, lined up with the edge of the floor so that the Prince
 * leaves the ground from the right spot however he was running.
 */
function runJump(state: CharacterState, ctx: KidContext): void {
  if (state.frame < RUN_JUMP_FIRST) return;
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
    // Once per press. Without this the Prince pressed against a wall
    // steps into it, bumps, is pushed back the width of the bump, finds
    // the wall far enough away to try again, and shuffles on the spot for
    // as long as the key is held. The capture of the recorded run has the
    // original standing stock still against the gate of level 1's room 8
    // with Left held from tick 240 to 256.
    if (ctx.latch.forward !== CONTROL.held) return;
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
  const was = state.frame;
  state.currentRow += 1;
  ctx.traps?.startChompers(state.room, state.currentRow);
  // `start_fall` picks the sequence by the frame he fell from: the two
  // run frames fall differently from each other, a landing out of a
  // standing jump and one out of a running jump each have their own,
  // and dropping off a ledge after a jump up moves him five forward
  // first. The port had one sequence for all of them.
  let seq: number = KID_SEQ.fall;
  if (was === 9) seq = KID_SEQ.fall;
  else if (was === 13) seq = SEQ_FALL_FROM_RUN;
  else if (was === 26) seq = SEQ_FALL_AFTER_STANDING_JUMP;
  else if (was === 44) seq = SEQ_FALL_AFTER_RUNNING_JUMP;
  else if (was >= 81 && was < 86) {
    seq = SEQ_FALL_FROM_RUN;
    state.x = forwardX(state, 5) & 0xff;
  } else if (was >= 150 && was < 180) {
    // Pushed off a ledge with his sword out.
    if (state.direction < 0
      && distanceToEdgeWeight(state, frameOf(ctx.tables, state)) <= 7) {
      state.x = forwardX(state, -5) & 0xff;
    }
    seq = SEQ_PUSHED_OFF_LEDGE;
  }
  startSequence(state, seq, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
  let frame = frameOf(ctx.tables, state);
  state.currentColumn = determineColumn(state, frame);
  // And then the two walls. A character who starts falling inside one
  // is pushed out of it; one who starts falling with his face against
  // one is moved back a single unit, and that unit is three pixels on
  // the screen. It is the whole of the difference between the port and
  // a capture for the three ticks of the first descent of level 1: the
  // Prince steps off the ledge of room 1 with the wall of room 2's top
  // row in front of him, and the original backs him off it.
  if (tileHere(state, ctx).type === TILE.wall) {
    inWall(state, ctx);
    return;
  }
  if (tileFront(state, ctx).type === TILE.wall) {
    frame = frameOf(ctx.tables, state);
    if (was !== 44 || distanceToEdgeWeight(state, frame) >= 6) {
      state.x = forwardX(state, -1) & 0xff;
    } else {
      startSequence(state, SEQ_START_FALL_AT_WALL, ctx.tables);
      playSequence(state, { tables: ctx.tables, effects: ctx.effects });
    }
    state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
  }
}

/** The original's `in_wall`: put back out of the stone he is standing in. */
function inWall(state: CharacterState, ctx: KidContext): void {
  const frame = frameOf(ctx.tables, state);
  let delta = distanceToEdgeWeight(state, frame);
  if (delta >= 8 || tileFront(state, ctx).type === TILE.wall) delta = 6 - delta;
  else delta += 4;
  state.x = forwardX(state, delta) & 0xff;
  state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
}

function land(state: CharacterState, ctx: KidContext): void {
  state.y = floorHeightOfRow(state.currentRow);
  const frame = frameOf(ctx.tables, state);
  const here = tileHere(state, ctx);
  const onSpikes = here.type === TILE.spike && here.room !== 0;
  // The original's `land` is a goto across its own middle: coming down
  // on spikes jumps straight to the spike test, past the edge shuffle,
  // past `start_chompers`, and -- this is the part that matters -- past
  // the test for whether he was alive when he came down. So a dead body
  // dropped on blades is still spiked, and a body dropped on blades that
  // are not out falls through into the fall-damage arm below.
  let spikeTile: ReturnType<typeof tileHere> | null = null;
  if (onSpikes) {
    spikeTile = here;
  } else {
    const front = getTile(ctx.world, state.room,
      DIR_FRONT[state.direction + 1] + state.currentColumn, state.currentRow);
    if (!tileIsFloor(front.type) && distanceToEdgeWeight(state, frame) < 3) {
      // Landed with his toes over the edge: shuffle back onto the floor.
      state.x = forwardX(state, -3) & 0xff;
    }
    ctx.traps?.startChompers(state.room, state.currentRow);
    if (state.alive >= 0) {
      // Already dead when he came down, and not on spikes: the full
      // hundred and the crushed sequence, whatever the drop was.
      ctx.damage?.(100);
      startSequence(state, KID_SEQ.crushed, ctx.tables);
      state.fallY = 0;
      state.fallX = 0;
      playSequence(state, { tables: ctx.tables, effects: ctx.effects });
      return;
    }
    // The tile behind counts too, once he is far enough into his own,
    // and it is tried first -- the original reads it before it reads the
    // tile he is standing on.
    const behind = getTile(ctx.world, state.room,
      DIR_BEHIND[state.direction + 1] + state.currentColumn, state.currentRow);
    if (distanceToEdgeWeight(state, frame) >= 12
      && behind.type === TILE.spike && behind.room !== 0) spikeTile = behind;
  }
  // The blades still have to be out: a landing on spikes that have not
  // come up is one of the things the original lets him get away with.
  if (spikeTile !== null) {
    const harm = ctx.traps?.spikeHarm(spikeTile.room,
      spikeTile.row * 10 + spikeTile.column) ?? 0;
    if (harm !== 0) {
      impale(state, ctx, spikeTile);
      return;
    }
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
  // The landing shows this tick, not the next one. `checkAction` runs
  // after `playSequence`, so a sequence merely started here would leave
  // the last frame of the fall on screen for one tick more than the
  // original holds it -- and from the first drop of the recorded run of
  // level 1 the port was a tick behind for the rest of the level.
  // `startFall` plays its first frame the same way, for the same reason.
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
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
 * The original's `spiked`: the blades go through him.
 *
 * All of it, not only the pose. The original takes every hit point --
 * `take_hp(100)` -- so the markers go out, which is how the player can
 * tell the difference between a death and a bad landing; it stops him
 * falling; and it plays the first frame of sequence 51 on the tick he is
 * caught, so the body is on the screen at once rather than a tick late.
 */
function impale(
  state: CharacterState,
  ctx: KidContext,
  tile: { room: number; column: number; row: number },
): void {
  ctx.traps?.impaleOnSpikes(tile.room, tile.row * 10 + tile.column);
  state.fallY = 0;
  state.fallX = 0;
  state.alive = 0;
  ctx.damage?.(100);
  startSequence(state, KID_SEQ.spiked, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
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
  // Once. He goes on standing in the blades after they have killed him,
  // so without this the sequence is restarted every tick and its `dx 4`
  // walks the body four units along the pit for as long as it lies there.
  if (!ctx.traps || state.alive >= 0) return;
  const t = tileHere(state, ctx);
  if (t.type !== TILE.spike || !t.room) return;
  const harm = ctx.traps.spikeHarm(t.room, t.row * 10 + t.column);
  if (harm === 0) return;
  // `check_spiked`, and it is a short list. Four frames of running and
  // six of the start of a run-jump, and only while the blades are on
  // their way up; or the two frames a jump lands on, at any stage of
  // the blades. Nothing else: standing on spikes is how a careful step
  // across them works, and the original lets him do it.
  //
  // The port killed him on every frame that was not one of the running
  // ones, which is most of them -- including 40, 41 and 42, the middle
  // of a running jump. That is the player's `they kill even when you
  // jump over them`.
  const f = state.frame;
  const running = (f >= 7 && f < 15) || (f >= 34 && f < 40);
  const landing = f === 43 || f === 26;
  if ((harm >= 2 && running) || landing) impale(state, ctx, t);
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
  ctx.markItem?.(tile.room, tile.column, tile.row);
  startSequence(state, KID_SEQ.pickUpSword, ctx.tables);
}

/** The level door's modifier when it has finished sliding up. */
const LEVEL_DOOR_OPEN = 43;

/**
 * `up_pressed`, first branch: Up at the level door is the way out.
 *
 * The port had this as a `check_leveldoor` of its own, run every tick
 * from `play_kid_frame`, so the Prince walked into the door and left the
 * level without being asked -- and left it facing the wrong way, because
 * nothing had put him where the original puts him.
 *
 * The original asks only when Up is pressed, and it asks about three
 * tiles: the one he is on, the one behind him and the one in front, so
 * he can be a little short of the door or a little past it. The door of
 * the room the level starts in is not a way out -- that is the door he
 * came in by. Then `go_up_leveldoor` snaps him to the door's own column,
 * turns him to face left, and starts sequence 70, whose byte-code walks
 * him backwards into the doorway and raises `endLevel` on the way.
 */
function goUpLevelDoor(state: CharacterState, ctx: KidContext): boolean {
  const here = tileHere(state, ctx);
  const behind = tileBehind(state, ctx);
  const front = tileFront(state, ctx);
  const door = here.type === TILE.levelDoorLeft ? here
    : behind.type === TILE.levelDoorLeft ? behind
      : front.type === TILE.levelDoorLeft ? front : null;
  if (!door || !door.room) return false;
  const drawn = ctx.drawnRoom ? ctx.drawnRoom() : state.room;
  if (ctx.startRoom === drawn) return false;
  if (ctx.world.modifierAt(door.room, door.column, door.row) < LEVEL_DOOR_OPEN) return false;
  state.x = (X_BUMP_START(door.column) - 4) & 0xff;
  state.direction = -1;
  startSequence(state, KID_SEQ.leaveLevel, ctx.tables);
  return true;
}


/**
 * A potion under his feet is drunk.
 *
 * The port had nothing here at all: the Prince walked over every flask in
 * the game and none of them did anything, because the only thing that
 * ever started a `getItem` was the sword. Sequence 78 is the original's
 * own drinking animation -- he kneels, lifts the flask, swallows on the
 * frame that raises `sound 3`, and sets it down -- and it raises
 * `getItem 1` near the end, which is where the potion does its work.
 */
function checkDrink(state: CharacterState, ctx: KidContext): void {
  if (state.alive >= 0) return;
  if (state.frame !== FRAME.stand) return;
  if (state.action === ACTION.inFreefall || state.action === ACTION.inMidair) return;
  const tile = tileHere(state, ctx);
  if (tile.type !== TILE.potion || !tile.room) return;
  ctx.markItem?.(tile.room, tile.column, tile.row);
  startSequence(state, KID_SEQ.drink, ctx.tables);
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
  ctx.damage?.(100);
  // Frame 178, held: the original's own body for a chomper. Without a
  // sequence of its own the Prince simply froze in whatever pose the
  // blade caught him in.
  startSequence(state, KID_SEQ.chomped, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
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
  checkBumpedIntoFoe(state, ctx);
  checkAction(state, ctx);

  checkPress(state, ctx);
  checkSpikeBelow(state, ctx);
  checkSpiked(state, ctx);
  checkChomped(state, ctx);
  checkPickUpSword(state, ctx);
  checkDrink(state, ctx);

  // `fell_out`: falling out of the level is fatal, and the body is the
  // one the original shows for it -- frame 185, not whichever frame of
  // the fall he happened to be on. He goes on falling through the room
  // that is not there, which is off the screen and nobody's business.
  if (state.room === 0 && state.alive < 0) {
    ctx.damage?.(100);
    state.alive = 0;
    state.frame = FRAME.dead;
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
  const frame = frameOf(ctx.tables, state);
  const coll = charCollision(state, frame, objectX(state, frame), ctx.spriteWidth(frame.image));
  const bumps = checkCollisions(ctx.world, state, coll, state.collisions);
  if (state.action === ACTION.hangClimb || state.action === ACTION.hangStraight) return;
  // Climbing is left alone: between those frames he is moving from one
  // tile to another and is not walking about.
  if (state.frame >= 135 && state.frame < 149) return;
  if (bumps.intoLeftOfWall >= 0) {
    lookRight(state, ctx, frame, coll, bumps.intoLeftOfWall);
  } else if (bumps.intoRightOfWall >= 0) {
    lookLeft(state, ctx, frame, coll, bumps.intoRightOfWall);
  }
}

/**
 * `is_obstacle_at_col`: the tile that the collision data for a column was
 * read from. Not `getTile(state.room, column, ...)`: the column is an index
 * into a row of ten readings that may have come from two rooms at once, and
 * the room each one came from is recorded beside it. Reading room 6's column
 * 9 when the reading was of room 8's is how a shut gate at the edge of the
 * room next door stopped nothing at all.
 */
function obstacleAtColumn(
  state: CharacterState, ctx: KidContext, column: number,
): { type: number; room: number; column: number; row: number } {
  return getTile(ctx.world, collisionRoomAt(state.collisions, column),
    column, obstacleRow(state));
}

/** The row `is_obstacle_at_col` reads, folded back into the room. */
function obstacleRow(state: CharacterState): number {
  let row = state.currentRow;
  if (row < 0) row += 3;
  if (row >= 3) row -= 3;
  return row;
}

/** The left edge of a column of the room a reading came from. */
function collisionTileLeft(ctx: KidContext, state: CharacterState, tile: { room: number; column: number }): number {
  const drawn = ctx.drawnRoom ? ctx.drawnRoom() : state.room;
  return xposInDrawnRoom(
    ctx.world, tile.room, drawn, X_BUMP[tile.column + FIRST_ONSCREEN_COLUMN],
  ) + TILE_MID_X;
}

/** `check_bumped_look_right`: he is facing right and has met a left face. */
function lookRight(
  state: CharacterState, ctx: KidContext, frame: Frame, coll: Collision, column: number,
): void {
  if (state.sword !== 2 && state.direction !== 0) return;
  const tile = obstacleAtColumn(state, ctx, column);
  if (!isObstacle(ctx, ctx.spriteHeight(frame.image), tile)) return;
  const type = wallType(tile.type);
  if (type === 0) return;
  const tileLeft = collisionTileLeft(ctx, state, tile);
  bumpBack(state, ctx, frame,
    WALL_DIST_FROM_LEFT[type] + tileLeft - coll.xRightColl, tile, false);
}

/** `check_bumped_look_left`: facing left, and he has met a right face. */
function lookLeft(
  state: CharacterState, ctx: KidContext, frame: Frame, coll: Collision, column: number,
): void {
  if (state.sword !== 2 && state.direction >= 0) return;
  const tile = obstacleAtColumn(state, ctx, column);
  if (!isObstacle(ctx, ctx.spriteHeight(frame.image), tile)) return;
  const type = wallType(tile.type);
  if (type === 0) return;
  const tileLeft = collisionTileLeft(ctx, state, tile);
  bumpBack(state, ctx, frame,
    tileLeft - WALL_DIST_FROM_RIGHT[type] + TILE_RIGHT_X - coll.xLeftColl, tile, true);
}

/**
 * `is_obstacle`: what is worth bumping into. A flask is not, an open
 * gate is not, a chomper is only while its blade is down.
 */
function isObstacle(
  ctx: KidContext, charHeight: number,
  tile: { type: number; room: number; column: number; row: number },
): boolean {
  if (tile.type === TILE.potion) return false;
  if (tile.type === TILE.gate) {
    // `can_bump_into_gate`: the gap under it has to be shorter than he is.
    const modifier = ctx.world.modifierAt(tile.room, tile.column, tile.row);
    return (modifier >> 2) + 6 < charHeight;
  }
  if (tile.type === TILE.chomper) {
    return ctx.world.modifierAt(tile.room, tile.column, tile.row) === 2;
  }
  return true;
}

/**
 * Push a character back out of what it walked into, and stagger it.
 *
 * This is the original's `bumped`, `bumped_floor` and `bumped_fall`,
 * which SDLPoP has in `seg004.c`. The port used to have one of the
 * three, and the two that were missing are worth more than they look.
 *
 * Not a dead one. A body does not walk into anything, and the only
 * thing the bump can do to it is take it out of the pose it died in:
 * impaled on the spikes of level 1's room 6 the Prince is on frame 177
 * with his arms out, wide enough to reach the wall beside him, and the
 * port pushed him off the blades, staggered him and stood him up.
 */
function bumpBack(
  state: CharacterState, ctx: KidContext, frame: Frame, deltaX: number,
  wall: { type: number; room: number; column: number }, pushingRight: boolean,
): void {
  if (state.alive >= 0 || state.frame === 177) return;
  // `Char.x += delta_x`, and the sign is already in it: the original
  // works out how far the wall's face is from the edge that met it.
  state.x = (state.x + deltaX) & 0xff;
  state.currentColumn = determineColumn(state, frame);
  // And whatever the player is holding counts again afterwards.
  //
  // A latch that a move has used stays used until the key comes back up,
  // which is what stops a held key repeating -- and a move cut short by
  // a wall had used one without finishing. Running left out of level 1's
  // room 6 with Right pressed, the Prince starts the run-turn, which
  // marks Right as used and would have flipped him at the end of it; the
  // wall stops him three frames in, so the flip never happens and Right
  // stays used. He then stands facing the wall with Right held and does
  // nothing at all, which is what the player reported as a jammed
  // keyboard.
  //
  // The original turns and runs. Measured: the probe `14.,11l,36r,30.`
  // on level 1 -- run left into the left wall of room 1 and hold Right
  // from before the bump -- has the two runs identical through tick 32,
  // and from 33 the original turns, is facing right by 38 and running by
  // 40, while the port stood still until the key came up on 61.
  ctx.latch.releaseArrows();

  // Which tile decides what happens next. The original steps one column
  // further in the direction of the push when the thing he hit is a wall
  // -- or a door top, pushing right -- because those have their face on
  // one side of their tile and the floor he may land on is in the next.
  //
  // The step is taken in the room the wall was read from, which need not
  // be his own: a character at the left edge of a room is stopped by the
  // wall the original returns for column 9 of the room that is not there,
  // and stepping right from that is column 0 of his own room -- the floor
  // he is standing on. Reading it in his room instead gave column 9 of it,
  // the wall at the other end, and he bumped into it again every tick:
  // running at the left wall of level 1's room 1, the Prince was caught in
  // the bump for ever and never turned.
  let room = wall.room;
  let column = wall.column;
  if (pushingRight) {
    if (wall.type === TILE.doortop || wall.type === TILE.doortopWithFloor
      || wall.type === TILE.wall) {
      column += 1;
      if (room === 0 && column === 10) {
        room = state.room;
        column = 0;
      }
    }
  } else if (wall.type === TILE.wall) {
    column -= 1;
  }
  const under = getTile(ctx.world, room, column, obstacleRow(state));
  if (tileIsFloor(under.type)) bumpedFloor(state, ctx, frame, pushingRight);
  else bumpedFall(state, ctx, frame);
}

/**
 * Nothing to land on where he was stopped, so he comes off the wall and
 * drops. Four units back in code -- sequence 45 opens `action 5, dx 1,
 * dy 3` and nothing in it moves him off what he hit.
 *
 * Those four units are the difference between catching the ledge of
 * room 2 on the way down from level 1's first fall and falling past it.
 * The original falls, and loses a hit point for it; the port caught the
 * ledge, and every one of the player's recordings parted company with
 * the original there.
 */
function bumpedFall(state: CharacterState, ctx: KidContext, frame: Frame): void {
  state.x = forwardX(state, -4) & 0xff;
  state.currentColumn = determineColumn(state, frame);
  if (state.action === ACTION.inFreefall) {
    state.fallX = 0;
    return;
  }
  startSequence(state, KID_SEQ.bumpFall, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
}

/** There is floor where he was stopped: the original's `bumped_floor`. */
function bumpedFloor(
  state: CharacterState, ctx: KidContext, frame: Frame, pushingRight: boolean,
): void {
  // High enough above that floor and he falls to it rather than landing.
  if (state.sword !== 2
    && u16(floorHeightOfRow(state.currentRow) - state.y) >= 15) {
    bumpedFall(state, ctx, frame);
    return;
  }
  state.y = floorHeightOfRow(state.currentRow);
  if (state.fallY >= 22) {
    // Coming down hard: he is simply shoved clear and the landing that
    // is already running deals with him.
    state.x = forwardX(state, -5) & 0xff;
    state.currentColumn = determineColumn(state, frame);
    return;
  }
  state.fallY = 0;
  if (state.alive === 0) return;
  // The stagger a running jump ends in is not the one a walk ends in:
  // sequence 46 puts him on his hands, 47 is the three-frame shuffle.
  const f = state.frame;
  const hard = f === 24 || f === 25 || (f >= 40 && f < 43) || (f >= 102 && f < 107);
  startSequence(state, hard ? KID_SEQ.hardBump : KID_SEQ.bump, ctx.tables);
  playSequence(state, { tables: ctx.tables, effects: ctx.effects });
}

/**
 * Two bodies cannot be in the same place. The original has no such rule
 * -- its collision data is walls only -- but without it the Prince walks
 * through a guard, and a guard who is walking at him walks through him.
 * Ten units is as close as they get.
 */
const FOE_BODY = 10;

function checkBumpedIntoFoe(state: CharacterState, ctx: KidContext): void {
  if (state.alive >= 0) return;
  if (state.action === ACTION.bumped || state.action === ACTION.inFreefall
    || state.action === ACTION.inMidair || state.action === ACTION.hangClimb
    || state.action === ACTION.hangStraight) {
    return;
  }
  const foe = ctx.opponent?.();
  if (!foe || foe.alive >= 0) return;
  if (foe.room !== state.room || foe.currentRow !== state.currentRow) return;
  if (state.y !== floorHeightOfRow(state.currentRow)) return;
  const gap = foe.x - state.x;
  const inFront = state.direction === 0 ? gap > 0 : gap < 0;
  if (!inFront) return;
  const push = Math.abs(gap) - FOE_BODY;
  if (push >= 0) return;
  // Not a wall, so the tile he is standing on is the one that decides
  // whether he staggers or drops.
  const here = getTile(ctx.world, state.room, state.currentColumn, obstacleRow(state));
  bumpBack(state, ctx, frameOf(ctx.tables, state), state.direction === 0 ? push : -push,
    here, state.direction !== 0);
}

/**
 * `wallType`'s answers, by name: a gate or a tapestry has its face on the
 * right of its tile, a wall has one on both sides.
 */
const WALL_ON_THE_RIGHT = 1;
const WALL_ON_BOTH_SIDES = 4;

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
  // The way out of the right of a room is barred by whatever stands in
  // its last column. A tapestry was the only thing the port knew about,
  // and a shut gate let him straight through: running right along the top
  // of room 12 of level 1 he went through the portcullis into room 20.
  // The bump cannot catch that one, because the face of a gate is ten
  // units into its tile and the way out is at eleven, so a stride that
  // ends on the face is already out of the room.
  const edge = getTile(ctx.world, state.room, 9, state.currentRow);
  const barred = wallTypeAt(ctx.world, edge, ctx.spriteHeight(frame.image));
  if (barred !== WALL_ON_THE_RIGHT && barred !== WALL_ON_BOTH_SIDES
    && coll.xRight >= 201) {
    return 1;
  }
  if (coll.xRight <= 57) return 0;
  return -1;
}

/**
 * `exit_room`: the Prince steps over the edge of the room into the next.
 *
 * This is not part of `play_kid_frame`. The original's `play_frame`
 * plays the Prince, then the guard, then settles the swordplay and the
 * hit points, and only then calls `exit_room`, so a tick in which the
 * Prince leaves a room is a tick the guard has already been played in,
 * in the room the Prince is leaving. The port had it inside `stepKid`,
 * which put the room change before the guard's frame instead of after
 * it.
 *
 * `game.ts` owns the call, because `exit_room` is also where the guard
 * decides whether to follow, and because of the two-tick gate on it --
 * see `exitRoomTimer`.
 */
export function exitRoom(state: CharacterState, ctx: KidContext): number {
  const leave = leaveDirection(state, ctx);
  if (leave < 0) return -1;
  gotoOtherRoom(state, leave, ctx);
  state.currentColumn = determineColumn(state, frameOf(ctx.tables, state));
  return leave;
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
