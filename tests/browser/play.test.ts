/**
 * The move that was reported broken, played in a real browser with real key
 * events.
 *
 * Everything else about climbing is checked against the engine directly, or
 * against captures of the original. This one goes through the page: the
 * keyboard listener, the set of held keys, the animation-frame loop. The
 * report was that climbing did not work at all, and while the cause turned
 * out to be in the engine, nothing until now would have noticed if the page
 * had stopped delivering Shift, or Up, at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';
import { Y_LAND } from '../../src/game/geometry.ts';

const PORT = 8124;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

interface PageState {
  frame: number; room: number; x: number; y: number;
  hitPoints: number; dead: boolean; held: string[];
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
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const state = (): Promise<PageState | null> => page.evaluate(
  () => (window as unknown as { __princeState(): PageState | null }).__princeState(),
);

describe('played in the browser', () => {
  it('three careful steps and a held Up put the Prince on the floor above',
    async () => {
      // Level 1, and let the entry drop finish without waiting on the clock.
      await page.evaluate(() => (window as unknown as {
        __princeShow(level: number, room: number): Promise<void>;
      }).__princeShow(1, 1));
      await page.evaluate(() => (window as unknown as {
        __princeStep(n: number, c: object): unknown;
      }).__princeStep(19, {}));

      const settled = await state();
      expect(settled?.y).toBe(Y_LAND[2]); // the middle row

      // Three careful steps. Shift goes down before the arrow: a bare arrow
      // key, even for one frame, is a run rather than a step.
      for (let i = 0; i < 3; i++) {
        await page.keyboard.down('Shift');
        await page.keyboard.down('ArrowRight');
        await page.waitForTimeout(700);
        await page.keyboard.up('ArrowRight');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(500);
      }

      // Up on its own, held: he should take hold of the ledge and climb it.
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(3000);
      const after = await state();
      await page.keyboard.up('ArrowUp');

      expect(after?.held).toContain('up');
      expect(after?.y, 'he should be standing on the row above').toBe(Y_LAND[1]);
      expect(consoleErrors).toEqual([]);
    }, 120000);
});
