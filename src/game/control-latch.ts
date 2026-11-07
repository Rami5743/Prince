/**
 * The original's second layer of input.
 *
 * Underneath are the keys that are down right now -- `Controls`. On top of
 * them the game keeps one latch per direction, and per the shift key, with
 * three states: *held*, meaning pressed and not yet acted on; *released*;
 * and *ignored*, meaning pressed but already acted on and not to be acted on
 * again until the key goes up and comes back down.
 *
 * That is what stops a held key repeating. A careful step, a standing jump
 * and a crouch each happen once per press, however long the key is held,
 * because the move sets its latch to ignored as it starts. Moves that are
 * meant to repeat -- running, mainly -- read the keys directly instead.
 */

/** What the player is pressing right now. */
export interface Controls {
  /** -1 left, 0 none, 1 right. */
  x: number;
  /** -1 up, 0 none, 1 down. */
  y: number;
  shift: boolean;
}

export const CONTROL = {
  /** Pressed, and nothing has acted on it yet. */
  held: -1,
  released: 0,
  /** Pressed, but already acted on: wait for the key to go up. */
  ignore: 1,
} as const;

export class ControlLatch {
  /**
   * The two side latches belong to the arrow keys, not to the Prince.
   *
   * The original keeps them that way round: `read_user_control` fills
   * `control_forward` from the left arrow and `control_backward` from
   * the right one, whatever way he is facing, and `user_control` calls
   * `flip_control_x` to swap the pair over for the duration of
   * `control()` when he is facing right -- and swaps them back after.
   *
   * It matters when he turns with a key still down. Run right, press
   * Left: the run-turn takes the left arrow's latch and marks it used.
   * He comes out of the turn facing left, and that same latch is now his
   * forward one -- still used, so nothing he does next can be started by
   * the Left he is still holding until he lets go of it. The port
   * recomputed forward and backward from the direction on every tick, so
   * the used latch stayed with `backward` and the key came up fresh as
   * `forward` the moment he turned.
   */
  left: number = CONTROL.released;
  right: number = CONTROL.released;
  up: number = CONTROL.released;
  down: number = CONTROL.released;
  /** The latch over the shift key; the raw key is read separately. */
  shift2: number = CONTROL.released;

  /** `flip_control_x`: which arrow is forward, fixed for this tick. */
  private facingRight = false;

  get forward(): number { return this.facingRight ? this.right : this.left; }

  set forward(value: number) {
    if (this.facingRight) this.right = value;
    else this.left = value;
  }

  get backward(): number { return this.facingRight ? this.left : this.right; }

  set backward(value: number) {
    if (this.facingRight) this.left = value;
    else this.right = value;
  }

  /**
   * Take in the keys that are down now. A latch that is already held is left
   * alone -- only the move that acts on it clears it -- and one that is
   * ignored stays ignored until its key goes up.
   */
  read(controls: Controls, direction: number): void {
    this.facingRight = direction >= 0;
    this.left = step(this.left, controls.x < 0);
    this.right = step(this.right, controls.x > 0);
    this.up = step(this.up, controls.y < 0);
    this.down = step(this.down, controls.y > 0);
    this.shift2 = step(this.shift2, controls.shift);
  }

  /**
   * The original's `release_arrows`: forget every direction, and hand back
   * the ignored state for the caller to put on the one it has just used.
   */
  releaseArrows(): number {
    this.left = CONTROL.released;
    this.right = CONTROL.released;
    this.up = CONTROL.released;
    this.down = CONTROL.released;
    return CONTROL.ignore;
  }

  /** Forget everything, as the game does when a level starts. */
  clear(): void {
    this.releaseArrows();
    this.shift2 = CONTROL.released;
  }
}

function step(latch: number, down: boolean): number {
  // Letting go always clears the latch, even one that nothing has acted on
  // yet. Keeping it would hand the next move a press the player has already
  // finished with: tap Up to climb a ledge, let go, then press left, and
  // the stale Up turns the step into a standing jump.
  if (!down) return CONTROL.released;
  // Held down: still waiting to be acted on, unless it already has been.
  return latch === CONTROL.ignore ? CONTROL.ignore : CONTROL.held;
}
