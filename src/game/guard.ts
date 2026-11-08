/**
 * The guards.
 *
 * A level stores one guard per room: which tile it stands on, which way it
 * faces, how skilled it is and what colour its clothes are. A guard exists
 * only while its room is on screen; walking out of the room puts its state
 * back into the level, and walking in takes it out again. That is the
 * original's arrangement, and it is why a guard you ran past is where you
 * left it when you come back.
 */
import type { CharacterState } from './character.ts';
import { newCharacter, CHAR_ID, placeCharacter } from './character.ts';
import type { CharacterDraw } from '../render/room.ts';
import type { ExeTables, Frame } from './exe-tables.ts';
import {
  startSequence, playSequence, ACTION, type SequenceEffects,
} from './sequence.ts';
import { forwardX } from './character.ts';
import {
  determineColumn, tileDivModM7, FALLING_SPEED_ACCEL, FALLING_SPEED_MAX,
} from './physics.ts';
import {
  SWORD_SEQ, SWORD_DRAWN, isReady, facingOf, charOppDist, SWORD_REACH,
} from './sword.ts';
import type { LevelState } from './level-state.ts';
import { X_BUMP, FIRST_ONSCREEN_COLUMN, TILE_SIZE_X, TILE_MID_X, Y_LAND } from './geometry.ts';
import { TILE, tileIsFloor } from './tiles.ts';

/** Sequence the guard starts on when a room is entered. */
export const GUARD_SEQ = {
  standInactive: 77,
  activeAfterFall: 63,
  /**
   * Coming on guard, which is NOT the Prince's sequence 55. A guard's
   * frames are looked up in `frameTableGuard`, which runs from 149 to 189
   * only, and 55 opens with frames 207..210 -- the Prince's own flourish as
   * he draws. Those indices fall off the end of the guard's table and out
   * of its sprite set, so a guard sent through 55 is simply not drawn for
   * the four frames it takes, which is what made one appear out of nothing
   * a moment after the Prince walked in. Sequence 69 is the guard's: frame
   * 167, then 155..157 and 158, 170, 171 into the stance, all of them
   * inside his own table.
   */
  enGarde: 90,
  advance: 56,
  retreat: 57,
  strike: 58,
  turn: 60,
  readyBlock: 62,
  strikeToBlock: 61,
  blockToStrike: 66,
  /**
   * `seq_87_guard_become_inactive`. A guard who cannot see the Prince
   * any more puts his blade down and stands: `move_down_back` sets the
   * original's `control_down`, and `swordfight` takes that before it
   * takes the step back, so the step never happens.
   */
  becomeInactive: 87,
  /** `seq_80_stand_flipped`: turning where he stands, without drawing. */
  standFlipped: 80,
  stabbed: 74,
  dropDead: 71,
} as const;

export const GUARD_TYPE = {
  guard: 0,
  fat: 1,
  skeleton: 2,
  vizier: 3,
  shadow: 4,
  none: -1,
} as const;

/** Which sprite file each guard type uses. */
export const GUARD_FILES = [
  'GUARD.DAT', 'FAT.DAT', 'SKEL.DAT', 'VIZIER.DAT', 'SHADOW.DAT',
] as const;

/**
 * Which kind of guard each level has, indexed by level number.
 *
 * Unlike the other tables, this one is not at a known place in this release
 * of the executable, so it is written out here. Level 3's skeletons, level
 * 6's fat guard, the shadow on 12 and Jaffar on 13 are all visible in the
 * game and are what these values say.
 */
export const GUARD_TYPE_BY_LEVEL = [
  0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 4, 3, -1, -1,
] as const;

/** Extra hit points a guard gets for its skill. */
const EXTRA_STRENGTH = [0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 3, 3] as const;
export const NUM_GUARD_SKILLS = 12;

export interface GuardState extends CharacterState {
  /** 0..11; decides how fast and how aggressive the guard is. */
  skill: number;
  /** 1..7 picks one of the recolourings; 0 keeps the sprite's own colours. */
  colour: number;
  hitPoints: number;
  maxHitPoints: number;
  /** Frames to wait before lunging again; a skilled guard waits less. */
  waitTimer: number;
}

export function newGuard(): GuardState {
  return {
    ...newCharacter({ charId: CHAR_ID.guard }),
    skill: 0,
    colour: 0,
    hitPoints: 0,
    maxHitPoints: 0,
    waitTimer: 0,
    // A guard that is not in the room faces nowhere.
    direction: NO_DIRECTION,
  };
}

