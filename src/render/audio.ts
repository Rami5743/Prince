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
import { midiTune, speakerTune, Tune, type Note, type MusicSink } from './music.ts';

/** The files that hold the recorded sounds, in the order to look in them. */
export const DIGI_FILES = ['DIGISND1.DAT', 'DIGISND2.DAT', 'DIGISND3.DAT'] as const;
/** The same sounds as standard MIDI files, for the music. */
export const MIDI_FILES = ['MIDISND1.DAT', 'MIDISND2.DAT'] as const;
/** And as tunes for the PC speaker, which four of them only have. */
export const SPEAKER_FILES = ['IBM_SND1.DAT', 'IBM_SND2.DAT'] as const;

/** Just enough of `AudioContext` to play a sample, so a test can stand in. */
export interface AudioSink {
  readonly sampleRate: number;
  readonly state: string;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, rate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  readonly destination: AudioNode;
  /**
   * The three a tune needs. They are optional so that a stand-in in a
   * test can leave them out; without them the music is simply not
   * played and the recordings still are.
   */
  readonly currentTime?: number;
  createOscillator?(): OscillatorNode;
  createGain?(): GainNode;
}

/**
 * What a sound turned out to be: a recording to put in the channel, or
 * a tune to play on oscillators. Null is an index with neither.
 */
type Playable =
  | { readonly kind: 'digi'; readonly buffer: AudioBuffer }
  | { readonly kind: 'tune'; readonly notes: readonly Note[]; readonly wave: OscillatorType;
      /** The end of the sequence; see `TuneData`. */
      readonly length: number }
  | null;

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

/**
 * How much each sound is worth, and whether it may be cut off.
 *
 * The original has one channel, and `play_sound` does not start
 * anything: it writes the sound into `next_sound`, and once a tick
 * `play_next_sound` starts it **only** if nothing is already sounding,
 * or if what is sounding may be interrupted by something at least as
 * important. A lower number is more important, and the test is `<=`.
 *
 * Without that rule a sound that the game asks for on every tick is
 * started again on every tick, and eighty-three milliseconds of a
 * sample is not a sound. The level door is exactly that case:
 * `animate_leveldoor` asks for `sound_15_leveldoor_sliding` on each of
 * the forty-two ticks it takes to open, and the player heard nothing at
 * all as the way out of the level slid open. 15 is marked
 * uninterruptible, so in the original the first ask starts it and the
 * other forty-one are refused.
 *
 * **Both tables are the release's own, and three entries are not
 * SDLPoP's.** SDLPoP defines `FIX_SOUND_PRIORITIES` by default and
 * runs `fix_sound_priorities()` before anything else, whose own
 * comment is "Change values to match those in PoP 1.3": it moves
 * `sound_48_spiked` from 0x19 to 0x15, `sound_10_sword_vs_sword`
 * from 0x0A to 0x0D, and marks `sound_49_spikes` interruptible. The
 * port had all three of the 1.3 values, and the executable this
 * whole project is measured against is **1.0**.
 *
 * Read straight out of `PRINCE.EXE` and `UNCRKD.EXE`, which both
 * hold the two tables back to back at 0x1CCFA and 0x1CD27:
 *
 *     index  0..23   14 1e 23 66 32 37 30 30 4b 50 0a 12
 *                    0c 0b 69 6e 73 78 7d 82 91 96 9b a0
 *     index 24..29   01 01 01 01 01 13
 *     index 30..39   written over by eight bytes of a far-pointer
 *                    table, `1e 00 b2 01 09 00 b0 00`, two bytes
 *                    shorter than the ten they replace -- the same
 *                    thing the release does to the `_` glyph of the
 *                    font, and the reason everything after it reads
 *                    two bytes early
 *     index 40..57   01 01 01 01 87 8c 0f 10 19 16 01 00
 *                    01 01 01 01 01 00
 *
 * So the release has **0x0A at 10 and 0x19 at 48**, and the port has
 * them. The ten entries the release writes over are SDLPoP's --
 * all 0x01 but `sound_39_low_weight`, which is **0**, and the
 * capture agrees with that from the other side: the original goes
 * silent for the feather's whole eighteen and a half seconds.
 *
 * What the three change, in the game: with 10 at 0x0A the sword
 * clash is worth more than either hurt sound, so a hit that lands
 * on the same tick as a parry is refused -- which is the behaviour
 * SDLPoP's fix exists to undo. With 48 at 0x19 against 49's 0x16
 * and 49 uninterruptible, the sound of someone being spiked never
 * cuts the spikes off.
 */
