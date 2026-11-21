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
 * The thing to check here, which no unit test can, is on the canvas
 * the player looks at: at `high` it carries **colours the palette
 * does not hold** -- that is the whole of the anti-aliasing and the
 * reason the first version of this was rejected -- and those colours
 * are mixtures of the frame's own, not a new hue. And the picture
 * still obeys the palette: the test fades the screen and requires it
 * to go dark, because a finished RGB image would not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

/**
 * The port is assigned, not chosen.
 *
 * Four pairs of these files had picked the same number by hand and
 * `game-text.test.ts` shared 8147 with two others. Vitest runs the
 * files in parallel, so whichever bound second got EADDRINUSE in its
 * `beforeAll` -- which vitest reports as the whole file failing with
 * its tests **skipped** and an `Errors 1` line, not as an assertion.
 * That is the intermittent browser failure this suite has had: it is
 * not contention for the machine and it is not the page.
 */
let PORT = 0;
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
  server = (await serve(0, REPO)) as Server;
  PORT = (server.address() as { port: number }).port;
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
    expect(high.width, 'three times across').toBe(960);
    expect(high.width / high.height, 'the same shape').toBeCloseTo(320 / 200, 5);
    expect(high.rendering, 'the browser may resize it smoothly').not.toBe('pixelated');
    expect(Math.abs(high.shownWidth - original.shownWidth), 'the same size on the page')
      .toBeLessThanOrEqual(1);
    expect((await ticks()) - before, 'and it costs the game no tick')
      .toBeLessThanOrEqual(3);
  });

  it('puts colours on the screen the palette does not hold', () => {
    const had = new Set(original.colors);
    const made = high.colors.filter((c) => !had.has(c));
    // The measurement this round turns on. The version before it
    // produced exactly the original's own colour count, which is why
    // every edge was a staircase.
    expect(high.colors.length, `original ${original.colors.length}`)
      .toBeGreaterThan(original.colors.length * 3);
    expect(made.length).toBeGreaterThan(0);
  });

  it('and every one of them is a mixture of the frame\'s own, not a new hue', () => {
    const chans = original.colors.map((c) => c.split(',').map(Number));
    const lo = [0, 1, 2].map((i) => Math.min(...chans.map((c) => c[i]!)));
    const hi = [0, 1, 2].map((i) => Math.max(...chans.map((c) => c[i]!)));
    for (const c of high.colors) {
      const v = c.split(',').map(Number);
      for (let i = 0; i < 3; i++) {
        expect(v[i]!, `${c} channel ${i}`).toBeGreaterThanOrEqual(lo[i]! - 1);
        expect(v[i]!, `${c} channel ${i}`).toBeLessThanOrEqual(hi[i]! + 1);
      }
    }
  });

  it('still fades, because the mixtures are of indices and not of colours', async () => {
    // A finished RGB image would sit there bright while the game
    // faded the screen underneath it. `shift+b` is the blind cheat,
    // which blacks the room out through the palette and the drawing
    // both; what matters is that the canvas goes dark at `high`.
    const bright = (): Promise<number> => page.evaluate(() => {
      const canvas = document.getElementById('screen') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i]! + d[i + 1]! + d[i + 2]!;
      return sum / (d.length / 4);
    });
    const before = await bright();
    expect(before, 'a lit room').toBeGreaterThan(30);
    await page.evaluate(() => (window as unknown as {
      __princeCommand(key: string): void;
    }).__princeCommand('shift+b'));
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(false));
    await page.waitForTimeout(400);
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await page.waitForTimeout(150);
    expect(await bright(), 'and the lights go out').toBeLessThan(before / 2);
    await page.evaluate(() => (window as unknown as {
      __princeCommand(key: string): void;
    }).__princeCommand('shift+b'));
    await page.waitForTimeout(200);
  });

  it('gives the original pixels back', async () => {
    await set('original');
    await page.waitForTimeout(250);
    const back = await read();
    expect(back.width).toBe(320);
    expect(back.rendering).toBe('pixelated');
    // Every colour is one of the palette's again: nothing of the
    // anti-aliasing is left on the canvas.
    const had = new Set(original.colors);
    expect(back.colors.filter((c) => !had.has(c))).toEqual([]);
  });

  it('said nothing to the console through any of it', () => {
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
