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

export const SWORD_SEQ = {
  enGarde: 55,
  advance: 56,
  retreat: 57,
  strike: 58,
  turn: 60,
  block: 62,
  stabbed: 74,
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

/** The blade-up frames of sequence 62. */
const BLOCK_FRAMES = [150, 169];

/** The lunge of sequence 58, from the wind-up to the recovery. */
const STRIKE_FIRST = 151;
const STRIKE_LAST = 157;
/**
 * The frame the blow lands on. Sequence 58 marks it: `action 5` falls
 * immediately before frame 155, which is the only thing in the sequence
 * that singles a frame out.
 */
const STRIKE_CONTACT = 155;

/** Between moves, and free to start another. */
export function isReady(c: CharacterState): boolean {
  return c.sword === SWORD_DRAWN
    && (c.frame === STANCE_FRAME || c.frame === STANCE_SETTLING);
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
