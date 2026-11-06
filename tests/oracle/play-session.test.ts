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
  //  s035..s038  the original blanks the screen while it changes room, and
  //              the port does not: two of these captures are black and one
  //              caught the palette part way through. Known, and listed in
  //              docs/status.md.
  //  s039..s050  after that room change. Five to seven hundred pixels out,
  //              not yet looked into.
  { name: 'level1-open', reproduces: 32 },

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

  // The Prince walks up to the guard of level 2's room 4. 9 of 41, and the
  // session is here for what it shows rather than for its count. What it
  // shows is the one thing still missing: the original's Prince cannot get
  // past the guard and is still in that room twenty captures later, while
  // the port's runs straight through him and out the far side. Until a
  // guard can stop him, nothing after the ninth capture is comparable.
  { name: 'level2-guard', reproduces: 9 },
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
