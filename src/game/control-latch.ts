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
  forward: number = CONTROL.released;
  backward: number = CONTROL.released;
  up: number = CONTROL.released;
  down: number = CONTROL.released;
  /** The latch over the shift key; the raw key is read separately. */
  shift2: number = CONTROL.released;

  /**
   * Take in the keys that are down now. A latch that is already held is left
   * alone -- only the move that acts on it clears it -- and one that is
   * ignored stays ignored until its key goes up.
   */
  read(controls: Controls, direction: number): void {
    const forward = direction < 0 ? controls.x < 0 : controls.x > 0;
    const backward = controls.x !== 0 && !forward;
    this.forward = step(this.forward, forward);
    this.backward = step(this.backward, backward);
    this.up = step(this.up, controls.y < 0);
    this.down = step(this.down, controls.y > 0);
    this.shift2 = step(this.shift2, controls.shift);
  }

  /**
   * The original's `release_arrows`: forget every direction, and hand back
   * the ignored state for the caller to put on the one it has just used.
   */
  releaseArrows(): number {
    this.forward = CONTROL.released;
    this.backward = CONTROL.released;
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
