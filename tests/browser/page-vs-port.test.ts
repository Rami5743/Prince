/**
 * The game the player plays, against the game the suite measures.
 *
 * Every score in this project is of `src/pop` and `src/render`
 * through a stand-in: `pop-report.ts` drives `PopGame` by hand,
 * `scene-report.ts` drives `CutscenePlayer`, `sound-report.ts` puts a
 * fake device behind `SoundPlayer`. **None of them is a measurement
 * of the page**, and four of the last six bugs the player met were in
 * `web/main.ts` or in `src/render`, where no tick score could see
 * them -- the opening that played to nobody, the melody twelve
 * seconds late, the exit door at 2750 Hz, the black box behind the
 * shadow.
 *
 * `tools/dev/page-walk.ts` walks the page and asks whether a sound
 * happened and whether the picture moved. That is a floor. This is
 * the ceiling: the same inputs into the page and into the headless
 * port, and the two pictures required to be **the same picture, to
 * the byte, on every tick** -- plus the same `play_sound` calls in
 * the same order.
 *
 * Two levels and two hundred ticks apiece, one scene and one level
 * reached by finishing the one before, which is what fits in a test.
 * `npx tsx tools/dev/page-port.ts --scenes --cheats --entries` is the
 * same comparison over all fourteen levels, all eleven cheats, all
 * nine scenes and all thirteen transitions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO, GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';

const PORT = 8147;
const TICKS = 200;
/**
 * Level 1 because it is the one every other measurement is of, and
 * level 7 because it is the one level whose opening differs from
 * every other -- `do_startpos` puts the Prince in room 17 and
 * `set_start_pos` drops him into room 1, and the page drew the empty
 * room for a whole level until that was found.
 */
const LEVELS = [1, 7];

const PATTERN = [
  { x: 1, y: 0, shift: false }, { x: 1, y: -1, shift: false },
  { x: 1, y: 0, shift: false }, { x: 0, y: 1, shift: false },
  { x: -1, y: 0, shift: true }, { x: 0, y: 0, shift: false },
];

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
  await page.addInitScript(
    'window.__name = window.__name || function (f) { return f; };');
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 60000 });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

/** The headless port's own pictures and `play_sound` calls. */
async function portSide(level: number): Promise<{ hashes: number[]; asked: number[] }> {
  const assets = new Assets(
    async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
  const asked: number[] = [];
  const game = await PopGame.start(assets, exe, level, {
    effects: {
      sound: (which: number) => { asked.push(which); },
      stopSounds: () => {},
      // Nothing is ever sounding, which is what the page answers too
      // while it is muted -- `SoundPlayer.play` returns on its first
      // line and `isPlaying` stays false. `check_sound_playing` is
      // read during play (`seg003`'s feather fall, `seg006`'s gate),
      // so the two sides have to answer it the same way.
      soundPlaying: () => false,
    },
  });
  const hashes: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    game.step(PATTERN[((t / 11) | 0) % PATTERN.length]!);
    const surface = game.render();
    const rgb = surface.toRgb(game.scene.screenPalette.toRgba());
    let h = 2166136261;
    for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
    hashes.push(h >>> 0);
  }
  return { hashes, asked };
}

