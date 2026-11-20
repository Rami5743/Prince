/**
 * One channel, as the hardware had.
 *
 * The original plays one sound at a time: starting one stops whatever is
 * in the channel, which is why the byte-code can ask for silence by name.
 * The port started a new `AudioBufferSourceNode` for every sound and let
 * them pile up, and with the falling whoosh going off on every footstep
 * that came out as a wail.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { SoundPlayer, type AudioSink } from '../../src/render/audio.ts';
import { SOUND_SILENCE } from '../../src/game/sequence.ts';
import { SOUND } from '../../src/game/traps.ts';

const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));

interface FakeSource {
  started: boolean;
  stopped: boolean;
  buffer: unknown;
  onended: (() => void) | null;
}

/** Enough of a `AudioContext` to see what the player does with it. */
function fakeSink(): { sink: AudioSink; sources: FakeSource[]; resumed: number } {
  const sources: FakeSource[] = [];
  const state = { resumed: 0 };
  const sink = {
    sampleRate: 44100,
    state: 'suspended',
    async resume(): Promise<void> { state.resumed += 1; },
    createBuffer(_channels: number, length: number): AudioBuffer {
      const data = new Float32Array(length);
      return { getChannelData: () => data, length } as unknown as AudioBuffer;
    },
    createBufferSource(): AudioBufferSourceNode {
      const s: FakeSource = { started: false, stopped: false, buffer: null, onended: null };
      sources.push(s);
      return {
        set buffer(b: unknown) { s.buffer = b; },
        get buffer(): unknown { return s.buffer; },
        set onended(f: () => void) { s.onended = f; },
        connect(): void { /* nothing to connect to */ },
        start(): void { s.started = true; },
        stop(): void { s.stopped = true; },
      } as unknown as AudioBufferSourceNode;
    },
    destination: {} as AudioNode,
    /**
     * The three a tune needs. Without them `SoundPlayer.start` will
     * not play a tune at all, and every sound that is music rather
     * than a recording -- the scene between two levels among them --
     * is silently dropped, which is not what the browser does.
     */
    currentTime: 0,
    createOscillator(): OscillatorNode {
      return {
        type: 'square', frequency: { value: 0 },
        connect(): void {}, start(): void {}, stop(): void {},
        onended: null,
      } as unknown as OscillatorNode;
    },
    createGain(): GainNode {
      const gain = {
        value: 0,
        setValueAtTime(): unknown { return gain; },
        linearRampToValueAtTime(): unknown { return gain; },
        cancelScheduledValues(): unknown { return gain; },
      };
      return { gain, connect(): void {} } as unknown as GainNode;
    },
  };
  return { sink, sources, get resumed() { return state.resumed; } };
}

describe('the sound player', () => {
  it('says nothing until the page has been touched', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.preload(SOUND.footstep);
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(0);
    await player.wake();
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].started).toBe(true);
  });

  it('stops the sound in the channel before starting the next', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([SOUND.footstep, SOUND.bumped]);
    player.play(SOUND.footstep);
    player.play(SOUND.bumped);
    expect(f.sources).toHaveLength(2);
    expect(f.sources[0].stopped, 'the first is cut off').toBe(true);
    expect(f.sources[1].stopped, 'the second is left playing').toBe(false);
  });

  it('empties the channel when the byte-code asks for silence', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preload(SOUND.footstep);
    player.play(SOUND.footstep);
    player.play(SOUND_SILENCE);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].stopped).toBe(true);
  });

  it('does not stop anything for a sound it has no recording of', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([SOUND.footstep, 9999]);
    player.play(SOUND.footstep);
    player.play(9999);
    expect(f.sources).toHaveLength(1);
    expect(f.sources[0].stopped).toBe(false);
  });

  /**
   * `sound_15_leveldoor_sliding`, which the game asks for on every one
   * of the forty-two ticks the way out of the level takes to open.
   */
  const LEVELDOOR_SLIDING = 15;

  it('lets a sound that may not be interrupted run to its end', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preloadAll([LEVELDOOR_SLIDING, SOUND.footstep]);
    for (let tick = 0; tick < 42; tick++) player.play(LEVELDOOR_SLIDING);
    expect(f.sources, 'started once, not forty-two times').toHaveLength(1);
    expect(f.sources[0].stopped).toBe(false);
    player.play(SOUND.footstep);
    expect(f.sources, 'and a footstep does not cut it off').toHaveLength(1);
  });

  it('plays a sound that was asked for while it was still being read', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    player.play(SOUND.footstep); // not loaded yet: starts the read
    expect(f.sources).toHaveLength(0);
    await player.preload(SOUND.footstep);
    expect(f.sources, 'it is played when it lands').toHaveLength(1);
    expect(f.sources[0].started).toBe(true);
  });

  it('plays nothing at all while it is muted', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preload(SOUND.footstep);
    player.muted = true;
    player.play(SOUND.footstep);
    expect(f.sources).toHaveLength(0);
  });
});

