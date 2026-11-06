/**
 * Browser entry point. Loads the original `.DAT` files and draws with them.
 */
import { Assets, browserFetcher } from '../src/render/assets.ts';
import { Display } from '../src/render/display.ts';
import { Surface } from '../src/render/surface.ts';
import { paletteToRgba } from '../src/dat/palette.ts';

const DATA_URL = '../original/prince1';

interface Scene {
  readonly id: string;
  readonly label: string;
  draw(surface: Surface): Uint8Array;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const sceneSel = document.getElementById('scene') as HTMLSelectElement;
  const aspectSel = document.getElementById('aspect') as HTMLSelectElement;
  const status = document.getElementById('status') as HTMLElement;

  const display = new Display(canvas);
  const surface = new Surface();
  const assets = new Assets(browserFetcher(DATA_URL));

  const opening = await assets.group('TITLE.DAT', 40);
  const title = await assets.group('TITLE.DAT', 50);

  const scenes: Scene[] = [
    {
      id: 'title-background',
      label: 'title screen background',
      draw(s) {
        const img = title.images[1]!;
        s.blitOpaque(img, 0, 0);
        return title.paletteRgba;
      },
    },
    {
      id: 'opening-background',
      label: 'opening screen background',
      draw(s) {
        s.blitOpaque(opening.images[1]!, 0, 0);
        return opening.paletteRgba;
      },
    },
  ];

  for (const sc of scenes) {
    const o = document.createElement('option');
    o.value = sc.id;
    o.textContent = sc.label;
    sceneSel.append(o);
  }

  let current = scenes[0];
  const render = (): void => {
    surface.clear();
    const pal = current.draw(surface);
    display.present(surface, pal);
    status.textContent = `${current.label} — 320x200, drawn from the original data files`;
  };

  sceneSel.addEventListener('change', () => {
    current = scenes.find((s) => s.id === sceneSel.value) ?? scenes[0];
    render();
  });
  aspectSel.addEventListener('change', () => {
    display.setAspect(aspectSel.value as 'original-4-3' | 'square-pixels');
  });

  render();

  // Hook for the browser-level comparison tests: hand back the exact 320x200
  // RGB the page is showing, so it can be diffed against a DOSBox capture.
  (window as unknown as Record<string, unknown>).__princeFrame = (sceneId?: string) => {
    if (sceneId) {
      const sc = scenes.find((s) => s.id === sceneId);
      if (!sc) throw new Error(`no scene ${sceneId}`);
      surface.clear();
      const pal = sc.draw(surface);
      return Array.from(surface.toRgb(pal));
    }
    return Array.from(surface.toRgb(current.draw(surface)));
  };
  (window as unknown as Record<string, unknown>).__princeReady = true;
  void paletteToRgba;
}

boot().catch((err: unknown) => {
  const status = document.getElementById('status');
  if (status) status.textContent = `failed to start: ${String(err)}`;
  throw err;
});
