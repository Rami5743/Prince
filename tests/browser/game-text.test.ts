/**
 * The language and the quality, in the page the player plays.
 *
 * `tests/render/game-text.test.ts` pins the words and the glyphs. This
 * is the other half and it can only be done in a browser: that the
 * setting reaches the game's own screen, that it reaches it **without
 * a reload and without the game taking a tick**, and that
 * `quality: high` draws on a second canvas at the canvas's own
 * resolution rather than into the 320 by 200 the digests read.
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
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

/**
 * The strip under the room, off the very canvas the player looks at.
 *
 * The canvas is 320 wide at `quality: original` and three or six
 * times that at `high` -- `Display` gives the picture more pixels of
 * its own art there -- so the rectangle is asked for in the game's
 * coordinates and multiplied by whatever the canvas turns out to be.
 * A column is reported back in the game's coordinates too, so the two
 * qualities can be compared.
 */
const strip = (): Promise<{ lit: number; ink: number[] }> => page.evaluate(() => {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const n = canvas.width / 320;
  // `rect_bottom_text` is x 70 to 250. The hit points live in the
  // same seven rows, to the left of it, and are not words.
  const w = 180 * n;
  const d = ctx.getImageData(70 * n, 193 * n, w, 7 * n).data;
  const ink: number[] = [];
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i]! + d[i + 1]! + d[i + 2]! > 60) {
      lit++;
      ink.push(70 + Math.floor(((i / 4) % w) / n));
    }
  }
  return { lit: Math.round(lit / (n * n)), ink };
});

const ticks = (): Promise<number> => page.evaluate(() => (window as unknown as {
  __princeState(): { ticks: number } | null;
}).__princeState()?.ticks ?? -1);

/**
 * Open a level and hold it there.
 *
 * `show_level` puts `LEVEL n` under the room for twenty-four ticks and
 * `60 MINUTES LEFT` for twenty-four more, and then the strip is empty
 * -- so a test that reads the words has to stop the clock, or it is
 * racing a four-second countdown and will lose it on a loaded machine.
 */
async function showAndHold(level: number): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    __princePause(on: boolean): void;
  }).__princePause(false));
  await page.evaluate((n) => (window as unknown as {
    __princeShow(level: number, room: number): Promise<void>;
  }).__princeShow(n, 1), level);
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as {
    __princePause(on: boolean): void;
  }).__princePause(true));
  await page.waitForTimeout(100);
}

async function set(key: string, value: string): Promise<void> {
  await page.selectOption(`#setting-${key}`, value);
  await page.waitForTimeout(150);
}

