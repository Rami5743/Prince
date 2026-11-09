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
 * A standard MIDI file as a list of notes.
 *
 * Format 0 and format 1 both appear here, so every track is read and
 * the results merged; the delta times are in the header's ticks and
 * the tempo changes as the file says, so the times come out in
 * seconds.
 */
export function midiNotes(sound: MidiSound): Note[] {
  const b = sound.bytes;
  if (b.length < 14 || b[0] !== 0x4d || b[1] !== 0x54) return []; // 'MT'
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const division = dv.getUint16(12, false);
  // An SMPTE division is negative; the game's files are not, and
  // guessing at one would be worse than silence.
  if (division & 0x8000 || division === 0) return [];

  /** Every track's events, in the file's own ticks. */
  interface Raw { tick: number; on: boolean; note: number; vel: number; ch: number }
  const raw: Raw[] = [];
  const tempos: { tick: number; usPerBeat: number }[] = [];

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
        p += varLen();
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
  return notes.sort((a, b2) => a.at - b2.at);
}

/**
 * A PC speaker tune as a list of notes.
 *
 * The word in each note is the frequency itself, not a divisor: the
 * original's own player hands it straight to its square wave. A note
 * lasts `length / tempo` seconds, 1 or less is a rest, and 0x12 ends
 * the tune -- which `parseSound` has already cut it off at.
 */
export function speakerNotes(sound: SpeakerSound): Note[] {
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
  return notes;
}

/** Just enough of `AudioContext` to make a noise with. */
export interface MusicSink {
  readonly currentTime: number;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  readonly destination: AudioNode;
}

/**
 * A tune in the channel: every note scheduled at once, and a handle to
 * take them all away again.
 *
 * The original has one channel and a new sound stops whatever is in
 * it, so a tune has to be stoppable at any moment -- which is what
 * `stop_sounds` and the next footstep both do.
 */
export class Tune {
  private readonly nodes: { osc: OscillatorNode; gain: GainNode }[] = [];
  private readonly sink: MusicSink;
  /** When the last note ends, in the sink's own clock. */
  readonly endsAt: number;
  onended: (() => void) | null = null;

  constructor(sink: MusicSink, notes: readonly Note[], wave: OscillatorType) {
    this.sink = sink;
    const t0 = sink.currentTime + 0.03;
    let end = t0;
    // A tune with hundreds of notes would be hundreds of oscillators
    // at once; the game's are far shorter than that, and the cap is
    // only here so a malformed file cannot wedge the page.
    for (const n of notes.slice(0, 600)) {
      const osc = sink.createOscillator();
      const gain = sink.createGain();
      osc.type = wave;
      osc.frequency.value = n.hz;
      const start = t0 + n.at;
      const stop = start + n.dur;
      // A short rise and fall, or every note begins with a click.
      const peak = 0.11 * n.level;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.008);
      gain.gain.setValueAtTime(peak, Math.max(start + 0.009, stop - 0.02));
      gain.gain.linearRampToValueAtTime(0, stop);
      osc.connect(gain);
      gain.connect(sink.destination);
      osc.start(start);
      osc.stop(stop + 0.01);
      this.nodes.push({ osc, gain });
      if (stop > end) end = stop;
    }
    this.endsAt = end;
    const last = this.nodes[this.nodes.length - 1];
    if (last) last.osc.onended = (): void => { this.onended?.(); };
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
  }
}
