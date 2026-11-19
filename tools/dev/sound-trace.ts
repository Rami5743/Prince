/**
 * What the player hears, tick by tick.
 *
 *   npx tsx tools/dev/sound-trace.ts <recording-name> [ticks]
 *
 * The score cannot hear. Every digest in `tools/oracle/digests/` is a
 * picture, the capture chain runs DOSBox with `nosound=true`, and
 * nothing in the suite has ever put what the page plays beside what
 * the original plays. Three of the five bugs the player reported by
 * playing the game were sound.
 *
 * So this replays a recording through `PopGame` with the real
 * `SoundPlayer` behind a stand-in for the audio device, and prints
 * every sound the byte-code asked for, whether the player heard it,
 * and -- when he did not -- what was in the one channel instead.
 * `play_next_sound`'s rule is that a sound may have the channel only
 * if nothing is sounding, or if what is sounding may be interrupted
 * and the new one is at least as important, so a sound that is
 * refused is refused by something nameable.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { SoundPlayer, type AudioSink } from '../../src/render/audio.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { soundids } from '../../src/pop/types.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/**
 * The names the C gives the indices, so a trace reads like the C.
 *
 * Taken from `soundids` and not written out again. The hand-written
 * table this replaces was wrong from index 9 on -- it had 19 as the
 * footstep, 23 as `loose_shake_2` and **24 as `loose_shake_3`**, where
 * the game has 19 `draw_sword`, 23 `footstep` and 24 `death_regular`.
 * The tables beside it say so without looking anything up: 24 is
 * priority 1 and uninterruptible, which is music, and 23 is 0xa0, the
 * least important thing in the game. A trace that calls the death
 * music a loose floor is worse than no trace, and this project's own
 * notes have been quoting those names.
 */
export const SOUND_NAME: Record<number, string> = Object.fromEntries(
  Object.entries(soundids).map(([name, i]) => [
    i, name.replace(/^sound_\d+_/, ''),
  ]),
);

const named = (i: number): string => `${i} ${SOUND_NAME[i] ?? '?'}`;

/**
 * Enough of an `AudioContext` to tell whether a sound was played and
 * for how long. A tune's notes are scheduled against `currentTime`,
 * so the clock has to move with the game: `tick()` advances it by one
 * twelfth of a second, which is what a tick is.
 */
class FakeSink implements AudioSink {
  readonly sampleRate = 44100;
  readonly state = 'running';
  currentTime = 0;
  readonly destination = {} as AudioNode;
  async resume(): Promise<void> {}
  createBuffer(channels: number, length: number, rate: number): AudioBuffer {
    const data = new Float32Array(length);
    return {
      getChannelData: () => data, length, duration: length / rate, sampleRate: rate,
    } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    const self = this;
    let buffer: { duration: number } | null = null;
    const node = {
      set buffer(b: unknown) { buffer = b as { duration: number }; },
      get buffer(): unknown { return buffer; },
      connect() {}, disconnect() {},
      onended: null as (() => void) | null,
      start(): void {
        self.pending.push({ until: self.currentTime + (buffer?.duration ?? 0), node });
      },
      stop(): void {
        self.pending = self.pending.filter((p) => p.node !== node);
      },
    };
    return node as unknown as AudioBufferSourceNode;
  }
  /**
   * The three a tune needs. Without them `SoundPlayer.start` drops
   * every sound that is music rather than a recording, which is half
   * the game's -- and the trace then says a tune was refused when
   * nothing had refused it.
   */
  createOscillator(): OscillatorNode {
    return {
      type: 'square', frequency: { value: 0 },
      connect(): void {}, disconnect(): void {},
      start(): void {}, stop(): void {}, onended: null,
    } as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    const gain = {
      value: 0,
      setValueAtTime(): unknown { return gain; },
      linearRampToValueAtTime(): unknown { return gain; },
      cancelScheduledValues(): unknown { return gain; },
    };
    return { gain, connect(): void {}, disconnect(): void {} } as unknown as GainNode;
  }

  /**
   * The recordings in the channel and when each one ends. A real
   * device raises `onended`; here the clock does.
   */
  pending: { until: number; node: { onended: (() => void) | null } }[] = [];

  /** A tick of the game's clock, and whatever ended in it ends. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    const done = this.pending.filter((p) => p.until <= this.currentTime);
    this.pending = this.pending.filter((p) => p.until > this.currentTime);
    for (const p of done) p.node.onended?.();
  }
}

async function main(): Promise<void> {
  const [name, ticksArg] = process.argv.slice(2);
  if (!name) throw new Error('usage: sound-trace.ts <recording-name> [ticks]');
  const rec = parseRecording(
    readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
  );
  const timeline = decodeTimeline(rec.timeline);
  const limit = Number(ticksArg ?? timeline.length);
  const sink = new FakeSink();
  const player = new SoundPlayer(assets, sink);
  await player.wake();
  await player.preloadAll(Array.from({ length: 58 }, (_, i) => i));

  /** What the byte-code asked for this tick, and what came of it. */
  let asked: number[] = [];
  /** Whether each ask took the channel, read the moment it was made. */
  let took: boolean[] = [];
  /** And what was in the channel just before it. */
  let before: number[] = [];
  const game = await PopGame.start(assets, exe, rec.level, {
    minutesLeft: rec.startMinutes,
    effects: {
      sound: (which: number) => {
        const was = (player as unknown as { playingIndex: number }).playingIndex;
        player.play(which);
        const now = (player as unknown as { playingIndex: number }).playingIndex;
        asked.push(which);
        before.push(was);
        took.push(now === which);
      },
      stopSounds: () => { asked.push(-1); took.push(true); before.push(-1); player.stop(); },
      soundPlaying: () => player.isPlaying,
    },
  });

  let heardLast = -2;
  let run = game;
  for (let t = 0; t < limit; t++) {
    asked = [];
    took = [];
    before = [];
    /**
     * The two things `digest-common.ts`'s replay does and this did
     * not: the button that answers `Press Button to Continue`, and
     * the restart after a death.
     *
     * Without them a recording that kills the Prince -- `gate1` does,
     * at tick 558 -- stood still for the rest of the run, and the
     * trace stopped before the exit door it was wanted for.
     */
    const now = timeline[t] ?? { x: 0, y: 0, shift: false };
    if (now.shift && !(timeline[t - 1]?.shift)) run.pressButton();
    run.step(now);
    if (run.restartDue) run = await run.restart(assets, exe);
    // `play_next_sound` is the last line of `draw_game_frame`, so the
    // tick's sound is not asked for until the frame is drawn.
    run.render();
    sink.advance(1 / 12);
    const playing = player.isPlaying;
    const heard = (player as unknown as { playingIndex: number }).playingIndex;
    for (let k = 0; k < asked.length; k++) {
      const which = asked[k];
      if (which === -1) { console.log(`${String(t).padStart(5)}  stop_sounds`); continue; }
      const got = took[k];
      console.log(
        `${String(t).padStart(5)}  ${got ? 'PLAY  ' : 'refused'} ${named(which)}`
        + (got ? '' : `   (the channel had ${before[k] < 0 ? 'nothing' : named(before[k])})`),
      );
    }
    if (heard !== heardLast && !asked.length) {
      heardLast = heard;
      if (!playing) console.log(`${String(t).padStart(5)}  -- quiet`);
    } else if (asked.length) heardLast = heard;
  }
}

// Importable for its table of names: only run when it is the tool
// that was asked for, not when `sound-report.ts` imports `SOUND_NAME`.
if (process.argv[1]?.endsWith('sound-trace.ts')) await main();