const PRIORITY: readonly number[] = [
  0x14, 0x1e, 0x23, 0x66, 0x32, 0x37, 0x30, 0x30, 0x4b, 0x50,
  0x0a, 0x12, 0x0c, 0x0b, 0x69, 0x6e, 0x73, 0x78, 0x7d, 0x82,
  0x91, 0x96, 0x9b, 0xa0, 0x01, 0x01, 0x01, 0x01, 0x01, 0x13,
  0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
  0x01, 0x01, 0x01, 0x01, 0x87, 0x8c, 0x0f, 0x10, 0x19, 0x16,
  0x01, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00,
];
const INTERRUPTIBLE: readonly number[] = [
  0, 1, 1, 1, 1, 1, 0, 1, 1, 1,
  1, 1, 1, 1, 0, 0, 1, 1, 0, 1,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0,
];
/** An index the tables do not reach is as unimportant as a footstep. */
const priorityOf = (i: number): number => PRIORITY[i] ?? 0xff;
/**
 * `sound_prio_table[i]`, for the queue in front of the device.
 *
 * `play_sound` does not start anything in the original: it writes the
 * sound into `next_sound`, keeping the most important of however many
 * are asked for in one tick, and `play_next_sound` starts that one.
 * `PopGame` does the same now, and this is the table it needs.
 */
export const soundPriority = priorityOf;
/**
 * `sound_interruptible[]`, which the game **writes**.
 *
 * It is a table in memory, not a constant: `animate_leveldoor` sets
 * `sound_interruptible[sound_15_leveldoor_sliding]` to 0 before every
 * `play_sound` of the door going up and to 1 before every one of it
 * coming down, so the rising door holds the channel for all
 * forty-three of its ticks and the falling one does not. The port had
 * the table as a constant and both lines were missing.
 */
const interruptible = new Uint8Array(64);
for (let i = 0; i < interruptible.length; i++) interruptible[i] = INTERRUPTIBLE[i] ?? 1;
const interruptibleOf = (i: number): boolean => (interruptible[i] ?? 1) !== 0;

/** `sound_interruptible[index] = value`, which `animate_leveldoor` does. */
export function setSoundInterruptible(index: number, value: boolean): void {
  if (index >= 0 && index < interruptible.length) interruptible[index] = value ? 1 : 0;
}
/**
 * `sound_interruptible[i]`, the other half of `play_next_sound`'s test.
 *
 * Exported for the same reason `soundPriority` is: the oracle's own
 * machine has no Sound Blaster and plays the PC speaker, whose tunes
 * are a different length from the recordings, so the one channel is
 * busy for different stretches. `tools/dev/sound-common.ts` models
 * that channel with these two tables, which are the C's.
 */
export const soundInterruptible = interruptibleOf;

/**
 * The slowest recording a browser will take, in hertz.
 *
 * The Web Audio spec only obliges an implementation to support sample
 * rates from 8000 to 96000, and Chromium's `createBuffer` throws
 * `NotSupportedError` below 3000. **Exactly one sound in the game is
 * under either number**, and it is
 * `sound_15_leveldoor_sliding` -- the exit door -- recorded at
 * **2750 Hz**, where every other recording in `DIGISND*.DAT` is at
 * 8200, 11000 or 14000.
 *
 * So the door threw where it was read, `read`'s `catch` wrote the
 * index down as "neither a recording nor a tune", and
 * `play(sound_15_leveldoor_sliding)` returned on that for the rest of
 * the session. The player reported "no exit door sound"; the whole of
 * it was this one number, and no measurement against the original
 * could see it -- the capture, the port and the oracle all agree that
 * the door sounds for 3.5 seconds, because none of them goes through
 * a browser.
 *
 * Holding each sample for an integer number of the new rate's is not
 * a resampling: it is a zero-order hold, which is exactly what the
 * DAC it was recorded for did with it. The waveform and the length
 * come out the same to the sample. 2750 x 3 = 8250 Hz, which is above
 * the rate the spec guarantees, so no browser can refuse it.
 */
