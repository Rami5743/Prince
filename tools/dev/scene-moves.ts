/**
 * What moved on each frame, the capture's side beside the port's.
 *
 *   npx tsx tools/dev/scene-moves.ts <name> <from> <to> [digest.json]
 *
 * `scene-apart.ts` says *where* a scene's two sides part company.
 * This says *what* is on the screen there without the capture's video
 * being to hand at all: a digest carries, for every frame, the
 * bounding box and the pixel count of everything that changed into it
 * (`movedBetween`), and the port's own run carries the same. Put the
 * two columns side by side and a block of misses reads as one of:
 *
 * * the same box on both sides, a frame or two apart -- the clock;
 * * a box on one side and nothing on the other -- one side is
 *   holding a picture the other has already moved on from;
 * * two boxes in different places -- two different pictures, which is
 *   the only one of the three that can be the port's fault.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpeakerClock } from './scene-common.ts';
import { runScene, specOf, assets, bestOffset, shifted } from './scene-report.ts';
import { exactAgreement, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const name = process.argv[2];
const from = Number(process.argv[3] ?? 0);
const to = Number(process.argv[4] ?? from + 60);
const digestPath = process.argv[5]
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
const box = (m: unknown): string => (m === null || m === undefined ? '.'.padEnd(28)
  : (m as number[]).join(',').padEnd(28));
console.log(`${name} offset ${offset}`);
for (let i = from; i <= to && i < dos.length; i++) {
  const k = i + best!.drift[i];
  const h = dos[i];
  const hit = h === null || h === undefined ? '--' : (port.hash[k] === h ? 'ok' : 'XX');
  console.log(`${hit} cap ${String(i).padStart(5)} port ${String(k).padStart(5)}  cap ${box(sl.ticks[i])} port ${box(port.moved[k])}`);
}
