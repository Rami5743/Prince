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
import { startSequence, playSequence } from './sequence.ts';
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
}

export function newGuard(): GuardState {
  return {
    ...newCharacter({ charId: CHAR_ID.guard }),
    skill: 0,
    colour: 0,
    hitPoints: 0,
    maxHitPoints: 0,
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
