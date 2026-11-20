/**
 * The pause, where the player meets it.
 *
 * `do_paused` at `seg000:148D` is
 *
 *     if (is_paused) {
 *         display_text_bottom("GAME PAUSED");
 *         is_paused = 0;
 *         do { idle(); delay_ticks(1); } while (! process_key());
 *         erase_bottom_text(1);
 *     }
 *
 * and `process_key`'s own `case SDL_SCANCODE_ESCAPE` sets
 * `is_paused = 1` and returns the key. So the busy wait ends on
 * **any** key with `is_paused` already nought -- and if that key was
 * Escape it has just been set back to 1, so `play_frame` plays
 * exactly one tick and the next one pauses again. Escape is the
 * original's frame advance; every other key resumes.
 *
 * The page used to swallow the key -- `if (game.paused) {
 * e.preventDefault(); game.paused = false; return; }` -- so Escape
 * never reached `process_key` and resumed like everything else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8129;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

interface PageState {
  ticks: number;
  paused: boolean;
  frame: number;
  room: number;
  level: number;
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
  page = await browser.newPage();
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

/** Level 1, playing, with the opening fall behind it. */
async function startLevel(): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    __princeShow(level: number, room: number): Promise<void>;
  }).__princeShow(1, 1));
  await page.waitForTimeout(2500);
}

describe('Escape', () => {
  it('pauses, then advances one tick at a time, then a key resumes', async () => {
    await startLevel();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const held = await state();
    expect(held?.paused, 'Escape pauses').toBe(true);

    // Paused: the game does not play on.
    await page.waitForTimeout(600);
    const still = await state();
    expect(still?.ticks, 'nothing plays while it is paused').toBe(held?.ticks);

    // Escape again: exactly one tick, and paused again.
    for (let i = 1; i <= 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const after = await state();
      expect(after?.ticks, `Escape ${i} advances one tick`).toBe((held?.ticks ?? 0) + i);
      expect(after?.paused, `Escape ${i} leaves it paused`).toBe(true);
    }

    // Any other key resumes.
    const before = await state();
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const running = await state();
    expect(running?.paused, 'another key resumes').toBe(false);
    expect(running?.ticks, 'and the game plays on').toBeGreaterThan((before?.ticks ?? 0) + 3);
  }, 60000);

  it('threw nothing', () => {
    expect(consoleErrors).toEqual([]);
  });
});
