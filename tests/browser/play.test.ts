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
      await pause(true);
      await page.evaluate(() => (window as unknown as {
        __princeStep(n: number, c: object): unknown;
      }).__princeStep(19, {}));
      await pause(false);

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
    await pause(true);
    await page.evaluate(() => (window as unknown as {
      __princeStep(n: number, c: object): unknown;
    }).__princeStep(19, {}));
    await pause(false);

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

  const pause = (on: boolean): Promise<void> => page.evaluate(
    (v) => (window as unknown as { __princePause(on: boolean): void }).__princePause(v),
    on,
  );

  /** Walk up to the guard of level 2's room 4, through the step hook. */
  async function meetTheGuard(): Promise<void> {
    await pause(true);
    await page.evaluate(() => (window as unknown as {
      __princeShow(level: number, room: number): Promise<void>;
    }).__princeShow(2, 5));
    await page.evaluate(() => {
      const w = window as unknown as { __princeStep(n: number, c: object): unknown };
      w.__princeStep(8, {});
      w.__princeStep(40, { x: -1 });
      w.__princeStep(10, {});
    });
  }

  /**
   * The narrow thing that has to go through real keys: with a sword out,
   * Shift lunges and Up parries -- and neither of them jumps. Each press
   * is watched over the frames that follow it, so a sample landing between
   * two of the game's own frames cannot miss it.
   */
  async function tapAndWatch(key: 'Shift' | 'ArrowUp', hit: (f: number) => boolean) {
    const seen: number[] = [];
    for (let i = 0; i < 15 && !seen.some(hit); i++) {
      await page.keyboard.down(key);
      await page.waitForTimeout(100);
      await page.keyboard.up(key);
      for (let k = 0; k < 5; k++) {
        await page.waitForTimeout(60);
        const now = await state();
        if (now?.dead) break;
        if (now) seen.push(now.frame);
      }
      const now = await state();
      if (now?.dead) break;
    }
    return seen;
  }

  it('Shift lunges and Up parries once the sword is out', async () => {
    await meetTheGuard();
    const met = await state();
    expect(met?.room, 'he should have reached the guard\'s room').toBe(4);
    expect(met?.sword, 'and drawn his sword').toBe(2);

    await pause(false); // real keys need the page's own clock back
    const lunged = await tapAndWatch('Shift', (f) => f >= 151 && f <= 157);
    expect(lunged.some((f) => f >= 151 && f <= 157), 'Shift should lunge').toBe(true);
    expect(lunged.some((f) => f >= 67 && f <= 85), 'and never jump').toBe(false);

    const parried = await tapAndWatch('ArrowUp', (f) => f === 150 || f === 169);
    expect(parried.some((f) => f === 150 || f === 169), 'Up should parry').toBe(true);
    expect(parried.some((f) => f >= 67 && f <= 85), 'and never jump').toBe(false);
    expect(consoleErrors).toEqual([]);
  }, 180000);

  /**
   * And the fight can be won. This one is driven entirely through the step
   * hook: a fight is a race between two hit point counts, and running it
   * on a headless browser's wall clock decides that race by how busy the
   * machine is.
   */
  it('the guard of level 2 can be killed', async () => {
    await meetTheGuard();
    const outcome = await page.evaluate(() => {
      const w = window as unknown as {
        __princeStep(n: number, c: object): unknown;
        __princeState(): {
          dead: boolean; guard: { hitPoints: number } | null;
        } | null;
      };
      for (let i = 0; i < 400; i++) {
        // Press forward, and lunge every twelfth tick.
        //
        // Not every other tick: `guard_advance` will not close the
        // distance while `kid_sword_strike` is still counting down from
        // the Prince's last lunge, and a lunge every other tick keeps it
        // topped up. The two then stand a blade and a half apart for as
        // long as the player likes. Lunging rarely enough for the count
        // to run out lets the guard come on, and the fight ends.
        w.__princeStep(1, i % 12 === 0 ? { shift: true } : { x: -1 });
        const s = w.__princeState();
        if (!s) return 'no state';
        if (s.dead) return 'the Prince died';
        if (s.guard && s.guard.hitPoints === 0) return 'killed';
      }
      return 'ran out of frames';
    });
    await pause(false);
    expect(outcome, 'the guard should go down').toBe('killed');
    expect(consoleErrors).toEqual([]);
  }, 180000);
});
