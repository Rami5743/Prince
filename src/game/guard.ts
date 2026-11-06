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
import { determineColumn, FALLING_SPEED_ACCEL, FALLING_SPEED_MAX } from './physics.ts';
import {
  SWORD_SEQ, SWORD_DRAWN, isReady, withinReach, facingOf,
} from './sword.ts';
import type { LevelState } from './level-state.ts';
import { X_BUMP, FIRST_ONSCREEN_COLUMN, TILE_SIZE_X, Y_LAND } from './geometry.ts';

/** Sequence the guard starts on when a room is entered. */
export const GUARD_SEQ = {
  standInactive: 77,
  activeAfterFall: 63,
  enGarde: 55,
  advance: 56,
  retreat: 57,
  strike: 58,
  turn: 60,
  readyBlock: 62,
  strikeToBlock: 61,
  blockToStrike: 66,
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
  guard.currentColumn = tile % 10;
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
  if (ctx.kidRoom !== guard.room || ctx.kidRow !== guard.currentRow) return;
  guard.sword = 2;
  startSequence(guard, GUARD_SEQ.enGarde, ctx.tables);
}

/**
 * Within a blade's length of the Prince, a guard lunges -- not every frame,
 * but after a wait that its skill shortens. Out of reach it does nothing
 * here and `advanceOnKid` walks it in.
 *
 * The wait is a guess. `session-level2-meet` shows a guard of skill 1
 * lunging, landing a blow and pressing on, but a handful of captures of
 * one guard cannot say how long it waits or how skill changes that.
 */
function fight(guard: GuardState, ctx: GuardStepContext): void {
  const kid = ctx.kid;
  if (!kid || guard.alive >= 0 || guard.sword !== SWORD_DRAWN) return;
  if (!isReady(guard)) return;
  if (kid.alive >= 0) return;
  if (guard.room !== kid.room || guard.currentRow !== kid.currentRow) return;

  if (guard.direction !== facingOf(guard, kid)) {
    startSequence(guard, SWORD_SEQ.turn, ctx.tables);
    return;
  }
  if (!withinReach(guard, kid)) return;
  if (guard.waitTimer > 0) {
    guard.waitTimer -= 1;
    return;
  }
  guard.waitTimer = Math.max(2, GUARD_STRIKE_WAIT - guard.skill);
  startSequence(guard, SWORD_SEQ.strike, ctx.tables);
}

/** The frames of the en garde stance, which a guard holds between moves. */
const EN_GARDE_FIRST = 170;
const EN_GARDE_LAST = 171;

/**
 * A guard who is on guard walks in on the Prince.
 *
 * `session-level2-meet` shows it plainly: an armed Prince stops a few tiles
 * away, the guard draws his sword and then closes the distance a step at a
 * time until the two are within a sword's length of each other, and holds
 * there. Sequence 56 is the step, and it ends back on the stance, so one
 * call per step is all this needs.
 *
 * What is still missing from the capture is everything after the two of
 * them meet -- the striking, the blocking and the damage. The guard here
 * therefore walks up and waits.
 */
function advanceOnKid(guard: GuardState, ctx: GuardStepContext): void {
  if (guard.alive >= 0 || guard.sword !== 2) return;
  // Not at an unarmed Prince. The guard of level 1's room 3 stands his
  // ground while an unarmed Prince runs at him and only strikes when he
  // arrives, where level 2's guard -- met by a Prince with a sword --
  // leaves his corner and closes. Both captures are explained by the
  // Prince's sword and nothing else, so that is what this reads.
  if (ctx.kidArmed === false) return;
  if (guard.frame < EN_GARDE_FIRST || guard.frame > EN_GARDE_LAST) return;
  if (ctx.kidRoom !== guard.room || ctx.kidRow !== guard.currentRow) return;
  if (ctx.kidX === undefined) return;
  const gap = ctx.kidX - guard.x;
  if (Math.abs(gap) <= GUARD_REACH) return;
  // Only forwards. Turning to face the other way is its own sequence and
  // the captures have not pinned when a guard decides to use it.
  const towards = gap > 0 ? 0 : -1;
  if (guard.direction !== towards) return;
  startSequence(guard, GUARD_SEQ.advance, ctx.tables);
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
  comeOnGuard(guard, ctx);
  fight(guard, ctx);
  advanceOnKid(guard, ctx);
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
