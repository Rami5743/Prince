/**
 * The ear: what the original played, beside what the port plays.
 *
 * Every one of the fifty-odd digests in `tools/oracle/digests/` is a
 * *picture*. The capture chain ran DOSBox with `pcspeaker=false`, and
 * nothing in the suite had ever compared a sound with anything -- which
 * is why three of the five bugs a human found in one sitting by playing
 * the page were sound, and why neither score moved by a single tick when
 * all five were fixed.
 *
 * `dosbox_oracle.py --speaker` lets the mixer carry the square wave and
 * `tools/oracle/sound_notes.py` turns the recorded WAV into a list of
 * notes -- start, length and pitch -- by counting zero crossings. The PC
 * speaker has one bit, so the recording is a clean two-level square wave
 * and the note is recoverable exactly: against the title's own tune the
 * extractor returns the ninety notes of sound 54 one for one, with every
 * start inside five milliseconds of where the file puts it.
 *
 * This is the other half. The port's sound events -- which sound, at
 * what moment -- are expanded into the same notes out of the game's own
 * `IBM_SND*.DAT`, and the two lists are lined up and scored.
 *
 * What that measures is exactly what the five bugs were:
 *
 * * **when** a sound starts (`play_sound`, `play_next_sound`, and the
 *   `while (check_sound_playing())` waits built on them),
 * * **which** sound it is, because a tune's notes name it,
 * * **how long** it lasts, and whether something cut it off -- "the
 *   scene's music ran on into the level" is an extra block of notes
 *   here and nothing at all in a picture,
 * * and whether the port reads the sound files correctly at all. The
 *   melody being twelve seconds late was a reader fault of exactly that
 *   shape in the MIDI path, and nothing was watching the speaker path.
 */
import { Assets } from '../../src/render/assets.ts';
import {
  loadSound, SPEAKER_FILES, soundPriority, soundInterruptible,
} from '../../src/render/audio.ts';
import { PopGame } from '../../src/pop/game.ts';
import { speakerNotes } from '../../src/render/music.ts';
import { SpeakerClock } from './scene-common.ts';

/** One note as either side gives it: when it starts, how long, what pitch. */
export interface SoundNote {
  /** Seconds from the start of the capture, or of the run. */
  readonly at: number;
  readonly dur: number;
  /** Hertz. The game's files hold the pitch itself; see `tunesOf`. */
  readonly hz: number;
}

/** A capture, as `sound_notes.py` writes it. */
export interface SoundDigest {
  readonly rate: number;
  readonly seconds: number;
  /** `[start, duration, hz]`, in seconds and hertz. */
  readonly notes: readonly (readonly [number, number, number])[];
  /** `[start, end]` of every stretch the speaker was sounding at all. */
  readonly active?: readonly (readonly [number, number])[];
  /** The second the Ctrl+A restart falls on, for a recording. */
  readonly origin?: number;
}

/** The port asking for a sound: which one, and when. */
export interface SoundEvent {
  /** Seconds from the start of the run. */
  readonly at: number;
  /** The sound index, or -1 for `stop_sounds`. */
  readonly which: number;
}

/**
 * Every tune the PC speaker has, by sound index.
 *
 * The field the parser calls a divisor is the **pitch in hertz**, and
 * that was settled by the capture rather than by reading: the title's
 * notes are stored as 73, 110, 117, 147, 156, 185, 196 and 208, and
 * the recording of the original playing them measures 73.0, 110.1,
 * 116.5, 147.1, 155.3, 185.1, 196.1 and 207.0 Hz. As 8253 divisors
 * those would be sixteen and ten kilohertz, which no one can hear.
 */
export async function tunesOf(assets: Assets): Promise<Map<number, SoundNote[]>> {
  const tunes = new Map<number, SoundNote[]>();
  for (let i = 0; i < 58; i++) {
    const sound = await loadSound(assets, i, SPEAKER_FILES as unknown as string[]);
    if (!sound || sound.kind !== 'speaker') continue;
    const notes = speakerNotes(sound).map((n) => ({ at: n.at, dur: n.dur, hz: n.hz }));
    if (notes.length) tunes.set(i, notes);
  }
  return tunes;
}

