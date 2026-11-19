/**
 * Where a scene's capture and the port part company, run by run.
 *
 *   npx tsx tools/dev/scene-apart.ts <name> [digest.json]
 *
 * `scene-report.ts --first` prints the first forty frames that do not
 * match, which is the right thing when a scene is short of a dozen.
 * It is the wrong thing when a scene is short of a hundred and fifty,
 * because forty lines of a fade say nothing about whether the two
 * sides are still playing the same scene at frame eight hundred.
 *
 * This prints the same comparison as **runs**: every stretch of
 * frames the port draws the capture's picture on, and every stretch it
 * does not, with the capture's frame numbers and the port's beside
 * them. A scene whose remainder is a fade reads as a comb of short
 * runs; a scene whose two sides have gone to different pictures reads
 * as one OK run and then one BAD run to the end, and the frame where
 * that happens is the thing to put under a microscope.
 *
 * The second argument is a digest to score against instead of the
 * pinned one, so a fresh capture can be looked at without installing
 * it over the one in `tools/oracle/digests/`.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpeakerClock } from './scene-common.ts';
import { runScene, specOf, assets, bestOffset, shifted } from './scene-report.ts';
import { exactAgreement, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const name = process.argv[2];
const digestPath = process.argv[3]
  ?? join(REPO, 'tools', 'oracle', 'digests', `${name}.json`);
const digest = JSON.parse(readFileSync(digestPath, 'utf8')) as Digest;
const spec = specOf(name);
const clock = await SpeakerClock.load(assets);
const port = await runScene(spec, digest, clock);
const { top } = bestOffset(digest, port, spec.range ?? 240);
const drange = Math.round((16 * (spec.fps ?? 30)) / 30);
let offset = top[0].o;
let best: ReturnType<typeof exactAgreement> | null = null;
for (const c of top) {
  const got = exactAgreement(shifted(digest, c.o), port, undefined, drange);
  if (!best || got.agreed > best.agreed) { best = got; offset = c.o; }
}
const sl = shifted(digest, offset);
const dos = sl.hash ?? [];
console.log(`${name} offset ${offset}  agreed ${best!.agreed} of ${best!.ticks}  port frames ${port.hash.length}  capture frames ${dos.length}`);
let start = -1;
let ok = false;
let n = 0;
const flush = (end: number): void => {
  console.log(`  ${ok ? 'same' : 'DIFF'}  capture ${start}..${end}  port ${start + best!.drift[start]}..${end + best!.drift[end]}  (${n})`);
};
for (let i = 0; i < dos.length; i++) {
  const h = dos[i];
  if (h === null || h === undefined) continue;
  const hit = port.hash[i + best!.drift[i]] === h;
  if (start < 0) { start = i; ok = hit; n = 1; continue; }
  if (hit !== ok) { flush(i - 1); start = i; ok = hit; n = 1; continue; }
  n += 1;
}
if (start >= 0) flush(dos.length - 1);
