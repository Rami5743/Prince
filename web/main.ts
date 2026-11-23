/**
 * Browser entry point. Loads the original `.DAT` files and the original
 * executable, and plays with them.
 */
import { Assets, browserFetcher } from '../src/render/assets.ts';
import { Display } from '../src/render/display.ts';
import { Surface, ScreenPalette } from '../src/render/surface.ts';
import { RoomRenderer } from '../src/render/room.ts';
import { NO_DIRECTION as NO_GUARD } from '../src/game/guard.ts';
import {
  RECORDING_FORMAT, RECORDING_VERSION, encodeTimeline,
  type Recording, type RecordedEvent, type RecordedState,
} from '../src/game/recording.ts';
/**
 * The game the player plays is the translation of SDLPoP in `src/pop`,
 * not the hand-written port in `src/game`. It is measured against the
 * same nineteen captures of a real PRINCE.EXE and draws more of them
 * exactly -- 10605 of 11094 ticks against 10380 -- see
 * `tools/dev/pop-report.ts` and `docs/sdlpop-translation.md`.
 */
import { PopGame as Game } from '../src/pop/game.ts';
import { CutscenePlayer, type SceneName } from '../src/pop/cutscene.ts';
import { SoundPlayer, setSoundRelease, soundRelease } from '../src/render/audio.ts';
import { set_seed as setSeed } from '../src/pop/seg009.ts';
import { PROOM_RANDOM_PIXELS } from '../src/pop/seg001.ts';
import { SOUND } from '../src/game/traps.ts';
import { SEQUENCE_SOUND, SOUND_SILENCE } from '../src/game/sequence.ts';
import type { Controls } from '../src/game/kid.ts';
import { readExeConstants } from '../src/game/exe-constants.ts';
import {
  levelsDatWithPotionLevel, POTION_LEVEL_NUMBER,
} from '../src/dat/potion-level.ts';
import { levelsDatWithFourD } from '../src/dat/fourd-level.ts';
import { GameText } from '../src/render/text.ts';
import { KidHiRes, KID_HIRES_DIR, KID_SWORD_DIR, KID_FIRST_SPRITE, KID_SPRITE_COUNT,
  type KidSprite } from '../src/render/kid-hires.ts';
import { readFont } from '../src/render/font.ts';
import { SettingsStore } from './settings.ts';
import { Chrome } from './chrome.ts';
import { stringsFor } from './strings.ts';
import {
  snapshot, restore, readSlot, writeSlot, type SaveGame,
} from './savegame.ts';

const DATA_URL =
  (window as unknown as { __princeDataUrl?: string }).__princeDataUrl
  ?? '../original/prince1';
/**
 * `potion.html`: the same game, with one level record swapped.
 *
 * The page sets this before the bundle runs and two things follow:
 * `LEVELS.DAT` comes back with `src/dat/potion-level.ts`'s corridor
 * in place of level 1, and the page opens on that level instead of
 * on the title. **Nothing in `src/pop` knows about it** -- the
 * engine, the renderer and the sound are the ones the real game
 * uses, and the only difference is 2305 bytes of level data. The
 * original's own `original/prince1/LEVELS.DAT` is never written to:
 * the swap is in the copy this page fetched.
 */
const POTION_PAGE =
  (window as unknown as { __princePotionLevel?: boolean }).__princePotionLevel === true;
