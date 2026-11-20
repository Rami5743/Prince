/**
 * `potion.html`, the page the player opens.
 *
 * It is the same bundle as `index.html` -- the same `PopGame`, the
 * same renderer, the same sound -- with one thing set before the
 * module runs: `window.__princePotionLevel`. `web/main.ts` then
 * fetches `LEVELS.DAT` through `levelsDatWithPotionLevel` and opens
 * on that level instead of on the title. This pins both halves: that
 * the page really is the potion level, and that a potion can be
 * drunk on it the way a player would drink one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';
import { POTION_LEVEL_NUMBER, POTION_PLACES } from '../../src/dat/potion-level.ts';

const PORT = 8134;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

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
  // The page GitHub Pages serves, not the one in `web/`.
  await page.goto(`http://localhost:${PORT}/potion.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

describe('the potion page', () => {
  it('opens on the potion level with the Prince beside the first flask', async () => {
    const state = await page.evaluate(() => (window as unknown as {
      __princeState(): { level: number; room: number; hitPoints: number } | null;
    }).__princeState());
    expect(consoleErrors).toEqual([]);
    expect(state?.level).toBe(POTION_LEVEL_NUMBER);
    expect(state?.room).toBe(1);
    expect(state?.hitPoints).toBe(3);
  });

  /**
   * And a flask can be drunk with the keyboard.
   *
   * A potion is drunk by walking up to it and pressing Shift, which
   * is `control_standing`'s
   * `control_shift2 == CONTROL_HELD && control_shift == CONTROL_HELD`
   * -- a latch, so the key has to go down again rather than be held.
   * How far one tap of Right carries him depends on where in a
   * stride he is, so this walks the corridor pressing Shift as it
   * goes and asks only that a flask answered: `sound_18_drink` is
   * the swallow that every one of the six plays, and
   * `sound_39_low_weight` is the green one, which is the whole
   * reason this level exists -- the game's own feather is at the
   * bottom of a shaft in level 7 and nothing has ever reached it.
   * What each potion *does* is `tests/pop/potion-level.test.ts`,
   * where the walk can be exact.
   */
  it('lets a player drink a flask with the keyboard, the feather among them', async () => {
    const heardSoFar = async (): Promise<number[]> => page.evaluate(
      () => (window as unknown as { __princeHeard(): number[] }).__princeHeard());
    for (let step = 0; step < 16; step++) {
      if ((await heardSoFar()).includes(39)) break;
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(120);
      await page.keyboard.up('ArrowRight');
      await page.waitForTimeout(400);
      for (let i = 0; i < 4; i++) {
        await page.keyboard.down('Shift');
        await page.waitForTimeout(140);
        await page.keyboard.up('Shift');
        await page.waitForTimeout(240);
      }
    }
    const heard = await heardSoFar();
    expect(heard, 'the swallow').toContain(18);
    expect(heard, 'sound_39_low_weight, the feather').toContain(39);
    expect(consoleErrors).toEqual([]);
  }, 180000);
});
