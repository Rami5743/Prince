/**
 * The cutscenes, on the page.
 *
 * `tests/pop/cutscene.test.ts` plays them against the translation.
 * This plays them where the player does: through the shell's own
 * clock, the canvas and the keyboard. A cutscene that is in `src/pop`
 * and not on the page does not exist, and the way out of a level is
 * the only path that puts one there.
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

interface SceneState {
  running: boolean;
  playing: { kind: string; level?: number };
  lit: number;
}

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
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

const sceneState = (): Promise<SceneState | null> => page.evaluate(
  () => (window as unknown as { __princeSceneState(): SceneState | null }).__princeSceneState(),
);

const gameState = (): Promise<{ level: number } | null> => page.evaluate(
  () => (window as unknown as { __princeState(): { level: number } | null }).__princeState(),
);

/** How many of the canvas's pixels are not black. */
const litOnCanvas = (): Promise<number> => page.evaluate(() => {
  const canvas = document.getElementById('screen') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] || data[i + 1] || data[i + 2]) n++;
  }
  return n;
});

describe('a cutscene on the page', () => {
  /**
   * The page opens on `show_title`, which is what `start_game` does
   * while `start_level < 0`. Before this it opened on one still
   * picture out of TITLE.DAT and nothing moved.
   */
  it('opens on the title sequence, and a key begins the game', async () => {
    expect((await sceneState())?.playing).toEqual({ kind: 'title' });
    expect((await sceneState())?.running).toBe(true);
    // `fade_in_2(offscreen_surface, 0x1000)` is sixty-four shades at
    // a sixtieth of a second each, so the picture takes a second to
    // come up out of black.
    await page.waitForTimeout(1500);
    expect(await litOnCanvas()).toBeGreaterThan(30000);
    // `do_paused` lets a key through the title, and the original
    // begins the game on it.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(
      () => (window as unknown as {
        __princeState(): { level: number } | null;
      }).__princeState()?.level === 1,
      null, { timeout: 20000 },
    );
    expect((await sceneState())?.running).toBe(false);
    expect(consoleErrors).toEqual([]);
  }, 60000);

  it('draws the princess\'s room onto the canvas', async () => {
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(true));
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string; level: number }): Promise<void>;
    }).__princePlayScene({ kind: 'level', level: 4 }));
    // Two seconds of the scene's own clock, stepped by hand so that
    // nothing here waits on the machine.
    await page.evaluate(() => {
      const w = window as unknown as { __princeSceneStep(ms: number): boolean };
      for (let i = 0; i < 120; i++) w.__princeSceneStep(1000 / 60);
    });
    const scene = await sceneState();
    expect(scene?.running).toBe(true);
    expect(scene?.playing).toEqual({ kind: 'level', level: 4 });
    // The room is a picture, not a few stray pixels, and it reached
    // the canvas and not only the translation's own surface.
    // Two thirds of the screen: the room's arches are its colour 0,
    // so a room drawn whole is about 42000 of the 64000 pixels.
    expect(scene!.lit).toBeGreaterThan(30000);
    expect(await litOnCanvas()).toBeGreaterThan(30000);
    expect(consoleErrors).toEqual([]);
  }, 60000);

  /**
   * The path the player takes: out of a level and into the next one,
   * with `tbl_cutscenes` deciding whether there is a scene in between.
   */
  it('plays itself between one level and the next, and then the level comes',
    async () => {
      consoleErrors.length = 0;
      await page.evaluate(() => (window as unknown as {
        __princePause(on: boolean): void;
      }).__princePause(false));
      await page.evaluate(() => (window as unknown as {
        __princeShow(level: number, room: number): Promise<void>;
      }).__princeShow(1, 1));
      await page.waitForTimeout(500);
      // Shift+L: `skipLevel`, which is the original's own way out.
      await page.keyboard.press('Shift+KeyL');
      await page.waitForFunction(
        () => (window as unknown as {
          __princeSceneState(): { running: boolean } | null;
        }).__princeSceneState()?.running === true,
        null, { timeout: 10000 },
      );
      const scene = await sceneState();
      expect(scene?.playing).toEqual({ kind: 'level', level: 2 });

      // It ends by itself and level 2 begins. `cutscene_2_6` is 4.8
      // seconds of the original's clock.
      await page.waitForFunction(
        () => (window as unknown as {
          __princeState(): { level: number } | null;
        }).__princeState()?.level === 2,
        null, { timeout: 30000 },
      );
      expect((await gameState())?.level).toBe(2);
      expect((await sceneState())?.running).toBe(false);
      expect(consoleErrors).toEqual([]);
    }, 60000);

  /**
   * **How long the transition takes, which the player has complained
   * about twice.**
   *
   * The whole of it, from the `shift+l` that ends level 1 to the
   * first frame of level 2, measured off a fresh capture of
   * `PRINCE.EXE`: level 1 goes black at 29.0 seconds (a hard cut,
   * not a fade), the princess's room fades in over 54 video frames
   * from 29.567 to 31.333, the scene holds to 35.0, the screen is
   * **black from 36.0 to 39.5** -- which is `play_level`'s
   * `while (check_sound_playing() && !do_paused()) idle();` -- and
   * level 2 is up at 40.0. Eleven point seven seconds, of which
   * about four are the wait.
   *
   * The port was **7.1** before the wait went in and is 11.1 now, in
   * three runs out of three on this page: the scene ends at 7.0 and
   * the level is up at 11.1, so the black wait is 4.0. The bands
   * below are wide enough for a loaded machine and narrow enough to
   * catch either fault -- the wait gone, or the scene not playing at
   * all.
   *
   * It is pinned here and not as a scene digest because what is
   * being measured is the **shell**: `nextLevel`, the wait and
   * `select` are `web/main.ts`'s, and no capture of a cutscene
   * reaches past the cutscene.
   */
  it('takes the original\'s eleven and a bit seconds, and four of them are black',
    async () => {
      consoleErrors.length = 0;
      await page.evaluate(() => (window as unknown as {
        __princePause(on: boolean): void;
      }).__princePause(false));
      await page.evaluate(() => (window as unknown as {
        __princeShow(level: number, room: number): Promise<void>;
      }).__princeShow(1, 1));
      await page.waitForTimeout(1200);
      const marks = await page.evaluate(async () => {
        const w = window as unknown as {
          __princeSceneState(): { running: boolean } | null;
          __princeState(): { level: number } | null;
          dispatchEvent(e: Event): boolean;
        };
        const t0 = performance.now();
        const out: Record<string, number> = {};
        w.dispatchEvent(new KeyboardEvent('keydown',
          { code: 'KeyL', key: 'L', shiftKey: true, bubbles: true }));
        w.dispatchEvent(new KeyboardEvent('keyup',
          { code: 'KeyL', key: 'L', shiftKey: true, bubbles: true }));
        let started = false;
        let ended = false;
        for (let i = 0; i < 3000; i++) {
          const scene = w.__princeSceneState();
          const game = w.__princeState();
          if (scene?.running && !started) { started = true; out.sceneStarts = performance.now() - t0; }
          if (started && scene && !scene.running && !ended) {
            ended = true; out.sceneEnds = performance.now() - t0;
          }
          if (game?.level === 2) { out.levelUp = performance.now() - t0; break; }
          await new Promise((r) => { setTimeout(r, 20); });
        }
        return out;
      });
      // The scene itself: `cutscene_2_6`, a fade in, twenty-six
      // cutscene frames and a fade out.
      expect(marks.sceneEnds, `the scene ran ${marks.sceneEnds}ms`)
        .toBeGreaterThan(5500);
      expect(marks.sceneEnds).toBeLessThan(9500);
      // `while (check_sound_playing() && !do_paused()) idle();`
      const black = marks.levelUp - marks.sceneEnds;
      expect(black, `the black wait was ${black}ms`).toBeGreaterThan(2500);
      expect(black).toBeLessThan(6000);
      // And the whole of it, against the capture's 11.7 seconds.
      expect(marks.levelUp, `the whole transition took ${marks.levelUp}ms`)
        .toBeGreaterThan(9500);
      expect(marks.levelUp).toBeLessThan(14000);
      expect(consoleErrors).toEqual([]);
    }, 90000);

  /**
   * `proc_cutscene_frame`:
   *
   *     if (!disable_keys && do_paused()) {
   *         stop_sounds();
   *         draw_rect(&screen_rect, color_0_black);
   *         return 1;
   *     }
   *
   * and `do_paused` ends on `return key || control_shift`, so any key
   * -- an arrow, the space bar, shift on its own -- ends a scene that
   * has not set `disable_keys`. The six between the levels have not.
   *
   * The shell took Escape and nothing else, which is the player's
   * "a long pause between the levels that cannot be skipped". The
   * original's own pause, measured off a capture of PRINCE.EXE: the
   * level 1 to 2 transition is 11.7 seconds from the `shift+l` to
   * level 2 being on the screen, four of them a black screen waiting
   * on the music -- and one key at any point in it ends the lot.
   */
  it('any key cuts a scene between two levels short', async () => {
    consoleErrors.length = 0;
    await page.evaluate(() => (window as unknown as {
      __princePause(on: boolean): void;
    }).__princePause(false));
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string; level: number }): Promise<void>;
    }).__princePlayScene({ kind: 'level', level: 6 }));
    await page.waitForTimeout(400);
    expect((await sceneState())?.running, 'it is playing').toBe(true);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    // What follows a scene here is whatever the shell queued behind
    // it -- the title, for a scene started by hand -- so the test is
    // that the *level's* scene is over, not that nothing is playing.
    expect((await sceneState())?.playing, 'an arrow key ends it')
      .not.toEqual({ kind: 'level', level: 6 });
    expect(consoleErrors).toEqual([]);
  }, 60000);

  it('a key does not cut the ending short, and Escape does', async () => {
    consoleErrors.length = 0;
    await page.evaluate(() => (window as unknown as {
      __princePlayScene(s: { kind: string }): Promise<void>;
    }).__princePlayScene({ kind: 'ending' }));
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    expect((await sceneState())?.running, 'an arrow key is ignored').toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // Escape stops it, and what follows the ending is `start_game()`:
    // the title, which is why this is not simply "nothing is playing".
    expect((await sceneState())?.playing).toEqual({ kind: 'title' });
    expect(consoleErrors).toEqual([]);
  }, 60000);
});