/**
 * The port's events as notes.
 *
 * The original has one channel: a sound takes it from whatever was in
 * it, and `stop_sounds` empties it. So each event's tune is cut off
 * where the next event falls, which is what makes "the tune ran on
 * into the level" visible here.
 */
export function expand(
  events: readonly SoundEvent[], tunes: Map<number, SoundNote[]>,
): SoundNote[] {
  const out: SoundNote[] = [];
  for (let e = 0; e < events.length; e++) {
    const { at, which } = events[e];
    const tune = tunes.get(which);
    if (!tune) continue;
    const until = e + 1 < events.length ? events[e + 1].at : Infinity;
    for (const n of tune) {
      const start = at + n.at;
      if (start >= until) break;
      out.push({ at: start, dur: Math.min(n.dur, until - start), hz: n.hz });
    }
  }
  return coalesce(out.sort((a, b) => a.at - b.at));
}

/**
 * Two notes of the same pitch with no rest between them are one note,
 * and a recording cannot say otherwise.
 *
 * The speaker is a gate and a divisor. Writing the same divisor again
 * changes nothing the microphone can hear, so where the tune has
 * `147 for 1.063` followed by `147 for 0.188` the capture has one note
 * of 1.252 and the extractor is right to say so -- it is reading what
 * the hardware did. The title's own tune has four such pairs. So the
 * port's half is coalesced the same way before the two are compared,
 * and what is measured is what a sound really is: a pitch, a moment
 * and a length.
 */
export function coalesce(ns: readonly SoundNote[]): SoundNote[] {
  const out: SoundNote[] = [];
  for (const n of ns) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.hz - n.hz) <= HZ_TOLERANCE * n.hz
        && n.at - (prev.at + prev.dur) <= 0.004) {
      out[out.length - 1] = { at: prev.at, dur: n.at + n.dur - prev.at, hz: prev.hz };
      continue;
    }
    out.push(n);
  }
  return out;
}

/**
 * How near two notes have to be to be the same note.
 *
 * The pitch first: the recorded square wave comes out within half a
 * per cent of the stored value, and the game's own notes are a
 * semitone apart, which is six. One per cent is comfortably between.
 */
export const HZ_TOLERANCE = 0.015;
/**
 * And the moment. Measured against the title's own tune the extractor
 * puts every note start inside **five** milliseconds of where the file
 * says, once the one constant offset is taken out -- the first note of
 * a sound is the exception, about twenty-six milliseconds late, which
 * is the speaker gate opening. Thirty milliseconds is one video frame
 * and is what a picture digest can resolve at best.
 */
export const AT_TOLERANCE = 0.030;

/**
 * A sound the capture heard: which tune, when it started, and how
 * many of its notes were played before something cut it off.
 *
 * The tune names itself. Each of the game's speaker sounds is a
 * different sequence of pitches, so a run of the capture's notes that
 * follows one of them from its first note can only be that sound --
 * and where it stops following is where the one channel was taken
 * away, which is the whole of "the scene's music ran on into the
 * level" and of "the gate made no sound".
 */
export interface Heard {
  readonly which: number;
  /** When the tune's first note sounded, in the capture's clock. */
  readonly at: number;
  /** How many of the tune's notes were heard. */
  readonly count: number;
  /** How many it has in all. */
  readonly of: number;
  /** When the last note heard ended. */
  readonly until: number;
}

/** How many of a tune's notes have to follow for it to name itself. */
const NAMES_ITSELF = 4;

/**
 * How many cycles of a pitch a recording needs before it can say what
 * the pitch was.
 *
 * The extractor counts zero crossings and asks for four of them, so a
 * note of under two periods is not a note it can read. That is not a
 * fault in it: a 31 Hz note of four milliseconds is a fifth of one
 * cycle, and no instrument recovers a pitch from a fifth of a cycle.
 * `sound_51_princess_door_opening` is a ramp from 39 Hz down to 31
 * whose first five notes are all under sixty milliseconds, so three of
 * its nine are all the original can be heard to play.
 */
const CYCLES = 2.5;