/**
 * The music, against the game's own other copy of it.
 *
 * Every tune ships twice: as a standard MIDI file in `MIDISND1..2.DAT`
 * for an AdLib, and as a tune for the PC speaker in `IBM_SND1..2.DAT`.
 * They are the same music, so they last the same time -- and that is a
 * check on the MIDI reader that needs nothing outside the game's own
 * files.
 *
 * It was not true. Every melody track in `MIDISND1.DAT` opens with the
 * AdLib instrument definition, `F0 07 00 00 34 01 00 0C F7`, and the
 * reader skipped it with `p += varLen()` -- which reads `p` before
 * calling `varLen`, so the two bytes `varLen` ate were added back on
 * and the skip landed one byte short. The reader then found `F7 00`
 * where a delta time should be and read it as **15232 ticks**: the
 * melody of every tune in the game was moved twelve seconds into the
 * future.
 *
 * Measured, before the fix against after, in seconds:
 *
 *     sound 27, the scene between two levels   33.4 -> 11.0  (speaker 10.7)
 *     sound 33, the small potion               14.0 ->  2.1  (speaker  2.5)
 *     sound 30, the big potion                 13.7 ->  3.1  (speaker  2.3)
 *     sound 54, the title                      46.6 -> 22.8  (speaker 24.7)
 *     sound 56, the ending                    145.5 -> 121.7 (speaker 120.0)
 *
 * And the game *waits for the sound*: `while (check_sound_playing())`
 * holds `show_title`, `load_intro` and `play_level` where they stand,
 * so a tune that lasts three times too long is a pause between the
 * levels that lasts three times too long and cannot be skipped.
 */
