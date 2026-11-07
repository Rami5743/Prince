/**
 * Sword fighting.
 *
 * The Prince and a guard fight with the same moves, out of the same
 * byte-code: sequence 55 draws the sword and settles into the stance, 56
 * steps in, 57 steps back, 58 lunges, 62 brings the blade up to block, 74
 * is the recoil from being hit and 71 is a guard going down. All of them
 * end on the stance loop, which holds frame 171, so a character on that
 * frame is between moves and free to start another.
 *
 * What is written here is the shape of the fight, taken from those
 * sequences and from `tests/golden/session-level2-meet`, where the guard
 * closes, lunges, and the Prince loses a hit point and gives ground. What
 * is *not* settled is the timing: how long a guard waits before lunging,
 * how its skill changes that, and how the original decides a blow has
 * landed. Those need captures of their own, and until there are some this
 * is a fight that plays rather than the original's fight.
 */
import type { CharacterState } from './character.ts';

/**
 * The Prince's own sword sequences, which are not the guard's.
 *
 * Two of them differ and the port had the guard's. `sword_strike` picks
 * 75 for the Kid and 58 for anyone else, and `forward_with_sword` picks
 * 86 for the Kid and 56 for the guard. Read out of `UNCRKD.EXE` itself,
 * which is the only thing that settles which byte-code each number is:
 *
 *     75  frame 151, 152, 153, 154, 155, 156, 157
 *     58  frame 168, then the same from 151
 *     86  set_fall 1 0, dx 6, frame 164, 165
 *     56  set_fall 1 0, dx 2, frame 163, dx 4, frame 164, 165
 *
 * So the Prince's blade is a frame quicker than a guard's -- 58 opens
 * with 168, the wind-up -- and his step in is one frame of six units
 * where a guard's is two of two and four. The port gave him the guard's
 * of each, which is the wrong way round and slower in both.
 */
export const SWORD_SEQ = {
  enGarde: 55,
  advance: 86,
  retreat: 57,
  strike: 75,
  turn: 60,
  block: 62,
  stabbed: 74,
  /** A blow that was stopped: the striker's own recoil. */
  parried: 69,
  dropDead: 71,
  /**
   * Run through by a blade.
   *
   * 85, not 54. Sequence 85 is `action 5` and then a jump into the body
   * of 71, so the Prince goes down the way a guard does: frames 179, 180,
   * 181, 182, 183 and 185, a collapse. Sequence 54 holds frame 178 for
   * ever, and frame 178 is the chomper's body -- which is exactly how the
   * player described what a guard's kill looked like.
   */
  kidDie: 85,
} as const;

/** Drawn, as opposed to sheathed. */
export const SWORD_DRAWN = 2;

/** The stance the loop at the end of every sword sequence holds. */
export const STANCE_FRAME = 171;
const STANCE_SETTLING = 170;

/**
 * Parrying. The original looks for exactly these two frames and no
 * others -- `check_hurting` in SDLPoP's `seg002.c` -- and the port had
 * 169 in the list, which is not one of them.
 */
const BLOCK_FRAMES = [150, 161];

/** The frame a blocker is put on when a blow is parried. */
export const PARRY_FRAME = 161;

/** The lunge of sequence 58, from the wind-up to the recovery. */
const STRIKE_FIRST = 151;
const STRIKE_LAST = 157;
/**
 * The two frames a blade can do anything on. 153 can only be parried;
 * 154, the poke, is the one that lands. The port had the contact on 155
 * -- read off `action 5` in sequence 58, which turns out to mark
 * something else -- and a blow that lands a frame late misses a Prince
 * who is running past, which is how he got through the guard of level
 * 1's room 3 in the recording `13ab6867` where the original kills him.
 */
const STRIKE_PARRYABLE = 153;
const STRIKE_CONTACT = 154;

/**
 * Between moves, and free to start another.
 *
 * Five frames, not two. The original's `sword_strike` will begin a lunge
 * from 157, 158, 165, 170 or 171 -- the two standing poses, the two of
 * the walk, and the one it settles into -- and the port only knew 170
 * and 171. A guard who has just taken a step is on 165 or 158, so he
 * waited two or three ticks for a pose he was not going to reach before
 * the Prince had gone past. That is how an unarmed Prince ran through
 * the guard of level 1's room 3 in the recording `13ab6867`, where the
 * original runs him through on the way.
 */
const READY_FRAMES = [157, 158, 165, 170, 171];

export function isReady(c: CharacterState): boolean {
  return c.sword === SWORD_DRAWN && READY_FRAMES.includes(c.frame);
}

export function isBlocking(c: CharacterState): boolean {
  return c.sword === SWORD_DRAWN && BLOCK_FRAMES.includes(c.frame);
}

export function isStriking(c: CharacterState): boolean {
  return c.sword === SWORD_DRAWN && c.frame >= STRIKE_FIRST && c.frame <= STRIKE_LAST;
}

/** The one frame of a lunge on which it can land. */
export function strikeLands(c: CharacterState): boolean {
  return c.sword === SWORD_DRAWN && c.frame === STRIKE_CONTACT;
}

/**
 * How far in front of a character its opponent is, the original's own
 * `char_opp_dist`: positive in front, negative behind, 999 in another
 * room, and thirteen more when the two are facing opposite ways.
 */
export function charOppDist(c: CharacterState, other: CharacterState): number {
  if (c.room !== other.room) return 999;
  let distance = other.x - c.x;
  if (c.direction < 0) distance = -distance;
  if (distance >= 0 && c.direction !== other.direction) distance += 13;
  return distance;
}

/** What a blade does this tick, if anything: the original's `check_hurting`. */
export type Blow = 'parried' | 'hurt' | null;

export function checkHurting(c: CharacterState, other: CharacterState): Blow {
  if (c.sword !== SWORD_DRAWN) return null;
  if (c.currentRow !== other.currentRow) return null;
  if (c.frame !== STRIKE_PARRYABLE && c.frame !== STRIKE_CONTACT) return null;
  const distance = charOppDist(c, other);
  const parrying = BLOCK_FRAMES.includes(other.frame);
  if (distance >= 0 && distance < SWORD_REACH && parrying) return 'parried';
  if (c.frame !== STRIKE_CONTACT) return null;
  // Eight from an unarmed opponent, twelve from one with his blade up.
  const nearest = other.sword < SWORD_DRAWN ? 8 : 12;
  return distance >= nearest && distance < SWORD_REACH ? 'hurt' : null;
}

/** How far a poke reaches, the original's twenty-nine. */
export const SWORD_REACH = 29;

/** How far a blade reaches, in internal units. */
export const SWORD_RANGE = 24;

/** Is `other` in front of `c`, and close enough to be hit? */
export function withinReach(c: CharacterState, other: CharacterState): boolean {
  if (c.room !== other.room || c.currentRow !== other.currentRow) return false;
  const gap = other.x - c.x;
  const inFront = c.direction === 0 ? gap > 0 : gap < 0;
  return inFront && Math.abs(gap) <= SWORD_RANGE;
}

/** Which way `c` would have to face to be looking at `other`. */
export function facingOf(c: CharacterState, other: CharacterState): number {
  return other.x > c.x ? 0 : -1;
}
