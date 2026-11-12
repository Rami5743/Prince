/**
 * The hall of fame, on the page the player actually loads.
 *
 * GitHub Pages serves `index.html` and `game.js` from the repository
 * root, so that is what is loaded here rather than `web/index.html`:
 * a piece that is in `src/pop` and not in the root bundle does not
 * exist as far as the player is concerned.
 *
 * What this proves that `tests/pop/hall-of-fame.test.ts` cannot: that
 * the keys a real keyboard sends reach `input_str`, and that what it
 * writes lands in the browser's own `localStorage`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8127;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

interface SceneState {
  running: boolean;
  playing: { kind: string; level?: number };
  wantsText: boolean;
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
  // The repository root, which is the GitHub Pages bundle.
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const sceneState = (): Promise<SceneState | null> => page.evaluate(
  () => (window as unknown as { __princeSceneState(): SceneState | null }).__princeSceneState(),
);

/** Run the scene's own clock on by `units` sixtieths, by hand. */
const stepScene = (units: number): Promise<void> => page.evaluate((n) => {
  const w = window as unknown as { __princeSceneStep(ms: number): boolean };
  for (let i = 0; i < n; i++) w.__princeSceneStep(1000 / 60);
}, units);

/** Step until the scene asks for a name, or until `limit` sixtieths. */
async function stepUntilAsking(limit: number): Promise<boolean> {
  for (let spent = 0; spent < limit; spent += 120) {
    await stepScene(120);
    if ((await sceneState())?.wantsText) return true;
  }
  return false;
}

describe('the hall of fame on the root bundle', () => {
  it('takes a name off the keyboard and keeps it in localStorage', async () => {
    await page.evaluate(() => {
      (window as unknown as { __princePause(on: boolean): void }).__princePause(true);
      localStorage.removeItem('PRINCE.HOF');
    });
    // Forty-two minutes left, which is what the entry's time comes from.
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string }): Promise<void>;
    }).__princePlayScene({ kind: 'ending' }));

    // The ending runs a little over half a minute of its own clock
    // before `end_sequence` reaches the box.
    expect(await stepUntilAsking(60 * 90), 'the ending asked for a name').toBe(true);
    expect((await sceneState())?.running).toBe(true);

    // A real keyboard, through the page's own keydown handler.
    await page.keyboard.type('JORDAN');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await stepScene(10);
    expect((await sceneState())?.wantsText, 'Enter closed the box').toBe(false);

    // `pop_wait(timer_0, 120)` and the title wiped on again, and then
    // the scene is over and the shell goes back to the title.
    await stepScene(60 * 20);
    const stored = await page.evaluate(() => localStorage.getItem('PRINCE.HOF'));
    expect(stored, 'PRINCE.HOF was written').not.toBe(null);
    const bytes = Uint8Array.from(atob(stored!), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(176);
    // One entry, and the Backspace took the N off.
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(1);
    expect(String.fromCharCode(...bytes.slice(2, 7))).toBe('JORDA');
    expect(bytes[2 + 5]).toBe(0);
    expect(consoleErrors).toEqual([]);
  }, 120000);
});