/**
 * A tune as a recording of it can be read: the notes too short for
 * their own pitch dropped.
 *
 * Both sides go through this, so nothing is being excused -- what is
 * compared is what either side would sound like through the same
 * microphone.
 */
export function measurable(ns: readonly SoundNote[]): SoundNote[] {
  return ns.filter((n) => n.dur * n.hz >= CYCLES);
}

/**
 * Read a capture's notes back as the sounds that made them.
 *
 * Longest match wins, which matters because a few of the game's
 * sounds open on the same two or three notes.
 */
export function detect(
  notes: readonly SoundNote[], tunes: Map<number, SoundNote[]>,
): Heard[] {
  const coalesced = new Map<number, SoundNote[]>();
  for (const [i, t] of tunes) {
    const m = measurable(coalesce(t));
    if (m.length) coalesced.set(i, m);
  }
  const out: Heard[] = [];
  let i = 0;
  while (i < notes.length) {
    let bestWhich = -1;
    let bestN = 0;
    for (const [which, tune] of coalesced) {
      let n = 0;
      while (n < tune.length && i + n < notes.length) {
        const c = notes[i + n];
        const t = tune[n];
        const slack = Math.max(0.060, 0.25 * t.dur);
        if (Math.abs(c.hz - t.hz) > HZ_TOLERANCE * t.hz) break;
        // The gap to the note before has to be the tune's too, or a run
        // of one repeated pitch matches every tune that opens on it. It
        // is measured from one note to the next and not from the start
        // of the tune, so that it does not grow into a tolerance wide
        // enough to swallow the sound after this one: the title's own 54
        // ran sixty-five notes into 55's first three that way. Sixty
        // milliseconds is two video frames, and the extractor puts a
        // note start inside five.
        if (n > 0 && Math.abs((c.at - notes[i + n - 1].at)
                              - (t.at - tune[n - 1].at)) > 0.060) break;
        // A note longer than the tune's is not that note. 54 ends on a
        // twenty-nine millisecond blip at 55 Hz and 55 opens on a note
        // of a second and a half at the same pitch, two tenths of a
        // second apart, and nothing but the length tells them apart.
        if (c.dur > t.dur + slack) break;
        n++;
        // A note *shorter* than the tune's is where the one channel was
        // taken away, so it is the last note heard and not a mismatch.
        if (c.dur < t.dur - slack) break;
      }
      if (n > bestN || (n === bestN && n === tune.length && bestWhich >= 0
                        && tune.length > (coalesced.get(bestWhich)?.length ?? 0))) {
        bestN = n;
        bestWhich = which;
      }
    }
    if (bestWhich < 0 || (bestN < NAMES_ITSELF
                          && bestN < (coalesced.get(bestWhich)?.length ?? 0))) {
      i++;
      continue;
    }
    out.push({
      which: bestWhich,
      at: notes[i].at,
      count: bestN,
      of: coalesced.get(bestWhich)!.length,
      until: notes[i + bestN - 1].at + notes[i + bestN - 1].dur,
    });
    i += bestN;
  }
  return out;
}

/**
 * The port's events, read as the same sounds the capture is read as.
 *
 * The one channel is taken by whatever is played next, so a tune is cut
 * off where the following event falls -- which is what makes a sound
 * that should have been stopped, or one that was stopped too soon,
 * visible as a count.
 */
export function heardOf(
  events: readonly SoundEvent[], tunes: Map<number, SoundNote[]>,
): Heard[] {
  const out: Heard[] = [];
  for (let e = 0; e < events.length; e++) {
    const { at, which } = events[e];
    const tune = tunes.get(which);
    if (!tune) continue;
    const notes = measurable(coalesce(tune));
    if (!notes.length) continue;
    const until = e + 1 < events.length ? events[e + 1].at : Infinity;
    let count = 0;
    let last = at;
    for (const n of notes) {
      if (at + n.at >= until) break;
      count++;
      last = Math.min(at + n.at + n.dur, until);
    }
    if (!count) continue;
    out.push({ which, at: at + notes[0].at, count, of: notes.length, until: last });
  }
  return out;
}

/** One sound of the capture, and whatever of the port's answers it. */
export interface Pair {
  readonly capture: Heard;
  readonly port: Heard | null;
  /** The port's start, less the capture's, with the global offset taken out. */
  readonly late: number;
}

