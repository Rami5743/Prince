/**
 * Every sound the game has, read and played in a real browser.
 *
 * The exit door was silent on the page for the whole life of the
 * port and nothing in this project could see it.
 * `sound_15_leveldoor_sliding` is recorded at 2750 Hz, Chromium's
 * `createBuffer` throws under 3000, `SoundPlayer.read` caught the
 * throw and wrote index 15 down as "neither a recording nor a tune",
 * and every `play(15)` for the rest of the session returned on that
 * one line. `tools/dev/sound-report.ts` read the door as exact,
 * because neither side of that comparison goes through a browser.
 *
 * So this is the check that was missing: ask the page to read
 * **every** index the game can raise, through its own
 * `AudioContext`, and let it say which ones it could not. The
 * companion to `tests/render/every-sound.test.ts`, which pins that
 * every index of `soundids` has a recording, a tune or a beep behind
 * it in the game's own files: that one says the bytes are there,
 * this one says the browser can play them.
 *
 * The second half plays each index for real and counts the
 * `AudioContext` nodes that started, because a sound that reads and
 * then starts nothing is the same silence by another road.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';
import { soundids } from '../../src/pop/types.ts';

const PORT = 8133;
let server: Server;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];

beforeAll(async () => {
  server = (await serve(PORT, REPO)) as Server;
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
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.addInitScript(() => {
    const w = window as unknown as { __started: string[] };
    w.__started = [];
    const Ctx = window.AudioContext;
    window.AudioContext = class extends Ctx {
      createBufferSource(): AudioBufferSourceNode {
        const node = super.createBufferSource();
        const start = node.start.bind(node);
        node.start = ((...a: unknown[]) => {
          w.__started.push(`buffer:${node.buffer?.duration.toFixed(3) ?? '?'}`);
          return (start as (...x: unknown[]) => void)(...a);
        }) as typeof node.start;
        return node;
      }
      createOscillator(): OscillatorNode {
        const node = super.createOscillator();
        const start = node.start.bind(node);
        let first = true;
        node.start = ((...a: unknown[]) => {
          if (first) { first = false; w.__started.push('tune'); }
          return (start as (...x: unknown[]) => void)(...a);
        }) as typeof node.start;
        return node;
      }
    } as unknown as typeof AudioContext;
  });
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

describe('the game\'s sounds, in a browser', () => {
  it('every index of the game reads', async () => {
    const failed = await page.evaluate(async () => {
      const w = window as unknown as {
        __princeSoundFailures(): Promise<[number, string][]>;
      };
      return w.__princeSoundFailures();
    });
    expect(failed, `these would not read: ${JSON.stringify(failed)}`).toEqual([]);
    expect(consoleErrors).toEqual([]);
  }, 120000);

  /**
   * And each one of the fifty-odd `soundids` really starts something.
   *
   * A sound asked for while another is in the channel is refused by
   * `play_next_sound`'s own rule, so the channel is stopped between
   * each -- `__princePlaySound` does that -- and each index is given
   * a moment to land.
   */
  it('and every soundid starts a node when it is played', async () => {
    const indices = [...new Set(Object.values(soundids) as number[])]
      .filter((i) => i > 0).sort((a, b) => a - b);
    const silent = await page.evaluate(async (list) => {
      const w = window as unknown as {
        __princePlaySound(i: number): void;
        __princeMute(on: boolean): void;
        __started: string[];
      };
      w.__princeMute(false);
      const out: number[] = [];
      for (const i of list) {
        w.__started.length = 0;
        w.__princePlaySound(i);
        await new Promise((r) => setTimeout(r, 60));
        if (w.__started.length === 0) out.push(i);
      }
      return out;
    }, indices);
    expect(silent, `these played nothing: ${JSON.stringify(silent)}`).toEqual([]);
  }, 180000);
});
