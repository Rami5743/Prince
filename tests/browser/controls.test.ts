/**
 * The keys, against `read_keyb_control`.
 *
 * `seg000:1500` is four lists, and they are not the four a keyboard
 * suggests:
 *
 *     up     UP, HOME, PAGEUP, KP_8, KP_7, KP_9
 *     down   DOWN, CLEAR, KP_5, KP_2
 *     left   LEFT, HOME, KP_4, KP_7
 *     right  RIGHT, PAGEUP, KP_6, KP_9
 *
 * Two of those the page did not have, and both are keys a player
 * presses: **`KP_5` is `down`**, where the page had it standing for
 * no direction at all, and **Home and PageUp are the diagonals**,
 * each in two lists at once -- on a keyboard with no numeric keypad
 * they are the only way to jump diagonally with the keys the
 * original names, and the page had neither.
 *
 * Nothing in the project could see this. `pop-report.ts` and
 * `page-port.ts` both hand the game a `{x, y, shift}` and never go
 * through `directionsOf` at all; `__princeHold` takes a direction by
 * name. So the only way to measure it is a real `KeyboardEvent` on
 * the page, which is what this is.
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

beforeAll(async () => {
  server = (await serve(0, REPO)) as Server;
  PORT = (server.address() as { port: number }).port;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? {
        executablePath: preinstalled,
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
      }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
  page = await browser.newPage();
  await page.addInitScript(
    'window.__name = window.__name || function (f) { return f; };');
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 60000 });
  await page.evaluate(async () => {
    const w = window as unknown as {
      __princeEnterLevel(l: number): Promise<void>;
      __princePause(on: boolean): void;
      __princeMute(on: boolean): void;
    };
    w.__princeMute(true);
    w.__princePause(true);
    await w.__princeEnterLevel(1);
  });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

/** What `held` holds after this key goes down, and after it comes up. */
async function pressing(code: string): Promise<{ down: string[]; up: string[] }> {
  return page.evaluate((c) => {
    const w = window as unknown as { __princeState(): { held: string[] } | null };
    const fire = (type: string): void => {
      window.dispatchEvent(new KeyboardEvent(type, {
        key: c, code: c, bubbles: true,
      }));
    };
    fire('keydown');
    const down = [...(w.__princeState()?.held ?? [])].sort();
    fire('keyup');
    const up = [...(w.__princeState()?.held ?? [])].sort();
    return { down, up };
  }, code);
}

describe('the keys the original reads', () => {
  const cases: [string, string[]][] = [
    // The C's four lists, key by key.
    ['ArrowUp', ['up']],
    ['ArrowDown', ['down']],
    ['ArrowLeft', ['left']],
    ['ArrowRight', ['right']],
    ['Numpad8', ['up']],
    ['Numpad2', ['down']],
    ['Numpad4', ['left']],
    ['Numpad6', ['right']],
    // `KP_7` and `KP_9` are in two lists each, and so are the two
    // keys beside them in the navigation cluster.
    ['Numpad7', ['left', 'up']],
    ['Numpad9', ['right', 'up']],
    ['Home', ['left', 'up']],
    ['PageUp', ['right', 'up']],
    // `KP_5` is `control_y = CONTROL_HELD_DOWN`, not nothing.
    ['Numpad5', ['down']],
  ];
  for (const [code, want] of cases) {
    it(`${code} is ${want.join('+') || 'nothing'}`, async () => {
      const got = await pressing(code);
      expect(got.down).toEqual(want);
      expect(got.up, 'and letting go lets go of all of them').toEqual([]);
    }, 30000);
  }

  it('a key the game does not read is left to the page', async () => {
    const got = await pressing('KeyQ');
    expect(got.down).toEqual([]);
  }, 30000);
});