describe('the page and the headless port', () => {
  for (const level of LEVELS) {
    it(`draw the same level ${level}, tick for tick`, async () => {
      const port = await portSide(level);
      const got = await page.evaluate(async ([lvl, ticks, pattern]) => {
        const w = window as unknown as {
          __princeEnterLevel(l: number): Promise<void>;
          __princePause(on: boolean): void;
          __princeMute(on: boolean): void;
          __princeStep(n: number, c: unknown, hash: boolean): { hash: number } | null;
          __princeAsked(): { tick: number; which: number }[];
        };
        const P = pattern as { x: number; y: number; shift: boolean }[];
        w.__princePause(true);
        w.__princeMute(true);
        await w.__princeEnterLevel(lvl as number);
        const before = w.__princeAsked().length;
        const hashes: number[] = [];
        for (let t = 0; t < (ticks as number); t++) {
          const r = w.__princeStep(1, P[((t / 11) | 0) % P.length], true);
          hashes.push(r ? r.hash : -1);
        }
        return { hashes, asked: w.__princeAsked().slice(before).map((a) => a.which) };
      }, [level, TICKS, PATTERN] as const);

      const apart: number[] = [];
      for (let t = 0; t < TICKS; t++) {
        if (got.hashes[t] !== port.hashes[t]) apart.push(t);
      }
      expect(apart, `the page's picture differs on ${apart.length} ticks`).toEqual([]);
      expect(got.asked).toEqual(port.asked);
    }, 180000);
  }

  /**
   * And one scene, compared a different way.
   *
   * A scene's clock is the sound's -- `show_title`, `load_intro` and
   * `pv_scene` all stop at `while (check_sound_playing())` -- and the
   * page has to be muted to be stepped at all, so both sides are made
   * deaf and what they must agree on is the **sequence of pictures**:
   * every picture the port draws, in the order it draws them, however
   * long either side holds one.
   *
   * The princess room's six stars and two torches come out of
   * `prandom` and are blanked on both sides, which is what
   * `digest.py --cutscene` does against the original.
   */
  it('draw the same pictures in the scene before level 2', async () => {
    const { playScene, SpeakerClock } = await import('../../tools/dev/scene-common.ts');
    const { PROOM_RANDOM_PIXELS } = await import('../../src/pop/seg001.ts');
    class Deaf extends SpeakerClock { override get playing(): boolean { return false; } }
    const assets = new Assets(
      async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    const blank = (rgb: Uint8Array): number => {
      for (const [x, y] of PROOM_RANDOM_PIXELS) {
        const at = (y * 320 + x) * 3;
        rgb[at] = 0; rgb[at + 1] = 0; rgb[at + 2] = 0;
      }
      let h = 2166136261;
      for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
      return h >>> 0;
    };
    const portHashes: number[] = [];
    await playScene(assets, exe, { kind: 'level', level: 2 }, 400,
      (_i, rgb) => portHashes.push(blank(rgb)),
      undefined, await Deaf.load(assets), { seed: 1 });
    const pageHashes = await page.evaluate(async () => {
      const w = window as unknown as {
        __princePlayScene(s: unknown): Promise<void>;
        __princeSceneStep(ms: number): boolean;
        __princeSceneHash(): number | null;
        __princeSceneState(): { running: boolean; count: number } | null;
        __princePlaySound(i: number): void;
        __princeMute(on: boolean): void;
        __princePause(on: boolean): void;
        __princeSeed(n: number): void;
      };
      const esc = (): void => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true,
        }));
      };
      w.__princeMute(true);
      w.__princePause(true);
      for (let i = 0; i < 40 && w.__princeSceneState()?.running; i++) {
        esc();
        await new Promise((r) => setTimeout(r, 80));
      }
      w.__princePlaySound(-1);
      await new Promise((r) => setTimeout(r, 250));
      await w.__princePlayScene({ kind: 'level', level: 2 });
      w.__princeSeed(1);
      const mine = w.__princeSceneState()?.count;
      const out: number[] = [];
      for (let t = 0; t < 400; t++) {
        const st = w.__princeSceneState();
        if (!st || !st.running || st.count !== mine) break;
        if (!w.__princeSceneStep(1000 / 30)) break;
        const h = w.__princeSceneHash();
        if (h !== null) out.push(h);
      }
      return out;
    });
    const once = (a: readonly number[]): number[] => {
      const out: number[] = [];
      for (const h of a) if (out[out.length - 1] !== h) out.push(h);
      return out;
    };
    expect(once(pageHashes)).toEqual(once(portHashes));
  }, 180000);

  /**
   * And one level reached **by finishing the one before**.
   *
   * Every probe in the suite enters a level by the skip chain or a
   * cheat, never by playing out of the door, and level 7's black
   * screen hid behind that for the whole life of the port. This
   * drives the page through the real transition -- Shift+L, the
   * scene, `play_level`'s wait on the sound, `nextLevel`'s carry and
   * `select` -- and requires the level that comes up to be the
   * headless port's, given the carry the port worked out for itself
   * from its own run of the level before.
   *
   * Level 7 because its entry is the one that differs:
   * `do_startpos` puts the Prince in room 17 and `set_start_pos`
   * drops him into room 1.
   *
   * The transition has to run unpaused, so the page's loop plays a
   * few ticks of the new level before the poll can stop it. How many
   * is the machine's business, so the port is run at each of nine
   * starting points and the best taken; agreeing still needs a
   * hundred and fifty identical pictures.
   */
  it('reaches level 7 through the transition and draws the port\'s level', async () => {
    const assets = new Assets(
      async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    const effects = { sound: () => {}, stopSounds: () => {}, soundPlaying: () => false };
    const AFTER = 150;
    const portSideOf = async (idle: number): Promise<number[]> => {
      const before = await PopGame.start(assets, exe, 6, { effects });
      for (let t = 0; t < 60; t++) {
        before.step(PATTERN[((t / 11) | 0) % PATTERN.length]!);
        before.render();
      }
      const carried = {
        ticks: before.remainingTicks, sword: before.hasSword,
        lives: before.maxHitPoints, seamless: before.seamlessExit,
        hp: before.hitPoints,
      };
      const g = await PopGame.start(assets, exe, 7,
        { effects, seamless: carried.seamless });
      g.remainingTicks = carried.ticks;
      g.hasSword = carried.sword || g.hasSword;
      g.beginningHitPoints = carried.lives;
      if (carried.seamless) g.carryHitPoints(carried.hp, carried.lives);
      for (let t = 0; t < idle; t++) { g.step({ x: 0, y: 0, shift: false }); g.render(); }
      const out: number[] = [];
      for (let t = 0; t < AFTER; t++) {
        g.step(PATTERN[((t / 11) | 0) % PATTERN.length]!);
        const rgb = g.render().toRgb(g.scene.screenPalette.toRgba());
        let h = 2166136261;
        for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
        out.push(h >>> 0);
      }
      return out;
    };
    const got = await page.evaluate(async ([after, pattern]) => {
      const w = window as unknown as {
        __princeEnterLevel(l: number): Promise<void>;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeCommand(key: string): boolean;
        __princeStep(n: number, c: unknown, hash: boolean): { hash: number } | null;
        __princeLevel(): number;
      };
      const P = pattern as { x: number; y: number; shift: boolean }[];
      w.__princeMute(true);
      w.__princePause(true);
      await w.__princeEnterLevel(6);
      for (let t = 0; t < 60; t++) w.__princeStep(1, P[((t / 11) | 0) % P.length], false);
      w.__princeCommand('shift+l');
      w.__princePause(false);
      const until = Date.now() + 40000;
      while (Date.now() < until && w.__princeLevel() !== 7) {
        await new Promise((r) => setTimeout(r, 2));
      }
      w.__princePause(true);
      await new Promise((r) => setTimeout(r, 50));
      const hashes: number[] = [];
      for (let t = 0; t < (after as number); t++) {
        const r = w.__princeStep(1, P[((t / 11) | 0) % P.length], true);
        hashes.push(r ? r.hash : -1);
      }
      return { level: w.__princeLevel(), hashes };
    }, [AFTER, PATTERN] as const);
    expect(got.level).toBe(7);
    let best = AFTER + 1;
    for (let k = 0; k <= 8 && best > 0; k++) {
      const port = await portSideOf(k);
      let n = 0;
      for (let t = 0; t < AFTER; t++) if (got.hashes[t] !== port[t]) n += 1;
      best = Math.min(best, n);
    }
    expect(best, 'ticks on which the page and the port differ').toBe(0);
  }, 300000);

  it('threw nothing while it did it', () => {
    expect(consoleErrors).toEqual([]);
  });
});
