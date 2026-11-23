/**
 * The repainted Prince, off the canvas the player looks at.
 *
 * `graphics/kid-10x/` is read by the page and nothing else, so no
 * unit test can see any of this: that the artwork is asked for at
 * `quality: high` and **not at all** at `original`, that it is read
 * in behind the play rather than one frame at a time as the game
 * first draws each (which left the first seconds flickering between
 * the painting and the blit), and that what reaches the glass really
 * is the painting -- the same tick at the two qualities has to be
 * two different pictures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

let server: Server;
let browser: Browser;
const errors: string[] = [];

beforeAll(async () => {
  server = (await serve(0, REPO)) as Server;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? { executablePath: preinstalled,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
}, 90000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

interface Run { asked: number; swords: number; canvas: string; }

/** Open the page at one quality, play a little, and report. */
async function visit(quality: string, settle = 4000): Promise<Run> {
  const port = (server.address() as { port: number }).port;
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const asked = new Set<string>();
  const swords = new Set<string>();
  page.on('response', (r) => {
    if (r.url().includes('kid-sword-10x/0')) swords.add(r.url());
    else if (r.url().includes('kid-10x')) asked.add(r.url());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((q) => {
    try {
      localStorage.setItem('prince.settings.v1', JSON.stringify({
        language: 'en', quality: q, graphics: 'original', music: 'original',
        map: 'original', aspect: 'original-4-3',
      }));
    } catch { /* a private window: the defaults stand */ }
  }, quality);
  await page.goto(`http://localhost:${port}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
  await page.evaluate(() => {
    const w = window as unknown as { __princeMute(): void; __princeDismissOpening(): void };
    w.__princeMute();
    w.__princeDismissOpening();
  });
  await page.evaluate(() => (window as unknown as {
    __princeEnterLevel(level: number): Promise<void>;
  }).__princeEnterLevel(2));
  await page.waitForTimeout(settle);
  // One known tick, so the two qualities are read off the same frame.
  await page.evaluate(() => {
    const step = (window as unknown as {
      __princeStep(n: number, c: Record<string, unknown>): unknown;
    }).__princeStep;
    for (let i = 0; i < 40; i++) step(1, { x: 1 });
  });
  await page.waitForTimeout(300);
  const canvas = await page.evaluate(() => {
    const el = document.getElementById('screen') as HTMLCanvasElement;
    const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 16777619);
    return `${el.width}x${el.height}:${(h >>> 0).toString(16)}`;
  });
  await page.close();
  return { asked: asked.size, swords: swords.size, canvas };
}

describe('the repainted Prince on the page', () => {
  it('reads the whole set in behind the play at high, and none at original', async () => {
    const high = await visit('high', 8000);
    const original = await visit('original', 1500);
    // All 219 of `KID.DAT`'s sprites, not the handful this level draws.
    expect(high.asked).toBe(219);
    expect(original.asked).toBe(0);
    // And the 32 fighting frames painted with the sword in them.
    expect(high.swords).toBe(32);
    expect(original.swords).toBe(0);
    // And the painting really is on the glass: a bigger canvas, and
    // not the same picture.
    expect(high.canvas).not.toBe(original.canvas);
    expect(errors).toEqual([]);
  }, 180000);
});
