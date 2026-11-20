/**
 * The music at `quality: high`: the same tune, a better voice.
 *
 * "The same music, only cleaner" is a promise that can be broken in
 * one direction and not noticed by ear, so it is pinned here rather
 * than listened to: **every note of a rich tune starts at the instant
 * the plain one starts it, lasts as long, and is the same pitch.**
 * What `rich` adds is a quiet octave above each note -- the AdLib's
 * voice is two operators and a bare oscillator is one -- an envelope
 * that decays to a sustain instead of holding dead level, and one low
 * pass over the whole tune.
 *
 * Nothing in `src/pop` is involved and no headless tool ever asks for
 * `rich`, so no score can move by any of it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { loadSound, MIDI_FILES } from '../../src/render/audio.ts';
import { Tune, midiTune, type MusicSink, type Note } from '../../src/render/music.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

interface Scheduled {
  type: string;
  hz: number;
  start: number;
  stop: number;
  /** The biggest value its gain was ever ramped to. */
  peak: number;
  /** Whether it was connected to the filter rather than straight out. */
  filtered: boolean;
}

interface Watched {
  sink: MusicSink;
  oscillators: Scheduled[];
  filters: { type: string; hz: number }[];
}

/** A sink that writes down what a tune asks it for. */
function watch(withFilter = true): Watched {
  const oscillators: Scheduled[] = [];
  const filters: { type: string; hz: number }[] = [];
  const destination = { id: 'out' } as unknown as AudioNode;
  /** Whatever `createBiquadFilter` last handed back, by identity. */
  let filterNode: unknown = null;
  const sink: Record<string, unknown> = {
    currentTime: 0,
    destination,
    createOscillator(): OscillatorNode {
      const node: Scheduled = {
        type: 'square', hz: 0, start: -1, stop: -1, peak: 0, filtered: false,
      };
      oscillators.push(node);
      return {
        set type(v: string) { node.type = v; },
        get type(): string { return node.type; },
        frequency: { set value(v: number) { node.hz = v; }, get value(): number { return node.hz; } },
        connect(target: { gainOf?: Scheduled }): void { if (target.gainOf) target.gainOf = node; },
        start(t: number): void { node.start = t; },
        stop(t: number): void { node.stop = t; },
        onended: null,
      } as unknown as OscillatorNode;
    },
    createGain(): GainNode {
      // The gain is made right after the oscillator it belongs to, so
      // the last one written down is the one it shapes.
      const mine = oscillators[oscillators.length - 1]!;
      const gain = {
        set value(v: number) { if (v > mine.peak) mine.peak = v; },
        get value(): number { return mine.peak; },
        setValueAtTime(v: number): unknown { if (v > mine.peak) mine.peak = v; return gain; },
        linearRampToValueAtTime(v: number): unknown { if (v > mine.peak) mine.peak = v; return gain; },
        cancelScheduledValues(): unknown { return gain; },
      };
      return {
        gain,
        connect(target: unknown): void { mine.filtered = target === filterNode; },
      } as unknown as GainNode;
    },
  };
  if (withFilter) {
    sink.createBiquadFilter = (): BiquadFilterNode => {
      const row = { type: 'lowpass', hz: 0 };
      filters.push(row);
      const node = {
        set type(v: string) { row.type = v; },
        get type(): string { return row.type; },
        frequency: {
          set value(v: number) { row.hz = v; },
          get value(): number { return row.hz; },
        },
        Q: { value: 0 },
        connect(): void {},
        disconnect(): void {},
      };
      filterNode = node;
      return node as unknown as BiquadFilterNode;
    };
  }
  return { sink: sink as unknown as MusicSink, oscillators, filters };
}

const NOTES: Note[] = [
  { at: 0, dur: 0.4, hz: 220, level: 1, channel: 0 },
  { at: 0.4, dur: 0.2, hz: 330, level: 0.8, channel: 0 },
  { at: 0.6, dur: 1.0, hz: 110, level: 1, channel: 1 },
];

/** The notes, without the silent node that carries `onended`. */
function notesOf(w: Watched, every: number): Scheduled[] {
  // The carrier is made last and has no frequency of its own.
  return w.oscillators.slice(0, NOTES.length * every);
}

