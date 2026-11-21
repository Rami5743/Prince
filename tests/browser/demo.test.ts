/**
 * The title loop, on the page the player actually loads.
 *
 * `show_title` ends in `init_game(0)`, and the demo level ends in
 * `start_game()`, so the original's opening goes round and round
 * until somebody presses a key. The port stopped at the top of level
 * 1 instead: the title played once and that was the end of it.
 *
 * This is the repository root -- `index.html` and `game.js`, the
 * GitHub Pages bundle -- because a loop that is in `src/pop` and not
 * in the bundle is not one the player ever sees.
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

interface GameState { level: number; demo: boolean; frame: number; room: number }

beforeAll(async () => {
  server = (await serve(0, REPO)) as Server;
  PORT = (server.address() as { port: number }).port;
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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
  /**
   * Silence. This test drives a scene with `__princeSceneStep`, a
   * hundred and fifty times faster than the clock, and `show_title`
   * waits three times on `while (check_sound_playing())` -- which
   * the audio answers on the wall clock. Until this round the page
   * never sounded at all and the waits fell straight through; now
   * they are real, and a test that drives has to mute.
   */
  await page.evaluate(() => (window as unknown as
    { __princeMute(on: boolean): void }).__princeMute(true));
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const gameState = (): Promise<GameState | null> => page.evaluate(
  () => (window as unknown as { __princeState(): GameState | null }).__princeState(),
);

/** Run whatever scene is playing to its end, on its own clock. */
const finishScene = (): Promise<void> => page.evaluate(() => {
  const w = window as unknown as { __princeSceneStep(ms: number): boolean };
  for (let i = 0; i < 60 * 150; i++) if (!w.__princeSceneStep(1000 / 60)) break;
});

describe('the title loop on the root bundle', () => {
  it('ends the title in the demo, which plays itself', async () => {
    // The page opens on `show_title`; drive it to its end by hand so
    // that nothing here waits on the machine's clock.
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await finishScene();
    // `init_game(0)`, which is the last line of `show_title`.
    await page.waitForFunction(
      () => (window as unknown as { __princeState(): GameState | null })
        .__princeState()?.demo === true,
      null, { timeout: 20000 },
    );
    const start = await gameState();
    expect(start?.level).toBe(0);
    expect(start?.room).toBe(1);

    // It plays itself with nothing pressed: `do_demo` writes the
    // controls and `control()` acts on them. A hundred ticks takes
    // him out of room 1 and into room 2.
    await page.evaluate(() => (window as unknown as {
      __princeStep(n: number): unknown;
    }).__princeStep(100));
    const moved = await gameState();
    expect(moved?.room).toBe(2);
    expect(consoleErrors).toEqual([]);
  }, 120000);

  it('comes back round to the title when the demo is over', async () => {
    consoleErrors.length = 0;
    // The rest of the demo: either the Prince runs out into room 24,
    // or he loses the fight and the words that replace `Press Button
    // to Continue` expire. Both are `start_level = -1; start_game()`.
    // The fight reads `prandom`, whose seed is the clock here as it
    // is in the C, so which of the two this is varies by run.
    await page.evaluate(() => (window as unknown as {
      __princeStep(n: number): unknown;
    }).__princeStep(1200));
    // The frame loop is what acts on it, so let the page run again.
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(false));
    await page.waitForFunction(
      () => {
        const w = window as unknown as {
          __princeState(): unknown; __princeSceneState(): { running: boolean } | null;
        };
        return w.__princeState() === null && w.__princeSceneState()?.running === true;
      },
      null, { timeout: 30000 },
    );
    expect((await page.evaluate(() => (window as unknown as {
      __princeSceneState(): { playing: { kind: string } } | null;
    }).__princeSceneState()?.playing))).toEqual({ kind: 'title' });
    expect(consoleErrors).toEqual([]);
  }, 60000);

  it('a key during the demo begins the real game at level 1', async () => {
    consoleErrors.length = 0;
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await finishScene();
    await page.waitForFunction(
      () => (window as unknown as { __princeState(): GameState | null })
        .__princeState()?.demo === true,
      null, { timeout: 20000 },
    );
    // `control_kid`'s own `key_test_quit()`:
    // `start_level = custom->first_level; start_game()`.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      () => (window as unknown as { __princeState(): GameState | null })
        .__princeState()?.level === 1,
      null, { timeout: 20000 },
    );
    expect((await gameState())?.demo).toBe(false);
    expect(consoleErrors).toEqual([]);
  }, 120000);
});
