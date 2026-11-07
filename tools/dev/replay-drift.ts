/**
 * The ticks the original loses when it changes room.
 *
 * A recording is a list of what was held on each of the port's ticks. The
 * original, replayed under DOSBox, is sent those presses on the clock --
 * tick n at n/12 of a second -- because that is the only thing a keyboard
 * understands. The two only stay in step while the original's ticks are
 * as long as the port's, and at a room change they are not: the original
 * stops to blank the screen and draw the new room, and the capture shows
 * it losing about four ticks every time.
 *
 * Whatever the player held during those four ticks, the original never
 * saw: by the time it looked at the keyboard again the clock had moved
 * on. So from the first room change onwards the original is reading a
 * different part of the recording from the port, and a comparison of the
 * two is comparing two different runs.
 *
 * This is the port's side of that. It says which entry of the recording
 * the original would have been reading on each of its own ticks, so a
 * replay can be fed the same presses the original was.
 */
export class ReplayDrift {
  /** How many entries of the recording have gone by unread. */
  skew = 0;

  readonly stall: number;

  constructor(stall: number) {
    this.stall = stall;
  }

  /** The entry of the recording this tick reads. */
  index(tick: number): number {
    return tick + this.skew;
  }

  /** Call when the drawn room has changed: the original stops to redraw. */
  roomChanged(): void {
    this.skew += this.stall;
  }
}
