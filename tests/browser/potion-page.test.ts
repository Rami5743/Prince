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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO, GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import {
  levelsDatWithPotionLevel, POTION_LEVEL_NUMBER, POTION_PLACES,
} from '../../src/dat/potion-level.ts';

/** The probe that drinks all six, which both sides replay. */
const POTION1 = join(REPO, 'tools', 'oracle', 'recordings', 'potion1.json');
/** `toggle_upside` fires on this tick of it; measured, and pinned below. */
const FLIP = 490;
/** Hashing 192000 bytes a tick is not free: only the flip is watched. */
const FROM = 470;
const TO = 540;

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

beforeAll(async () => {
  server = (await serve(0, REPO)) as Server;
  PORT = (server.address() as { port: number }).port;
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

  /**
   * **The ghost of the Prince drinking.**
   *
   * The player drank the upside-down potion on this page and a copy
   * of him in the drinking pose stayed on the screen. The cause is
   * one line of `redraw_screen` -- see
   * `tests/pop/potion-level.test.ts` -- and it lived in `src/pop`,
   * but nothing in the suite could see it: `invert2`, the one
   * capture of the inversion, uses `shift+i` with the Prince
   * standing still, and a Prince who never moves never has the
   * contaminated peel painted anywhere but over himself.
   *
   * So this is the comparison that would have caught it: the page
   * and the headless port replaying `potion1` -- the sixteen careful
   * steps that drink all six -- with the picture required to be the
   * **same picture, to the byte**, over the seventy ticks around the
   * flip. The potion level seeds `prandom` with 1 on both sides
   * (`PopGame.start` seeds from the clock only on level 0), so the
   * flasks' bubbles are the same bubbles.
   */
  it('draws the port\'s own picture through the inversion, tick for tick', async () => {
    const rec = parseRecording(readFileSync(POTION1, 'utf8'));
    const ticks = decodeTimeline(rec.timeline).slice(0, TO);
    const assets = new Assets(async (name: string) => {
      const bytes = new Uint8Array(readFileSync(join(GAME_DIR, name)));
      return name === 'LEVELS.DAT' ? levelsDatWithPotionLevel(bytes) : bytes;
    });
    const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
    const game = await PopGame.start(assets, exe, POTION_LEVEL_NUMBER, {
      minutesLeft: rec.startMinutes,
      // Muted, the page's channel is always empty, so the headless
      // side is made deaf too: `check_sound_playing` is read during
      // play and the two sides have to answer it the same way.
      effects: { sound: () => {}, stopSounds: () => {}, soundPlaying: () => false },
    });
    const portHashes: number[] = [];
    let flipped = -1;
    for (let t = 0; t < ticks.length; t++) {
      game.step(ticks[t]);
      const surface = game.render();
      if (game.upsideDown && flipped < 0) flipped = t + 1;
      if (t + 1 < FROM) continue;
      const rgb = surface.toRgb(game.scene.screenPalette.toRgba());
      let h = 2166136261;
      for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
      portHashes.push(h >>> 0);
    }
    expect(flipped, 'the screen turns over on this tick of potion1').toBe(FLIP);

    const pageHashes = await page.evaluate(async ([level, from, all]) => {
      const w = window as unknown as {
        __princeEnterLevel(l: number): Promise<void>;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown, hash: boolean): { hash?: number } | null;
      };
      const controls = all as { x: number; y: number; shift: boolean }[];
      w.__princePause(true);
      w.__princeMute(true);
      await w.__princeEnterLevel(level as number);
      const out: number[] = [];
      for (let t = 0; t < controls.length; t++) {
        const want = t + 1 >= (from as number);
        const r = w.__princeStep(1, controls[t], want);
        if (want) out.push(r && r.hash !== undefined ? r.hash : -1);
      }
      return out;
    }, [POTION_LEVEL_NUMBER, FROM, ticks.map((c) => ({ x: c.x, y: c.y, shift: c.shift }))] as const);

    const apart: number[] = [];
    for (let i = 0; i < portHashes.length; i++) {
      if (pageHashes[i] !== portHashes[i]) apart.push(FROM + i);
    }
    expect(apart, `the page's picture differs on ${apart.length} ticks`).toEqual([]);
    expect(consoleErrors).toEqual([]);
  }, 240000);

  /**
   * And the same ticks against **the original**, which the page and
   * the port agreeing cannot settle: the ghost was in `src/pop`, so
   * both of them had it and the comparison above passes either way.
   * This is the number `PRINCE.EXE` itself draws.
   *
   * `potion1` under `dosbox_oracle.py --game`, grabbed at 30fps and
   * scaled back to 320x200, counting the pixels brighter than 60 in
   * the box x 90..140 y 68..118 -- the black air of the corridor,
   * where nothing but the Prince can ever be:
   *
   *     tick        489   491   493   495 .. 515
   *     PRINCE.EXE  572   872   855   803
   *     the page    572   872   855   803   with the fix
   *     the page    572   872  1007   972   with the ghost
   *
   * The screen turns over on tick 490 and the ghost is 169 pixels
   * the original never draws, from the third tick after it onwards.
   */
  it('draws as many pixels as PRINCE.EXE does after the screen turns over', async () => {
    const rec = parseRecording(readFileSync(POTION1, 'utf8'));
    const ticks = decodeTimeline(rec.timeline).slice(0, 516);
    const got = await page.evaluate(async ([level, all, want]) => {
      const w = window as unknown as {
        __princeEnterLevel(l: number): Promise<void>;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown, hash: boolean): unknown;
      };
      const controls = all as { x: number; y: number; shift: boolean }[];
      const at = new Set(want as readonly number[]);
      w.__princePause(true);
      w.__princeMute(true);
      await w.__princeEnterLevel(level as number);
      const canvas = document.getElementById('screen') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      const out: Record<number, number> = {};
      for (let t = 0; t < controls.length; t++) {
        w.__princeStep(1, controls[t], false);
        if (!at.has(t + 1) || !ctx) continue;
        const d = ctx.getImageData(90, 68, 50, 50).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.max(d[i], d[i + 1], d[i + 2]) > 60) ink++;
        }
        out[t + 1] = ink;
      }
      return out;
    }, [POTION_LEVEL_NUMBER, ticks.map((c) => ({ x: c.x, y: c.y, shift: c.shift })),
      [489, 491, 493, 495, 505, 515] as readonly number[]] as const);
    expect(got).toEqual({
      489: 572, 491: 872, 493: 855, 495: 803, 505: 803, 515: 803,
    });
    expect(consoleErrors).toEqual([]);
  }, 240000);
});
