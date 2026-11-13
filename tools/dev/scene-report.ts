/**
 * The scenes, against captures of the original.
 *
 *   npx tsx tools/dev/scene-report.ts [name...] [--first]
 *
 * `pop-report.ts` for `src/pop/cutscene.ts` and `seg001.ts`: the
 * digests, the masks and the scoring are the same code, at a video
 * frame instead of a game tick. See `tools/dev/scene-common.ts` for
 * the clock and the sound, and `tools/oracle/scene_frames.py` for what
 * the capture side of it is.
 *
 * ## Why the alignment is searched for, and why that is not fitting
 *
 * A gameplay capture is anchored: `--anchor-text 25` finds the tick
 * the level's title goes off the bottom of the screen and numbers the
 * run from it. A scene has no such landmark, and nothing is pressed
 * during one -- there is no key schedule, so there is nothing an
 * alignment could be fitted *to*. The offset here says one thing
 * only: which video frame of the capture the scene began on, which
 * depends on when ffmpeg started against when DOSBox got round to
 * running `prince`. So it is searched for over a wide range and the
 * one that matches most pictures is used, and the report prints it
 * along with how sharp the peak is -- a real alignment wins by
 * hundreds of frames over its neighbours.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import type { SceneName } from '../../src/pop/cutscene.ts';
import { playScene, SpeakerClock } from './scene-common.ts';
import {
  exactAgreement, fingerprint, unpackMask, PaletteMap, type Digest, type Run, type Moved,
} from './digest-common.ts';
import { movedBetween } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const SCENES = join(REPO, 'tools', 'oracle', 'scenes');

export interface SceneSpec {
  /** Which scene `CutscenePlayer.begin` is given. */
  scene: SceneName;
  /** How many video frames the capture is asked for. */
  frames: number;
  /** The `dosbox_oracle.py` script that reaches it, line by line. */
  script: string[];
  /** What the capture is, in one line, for the report. */
  what?: string;
  /** Where the scene starts in the capture's video, in seconds. */
  start?: number;
  /** How wide the offset search is, in video frames. */
  range?: number;
  /** `rem_min` and `rem_tick` when the scene starts; see `playScene`. */
  remMin?: number;
  remTick?: number;
}

export const assets = new Assets(
  async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
export const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

export function sceneNames(): string[] {
  return readdirSync(SCENES).filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => existsSync(join(DIGESTS, `${n}.json`)))
    .sort();
}

export function specOf(name: string): SceneSpec {
  return JSON.parse(readFileSync(join(SCENES, `${name}.json`), 'utf8')) as SceneSpec;
}

/** The port's own frames of a scene, fingerprinted in a digest's terms. */
export async function runScene(
  spec: SceneSpec, digest: Digest, clock?: SpeakerClock,
): Promise<Run> {
  const mask = digest.mask ? unpackMask(digest.mask) : new Uint8Array(320 * 200);
  const map = new PaletteMap(digest.palette ?? []);
  const hash: number[] = [];
  const moved: Moved[] = [];
  let prev: Uint8Array | null = null;
  await playScene(assets, exe, spec.scene, spec.frames, (_i, rgb) => {
    hash.push(fingerprint(rgb, map, mask));
    moved.push(prev === null ? null : movedBetween(prev, rgb));
    prev = rgb;
  }, undefined, clock, { remMin: spec.remMin, remTick: spec.remTick });
  return { hash, moved };
}

/**
 * The offset that lines the capture up with the port, and how sure it
 * is. Counts bare equal hashes, which is cheap and needs no walk.
 */
export function bestOffset(
  digest: Digest, port: Run, range = 240,
): { offset: number; hits: number; next: number; top: { o: number; n: number }[] } {
  const dos = digest.hash ?? [];
  const score = (o: number): number => {
    let n = 0;
    for (let i = 0; i < dos.length; i++) {
      const h = dos[i];
      if (h === null || h === undefined) continue;
      if (port.hash[i - o] === h) n += 1;
    }
    return n;
  };
  const all: { o: number; n: number }[] = [];
  for (let o = -range; o <= range; o++) all.push({ o, n: score(o) });
  all.sort((a, b) => b.n - a.n);
  return { offset: all[0].o, hits: all[0].n, next: all[1].n, top: all.slice(0, 40) };
}

/** The digest with its ticks slid by `offset`, so the port's index 0 is 0. */
export function shifted(digest: Digest, offset: number): Digest {
  const slide = <T>(a: readonly (T | null)[] | undefined): (T | null)[] => {
    const out: (T | null)[] = [];
    for (let i = offset; i < (a?.length ?? 0); i++) out.push(a![i] ?? null);
    return out;
  };
  return {
    ...digest,
    hash: slide(digest.hash ?? []) as (number | null)[],
    ticks: slide(digest.ticks ?? []) as Moved[],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const first = process.argv.includes('--first');
  const names = named.length ? named : sceneNames();
  const clock = await SpeakerClock.load(assets);
  let total = 0;
  let totalTicks = 0;
  for (const name of names) {
    const digest = JSON.parse(readFileSync(join(DIGESTS, `${name}.json`), 'utf8')) as Digest;
    const spec = specOf(name);
    const port = await runScene(spec, digest, clock);
    /**
     * The offset is settled by the score itself, not by bare equal
     * hashes. Counting hashes is what finds the candidates -- it is
     * cheap and needs no walk -- but a scene has long stretches of one
     * picture and dozens of offsets can tie on them, so the forty
     * best candidates are each put through `exactAgreement` and the
     * one that draws most of the capture wins. Forty and not eight
     * because a scene reached from inside a level begins with
     * `load_intro` waiting on whatever sound was playing, which is
     * half a second of black the port has no way to know about: the
     * right offset can be fourteen frames from where the bare hashes
     * put it.
     */
    const { hits, next, top } = bestOffset(digest, port, spec.range ?? 240);
    let offset = top[0].o;
    let best: ReturnType<typeof exactAgreement> | null = null;
    for (const cand of top) {
      const got = exactAgreement(shifted(digest, cand.o), port);
      if (!best || got.agreed > best.agreed) { best = got; offset = cand.o; }
    }
    const sl = shifted(digest, offset);
    const { agreed, ticks: n, drift } = best!;
    total += agreed; totalTicks += n;
    const pct = n ? Math.round((agreed * 100) / n) : 0;
    console.log(`${name.padEnd(10)} ${String(agreed).padStart(5)} of ${String(n).padStart(5)} ${String(pct).padStart(4)}%   offset ${offset} (${hits} against ${next})`);
    if (first) {
      const dos = sl.hash ?? [];
      let shown = 0;
      for (let i = 0; i < dos.length && shown < 40; i++) {
        const h = dos[i];
        if (h === null || h === undefined) continue;
        const k = i + drift[i];
        if (port.hash[k] === h) continue;
        console.log(`    ${i}  drift ${drift[i]}  capture moved ${JSON.stringify(sl.ticks[i])}  port ${JSON.stringify(port.moved[k] ?? null)}`);
        shown += 1;
      }
    }
  }
  console.log(`${'scenes'.padEnd(10)} ${String(total).padStart(5)} of ${String(totalTicks).padStart(5)} ${String(totalTicks ? Math.round((total * 100) / totalTicks) : 0).padStart(4)}%`);
}
