/**
 * Which of a recording's two captures has the keys in the right ticks?
 *
 *   node --experimental-strip-types tools/dev/pick-shift.ts \
 *       <recording.json> <digest-shift0.json> <digest-shift1.json> \
 *       <first-divergence-tick>
 *
 * ## The problem
 *
 * `dosbox_oracle.py` sends every key edge on a wall clock whose origin
 * is Ctrl+A plus however long DOSBox took to restart the level, and the
 * game reads the keyboard at the start of each of its own ticks. Where
 * the one clock sits inside the other's tick is wherever that landed --
 * anywhere in a tick, differently on every run, and no value of
 * `--settle` helps: the uncertainty is a whole tick wide and so is the
 * window. About half of all captures come out with every key edge of
 * the run a tick early.
 *
 * A tick is not a rounding error. In `0fbffa60` the player lets go of
 * Right on tick 35, when the Prince is on frame 8 of his stride.
 * `control_running` takes the key only on frames 7 and 11, so he runs
 * on and goes over the edge of the floor in room 1. Read one tick
 * early, on frame 7, he pulls up at the lip of it instead, and nothing
 * in the remaining seven hundred ticks of the run is the same again.
 *
 * ## Telling which
 *
 * Every recording is captured twice, the second with the whole
 * schedule a tick later. The two captures are the same picture until
 * the first key that *matters* is read; `first_divergence.py` says
 * which tick that is. On that one tick the two captures show different
 * pictures, and at most one of them can be the picture the port draws
 * for it. That one is the capture whose clock is in step with the
 * recording.
 *
 * It is one tick of the port's behaviour, on the tick where the two
 * candidates disagree, and it decides nothing else: the rest of the
 * comparison is what the port is being measured on. If the port is
 * wrong on that tick too then neither capture matches, and this says
 * so rather than guessing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, type Digest } from './digest-common.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const [recPath, zeroPath, onePath, divergence] = process.argv.slice(2);
if (!recPath || !zeroPath || !onePath || divergence === undefined) {
  console.error('usage: pick-shift.ts <recording.json> <digest0> <digest1> <tick>');
  process.exit(2);
}
const rec = parseRecording(readFileSync(recPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);
const name = recPath.split('/').pop()?.replace(/\.json$/, '');

if (divergence === 'none') {
  console.log(`${name} 0  the two captures are the same run`);
  process.exit(0);
}
const at = Number(divergence);

/** Does this capture's picture on tick `at` agree with the port's? */
async function agrees(path: string): Promise<boolean | null> {
  const digest = JSON.parse(readFileSync(path, 'utf8')) as Digest;
  if (!digest.hash || digest.hash[at] == null) return null;
  const port = await runOf(
    () => Game.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  if (at >= port.hash.length) return null;
  return digest.hash[at] === port.hash[at];
}

const zero = await agrees(zeroPath);
const one = await agrees(onePath);

if (zero === true && one !== true) {
  console.log(`${name} 0  (tick ${at}: the shift-0 capture is the port's picture)`);
} else if (one === true && zero !== true) {
  console.log(`${name} 1  (tick ${at}: the shift-0 capture read every key a tick `
    + `early; the shift-1 one is the port's picture)`);
} else if (zero === true && one === true) {
  console.log(`${name} ?  (tick ${at}: both captures match the port, which cannot be)`);
} else {
  console.log(`${name} ?  (tick ${at}: neither capture is the port's picture -- `
    + `the port may be wrong there too)`);
}