/** The original's "this character is not here" direction. */
export const NO_DIRECTION = 56;

/**
 * At the start of a level the stored x of every guard is a placeholder; the
 * original replaces it with the standing position of the tile it is on.
 */
export function positionGuards(level: LevelState, guards: GuardsData): void {
  for (let room = 1; room <= 24; room++) {
    const tile = guards.tile[room - 1];
    if (tile >= 30) continue;
    guards.x[room - 1] = X_BUMP[(tile % 10) + FIRST_ONSCREEN_COLUMN] + TILE_SIZE_X;
    guards.seqHi[room - 1] = 0;
  }
  void level;
}

/** The per-room guard records, which the game updates as it plays. */
export interface GuardsData {
  tile: Uint8Array;
  dir: Uint8Array;
  x: Uint8Array;
  seqLo: Uint8Array;
  skill: Uint8Array;
  seqHi: Uint8Array;
  colour: Uint8Array;
}

export function guardsFromLevel(
  specs: readonly { tile: number; dir: number; x: number; seqLo: number;
    skill: number; seqHi: number; color: number }[],
): GuardsData {
  const pick = (f: (s: (typeof specs)[number]) => number) =>
    Uint8Array.from(specs.map(f));
  return {
    tile: pick((s) => s.tile),
    dir: pick((s) => s.dir),
    x: pick((s) => s.x),
    seqLo: pick((s) => s.seqLo),
    skill: pick((s) => s.skill),
    seqHi: pick((s) => s.seqHi),
    colour: pick((s) => s.color),
  };
}

export interface GuardContext {
  readonly tables: ExeTables;
  readonly guardType: number;
  readonly levelGuardHitPoints: number;
}

/** Bring the guard of a room into play. */
export function enterGuard(
  guard: GuardState, room: number, guards: GuardsData, ctx: GuardContext,
): boolean {
  const index = room - 1;
  const tile = guards.tile[index];
  if (tile >= 30) {
    guard.direction = NO_DIRECTION;
    return false;
  }
  guard.room = room;
  guard.currentRow = Math.floor(tile / 10);
  guard.y = Y_LAND[guard.currentRow + 1];
  guard.x = guards.x[index];
  // `Char.curr_col = get_tile_div_mod_m7(Char.x)`: where he is, not
  // where the box says, which after a `leave_guard` is column nought.
  guard.currentColumn = tileDivModM7(guard.x).column;
  guard.direction = (guards.dir[index] << 24) >> 24;
  guard.colour = ctx.guardType === GUARD_TYPE.guard ? guards.colour[index] & 0x0f : 0;
  guard.charId = ctx.guardType === GUARD_TYPE.skeleton ? CHAR_ID.skeleton : CHAR_ID.guard;

  const seqHi = guards.seqHi[index];
  if (seqHi === 0) {
    if (guard.charId === CHAR_ID.skeleton) {
      guard.sword = 2;
      startSequence(guard, GUARD_SEQ.activeAfterFall, ctx.tables);
    } else {
      guard.sword = 0;
      startSequence(guard, GUARD_SEQ.standInactive, ctx.tables);
    }
  } else {
    guard.currentSequence = guards.seqLo[index] + (seqHi << 8);
  }
  playSequence(guard, { tables: ctx.tables });

  guard.skill = guards.skill[index];
  if (guard.skill >= NUM_GUARD_SKILLS) guard.skill = 3;

  const dead = guard.frame === 185 || guard.frame === 177 || guard.frame === 178;
  guard.alive = dead ? 1 : -1;
  guard.hitPoints = dead
    ? 0
    : (EXTRA_STRENGTH[guard.skill] ?? 0) + ctx.levelGuardHitPoints;
  guard.maxHitPoints = guard.hitPoints;
  guard.fallY = 0;
  guard.fallX = 0;
  guard.action = 1;
  return true;
}

