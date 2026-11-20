/**
 * `quality: high` for the picture, off the canvas the player looks at.
 *
 * The words got a vector face on a second canvas; the picture cannot,
 * because there is nothing to draw it from but the art in the data
 * files. What it gets instead is more pixels of that art --
 * `src/render/upscale.ts` rounding its corners in palette indices --
 * and a canvas the browser is then allowed to shrink smoothly instead
 * of with nearest neighbour.
 *
 * The one thing that has to be true and that no unit test can see is
 * that **the enlarged picture is the same picture**: the game rewrites
 * its palette while it plays, so a pixel that is the average of two
 * indices would have no index left to change. So the test holds the
 * game still, reads the canvas at both qualities, and requires every
 * colour at `high` to be a colour the original frame already had.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8147;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

interface Canvas {
  width: number;
  height: number;
  shownWidth: number;
  rendering: string;
  colors: string[];
}

beforeAll(async () => {
  server = (await serve(PORT, REPO)) as Server;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? { executablePath: preinstalled,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
  await page.evaluate(() => (window as unknown as {
    __princeDismissOpening(): void;
  }).__princeDismissOpening());
  await page.evaluate(() => (window as unknown as {
    __princeShow(level: number, room: number): Promise<void>;
  }).__princeShow(1, 1));
  await page.waitForTimeout(800);
  // Hold the picture still, so the two qualities are read off the
  // same frame rather than off two ticks of a walking Prince.
  await page.evaluate(() => (window as unknown as {
    __princePause(on: boolean): void;
  }).__princePause(true));
  await page.waitForTimeout(150);
}, 90000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

/** Every distinct colour on the canvas, and how it is being shown. */
const read = (): Promise<Canvas> => page.evaluate(() => {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Set<string>();
  for (let i = 0; i < d.length; i += 4) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return {
    width: canvas.width,
    height: canvas.height,
    shownWidth: canvas.getBoundingClientRect().width,
    rendering: getComputedStyle(canvas).imageRendering,
    colors: [...colors],
  };
});

const ticks = (): Promise<number> => page.evaluate(() => (window as unknown as {
  __princeState(): { ticks: number } | null;
}).__princeState()?.ticks ?? -1);

async function set(value: string): Promise<void> {
  await page.selectOption('#setting-quality', value);
  await page.waitForTimeout(250);
}

describe('the picture at the two qualities', () => {
  let original: Canvas;
  let high: Canvas;

  it('is 320 by 200 and nearest neighbour at `original`', async () => {
    await set('original');
    original = await read();
    expect(original.width).toBe(320);
    expect(original.height).toBe(200);
    expect(original.rendering).toBe('pixelated');
    expect(original.colors.length, 'a real room, not a black screen')
      .toBeGreaterThan(8);
  });

  it('gets a bigger canvas, and smooth scaling, at `high`', async () => {
    const before = await ticks();
    await set('high');
    high = await read();
    expect(high.width, 'three times across at least').toBeGreaterThanOrEqual(960);
    expect(high.width / high.height, 'the same shape').toBeCloseTo(320 / 200, 5);
    expect(high.rendering, 'the browser may shrink it smoothly').not.toBe('pixelated');
    expect(Math.abs(high.shownWidth - original.shownWidth), 'the same size on the page')
      .toBeLessThanOrEqual(1);
    expect((await ticks()) - before, 'and it costs the game no tick')
      .toBeLessThanOrEqual(3);
  });

  it('invents no colour, which is what lets the palette go on moving', () => {
    const had = new Set(original.colors);
    const invented = high.colors.filter((c) => !had.has(c));
    expect(invented, invented.join(' ')).toEqual([]);
    // And it really did more than copy: Scale3x rounds corners, so
    // some of the original's colours cover a different share of the
    // screen. A pure nearest-neighbour blow-up would be identical.
    expect(high.colors.length).toBeGreaterThan(8);
  });

  it('gives the original pixels back', async () => {
    await set('original');
    const back = await read();
    expect(back.width).toBe(320);
    expect(back.rendering).toBe('pixelated');
    expect(new Set(back.colors)).toEqual(new Set(original.colors));
  });

  it('said nothing to the console through any of it', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
