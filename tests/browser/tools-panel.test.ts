/**
 * The two panels in the margin: Settings and Tools.
 *
 * Nothing in `src/pop` is involved in any of this and that is the
 * point of the tests. The engine plays the same ticks whatever the
 * player has chosen, so what has to be checked is the shell: that the
 * opening page lets the game through, that changing the language turns
 * the page over, that stopping a recording **writes the file** rather
 * than waiting for a second button, and that a game saved and loaded
 * comes back the game it was.
 *
 * The save is SDLPoP's `quick_save` field for field (`web/savegame.ts`),
 * so the test is the one that function's own author would write: play,
 * save, play on until the picture has moved, load, and require the
 * first picture back.
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

interface PageState {
  ticks: number;
  frame: number;
  room: number;
  x: number;
  y: number;
  hitPoints: number;
  level: number;
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
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const state = (): Promise<PageState | null> => page.evaluate(
  () => (window as unknown as { __princeState(): PageState | null }).__princeState(),
);

/** Play a level, with the opening page out of the way. */
async function playLevel(level: number): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    __princeDismissOpening(): void;
  }).__princeDismissOpening());
  await page.evaluate((n) => (window as unknown as {
    __princeShow(level: number, room: number): Promise<void>;
  }).__princeShow(n, 1), level);
  await page.waitForTimeout(1200);
}

/** Wait until the game's own clock has gone on by `n` ticks. */
async function playTicks(n: number): Promise<void> {
  const from = (await state())?.ticks ?? 0;
  await page.waitForFunction(
    ([start, want]) => {
      const s = (window as unknown as { __princeState(): { ticks: number } | null })
        .__princeState();
      return s !== null && s.ticks >= start + want;
    },
    [from, n] as const,
    { timeout: 30000 },
  );
}

describe('the page around the game', () => {
  it('does not scroll, in either direction', async () => {
    const box = await page.evaluate(() => {
      const d = document.documentElement;
      return { sw: d.scrollWidth, cw: d.clientWidth, sh: d.scrollHeight, ch: d.clientHeight };
    });
    expect(box.sw, 'nothing sticks out sideways').toBeLessThanOrEqual(box.cw);
    expect(box.sh, 'nothing sticks out below').toBeLessThanOrEqual(box.ch);
  });

  it('gives the game the height of the window', async () => {
    const fit = await page.evaluate(() => {
      const canvas = document.getElementById('screen') as HTMLCanvasElement;
      const stage = canvas.parentElement as HTMLElement;
      const c = canvas.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      return { cw: c.width, ch: c.height, sw: s.width, sh: s.height };
    });
    // As big as the stage allows in one direction or the other, and
    // never bigger -- which is what the measured fit buys over a rule
    // that asks its own container how tall it is.
    expect(fit.cw).toBeLessThanOrEqual(fit.sw + 1);
    expect(fit.ch).toBeLessThanOrEqual(fit.sh + 1);
    expect(Math.max(fit.cw / fit.sw, fit.ch / fit.sh)).toBeGreaterThan(0.98);
    // The shape of a pixel, 4:3 as the setting opens on.
    expect(fit.cw / fit.ch).toBeCloseTo(4 / 3, 1);
  });

  it('has a Settings panel and a Tools panel in the margin', async () => {
    const there = await page.evaluate(() => ({
      settings: document.getElementById('panel-settings') !== null,
      tools: document.getElementById('panel-tools') !== null,
      // Every setting but the map, which the opening page alone offers.
      fields: [...document.querySelectorAll('#settings-fields select')].map((s) => s.id),
      opening: [...document.querySelectorAll('#opening-fields select')].map((s) => s.id),
    }));
    expect(there.settings).toBe(true);
    expect(there.tools).toBe(true);
    expect(there.fields).toEqual([
      'setting-language', 'setting-quality', 'setting-graphics',
      'setting-music', 'setting-aspect',
    ]);
    expect(there.opening, 'the map is chosen before the game begins').toEqual([
      'setting-language', 'setting-quality', 'setting-graphics',
      'setting-music', 'setting-map',
    ]);
  });

  it('turns the page over when the language is Hebrew, and back', async () => {
    const read = (): Promise<{ dir: string; lang: string; title: string }> => page.evaluate(() => ({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      title: document.getElementById('page-title')?.textContent ?? '',
    }));
    const before = await read();
    expect(before.dir).toBe('ltr');

    await page.selectOption('#setting-language', 'he');
    const after = await read();
    expect(after.dir, 'the title moves to the right-hand margin').toBe('rtl');
    expect(after.lang).toBe('he');
    expect(after.title, 'the page is relabelled without a reload')
      .not.toBe(before.title);

    await page.selectOption('#setting-language', 'en');
    expect((await read()).dir).toBe('ltr');
  });

  it('keeps what was chosen for the next visit', async () => {
    await page.selectOption('#setting-aspect', 'square-pixels');
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('prince.settings.v1'));
    expect(stored).toContain('square-pixels');
    await page.selectOption('#setting-aspect', 'original-4-3');
  });
});