/** Put a guard's state back into the level when its room is left. */
export function leaveGuard(guard: GuardState, guards: GuardsData): void {
  if (guard.direction === NO_DIRECTION || guard.room < 1 || guard.room > 24) return;
  const index = guard.room - 1;
  // `level.guards_tile[room_minus_1] = get_tilepos(0, Guard.curr_row)`.
  // The port never wrote this back, and it is what keeps a guard in the
  // level: `follow_guard` empties the boxes of both rooms when a guard
  // comes after the Prince through a door, and this is what refills the
  // one he is standing in. Without it a guard who had followed once was
  // gone from the level for good -- the player's "he is not there when
  // you come back".
  //
  // Only the row is kept. The column is recovered from his x when he
  // comes back out, which is why the stored column is always nought.
  guards.tile[index] = guard.currentRow * 10;
  guards.x[index] = guard.x;
  guards.dir[index] = guard.direction & 0xff;
  guards.skill[index] = guard.skill;
  guards.colour[index] = guard.colour;
  if (guard.alive < 0) {
    guards.seqLo[index] = guard.currentSequence & 0xff;
    guards.seqHi[index] = (guard.currentSequence >> 8) & 0xff;
  } else {
    guards.seqHi[index] = 0;
  }
  guard.direction = NO_DIRECTION;
}

export interface GuardStepContext {
  readonly tables: ExeTables;
  readonly effects?: SequenceEffects;
  /** Where the Prince is, which is all a guard reacts to so far. */
  readonly kidRoom?: number;
  readonly kidRow?: number;
  readonly kidX?: number;
  /** The Prince himself, for the part of the fight that needs more than x. */
  readonly kid?: CharacterState;
  /** Has the Prince got a sword? A guard treats him differently without one. */
  readonly kidArmed?: boolean;
  /** The game's own generator, for the probabilities a guard fights by. */
  readonly random?: () => number;
  /** Is there floor in front of the guard to step onto? */
  readonly floorInFront?: (guard: GuardState) => boolean;
  /**
   * `get_tile_at_kid`: the tile of the Prince's own room and row at an x,
   * for the line of sight between a guard and him.
   */
  readonly tileAtKid?: (xpos: number) => { type: number; modifier: number };
  /** `justblocked`: his own last blow was parried, within four ticks. */
  readonly justBlocked?: () => boolean;
  /**
   * `can_guard_see_kid`, worked out *before* the Prince was stepped.
   *
   * The original computes it in `play_frame`, on the line above
   * `play_kid_frame`, so what the guard reacts to this tick is where the
   * Prince was at the end of the last one. The port worked it out inside
   * the guard's own step, which is after the Prince has moved, and so
   * every decision that turns on sight came a tick early -- a guard came
   * on guard the moment the Prince stepped into his row rather than the
   * tick after.
   *
   * Left out, it is worked out here from the state as it stands, which
   * is what the tests that drive a guard by hand want.
   */
  readonly canGuardSee?: number;
  /**
   * `is_guard_notice`: the Prince has made a noise since the last time
   * a guard looked. A footstep sets it, so does a hard landing and so
   * does walking into a wall, and it is the only thing that makes an
   * inactive guard turn round on someone behind him.
   */
  readonly heard?: () => boolean;
  /** Clear `is_guard_notice`, which looking at it does. */
  readonly forget?: () => void;
}

/** What a guard can see of the Prince. */
export const SIGHT = {
  /** Nothing: something solid is in the way. */
  none: 0,
  /** Him, but across something the guard will not cross. */
  wont: 1,
  /** Him, with a clear floor between. */
  comes: 2,
} as const;

/**
 * `check_can_guard_see_kid`.
 *
 * Not "the same room and the same row", which is what the port asked.
 * The original walks the tiles between the two of them: a wall or a door
 * top and it sees nothing at all; a loose floor, a chomper, a gate that
 * is less than most of the way up, or a hole in the floor, and it sees
 * him but will not come. The difference is not cosmetic -- a guard that
 * can see him but will not come stands still, one that cannot see him at
 * all backs away, and one with a clear floor between comes on.
 */
