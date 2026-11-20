/**
 * The flash, counted on the canvas the player looks at.
 *
 * `play_level_2` is `draw_game_frame(); flash_if_hurt();
 * remove_flash_if_hurt(); do_simple_wait(timer_1);` and `do_flash`
 * is `set_timer_length(timer_2, 2); set_bg_attr(0, color);
 * do_simple_wait(timer_2)`. So the colour is up for a sixtieth or
 * two of a five-sixtieth tick and the screen is normal for the rest:
 * a flash is a *blink* at twelve a second, repeated `flash_time`
 * times.
 *
 * A capture of `PRINCE.EXE` grabbed at sixty frames a second says
 * exactly that. `addlife2`'s `shift+t` on level 2 (`flash_color` 4,
 * `flash_time` 4), each frame's share of the screen that is pure
 * black:
 *
 *     frame  3380 3381 3382 3383 3384 3385 3386 3387 3388 3389
 *     black% 43.1 43.1 43.1 43.1  0.0 43.1 43.1 43.1 43.1  0.0
 *
 * -- four flashed frames, 3384, 3389, 3394, 3399: one video frame
 * each, five apart, which is one tick. The port used to hold the
 * colour for the whole tick, so four ticks of `shift+t` were twenty
 * frames of solid red and eight ticks of a sword were two thirds of
 * a second of solid yellow. "The flash when picking up the sword and
 * when drinking a potion is not the original's."
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8130;
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
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

/**
 * How many of the next `n` animation frames have the screen flashed.
 *
 * The game's own `requestAnimationFrame` callback was registered
 * first and re-registers itself at the top of each one, so this
 * reads the canvas after the game has presented that frame.
 */
function watch(n: number): Promise<{ flashed: number; plain: number }> {
  return page.evaluate((frames: number) => new Promise((resolve) => {
    const canvas = document.getElementById('screen') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let flashed = 0;
    let plain = 0;
    let left = frames;
    const look = (): void => {
      // Row 2 of the room, which is sky-less dungeon wall: black
      // while nothing is flashing, the flash colour while something
      // is. Counted over the row so one stray pixel cannot decide it.
      const row = ctx.getImageData(0, 4, canvas.width, 1).data;
      let red = 0;
      let black = 0;
      for (let i = 0; i < row.length; i += 4) {
        if (row[i] === 0 && row[i + 1] === 0 && row[i + 2] === 0) black += 1;
        else if (row[i] > 120 && row[i + 1] < 80 && row[i + 2] < 80) red += 1;
      }
      if (red > black) flashed += 1; else plain += 1;
      if (--left > 0) requestAnimationFrame(look);
      else resolve({ flashed, plain });
    };
    requestAnimationFrame(look);
  }), n);
}

describe('the flash on the page', () => {
  it('blinks once a tick instead of staying up for the whole of it', async () => {
    await page.evaluate(() => (window as unknown as {
      __princeShow(level: number, room: number): Promise<void>;
    }).__princeShow(1, 1));
    await page.waitForTimeout(2500);

    // Nothing is flashing: every frame is the plain picture.
    const quiet = await watch(30);
    expect(quiet.flashed, 'nothing flashes on its own').toBe(0);

    // Shift+T: `add_life`, four ticks of red.
    await page.keyboard.press('Shift+KeyT');
    const seen = await watch(45);

    // Four ticks of flash in 45 frames is four blinks; held for the
    // whole of each tick it would be about twenty frames.
    expect(seen.flashed, 'the flash happens at all').toBeGreaterThanOrEqual(1);
    expect(seen.flashed, 'and it is a blink, not a hold').toBeLessThanOrEqual(8);
    expect(seen.plain, 'most of the time the screen is its own').toBeGreaterThan(30);
  }, 60000);

  it('threw nothing', () => {
    expect(consoleErrors).toEqual([]);
  });
});
