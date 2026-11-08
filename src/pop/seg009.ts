/**
 * `seg009.c`, the part of it the game's logic needs.
 *
 * The rest of that file is DAT loading, decompression and SDL, which
 * the port already has in `src/render/assets.ts` and does not need
 * translating.
 */
import { g } from './state.ts';

// seg009:0467
export function prandom(max: number): number {
  // The C does this in 32-bit unsigned arithmetic; `Math.imul` keeps
  // the multiply exact and `>>> 0` puts it back in range.
  g.random_seed = (Math.imul(g.random_seed, 214013) + 2531011) >>> 0;
  return ((g.random_seed >>> 16) % (max + 1));
}

/** The seed is the clock in the original; a replay wants it fixed. */
export function set_seed(seed: number): void {
  g.random_seed = seed >>> 0;
}
