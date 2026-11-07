/**
 * Every recording the player sent, against the original, in the suite.
 *
 * The ten -- now fifteen -- recordings were being compared by hand, on a
 * machine that happened to have the captures lying about, and nothing
 * remembered the answer. A capture is five hundred pictures and twenty
 * megabytes, so the pictures cannot live in the repository; what a
 * comparison reads out of them can. `tools/oracle/digest.py` boils each
 * capture down to what moved on each tick -- the box around whatever
 * changed and how many pixels of it there were -- which is four numbers
 * and a count, the same on both sides whatever the palette is doing, and
 * a few kilobytes for a whole run. Those are in `tools/oracle/digests`.
 *
 * The test replays each recording, reads the same four numbers off the
 * port's own rendering, and counts the ticks the two agree on.
 *
 * ## What the numbers mean
 *
 * Not "the port is wrong on the rest". The original was captured twice
 * from the same recording and the two runs of `PRINCE.EXE` agree with
 * each other on 1397 of 1473 ticks by this measure -- and on 729 of them
 * if the alignment is not allowed to slip at all. Ninety-six per cent is the
 * ceiling, not a hundred: the keys go in on the clock rather than on the
 * game's ticks, the emulator loses a little time whenever it redraws a
 * room, and a sword fight is driven by random numbers that are not the
 * same twice. Once the Prince dies at a different tick, everything after
 * it is a different run, which is why the recordings that end in a fight
 * score worst.
 *
 * So these are pins, not targets. They go up when something is fixed and
 * they must not go down.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, REPO } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { digestOfRun, agreement, type Moved } from '../../tools/dev/digest-common.ts';

const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const RECORDINGS = join(REPO, 'tools', 'oracle', 'recordings');

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/**
 * How many of the original's ticks each recording agrees on.
 *
 * Where the room they are in is the same throughout, the port is at or
 * near the ceiling. The low ones all have the same causes: a sword
 * fight, whose random numbers cannot be matched; a death at a different
 * tick, after which the two runs are not the same run; and a decision
 * that falls within a tick of a key edge.
 *
 * `0fbffa60` is the clearest of the last sort and the lowest of the
 * fifteen. The probe `14.,21r,17.,8r,4.,2s,2rs,5s,2rs,16s,40.` is its
 * opening to the tick -- the same keys on the same ticks as far as tick
 * 90, and the decision falls on 79. Captured, the probe grabs the ledge
 * of room 2 and the recording does not. Same game, same input, two runs:
 * all that differs is where the key edges landed inside the ticks. From
 * tick 79 that capture is a different run, and nothing the port does can
 * score against it.
 *
 * And the port is on the right side of it. Over ticks 66 to 75, which is
 * the last careful step before the drop, the box around the Prince in
 * the probe's capture and in the port is the same box to the pixel on
 * every tick -- (201,150)-(219,177), (207,151)-(225,177),
 * (216,150)-(225,176), and so on. The capture of `0fbffa60` has him
 * eight pixels to the left of both and a tick ahead: one careful step
 * that did not carry as far, because the press that started it landed a
 * fraction later in the tick. Eight pixels is three and a half of the
 * game's own units, and three and a half units is the difference between
 * catching the ledge and going past it.
 *
 * The same grab is the whole of the gap in `3764b76d` and `33e8ace7`
 * too, which is three of the five lowest scores on one knife edge.
 */
const EXPECTED: Record<string, number> = {
  '0fbffa60': 249,
  '13ab6867': 648,
  '25c4ebb8': 369,
  '33e8ace7': 208,
  '3764b76d': 94,
  '5920a8c2': 383,
  '72b3522f': 159,
  '756b259c': 348,
  '760c3e74': 1005,
  '848ee3c4': 673,
  '9b60bf3a': 464,
  'a356bdd6': 143,
  'b4ff4672': 342,
  'e209b01a': 187,
  'ec99dc5b': 208,
};

async function score(name: string): Promise<{ agreed: number; ticks: number }> {
  const dos = JSON.parse(
    readFileSync(join(DIGESTS, `${name}.json`), 'utf8'),
  ).ticks as Moved[];
  const rec = parseRecording(readFileSync(join(RECORDINGS, `${name}.json`), 'utf8'));
  const port = await digestOfRun(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    decodeTimeline(rec.timeline),
  );
  return { agreed: agreement(dos, port), ticks: Math.min(dos.length, port.length) };
}

describe('the recordings, against a capture of the original', () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} agrees on ${expected} ticks`, async () => {
      const { agreed, ticks } = await score(name);
      expect(agreed, `${name}: ${agreed} of ${ticks} ticks`)
        .toBeGreaterThanOrEqual(expected);
      // And the pin is kept honest: a jump means the number should move.
      expect(agreed, `${name} has improved -- raise the pin to ${agreed}`)
        .toBeLessThan(expected + 10);
    }, 120000);
  }
});
