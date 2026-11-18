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

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** The names the C gives the indices, so the trace reads like the C. */
export const SOUND_NAME: Record<number, string> = {
  0: 'fell_to_death', 1: 'falling', 2: 'tile_crashing', 3: 'button_pressed',
  4: 'gate_closing', 5: 'gate_opening', 6: 'gate_closing_fast', 7: 'gate_stop',
  8: 'bumped', 9: 'drink', 10: 'sword_vs_sword', 11: 'sword_moving',
  12: 'guard_hurt', 13: 'kid_hurt', 14: 'leveldoor_closing',
  15: 'leveldoor_sliding', 16: 'medium_land', 17: 'soft_land', 18: 'drink_long',
  19: 'footstep', 20: 'blast', 21: 'chopper_blade', 22: 'loose_shake_1',
  23: 'loose_shake_2', 24: 'loose_shake_3', 25: 'presentation',
  26: 'embrace', 27: 'cutscene_2_4_6_12', 28: 'death', 29: 'meet_Jaffar',
  30: 'big_potion', 31: 'sword', 32: 'shadow_music', 33: 'small_potion',
  34: 'cutscene_8_9', 35: 'cutscene_8_9', 36: 'out_of_time',
  37: 'victory', 38: 'blink', 39: 'low_weight', 40: 'cutscene_12_short_time',
  41: 'end_level_music', 43: 'victory_Jaffar', 44: 'skel_alive',
  45: 'jump_through_mirror', 46: 'chomped', 47: 'chomper', 48: 'spiked',
  49: 'spikes', 50: 'story_2_princess', 51: 'princess_door_opening',
  52: 'story_4_Jaffar_leaves', 53: 'story_3_Jaffar_comes',
  54: 'intro_music', 55: 'story_1_absence', 56: 'ending_music',
};
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
  for (let t = 0; t < limit; t++) {
    asked = [];
    took = [];
    before = [];
    game.step(timeline[t] ?? { x: 0, y: 0, shift: false });
    // `play_next_sound` is the last line of `draw_game_frame`, so the
    // tick's sound is not asked for until the frame is drawn.
    game.render();
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
