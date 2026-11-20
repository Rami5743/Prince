/**
 * The music and the beeps, played.
 *
 * Half of the game's sounds are not recordings. The falls, the gates,
 * the footsteps and the Prince's voice were sampled for a Sound
 * Blaster and live in `DIGISND1..3.DAT`; everything else -- the death,
 * the end of a level, the title, winning a fight, the mirror -- is
 * music, and it ships twice over: as standard MIDI files in
 * `MIDISND1..2.DAT`, and as a tune for the PC speaker in
 * `IBM_SND1..2.DAT`. `src/render/audio.ts` played only the recordings,
 * so every one of those was silent.
 *
 * This turns either of the other two into a list of notes with a time
 * and a length, and plays them. Four of the game's sounds -- 31, 34,
 * 38 and 42 -- exist only as speaker tunes, so both are needed.
 *
 * What it is not is an OPL emulator. The original's MIDI was played by
 * an AdLib's FM chip, and this plays it on a plain oscillator per
 * note; it is the same tune, not the same timbre.
 */
import type { MidiSound, SpeakerSound } from '../dat/sound.ts';

/** One note: when it starts and how long it lasts, both in seconds. */
export interface Note {
  readonly at: number;
  readonly dur: number;
  readonly hz: number;
  /** 0..1, from the MIDI velocity; a speaker note is always full. */
  readonly level: number;
  /** The MIDI channel, so the drum channel can be left out. */
  readonly channel: number;
}

/** A MIDI note number as a frequency, with 69 = A above middle C. */
const hzOf = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** The drum channel, which has no pitch and is left out. */
const DRUMS = 9;

/**
 * A tune: its notes, and how long the sequence itself lasts.
 *
 * The two are not the same number, and the difference is what
 * `check_sound_playing` answers with. A sequencer plays a sequence to
 * its **end**, trailing rest and all, and only then is the channel
 * free; `notes` stops at the last note-off. For most of the game's
 * tunes the gap is a few tenths, and for the two the game reads back
 * as a timer it is the whole of a measured error -- see `midiTune`.
 */
export interface TuneData {
  readonly notes: Note[];
  /** The end of the sequence, in seconds from its start. */
  readonly length: number;
}

/**
 * A standard MIDI file as a list of notes, and the length of the
 * sequence that holds them.
 *
 * Format 0 and format 1 both appear here, so every track is read and
 * the results merged; the delta times are in the header's ticks and
 * the tempo changes as the file says, so the times come out in
 * seconds.
 *
 * **`length` is the end of the longest track, not the end of the last
 * note**, and that is measured and not assumed. `sound_39_low_weight`
 * -- the feather, the one effect whose length the game reads back as
 * a timer (`timers` clears `is_feather_fall` the moment
 * `check_sound_playing()` goes quiet) -- has its last note-off at
 * **18.000 s** and its end of track at **18.667 s**, and the PC
 * speaker's arrangement of the same chord in `IBM_SND1.DAT` is
 * **18.612 s**, which a capture of `PRINCE.EXE` taking `shift+w`
 * measures as one unbroken noise of **18.598 s**. So the two
 * arrangements are the same length to fifty-five milliseconds once
 * the trailing rest is counted, and three quarters of a second apart
 * without it. The title's own tune is the same story: sound 54's last
 * note is at 22.794 s and its sequence ends at 24.294, against the
 * 24.77 the capture measures `show_title`'s first wait at.
 */