describe('the game text, in the page', () => {
  it('draws the strip in English to begin with', async () => {
    await set('language', 'en');
    await set('quality', 'original');
    await showAndHold(3);
    const { lit } = await strip();
    // `LEVEL 3` is up: 41 pixels wide and seven rows tall, so a few
    // hundred lit pixels and nowhere near an empty strip.
    expect(lit).toBeGreaterThan(50);
  });

  it('relabels the strip into Hebrew without a reload and without a tick', async () => {
    const before = await strip();
    const t0 = await ticks();
    await set('language', 'he');
    const after = await strip();
    const t1 = await ticks();
    expect(after.lit).toBeGreaterThan(50);
    expect(after.ink, 'the strip is drawn again, differently').not.toEqual(before.ink);
    // `שלב 3` is wider than `LEVEL 3`, so the line starts further left.
    expect(Math.min(...after.ink)).not.toBe(Math.min(...before.ink));
    expect(t1 - t0, 'the relabel costs the game no tick').toBeLessThanOrEqual(3);
  });

  it('gives Hebrew back to English again', async () => {
    await set('language', 'en');
    const { lit } = await strip();
    expect(lit).toBeGreaterThan(50);
  });

  it('empties the 320x200 strip and draws on a second canvas at `high`', async () => {
    await set('quality', 'high');
    await page.waitForTimeout(200);
    const { lit } = await strip();
    expect(lit, 'nothing is blitted into the game surface').toBe(0);
    const overlay = await page.evaluate(() => {
      const canvas = document.getElementById('screen-text') as HTMLCanvasElement | null;
      if (!canvas) return null;
      const game = document.getElementById('screen') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) ink++;
      return {
        ink,
        width: canvas.width,
        height: canvas.height,
        gameWidth: game.clientWidth,
        same: canvas.getBoundingClientRect().width,
        // The content box, not the border box: the canvas has a
        // one-pixel border and the picture is inside it.
        gameBox: game.clientWidth,
      };
    });
    expect(overlay, 'the page made a text canvas').not.toBeNull();
    expect(overlay!.ink, 'and drew the words on it').toBeGreaterThan(50);
    // Its backing store is the size the picture is really shown at,
    // which is the whole point: 320 wide would be no sharper.
    expect(overlay!.width).toBeGreaterThan(640);
    // And it sits exactly over the picture, inside the border.
    expect(overlay!.same).toBeCloseTo(overlay!.gameBox, 0);
  });

  it('draws crisp Hebrew at `high` too', async () => {
    await set('language', 'he');
    await page.waitForTimeout(200);
    const { lit } = await strip();
    expect(lit).toBe(0);
    const ink = await page.evaluate(() => {
      const canvas = document.getElementById('screen-text') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
      return n;
    });
    expect(ink).toBeGreaterThan(50);
  });

  it('keeps the crisp Hebrew inside the strip, top and bottom', async () => {
    /**
     * A vector face is not the height of its cell. At the size that
     * gives a seven-pixel capital a Hebrew lamed climbs above it and
     * a qof hangs below, and the strip has eight rows in all -- row
     * 192, the first under the 192-row room, to the bottom of the
     * screen. Without a fit the one goes in white over the floor of
     * the room and the other goes off the bottom of the screen.
     *
     * The line this reads is `שלב 3`, because the **lamed** is what
     * reaches over the room: measured with the fit taken out, its
     * top row is 191.74. The other half of the fit -- a qof's tail
     * going off the bottom of the screen -- is pinned in
     * `tests/render/game-text.test.ts`, because a canvas cuts ink
     * off at its own edge and nothing read back from one can tell a
     * tail that fits from a tail that was cut.
     */
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(false));
    await page.evaluate(() => (window as unknown as {
      __princeShow(level: number, room: number): Promise<void>;
    }).__princeShow(3, 1));
    // `show_level` holds `LEVEL n` for twenty-four ticks, so this
    // stops the clock well inside the two seconds it is up.
    await page.waitForTimeout(500);
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await page.waitForTimeout(150);

    const ink = await page.evaluate(() => {
      const canvas = document.getElementById('screen-text') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const rows = canvas.height / 200;
      let top = 200; let bottom = 0; let n = 0;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          if (d[(y * canvas.width + x) * 4 + 3]! > 40) {
            n++;
            if (y / rows < top) top = y / rows;
            if (y / rows > bottom) bottom = y / rows;
          }
        }
      }
      return { top, bottom, n };
    });
    expect(ink.n, 'a Hebrew line is up').toBeGreaterThan(50);
    // Row 192 is the first row under the 192-row room. Measured with
    // the fit taken out, this reads **191.74** -- the top of a lamed
    // a quarter of a row over the floor -- so the tenth of a row of
    // slack here is for antialiasing and not for the bug.
    expect(ink.top, 'nothing over the room').toBeGreaterThan(191.9);
    expect(ink.bottom, 'and nothing past the last row').toBeLessThan(200);
  });

  it('puts the bitmap words back when the quality goes back', async () => {
    await set('quality', 'original');
    await page.waitForTimeout(200);
    const { lit } = await strip();
    expect(lit).toBeGreaterThan(50);
    const ink = await page.evaluate(() => {
      const canvas = document.getElementById('screen-text') as HTMLCanvasElement;
      const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
      return n;
    });
    expect(ink, 'and takes the crisp ones away').toBe(0);
  });

  it('says nothing to the console through any of it', () => {
    expect(consoleErrors).toEqual([]);
  });
});