describe('the tune voice', () => {
  it('plays the same notes at the same instants for the same time', () => {
    const plain = watch();
    const rich = watch();
    const a = new Tune(plain.sink, NOTES, 'triangle', 2, 'plain');
    const b = new Tune(rich.sink, NOTES, 'triangle', 2, 'rich');
    expect(a.endsAt, 'and the channel is held exactly as long').toBe(b.endsAt);

    const fundamentals = notesOf(rich, 2).filter((_, i) => i % 2 === 0);
    const plainNotes = notesOf(plain, 1);
    expect(fundamentals).toHaveLength(plainNotes.length);
    for (let i = 0; i < plainNotes.length; i++) {
      expect(fundamentals[i]!.hz, `note ${i} pitch`).toBe(plainNotes[i]!.hz);
      expect(fundamentals[i]!.start, `note ${i} start`).toBe(plainNotes[i]!.start);
      expect(fundamentals[i]!.stop, `note ${i} end`).toBe(plainNotes[i]!.stop);
      expect(fundamentals[i]!.type, `note ${i} wave`).toBe(plainNotes[i]!.type);
      expect(fundamentals[i]!.peak, `note ${i} loudness`).toBeCloseTo(plainNotes[i]!.peak, 10);
    }
  });

  it('adds one quiet octave to each note, and nothing else', () => {
    const rich = watch();
    new Tune(rich.sink, NOTES, 'triangle', 2, 'rich');
    const notes = notesOf(rich, 2);
    expect(notes).toHaveLength(NOTES.length * 2);
    for (let i = 0; i < NOTES.length; i++) {
      const low = notes[i * 2]!;
      const high = notes[i * 2 + 1]!;
      expect(high.hz / low.hz, 'an octave above').toBe(2);
      expect(high.start).toBe(low.start);
      expect(high.stop).toBe(low.stop);
      expect(high.peak, 'and well under it').toBeLessThan(low.peak * 0.4);
      // A sine, because the partial is the second operator and not a
      // second instrument.
      expect(high.type).toBe('sine');
    }
  });

  it('puts one low pass over the whole tune, and only at `rich`', () => {
    const rich = watch();
    new Tune(rich.sink, NOTES, 'square', 2, 'rich');
    expect(rich.filters, 'one filter, not one per note').toHaveLength(1);
    expect(rich.filters[0]!.type).toBe('lowpass');
    // Above every pitch the game plays and below where a square
    // wave's harmonics turn into hiss.
    expect(rich.filters[0]!.hz).toBeGreaterThan(2000);
    expect(rich.filters[0]!.hz).toBeLessThan(8000);

    const plain = watch();
    new Tune(plain.sink, NOTES, 'square', 2, 'plain');
    expect(plain.filters, 'the original voice is untouched').toHaveLength(0);
  });

  it('falls back to the plain voice on a sink with no filter', () => {
    const bare = watch(false);
    const tune = new Tune(bare.sink, NOTES, 'square', 2, 'rich');
    expect(tune.empty).toBe(false);
    // One oscillator a note, as at `plain`, plus the silent carrier.
    expect(bare.oscillators).toHaveLength(NOTES.length + 1);
  });

  it('holds a real tune of the game note for note', async () => {
    // `sound_54`, the music under the title, which is the longest
    // thing the player hears before touching anything.
    const midi = await loadSound(assets, 54, MIDI_FILES as unknown as string[]);
    expect(midi?.kind, 'the title music is there').toBe('midi');
    const { notes, length } = midiTune(midi as never);
    expect(notes.length).toBeGreaterThan(50);

    const plain = watch();
    const rich = watch();
    const a = new Tune(plain.sink, notes, 'triangle', length, 'plain');
    const b = new Tune(rich.sink, notes, 'triangle', length, 'rich');
    expect(b.endsAt).toBe(a.endsAt);
    const plainNotes = plain.oscillators.slice(0, notes.length);
    const fundamentals = rich.oscillators
      .slice(0, notes.length * 2).filter((_, i) => i % 2 === 0);
    expect(fundamentals.map((n) => n.hz)).toEqual(plainNotes.map((n) => n.hz));
    expect(fundamentals.map((n) => n.start)).toEqual(plainNotes.map((n) => n.start));
    expect(fundamentals.map((n) => n.stop)).toEqual(plainNotes.map((n) => n.stop));
  });
});