export interface SoundScore {
  /** Notes of the capture the port plays too. */
  readonly matched: number;
  readonly total: number;
  /** The one unknown: when the recorder started against the game. */
  readonly offset: number;
  readonly pairs: readonly Pair[];
  /** Sounds the port plays that the original does not. */
  readonly extra: readonly Heard[];
}

/**
 * Line the two lists of sounds up and score.
 *
 * One offset is searched for, as `scene-report.ts` searches for the
 * video frame a scene began on and for the same reason: the recorder
 * and the game start when the script says, which has no fixed relation
 * to the moment anything is played. Nothing is pressed in a scene, so
 * there is no key schedule an offset could be fitted to -- it says one
 * thing only, and everything after it is the measurement.
 *
 * A capture sound and a port sound answer each other when they are the
 * same sound and start within `NEAR`. The score is the capture's notes
 * the port also plays: a sound the port never asks for scores nothing,
 * one it cuts short scores what it managed, and one it lets run on
 * shows up in `extra`.
 */
const NEAR = 1.0;

export function scoreHeard(
  capture: readonly Heard[], port: readonly Heard[],
  /**
   * How long the port's run is. A capture of a recording holds the
   * whole chain that reached the level -- the title's own music and
   * every `shift+l` -- and the port's half begins at the Ctrl+A
   * restart, so what falls outside the run is not a difference
   * between them. The window moves with the offset, which is the
   * only thing a sound capture leaves unknown, and nothing is gained
   * by choosing an offset that empties it: the score counted is the
   * number matched, so an empty window scores nought.
   */
  span = Infinity,
): SoundScore {
  const candidates = new Set<number>([0]);
  for (const c of capture) {
    for (const p of port) {
      if (p.which === c.which) candidates.add(Math.round((p.at - c.at) * 100) / 100);
    }
  }
  let best = 0;
  let bestScore = -1;
  let bestPairs: Pair[] = [];
  let bestTaken = new Set<number>();
  let bestWindow: Heard[] = [];
  for (const off of candidates) {
    const taken = new Set<number>();
    const pairs: Pair[] = [];
    let score = 0;
    // A port time of t is a capture time of `t - off`, so the run
    // occupies `[-off, -off + span]` in the capture's own clock.
    const within = capture.filter((c) => c.at >= -off - 0.5 && c.at <= -off + span);
    for (const c of within) {
      let found: Heard | null = null;
      let foundAt = -1;
      for (let i = 0; i < port.length; i++) {
        if (taken.has(i) || port[i].which !== c.which) continue;
        if (Math.abs(port[i].at - off - c.at) > NEAR) continue;
        if (found && Math.abs(port[i].at - off - c.at) >= Math.abs(found.at - off - c.at)) continue;
        found = port[i];
        foundAt = i;
      }
      if (found) taken.add(foundAt);
      pairs.push({ capture: c, port: found, late: found ? found.at - off - c.at : NaN });
      score += found ? Math.min(found.count, c.count) : 0;
    }
    if (score > bestScore) {
      bestScore = score; best = off; bestPairs = pairs; bestTaken = taken;
      bestWindow = within;
    }
  }
  return {
    matched: bestScore,
    total: bestWindow.reduce((a, c) => a + c.count, 0),
    offset: best,
    pairs: bestPairs,
    extra: port.filter((_, i) => !bestTaken.has(i)),
  };
}

/** A `SpeakerClock` that also writes down what it was asked to play. */
export class RecordingClock extends SpeakerClock {
  readonly events: SoundEvent[] = [];
  private at = 0;

  override tick(ms: number): void { this.at += ms; super.tick(ms); }
  /** `playScene` resets the clock before the first frame; start clean. */
  override reset(): void { this.events.length = 0; this.at = 0; super.reset(); }
  override play(which: number): void {
    this.events.push({ at: this.at / 1000, which });
    super.play(which);
  }
  override stop(): void {
    this.events.push({ at: this.at / 1000, which: -1 });
    super.stop();
  }
}

