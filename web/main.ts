/**
 * Browser entry point. Loads the original `.DAT` files and the original
 * executable, and draws with them.
 */
import { Assets, browserFetcher } from '../src/render/assets.ts';
import { Display } from '../src/render/display.ts';
import { Surface, ScreenPalette } from '../src/render/surface.ts';
import { RoomRenderer } from '../src/render/room.ts';
import { buildLevelScene, type LevelScene } from '../src/game/scene.ts';
import { readExeTables } from '../src/game/exe-tables.ts';
import { placeCharacter, FRAME_STAND } from '../src/game/character.ts';
import { standX, standY } from '../src/game/geometry.ts';
import { parsePalette } from '../src/dat/palette.ts';

const DATA_URL = '../original/prince1';

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const sceneSel = document.getElementById('scene') as HTMLSelectElement;
  const roomSel = document.getElementById('room') as HTMLSelectElement;
  const aspectSel = document.getElementById('aspect') as HTMLSelectElement;
  const status = document.getElementById('status') as HTMLElement;

  const display = new Display(canvas);
  const surface = new Surface();
  const assets = new Assets(browserFetcher(DATA_URL));
  const exe = await assets.dat('UNCRKD.EXE').then(
    () => undefined,
    () => undefined,
  ).then(async () => new Uint8Array(
    await (await fetch(`${DATA_URL}/UNCRKD.EXE`)).arrayBuffer(),
  ));

  const tables = readExeTables(exe);
  const titlePalette = new ScreenPalette();
  const title = await assets.group('TITLE.DAT', 50);
  const opening = await assets.group('TITLE.DAT', 40);

  const scenes = new Map<string, LevelScene>();
  async function level(n: number): Promise<LevelScene> {
    let s = scenes.get(`L${n}`);
    if (!s) {
      s = await buildLevelScene(assets, exe, n);
      scenes.set(`L${n}`, s);
    }
    return s;
  }

  type View =
    | { kind: 'image'; label: string; group: typeof title; index: number }
    | { kind: 'room'; label: string; level: number };

  const views: View[] = [
    { kind: 'image', label: 'title screen', group: title, index: 1 },
    { kind: 'image', label: 'opening screen', group: opening, index: 1 },
  ];
  for (let n = 1; n <= 14; n++) {
    views.push({ kind: 'room', label: `level ${n}`, level: n });
  }

  for (const [i, v] of views.entries()) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = v.label;
    sceneSel.append(o);
  }

  let current = 0;
  let room = 1;

  async function render(): Promise<void> {
    const v = views[current];
    surface.clear();
    if (v.kind === 'image') {
      roomSel.disabled = true;
      titlePalette.loadBlock(0, v.group.palette.vga);
      surface.blitOpaque(v.group.images[v.index]!, 0, 0);
      display.present(surface, titlePalette.toRgba());
      status.textContent = `${v.label} — 320x200, drawn from the original data files`;
    } else {
      roomSel.disabled = false;
      const scene = await level(v.level);
      if (roomSel.options.length !== 24) {
        roomSel.replaceChildren();
        for (let r = 1; r <= 24; r++) {
          const o = document.createElement('option');
          o.value = String(r);
          o.textContent = `room ${r}`;
          roomSel.append(o);
        }
      }
      roomSel.value = String(room);
      const chars = [];
      if (room === scene.level.startRoom) {
        // Where the level says the Prince begins, after the half-tile turn
        // he performs on entering.
        const col = scene.level.startPos % 10;
        const row = Math.floor(scene.level.startPos / 10);
        const dir = scene.level.startDir;
        const draw = placeCharacter({
          x: standX(col) + (dir < 0 ? -7 : 7), y: standY(row),
          direction: dir, frame: FRAME_STAND,
          room, currentColumn: col, currentRow: row, charId: 0,
        }, tables.frameTableKid[FRAME_STAND]);
        if (draw) chars.push(draw);
      }
      new RoomRenderer(scene.chtabs, scene.tiles, scene.options).render(surface, room, chars);
      display.present(surface, scene.screenPalette.toRgba());
      const type = scene.options.levelType ? 'palace' : 'dungeon';
      status.textContent =
        `${v.label} (${type}), room ${room} — drawn from the original data and tables`;
    }
  }

  sceneSel.addEventListener('change', () => {
    current = Number(sceneSel.value);
    const v = views[current];
    if (v.kind === 'room') {
      void level(v.level).then((s) => { room = s.level.startRoom; void render(); });
    } else {
      void render();
    }
  });
  roomSel.addEventListener('change', () => { room = Number(roomSel.value); void render(); });
  aspectSel.addEventListener('change', () => {
    display.setAspect(aspectSel.value as 'original-4-3' | 'square-pixels');
  });

  await render();

  // Hook for the browser-level comparison tests.
  (window as unknown as Record<string, unknown>).__princeFrame = async (id?: string) => {
    if (id === 'title-background') {
      surface.clear();
      titlePalette.loadBlock(0, title.palette.vga);
      surface.blitOpaque(title.images[1]!, 0, 0);
      return Array.from(surface.toRgb(titlePalette.toRgba()));
    }
    await render();
    const v = views[current];
    const pal = v.kind === 'image' ? titlePalette : (await level(v.level)).screenPalette;
    return Array.from(surface.toRgb(pal.toRgba()));
  };
  (window as unknown as Record<string, unknown>).__princeShow = async (
    lvl: number, rm: number,
  ) => {
    current = views.findIndex((v) => v.kind === 'room' && v.level === lvl);
    room = rm;
    sceneSel.value = String(current);
    await render();
  };
  (window as unknown as Record<string, unknown>).__princeReady = true;
  void parsePalette;
}

boot().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
