/**
 * The original's random number generator.
 *
 * It is a plain linear congruential generator, and the game leans on its
 * exact behaviour: wall decoration is drawn from it seeded by a tile's own
 * position, so a room looks the same every time it is drawn, and loose floors
 * and torch flames draw from the running stream.
 */
export class Prng {
  private seed = 0;

  set(value: number): void {
    this.seed = value >>> 0;
  }

  get(): number {
    return this.seed >>> 0;
  }

  /** A number in 0..max, inclusive, as the original returns it. */
  next(max: number): number {
    this.seed = (Math.imul(this.seed, 214013) + 2531011) >>> 0;
    return (this.seed >>> 16) % (max + 1);
  }
}