describe('the opening settings page', () => {
  it('is up when the page opens and Begin takes it away', async () => {
    const fresh = await browser.newPage();
    try {
      await fresh.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
      await fresh.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
      expect(await fresh.isVisible('#opening'), 'it is the first thing shown').toBe(true);
      await fresh.click('#begin');
      expect(await fresh.isVisible('#opening')).toBe(false);
      // And the game was running behind it the whole time: `__princeReady`
      // is set at the end of `boot`, after the title has been started.
    } finally {
      await fresh.close();
    }
  }, 60000);
});

describe('Tools', () => {
  it('writes the recording the moment it is stopped', async () => {
    await playLevel(1);
    await page.click('#record');
    await page.waitForTimeout(400);
    expect(await page.evaluate(
      () => (document.getElementById('record') as HTMLButtonElement).classList.contains('on'),
    ), 'the button says it is recording').toBe(true);

    await playTicks(12);
    // **The stop is the save.** There is no second button, so if this
    // never resolves the recording has been lost.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#record'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^prince-keys-level1-.*\.json$/);
    expect(await page.evaluate(
      () => (document.getElementById('record') as HTMLButtonElement).classList.contains('on'),
    )).toBe(false);
  }, 90000);

  it('saves a game and loads it back where it was', async () => {
    await playLevel(2);
    await playTicks(24);
    // Walk, so that the saved picture is not the one the level opens on.
    await page.keyboard.down('ArrowRight');
    await playTicks(14);
    await page.keyboard.up('ArrowRight');
    await playTicks(4);

    const saved = await state();
    expect(saved).not.toBeNull();
    await page.click('#save-slots .slot-row:nth-child(1) button:nth-of-type(1)');
    await page.waitForTimeout(300);

    // Now move him somewhere else, so that a load that did nothing
    // would be caught.
    await page.keyboard.down('ArrowRight');
    await playTicks(20);
    await page.keyboard.up('ArrowRight');
    await playTicks(6);
    const moved = await state();
    expect(moved?.x, 'he really went somewhere').not.toBe(saved?.x);

    // The clock is stopped around the load. Loading is a promise and not
    // a tick, so it still runs -- and without this the game plays on
    // while the test is reading, and what comes back is the saved
    // picture a second later rather than the saved picture.
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await page.click('#save-slots .slot-row:nth-child(1) button:nth-of-type(2)');
    await page.waitForFunction(
      () => document.getElementById('tool-note')?.textContent !== '',
      null, { timeout: 20000 },
    );
    const back = await state();
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(false));
    expect(back?.level).toBe(saved?.level);
    expect(back?.room).toBe(saved?.room);
    expect(back?.x).toBe(saved?.x);
    expect(back?.y).toBe(saved?.y);
    expect(back?.frame).toBe(saved?.frame);
    expect(back?.hitPoints).toBe(saved?.hitPoints);
  }, 120000);

  it('says what is in each slot, and nothing threw', async () => {
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('#save-slots .slot-row > span')]
        .map((s) => s.textContent ?? ''));
    expect(labels).toHaveLength(3);
    expect(labels[0], 'the slot that was just written says so')
      .not.toMatch(/empty/);
    expect(labels[1]).toMatch(/empty/);
    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
