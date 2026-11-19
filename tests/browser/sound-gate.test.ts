/**
 * The opening was played to nobody, on every page load.
 *
 * A browser will not let a page make a noise until the player has
 * touched it. `show_title` is the first thing the page does, so
 * every sound and every tune of the opening went into
 * `SoundPlayer.play`'s `if (!this.woken) return` and was dropped --
 * and `sound-report.ts` scores the title at 212 notes of 212, which
 * is the clearest possible statement that the model was right and
 * the page was not.
 *
 * It was worse than silence. `show_title` stops dead at
 * `while (check_sound_playing())` three times over, and with nothing
 * ever in the channel all three fall through at once, so the opening
 * ran at the wrong speed as well as mute.
 *
 * So the page holds on the game's own black screen until the context
 * is allowed to run. This test is the only one in the suite launched
 * **without** `--autoplay-policy=no-user-gesture-required`, which is
 * what the player's browser is like: it checks that the page waits,
 * that it says so, that a key starts it, and that the opening then
 * actually sounds.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

const PORT = 8143;
let server: Server;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = (await serve(PORT, REPO)) as Server;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? { executablePath: preinstalled, args: ['--no-sandbox'] }
      : {},
  );
  page = await browser.newPage();
  /**
   * The browser's own policy, put back.
   *
   * **Headless Chromium has none**: an `AudioContext` made with no
   * gesture at all reports `running`, with
   * `--autoplay-policy=document-user-activation-required`,
   * `user-gesture-required` and no flag alike (measured, all four
   * come back `running -> running`). So the thing that broke the
   * opening cannot be reproduced by a flag, and the policy is put
   * back here instead: `state` reads `suspended` and `resume()` does
   * nothing until the window has seen a key or a tap, which is what
   * a real browser does.
   *
   * Every `start()` the page's audio makes is counted with it.
   */
  await page.addInitScript(() => {
    const w = window as unknown as { __starts: string[] };
    w.__starts = [];
    let gesture = false;
    window.addEventListener('keydown', () => { gesture = true; }, true);
    window.addEventListener('pointerdown', () => { gesture = true; }, true);
    const proto = AudioContext.prototype as unknown as Record<string, unknown>;
    const real = Object.getOwnPropertyDescriptor(AudioContext.prototype, 'state')
      ?? Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(AudioContext.prototype) as object, 'state');
    const realGet = real?.get as (() => string) | undefined;
    if (realGet) {
      Object.defineProperty(AudioContext.prototype, 'state', {
        configurable: true,
        get(this: AudioContext) { return gesture ? realGet.call(this) : 'suspended'; },
      });
    }
    const realResume = proto.resume as () => Promise<void>;
    proto.resume = function (this: AudioContext): Promise<void> {
      return gesture ? realResume.call(this) : Promise.resolve();
    };
    const count = (o: { start?: unknown }, label: string): void => {
      const orig = o.start as ((...a: unknown[]) => void) | undefined;
      if (!orig) return;
      (o as { start: unknown }).start = function (...a: unknown[]): void {
        w.__starts.push(label);
        orig.apply(this, a);
      };
    };
    count(AudioBufferSourceNode.prototype as unknown as { start?: unknown }, 'buffer');
    count(OscillatorNode.prototype as unknown as { start?: unknown }, 'osc');
  });
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'load' });
  // Not `__princeReady`: that is set once the opening is running,
  // which is the thing this test says must not happen yet.
  await page.waitForFunction('window.__princeWaitingForSound === true',
    null, { timeout: 30000 });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const lit = (): Promise<number> =>
  page.evaluate(() => {
    const w = window as unknown as { __princeSceneState?: () => { lit: number } | null };
    return w.__princeSceneState?.()?.lit ?? -1;
  });

describe('the page waits until it can make a noise', () => {
  it('holds on a black screen and says so', async () => {
    await page.waitForTimeout(2500);
    expect(await page.evaluate(() =>
      (window as unknown as { __princeReady?: boolean }).__princeReady ?? false)).toBe(false);
    // No scene at all: `show_title` has not been begun.
    expect(await lit()).toBe(-1);
    expect(await page.textContent('#status')).toBe('press any key to begin');
    const starts = await page.evaluate(() =>
      (window as unknown as { __starts: string[] }).__starts.length);
    expect(starts).toBe(0);
  }, 60000);

  it('the first key starts the opening, and the opening sounds', async () => {
    await page.keyboard.press('Space');
    // The scene begins and the title picture lights up.
    await page.waitForFunction(() => {
      const w = window as unknown as { __princeSceneState?: () => { lit: number } | null };
      return (w.__princeSceneState?.()?.lit ?? 0) > 1000;
    }, null, { timeout: 30000 });
    // `show_title` plays sound 54, the intro music, on its second
    // picture. It is a tune on the speaker and a MIDI track in
    // `MIDISND1.DAT`; either way something has to start.
    await page.waitForFunction(() =>
      (window as unknown as { __starts: string[] }).__starts.length > 0,
      null, { timeout: 30000 });
    const starts = await page.evaluate(() =>
      (window as unknown as { __starts: string[] }).__starts.length);
    expect(starts).toBeGreaterThan(0);
  }, 120000);

  it('and the key that started it is not also a key that skips it', async () => {
    // The scene is still running: the gesture was spent on waking the
    // context, and `do_paused`'s "any key" begins from the frame after.
    const running = await page.evaluate(() => {
      const w = window as unknown as { __princeSceneState?: () => { running: boolean } | null };
      return w.__princeSceneState?.()?.running ?? false;
    });
    expect(running).toBe(true);
  }, 60000);
});