/** The original ran its game loop at this rate. */
const FRAMES_PER_SECOND = 12;

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLElement;

  const display = new Display(canvas);
  /**
   * What the player has chosen. Nothing in `src/pop` reads it: the
   * engine plays the same ticks whatever is set here, and
   * `tools/dev/page-port.ts` goes on requiring the page to draw the
   * headless port's own picture.
   */
  const settings = new SettingsStore();
  display.setAspect(settings.get('aspect'));
  // The picture's own quality, which the player may have chosen on a
  // previous visit: the canvas is given more pixels before the first
  // frame is drawn rather than after it.
  display.setQuality(settings.get('quality'));
  /**
   * The page's own words, kept here as well as in the chrome.
   *
   * The line under the game is the one piece of chrome that is
   * written from this file: it says what the page is doing, and it is
   * said again whenever the language moves, because most of the
   * places that set it set it once and then leave it there.
   */
  let words = stringsFor(settings.get('language'));
  let sayStatus: () => string = () => words.loading;
  const setStatus = (line: () => string): void => {
    sayStatus = line;
    status.textContent = line();
  };
  // A host that cannot serve the game's own file types can supply the files
  // another way; the page provides a fetcher and this uses it.
  const custom = (window as unknown as {
    __princeFetcher?: (name: string) => Promise<Uint8Array>;
  }).__princeFetcher;
  const plain = custom ?? browserFetcher(DATA_URL);
  /**
   * The five files Prince of Persia 1.4 draws differently.
   *
   * The player supplied a copy of the last DOS release and every one
   * of its files was compared with this repository's 1.0. **Its
   * `LEVELS.DAT` is byte for byte identical**, so 1.4 is not a
   * different map, a different hour or a different starting position
   * -- what it changed is the artwork: 72 of `VDUNGEON.DAT`'s 218
   * resources, 14 of `VPALACE.DAT`'s 238, 3 of `TITLE.DAT`'s 12 and
   * 5 of `SKEL.DAT`'s 29, and a `PRINCE.DAT` that grows from 3278
   * bytes to 25600 and carries resource 20, the five alternate level
   * palettes 1.0 has not got at all.
   *
   * It is one wrapper round the fetcher and nothing more, which is
   * why `src/pop` never learns of it: the engine asks `Assets` for a
   * file by name, exactly as it always did, and the name is answered
   * out of a different directory. Every headless tool and every
   * capture comparison keeps 1.0 by construction, because only this
   * page ever wraps the fetcher.
   */
  const ART_1_4 = new Set([
    'PRINCE.DAT', 'TITLE.DAT', 'VDUNGEON.DAT', 'VPALACE.DAT', 'SKEL.DAT',
  ]);
  const art14 = custom ?? browserFetcher(`${DATA_URL.replace(/prince1$/, 'prince14')}`);
  const fromDisc = settings.get('graphics') === '1.4' && custom === undefined
    ? async (name: string): Promise<Uint8Array> => (ART_1_4.has(name)
      ? art14(name)
      : plain(name))
    : plain;
  /**
   * The map of "4-D Prince of Persia", built rather than served.
   *
   * That 1994 modification's own level file holds **eleven** records
   * and not sixteen -- 2011 and the four after it are written as
   * blank index entries -- so serving it whole would leave the game
   * with no level 12, no Jaffar and no princess. `levelsDatWithFourD`
   * puts its eleven into the original's sixteen, which is the only
   * way the game can be finished, and neither file on disc is
   * touched. Six of those eleven are really new: levels 2 to 7.
   */
  const fourD = settings.get('map') === '4d' && custom === undefined;
  const kirill = fourD
    ? browserFetcher(`${DATA_URL.replace(/prince1$/, 'fourd')}`)('KIRILL.DAT')
    : undefined;
  const fetchFile = async (name: string): Promise<Uint8Array> => {
    if (name !== 'LEVELS.DAT') return fromDisc(name);
    let levels = await fromDisc(name);
    if (kirill) levels = levelsDatWithFourD(levels, await kirill);
    if (POTION_PAGE) levels = levelsDatWithPotionLevel(levels);
    return levels;
  };
  const assets = new Assets(fetchFile);
  const exe = await fetchFile('UNCRKD.EXE');
  /**
   * Every word the game itself draws, in the player's language.
   *
   * It is handed to `PopGame` and to `CutscenePlayer` as an option and
   * is the only thing either of them knows about a setting -- they
   * never read one. A headless tool builds neither with it, so the
   * digests measure the original's own words in the original's own
   * font. See `src/render/text.ts`.
   */
  const gameText = new GameText(readFont(exe), {
    language: settings.get('language'),
    quality: settings.get('quality'),
  });
  display.setTextSource(() => gameText.overlay);

  /**
   * The repainted Prince: `graphics/kid-10x/`, drawn at `high`.
   *
   * 219 sprites painted at ten times the original's size, each one
   * exactly ten times its own frame, from the `gpt` branch. The
   * engine reports what it drew through `onKidSprite` and knows
   * nothing else about it; the display masks the artwork by his own
   * palette bank so that whatever is in front of him still covers
   * him, and multiplies it by how far the palette has been faded.
   *
   * A frame whose art has not arrived yet is simply the original's
   * pixels for that tick, so the page is never held up by the
   * artwork -- but that fallback must not be what the player sees.
   * Fetching each sprite the first time the game draws it means every
   * new frame of the walk is pixel-art until its PNG lands, and at
   * 83 ms a tick over a real network that is several ticks apiece:
   * the whole first few seconds of play flickers between the painted
   * Prince and the blocky one.
   *
   * So at `quality: high` the 219 are **read in behind the play**,
   * eight at a time, in id order -- which is the order the game needs
   * them in, 401 being the standing frames. One is 44 KiB and the set
   * is nine and a half megabytes. At `original` not one is asked
   * for, and the prefetch starts if the player moves the setting.
   */
  const kidArt = new KidHiRes();
  const kidAsked = new Set<number>();
  let kidDrawn: KidSprite[] = [];
  const root = DATA_URL.replace(/original\/prince1$/, '');
  const kidDir = `${root}${KID_HIRES_DIR}`;
  const swordDir = `${root}${KID_SWORD_DIR}`;
  /** The sword frames' own offsets, in tenths of a game pixel. */
  let swordAt: Record<string, [number, number]> = {};
  const decode = async (url: string): Promise<ImageData | null> => {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height);
  };
  const fetchKid = async (id: number): Promise<void> => {
    if (kidAsked.has(id)) return;
    kidAsked.add(id);
    const name = String(id).padStart(4, '0');
    try {
      const body = await decode(`${kidDir}/${name}.png`);
      if (body) kidArt.put(id, body);
      // 561..592 are painted a second time with the sword in them,
      // at an offset of their own: the blade reaches out of the box
      // the game blits him in, which is what its own second object
      // does.
      const at = swordAt[String(id)];
      if (at) {
        const armed = await decode(`${swordDir}/${name}.png`);
        if (armed) kidArt.putSword(id, armed, at[0], at[1]);
      }
    } catch {
      // No artwork for this frame: the original's pixels stand.
    }
  };
  /**
   * The engine's own silhouettes, straight out of `KID.DAT`.
   *
   * The finished surface cannot tell a pixel of the room beside him
   * from a pixel of his a pillar took, and the painting is wider
   * than the blit in 1868 cells of 206 of the 219 frames -- which
   * is what put a block of the wall on the standing Prince's back.
   * The sprites say which pixels the blit would have written, and
   * `Assets` has the file open already.
   */
  const loadKidBlits = async (): Promise<void> => {
    try {
      const set = await assets.group('KID.DAT', 400);
      for (let i = 0; i < KID_SPRITE_COUNT; i++) {
        const id = KID_FIRST_SPRITE + i;
        const sprite = set.images[id - 400];
        if (sprite) kidArt.putBlit(id, sprite.pixels, sprite.width, sprite.height);
      }
    } catch {
      // Without them the painting keeps to the blit, as it did.
    }
  };
  /** Read all 219 in behind the play, eight at a time. */
  let kidPrefetched = false;
  const prefetchKid = (): void => {
    if (kidPrefetched) return;
    kidPrefetched = true;
    const ids: number[] = [];
    for (let i = 0; i < KID_SPRITE_COUNT; i++) ids.push(KID_FIRST_SPRITE + i);
    let next = 0;
    const pump = async (): Promise<void> => {
      while (next < ids.length) await fetchKid(ids[next++]!);
    };
    void (async (): Promise<void> => {
      // The offsets first: a frame fetched without them would be
      // kept as a body alone and never asked for again.
      try {
        const res = await fetch(`${swordDir}/offsets.json`);
        if (res.ok) swordAt = (await res.json()) as Record<string, [number, number]>;
      } catch {
        // No offsets: the fighting frames keep the original's sword.
      }
      await loadKidBlits();
      for (let lane = 0; lane < 8; lane++) void pump();
    })();
  };
  const onKidSprite = (id: number, x: number, y: number, flipped: boolean): void => {
    if (settings.get('quality') !== 'high') return;
    if (!kidArt.has(id)) { void fetchKid(id); return; }
    kidDrawn.push({ id, x, y, flipped });
  };
  const kidSource = (): readonly KidSprite[] => {
    const was = kidDrawn;
    kidDrawn = [];
    return was;
  };
  /** `custom->first_level`, which is what a key during the demo starts. */
  const firstLevel = readExeConstants(exe).firstLevel;

  /**
   * Sound. A browser will not let a page make a noise until the player
   * has touched it, so the context is built on the first key or tap and
   * the sounds the game raises are read in behind it.
   */
  let sound: SoundPlayer | null = null;
  const wakeSound = (): void => {
    if (!sound) {
      const Ctor = (window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      });
      const Context = Ctor.AudioContext ?? Ctor.webkitAudioContext;
      if (!Context) return;
      sound = new SoundPlayer(assets, new Context());
      // The sound's own half of `quality`, which the player may have
      // chosen before ever touching the page.
      sound.quality = settings.get('quality');
      // And the sound's other half, which is not a quality at all:
      // `original` is 1.0's two tables and `1.3` is the three bytes
      // the later release moved. It is the same at either quality.
      setSoundRelease(settings.get('music') === '1.3' ? '1.3' : '1.0');
      /**
       * Every index the game ever raises, read in behind the play.
       *
       * The effects stop at 51; the rest are the music -- the opening,
       * the death, the end of a level, winning a fight, the mirror --
       * which lives in the MIDI files and the speaker tunes rather
       * than among the recordings.
       */
      const ALL_SOUNDS = Array.from({ length: 57 }, (_, i) => i);
      void sound.preloadAll([
        ...Object.values(SOUND),
        ...SEQUENCE_SOUND.filter((i) => i !== SOUND_SILENCE),
        ...ALL_SOUNDS,
      ]);
    }
    void sound.wake();
  };
  /**
   * Every sound the byte-code **asked** for, and when.
   *
   * `SoundPlayer.started` says what reached the channel, which is a
   * property of the audio device's own clock: a page stepped as fast
   * as a test can drive it hears a different set from a page played
   * at twelve ticks a second, because `play_next_sound`'s rule asks
   * whether something is still sounding. What `play_sound` *asked*
   * for is not -- it is the game, and nothing else. So that is what
   * `tools/dev/page-port.ts` puts beside the headless port's, and
   * the difference between the two lists is the device.
   *
   * Capped, because a page left running for an hour should not grow
   * a list of every footstep in it.
   */
  const asked: { tick: number; which: number }[] = [];
  const effects = {
    sound: (which: number) => {
      if (asked.length < 4000) asked.push({ tick: ticksPlayed, which });
      return sound?.play(which);
    },
    stopSounds: () => sound?.stop(),
    soundPlaying: () => sound?.isPlaying ?? false,
  };

  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group('TITLE.DAT', 50);
  const opening = await assets.group('TITLE.DAT', 40);

  /**
   * The cutscenes, the title and the ending: `src/pop/cutscene.ts`.
   *
   * It is built once, on the first scene that needs it, because it
   * reads `PV.DAT` and `TITLE.DAT` and nothing before the first
   * cutscene wants them.
   */
  let cutscene: CutscenePlayer | null = null;
  let cutsceneBuilding = false;
  /** What to do once the scene has played itself out. */
  let afterScene: (() => Promise<void>) | null = null;

  async function playScene(
    scene: SceneName, then: () => Promise<void>,
  ): Promise<void> {
    if (!cutscene) {
      cutsceneBuilding = true;
      try {
        cutscene = await CutscenePlayer.create(assets, exe, effects, gameText);
      } finally {
        cutsceneBuilding = false;
      }
    }
    game = null;
    afterScene = then;
    sceneCount += 1;
    cutscene.begin(scene);
    display.present(cutscene.render(), cutscene.palette.toRgba());
    setStatus(() => (scene.kind === 'title' ? words.pressAnyKey : words.skipScene));
  }

  /**
   * How many scenes have been begun.
   *
   * A scene that ends runs whatever was behind it, and that can be
   * another scene of the same kind -- the title's own follow-on is
   * `restartGame`, which puts the title up again. So "is the same
   * scene still running" cannot be answered by its name, and
   * `tools/dev/page-port.ts` watches this instead.
   */
  let sceneCount = 0;

  /** One frame of a scene; answers whether one is still playing. */
  function sceneFrame(ms: number): boolean {
    if (!cutscene || !cutscene.running) return false;
    const going = cutscene.advance(ms);
    display.present(cutscene.render(), cutscene.palette.toRgba());
    if (!going) endScene();
    return true;
  }

  function endScene(): void {
    cutscene?.cancel();
    const then = afterScene;
    afterScene = null;
    if (then) void changeScene(then);
  }

  /**
   * A key cut the scene short.
   *
   * `proc_cutscene_frame`'s loop is
   *
   *     if (!disable_keys && do_paused()) {
   *         stop_sounds();
   *         draw_rect(&screen_rect, color_0_black);
   *         return 1;
   *     }
   *
   * so the sound stops with the picture. Without that the scene's
   * music -- sound 27, eleven seconds and marked uninterruptible --
   * went on sounding into the level the player had just skipped to,
   * and `play_next_sound`'s rule then refused every gate, every
   * footstep and every loose floor until it had finished.
   */
  function skipScene(): void {
    effects.stopSounds();
    endScene();
  }

  /**
   * `while (check_sound_playing() && !do_paused()) idle(); stop_sounds();`
   *
   * `play_level` runs this between the scene and `draw_level_first`,
   * so the tune the scene started is allowed to finish -- and is
   * then stopped, rather than being left to play on into the level
   * and hold the one channel against everything in it. Any key ends
   * the wait, which is what `do_paused` is doing in that line.
   *
   * Nothing is drawn or stepped while it is out: `changeScene` holds
   * `changing`, and the screen keeps the scene's last frame, which
   * is the black `fade_out_1` left.
   */
  let soundWaitOver: (() => void) | null = null;
  let soundWaitUntil = 0;
  /**
   * A cap the C has no need of, because a DOS sound always ends.
   *
   * Here the clock the tune is scheduled against is the browser's,
   * and a suspended context, a lost `onended` or a device that never
   * starts would leave the channel looking busy for ever -- which
   * would be a page frozen between two levels, with nothing on it
   * but black. The longest tune a scene plays is eighteen seconds,
   * so twenty-five is never reached by a sound that is really there.
   */
  const SOUND_WAIT_CAP_MS = 25000;
  function waitForSound(): Promise<void> {
    if (!effects.soundPlaying()) { effects.stopSounds(); return Promise.resolve(); }
    soundWaitUntil = performance.now() + SOUND_WAIT_CAP_MS;
    return new Promise<void>((resolve) => {
      soundWaitOver = (): void => {
        soundWaitOver = null;
        effects.stopSounds();
        resolve();
      };
    });
  }

  type View = { kind: 'title' | 'opening' } | { kind: 'level'; level: number };
  const views: View[] = [{ kind: 'title' }, { kind: 'opening' }];
  /** Ticks played since the page opened, for tests that wait on game time. */
  let ticksPlayed = 0;
  for (let n = 1; n <= 14; n++) views.push({ kind: 'level', level: n });
  // `init_game(0)`: the attract-mode level the title falls into.
  views.push({ kind: 'level', level: 0 });
  const label = (v: View): string => (v.kind !== 'level'
    ? words.titleScreen
    : v.level === 0 ? words.theDemo : words.levelN.replace('{n}', String(v.level)));

  let current = 0;
  let game: Game | null = null;
  /** Set when the player wants to look at a room rather than play. */
  let watchRoom: number | null = null;

  /**
   * What the player is holding, as the directions the game thinks in rather
   * than as keys. The original is played on a numeric keypad, where one key
   * means a diagonal, so both the arrows and the keypad feed the same set.
   */
  const held = new Set<string>();
  /**
   * Directions pressed since the last step, whether or not they are still
   * down. The game is stepped twelve times a second, so a key that goes
   * down and up between two steps was never there at all as far as a plain
   * reading of `held` is concerned -- a quick tap did nothing, and every
   * press waited for the next step before it counted. The original's
   * keyboard handler latches a press the moment it happens, so this does
   * too, and the latch is cleared once the step has seen it.
   */
  const pressedSinceStep = new Set<string>();
  const controls = (): Controls => {
    const down = (d: string): boolean => held.has(d) || pressedSinceStep.has(d);
    return {
      x: (down('right') ? 1 : 0) - (down('left') ? 1 : 0),
      y: (down('down') ? 1 : 0) - (down('up') ? 1 : 0),
      shift: down('shift'),
    };
  };

  /**
   * What the keys do. Shift is the one worth spelling out: it is not only
   * the careful step, it is also what takes hold of a ledge, and without it
   * the Prince lets go the moment he grabs one -- so a player who does not
   * know about it cannot climb at all.
   */
  // `strings.ts` has them, in both languages.

  /**
   * Which directions a key stands for, against `read_keyb_control`.
   *
   * `seg000:1500` is four lists and they are not the four a keyboard
   * suggests:
   *
   *     up     UP, HOME, PAGEUP, KP_8, KP_7, KP_9
   *     down   DOWN, CLEAR, KP_5, KP_2
   *     left   LEFT, HOME, KP_4, KP_7
   *     right  RIGHT, PAGEUP, KP_6, KP_9
   *
   * Two of those the page did not have, and both are keys a player
   * presses:
   *
   * * **`KP_5` is `down`**, not nothing. It was mapped to no
   *   direction at all, so a player using the keypad the way the
   *   game's own manual draws it got nothing from the middle key.
   * * **Home and PageUp are the diagonals**, each in two lists at
   *   once -- Home is left *and* up, PageUp right *and* up. On a
   *   keyboard with no numeric keypad they are the only way to jump
   *   diagonally with the keys the original names, and the page had
   *   neither.
   *
   * `Numpad1` and `Numpad3` are in no list of the C's and are kept
   * anyway: they are the obvious diagonals on a keypad and taking
   * them away would only cost a player a key that works.
   */
  function directionsOf(e: KeyboardEvent): string[] | null {
    switch (e.code) {
      case 'Numpad7': case 'Home': return ['left', 'up'];
      case 'Numpad8': return ['up'];
      case 'Numpad9': case 'PageUp': return ['right', 'up'];
      case 'Numpad4': return ['left'];
      case 'Numpad5': case 'NumpadClear': return ['down'];
      case 'Numpad6': return ['right'];
      case 'Numpad1': return ['left', 'down'];
      case 'Numpad2': return ['down'];
      case 'Numpad3': return ['right', 'down'];
      case 'ArrowLeft': return ['left'];
      case 'ArrowRight': return ['right'];
      case 'ArrowUp': return ['up'];
      case 'ArrowDown': return ['down'];
      case 'ShiftLeft': case 'ShiftRight': return ['shift'];
      default: return null;
    }
  }

  function drawTitle(group: typeof title): void {
    titleSurface.clear();
    titlePalette.loadBlock(0, group.palette.vga);
    titleSurface.blitOpaque(group.images[1]!, 0, 0);
    display.present(titleSurface, titlePalette.toRgba());
  }

  async function select(index: number, carry: { seamless?: boolean } = {}): Promise<void> {
    // Whatever scene was playing is over: the shell is showing
    // something else now, and a scene left running would go on
    // drawing over it and holding the game's own clock.
    cutscene?.cancel();
    afterScene = null;
    const v = views[index];
    if (v.kind !== 'level') {
      current = index;
      game = null;
      drawTitle(v.kind === 'title' ? title : opening);
      setStatus(() => (v.kind === 'title' ? words.pressAnyKey : words.hourUp));
      return;
    }
    /**
     * `play_level`'s `stop_sounds()`, which comes just before
     * `draw_level_first`.
     *
     * Whatever was sounding does not carry into the level. Sound 27
     * -- the scene between levels 2, 4, 6 and 12 -- is priority 1 and
     * marked **not interruptible** in the original's own tables, so
     * while it sounds `play_next_sound` gives the one channel to
     * nothing else: left running it refused every gate, every
     * footstep and every loose floor for as long as it lasted, and
     * that is why there was no gate-opening sound. The title's own
     * music does the same thing to level 1.
     *
     * The `while (check_sound_playing() && !do_paused()) idle();`
     * that stands in front of it in the C is where the player meets
     * it -- out of a scene and into the level, and a level begun
     * again -- and it is there, in `nextLevel` and `restart`. A jump
     * straight to a level is not a path the original has, so it only
     * stops what is sounding.
     */
    effects.stopSounds();
    current = index;
    /**
     * Nothing may be drawn or stepped while this await is out.
     *
     * `PopGame.start` clears the globals -- `g.level` with them -- the
     * moment it is called, and only fills them in when the level's
     * data has been fetched. A frame that lands in between steps the
     * game that is still in `game` through a `g` with no level in it,
     * and the page takes
     * `Cannot read properties of undefined (reading 'roomlinks')`.
     *
     * `changeScene` holds `changing` over the same gap, but not every
     * caller of this goes through it -- `__princeShow` does not -- so
     * the flag belongs here as well, and it is a count because the
     * two nest.
     */
    building += 1;
    try {
      game = await Game.start(assets, exe, v.level,
        { effects, seamless: carry.seamless, text: gameText, onKidSprite });
      // `KID.DAT`'s own sixteen, DAC-expanded: what `fadeOf` reads
      // the live palette against, so a fade fades the painting too.
      const kidBank = game.scene.chtabs.kid?.palette.vga ?? [];
      if (settings.get('quality') === 'high') prefetchKid();
      display.setKidHiRes(kidArt, kidSource, kidBank
        .flatMap((e) => [(e.r << 2) | (e.r >> 4), (e.g << 2) | (e.g >> 4),
          (e.b << 2) | (e.b >> 4)]));
    } finally {
      building -= 1;
    }
    watchRoom = null;
  }

  /**
   * Recording what was pressed, so a session in a real browser can be
   * replayed in a test. The game is deterministic, so the input and the
   * level are enough to reproduce a session exactly; the states are kept
   * alongside so a replay can be checked against what the player saw, and
   * the raw key events so that a press acted on late can be found.
   */
  const recorder = {
    on: false,
    started: 0,
    ticks: [] as Controls[],
    events: [] as RecordedEvent[],
    states: [] as RecordedState[],
    level: 0,

    start(): void {
      this.on = true;
      this.started = performance.now();
      this.ticks = [];
      this.events = [];
      this.states = [];
      this.level = w0Level();
    },
    stop(): void { this.on = false; },

    key(type: 'down' | 'up', code: string): void {
      if (!this.on || this.events.length >= MAX_RECORDED_EVENTS) return;
      this.events.push({
        ms: Math.round((performance.now() - this.started) * 10) / 10,
        tick: this.ticks.length, type, key: code,
      });
    },

    tick(c: Controls, g: Game): void {
      if (!this.on || this.ticks.length >= MAX_RECORDED_TICKS) return;
      this.ticks.push({ ...c });
      this.states.push({
        tick: this.ticks.length - 1,
        frame: g.kid.frame, room: g.kid.room, x: g.kid.x, y: g.kid.y,
        hitPoints: g.hitPoints,
      });
    },

    toJson(): string {
      const out: Recording = {
        format: RECORDING_FORMAT,
        version: RECORDING_VERSION,
        recordedAt: new Date().toISOString(),
        level: this.level,
        // A recording made here always starts the level with a fresh
        // hour; only a probe captured against the original past
        // level 2 arrives with less. See `startMinutes`.
        startMinutes: 60,
        ticksPerSecond: FRAMES_PER_SECOND,
        timeline: encodeTimeline(this.ticks),
        events: this.events,
        states: this.states,
      };
      return JSON.stringify(out);
    },
  };

  /** Caps, so a recording left running does not eat the tab's memory. */
  const MAX_RECORDED_TICKS = 12 * 60 * 20; // twenty minutes of play
  const MAX_RECORDED_EVENTS = 20000;

  const w0Level = (): number => {
    const v = views[current];
    return v.kind === 'level' ? (v as { level: number }).level : 0;
  };

  /**
   * Shift+I turns the screen over, and `PopGame.render` is where that
   * happens now -- `draw_game_frame` wraps the copy to the screen in
   * `flip_screen`, so it belongs to the game and not to the canvas.
   * While it was here no capture could measure it.
   */
  function present(g: Game): void {
    const surface = g.render();
    lastShown = surface;
    display.present(surface, g.scene.screenPalette.toRgba());
    /**
     * `flash_if_hurt`, which `play_level_2` runs straight after
     * `draw_game_frame` -- and `remove_flash_if_hurt` takes it off
     * again before `do_simple_wait(timer_1)` spends the rest of the
     * tick, so the colour is on the screen for a sixtieth of a
     * second and off for the other four.
     *
     * A capture of `PRINCE.EXE` grabbed at sixty frames a second
     * says it exactly: `shift+t` on level 2 flashes on frames 3384,
     * 3389, 3394 and 3399, one frame each and five apart, with the
     * screen 43.1% pure black on every frame between them and 0.0%
     * on those four. `PopGame.render` used to hold the colour for
     * the whole tick, so eight ticks of a sword came out as two
     * thirds of a second of solid yellow instead of eight blinks.
     */
    if (g.flashColour > 0) {
      g.raiseFlash();
      display.present(surface, g.scene.screenPalette.toRgba());
      flashOff = performance.now() + FLASH_MS;
    }
  }

  /** The picture last put on the canvas, to show again without the flash. */
  let lastShown: Surface | null = null;
  /** When `remove_flash` is owed, by `performance.now()`; 0 if none is up. */
  let flashOff = 0;

  /**
   * How long `do_flash` leaves the colour on the screen.
   *
   * `set_timer_length(timer_2, 2)` is two sixtieths, 33ms; the
   * capture says one. Grabbed at sixty frames a second, `addlife2`'s
   * four flashes are frames 3384, 3389, 3394 and 3399 -- **one video
   * frame each**, where a colour up for a full 33ms would have to
   * cover two sample instants out of every pair. Where the capture
   * and a reading of the code disagree the capture wins, so the
   * colour comes off on the first animation frame at least this far
   * on: one frame of a sixty-hertz display, two of a hundred-and-
   * twenty-hertz one, a sixtieth of a second either way.
   */
  const FLASH_MS = 12;

  /** `remove_flash`, a sixtieth of a second after `do_flash`. */
  function takeFlashDown(now: number): void {
    if (flashOff === 0 || !game) return;
    if (now < flashOff) return;
    flashOff = 0;
    game.dropFlash();
    // Not while a scene is coming up: `lastShown` is the level's own
    // picture, and putting it back would paint over the scene.
    if (changing || building > 0 || cutsceneBuilding || cutscene?.running) return;
    if (lastShown) display.present(lastShown, game.scene.screenPalette.toRgba());
  }

  /**
   * The single tick `do_paused`'s busy wait lets through, set by the
   * key that ended it. See `frame`.
   */
  let stepOnce = false;
  /** The paused picture has been put on the canvas once already. */
  let pauseShown = false;
  /** Held while a scene change is in flight; see `changeScene`. */
  let changing = false;
  /** How many level fetches are out; see `select`. */
  let building = 0;

  function frame(): void {
    if (!game) return;
    /**
     * Not while the next level is being fetched.
     *
     * Both ways out of a level await the new scene's data, and
     * `PopGame.start` clears the globals the moment it is called --
     * `g.level` among them -- while the frame loop goes on running.
     * The frame that landed in that gap stepped the old game through
     * a `g` with no level in it and threw
     * `Cannot read properties of undefined (reading 'roomlinks')`
     * into the page. It showed up as three browser tests failing
     * under load and never when they ran alone, which is what a race
     * against a fetch looks like.
     */
    if (changing || building > 0 || cutsceneBuilding) return;
    // Esc: `do_paused` stops the game where it stands and leaves the
    // screen up until a key comes.
    if (game.paused && !stepOnce) {
      /**
       * `do_paused` draws nothing while it waits -- it is
       * `do { idle(); delay_ticks(1); } while (! process_key());`
       * -- so the screen keeps the picture the tick before it left
       * there, with GAME PAUSED under it. Presenting every frame
       * would run `draw_game_frame` sixty times a second, counting
       * the bottom text down and spending the flash.
       */
      if (!pauseShown) { pauseShown = true; present(game); }
      setStatus(() => words.pausedLine);
      return;
    }
    /**
     * The one tick `do_paused` lets through.
     *
     * The busy wait ends on **any** key and `is_paused` is already
     * nought by then, so `play_frame` goes on and plays the tick.
     * `process_key`'s own `case SDL_SCANCODE_ESCAPE` sets
     * `is_paused` back to 1, so Escape plays exactly one tick and
     * pauses again -- the original's frame advance -- while every
     * other key resumes.
     */
    stepOnce = false;
    pauseShown = false;
    /**
     * H, J, U and N do not stop the game.
     *
     * The original's are two lines of `process_key` -- `next_room =
     * room_L` and nothing else -- and `play_frame` goes on playing
     * the tick, with `check_the_end` at the end of it drawing the
     * room asked for. The Prince plays on off the screen, and the
     * view comes back of its own accord the moment he changes room,
     * because `exit_room` sets `next_room` to his.
     *
     * This used to stop stepping altogether while a room was being
     * looked at, which is a mode the game does not have.
     */
    /**
     * **And the loop steps once a tick while a room is being looked
     * at, like every other tick.** It used to call `frame()` again on
     * every animation frame that owed no step, so that the view
     * refreshed at once -- and `frame()` steps the game, so pressing
     * H, J, U or N ran it at the display's rate. Measured in
     * Chromium: 24 ticks in two seconds playing, **120 in two
     * seconds while looking around** -- five times too fast, with
     * the Prince off the screen where the player could not see him
     * do it.
     */
    if (watchRoom && game.drawnRoom !== watchRoom) game.showRoom(watchRoom);
    {
      const c = controls();
      pressedSinceStep.clear();
      game.step(c);
      ticksPlayed++;
      recorder.tick(c, game);
      if (watchRoom && game.drawnRoom !== watchRoom) watchRoom = null;
      if (game.gameWon) {
        // `check_the_end`: the last room of the last level, where the
        // original runs `end_sequence()`. It does now.
        void changeScene(() => playScene({ kind: 'ending' }, restartGame));
        return;
      }
      if (game.timeExpired) {
        // `expired()`: the hour is up. The original throws the screen
        // away, plays the hourglass out and starts the game again.
        void changeScene(() => playScene({ kind: 'expired' }, restartGame));
        return;
      }
      if (game.restartDue) { void changeScene(restart); return; }
      /**
       * Back to the title, which is what `start_game()` does from
       * three places the shell reaches: the demo run out of its last
       * room, a death on the demo level, and `Press Button to
       * Continue` left unanswered for its 288 ticks.
       */
      if (game.demoFinished || game.restartGameDue) {
        void changeScene(restartGame);
        return;
      }
      if (game.levelFinished) { void changeScene(nextLevel); return; }
    }
    present(game);
    const v = views[current];
    const g2 = game;
    const room = watchRoom;
    setStatus(() => (g2.isDemo
      // The demo plays itself and any key begins the real game, which
      // is what `control_kid`'s own `key_test_quit()` does.
      ? words.demoLine
      : g2.awaitingButton
        ? `${label(v)} — ${words.againLine}`
        : room === null
          ? `${label(v)} — ${words.controls}`
          : `${label(v)}, ${words.roomN.replace('{n}', String(room))}`
            + ` — ${words.lookingLine}`));
  }


  /**
   * The cheats, which the original turns on from the command line.
   *
   * There is no command line here, so the word is typed instead: the
   * letters of it in a row, anywhere, and the keys below wake up.
   */
  /**
   * The cheats are on.
   *
   * The original wants `prince megahit` on its command line. There is
   * no command line here, so there is nothing to type and nothing to
   * turn on: the keys below simply work.
   */
  const cheats = true;

  /** Which of the original's keys this is, as `process_key` names them. */
  function keyName(e: KeyboardEvent): string {
    const mod = (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '');
    const code = e.code;
    if (/^Key[A-Z]$/.test(code)) return mod + code.slice(3).toLowerCase();
    if (code === 'NumpadAdd' || code === 'Equal') return mod + '+';
    if (code === 'NumpadSubtract' || code === 'Minus') return mod + '-';
    if (code === 'Space') return mod + 'space';
    if (code === 'Escape') return mod + 'escape';
    if (code === 'Enter' || code === 'NumpadEnter') return mod + 'enter';
    return mod + code.toLowerCase();
  }

  /**
   * `process_key`, less what belongs to a DOS machine.
   *
   * Quitting, saving to disc, the joystick and redefining the keys are
   * the four it cannot do; Ctrl+J answers the way the original does
   * when it looks for a joystick and finds none. Everything else is
   * here, including the cheats, each against the case of the C's
   * switch it stands for.
   *
   * Returns true when the key was one of these, so that it is not also
   * read as a direction.
   */
  function command(e: KeyboardEvent): boolean {
    return commandKey(keyName(e));
  }

  /**
   * The same, by the key's name rather than by an event.
   *
   * `tools/dev/page-port.ts` drives the cheats through this, so that
   * what it compares with the headless port is the page's **own**
   * path to `game.cheat` and not a second copy of the switch.
   */
  function commandKey(key: string): boolean {
    if (!game) return false;
    switch (key) {
      case 'space': game.showTime(); return true;
      case 'escape': case 'shift+escape': game.paused = true; return true;
      case 'ctrl+a': game.restartLevel(); return true;
      case 'ctrl+r': void changeScene(restartGame); return true;
      case 'ctrl+s':
        if (sound) sound.muted = !sound.muted;
        game.say(sound && !sound.muted ? 'SOUND ON' : 'SOUND OFF');
        return true;
      case 'ctrl+k': game.say('KEYBOARD MODE'); return true;
      case 'ctrl+j': game.say('JOYSTICK NOT FOUND'); return true;
      case 'ctrl+v': game.say('PRINCE OF PERSIA  V1.0'); return true;
      case 'shift+l':
        if (!game.skipLevel(cheats)) return true;
        return true;
      default: break;
    }
    if (!cheats) return false;
    switch (key) {
      /**
       * Every one of these goes through `cheat()`, not through the
       * method behind it, because `process_key` runs **inside** the
       * tick and not before it.
       *
       * The chain is `play_level_2` -> `play_frame` ->
       * `play_kid_frame` -> `control_kid` -> `do_paused`, and
       * `play_level_2` clears `guardhp_delta` and `hitp_delta`
       * immediately before `play_frame`. A cheat called here, on the
       * key event, is on the wrong side of that clearing: K, Shift+S
       * and Shift+T each set a delta that the very next `step` wiped
       * before anything read it, so none of the three did anything to
       * the bar in the game the player plays. `addlife2` scored 60 of
       * 191 against the original for exactly that and `killguard6`
       * 179 of 299; queued, they are 188 and **299, exact**.
       *
       * `cheat()` queues and `step()` drains the queue where the C
       * reads the key, so the browser and the oracle's replay now run
       * the identical path. H, J, U, N and Ctrl+B stay below, because
       * the shell's look-around holds a room across ticks, which is
       * more than `process_key` does.
       */
      case 'c': case 'shift+c': case '+': case '-':
      case 'r': case 'k': case 'shift+i': case 'shift+w':
      case 'shift+b': case 'shift+s': case 'shift+t':
        game.cheat(key); return true;
      case 'h': watchRoom = game.roomLeft; return true;
      case 'j': watchRoom = game.roomRight; return true;
      case 'u': watchRoom = game.roomAbove; return true;
      case 'n': watchRoom = game.roomBelow; return true;
      case 'ctrl+b': watchRoom = game.kid.room; return true;
      default: return false;
    }
  }

  /**
   * Which of the four keys `input_str` acts on this is.
   *
   * The C reads a scancode from `key_test_quit()` and a character
   * from `last_text_input`; these are the scancodes it tests for.
   */
  function textInputKey(e: KeyboardEvent): string {
    switch (e.code) {
      case 'Enter': case 'NumpadEnter': return 'enter';
      case 'Escape': return 'escape';
      case 'Backspace': return 'backspace';
      case 'Delete': return 'delete';
      default: return '';
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey) return; // leave the browser's own chords alone
    wakeSound();
    (document.activeElement as HTMLElement | null)?.blur?.();

    // The level is waiting for the scene's music; `do_paused` takes
    // any key, and the key is spent on ending the wait.
    if (soundWaitOver) { e.preventDefault(); soundWaitOver(); return; }

    /**
     * A scene is playing.
     *
     * `disable_keys` is set for the ending and for the hourglass, and
     * the original will not let a key past it; the title and the
     * between-level scenes it will. Escape stops any of them, which
     * is what `do_paused` does there.
     */
    if (cutscene?.running) {
      e.preventDefault();
      /**
       * Unless a name is being typed into the hall of fame.
       *
       * `input_str` has the keyboard then -- the C calls
       * `SDL_StartTextInput()` and spins on `key_test_quit()` -- so
       * every key goes to it, Escape included, which is what clears
       * the box there rather than what skips the scene.
       */
      if (cutscene.wantsText) {
        cutscene.pushKey(textInputKey(e), e.key.length === 1 ? e.key : '');
        return;
      }
      /**
       * `process_key` while `start_level < 0`: any key sets
       * `start_level = custom->first_level` and stops the title, so
       * the game begins at level 1 -- not at the demo the title
       * would otherwise have fallen into.
       */
      if (cutscene.skippable) {
        effects.stopSounds();
        cutscene.cancel();
        afterScene = null;
        void changeScene(async () => { await select(levelView(firstLevel)); });
        return;
      }
      /**
       * Any key, which is what the original takes.
       *
       * `do_paused` ends on `return key || control_shift`, so a
       * scancode or the shift key alone is enough, and
       * `proc_cutscene_frame` acts on it for every scene that has
       * not set `disable_keys` -- the six between the levels among
       * them. The shell took Escape and nothing else.
       *
       * The ending and the hourglass do set it, and the original
       * will not let a key past those; Escape still gets the player
       * out of them here, because a page is not a DOS box and there
       * is nowhere else to go.
       */
      if (!cutscene.keysDisabled || keyName(e) === 'escape') skipScene();
      return;
    }

    // Nothing is on but a title screen: any key begins the game, which
    // is what `process_key` does while `start_level < 0`.
    if (!game) {
      e.preventDefault();
      void changeScene(async () => {
        await select(levelView(firstLevel));
      });
      return;
    }

    /**
     * The demo is playing: any key begins the real game.
     *
     * `control_kid`'s demo half reads the keyboard itself --
     * `if (key) { start_level = custom->first_level; start_game(); }`
     * -- so no key of it is a cheat, a pause or a direction.
     */
    if (game.isDemo) {
      e.preventDefault();
      void changeScene(async () => { await select(levelView(firstLevel)); });
      return;
    }

    /**
     * `do_paused`: while it is paused the game waits for a key, any key.
     *
     *     is_paused = 0;
     *     do { idle(); delay_ticks(1); } while (! process_key());
     *     erase_bottom_text(1);
     *
     * `is_paused` is cleared **before** the wait and the key that
     * ends it is itself put through `process_key` -- whose Escape
     * case sets `is_paused` straight back to 1. So Escape advances
     * the game by exactly one tick and pauses again, and any other
     * key resumes play. The page used to swallow the key here, so
     * Escape resumed like everything else and the original's frame
     * advance was missing.
     *
     * It does not return: the key goes on through the page's own
     * `process_key` below, and an arrow that ended the pause is
     * held in the tick that follows, as `read_user_control` reads it.
     */
    if (game.paused) {
      e.preventDefault();
      game.paused = false;
      stepOnce = true;
    }

    /**
     * After a death, any key begins the level again.
     *
     * The C takes Shift or Enter -- `if (rem_min != 0 && Kid.alive > 6
     * && (control_shift || key == SDL_SCANCODE_RETURN)) key = Ctrl+A`
     * -- and a player who does not know that is left pressing arrows
     * at a dead Prince. Any key here.
     */
    if (game.awaitingButton) { e.preventDefault(); game.pressButton(); return; }

    if (command(e)) { e.preventDefault(); return; }

    const dirs = directionsOf(e);
    if (dirs === null) return;
    // Taken, so that a key meant for the game never reaches the page
    // and scrolls it instead.
    e.preventDefault();
    for (const d of dirs) { held.add(d); pressedSinceStep.add(d); }
    recorder.key('down', e.code);
    if (watchRoom !== null) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
    if (dirs.includes('shift')) game.pressButton();
  });
  window.addEventListener('keyup', (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    for (const d of dirs) held.delete(d);
    recorder.key('up', e.code);
  });
  window.addEventListener('blur', () => { held.clear(); pressedSinceStep.clear(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) held.clear();
  });

  // Touch controls, for playing without a keyboard.
  const w0 = window as unknown as Record<string, unknown>;
  /** The on-screen pad names its buttons after keys; translate them. */
  const PAD_DIRECTION: Record<string, string> = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    Shift: 'shift',
  };
  w0.__princeHold = (key: string, down: boolean): void => {
    const d = PAD_DIRECTION[key] ?? key;
    if (down) { held.add(d); pressedSinceStep.add(d); }
    else held.delete(d);
    recorder.key(down ? 'down' : 'up', key);
    if (down && d === 'shift') game?.pressButton();
    if (down) wakeSound();
    if (down && watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  };

  /**
   * One scene change at a time.
   *
   * `frame()` runs twelve times a second, and both the ways out of a
   * level have to await the next scene's data. Until that resolves the
   * finished game is still there and still says it is finished, so
   * every frame in between started another change -- and three of them
   * in a row is how the player went out of the door on level 2 and
   * arrived on level 5.
   *
   * Nothing is drawn while it is held, because `game` is the old one
   * and its level is over.
   */
  async function changeScene(what: () => Promise<void>): Promise<void> {
    if (changing) return;
    changing = true;
    try {
      await what();
    } finally {
      changing = false;
    }
  }

  /**
   * Out of the door and on to the next one, carrying what the Prince has
   * earned: the hour does not start again, and nor does he put the sword
   * back where he found it.
   */
  async function nextLevel(): Promise<void> {
    if (!game) return;
    const v = views[current];
    const was = v.kind === 'level' ? v.level : 1;
    const carried = {
      ticks: game.remainingTicks,
      sword: game.hasSword,
      // The flasks he has found.
      //
      // `add_life` raises `hitp_max` and leaves `hitp_beg_lev` alone --
      // which is what the C does too -- and `start_level` sets
      // `hitp_max` back from `hitp_beg_lev` on the next level. So the
      // number to carry is the one he is playing with, not the one the
      // level began with, and carrying the latter is why the first
      // attempt at this changed nothing.
      lives: game.maxHitPoints,
      // `seamless`: level 12 is left at a run through room 23, and
      // level 13 then does not announce itself and does not give him
      // a fresh set of flasks. In the C both of those are globals
      // that simply survive `start_level`; here each level is a new
      // `PopGame`, so they are handed across.
      seamless: game.seamlessExit,
      hp: game.hitPoints,
    };
    held.clear();
    const level = was + 1;
    const next = views.findIndex((x) => x.kind === 'level' && x.level === level);
    // Out of the last level: the game is over, which is the ending.
    if (next < 0) { await playScene({ kind: 'ending' }, restartGame); return; }

    const arrive = async (): Promise<void> => {
      /**
       * `play_level`, between the scene and `draw_level_first`:
       *
       *     while (check_sound_playing() && !do_paused()) idle();
       *     stop_sounds();
       *
       * The scene's tune is let finish -- and any key ends the wait,
       * which is what `do_paused` is doing in that line. Off a fresh
       * capture of `PRINCE.EXE`, the original's own black screen
       * between the princess's room and level 2 runs from 36.0 to
       * 39.5 seconds, and this is it.
       */
      await waitForSound();
      await select(next, { seamless: carried.seamless });
      if (!game) return;
      game.remainingTicks = carried.ticks;
      game.hasSword = carried.sword || game.hasSword;
      game.beginningHitPoints = carried.lives;
      if (carried.seamless) game.carryHitPoints(carried.hp, carried.lives);
      watchRoom = null;
    };

    /**
     * `play_level`: the scene before the level, if the level has one.
     *
     *     cutscene_func = tbl_cutscenes[level_number];
     *     if (cutscene_func != NULL) load_intro(level_number > 2, cutscene_func, 1);
     *
     * It is played before the level is loaded and with the clock the
     * level just finished left in `rem_min`, which is what
     * `hourglass_frame` reads to decide how much sand is left.
     */
    if (CutscenePlayer.hasCutsceneFor(level)) {
      await playScene({ kind: 'level', level }, arrive);
      return;
    }
    await arrive();
  }

  /** The index of a level in `views`. */
  const levelView = (level: number): number =>
    views.findIndex((v) => v.kind === 'level' && v.level === level);

  /**
   * `start_level = -1; start_game()`, which is `show_title()`.
   *
   * The opening titles, the story of Jaffar and the princess, and the
   * credits -- and then `init_game(0)`, which is where `show_title`
   * ends: the demo level, which plays itself from the timeline in the
   * executable and comes back round to the title. So the page loops
   * the way the original's does, and a key breaks out of either half
   * into the real game -- which is `do_paused` while `start_level < 0`
   * for the title, and `control_kid`'s own `key_test_quit()` for the
   * demo.
   */
  async function restartGame(): Promise<void> {
    held.clear();
    await playScene({ kind: 'title' }, startDemo);
  }

  /** `init_game(0)`, the last line of `show_title`. */
  async function startDemo(): Promise<void> {
    held.clear();
    await select(levelView(0));
  }

  /** Start the level again, as the original does after a death. */
  async function restart(): Promise<void> {
    if (!game) return;
    held.clear();
    // `play_level`'s loop comes back round here too, so the death
    // music is let finish and then stopped rather than being left to
    // hold the channel through the first seconds of the level again.
    await waitForSound();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }

  /** Hand the player a file, without leaving the page. */
  function download(name: string, text: string, type: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    // In the document, and the url let go of only afterwards: revoking it
    // in the same breath as the click cancels the download in some
    // browsers before it has begun.
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
  }

  /**
   * Recording: one button.
   *
   * Starting it begins the level again, so that a recording always starts
   * where the level does and a replay of it lines up exactly. **Stopping
   * it writes the file**, which is why there is no save button beside it:
   * a recording that has been stopped and not saved is a recording that
   * has been lost, and the player had to know to press a second button.
   */
  function toggleRecording(): boolean {
    if (recorder.on) {
      recorder.stop();
      if (recorder.ticks.length) {
        const when = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        download(`prince-keys-level${recorder.level}-${when}.json`,
                 recorder.toJson(), 'application/json');
      }
      return false;
    }
    if (!game) return false;
    void (async (): Promise<void> => {
      await changeScene(restart);
      recorder.start();
    })();
    return true;
  }

  /**
   * Saving a game, and loading one back.
   *
   * The snapshot is SDLPoP's `quick_save` field for field (see
   * `web/savegame.ts`). Loading starts the saved level afresh -- which
   * runs the whole loader, as `restore_room_after_quick_load`'s
   * `load_lev_spr` does -- and then writes the saved state over it.
   */
  function saveGame(slot: number): boolean {
    if (!game) return false;
    return writeSlot(slot, snapshot());
  }

  async function loadGame(slot: number): Promise<boolean> {
    const save: SaveGame | null = readSlot(slot);
    if (!save) return false;
    await changeScene(async () => {
      const index = views.findIndex(
        (v) => v.kind === 'level' && v.level === save.level,
      );
      if (index < 0) return;
      await select(index);
      restore(save);
      held.clear();
      pressedSinceStep.clear();
      /**
       * `different_room = 1; draw_game_frame();` -- the room drawn
       * whole, which is the last thing
       * `restore_room_after_quick_load` does.
       *
       * `drawRoomNow`'s own `check_the_end` is a no-op here and that
       * matters: the C's `if (next_room != 0 && next_room !=
       * drawn_room)` is false because `restore` has just made them
       * equal, so the guard that was loaded out of the save is not
       * thrown away and entered again.
       */
      game?.drawRoomNow(game.kid.room);
    });
    return true;
  }

  /**
   * **The opening does not begin until the page can make a noise.**
   *
   * A browser will not let a page sound before the player has touched
   * it, and `show_title` is the first thing the page does -- so every
   * sound and every tune of the opening was dropped by
   * `SoundPlayer.play`'s `if (!this.woken) return`, on every page
   * load, for as long as there has been sound here. The title the
   * `sound-report` scores at 212 notes of 212 was being played to
   * nobody.
   *
   * And it was worse than silence. `show_title` stops dead at
   * `while (check_sound_playing())` three times over, and with
   * nothing in the channel all three fell through at once: the
   * opening ran at the wrong speed as well as mute.
   *
   * So the page holds on the game's own black screen until the
   * context is allowed to run -- which it may already be, because a
   * browser remembers a site the player has used before, and because
   * `--autoplay-policy=no-user-gesture-required` says so. When it is
   * not, the first key or tap wakes it and is **spent** on that; the
   * original's "any key begins the game" starts from the frame after.
   */
  /**
   * Resolved by the Begin button of the opening settings page, which
   * is a gesture like any other and lets the page sound.
   */
  let beganFromOpening: (() => void) | null = null;
  const openingGesture = new Promise<void>((resolve) => {
    beganFromOpening = resolve;
  });

  async function waitUntilThePageCanSound(): Promise<void> {
    // `wakeSound` builds the context and starts a `resume()`, which
    // is **not** waited for: a blocked `AudioContext.resume()` leaves
    // its promise pending until the page is touched, so awaiting it
    // here would hang before the prompt was ever drawn. The state is
    // read instead, which is synchronous and says the same thing.
    wakeSound();
    if (!sound || sound.awake) return;
    display.present(titleSurface, titlePalette.toRgba());
    setStatus(() => words.pressAnyKey);
    (window as unknown as Record<string, unknown>).__princeWaitingForSound = true;
    await new Promise<void>((resolve) => {
      const go = (e: Event): void => {
        e.preventDefault();
        e.stopPropagation();
        off();
        wakeSound();
        void sound?.wake().then(resolve, resolve);
      };
      const off = (): void => {
        window.removeEventListener('keydown', go, true);
        window.removeEventListener('pointerdown', go, true);
      };
      window.addEventListener('keydown', go, true);
      window.addEventListener('pointerdown', go, true);
      /**
       * The Begin button of the opening settings page is the gesture
       * the player actually makes, and the overlay is over everything,
       * so a key or a tap is the fallback and not the usual way in.
       * Its own handler calls `wakeSound` before this resolves.
       */
      void openingGesture.then(() => {
        off();
        void sound?.wake().then(resolve, resolve);
      });
    });
    (window as unknown as Record<string, unknown>).__princeWaitingForSound = false;
  }

  /**
   * The original steps the game twelve times a second. Driving that from the
   * display's own refresh, with a running account of the time owed, keeps the
   * steps evenly spaced; a plain interval drifts and the running stutters.
   */
  const STEP_MS = 1000 / FRAMES_PER_SECOND;
  /**
   * Set by `__princePause`, for tests that drive the game through
   * `__princeStep`. Without it the loop keeps stepping between a test's
   * own calls, on the machine's clock rather than the test's, and nothing
   * driven through the hook is reproducible.
   */
  let paused = false;
  let owed = 0;
  let last = performance.now();
  function tick(now: number): void {
    requestAnimationFrame(tick);
    // `remove_flash`, a sixtieth of a second after `do_flash` put it
    // up: the animation frame after the one the flash was drawn on.
    takeFlashDown(now);
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS; // came back from a pause
    if (paused) { owed = 0; return; }
    // `while (check_sound_playing() && !do_paused()) idle();`
    if (soundWaitOver) {
      owed = 0;
      if (!effects.soundPlaying() || now > soundWaitUntil) soundWaitOver();
      return;
    }
    // A scene runs on its own clock: `cutscene_frame_time` is six
    // sixtieths of a second where the game's tick is five, and the
    // waits between the title's pictures are counted in sixtieths too.
    if (sceneFrame(Math.min(owed, STEP_MS * 5))) { owed = 0; return; }
    while (owed >= STEP_MS) {
      owed -= STEP_MS;
      frame();
    }
  }
  requestAnimationFrame(tick);

  // Hooks for the browser-level comparison tests.
  const w = window as unknown as Record<string, unknown>;
  w.__princeFrame = (id?: string) => {
    if (id === 'title-background') {
      drawTitle(title);
      return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    }
    // While a scene is playing it is what is on the screen.
    if (cutscene?.running) {
      return Array.from(cutscene.render().toRgb(cutscene.palette.toRgba()));
    }
    if (!game) return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    return Array.from(game.render().toRgb(game.scene.screenPalette.toRgba()));
  };
  w.__princeShow = async (level: number, room: number) => {
    await select(views.findIndex((v) => v.kind === 'level' && v.level === level));
    watchRoom = room;
    if (game) game.drawRoomNow(room);
    frame();
  };
  /**
   * A level entered exactly as `select` does, and no more.
   *
   * `__princeShow` is a **look**: it also forces `drawn_room` through
   * `drawRoomNow`, which runs `check_the_end` a second time and is a
   * state change the headless port has not made. A page driven
   * through it cannot be compared with `src/pop` tick for tick, so
   * `tools/dev/page-port.ts` comes in this way instead -- the same
   * `PopGame.start(assets, exe, level, { effects })` the headless
   * side calls, and nothing after it.
   */
  w.__princeEnterLevel = async (level: number): Promise<void> => {
    // And no `frame()` after it, which `__princeShow` does: `frame` is
    // the page's tick -- it calls `game.step` and `game.render` -- so
    // a comparison that began with one would be a tick ahead of the
    // headless port before it had started.
    await select(views.findIndex((v) => v.kind === 'level' && v.level === level));
  };
  /**
   * `hash` asks for a fingerprint of **the picture that was just
   * presented**.
   *
   * A caller that wants one must not call `__princeFrame()` for it:
   * that is `game.render()` a second time, and `render` is
   * `draw_game_frame` -- it ticks the words under the room, takes the
   * flash off, and calls `play_next_sound`. So the hash is taken here,
   * off the very surface the display was given, and only when it is
   * asked for, because hashing 192000 bytes a tick is not something
   * the page's own loop or a fuzz run should pay for.
   */
  w.__princeStep = (n: number, c: Partial<Controls> = {}, hash = false) => {
    if (!game || changing || building > 0) return null;
    watchRoom = null;
    for (let i = 0; i < n; i++) game.step({ x: 0, y: 0, shift: false, ...c });
    // `render()` first and the palette after it, in that order:
    // `draw_game_frame` is where `flash()` puts the colour up, so a
    // palette read before it is the palette of the tick before.
    const surface = game.render();
    const rgba = game.scene.screenPalette.toRgba();
    display.present(surface, rgba);
    if (!hash) return { ...game.kid };
    const rgb = surface.toRgb(rgba);
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return { ...game.kid, hash: h >>> 0 };
  };
  /**
   * One tick, and the level begun again if the Prince's death has
   * asked for it.
   *
   * `__princeStep` is the loop's `frame()` with the restart left out,
   * because a test that drives it is paused and the restart lives in
   * the loop: `if (game.restartDue) { void changeScene(restart);
   * return; }`, which is `play_level_2` returning `current_level` and
   * `play_level` building it again. So a page stepped through
   * `__princeStep` plays straight on past a death with `restartDue`
   * stuck true, and the one path a player meets more than any other
   * -- die, press a key, start the level again -- could not be put
   * beside the headless port at all.
   *
   * This is the loop's own order: step, restart if it is due, and
   * only then draw. `digest-common.ts`'s `runOf` does exactly that,
   * so the two sides number their ticks the same way.
   */
  w.__princeStepRestarting = async (c: Partial<Controls> = {}):
  Promise<{ hash: number; restarted: boolean } | null> => {
    if (!game || changing || building > 0) return null;
    watchRoom = null;
    game.step({ x: 0, y: 0, shift: false, ...c });
    let restarted = false;
    if (game.restartDue) {
      restarted = true;
      await changeScene(restart);
      if (!game) return null;
    }
    const surface = game.render();
    const rgba = game.scene.screenPalette.toRgba();
    display.present(surface, rgba);
    const rgb = surface.toRgb(rgba);
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return { hash: h >>> 0, restarted };
  };
  /** Every `play_sound` the byte-code has made; see `asked`. */
  w.__princeAsked = (): { tick: number; which: number }[] => [...asked];
  /**
   * `random_seed`, for `tools/dev/page-port.ts`.
   *
   * The princess room's stars twinkle out of `prandom`, so two runs
   * of a scene draw different pictures however right both are. The
   * page has played a title and some levels by the time it is asked
   * for a scene and the headless port has not, so the comparison
   * gives both the same seed.
   */
  w.__princeSeed = (n: number): void => { setSeed(n); };
  /** `process_key` by name: the page's own cheat path. */
  w.__princeCommand = (key: string): boolean => commandKey(key);
  w.__princePause = (on: boolean): void => { paused = on; };
  /**
   * The cutscenes, for the browser tests: start one, run its clock by
   * hand, and read back what it is doing.
   */
  w.__princePlayScene = async (scene: SceneName): Promise<void> => {
    await playScene(scene, restartGame);
  };
  w.__princeSceneStep = (ms: number): boolean => sceneFrame(ms);
  /**
   * A fingerprint of the picture a scene has on the screen.
   *
   * `CutscenePlayer.render()` hands back the surface the generator
   * has already drawn on -- it draws nothing itself -- so unlike
   * `__princeFrame` for a level this can be asked for at any time
   * without changing what it measures. `tools/dev/page-port.ts`
   * compares the page's scenes with the headless port's by it.
   */
  w.__princeSceneHash = (): number | null => {
    if (!cutscene) return null;
    const rgb = cutscene.render().toRgb(cutscene.palette.toRgba());
    // The six stars and the two torches come out of `prandom`
    // and no two runs draw them alike, so they are blanked here
    // exactly as the digest's mask blanks them against the
    // original. See `PROOM_RANDOM_RECTS`.
    for (const [x, y] of PROOM_RANDOM_PIXELS) {
      const at = (y * 320 + x) * 3;
      rgb[at] = 0; rgb[at + 1] = 0; rgb[at + 2] = 0;
    }
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    return h >>> 0;
  };
  w.__princeSceneState = () => (cutscene ? {
    running: cutscene.running,
    /** How many scenes have been begun; see `sceneCount`. */
    count: sceneCount,
    playing: cutscene.playing,
    /** `input_str` has the keyboard: the hall of fame is asking for a name. */
    wantsText: cutscene.wantsText,
    /** How many of the screen's pixels are not black. */
    lit: cutscene.render().pixels.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0),
  } : null);
  w.__princeState = () => (game ? {
    // How many ticks the page has played. A test that has to wait for
    // the game rather than for the clock waits on this: under load the
    // wall clock and the game's own time come apart, and three of the
    // browser tests used to fail for that and nothing else.
    ticks: ticksPlayed,
    frame: game.kid.frame, room: game.kid.room, x: game.kid.x, y: game.kid.y,
    hitPoints: game.hitPoints, dead: game.isDead, held: [...held].sort(),
    awaitingButton: game.awaitingButton, level: w0Level(),
    /** `current_level == 0`: the attract-mode level is playing itself. */
    demo: game.isDemo,
    /** `is_paused`, which `do_paused` leaves set between single steps. */
    paused: game.paused,
    /** The colour `do_flash` is owed after this tick's picture. */
    flashColour: game.flashColour,
    /** `is_feather_fall`, which `potion.html` shows while it lasts. */
    featherFall: game.isFeatherFall,
    upsideDown: game.upsideDown,
    maxHitPoints: game.maxHitPoints,
    sword: game.kid.sword,
    guard: game.guard.direction === NO_GUARD ? null : {
      frame: game.guard.frame, x: game.guard.x,
      hitPoints: game.guard.hitPoints, alive: game.guard.alive,
    },
  } : null);
  /** For the page's own hot-reload, which keeps the level across a republish. */
  w.__princeGoToLevel = (level: number): void => {
    const at = views.findIndex((v) => v.kind === 'level' && v.level === level);
    if (at >= 0) void changeScene(() => select(at));
  };
  w.__princeLevel = () => (views[current].kind === 'level'
    ? (views[current] as { level: number }).level : 0);
  /**
   * Silence, for a test that drives a scene faster than the clock.
   *
   * `show_title` stops at `while (check_sound_playing())` three
   * times, and `__princeSceneStep` runs the scene's clock a hundred
   * and fifty times faster than the wall clock the audio keeps -- so
   * a driven scene now waits for ever where it used to fall straight
   * through, because until this round the page never made a sound at
   * all. A test that drives has to mute.
   */
  w.__princeMute = (on: boolean): void => { if (sound) sound.muted = on; };
  /**
   * Which of the game's sounds this browser will not read.
   *
   * `SoundPlayer.read` catches whatever the decoding throws and
   * writes the sound down as "neither a recording nor a tune", after
   * which every `play` of it returns on one line and the player hears
   * nothing. That is how the exit door was lost for the whole life of
   * the page -- `sound_15_leveldoor_sliding` is recorded at 2750 Hz
   * and Chromium's `createBuffer` throws under 3000 -- and no
   * measurement this project takes outside a browser could see it,
   * because none of them goes through `AudioContext`. So the page can
   * now be asked, and `tests/browser/every-sound-reads.test.ts` asks
   * it: every index of the game must come back readable.
   */
  w.__princeSoundFailures = async (): Promise<[number, string][]> => {
    wakeSound();
    await sound?.preloadAll(Array.from({ length: 58 }, (_, i) => i));
    return sound ? [...sound.failed.entries()] : [];
  };
  /**
   * The sounds that really reached the channel, newest last, by
   * index. `tools/dev/page-walk.ts` reads it to say what was heard
   * where.
   */
  w.__princeHeard = (): number[] => (sound ? [...sound.started] : []);
  /**
   * Which release's sound tables the page has put in force.
   *
   * The tables live in the renderer and are read by the engine through
   * `soundPriority`, so there is nothing on the game to look at; this
   * is how a browser test can see that the setting reached them.
   */
  w.__princeSoundRelease = (): string => soundRelease();
  /** Play one sound through the page's own channel, by index. */
  w.__princePlaySound = (which: number): void => {
    wakeSound();
    sound?.stop();
    sound?.play(which);
  };
  void RoomRenderer;

  /**
   * The page around the game: the opening settings page, the title in
   * one margin and the two panels in the other.
   *
   * The opening page does **not** hold the game up. It is an overlay
   * over a title screen that is already running, and Begin takes it
   * away -- which also counts as the gesture a browser wants before a
   * page may sound, so the player's first click does two things at
   * once instead of asking them to press a key as well.
   */
  /**
   * The language or the quality moved while the game was on the screen.
   *
   * The words the game draws are put on the screen once, by
   * `display_text_bottom` or by a story screen, and they stay there
   * until something paints over them -- so without this a player who
   * chose Hebrew went on reading `60 MINUTES LEFT` in English until
   * the next thing the game had to say. Nothing is stepped: the
   * surface is drawn into again and the picture that was last shown is
   * shown again, so the change costs the game no tick.
   */
  function relabelTheGame(): void {
    gameText.clearOverlay();
    /**
     * Whichever of the two is **on the screen**, and only that one.
     *
     * A page that has played its title still has a `CutscenePlayer`
     * with the last scene's picture in it long after the level has
     * started, so presenting both put a stale scene over the game.
     */
    if (cutscene?.running) {
      cutscene.refreshText();
      display.present(cutscene.render(), cutscene.palette.toRgba());
      return;
    }
    if (game) {
      game.refreshText();
      if (lastShown) display.present(lastShown, game.scene.screenPalette.toRgba());
    }
  }

  const chrome = new Chrome(settings, {
    begin: () => {
      wakeSound();
      beganFromOpening?.();
    },
    aspect: (value) => display.setAspect(value),
    language: (value) => {
      gameText.language = value;
      words = stringsFor(value);
      status.textContent = sayStatus();
      relabelTheGame();
    },
    quality: (value) => {
      gameText.quality = value;
      // The words, the picture and the sound are three answers to
      // the same setting: the words get a vector face on a second
      // canvas, the picture gets more pixels of its own art, and the
      // tunes get the shape the hardware's voice had.
      display.setQuality(value);
      if (value === 'high') prefetchKid();
      if (sound) sound.quality = value;
      relabelTheGame();
    },
    music: (value) => {
      // Which sound wins a tick, not which voice plays it: the tables
      // live in the renderer and the engine reads them through
      // `soundPriority`, so nothing in `src/pop` learns of the choice.
      setSoundRelease(value === '1.3' ? '1.3' : '1.0');
    },
    toggleRecording,
    save: (slot) => {
      const ok = saveGame(slot);
      chrome.buildSlots();
      chrome.note(ok ? chrome.strings.saved : chrome.strings.noSave);
    },
    load: (slot) => {
      void loadGame(slot).then((ok) => {
        chrome.note(ok ? chrome.strings.loaded : chrome.strings.noSave);
      });
    },
  });
  // The potion room is reached by its own link and is not a game to be
  // set up, so it opens straight onto the corridor.
  if (POTION_PAGE) chrome.dismissOpening();
  w.__princeDismissOpening = (): void => chrome.dismissOpening();
  w.__princeSettings = (): Record<string, string> => ({ ...settings.all });

  /**
   * The hooks are in place, and the opening is the last thing.
   *
   * `__princeReady` is set **after** it, because that is what it has
   * always meant to the browser tests: the page is up and the title
   * is running. A test that wants to watch the page wait for a
   * gesture watches `__princeWaitingForSound` instead.
   */
  await waitUntilThePageCanSound();
  if (POTION_PAGE) await select(levelView(POTION_LEVEL_NUMBER));
  else await restartGame();
  w.__princeReady = true;
}

boot().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
