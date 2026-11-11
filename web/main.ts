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
import { SoundPlayer } from '../src/render/audio.ts';
import { SOUND } from '../src/game/traps.ts';
import { SEQUENCE_SOUND, SOUND_SILENCE } from '../src/game/sequence.ts';
import type { Controls } from '../src/game/kid.ts';

const DATA_URL =
  (window as unknown as { __princeDataUrl?: string }).__princeDataUrl
  ?? '../original/prince1';
/** The original ran its game loop at this rate. */
const FRAMES_PER_SECOND = 12;

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const aspectSel = document.getElementById('aspect') as HTMLSelectElement | null;
  const status = document.getElementById('status') as HTMLElement;

  const display = new Display(canvas);
  // A host that cannot serve the game's own file types can supply the files
  // another way; the page provides a fetcher and this uses it.
  const custom = (window as unknown as {
    __princeFetcher?: (name: string) => Promise<Uint8Array>;
  }).__princeFetcher;
  const fetchFile = custom ?? browserFetcher(DATA_URL);
  const assets = new Assets(fetchFile);
  const exe = await fetchFile('UNCRKD.EXE');

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
  const effects = {
    sound: (which: number) => sound?.play(which),
    stopSounds: () => sound?.stop(),
    soundPlaying: () => sound?.isPlaying ?? false,
  };

  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group('TITLE.DAT', 50);
  const opening = await assets.group('TITLE.DAT', 40);

  type View = { kind: 'title' | 'opening' } | { kind: 'level'; level: number };
  const views: View[] = [{ kind: 'title' }, { kind: 'opening' }];
  /** Ticks played since the page opened, for tests that wait on game time. */
  let ticksPlayed = 0;
  for (let n = 1; n <= 14; n++) views.push({ kind: 'level', level: n });
  const label = (v: View): string =>
    v.kind === 'level' ? `level ${v.level}` : `${v.kind} screen`;

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
  const CONTROLS = 'arrow keys or the numeric keypad to move, up to jump; '
    + 'hold shift to step carefully and to keep hold of a ledge, '
    + 'then up again to climb it';

  /** Which directions a key stands for. */
  function directionsOf(e: KeyboardEvent): string[] | null {
    switch (e.code) {
      case 'Numpad7': return ['left', 'up'];
      case 'Numpad8': return ['up'];
      case 'Numpad9': return ['right', 'up'];
      case 'Numpad4': return ['left'];
      case 'Numpad5': return [];
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

  async function select(index: number): Promise<void> {
    current = index;
    const v = views[current];
    if (v.kind !== 'level') {
      game = null;
      drawTitle(v.kind === 'title' ? title : opening);
      status.textContent = v.kind === 'title'
        ? 'press any key to begin'
        : 'the hour is up — press any key';
      return;
    }
    game = await Game.start(assets, exe, v.level, { effects });
    watchRoom = null;
  }

  /**
   * Recording what was pressed, so a session in a real browser can be
   * replayed in a test. The game is deterministic, so the input and the
   * level are enough to reproduce a session exactly; the states are kept
   * alongside so a replay can be checked against what the player saw, and
   * the raw key events so that a press acted on late can be found.
   */
  // Both pages have these, but a page without them should still run.
  const recordBtn = document.getElementById('record') as HTMLButtonElement | null;
  const saveBtn = document.getElementById('save') as HTMLButtonElement | null;

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
   * Shift+I turns the screen over.
   *
   * The original redraws the room the other way up; this turns the
   * finished picture over on its way to the canvas, which looks the
   * same and leaves the drawing -- and everything measured against a
   * capture -- alone.
   */
  const flipped = new Surface();
  function present(g: Game): void {
    const drawn = g.render();
    if (!g.upsideDown) { display.present(drawn, g.scene.screenPalette.toRgba()); return; }
    for (let y = 0; y < 200; y++) {
      flipped.pixels.set(drawn.pixels.subarray(y * 320, y * 320 + 320), (199 - y) * 320);
    }
    display.present(flipped, g.scene.screenPalette.toRgba());
  }

  /** Held while a scene change is in flight; see `changeScene`. */
  let changing = false;

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
    if (changing) return;
    // Esc: `do_paused` stops the game where it stands and leaves the
    // screen up until a key comes.
    if (game.paused) {
      present(game);
      status.textContent = 'paused — press any key';
      return;
    }
    if (watchRoom === null) {
      const c = controls();
      pressedSinceStep.clear();
      game.step(c);
      ticksPlayed++;
      recorder.tick(c, game);
      if (game.gameWon) {
        // The last room of the last level: the original plays its
        // ending here, and this is where the shell ends the game.
        void changeScene(() => select(1));
        return;
      }
      if (game.timeExpired) {
        // `expired()`: the hour is up, and the original goes back to
        // the title through the hourglass. The hourglass is a cutscene
        // this port does not have; the sound and the title are here.
        effects.sound?.(36); // `sound_36_out_of_time`
        void changeScene(restartGame);
        return;
      }
      if (game.restartDue) { void changeScene(restart); return; }
      if (game.levelFinished) { void changeScene(nextLevel); return; }
    } else if (game.drawnRoom !== watchRoom) {
      game.showRoom(watchRoom);
    }
    present(game);
    const v = views[current];
    status.textContent = game.awaitingButton
      ? `${label(v)} — press any key to begin the level again`
      : watchRoom === null
        ? `${label(v)} — ${CONTROLS}`
        : `${label(v)}, room ${watchRoom} — looking around; press a key to play`;
  }

  aspectSel?.addEventListener('change', () => {
    aspectSel.blur();
    display.setAspect(aspectSel.value as 'original-4-3' | 'square-pixels');
  });

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
    const key = keyName(e);
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
      case 'c': game.say(game.roomsAround); return true;
      case 'shift+c': game.say(game.roomsDiagonal); return true;
      case '+': game.addMinutes(1); return true;
      case '-': game.addMinutes(-1); return true;
      case 'r': game.resurrect(); return true;
      case 'k': game.killGuard(); return true;
      case 'shift+i': game.toggleUpsideDown(); return true;
      case 'shift+w': game.featherFall(); return true;
      case 'shift+b': game.toggleBlind(); return true;
      case 'shift+s': game.heal(); return true;
      case 'shift+t': game.addLife(); return true;
      case 'h': watchRoom = game.roomLeft; return true;
      case 'j': watchRoom = game.roomRight; return true;
      case 'u': watchRoom = game.roomAbove; return true;
      case 'n': watchRoom = game.roomBelow; return true;
      case 'ctrl+b': watchRoom = game.kid.room; return true;
      default: return false;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey) return; // leave the browser's own chords alone
    wakeSound();
    (document.activeElement as HTMLElement | null)?.blur?.();

    // Nothing is on but a title screen: any key begins the game, which
    // is what `process_key` does while `start_level < 0`.
    if (!game) {
      e.preventDefault();
      void changeScene(async () => {
        await select(views.findIndex((v) => v.kind === 'level' && v.level === 1));
      });
      return;
    }

    // `do_paused`: while it is paused the game waits for a key, any key.
    if (game.paused) { e.preventDefault(); game.paused = false; return; }

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
    if (dirs.length === 0) held.clear();
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
    };
    held.clear();
    const next = views.findIndex((x) => x.kind === 'level' && x.level === was + 1);
    // Out of the last level and the game is over: the screen the
    // original ends on, and then the title again.
    if (next < 0) { await select(1); return; }
    await select(next);
    if (!game) return;
    game.remainingTicks = carried.ticks;
    game.hasSword = carried.sword || game.hasSword;
    game.beginningHitPoints = carried.lives;
    watchRoom = null;
  }

  /** Ctrl+R: `start_level = -1; start_game()` -- back to the title. */
  async function restartGame(): Promise<void> {
    held.clear();
    await select(0);
  }

  /** Start the level again, as the original does after a death. */
  async function restart(): Promise<void> {
    if (!game) return;
    held.clear();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }

  // Recording: the level is started again first, so that a recording always
  // begins where the level does and a replay of it lines up exactly.
  recordBtn?.addEventListener('click', () => {
    void (async (): Promise<void> => {
      recordBtn.blur();
      if (recorder.on) {
        recorder.stop();
        recordBtn.textContent = 'record keys';
        if (saveBtn) saveBtn.disabled = recorder.ticks.length === 0;
        return;
      }
      if (!game) return;
      await changeScene(restart);
      recorder.start();
      recordBtn.textContent = 'stop recording';
      if (saveBtn) saveBtn.disabled = true;
    })();
  });

  saveBtn?.addEventListener('click', () => {
    saveBtn.blur();
    if (!recorder.ticks.length) return;
    const blob = new Blob([recorder.toJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const when = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `prince-keys-level${recorder.level}-${when}.json`;
    // In the document, and the url let go of only afterwards: revoking it
    // in the same breath as the click cancels the download in some
    // browsers before it has begun.
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 10000);
  });

  await select(0);

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
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS; // came back from a pause
    if (paused) { owed = 0; return; }
    let stepped = false;
    while (owed >= STEP_MS) {
      owed -= STEP_MS;
      frame();
      stepped = true;
    }
    if (!stepped && game && watchRoom !== null) frame();
  }
  requestAnimationFrame(tick);

  // Hooks for the browser-level comparison tests.
  const w = window as unknown as Record<string, unknown>;
  w.__princeFrame = (id?: string) => {
    if (id === 'title-background') {
      drawTitle(title);
      return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    }
    if (!game) return Array.from(titleSurface.toRgb(titlePalette.toRgba()));
    return Array.from(game.render().toRgb(game.scene.screenPalette.toRgba()));
  };
  w.__princeShow = async (level: number, room: number) => {
    await select(views.findIndex((v) => v.kind === 'level' && v.level === level));
    watchRoom = room;
    if (game) game.showRoom(room);
    frame();
  };
  w.__princeStep = (n: number, c: Partial<Controls> = {}) => {
    if (!game) return null;
    watchRoom = null;
    for (let i = 0; i < n; i++) game.step({ x: 0, y: 0, shift: false, ...c });
    display.present(game.render(), game.scene.screenPalette.toRgba());
    return { ...game.kid };
  };
  w.__princePause = (on: boolean): void => { paused = on; };
  w.__princeState = () => (game ? {
    // How many ticks the page has played. A test that has to wait for
    // the game rather than for the clock waits on this: under load the
    // wall clock and the game's own time come apart, and three of the
    // browser tests used to fail for that and nothing else.
    ticks: ticksPlayed,
    frame: game.kid.frame, room: game.kid.room, x: game.kid.x, y: game.kid.y,
    hitPoints: game.hitPoints, dead: game.isDead, held: [...held].sort(),
    awaitingButton: game.awaitingButton, level: w0Level(),
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
  w.__princeReady = true;
  void RoomRenderer;
}

boot().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
