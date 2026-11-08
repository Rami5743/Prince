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
  const sceneSel = document.getElementById('scene') as HTMLSelectElement;
  const roomSel = document.getElementById('room') as HTMLSelectElement;
  const aspectSel = document.getElementById('aspect') as HTMLSelectElement;
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
      void sound.preloadAll([
        ...Object.values(SOUND),
        ...SEQUENCE_SOUND.filter((i) => i !== SOUND_SILENCE),
      ]);
    }
    void sound.wake();
  };
  const effects = { sound: (which: number) => sound?.play(which) };

  const titlePalette = new ScreenPalette();
  const titleSurface = new Surface();
  const title = await assets.group('TITLE.DAT', 50);
  const opening = await assets.group('TITLE.DAT', 40);

  type View = { kind: 'title' | 'opening' } | { kind: 'level'; level: number };
  const views: View[] = [{ kind: 'title' }, { kind: 'opening' }];
  for (let n = 1; n <= 14; n++) views.push({ kind: 'level', level: n });
  const label = (v: View): string =>
    v.kind === 'level' ? `level ${v.level}` : `${v.kind} screen`;

  for (const [i, v] of views.entries()) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = label(v);
    sceneSel.append(o);
  }
  for (let r = 1; r <= 24; r++) {
    const o = document.createElement('option');
    o.value = String(r);
    o.textContent = `room ${r}`;
    roomSel.append(o);
  }

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
    sceneSel.value = String(current);
    const v = views[current];
    if (v.kind !== 'level') {
      game = null;
      roomSel.disabled = true;
      drawTitle(v.kind === 'title' ? title : opening);
      status.textContent = `${label(v)} — 320x200, drawn from the original data files`;
      return;
    }
    roomSel.disabled = false;
    game = await Game.start(assets, exe, v.level, { effects });
    watchRoom = null;
    roomSel.value = String(game.drawnRoom);
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

  function frame(): void {
    if (!game) return;
    if (watchRoom === null) {
      const c = controls();
      pressedSinceStep.clear();
      game.step(c);
      recorder.tick(c, game);
      if (game.restartDue) { void restart(); return; }
      if (game.levelFinished) { void nextLevel(); return; }
      if (roomSel.value !== String(game.drawnRoom)) roomSel.value = String(game.drawnRoom);
    } else if (game.drawnRoom !== watchRoom) {
      game.showRoom(watchRoom);
    }
    display.present(game.render(), game.scene.screenPalette.toRgba());
    const v = views[current];
    const type = game.scene.options.levelType ? 'palace' : 'dungeon';
    status.textContent = game.awaitingButton
      ? `${label(v)} — you are dead; press Shift to begin again`
      : watchRoom === null
        ? `${label(v)} (${type}) — ${CONTROLS}`
        : `${label(v)} (${type}), room ${watchRoom} — looking around; press a key to play`;
  }

  // Each menu gives the keyboard back once it has been used, so the next
  // arrow key goes to the game.
  sceneSel.addEventListener('change', () => {
    sceneSel.blur();
    void select(Number(sceneSel.value));
  });
  roomSel.addEventListener('change', () => {
    roomSel.blur();
    watchRoom = Number(roomSel.value);
  });
  aspectSel.addEventListener('change', () => {
    aspectSel.blur();
    display.setAspect(aspectSel.value as 'original-4-3' | 'square-pixels');
  });

  window.addEventListener('keydown', (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    // Taken, so that a key meant for the game never reaches the menus and
    // changes what is on screen instead.
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (dirs.length === 0) held.clear();
    for (const d of dirs) { held.add(d); pressedSinceStep.add(d); }
    recorder.key('down', e.code);
    if (watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
    // Shift is the original's `button`, and nothing but Shift continues
    // after a death -- the player in the recording pressed four
    // directions over ten seconds and the original ignored every one.
    if (dirs.includes('shift')) game?.pressButton();
    wakeSound();
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
   * Out of the door and on to the next one, carrying what the Prince has
   * earned: the hour does not start again, and nor does he put the sword
   * back where he found it.
   */
  async function nextLevel(): Promise<void> {
    if (!game) return;
    const v = views[current];
    const was = v.kind === 'level' ? v.level : 1;
    const next = views.findIndex((x) => x.kind === 'level' && x.level === was + 1);
    if (next < 0) return;
    const carried = { ticks: game.remainingTicks, sword: game.hasSword };
    held.clear();
    await select(next);
    if (!game) return;
    game.remainingTicks = carried.ticks;
    game.hasSword = carried.sword || game.hasSword;
    watchRoom = null;
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
      await restart();
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
    frame: game.kid.frame, room: game.kid.room, x: game.kid.x, y: game.kid.y,
    hitPoints: game.hitPoints, dead: game.isDead, held: [...held].sort(),
    sword: game.kid.sword,
    guard: game.guard.direction === NO_GUARD ? null : {
      frame: game.guard.frame, x: game.guard.x,
      hitPoints: game.guard.hitPoints, alive: game.guard.alive,
    },
  } : null);
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
