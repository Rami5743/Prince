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
  tunesOf, detect, heardOf, scoreHeard, RecordingClock,
  type SoundDigest, type SoundNote, type SoundEvent,
} from './sound-common.ts';
import { SOUND_NAME } from './sound-trace.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const DIGESTS = join(REPO, 'tools', 'oracle', 'digests');
const SOUNDS = join(REPO, 'tools', 'oracle', 'sounds');

export interface SoundSpec {
  /** What the capture is, in one line. */
  what?: string;
  /** The scene the port plays, as `CutscenePlayer.begin` takes it. */
  scene: SceneName;
  /** How many video frames of it to play; the clock is 1/30 s a step. */
  frames: number;
  /** The `dosbox_oracle.py` script that reaches it, line by line. */
  script: string[];
  /** `rem_min` when the scene starts; see `playScene`. */
  remMin?: number;
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

/** The sounds the port asks for while it plays the scene. */
export async function sceneSounds(spec: SoundSpec): Promise<SoundEvent[]> {
  const clock = await RecordingClock.load(assets) as RecordingClock;
  await playScene(assets, exe, spec.scene, spec.frames, () => {}, undefined,
                  clock, { remMin: spec.remMin });
  return clock.events;
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
    const heard = detect(capture, tunes);
    const events = await sceneSounds(spec);
    const port = heardOf(events, tunes);
    const s = scoreHeard(heard, port);
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