export function midiTune(sound: MidiSound): TuneData {
  const b = sound.bytes;
  const nothing = { notes: [] as Note[], length: 0 };
  if (b.length < 14 || b[0] !== 0x4d || b[1] !== 0x54) return nothing; // 'MT'
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const division = dv.getUint16(12, false);
  // An SMPTE division is negative; the game's files are not, and
  // guessing at one would be worse than silence.
  if (division & 0x8000 || division === 0) return nothing;

  /** Every track's events, in the file's own ticks. */
  interface Raw { tick: number; on: boolean; note: number; vel: number; ch: number }
  const raw: Raw[] = [];
  const tempos: { tick: number; usPerBeat: number }[] = [];
  /** The last tick any track reaches, which is the end of the sequence. */
  let endTick = 0;

  let at = 8 + dv.getUint32(4, false);
  while (at + 8 <= b.length) {
    const isTrack = b[at] === 0x4d && b[at + 1] === 0x54
      && b[at + 2] === 0x72 && b[at + 3] === 0x6b; // 'MTrk'
    const len = dv.getUint32(at + 4, false);
    const start = at + 8;
    const end = Math.min(b.length, start + len);
    at = start + len;
    if (!isTrack) continue;

    let p = start;
    let tick = 0;
    let status = 0;
    const varLen = (): number => {
      let v = 0;
      for (let i = 0; i < 4 && p < end; i++) {
        const c = b[p++];
        v = (v << 7) | (c & 0x7f);
        if (!(c & 0x80)) break;
      }
      return v;
    };
    while (p < end) {
      tick += varLen();
      if (p >= end) break;
      let byte = b[p];
      if (byte & 0x80) { status = byte; p++; } // else running status
      byte = status;
      if (byte === 0xff) {
        const type = b[p++];
        const n = varLen();
        if (type === 0x51 && n === 3) {
          tempos.push({ tick, usPerBeat: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2] });
        }
        p += n;
        if (type === 0x2f) break; // end of track
      } else if (byte === 0xf0 || byte === 0xf7) {
        /**
         * `p += varLen()` is not the same thing, and the difference
         * was the whole of "the sound of the transition is cut off,
         * comes back, is cut off again, and only returns during the
         * next level".
         *
         * `p += varLen()` reads `p` **before** calling `varLen`, so
         * the bytes `varLen` consumed for the length were added back
         * on: the skip landed one byte short of the end of the
         * sysex, every time. Every melody track in `MIDISND1.DAT`
         * opens with `F0 07 00 00 34 01 00 0C F7` -- the AdLib
         * instrument definition -- so the parser came back onto its
         * last two bytes, `F7 00`, and read them as a delta time of
         * **15232 ticks**. The melody of every tune in the game was
         * moved twelve seconds into the future, while the
         * accompaniment played on time and stopped after two
         * seconds.
         *
         * What that did to the game is worse than what it did to the
         * music, because the game *waits for the sound*:
         * `while (check_sound_playing())` holds `show_title`,
         * `load_intro` and `play_level` where they stand. The scene
         * between two levels ran until the stranded melody had
         * finished -- sound 27 measured 33.4 seconds against the
         * 10.7 the original's own PC-speaker version takes -- and
         * that is the long pause between levels that cannot be
         * skipped.
         */
        const skip = varLen();
        p += skip;
      } else {
        const kind = byte & 0xf0;
        const ch = byte & 0x0f;
        const a = b[p++];
        const two = kind !== 0xc0 && kind !== 0xd0;
        const c = two ? b[p++] : 0;
        if (kind === 0x90 && c > 0) raw.push({ tick, on: true, note: a, vel: c, ch });
        else if (kind === 0x80 || kind === 0x90) raw.push({ tick, on: false, note: a, vel: 0, ch });
      }
    }
    if (tick > endTick) endTick = tick;
  }

  // Ticks into seconds, walking the tempo changes.
  tempos.sort((x, y) => x.tick - y.tick);
  raw.sort((x, y) => x.tick - y.tick || (x.on ? 1 : 0) - (y.on ? 1 : 0));
  let ti = 0;
  let usPerBeat = 500000; // 120 beats a minute, the default
  let lastTick = 0;
  let lastSec = 0;
  const seconds = (tick: number): number => {
    while (ti < tempos.length && tempos[ti].tick <= tick) {
      const t = tempos[ti++];
      lastSec += ((t.tick - lastTick) * usPerBeat) / (division * 1e6);
      lastTick = t.tick;
      usPerBeat = t.usPerBeat;
    }
    return lastSec + ((tick - lastTick) * usPerBeat) / (division * 1e6);
  };

  const notes: Note[] = [];
  const open = new Map<number, { at: number; vel: number }>();
  for (const e of raw) {
    const key = e.ch * 128 + e.note;
    const when = seconds(e.tick);
    if (e.on) {
      open.set(key, { at: when, vel: e.vel });
    } else {
      const was = open.get(key);
      if (!was) continue;
      open.delete(key);
      if (e.ch === DRUMS) continue;
      notes.push({
        at: was.at, dur: Math.max(0.03, when - was.at),
        hz: hzOf(e.note), level: was.vel / 127, channel: e.ch,
      });
    }
  }
  notes.sort((a, b2) => a.at - b2.at);
  // `seconds` walks the tempo list forwards and never back, so the end
  // of the sequence is asked for last, after every note.
  return { notes, length: seconds(endTick) };
}

/** `midiTune(sound).notes`, for the callers that want only the notes. */
export function midiNotes(sound: MidiSound): Note[] { return midiTune(sound).notes; }

