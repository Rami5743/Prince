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
  hitPoints: number; dead: boolean; held: string[]; sword: number;
  guard: { frame: number; x: number; hitPoints: number; alive: number } | null;
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

  /**
   * The game is stepped twelve times a second, and the page used to look
   * at the keyboard only at those moments: a key that went down and up in
   * between was never seen at all. A tap of a few milliseconds has to
   * count, the way it does on the original's keyboard handler.
   */
  it('a tap far shorter than a frame still moves him', async () => {
    await page.evaluate(() => (window as unknown as {
      __princeShow(level: number, room: number): Promise<void>;
    }).__princeShow(1, 1));
    await page.evaluate(() => (window as unknown as {
      __princeStep(n: number, c: object): unknown;
    }).__princeStep(19, {}));

    const before = await state();
    expect(before?.frame, 'he should be standing still').toBe(15);

    // Down and up well inside one frame of the game's clock.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(8);
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(500);

    const after = await state();
    expect(after?.held, 'the key is long since up').not.toContain('right');
    expect(after?.frame, 'but the tap was acted on').not.toBe(15);
  }, 60000);

  /**
   * A fight through the page. The part that has to go through real keys is
   * narrow -- that Up reaches the game as a lunge rather than as a jump --
   * so that is what real keys are used for. Finishing the guard off is done
   * through the step hook, because a fight driven by wall-clock key presses
   * in a headless browser takes as many frames as it takes, and a test
   * should not depend on that.
   */
  it('Up fights the guard of level 2 rather than jumping', async () => {
    await page.evaluate(() => (window as unknown as {
      __princeShow(level: number, room: number): Promise<void>;
    }).__princeShow(2, 5));
    await page.evaluate(() => {
      const w = window as unknown as { __princeStep(n: number, c: object): unknown };
      w.__princeStep(8, {});
      w.__princeStep(40, { x: -1 });
      w.__princeStep(10, {});
    });

    const met = await state();
    expect(met?.room, 'he should have reached the guard\'s room').toBe(4);
    expect(met?.sword, 'and drawn his sword').toBe(2);
    expect(met?.guard).not.toBeNull();

    // One real press: it has to come out as a lunge, frames 151..157.
    const lunged: number[] = [];
    for (let i = 0; i < 12 && lunged.length === 0; i++) {
      await page.keyboard.down('ArrowUp');
      await page.waitForTimeout(120);
      await page.keyboard.up('ArrowUp');
      const now = await state();
      if (now && now.frame >= 151 && now.frame <= 157) lunged.push(now.frame);
      await page.waitForTimeout(200);
    }
    expect(lunged.length, 'Up should lunge, not jump').toBeGreaterThan(0);

    // And the fight can be finished. Lunge, and otherwise press forward:
    // the real-key part above leaves him wherever its timing left him, and
    // stepping in is refused once he is already within a blade's length,
    // so this closes the gap if there is one and costs nothing if not.
    const outcome = await page.evaluate(() => {
      const w = window as unknown as {
        __princeStep(n: number, c: object): unknown;
        __princeState(): {
          dead: boolean; guard: { hitPoints: number } | null;
        } | null;
      };
      for (let i = 0; i < 400; i++) {
        w.__princeStep(1, i % 8 < 2 ? { y: -1 } : { x: -1 });
        const s = w.__princeState();
        if (!s) return 'no state';
        if (s.dead) return 'the Prince died';
        if (s.guard && s.guard.hitPoints === 0) return 'killed';
      }
      return 'ran out of frames';
    });
    expect(outcome, 'the guard should go down').toBe('killed');
    expect(consoleErrors).toEqual([]);
  }, 180000);
});
