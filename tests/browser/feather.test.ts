/**
 * The feather, heard in a real browser.
 *
 * `sound_39_low_weight` is the longest thing the game plays in a
 * level and the only effect whose **length is the effect**: `timers`
 * (`seg003:0735`) counts `is_feather_fall` up and clears it the
 * moment `check_sound_playing()` goes quiet, so the potion lasts
 * exactly as long as the sound is in the channel. It is also
 * `sound_interruptible[39] = 0` at priority 0, so `play_next_sound`
 * refuses every footstep, gate and landing while it lasts.
 *
 * A capture of `PRINCE.EXE` taking the same `shift+w` settles both:
 * `tools/oracle/sounds/feather1snd.json` reads **one unbroken noise
 * of 18.598 seconds** with nothing else in it, where the Prince is
 * asking for a footstep every four ticks throughout.
 *
 * The page had freed its channel after **18.00** of those seconds,
 * because `Tune` ended at its last note where `MIDISND1.DAT`'s own
 * sequence runs to 18.667. That is what this pins: the tune's length
 * is the sequence's, not the last note's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

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
      ? { executablePath: preinstalled,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
  page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  await page.addInitScript(() => {
    const Ctx = window.AudioContext;
    window.AudioContext = class extends Ctx {
      constructor(...a: unknown[]) {
        super(...(a as []));
        (window as unknown as { __ctx: AudioContext }).__ctx = this;
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

describe('the feather, on the page', () => {
  /**
   * Level 1, the Prince walking back and forth so that a footstep is
   * asked for every few ticks, and `shift+w` ten ticks in. The run is
   * stepped at the player's own clock, because what is being measured
   * is the audio device's.
   */
  it('holds the one channel for the whole of its tune and no longer', async () => {
    const log = await page.evaluate(async () => {
      interface W {
        __princePause(on: boolean): void;
        __princeGoToLevel(l: number): void;
        __princeStep(n: number, c: unknown): unknown;
        __princeCommand(k: string): boolean;
        __princeHeard(): number[];
        __princeMute(on: boolean): void;
        __ctx: AudioContext;
      }
      const w = window as unknown as W;
      w.__princePause(true);
      w.__princeGoToLevel(1);
      await new Promise((r) => setTimeout(r, 600));
      /**
       * Out of the opening, muted and as fast as the browser will
       * go. `control_crouched` holds the Prince down until
       * `sound_25_presentation` has finished -- that is the game, not
       * the page -- and a feather taken while he is still crouched
       * makes no footstep to count.
       */
      w.__princeMute(true);
      for (let t = 0; t < 60; t++) w.__princeStep(1, { x: 1 });
      w.__princeMute(false);
      const ctx = w.__ctx;
      const t0 = ctx.currentTime;
      let prev = w.__princeHeard().length;
      const rows: { at: number; got: number[] }[] = [];
      let tick = 0;
      await new Promise<void>((done) => {
        const id = setInterval(() => {
          if (tick >= 260) { clearInterval(id); done(); return; }
          if (tick === 10) w.__princeCommand('shift+w');
          // Right for twenty-five ticks, then Left: he keeps running,
          // so `sound_23_footstep` is asked for all the way through.
          w.__princeStep(1, { x: (Math.floor(tick / 25) % 2) ? -1 : 1 });
          const h = w.__princeHeard();
          if (h.length > prev) {
            rows.push({ at: +(ctx.currentTime - t0).toFixed(3), got: h.slice(prev) });
            prev = h.length;
          }
          tick++;
        }, 1000 / 12);
      });
      return rows;
    });
    expect(consoleErrors).toEqual([]);

    const feather = log.find((r) => r.got.includes(39));
    expect(feather, `nothing played 39: ${JSON.stringify(log)}`).toBeTruthy();
    const after = log.filter((r) => r.at > feather!.at);
    expect(after.length, 'nothing was heard after the feather at all').toBeGreaterThan(0);
    const gap = after[0].at - feather!.at;
    // 18.667 s is `MIDISND1.DAT`'s own sequence; the steps that ask
    // for a footstep are four ticks apart, so the first one back can
    // be up to a third of a second later than the channel is free.
    expect(gap, `the channel was free again after ${gap.toFixed(3)}s`)
      .toBeGreaterThan(18.5);
    expect(gap, `the channel was still busy after ${gap.toFixed(3)}s`)
      .toBeLessThan(19.4);
  }, 180000);
});