/**
 * A PC speaker tune as a list of notes.
 *
 * The word in each note is the frequency itself, not a divisor: the
 * original's own player hands it straight to its square wave. A note
 * lasts `length / tempo` seconds, 1 or less is a rest, and 0x12 ends
 * the tune -- which `parseSound` has already cut it off at.
 */
export function speakerTune(sound: SpeakerSound): TuneData {
  const notes: Note[] = [];
  let at = 0;
  const tempo = sound.tempo || 1000;
  for (const n of sound.notes) {
    const dur = n.length / tempo;
    if (n.divisor > 1) {
      notes.push({ at, dur, hz: n.divisor, level: 1, channel: 0 });
    }
    at += dur;
  }
  // The whole list, trailing rest and all: the speaker's driver walks
  // it to the end before the channel is free. Only two of the game's
  // tunes have anything after their last note -- 14 by 0.097 s and 18
  // by 0.174 -- and `sound_39_low_weight` is not one of them, which
  // is why `FEATHER_SOUND_TICKS` is the speaker tune's own 18.612 s.
  return { notes, length: at };
}

/** `speakerTune(sound).notes`, for the callers that want only the notes. */
export function speakerNotes(sound: SpeakerSound): Note[] {
  return speakerTune(sound).notes;
}

/** Just enough of `AudioContext` to make a noise with. */
export interface MusicSink {
  readonly currentTime: number;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  /** Only `quality: high` asks for one, and only if the sink has it. */
  createBiquadFilter?(): BiquadFilterNode;
  readonly destination: AudioNode;
}

/**
 * How a note is made, which is the `quality` setting and nothing else.
 *
 * * **plain** is one oscillator a note with a short rise and fall --
 *   what the page has always played, and what every headless tool and
 *   every test gets, because none of them passes a voice.
 * * **rich** is the same notes, at the same instants, for the same
 *   lengths. What it adds is the shape the hardware had and a bare
 *   oscillator has not: the AdLib's voice is **two** operators, so a
 *   quiet octave above the fundamental goes with it; a real envelope
 *   decays to a sustain instead of sitting flat and then stopping;
 *   and the whole tune goes through one gentle low pass, which is
 *   what takes the edge off a square wave. The melody is untouched --
 *   `tests/render/audio.test.ts` requires both voices to hold the
 *   same pitches for the same time, to the millisecond.
 */
export type TuneVoice = 'plain' | 'rich';

/** The quiet partial a two-operator voice adds, and how loud it is. */
const RICH_PARTIAL = 2;
const RICH_PARTIAL_LEVEL = 0.28;
/** Where the low pass sits. Above the game's highest note, well below its hiss. */
const RICH_CUTOFF_HZ = 3800;

/**
 * A tune in the channel: every note scheduled at once, and a handle to
 * take them all away again.
 *
 * The original has one channel and a new sound stops whatever is in
 * it, so a tune has to be stoppable at any moment -- which is what
 * `stop_sounds` and the next footstep both do.
 */
/**
 * The most notes a tune may schedule at once; see the loop below.
 */
export const TUNE_NOTE_CAP = 2048;

export class Tune {
  private readonly nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private readonly sink: MusicSink;
  /** The one low pass of a rich tune, or nothing at `plain`. */
  private filter: BiquadFilterNode | null = null;
  /** The node that carries `onended`, kept so a stop cannot drop it. */
  private silent: OscillatorNode | null = null;
  /** When the last note ends, in the sink's own clock. */
  readonly endsAt: number;
  onended: (() => void) | null = null;