/**
 * The one channel, as the machine the oracle runs on has it.
 *
 * DOSBox is given no Sound Blaster, so `PRINCE.EXE` plays the PC
 * speaker: the tunes of `IBM_SND*.DAT` and not the recordings of
 * `DIGISND*.DAT`. The two are different lengths -- the speaker's
 * `sound_15_leveldoor_sliding` is not the Sound Blaster's -- and the
 * length is what decides, through `play_next_sound`, whether the next
 * ask is refused. So a port replayed against a speaker capture has to
 * be the same machine, exactly as `SpeakerClock` makes a cutscene one.
 *
 * The rule is `play_next_sound`'s and the tables are the game's:
 *
 *     if (current_sound == -1 || (sound_interruptible[current_sound] &&
 *          sound_prio_table[next_sound] <= sound_prio_table[current_sound]))
 *
 * Six of the sounds the game raises in play -- 1 falling, 11 sword
 * moving, 19 footstep, 20 blast, 21 chopper blade and 22 the first
 * loose-floor shake -- have **no** speaker tune at all, so on this
 * machine they are silent and hold the channel for no time. That is
 * the hardware and not the port: a PC speaker has nothing to play
 * them with.
 */
export class SpeakerChannel {
  private readonly length = new Map<number, number>();
  private which = -1;
  private endsAt = -1;
  private at = 0;
  /** Every sound that took the channel, and when. */
  readonly events: SoundEvent[] = [];

  static async load(assets: Assets): Promise<SpeakerChannel> {
    const ch = new SpeakerChannel();
    for (const [i, notes] of await tunesOf(assets)) {
      let end = 0;
      for (const n of notes) end = Math.max(end, n.at + n.dur);
      ch.length.set(i, end);
    }
    return ch;
  }

  /** The run's clock has gone on by `seconds`. */
  tick(seconds: number): void { this.at += seconds; }

  private mayTake(index: number): boolean {
    if (!this.playing) return true;
    return soundInterruptible(this.which)
      && soundPriority(index) <= soundPriority(this.which);
  }

  play(index: number): void {
    if (!this.mayTake(index)) return;
    this.which = index;
    this.endsAt = this.at + (this.length.get(index) ?? 0);
    this.events.push({ at: this.at, which: index });
  }

  stop(): void {
    if (this.playing) this.events.push({ at: this.at, which: -1 });
    this.which = -1;
    this.endsAt = -1;
  }

  get playing(): boolean { return this.at < this.endsAt; }
}

/**
 * Replay a recording and write down what the player would hear on the
 * machine the oracle runs on.
 *
 * The tick's sound is asked for in `render()`, because that is where
 * `draw_game_frame` has `play_next_sound`: a driver that steps without
 * drawing hears nothing at all.
 */
export async function recordingSounds(
  assets: Assets, exe: Uint8Array,
  rec: { level: number; startMinutes?: number },
  timeline: readonly { x: number; y: number; shift: boolean }[],
  ticks: number,
  /**
   * Whether the game is told what is in the channel.
   *
   * It is not a free choice: `check_sound_playing` is read in three
   * places that are play and not sound -- `control_crouched`'s level
   * 1 music, `play_kid`'s death, and the feather fall -- so the
   * answer changes the run, and which is right was measured against
   * `gate1`'s capture rather than argued: the deaf model scores
   * **90 of its 96 noises** and the channel-aware one **26**. So the
   * default is deaf, which is also what every picture digest in the
   * suite rests on -- `link.ts` leaves `check_sound_playing` at nought
   * and the pictures score 19258 of 20011. The ear and the eye agree
   * about it independently. See `tools/oracle/README.md`.
   */
  deaf = true,
  /**
   * The recording's cheats, by the tick `process_key` reads them on.
   *
   * The picture side has replayed a probe's cheats since the cheats
   * went in -- `digest-common.ts` calls `game.cheat(key)` just before
   * `step` -- and this did not, so a sound probe whose whole point is
   * a cheat heard nothing at all. `feather1snd` is the first:
   * `shift+w` on tick 362 is `feather_fall()`, the only way anything
   * in the suite can reach `sound_39_low_weight`, and without this
   * the port's channel carried on with the footsteps the original
   * refuses for eighteen and a half seconds.
   */
  cheats: ReadonlyMap<number, readonly string[]> = new Map(),
): Promise<SoundEvent[]> {
  const channel = await SpeakerChannel.load(assets);
  const game = await PopGame.start(assets, exe, rec.level, {
    minutesLeft: rec.startMinutes,
    effects: {
      sound: (which: number) => channel.play(which),
      stopSounds: () => channel.stop(),
      soundPlaying: () => (deaf ? false : channel.playing),
    },
  });
  for (let t = 0; t < ticks; t++) {
    for (const key of cheats.get(t) ?? []) game.cheat(key);
    game.step(timeline[t] ?? { x: 0, y: 0, shift: false });
    game.render();
    channel.tick(1 / 12);
  }
  return channel.events;
}

