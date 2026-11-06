/**
 * Browser entry point. Loads the original `.DAT` files and the original
 * executable, and plays with them.
 */
import { Assets, browserFetcher } from '../src/render/assets.ts';
import { Display } from '../src/render/display.ts';
import { Surface, ScreenPalette } from '../src/render/surface.ts';
import { RoomRenderer } from '../src/render/room.ts';
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

  const held = new Set<string>();
  const controls = (): Controls => ({
    x: (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0),
    y: (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0),
    shift: held.has('Shift'),
  });

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
    status.textContent = watchRoom === null
      ? `${label(v)} (${type}) — arrow keys to move, shift to step`
      : `${label(v)} (${type}), room ${watchRoom} — looking around; press a key to play`;
  }

  sceneSel.addEventListener('change', () => void select(Number(sceneSel.value)));
  roomSel.addEventListener('change', () => {
    watchRoom = Number(roomSel.value);
  });
  aspectSel.addEventListener('change', () => {
    display.setAspect(aspectSel.value as 'original-4-3' | 'square-pixels');
  });

  const KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift']);
  window.addEventListener('keydown', (e) => {
    if (!KEYS.has(e.key)) return;
    e.preventDefault();
    held.add(e.key);
    if (watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (KEYS.has(e.key)) held.delete(e.key);
  });
  window.addEventListener('blur', () => held.clear());

  // Touch controls, for playing without a keyboard.
  const w0 = window as unknown as Record<string, unknown>;
  w0.__princeHold = (key: string, down: boolean): void => {
    if (down) held.add(key);
    else held.delete(key);
    if (down && watchRoom !== null && game) {
      watchRoom = null;
      game.drawnRoom = game.kid.room;
    }
  };

  await select(0);
  setInterval(frame, 1000 / FRAMES_PER_SECOND);

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