  /**
   * @param length how long the sequence itself lasts, where that is
   * longer than its last note. The channel is held until then, as the
   * original's own driver holds it: the feather's tune stops sounding
   * at 18.000 s and its sequence ends at 18.667, and the whole of
   * `is_feather_fall` is `while (check_sound_playing())`.
   */
  constructor(
    sink: MusicSink, notes: readonly Note[], wave: OscillatorType, length = 0,
    voice: TuneVoice = 'plain',
  ) {
    this.sink = sink;
    const t0 = sink.currentTime + 0.03;
    let end = t0 + length;
    /**
     * One low pass for the whole tune, where the sink has one.
     *
     * It is made once rather than per note: a tune is up to eighteen
     * hundred notes and a filter apiece would be eighteen hundred
     * filters for one sound.
     */
    // `notes.length` is in the test because an empty tune is thrown
    // away by its caller without being stopped, and a filter made for
    // one would be left connected to the destination for ever.
    const rich = voice === 'rich' && notes.length > 0
      && typeof sink.createBiquadFilter === 'function';
    let out: AudioNode = sink.destination;
    if (rich) {
      const filter = sink.createBiquadFilter!();
      filter.type = 'lowpass';
      filter.frequency.value = RICH_CUTOFF_HZ;
      filter.Q.value = 0.7;
      filter.connect(sink.destination);
      this.filter = filter;
      out = filter;
    }
    /**
     * A tune with hundreds of notes is hundreds of oscillators at
     * once, and the cap is here so a malformed file cannot wedge the
     * page. **Six hundred was not enough and that is measured**:
     * `sound_56_ending_music`, which plays under the hall of fame at
     * the end of the game, is 1800 notes and 121.700 seconds, and six
     * hundred of them is 42.000 -- so the music the player who has
     * just finished the game hears stopped a third of the way in.
     * Nothing else in the game comes near: the next longest is sound
     * 52 at 202 notes.
     */
    for (const n of notes.slice(0, TUNE_NOTE_CAP)) {
      const start = t0 + n.at;
      const stop = start + n.dur;
      const peak = 0.11 * n.level;
      this.voiceNote(sink, out, wave, n.hz, peak, start, stop, rich);
      if (rich) {
        // The second operator: an octave up, quiet. This is what
        // makes an AdLib's note an AdLib's note rather than a test
        // tone, and it is the same note -- a harmonic of it, at the
        // same instant and for the same time.
        this.voiceNote(
          sink, out, 'sine', n.hz * RICH_PARTIAL,
          peak * RICH_PARTIAL_LEVEL, start, stop, rich,
        );
      }
      if (stop > end) end = stop;
    }
    this.endsAt = end;
    /**
     * A silent node that stops when the **sequence** does, and carries
     * `onended`.
     *
     * The event used to hang on the last node the loop made, which is
     * the last note by its start and not always by its end -- and
     * which stops at the last note whatever the sequence's own length
     * is. So the channel was freed at the last note: for the feather
     * that is 18.000 s against the sequence's 18.667, and
     * `SoundPlayer.mayTake` reads `playing` directly and does none of
     * `isPlaying`'s lazy clearing, so `endsAt` alone could not hold
     * it. Measured in Chromium on `shift+w`: the next footstep was
     * heard 18.09 s after the feather and is 18.70 s after it now.
     */
    if (this.nodes.length) {
      const osc = sink.createOscillator();
      const gain = sink.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(sink.destination);
      this.silent = osc;
      osc.onended = (): void => { this.onended?.(); };
      osc.start(t0);
      osc.stop(end + 0.01);
      this.nodes.push({ osc, gain });
    }
  }

  /**
   * One oscillator of one note, with its envelope.
   *
   * At `plain` the envelope is a rise, a flat hold and a fall, which
   * is what the page has always played. At `rich` it decays to a
   * sustain and releases, which is the shape every instrument of
   * the period had and the reason the plain voice sounds like an
   * organ: a note that holds dead level and then stops is the one
   * thing no real voice does.
   */
  private voiceNote(
    sink: MusicSink, out: AudioNode, wave: OscillatorType, hz: number,
    peak: number, start: number, stop: number, rich: boolean,
  ): void {
    const osc = sink.createOscillator();
    const gain = sink.createGain();
    osc.type = wave;
    osc.frequency.value = hz;
    const g = gain.gain;
    if (rich) {
      const attack = Math.min(0.012, (stop - start) / 4);
      const decay = Math.min(0.09, (stop - start) / 2);
      const release = Math.min(0.045, (stop - start) / 3);
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(peak, start + attack);
      g.linearRampToValueAtTime(peak * 0.72, start + attack + decay);
      g.setValueAtTime(peak * 0.72, Math.max(start + attack + decay, stop - release));
      g.linearRampToValueAtTime(0, stop);
    } else {
      // A short rise and fall, or every note begins with a click.
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(peak, start + 0.008);
      g.setValueAtTime(peak, Math.max(start + 0.009, stop - 0.02));
      g.linearRampToValueAtTime(0, stop);
    }
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(stop + 0.01);
    this.nodes.push({ osc, gain });
  }

  get empty(): boolean { return this.nodes.length === 0; }

  stop(): void {
    const now = this.sink.currentTime;
    for (const { osc, gain } of this.nodes) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        osc.stop(now);
      } catch { /* already finished */ }
    }
    this.nodes.length = 0;
    this.silent = null;
    try { this.filter?.disconnect(); } catch { /* already gone */ }
    this.filter = null;
  }
}