export function canGuardSeeKid(
  guard: GuardState, kid: CharacterState, ctx: GuardStepContext,
): number {
  const at = ctx.tileAtKid;
  if (!at) return kid.room === guard.room && kid.currentRow === guard.currentRow
    ? SIGHT.comes : SIGHT.none;
  // Frames 219..228 are the way out of a level, where nothing can touch him.
  if (kid.frame === 0 || (kid.frame >= 219 && kid.frame < 229)) return SIGHT.none;
  if (guard.direction === NO_DIRECTION || kid.alive >= 0 || guard.alive >= 0) {
    return SIGHT.none;
  }
  if (kid.room !== guard.room || kid.currentRow !== guard.currentRow) return SIGHT.none;
  let left = X_BUMP[kid.currentColumn + FIRST_ONSCREEN_COLUMN] + TILE_MID_X;
  let right = X_BUMP[guard.currentColumn + FIRST_ONSCREEN_COLUMN] + TILE_MID_X;
  if (left === undefined || right === undefined) return SIGHT.none;
  if (left > right) { const t = left; left = right; right = t; }
  // A chomper is on the left of its tile and a gate on the right, so
  // neither is between them when it is the tile one of them stands on.
  if (at(left).type === TILE.chomper) left += TILE_SIZE_X;
  if (at(right).type === TILE.gate) right -= TILE_SIZE_X;
  let sight: number = SIGHT.comes;
  for (let x = left; x <= right; x += TILE_SIZE_X) {
    const tile = at(x);
    if (tile.type === TILE.wall || tile.type === TILE.doortopWithFloor
      || tile.type === TILE.doortop) {
      return SIGHT.none;
    }
    if (tile.type === TILE.loose || tile.type === TILE.chomper
      || (tile.type === TILE.gate && tile.modifier < 112)
      || !tileIsFloor(tile.type)) {
      sight = SIGHT.wont;
    }
  }
  return sight;
}

/**
 * How long a guard waits between lunges, before its skill is taken off.
 * A guess, and the thing most in need of a capture: the original varies it
 * with skill and with what the Prince is doing, and nothing here has been
 * measured against it.
 */
export const GUARD_STRIKE_WAIT = 14;

/**
 * How close a guard means to get. Beyond this he walks in; within it he
 * holds his stance. Read off `tests/golden/session-level2-meet`, where the
 * guard leaves his corner and closes to about a tile and a half of the
 * Prince before stopping.
 */
export const GUARD_REACH = 21;

/** The frame an idle guard holds, from sequence 77. */
export const GUARD_FRAME_INACTIVE = 166;

/**
 * A guard that has not noticed the Prince yet stands on sequence 77, which
 * holds frame 166 for ever. When the Prince turns up in his room, on his
 * row, he comes on guard: sequence 55 draws the sword and settles into the
 * en garde stance.
 *
 * This is as much as the captures settle. `tests/golden/session-level2-guard`
 * shows the guard of room 4 doing exactly this and then holding the stance
 * for twenty captures without advancing a step, with the Prince standing in
 * the same room the whole time. What it does *not* settle is what makes him
 * come on guard at that moment rather than when the Prince first walked in
 * five captures earlier -- distance, or a reaction delay, or something
 * else. Finding that out needs captures at several distances. Until then a
 * guard draws his sword a little too eagerly and then, correctly, waits.
 */
function comeOnGuard(guard: GuardState, ctx: GuardStepContext): void {
  if (guard.alive >= 0 || guard.sword !== 0) return;
  if (guard.frame !== GUARD_FRAME_INACTIVE) return;
  const kid = ctx.kid;
  if (!kid || kid.alive >= 0) return;
  // `autocontrol_guard_inactive`: a guard with his sword away comes on
  // guard when he can see the Prince at all, which is not the same as
  // the Prince being in the room. Across a hole in the floor or behind a
  // gate he still draws -- `can_guard_see_kid` of one is enough for that
  // -- but behind a wall he does not.
  // `autocontrol_guard_inactive` does not draw on someone behind it,
  // unless the Prince has made a noise. The test is `Opp.curr_row !=
  // Char.curr_row || (word)distance < (word)-8`, and the unsigned
  // compare makes that "a different row, or in front, or behind by
  // nine or more". Inside it: a Prince who has just been heard and is
  // behind by more than four makes the guard turn round in place --
  // `move_4_down`, which `control_guard_inactive` reads as sequence 80
  // -- and one who has not been heard and is behind is let alone. The
  // port drew on anything it could see, from either side and in
  // silence.
  const distance = charOppDist(guard, kid);
  if (kid.currentRow !== guard.currentRow || distance >= 0 || distance <= -9) {
    if (ctx.heard?.()) {
      ctx.forget?.();
      if (distance < 0) {
        if (distance < -4) startSequence(guard, GUARD_SEQ.standFlipped, ctx.tables);
        return;
      }
    } else if (distance < 0) {
      return;
    }
  }
  if ((ctx.canGuardSee ?? canGuardSeeKid(guard, kid, ctx)) === SIGHT.none) return;
  guard.sword = 2;
  startSequence(guard, GUARD_SEQ.enGarde, ctx.tables);
}