const MIN_BUFFER_RATE = 8000;

export class SoundPlayer {
  private readonly assets: Assets;
  private readonly context: AudioSink;
  private readonly buffers = new Map<number, Playable>();
  /**
   * The reads in flight, by index.
   *
   * A set of indices was enough while nothing waited for one, but
   * `play` now starts a read and leaves the sound to be played when it
   * lands, and a second `preload` of the same index has to wait for
   * that read rather than return as though it were done.
   */
  private readonly pending = new Map<number, Promise<void>>();
  /** Nothing is played until the player has touched the page. */
  private woken = false;
  /**
   * What is playing. The original had one channel: a new sound stopped
   * whatever was in it, which is why the byte-code can ask for silence by
   * name. Letting them pile up turns a run into a wall of noise.
   */
  private playing: { stop(): void } | null = null;
  /** Which sound is in the channel, for the rule above. */
  private playingIndex = -1;
  /**
   * The last sound asked for that had not been read off the disc yet.
   *
   * A one-off -- a button, a footstep, the first drink of the game --
   * used to be thrown away while its sample loaded, and the player
   * heard nothing where the original made a noise. The load is quick,
   * so the sound is still worth having when it lands; anything asked
   * for since has already taken the channel, and this is dropped.
   */
  private waitingFor = -1;
  muted = false;
  /**
   * The sounds that would not read, and why.
   *
   * `read` writes a sound that threw down as `null` -- "neither a
   * recording nor a tune" -- and every later `play` of it returns on
   * that one line, silently. That is exactly how the exit door was
   * lost: `sound_15_leveldoor_sliding` is recorded at 2750 Hz and
   * Chromium's `createBuffer` throws under 3000, so the door went
   * quiet in the browser and in no other measurement this project
   * takes. Nothing in the game has no sound -- `every-sound.test.ts`
   * pins that every index of `soundids` has a recording, a tune or a
   * beep behind it -- so an entry here is always a fault, and the
   * page is now able to say so instead of going quiet.
   */
  readonly failed = new Map<number, string>();
  /**
   * The last couple of hundred sounds that really reached the
   * channel, in order, by index.
   *
   * Not what the byte-code asked for -- `tools/dev/sound-trace.ts`
   * has that -- but what `start` did with it, which is the thing a
   * walk through the page in a real browser can read back and say
   * "the gate creaked here". Bounded, because a long game would
   * otherwise grow it for ever.
   */
  readonly started: number[] = [];

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
   * Whether the context is really running.
   *
   * `wake` resolves either way: a browser that will not sound before
   * the player has touched the page resolves `resume()` and leaves
   * the state `suspended`. The page asks this before it starts the
   * opening, because an opening played into a suspended context is
   * not only silent -- `show_title` waits on
   * `while (check_sound_playing())` three times and all three fall
   * through at once.
   */
  get awake(): boolean {
    return this.woken && this.context.state === 'running';
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
    if (!this.mayTake(index)) return;
    const buffer = this.buffers.get(index);
    if (buffer === undefined) {
      this.waitingFor = index;
      void this.preload(index);
      return;
    }
    if (buffer === null) return; // neither a recording nor a tune
    this.start(index, buffer);
  }

  /**
   * Whether `index` may have the channel, by the original's rule: it
   * may if nothing is sounding, or if what is sounding may be
   * interrupted and `index` is at least as important.
   */
  private mayTake(index: number): boolean {
    if (!this.playing) return true;
    return interruptibleOf(this.playingIndex)
      && priorityOf(index) <= priorityOf(this.playingIndex);
  }

  private start(index: number, what: NonNullable<Playable>): void {
    this.waitingFor = -1;
    this.started.push(index);
    if (this.started.length > 200) this.started.shift();
    this.stop();
    if (what.kind === 'tune') {
      const sink = this.context as unknown as MusicSink;
      if (typeof this.context.createOscillator !== 'function') return;
      const tune = new Tune(sink, what.notes, what.wave, what.length);
      if (tune.empty) return;
      tune.onended = (): void => {
        if (this.playing === tune) { this.playing = null; this.playingIndex = -1; }
      };
      this.playing = tune;
      this.playingIndex = index;
      return;
    }
    const source = this.context.createBufferSource();
    source.buffer = what.buffer;
    source.connect(this.context.destination);
    source.onended = (): void => {
      if (this.playing === source) { this.playing = null; this.playingIndex = -1; }
    };
    source.start();
    this.playing = source;
    this.playingIndex = index;
  }

