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
  // Use the browser that is already installed in this environment rather than
  // whatever revision the npm package expects.
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      // `--autoplay-policy=no-user-gesture-required`: without it the
      // page holds on a black screen until the player touches it,
      // because the opening is not started into a context the browser
      // will not let sound. `tests/browser/sound-gate.test.ts` is the
      // one that launches without the flag and tests that hold.
      ? { executablePath: preinstalled,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
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

  it('has no level or room menu to play the game from', async () => {
    const menus = await page.evaluate(() => [
      document.getElementById('scene'), document.getElementById('room'),
    ].filter(Boolean).length);
    expect(menus, 'the game is played from its own title screen').toBe(0);
  });

  it('keeps the keys away from the page, which would swallow them', async () => {
    await playLevel(3);
    const before = await page.evaluate(() =>
      (document.getElementById('setting-aspect') as HTMLSelectElement).value);
    await page.focus('#setting-aspect');
    await page.keyboard.down('Numpad9');
    await page.keyboard.up('Numpad9');
    await page.keyboard.down('ArrowDown');
    await page.keyboard.up('ArrowDown');
    const after = await page.evaluate(() =>
      (document.getElementById('setting-aspect') as HTMLSelectElement).value);
    expect(after).toBe(before);
  });

  /**
   * A browser has no `process`, so anything that reaches for it throws where
   * Node would not. This plays the moves that are easy to leave untested --
   * falling, taking hold of a ledge, jumping -- and then insists the console
   * stayed clean.
   */
  it('plays falling, grabbing and jumping without touching anything Node-only', async () => {
    const before = consoleErrors.length;
    await page.evaluate(() => {
      const step = (window as unknown as {
        __princeStep(n: number, c: Record<string, unknown>): unknown;
      }).__princeStep;
      step(22, {});
      step(20, { x: 1, shift: true }); // careful steps, then over the edge
      step(20, { x: 1 }); // run and fall
      step(20, { x: 1, y: -1 }); // jump
      step(20, { x: -1, y: 1 }); // turn, crouch
    });
    expect(consoleErrors.slice(before)).toEqual([]);
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
