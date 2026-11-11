/**
 * What the port draws if a key edge reached the emulator later than the
 * recording says, and how well that scores against the capture.
 *
 * DOSBox does not take a short press reliably -- `tools/oracle/README`
 * says four ticks at least -- and when it takes one late the capture
 * stops being evidence about the port. The trouble is that a late press
 * does not read as lateness: the capture simply does something else,
 * some ticks on, and a whole run of ticks is marked wrong.
 *
 * This moves one press on by n ticks, replays, and scores. If some n
 * scores far better than n of nought, the capture is the port's own run
 * with that press delivered late, and there is nothing to fix.
 *
 *   node --experimental-strip-types tools/dev/late-key.ts \
 *       gate1 591 592 0,1,2,3,13,14,15
 *
 * `gate1`'s two-tick tap of Right at 591 to 592 scores 591 of 796 as
 * recorded and 790 of 796 moved on by fourteen.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const args = process.argv.slice(2);
const only = args.filter((a) => a.startsWith('--')).map((a) => a.slice(2));
const [name, from, to, by] = args.filter((a) => !a.startsWith('--'));
if (!name || from === undefined || to === undefined || by === undefined) {
  console.error('usage: late-key.ts <name> <from-tick> <to-tick> <n,n,n> [--x] [--y] [--shift]');
  process.exit(2);
}
/**
 * Which of the three controls moves.
 *
 * It used to be the horizontal one and nothing else, which quietly
 * answered "no difference" for every press that was Up, Down or
 * Shift -- and those are most of the presses a divergence sits on.
 * With no flag all three move together, which is what a late press
 * of a combination really is.
 */
const moves = {
  x: only.length === 0 || only.includes('x'),
  y: only.length === 0 || only.includes('y'),
  shift: only.length === 0 || only.includes('shift'),
};
const digest = JSON.parse(
  readFileSync(join(REPO, 'tools', 'oracle', 'digests', `${name}.json`), 'utf8'),
) as Digest;
const rec = parseRecording(
  readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
);
const base = decodeTimeline(rec.timeline);
const a = Number(from);
const b = Number(to);

for (const d of by.split(',').map(Number)) {
  const ticks = base.map((c) => ({ ...c }));
  // Take the press out of where the recording has it and put it back d
  // ticks later. Only the horizontal control moves; everything else the
  // player did stays where it was.
  const blank: Record<string, number | boolean> = {};
  if (moves.x) blank.x = 0;
  if (moves.y) blank.y = 0;
  if (moves.shift) blank.shift = false;
  for (let t = a; t <= b; t++) ticks[t] = { ...ticks[t], ...blank };
  for (let t = a; t <= b; t++) {
    if (t + d >= ticks.length) continue;
    const put: Record<string, number | boolean> = {};
    if (moves.x) put.x = base[t].x;
    if (moves.y) put.y = base[t].y;
    if (moves.shift) put.shift = base[t].shift;
    ticks[t + d] = { ...ticks[t + d], ...put };
  }
  const port = await runOf(
    () => PopGame.start(assets, exe, rec.level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  const r = exactAgreement(digest, port, inputChanges(ticks));
  console.log(`delay ${String(d).padStart(3)}: ${r.agreed} of ${r.ticks}`);
}
