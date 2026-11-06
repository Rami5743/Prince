/**
 * The port against the original, over a whole play session.
 *
 * The other comparisons in this suite each pin one move. This one plays a
 * level the way a person plays it -- several moves in a row, with the state
 * each leaves behind carried into the next -- and requires the port to
 * reproduce every captured frame, in order, pixel for pixel.
 *
 * That ordering is what makes it useful for finding bugs rather than only
 * reporting them: a session stops at the first capture the port cannot
 * reproduce, and the capture's index says which move was being made. See
 * tests/helpers/session.ts for how the two clocks are lined up, and
 * docs/testing.md for how a session is captured.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_DIR } from '../helpers/fixtures.ts';
import { alignSession, loadSession, type SessionResult } from '../helpers/session.ts';

/**
 * Sessions that have been captured from the original and committed. Each
 * entry says how much of it the port currently reproduces, so that a
 * regression shows up as a smaller number and a fix shows up as a larger
 * one. `reproduces` is the count of leading captures that match exactly.
 */
const SESSIONS: { name: string; reproduces: number }[] = [
  // 32 of 51. What the other nineteen are, as far as it is understood:
  //
  //  s011, s012  the first fall. Ten and ninety pixels of the Prince's own
  //              sprite, in the same place as the three pixels
  //              tests/game/careful-step.test.ts records at (164..166, 126).
  //              Unexplained, and recorded rather than excused.
  //  s025        the tick the bump lands on. The port bumps a tick away from
  //              where the original does; the frames either side of it match.
  //  s035, s038  the room change. s036 and s037 are the blank, which the
  //              port now shows too; s038 caught the palette part way
  //              through the change and is not reproducible.
  //  s039..s050  after that room change. Five to seven hundred pixels out,
  //              not yet looked into.
  { name: 'level1-open', reproduces: 34 },

  // Careful steps up to a ledge, then Up on its own, then Up with Shift.
  // 34 of 54. All three careful steps are reproduced exactly, and so is the
  // climb and the jumping that follows it while the key stays down.
  { name: 'level1-grab', reproduces: 34 },

  // The same opening as level1-grab, then Down and Down with Shift. 9 of
  // 48, and that number is mostly about the capture rather than the port:
  // this run's second careful step began a tick from where the other run's
  // did, so from its ninth capture it is in a different place and stays
  // there. It is kept as a deterministic regression guard -- the captures
  // are fixed, so the count only moves if the port does -- and as the
  // evidence for what docs/testing.md says about what a session can tell
  // you. Do not read it as a score.
  { name: 'level1-down', reproduces: 9 },

  // Level 2's room 4, which has a guard at its left end. 9 of 41. What it
  // settles is the guard: he stands idle, comes on guard, and then holds
  // the stance for twenty captures without advancing a step.
  //
  // It settles nothing about whether a guard can stop the Prince, because
  // neither Prince gets near him. The original's stops on one of the two
  // loose floors at columns 7 and 8, which gives way, and he spends the
  // rest of the session on the row below; the port's run-stop carries it a
  // few units further, onto the solid floor at column 6, so it stays up.
  // The two also part company at the ninth capture, where the original
  // blanks the screen to change room and the port does not.
  { name: 'level2-guard', reproduces: 9 },

  // The same room, with the run left not interrupted, so the Prince
  // crosses the loose floors at speed and reaches the guard. 9 of 55 --
  // the two part at the room change, as above -- and like the other guard
  // session it is here for what it shows: the guard leaves his corner,
  // closes on the Prince and then fights him, with the Prince taking a hit
  // and giving ground. The closing is now reproduced; the fight is not
  // written at all. 9 of 55.
  { name: 'level2-meet', reproduces: 9 },
];

/** Every capture, so a failure says which moves parted company and where. */
function report(result: SessionResult): string {
  const lines: string[] = [];
  for (const m of result.matches) {
    lines.push(
      `  ${m.name} [${m.phase}] `
      + (m.tick === null
        ? `UNREPRODUCED: closest tick ${m.bestTick}, ${m.bestDiff} pixels out `
          + `(${m.state})`
        : `tick ${m.tick}`),
    );
  }
  return lines.join('\n');
}

describe('a whole play session, against the original', () => {
  for (const entry of SESSIONS) {
    const dir = join(GOLDEN_DIR, `session-${entry.name}`);
    const have = existsSync(dir);

    it.skipIf(!have)(`${entry.name}: reproduces ${entry.reproduces} captures in order`,
      async () => {
        const session = loadSession(entry.name);
        const total = session.phases.reduce((a, p) => a + p.shots, 0);
        const result = await alignSession(entry.name, dir, {
          artifacts: join('/tmp', `session-${entry.name}-failures`),
        });
        expect(
          result.reproduced,
          `${entry.name}: ${result.reproduced} of ${total} captures reproduced\n`
          + `${report(result)}`,
        ).toBe(entry.reproduces);
      }, 300000);
  }
});
