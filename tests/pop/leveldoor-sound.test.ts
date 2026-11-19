/**
 * The exit door rising, and the one channel it holds.
 *
 * `animate_leveldoor` asks for `sound_15_leveldoor_sliding` on
 * **every** tick the door is going up -- forty-two of them, while
 * `curr_modifier` climbs to 43 -- and the recording behind it is a
 * second and a half long. If the channel let each ask interrupt the
 * one before, the player would hear eighty-three milliseconds of
 * attack forty-two times running, which is indistinguishable from
 * nothing.
 *
 * The C stops that by writing the table:
 * `sound_interruptible[sound_15_leveldoor_sliding] = 0` before every
 * `play_sound` of the door going up, and `= 1` before every one of
 * it coming down. **Both lines were missing from the port**, and the
 * table was a constant. The rising door was right by luck, because
 * the static table holds 0 for 15; what the luck could not survive
 * is the line that sets it to 1, which the closing door needs.
 *
 * `gate1` is the only recording in the suite that reaches a button
 * on a level door: it steps on room 9's opener and the door rises
 * over the forty-three ticks after it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR, REPO } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';
import { soundids } from '../../src/pop/types.ts';
import { SoundPlayer, setSoundInterruptible, soundInterruptible, type AudioSink } from '../../src/render/audio.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Enough of a device to say when a recording started and how long it ran. */
class Sink implements AudioSink {
  readonly sampleRate = 44100;
  readonly state = 'running';
  currentTime = 0;
  readonly destination = {} as AudioNode;
  started: { at: number; dur: number }[] = [];
  private pending: { until: number; node: { onended: (() => void) | null } }[] = [];
  async resume(): Promise<void> {}
  createBuffer(_c: number, len: number, rate: number): AudioBuffer {
    const d = new Float32Array(len);
    return {
      getChannelData: () => d, length: len, duration: len / rate, sampleRate: rate,
    } as unknown as AudioBuffer;
  }
  createBufferSource(): AudioBufferSourceNode {
    const self = this;
    let buffer: { duration: number } | null = null;
    const node = {
      set buffer(b: unknown) { buffer = b as { duration: number }; },
      get buffer(): unknown { return buffer; },
      connect(): void {}, disconnect(): void {},
      onended: null as (() => void) | null,
      start(): void {
        self.started.push({ at: self.currentTime, dur: buffer?.duration ?? 0 });
        self.pending.push({ until: self.currentTime + (buffer?.duration ?? 0), node });
      },
      stop(): void { self.pending = self.pending.filter((p) => p.node !== node); },
    };
    return node as unknown as AudioBufferSourceNode;
  }
  createOscillator(): OscillatorNode {
    return {
      type: 'square', frequency: { value: 0 },
      connect(): void {}, disconnect(): void {}, start(): void {}, stop(): void {},
      onended: null,
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
  advance(s: number): void {
    this.currentTime += s;
    const done = this.pending.filter((p) => p.until <= this.currentTime);
    this.pending = this.pending.filter((p) => p.until > this.currentTime);
    for (const p of done) p.node.onended?.();
  }
}

/** Every sound `play_next_sound` asked for, tick by tick. */
async function asksOf(name: string): Promise<[number, number][]> {
  const rec = parseRecording(
    readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
  );
  const timeline = decodeTimeline(rec.timeline);
  const asks: [number, number][] = [];
  let t = 0;
  let run = await PopGame.start(assets, exe, rec.level, {
    minutesLeft: rec.startMinutes,
    effects: {
      sound: (which: number) => asks.push([t, which]),
      stopSounds: () => {},
      // What every digest in the suite is measured with: the capture
      // chain runs the original with no Sound Blaster. Answering with
      // a real channel here would make a different run.
      soundPlaying: () => false,
    },
  });
  for (t = 0; t < timeline.length; t++) {
    const now = timeline[t] ?? { x: 0, y: 0, shift: false };
    if (now.shift && !(timeline[t - 1]?.shift)) run.pressButton();
    run.step(now);
    if (run.restartDue) run = await run.restart(assets, exe);
    run.render();
  }
  return asks;
}

describe('the exit door of level 1', () => {
  it('is asked for on every tick it rises, and `leveldoor_open` turns over at the end',
    async () => {
      const asks = await asksOf('gate1');
      const door = asks.filter(([, w]) => w === soundids.sound_15_leveldoor_sliding);
      expect(door.length).toBe(42);
      // Consecutive ticks, which is what `animate_leveldoor` does.
      const first = door[0][0];
      expect(door.map(([t]) => t)).toEqual(
        Array.from({ length: 42 }, (_, i) => first + i),
      );
      expect(g.leveldoor_open).toBe(1);
    }, 120000);

  it('is heard as three whole plays and not forty-two attacks', async () => {
    const asks = await asksOf('gate1');
    const sink = new Sink();
    const player = new SoundPlayer(assets, sink);
    await player.wake();
    await player.preloadAll(Array.from({ length: 58 }, (_, i) => i));
    let k = 0;
    const last = asks[asks.length - 1][0];
    for (let t = 0; t <= last; t++) {
      while (k < asks.length && asks[k][0] === t) { player.play(asks[k][1]); k++; }
      sink.advance(1 / 12);
    }
    // The door's own recording, by its length; nothing else in the
    // game is anywhere near a second and a half.
    const door = sink.started.filter((s) => s.dur > 1.5);
    expect(door.length).toBeGreaterThan(0);
    expect(door.length).toBeLessThanOrEqual(4);
    // And it covers the rising: three plays of 1.6 seconds against
    // forty-two ticks, which is three and a half.
    const covered = door.reduce((n, s) => n + s.dur, 0);
    expect(covered).toBeGreaterThan(42 / 12);
  }, 120000);

  it('`animate_leveldoor` writes `sound_interruptible`, both ways', () => {
    // The C's two lines, which the port had neither of.
    setSoundInterruptible(soundids.sound_15_leveldoor_sliding, true);
    expect(soundInterruptible(soundids.sound_15_leveldoor_sliding)).toBe(true);
    setSoundInterruptible(soundids.sound_15_leveldoor_sliding, false);
    expect(soundInterruptible(soundids.sound_15_leveldoor_sliding)).toBe(false);
  });
});