  /**
   * `check_sound_playing`: something is still in the channel.
   *
   * A tune is asked its own end time rather than trusted to report
   * itself finished. `onended` fires on one oscillator of the many a
   * tune schedules, and a tune that lost that event -- or never
   * scheduled a note at all -- would leave the channel looking busy
   * for ever, which is not a quiet bug: the Prince waits crouched at
   * the start of level 1 until the opening has finished, and he would
   * wait there for good.
   */
  get isPlaying(): boolean {
    const playing = this.playing;
    if (!playing) return false;
    if (playing instanceof Tune) {
      if ((this.context.currentTime ?? 0) < playing.endsAt) return true;
      this.playing = null;
      this.playingIndex = -1;
      return false;
    }
    return true;
  }

  /** Empty the one channel, as the original does when a sound starts. */
  stop(): void {
    const source = this.playing;
    this.playing = null;
    this.playingIndex = -1;
    if (!source) return;
    try { source.stop(); } catch { /* already finished */ }
  }

  /**
   * What an index turned out to be.
   *
   * A recording is looked for first, because that is what the game
   * sounded like on the hardware this port is measured against. Where
   * there is none -- all of the music, and four of the effects -- the
   * MIDI is used, and where there is no MIDI either, the tune the
   * original wrote for the PC speaker.
   */
  private async readPlayable(index: number): Promise<Playable> {
    const digi = await loadSound(this.assets, index, DIGI_FILES);
    if (digi && digi.kind === 'digi') {
      // A browser will not make a buffer at the rate this one was
      // recorded at, so hold each sample for `hold` of the new rate's
      // -- which is what the DAC did anyway. See `MIN_BUFFER_RATE`.
      const hold = Math.max(1, Math.ceil(MIN_BUFFER_RATE / digi.rate));
      const buffer = this.context.createBuffer(
        1, digi.samples.length * hold, digi.rate * hold);
      const channel = buffer.getChannelData(0);
      // Unsigned eight-bit with silence at 128, which is what the DAC took.
      for (let i = 0; i < digi.samples.length; i++) {
        const v = (digi.samples[i] - 128) / 128;
        for (let k = 0; k < hold; k++) channel[i * hold + k] = v;
      }
      return { kind: 'digi', buffer };
    }
    const midi = await loadSound(this.assets, index, MIDI_FILES);
    if (midi && midi.kind === 'midi') {
      const { notes, length } = midiTune(midi);
      // A triangle is the nearest a plain oscillator comes to the
      // AdLib's softer voices; a square for the beeps below.
      if (notes.length) return { kind: 'tune', notes, wave: 'triangle', length };
    }
    const beep = await loadSound(this.assets, index, SPEAKER_FILES);
    if (beep && beep.kind === 'speaker') {
      const { notes, length } = speakerTune(beep);
      if (notes.length) return { kind: 'tune', notes, wave: 'square', length };
    }
    return null;
  }

  /** Read a sound and turn it into something playable, once. */
  async preload(index: number): Promise<void> {
    if (this.buffers.has(index)) return;
    const already = this.pending.get(index);
    if (already) return already;
    const read = this.read(index);
    this.pending.set(index, read);
    return read;
  }

  private async read(index: number): Promise<void> {
    try {
      const playable = await this.readPlayable(index);
      this.buffers.set(index, playable);
      // It was asked for while it was being read, and nothing has
      // taken the channel since.
      if (playable && this.waitingFor === index && !this.muted && this.woken
        && this.mayTake(index)) {
        this.start(index, playable);
      }
    } catch (err) {
      this.buffers.set(index, null);
      this.failed.set(index, String(err));
    } finally {
      this.pending.delete(index);
      if (this.waitingFor === index) this.waitingFor = -1;
    }
  }

  /** Read every sound the game raises in play, so none of them is late. */
  async preloadAll(indices: readonly number[]): Promise<void> {
    for (const index of indices) await this.preload(index);
  }
}