/**
 * What a guard with his sword out does, which is `autocontrol_guard_active`
 * and the handful of little functions under it in the original -- SDLPoP
 * has them in `seg002.c`, and this follows them.
 *
 * The port used to have a guess here: close to within a tile and a half,
 * then lunge after a wait that the guard's skill shortened. The real
 * thing is decided on the distance alone, and against an unarmed Prince
 * it has no wait at all:
 *
 *   under 12   too close to fight; step forward, or turn if he is
 *              facing the same way
 *   12 to 34   in sight. An unarmed Prince is struck at under 29 and
 *              walked towards beyond it; an armed one is blocked and
 *              struck by the probability tables
 *   35 and up  a Prince who is running comes under the blade at 40, and
 *              one in a running jump at 50 -- which is the whole of this
 *              bug. Otherwise step towards him if there is floor to step
 *              onto
 *
 * The last line is what let an unarmed Prince run through the guard of
 * level 1's room 3 in the recording `13ab6867`. He comes at the guard in
 * a running jump from six tiles off; the original's guard starts his
 * lunge while the Prince is still in the air and runs him through on the
 * way past, and the grabbed video shows exactly that, the red of it at
 * tick 639. The port's guard waited for him to be within a sword's
 * length, by which time he had gone by, and the player watched him
 * vanish into the next room.
 */
const STRIKE_PROB = [61, 100, 61, 61, 61, 40, 100, 220, 0, 48, 32, 48];
const RESTRIKE_PROB = [0, 0, 0, 5, 5, 175, 16, 8, 0, 255, 255, 150];
const BLOCK_PROB = [0, 150, 150, 200, 200, 255, 200, 250, 0, 255, 255, 255];
const IMP_BLOCK_PROB = [0, 61, 61, 100, 100, 145, 100, 250, 0, 145, 255, 175];
const ADV_PROB = [255, 200, 200, 200, 255, 255, 200, 0, 0, 255, 100, 100];
const REFRACTORY = [16, 16, 16, 16, 8, 8, 8, 8, 0, 8, 0, 0];

/** The frames a blade can be started from, by what is being started. */
const CAN_STRIKE = [157, 158, 165, 170, 171];
const CAN_STEP = [158, 170, 171];
const CAN_PARRY = [158, 170, 171, 168, 165];
/** Frame 167: his blow was blocked and he is open. */
const GUARD_FRAME_BLOCKED = 167;
const PARRY_FRAMES = [150, 161];

function moveShift(guard: GuardState, ctx: GuardStepContext): void {
  if (CAN_STRIKE.includes(guard.frame)) {
    startSequence(guard, GUARD_SEQ.strike, ctx.tables);
  } else if (PARRY_FRAMES.includes(guard.frame)) {
    startSequence(guard, GUARD_SEQ.blockToStrike, ctx.tables);
  }
}

function moveForward(guard: GuardState, ctx: GuardStepContext): void {
  if (CAN_STEP.includes(guard.frame)) {
    startSequence(guard, GUARD_SEQ.advance, ctx.tables);
  }
}

function moveBackward(guard: GuardState, ctx: GuardStepContext): void {
  if (CAN_STEP.includes(guard.frame)) {
    startSequence(guard, GUARD_SEQ.retreat, ctx.tables);
  }
}

/** The three stances a blade can be put away from. */
const CAN_SHEATHE = [158, 170, 171];

/**
 * `move_down_back`, which is what the original does with a guard who has
 * lost sight of the Prince -- behind a wall, or round a corner.
 *
 * It is not a step back. `move_down_back` holds down *and* back, and
 * `swordfight` tests them in that order: a guard on one of the three
 * stance frames sheathes his blade and goes to sequence 87, the inactive
 * stand, and on any other frame nothing happens at all. The step back is
 * never reached.
 *
 * The port had this as a plain `move_2_backward`, so a guard who lost
 * sight walked away in the en-garde stance instead of standing down. The
 * capture of `probeF` has it at tick 261: the Prince climbs up out of the
 * guard's row behind a wall, the original's guard lowers his sword and
 * does not move again, and the port's backed off across the room.
 */
function moveDownBack(guard: GuardState, ctx: GuardStepContext): void {
  if (!CAN_SHEATHE.includes(guard.frame)) return;
  guard.sword = 0;
  startSequence(guard, GUARD_SEQ.becomeInactive, ctx.tables);
}