/** When the speaker was sounding: `[start, end]` in seconds. */
export type Noise = readonly [number, number];

/**
 * The port's channel as noise, which is the only thing an effect can
 * be compared as.
 *
 * `sound_2_tile_crashing` is a hundred and sixty-nine notes of two
 * milliseconds at a thousand to eighteen hundred hertz, and
 * `sound_15_leveldoor_sliding` is seventeen half-cycles between 31 Hz
 * and 39. Neither has a pitch to read. What they do have is a moment
 * and a length, and the gate that made no sound at all -- the bug a
 * human found by playing -- is exactly a missing interval here.
 */
export function occupancy(
  events: readonly SoundEvent[], tunes: Map<number, SoundNote[]>,
): { at: number; until: number; which: number }[] {
  const out: { at: number; until: number; which: number }[] = [];
  for (let e = 0; e < events.length; e++) {
    const { at, which } = events[e];
    if (which < 0) {
      if (out.length) out[out.length - 1].until = Math.min(out[out.length - 1].until, at);
      continue;
    }
    const tune = tunes.get(which);
    if (!tune) continue;
    let end = 0;
    for (const n of tune) end = Math.max(end, n.at + n.dur);
    if (out.length) out[out.length - 1].until = Math.min(out[out.length - 1].until, at);
    out.push({ at, until: at + end, which });
  }
  return out;
}

/**
 * The gap a silence has to be before the ear hears two noises and not
 * one. It is `ACTIVE_GAP` in `tools/oracle/sound_notes.py`, and it has
 * to be the same number on both sides or the two lists are not lists
 * of the same thing.
 */
export const NOISE_GAP = 0.05;

/**
 * The port's channel as the capture's extractor would have heard it.
 *
 * `occupancy` gives one interval per sound: from the moment the
 * byte-code took the channel to the end of the tune or to whatever
 * took it next. The **capture** has no such thing. It has zero
 * crossings, and `sound_notes.py` reads a rest longer than fifty
 * milliseconds as the end of one noise and the start of another --
 * so a tune with rests in it arrives as several noises where the port
 * arrives as one, and every noise after the first reads as a sound
 * the original made and the port did not.
 *
 * That is the whole of `gate1snd`'s shortfall and it was not the
 * port. `sound_41_end_level_music` is one `play_sound` at the tick
 * the Prince climbs into the exit door, and the game's own tune has
 * two rests of 63 ms in its first two seconds: stretches of 0.688,
 * 1.063 and 9.375 seconds. The capture of the original measures
 * **0.683, 1.062 and 6.791** (the last cut off by the end of the
 * recording), starting 94.281 against the tune's own 94.285. The two
 * agree to four milliseconds and the report called two of the three
 * "the original alone".
 *
 * So the port's side is split here by the same rule, and the two
 * lists are comparable for the first time.
 */
