/**
 * The sound, against a capture of the original.
 *
 *   npx tsx tools/dev/sound-report.ts [name...] [--notes]
 *
 * `scene-report.ts` for what the player hears instead of what he
 * sees. `tools/oracle/sounds/<name>.json` says what the capture is and
 * what script takes it; `tools/oracle/digests/<name>.sound.json` is the
 * capture, as a list of notes -- see `tools/oracle/sound_notes.py`.
 *
 * The score is the share of the capture's notes the port also plays, at
 * the same moment and the same pitch, under one offset searched for over
 * every pairing. `--notes` prints the ones that are missing and the ones
 * the port plays that the original does not, which is where a sound that
 * runs on or starts late shows itself.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import type { SceneName } from '../../src/pop/cutscene.ts';
import { playScene } from './scene-common.ts';
import {
  tunesOf, detect, heardOf, scoreHeard, RecordingClock, recordingSounds,
  occupancy, scoreNoise,
  type SoundDigest, type SoundNote, type SoundEvent, type Noise,
} from './sound-common.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { SOUND_NAME } from './sound-trace.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const SOUNDS = join(REPO, 'tools', 'oracle', 'sounds');

export interface SoundSpec {
  /** What the capture is, in one line. */
  what?: string;
  /** A scene: what `CutscenePlayer.begin` is given. */
  scene?: SceneName;
  /** How many video frames of it to play; the clock is 1/30 s a step. */
  frames?: number;
  /** The `dosbox_oracle.py` script that reaches it, line by line. */
  script?: string[];
  /** `rem_min` when the scene starts; see `playScene`. */
  remMin?: number;
  /** Or a recording in `tools/oracle/recordings/`, replayed as play. */
  recording?: string;
  /** Which `--shift` the capture is taken at. */
  shift?: number;
  /** The second of the capture the Ctrl+A restart falls on. */
  origin?: number;
}

export const assets = new Assets(
  async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
export const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

export function soundNames(): string[] {
  if (!existsSync(SOUNDS)) return [];
  return readdirSync(SOUNDS).filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((n) => existsSync(join(DIGESTS, `${n}.sound.json`)))
    .sort();
}

export const specOf = (name: string): SoundSpec =>
  JSON.parse(readFileSync(join(SOUNDS, `${name}.json`), 'utf8')) as SoundSpec;

export const digestOf = (name: string): SoundDigest =>
  JSON.parse(readFileSync(join(DIGESTS, `${name}.sound.json`), 'utf8')) as SoundDigest;

/** The sounds the port plays, whether the spec is a scene or a recording. */
export async function sceneSounds(spec: SoundSpec, deaf = true): Promise<SoundEvent[]> {
  if (spec.recording) {
    const rec = parseRecording(readFileSync(
      join(REPO, 'tools', 'oracle', 'recordings', `${spec.recording}.json`), 'utf8'));
    const timeline = decodeTimeline(rec.timeline);
    return recordingSounds(assets, exe, rec, timeline, timeline.length, deaf);
  }
  const clock = await RecordingClock.load(assets) as RecordingClock;
  await playScene(assets, exe, spec.scene!, spec.frames ?? 0, () => {}, undefined,
                  clock, { remMin: spec.remMin });
  return clock.events;
}

/** How long the port's run lasts, in seconds. */
export function spanOf(spec: SoundSpec): number {
  if (spec.recording) {
    const rec = parseRecording(readFileSync(
      join(REPO, 'tools', 'oracle', 'recordings', `${spec.recording}.json`), 'utf8'));
    return decodeTimeline(rec.timeline).length / 12;
  }
  return (spec.frames ?? 0) / 30;
}

const named = (i: number): string => `${i} ${SOUND_NAME[i] ?? '?'}`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const show = args.includes('--notes');
  const names = args.filter((a) => !a.startsWith('--'));
  const run = names.length ? names : soundNames();
  const tunes = await tunesOf(assets);
  let matched = 0;
  let total = 0;
  for (const name of run) {
    const spec = specOf(name);
    const digest = digestOf(name);
    const capture: SoundNote[] =
      digest.notes.map(([at, dur, hz]) => ({ at, dur, hz }));
    // `--channel` tells the game what is in the one channel, which
    // `check_sound_playing` is read for in three places that are play
    // and not sound. It is measured and it is worse; see
    // `recordingSounds`.
    const events = await sceneSounds(spec, !args.includes('--channel'));
    if (spec.recording) {
      // A recording is play, and play is effects: noise bursts of
      // two-millisecond notes and half-cycle sweeps, which have no
      // pitch for a tune to be read out of. So the comparison is
      // when the speaker was sounding and when it was not.
      const noises = (digest.active ?? []) as readonly Noise[];
      const chan = occupancy(events, tunes);
      const n = scoreNoise(noises, chan, digest.origin ?? spec.origin ?? 0, spanOf(spec));
      matched += n.matched;
      total += n.total;
      console.log(`${name.padEnd(12)} ${String(n.matched).padStart(5)} of `
        + `${String(n.total).padStart(5)} noises   origin ${n.origin.toFixed(2)}s `
        + `(${n.matched} against ${n.nearby} a second away)`);
      if (show) {
        for (const m of n.missing) {
          console.log(`  ${m[0].toFixed(2).padStart(7)} .. ${m[1].toFixed(2)}`
            + `   the original alone (tick ${Math.round((m[0] - n.origin) * 12)})`);
        }
        for (const e of n.extra) {
          console.log(`  ${(e.at + n.origin).toFixed(2).padStart(7)} `
            + `${named(e.which).padEnd(24)} the port alone (tick ${Math.round(e.at * 12)})`);
        }
      }
      continue;
    }
    const heard = detect(capture, tunes);
    const port = heardOf(events, tunes);
    const s = scoreHeard(heard, port, spanOf(spec));
    matched += s.matched;
    total += s.total;
    console.log(`${name.padEnd(12)} ${String(s.matched).padStart(5)} of `
      + `${String(s.total).padStart(5)} notes   ${s.pairs.filter((p) => p.port).length}`
      + ` of ${s.pairs.length} sounds   offset ${s.offset.toFixed(2)}s`);
    if (show) {
      for (const p of s.pairs) {
        const c = p.capture;
        console.log(`  ${c.at.toFixed(2).padStart(7)} ${named(c.which).padEnd(26)}`
          + ` ${String(c.count).padStart(3)}/${String(c.of).padEnd(3)}  port `
          + (p.port
            ? `${(p.port.at - s.offset).toFixed(2).padStart(7)} `
              + `${String(p.port.count).padStart(3)}/${String(p.port.of).padEnd(3)} `
              + `${p.late >= 0 ? '+' : ''}${p.late.toFixed(2)}s`
            : 'NOT PLAYED'));
      }
      for (const e of s.extra) {
        console.log(`  ${(e.at - s.offset).toFixed(2).padStart(7)} ${named(e.which).padEnd(26)}`
          + ` port only, ${e.count}/${e.of} notes`);
      }
    }
  }
  if (run.length > 1) {
    console.log(`${'sounds'.padEnd(12)} ${String(matched).padStart(5)} of ${String(total).padStart(5)}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  await main();
}
