/**
 * Running a cutscene the way the oracle's capture ran it.
 *
 * Everything in `tools/oracle/digests/` before this round was
 * *gameplay*. The title the player sees on every page load, the
 * ending, the hourglass and the six scenes between the levels were
 * written from the C with unit tests only and had never been put
 * beside a capture of `PRINCE.EXE` at all.
 *
 * Two things have to be modelled before they can be:
 *
 * **The clock.** A scene is not played at twelve ticks a second. It
 * yields sixtieths of a second, and the only resolution a thirty
 * frames a second capture has is a video frame -- so a scene is
 * replayed in steps of 1/30 of a second and compared frame for frame.
 *
 * **The sound.** `show_title`, `load_intro` and `end_sequence` each
 * stop dead at `while (check_sound_playing())`, so the length of the
 * music *is* the timing of the scene. In the browser that question
 * goes to the audio device, which is right; headless there is no
 * device, so the waits were nought and the port's title ran 68
 * seconds against the original's hundred and more.
 *
 * What the original was playing is measurable rather than assumed.
 * The capture's first wait -- `TITLE_MAIN` with the credits up, from
 * video frame 518 to 807 -- ends **24.77 seconds** after the intro
 * music starts, and sound 54 is 5937 units at tempo 240, which is
 * `5937 / 240 = 24.74` seconds as the PC speaker plays it. The same
 * sound as MIDI is 46.59 seconds. So the machine the oracle runs on
 * is playing `IBM_SND*.DAT`, and this clock plays them too.
 */
import { Assets } from '../../src/render/assets.ts';
import { loadSound, SPEAKER_FILES } from '../../src/render/audio.ts';
import { speakerNotes } from '../../src/render/music.ts';
import { CutscenePlayer, type SceneName } from '../../src/pop/cutscene.ts';

/** One sound channel, with the lengths the PC speaker gives. */
export class SpeakerClock {
  private readonly length = new Map<number, number>();
  /** When what is sounding now ends, on the scene's own clock. */
  private endsAt = -1;
  private now = 0;

  static async load(assets: Assets): Promise<SpeakerClock> {
    const clock = new SpeakerClock();
    for (let i = 0; i < 58; i++) {
      const sound = await loadSound(assets, i, SPEAKER_FILES as unknown as string[]);
      if (!sound || sound.kind !== 'speaker') continue;
      const notes = speakerNotes(sound);
      let end = 0;
      for (const n of notes) end = Math.max(end, n.at + n.dur);
      clock.length.set(i, end * 1000);
    }
    return clock;
  }

  /** The scene's clock has gone on by `ms`. */
  tick(ms: number): void { this.now += ms; }
  reset(): void { this.now = 0; this.endsAt = -1; }

  /**
   * `play_sound_from_buffer`: the one channel is taken, whatever was
   * in it. The cutscenes never use `play_next_sound`'s priorities --
   * they call the buffer form directly -- so neither does this.
   */
  play(which: number): void {
    const ms = this.length.get(which);
    this.endsAt = ms === undefined ? -1 : this.now + ms;
  }

  stop(): void { this.endsAt = -1; }
  get playing(): boolean { return this.now < this.endsAt; }
}

/** A step of the replay: one video frame of a thirty-a-second capture. */
export const SCENE_STEP_MS = 1000 / 30;

/**
 * Play a scene and hand back one rendered picture per video frame.
 *
 * `onFrame` is given the frame's index and its RGB, in the order they
 * are drawn, so the caller can hash them or write them out without
 * every frame of a hundred-second scene being held at once.
 */
export async function playScene(
  assets: Assets, exe: Uint8Array, scene: SceneName, frames: number,
  onFrame: (i: number, rgb: Uint8Array) => void,
  player?: CutscenePlayer, clock?: SpeakerClock,
): Promise<void> {
  const sound = clock ?? await SpeakerClock.load(assets);
  sound.reset();
  const p = player ?? await CutscenePlayer.create(assets, exe, {
    sound: (which) => sound.play(which),
    soundPlaying: () => sound.playing,
    stopSounds: () => sound.stop(),
  });
  p.begin(scene);
  for (let i = 0; i < frames; i++) {
    onFrame(i, p.render().toRgb(p.palette.toRgba()));
    // The hall of fame asks for a name. Nobody is typing in a capture
    // either, so nothing is pushed: `input_str` spins on its cursor.
    p.advance(SCENE_STEP_MS);
    sound.tick(SCENE_STEP_MS);
  }
}
