/**
 * Browser entry point. Loads the original `.DAT` files and the original
 * executable, and plays with them.
 */
import { Assets, browserFetcher } from '../src/render/assets.ts';
import { Display } from '../src/render/display.ts';
import { Surface, ScreenPalette } from '../src/render/surface.ts';
import { RoomRenderer } from '../src/render/room.ts';
import { NO_DIRECTION as NO_GUARD } from '../src/game/guard.ts';
import { Game } from '../src/game/game.ts';
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
  const controls = (): Controls => ({
    x: (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0),
    y: (held.has('down') ? 1 : 0) - (held.has('up') ? 1 : 0),
    shift: held.has('shift'),
  });

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
    game = await Game.start(assets, exe, v.level);
    watchRoom = null;
    roomSel.value = String(game.drawnRoom);
  }

  function frame(): void {
    if (!game) return;
    if (watchRoom === null) {
      game.step(controls());
      if (roomSel.value !== String(game.drawnRoom)) roomSel.value = String(game.drawnRoom);
    } else if (game.drawnRoom !== watchRoom) {
      game.showRoom(watchRoom);
    }
    display.present(game.render(), game.scene.screenPalette.toRgba());
    const v = views[current];
    const type = game.scene.options.levelType ? 'palace' : 'dungeon';
    status.textContent = game.isDead
      ? `${label(v)} — you are dead; press any direction to begin again`
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
    for (const d of dirs) held.add(d);
    if (watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
    if (game?.isDead) void restart();
  });
  window.addEventListener('keyup', (e) => {
    const dirs = directionsOf(e);
    if (dirs === null) return;
    e.preventDefault();
    for (const d of dirs) held.delete(d);
  });
  window.addEventListener('blur', () => held.clear());
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
    if (down) held.add(d);
    else held.delete(d);
    if (down && game?.isDead) void restart();
    if (down && watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  };

  /** Start the level again, as the original does after a death. */
  async function restart(): Promise<void> {
    if (!game) return;
    held.clear();
    game = await game.restart(assets, exe);
    watchRoom = null;
  }

  await select(0);

  /**
   * The original steps the game twelve times a second. Driving that from the
   * display's own refresh, with a running account of the time owed, keeps the
   * steps evenly spaced; a plain interval drifts and the running stutters.
   */
  const STEP_MS = 1000 / FRAMES_PER_SECOND;
  let owed = 0;
  let last = performance.now();
  function tick(now: number): void {
    requestAnimationFrame(tick);
    owed += now - last;
    last = now;
    if (owed > STEP_MS * 5) owed = STEP_MS; // came back from a pause
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
