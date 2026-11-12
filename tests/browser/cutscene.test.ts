/**
 * The cutscenes, on the page.
 *
 * `tests/pop/cutscene.test.ts` plays them against the translation.
 * This plays them where the player does: through the shell's own
 * clock, the canvas and the keyboard. A cutscene that is in `src/pop`
 * and not on the page does not exist, and the way out of a level is
 * the only path that puts one there.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8126;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

interface SceneState {
  running: boolean;
  playing: { kind: string; level?: number };
  lit: number;
}

beforeAll(async () => {
  server = (await serve(PORT, REPO)) as Server;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? { executablePath: preinstalled, args: ['--no-sandbox'] }
      : {},
  );
  page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const sceneState = (): Promise<SceneState | null> => page.evaluate(
  () => (window as unknown as { __princeSceneState(): SceneState | null }).__princeSceneState(),
);

const gameState = (): Promise<{ level: number } | null> => page.evaluate(
  () => (window as unknown as { __princeState(): { level: number } | null }).__princeState(),
);

/** How many of the canvas's pixels are not black. */
const litOnCanvas = (): Promise<number> => page.evaluate(() => {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] || data[i + 1] || data[i + 2]) n++;
  }
  return n;
});

describe('a cutscene on the page', () => {
  it('draws the princess\'s room onto the canvas', async () => {
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string; level: number }): Promise<void>;
    }).__princePlayScene({ kind: 'level', level: 4 }));
    // Two seconds of the scene's own clock, stepped by hand so that
    // nothing here waits on the machine.
    await page.evaluate(() => {
      const w = window as unknown as { __princeSceneStep(ms: number): boolean };
      for (let i = 0; i < 120; i++) w.__princeSceneStep(1000 / 60);
    });
    const scene = await sceneState();
    expect(scene?.running).toBe(true);
    expect(scene?.playing).toEqual({ kind: 'level', level: 4 });
    // The room is a picture, not a few stray pixels, and it reached
    // the canvas and not only the translation's own surface.
    // Two thirds of the screen: the room's arches are its colour 0,
    // so a room drawn whole is about 42000 of the 64000 pixels.
    expect(scene!.lit).toBeGreaterThan(30000);
    expect(await litOnCanvas()).toBeGreaterThan(30000);
    expect(consoleErrors).toEqual([]);
  }, 60000);

  /**
   * The path the player takes: out of a level and into the next one,
   * with `tbl_cutscenes` deciding whether there is a scene in between.
   */
  it('plays itself between one level and the next, and then the level comes',
    async () => {
      consoleErrors.length = 0;
      await page.evaluate(() => (window as unknown as {
        __princePause(on: boolean): void;
      }).__princePause(false));
      await page.evaluate(() => (window as unknown as {
        __princeShow(level: number, room: number): Promise<void>;
      }).__princeShow(1, 1));
      await page.waitForTimeout(500);
      // Shift+L: `skipLevel`, which is the original's own way out.
      await page.keyboard.press('Shift+KeyL');
      await page.waitForFunction(
        () => (window as unknown as {
          __princeSceneState(): { running: boolean } | null;
        }).__princeSceneState()?.running === true,
        null, { timeout: 10000 },
      );
      const scene = await sceneState();
      expect(scene?.playing).toEqual({ kind: 'level', level: 2 });

      // It ends by itself and level 2 begins. `cutscene_2_6` is 4.8
      // seconds of the original's clock.
      await page.waitForFunction(
        () => (window as unknown as {
          __princeState(): { level: number } | null;
        }).__princeState()?.level === 2,
        null, { timeout: 30000 },
      );
      expect((await gameState())?.level).toBe(2);
      expect((await sceneState())?.running).toBe(false);
      expect(consoleErrors).toEqual([]);
    }, 60000);

  it('a key does not cut one of these short, and Escape does', async () => {
    consoleErrors.length = 0;
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string }): Promise<void>;
    }).__princePlayScene({ kind: 'ending' }));
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect((await sceneState())?.running, 'an arrow key is ignored').toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    expect((await sceneState())?.running, 'Escape stops it').toBe(false);
    expect(consoleErrors).toEqual([]);
  }, 60000);
});