/**
 * `parry`. Pressing up is not the same as parrying: the original puts
 * three more tests between them, and a guard fails most of them.
 *
 * From the stance he parries only if the Prince is on frame 152 -- the
 * second frame of a lunge, and the only one a guard reacts to; from
 * further off than thirty-two he steps back instead; and out of a blow
 * of his own that was blocked, frame 167, he goes through sequence 61
 * rather than 62.
 */
function moveUp(
  guard: GuardState, kid: CharacterState, distance: number, ctx: GuardStepContext,
): void {
  if (CAN_PARRY.includes(guard.frame)) {
    if (distance >= 32) {
      moveBackward(guard, ctx);
      return;
    }
    if (kid.frame !== 152) return;
    startSequence(guard, GUARD_SEQ.readyBlock, ctx.tables);
    return;
  }
  if (guard.frame === GUARD_FRAME_BLOCKED) {
    startSequence(guard, GUARD_SEQ.strikeToBlock, ctx.tables);
  }
}

/** `prandom(255)` of the original, from the game's own generator. */
function chance(ctx: GuardStepContext, probability: number): boolean {
  return probability > (ctx.random?.() ?? 128);
}

function guardAdvance(guard: GuardState, ctx: GuardStepContext): void {
  if (chance(ctx, ADV_PROB[guard.skill] ?? 0)) moveForward(guard, ctx);
}

function guardStrike(guard: GuardState, kid: CharacterState, ctx: GuardStepContext): void {
  if (kid.frame === 169 || kid.frame === 151) return;
  const table = PARRY_FRAMES.includes(guard.frame) ? RESTRIKE_PROB : STRIKE_PROB;
  if (chance(ctx, table[guard.skill] ?? 0)) moveShift(guard, ctx);
}

/**
 * `guard_block`. One set of frames to react to -- 152, 153 and 162, the
 * lunge and the strike out of a block -- and the choice between the two
 * tables is not which of them the Prince is on but whether the guard's
 * own last blow was parried: `justblocked`, set to four when it was and
 * counted down a tick at a time. The port had the two tables chosen by
 * the frame and two frames in the list that belong to neither, 150 and
 * 161, which are the Prince parrying and nothing to block at all.
 */
function guardBlock(
  guard: GuardState, kid: CharacterState, distance: number, ctx: GuardStepContext,
): void {
  if (kid.frame !== 152 && kid.frame !== 153 && kid.frame !== 162) return;
  const table = ctx.justBlocked?.() ? IMP_BLOCK_PROB : BLOCK_PROB;
  if (chance(ctx, table[guard.skill] ?? 0)) moveUp(guard, kid, distance, ctx);
}

function guardKidArmed(
  guard: GuardState, kid: CharacterState, distance: number, ctx: GuardStepContext,
): void {
  if (distance < 10 || distance >= 29) {
    guardAdvance(guard, ctx);
    return;
  }
  guardBlock(guard, kid, distance, ctx);
  if (guard.waitTimer !== 0) return;
  if (distance < 12 || distance >= 29) guardAdvance(guard, ctx);
  else guardStrike(guard, kid, ctx);
}

function guardKidInSight(
  guard: GuardState, kid: CharacterState, distance: number, ctx: GuardStepContext,
): void {
  if (kid.sword === SWORD_DRAWN) {
    guardKidArmed(guard, kid, distance, ctx);
  } else if (guard.waitTimer === 0) {
    if (distance < SWORD_REACH) moveShift(guard, ctx);
    else moveForward(guard, ctx);
  }
}

function guardKidFar(guard: GuardState, ctx: GuardStepContext): void {
  const front = ctx.floorInFront?.(guard) ?? true;
  if (front) moveForward(guard, ctx);
  else moveBackward(guard, ctx);
}

