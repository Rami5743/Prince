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

const [name, from, to, by] = process.argv.slice(2);
if (!name || from === undefined || to === undefined || by === undefined) {
  console.error('usage: late-key.ts <name> <from-tick> <to-tick> <n,n,n>');
  process.exit(2);
}
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
  for (let t = a; t <= b; t++) ticks[t] = { ...ticks[t], x: 0 };
  for (let t = a; t <= b; t++) {
    if (t + d < ticks.length) ticks[t + d] = { ...ticks[t + d], x: base[t].x };
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