export function noises(
  events: readonly SoundEvent[], tunes: Map<number, SoundNote[]>,
): { at: number; until: number; which: number }[] {
  const out: { at: number; until: number; which: number }[] = [];
  for (const iv of occupancy(events, tunes)) {
    const tune = tunes.get(iv.which);
    if (!tune) continue;
    let run: { at: number; until: number; which: number } | null = null;
    for (const n of tune) {
      const a = iv.at + n.at;
      const b = Math.min(iv.at + n.at + n.dur, iv.until);
      if (a >= iv.until) break;
      if (run && a - run.until <= NOISE_GAP) run.until = Math.max(run.until, b);
      else { run = { at: a, until: b, which: iv.which }; out.push(run); }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface NoiseScore {
  readonly matched: number;
  readonly total: number;
  readonly origin: number;
  /** The best score a second either side of it, which says how sharp. */
  readonly nearby: number;
  /** Capture noises with no port sound at them, and the other way about. */
  readonly missing: readonly Noise[];
  readonly extra: readonly { at: number; until: number; which: number }[];
}

/** Three ticks. A key edge of a capture is itself worth one or two. */
export const NOISE_NEAR = 0.25;

/**
 * Score the port's channel against the capture's noise.
 *
 * Unlike a scene, a recording's capture has a **known** origin: the
 * Ctrl+A restart, whose second `recording_to_script.mjs` prints and
 * `soundcapture.sh` writes into the digest. It is only known to a
 * few tenths -- the script's clock is not the emulator's -- so it is
 * refined over a tenth of a second either way and no further, which
 * is what stops the search fitting the port to one coincidence. The
 * first attempt let the offset go free and it chose one two and a
 * half seconds out on the strength of a single sound.
 */
export function scoreNoise(
  capture: readonly Noise[], port: readonly { at: number; until: number; which: number }[],
  origin: number, span: number,
): NoiseScore {
  let best = origin;
  let bestN = -1;
  let bestIn: Noise[] = [];
  let bestTaken = new Set<number>();
  const scores = new Map<number, number>();
  // Five seconds either way, a twentieth at a time. The generator's
  // `restart at` is the *script's* clock, and a chain that reaches
  // level 10 with ten `shift+l` and six cutscene waits arrives about
  // four seconds after the script thinks it does. Widening it is not
  // letting the offset go free: the peak is a **plateau with sharp
  // shoulders**, and the report prints how sharp. `level10bsnd`
  // scores 90 of 90 over a second and a fifth of origin and falls to
  // 70 a second either side of that, which no coincidence does.
  for (let d = -100; d <= 100; d++) {
    const o = origin + d * 0.05;
    const within = capture.filter(([a]) => a >= o - 0.05 && a <= o + span);
    const taken = new Set<number>();
    let n = 0;
    for (const [a] of within) {
      for (let i = 0; i < port.length; i++) {
        if (taken.has(i)) continue;
        if (Math.abs(port[i].at + o - a) > NOISE_NEAR) continue;
        taken.add(i);
        n++;
        break;
      }
    }
    scores.set(d, n);
    if (n > bestN) { bestN = n; best = o; bestIn = within; bestTaken = taken; }
  }
  const bestD = Math.round((best - origin) / 0.05);
  let nearby = 0;
  for (const [d, n] of scores) {
    if (Math.abs(d - bestD) >= 20 && n > nearby) nearby = n;
  }
  const missing: Noise[] = [];
  const used = new Set<number>();
  for (const iv of bestIn) {
    let hit = -1;
    for (let i = 0; i < port.length; i++) {
      if (used.has(i)) continue;
      if (Math.abs(port[i].at + best - iv[0]) > NOISE_NEAR) continue;
      hit = i; break;
    }
    if (hit < 0) missing.push(iv);
    else used.add(hit);
  }
  // A sound the port starts *while the original was still sounding*
  // is not a sound the original did not make. `animate_leveldoor`
  // asks for `sound_15_leveldoor_sliding` on each of the forty-odd
  // ticks the exit door takes to rise, the tune is a quarter of a
  // second and uninterruptible, so the port starts it again every
  // three ticks -- and the capture has one unbroken noise of three
  // and a quarter seconds there, which is the same thing heard.
  const inside = (t: number): boolean =>
    bestIn.some(([a, b]) => t >= a - NOISE_NEAR && t <= b + NOISE_NEAR);
  return {
    matched: bestN,
    total: bestIn.length,
    origin: best,
    nearby,
    missing,
    extra: port.filter((p, i) => !bestTaken.has(i) && !inside(p.at + best)
                                 && p.at + best >= best - 0.05
                                 && p.at + best <= best + span),
  };
}