function autocontrolGuardActive(guard: GuardState, ctx: GuardStepContext): void {
  const kid = ctx.kid;
  // `autocontrol_guard` asks only whether the *guard* is alive. A dead
  // Prince is not a reason to stand there with the blade out: it makes
  // `can_guard_see_kid` nought, and nought is `move_down_back`, which
  // puts the blade down and goes to the inactive stand. The port
  // returned here instead, so every guard in the game stood over the
  // body en garde for as long as the death screen was up -- ninety
  // ticks of `probeF`, and the same in every run that ends in a fight.
  if (!kid || guard.alive >= 0) return;
  if (guard.sword !== SWORD_DRAWN) return;
  if (guard.frame === GUARD_FRAME_INACTIVE || guard.frame < 150) return;
  const sight = ctx.canGuardSee ?? canGuardSeeKid(guard, kid, ctx);
  // He can see him but will not cross what is between them: he stands.
  if (sight === SIGHT.wont) return;
  if (sight === SIGHT.none) {
    moveDownBack(guard, ctx);
    return;
  }
  const distance = charOppDist(guard, kid);
  // A Prince picking himself up off the floor is left alone.
  if (distance >= 12 && kid.frame >= 102 && kid.frame < 118
    && kid.action === ACTION.bumped) {
    return;
  }
  if (distance < 35) {
    if (distance < 12) {
      if (guard.direction === kid.direction) moveBackward(guard, ctx);
      else moveForward(guard, ctx);
    } else {
      guardKidInSight(guard, kid, distance, ctx);
    }
    return;
  }
  if (guard.waitTimer !== 0) return;
  if (guard.direction !== kid.direction) {
    if (kid.frame >= 7 && kid.frame < 15) {
      if (distance < 40) moveShift(guard, ctx);
      return;
    }
    if (kid.frame >= 34 && kid.frame < 44) {
      if (distance < 50) moveShift(guard, ctx);
      return;
    }
  }
  guardKidFar(guard, ctx);
}

/**
 * A guard with his back to the Prince turns round. The original does
 * this out of `move_2_backward` and the turn sequences; here it is kept
 * as the one thing of the old `fight` worth keeping.
 */
function faceTheKid(guard: GuardState, ctx: GuardStepContext): void {
  const kid = ctx.kid;
  if (!kid || guard.alive >= 0 || guard.sword !== SWORD_DRAWN) return;
  if (!isReady(guard) || kid.alive >= 0) return;
  if (guard.room !== kid.room || guard.currentRow !== kid.currentRow) return;
  if (guard.direction !== facingOf(guard, kid)) {
    startSequence(guard, SWORD_SEQ.turn, ctx.tables);
  }
}

/** How long a guard holds off after a blow has landed, by his skill. */
export function refractoryFor(skill: number): number {
  return REFRACTORY[skill] ?? 0;
}

/**
 * Advance a guard by one frame.
 *
 * A guard moves the same way the Prince does: its sequence is a byte-code
 * program, and running one frame of it is what shifts the character. Until
 * this existed nothing stepped a guard at all, so every guard in the game
 * stood in its opening frame for ever -- which is why they are statues even
 * though their sprites, their colours and their swords are all right.
 *
 * Beyond running the sequence, the only decision a guard makes so far is
 * `comeOnGuard`. Advancing, retreating and striking -- the rest of
 * `autocontrol_guard` -- are not written yet.
 */
export function stepGuard(guard: GuardState, ctx: GuardStepContext): void {
  if (guard.direction === NO_DIRECTION) return;
  if (guard.waitTimer > 0) guard.waitTimer -= 1;
  comeOnGuard(guard, ctx);
  faceTheKid(guard, ctx);
  autocontrolGuardActive(guard, ctx);
  playSequence(guard, { tables: ctx.tables, effects: ctx.effects });
  if (guard.action === ACTION.inFreefall) {
    guard.fallY = Math.min(guard.fallY + FALLING_SPEED_ACCEL, FALLING_SPEED_MAX);
    guard.x = forwardX(guard, guard.fallX) & 0xff;
  }
  guard.y = (guard.y + guard.fallY) & 0xff;
  const frame = guardFrame(guard, ctx.tables);
  if (frame) guard.currentColumn = determineColumn(guard, frame);
}

/**
 * Guards have their own frame table, offset from the Prince's: the frames
 * they share with him use his, the rest are their own.
 */
export function guardFrame(guard: GuardState, tables: ExeTables): Frame | null {
  const frame = guard.frame;
  if (guard.charId === CHAR_ID.guard || guard.charId === CHAR_ID.skeleton) {
    let add = 0;
    if (frame >= 102 && frame < 107) add = 70;
    const index = frame + add - 149;
    if (index >= 0 && index < tables.frameTableGuard.length) {
      return tables.frameTableGuard[index];
    }
  }
  return tables.frameTableKid[frame] ?? null;
}

export function guardDraw(guard: GuardState, tables: ExeTables): CharacterDraw | null {
  if (guard.direction === NO_DIRECTION) return null;
  const frame = guardFrame(guard, tables);
  if (!frame) return null;
  return placeCharacter(guard, frame, 'guard');
}