describe('the MIDI music', () => {
  it('lasts as long as the same tune does on the PC speaker', async () => {
    const { loadSound, MIDI_FILES, SPEAKER_FILES } = await import('../../src/render/audio.ts');
    const { midiNotes, speakerNotes } = await import('../../src/render/music.ts');
    const end = (ns: readonly { at: number; dur: number }[]): number =>
      ns.reduce((m, n) => Math.max(m, n.at + n.dur), 0);
    let compared = 0;
    for (let i = 0; i < 58; i++) {
      const midi = await loadSound(assets, i, MIDI_FILES as unknown as string[]);
      const beep = await loadSound(assets, i, SPEAKER_FILES as unknown as string[]);
      if (!midi || midi.kind !== 'midi' || !beep || beep.kind !== 'speaker') continue;
      const a = end(midiNotes(midi));
      const b = end(speakerNotes(beep));
      if (a === 0 || b === 0) continue;
      compared += 1;
      // Two arrangements of one tune, so not to the millisecond; the
      // fault this is here for was a factor of three to six.
      expect(a / b, `sound ${i}: MIDI ${a.toFixed(2)}s, speaker ${b.toFixed(2)}s`)
        .toBeGreaterThan(0.75);
      expect(a / b, `sound ${i}: MIDI ${a.toFixed(2)}s, speaker ${b.toFixed(2)}s`)
        .toBeLessThan(1.45);
    }
    expect(compared, 'every tune the game has both ways').toBeGreaterThanOrEqual(17);
  });

  /**
   * A tune lasts to the end of its sequence, not to its last note.
   *
   * The difference is what `check_sound_playing` answers with, and
   * for the feather it is the whole of a measured error.
   * `sound_39_low_weight` has its last note-off at 18.000 s and its
   * end of track at **18.667**, and a capture of `PRINCE.EXE` taking
   * `shift+w` measures the original's own noise at **18.598** -- so
   * the sequence's length is right to fifty-five milliseconds and
   * the last note's is three quarters of a second short. The title's
   * tune is the same: 22.794 against 24.294, where the capture puts
   * `show_title`'s first wait at 24.77.
   */
  it('lasts to the end of its sequence and not to its last note', async () => {
    const { loadSound, MIDI_FILES } = await import('../../src/render/audio.ts');
    const { midiTune } = await import('../../src/render/music.ts');
    const want: Record<number, [number, number]> = {
      39: [18.000, 18.667], // the feather
      54: [22.794, 24.294], // the title
      24: [3.200, 3.600], // the death
      56: [121.700, 124.700], // the ending
    };
    for (const [key, [lastNote, sequence]] of Object.entries(want)) {
      const midi = await loadSound(assets, Number(key), MIDI_FILES as unknown as string[]);
      if (!midi || midi.kind !== 'midi') throw new Error(`MIDISND has no sound ${key}`);
      const tune = midiTune(midi);
      const end = tune.notes.reduce((m, n) => Math.max(m, n.at + n.dur), 0);
      expect(end, `sound ${key}: last note`).toBeCloseTo(lastNote, 2);
      expect(tune.length, `sound ${key}: end of sequence`).toBeCloseTo(sequence, 2);
    }
  });

  /**
   * And every note of it is scheduled.
   *
   * `Tune` caps a tune at a number of oscillators so a malformed file
   * cannot wedge the page, and six hundred was below the longest tune
   * the game has: `sound_56_ending_music` is **1800 notes**, and six
   * hundred of them is 42.0 seconds of its 121.7 -- the music under
   * the hall of fame, cut off a third of the way in, for the player
   * who has just finished the game.
   */
  it('has nothing longer than the cap on the notes a tune may schedule', async () => {
    const { loadSound, MIDI_FILES, SPEAKER_FILES } = await import('../../src/render/audio.ts');
    const { midiTune, speakerTune, TUNE_NOTE_CAP } = await import('../../src/render/music.ts');
    let longest = 0;
    for (let i = 0; i < 58; i++) {
      const midi = await loadSound(assets, i, MIDI_FILES as unknown as string[]);
      if (midi && midi.kind === 'midi') longest = Math.max(longest, midiTune(midi).notes.length);
      const beep = await loadSound(assets, i, SPEAKER_FILES as unknown as string[]);
      if (beep && beep.kind === 'speaker') longest = Math.max(longest, speakerTune(beep).notes.length);
    }
    expect(longest, 'the longest tune in the game').toBeGreaterThan(600);
    expect(longest, `the cap is ${TUNE_NOTE_CAP} and the longest tune is ${longest}`)
      .toBeLessThanOrEqual(TUNE_NOTE_CAP);
  });

  it('puts the melody at the start of the tune and not twelve seconds in', async () => {
    const { loadSound, MIDI_FILES } = await import('../../src/render/audio.ts');
    const { midiNotes } = await import('../../src/render/music.ts');
    // Sound 27 is the scene before levels 2, 4, 6 and 12, and its
    // melody is the track that opens with the AdLib sysex.
    const midi = await loadSound(assets, 27, MIDI_FILES as unknown as string[]);
    if (!midi || midi.kind !== 'midi') throw new Error('MIDISND has no sound 27');
    const notes = midiNotes(midi);
    const melody = notes.filter((n) => n.channel === 0);
    expect(melody.length).toBeGreaterThan(0);
    expect(melody[0].at, 'the melody starts with everything else').toBeLessThan(0.5);
  });
});

/**
 * Why there was no gate-opening sound.
 *
 * The scene between two levels plays sound 27, and the original's own
 * tables mark 27 the most important sound there is (priority 1) and
 * **not interruptible**. `play_next_sound` will then give the one
 * channel to nothing else until it has finished -- which is right,
 * and is why the C stops it: `play_level` runs
 * `while (check_sound_playing() && !do_paused()) idle(); stop_sounds();`
 * between the scene and `draw_level_first`, and
 * `proc_cutscene_frame` runs `stop_sounds()` when a key cuts the
 * scene short.
 *
 * The shell did neither, so the tune played on into the level and
 * every gate, footstep and loose floor was refused for as long as it
 * lasted. Measured in a real browser, over the first four seconds of
 * level 2 reached through the transition: **nought** recorded sounds
 * started before the two `stop_sounds` went in, and five after.
 */
describe('the one channel', () => {
  it('is held against everything by the scene music until it is stopped', async () => {
    const f = fakeSink();
    const player = new SoundPlayer(assets, f.sink);
    await player.wake();
    await player.preload(27); // the scene between levels 2, 4, 6 and 12
    await player.preload(5); // a gate opening
    player.play(27);
    expect(player.isPlaying, 'the tune has the channel').toBe(true);
    player.play(5);
    expect(player.isPlaying, 'and keeps it: 27 may not be interrupted').toBe(true);
    expect(f.sources, 'so the gate is never started').toHaveLength(0);
    // `stop_sounds()`, which is the line the shell was missing.
    player.stop();
    expect(player.isPlaying).toBe(false);
    player.play(5);
    expect(f.sources, 'and now the gate is heard').toHaveLength(1);
  });
});
