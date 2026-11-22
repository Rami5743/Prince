/**
 * The release the page's sound tables come from, read off the page.
 *
 * `tests/render/sound-priority.test.ts` pins the tables themselves.
 * This pins the other half, which no unit test can see: that the
 * settings store, the panel and the renderer are joined up, that a
 * stored choice is in force before the player touches anything, and
 * that **the quality setting does not move it** -- the quality is
 * which voice plays a sound, the release is which sound wins a tick,
 * and the player chose them separately.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';

/** The port is assigned, never chosen: a number nobody picks cannot clash. */
let browser: Browser;
let server: Server;
let base = '';

beforeAll(async () => {
  server = (await serve(0, REPO)) as Server;
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const preinstalled = '/opt/pw-browsers/chromium';
  browser = await chromium.launch(
    existsSync(preinstalled)
      ? { executablePath: preinstalled,
          args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function open(stored: Record<string, string>) {
  const page = await browser.newPage();
  await page.addInitScript((s) => {
    try {
      window.localStorage.setItem('prince.settings.v1', JSON.stringify(s));
    } catch { /* a private window: the defaults then, which is the point */ }
  }, { language: 'en', quality: 'original', graphics: 'original',
       music: 'original', map: 'original', aspect: 'original-4-3', ...stored });
  await page.goto(`${base}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof (window as never as { __princeSoundRelease?: unknown })
      .__princeSoundRelease === 'function',
    null, { timeout: 30_000 },
  );
  return page;
}

const release = (page: Awaited<ReturnType<typeof open>>): Promise<string> =>
  page.evaluate(() => (window as never as
    { __princeSoundRelease: () => string }).__princeSoundRelease());

describe('the release the page plays', () => {
  it('is 1.0 when nothing was chosen', async () => {
    const page = await open({});
    expect(await release(page)).toBe('1.0');
    await page.close();
  }, 120_000);

  it('is 1.3 before the player touches anything, when that was stored', async () => {
    const page = await open({ music: '1.3' });
    // The sound is built behind the opening page, so the choice has to
    // survive the gesture that lets the page sound.
    await page.evaluate(() => (window as never as
      { __princeDismissOpening: () => void }).__princeDismissOpening());
    expect(await release(page)).toBe('1.3');
    await page.close();
  }, 120_000);

  it('follows the panel, both ways, with no reload', async () => {
    const page = await open({});
    const pick = async (value: string): Promise<void> => {
      await page.evaluate((v) => {
        const select = [...document.querySelectorAll('select')]
          .find((s) => [...s.options].some((o) => o.value === '1.3'));
        if (!select) throw new Error('no release control on the page');
        select.value = v;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    };
    await pick('1.3');
    expect(await release(page)).toBe('1.3');
    await pick('original');
    expect(await release(page)).toBe('1.0');
    await page.close();
  }, 120_000);

  it('does not move when the quality does', async () => {
    const page = await open({ music: '1.3' });
    await page.evaluate(() => {
      const select = [...document.querySelectorAll('select')]
        .find((s) => [...s.options].some((o) => o.value === 'high'));
      if (!select) throw new Error('no quality control on the page');
      select.value = 'high';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(await release(page)).toBe('1.3');
    await page.close();
  }, 120_000);
});
