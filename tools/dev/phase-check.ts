/**
 * Did a capture read the player's keys in the ticks the recording says?
 *
 *   node --experimental-strip-types tools/dev/phase-check.ts \
 *       <digest.json> <recording.json>
 *
 * ## What goes wrong
 *
 * `dosbox_oracle.py` sends every key edge on a wall clock whose origin
 * is Ctrl+A plus however long DOSBox takes to restart the level, and
 * the game reads the keyboard at the start of each of its own ticks.
 * Where the one clock sits inside the other's tick is not something the
 * replay can choose: it is wherever Ctrl+A happened to land, and that
 * moves by up to a whole tick between one capture and the next. Half
 * the captures come out with every key edge a tick early.
 *
 * A tick is not a rounding error. In `0fbffa60` the player lets go of
 * Right on tick 35; read on 35 the Prince pulls up at the lip of the
 * floor in room 1, read on 34 he is a frame further on in his stride,
 * cannot pull up until the next one, and goes over the edge. Everything
 * after that is a different run: the capture scores 35 ticks of 731
 * against the port one way and 326 the other.
 *
 * ## How this tells which
 *
 * Two clocks run through every capture and only one of them is the key
 * schedule. The other is the level's own: the number under the room
 * says `LEVEL n` for twenty-five frames from the moment the level is
 * built, nothing for one, then how much of the hour is left for
 * twenty-four more -- a count the game keeps itself, which the keys
 * cannot move. `split_ticks --anchor-text` numbers the capture by it.
 *
 * So: line the capture up against the port over the ticks before the
 * player touched anything, where only the level's own clock is running,
 * and then over the ticks after. If the two halves want different
 * offsets, the keys went in at the wrong moment and the capture has to
 * be taken again with the schedule a tick along. A fault in the port
 * moves both halves together and does not show up here, which is the
 * point: this measures the harness, not the game.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const digestPath = process.argv[2];
const recPath = process.argv[3];
if (!digestPath || !recPath) {
  console.error('usage: phase-check.ts <digest.json> <recording.json>');
  process.exit(2);
}

const digest = JSON.parse(readFileSync(digestPath, 'utf8')) as Digest;
const rec = parseRecording(readFileSync(recPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);

/** The first tick the player held anything down. */
let firstPress = ticks.length;
for (let t = 0; t < ticks.length; t++) {
  const c = ticks[t];
  if (c.x !== 0 || c.y !== 0 || c.shift) { firstPress = t; break; }
}

const port = await runOf(
  () => Game.start(assets, exe, rec.level),
  (g) => g.restart(assets, exe),
  ticks,
  digest,
);
const { drift, agreed, ticks: have } = exactAgreement(digest, port, inputChanges(ticks));

/** The commonest offset over a stretch of ticks that were matched. */
function settled(from: number, to: number): number | null {
  const count = new Map<number, number>();
  for (let i = Math.max(0, from); i < Math.min(drift.length, to); i++) {
    const k = i + drift[i];
    if (digest.hash?.[i] == null || digest.hash[i] !== port.hash[k]) continue;
    count.set(drift[i], (count.get(drift[i]) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  for (const [d, n] of count) if (n > most) { most = n; best = d; }
  return most >= 3 ? best : null;
}

// The level's own clock runs from the first frame; the keys start at
// `firstPress`. A tick or two either side of the press belongs to
// neither, so it is left out.
const before = settled(0, firstPress - 1);
const after = settled(firstPress + 2, drift.length);
const name = digestPath.split('/').pop();

if (before === null || after === null) {
  console.log(`${name}: ? (before=${before} after=${after}, `
    + `${agreed} of ${have} exact) -- not enough agreement to tell`);
} else if (before === after) {
  console.log(`${name}: ok (offset ${before} throughout, `
    + `${agreed} of ${have} exact)`);
} else {
  const shift = after - before;
  console.log(`${name}: WRONG PHASE by ${shift} tick(s) `
    + `(the level's own clock wants ${before}, the keys want ${after}; `
    + `${agreed} of ${have} exact) -- recapture with `
    + `--shift ${shift > 0 ? shift : shift}`);
}
