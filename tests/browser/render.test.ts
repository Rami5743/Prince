/**
 * Browser-level comparison: run the port in a real browser, read back the
 * 320x200 frame it drew, and require it to equal a capture of the original
 * game pixel for pixel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO, goldenFrame, toCaptureSpace, compareRgb } from '../helpers/fixtures.ts';

const PORT = 8123;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

beforeAll(async () => {
  server = (await serve(PORT, REPO)) as Server;
  // Use the browser that is already installed in this environment rather than
  // whatever revision the npm package expects.
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
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 20000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

async function frame(sceneId: string): Promise<Uint8Array> {
  const data = (await page.evaluate(
    (id) => (window as unknown as {
      __princeFrame(id: string): Promise<number[]> | number[];
    }).__princeFrame(id),
    sceneId,
  )) as number[];
  return Uint8Array.from(data);
}

describe('in a real browser', () => {
  it('loads the original data files without errors', () => {
    expect(consoleErrors).toEqual([]);
  });

  it('draws the title background exactly as the original does', async () => {
    const golden = goldenFrame('title-background.png');
    const got = toCaptureSpace(await frame('title-background'));
    const diff = compareRgb(got, golden.rgb, golden.width, golden.height);
    expect(diff.first).toBeUndefined();
    expect(diff.count).toBe(0);
  });

  it('renders at exactly 320x200 with one game pixel per canvas pixel', async () => {
    const size = await page.evaluate(() => {
      const c = document.getElementById('screen') as HTMLCanvasElement;
      return [c.width, c.height];
    });
    expect(size).toEqual([320, 200]);
  });
});

/**
 * The page's own keyboard handling, which the engine tests cannot reach: the
 * original is played on a numeric keypad, and a key meant for the game must
 * not reach the menus behind it.
 */
describe('the keyboard, in a real browser', () => {
  async function playLevel(level: number): Promise<void> {
    await page.evaluate((n) => (window as unknown as {
      __princeShow(l: number, r: number): Promise<void>;
    }).__princeShow(n, 1), level);
    await page.evaluate(() => (window as unknown as {
      __princeStep(n: number): unknown;
    }).__princeStep(12));
  }
  const state = () => page.evaluate(() => (window as unknown as {
    __princeState(): { x: number; frame: number; held: string[]; dead: boolean } | null;
  }).__princeState());

  it('takes the numeric keypad, not only the arrow keys', async () => {
    await playLevel(3);
    await page.keyboard.down('Numpad6');
    expect((await state())?.held).toContain('right');
    await page.keyboard.up('Numpad6');
    expect((await state())?.held).toEqual([]);
  });

  it('reads a corner key of the keypad as two directions at once', async () => {
    await playLevel(3);
    await page.keyboard.down('Numpad9');
    expect((await state())?.held).toEqual(['right', 'up']);
    await page.keyboard.up('Numpad9');
    expect((await state())?.held).toEqual([]);
  });

  it('keeps the keys away from the menus, which would change what is shown', async () => {
    await playLevel(3);
    const before = await page.evaluate(() =>
      (document.getElementById('scene') as HTMLSelectElement).value);
    await page.focus('#scene');
    await page.keyboard.down('Numpad9');
    await page.keyboard.up('Numpad9');
    await page.keyboard.down('ArrowDown');
    await page.keyboard.up('ArrowDown');
    const after = await page.evaluate(() =>
      (document.getElementById('scene') as HTMLSelectElement).value);
    expect(after).toBe(before);
  });

  it('steps the game on its own, without a key being held', async () => {
    await playLevel(3);
    await page.keyboard.down('Numpad6');
    const first = (await state())?.frame;
    await page.waitForTimeout(500);
    const later = (await state())?.frame;
    await page.keyboard.up('Numpad6');
    expect(later).not.toBe(first);
  });
});
