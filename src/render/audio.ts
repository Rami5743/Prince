/**
 * The game's sounds, played.
 *
 * The port had none at all: every `sound` the byte-code raised, every
 * gate and every footstep, went into a hook that nothing was listening
 * to. This listens to it.
 *
 * What it plays is the recorded sound the original shipped for a Sound
 * Blaster, out of `DIGISND1..3.DAT` -- unsigned eight-bit samples at the
 * rate the file gives, usually eleven thousand a second. Between them
 * those three files have every index the game raises in play: the falls,
 * the gates, the buttons, the loose floors, the footsteps, the spikes and
 * the Prince's own voice. The MIDI music and the PC speaker's versions of
 * the same effects are read by `src/dat/sound.ts` but not played here;
 * one needs a synthesiser and the other a square wave, and neither is
 * what the player hears on the hardware this port is measured against.
 *
 * A browser will not let a page make a noise before the player has
 * touched it, so the context starts suspended and `resume` is called from
 * the first key or click.
 */
import type { Assets } from './assets.ts';
import { parseSound, SOUND_RESOURCE_BASE, type Sound } from '../dat/sound.ts';
import { SOUND_SILENCE } from '../game/sequence.ts';

/** The files that hold the recorded sounds, in the order to look in them. */
export const DIGI_FILES = ['DIGISND1.DAT', 'DIGISND2.DAT', 'DIGISND3.DAT'] as const;

/** Just enough of `AudioContext` to play a sample, so a test can stand in. */
export interface AudioSink {
  readonly sampleRate: number;
  readonly state: string;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  readonly destination: AudioNode;
}

/**
 * Find a sound by its index, looking in each file that might hold it.
 * Returns null for an index none of them has.
 */
export async function loadSound(
  assets: Assets, index: number, files: readonly string[] = DIGI_FILES,
): Promise<Sound | null> {
  for (const name of files) {
    let dat;
    try {
      dat = await assets.dat(name);
    } catch {
      continue; // a player may not have installed every sound file
    }
    if (!dat.has(SOUND_RESOURCE_BASE + index)) continue;
    const sound = parseSound(dat.get(SOUND_RESOURCE_BASE + index));
    if (sound) return sound;
  }
  return null;
}

export class SoundPlayer {
  private readonly assets: Assets;
  private readonly context: AudioSink;
  private readonly buffers = new Map<number, AudioBuffer | null>();
  private readonly pending = new Set<number>();
  /** Nothing is played until the player has touched the page. */
  private woken = false;
  /**
   * What is playing. The original had one channel: a new sound stopped
   * whatever was in it, which is why the byte-code can ask for silence by
   * name. Letting them pile up turns a run into a wall of noise.
   */
  private playing: AudioBufferSourceNode | null = null;
  muted = false;

  constructor(assets: Assets, context: AudioSink) {
    this.assets = assets;
    this.context = context;
  }

  /** Call from the first key or click: a browser blocks sound before one. */
  async wake(): Promise<void> {
    this.woken = true;
    if (this.context.state === 'suspended') await this.context.resume();
  }

  /**
   * Play sound `index`, loading it the first time it is asked for.
   *
   * A sound that is not loaded yet is not played: the alternative is to
   * play it late, a second after the thing that made it, which is worse
   * than silence. The load is started all the same, so the next one is
   * ready.
   */
  play(index: number): void {
    if (this.muted || !this.woken) return;
    if (index === SOUND_SILENCE) { this.stop(); return; }
    const buffer = this.buffers.get(index);
    if (buffer === undefined) { void this.preload(index); return; }
    if (buffer === null) return; // no recorded version of this one
    this.stop();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = (): void => { if (this.playing === source) this.playing = null; };
    source.start();
    this.playing = source;
  }

  /** Empty the one channel, as the original does when a sound starts. */
  stop(): void {
    const source = this.playing;
    this.playing = null;
    if (!source) return;
    try { source.stop(); } catch { /* already finished */ }
  }

  /** Read a sound and turn it into something playable, once. */
  async preload(index: number): Promise<void> {
    if (this.buffers.has(index) || this.pending.has(index)) return;
    this.pending.add(index);
    try {
      const sound = await loadSound(this.assets, index);
      if (!sound || sound.kind !== 'digi') { this.buffers.set(index, null); return; }
      const buffer = this.context.createBuffer(1, sound.samples.length, sound.rate);
      const channel = buffer.getChannelData(0);
      // Unsigned eight-bit with silence at 128, which is what the DAC took.
      for (let i = 0; i < sound.samples.length; i++) {
        channel[i] = (sound.samples[i] - 128) / 128;
      }
      this.buffers.set(index, buffer);
    } catch {
      this.buffers.set(index, null);
    } finally {
      this.pending.delete(index);
    }
  }

  /** Read every sound the game raises in play, so none of them is late. */
  async preloadAll(indices: readonly number[]): Promise<void> {
    for (const index of indices) await this.preload(index);
  }
}
