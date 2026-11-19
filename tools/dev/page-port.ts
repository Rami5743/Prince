/**
 * The game the player plays, against the game the suite measures.
 *
 *   npx tsx tools/dev/page-port.ts [--levels 1,2,3] [--ticks 400]
 *
 * `pop-report.ts` and `scene-report.ts` measure `src/pop` through
 * stand-ins. `page-walk.ts` measures the page, but only asks whether
 * a sound happened and whether the picture moved. Neither puts the
 * two **beside each other**, and that is the gap four of the last six
 * bugs fell through: the melody twelve seconds late, the exit door at
 * 2750 Hz, the black box behind the shadow, the opening that played
 * to nobody were all in `web/main.ts` or `src/render`, where the tick
 * scores cannot see them, and the page walk's two questions are too
 * coarse to catch a picture that is merely *wrong*.
 *
 * So this drives both from the same inputs and compares them tick for
 * tick:
 *
 *   * **the picture** -- a hash of the very surface the page's
 *     `display.present` was given, against a hash of what
 *     `PopGame.render()` hands back headless. Equal means the page
 *     draws the port's picture to the byte.
 *   * **the sound asked for** -- every `play_sound` the byte-code
 *     made, in order, on each side. Not what was *heard*: that is the
 *     audio device's clock, and a page stepped as fast as Chromium
 *     can go hears a different set from one played at twelve ticks a
 *     second. What was asked for is the game.
 *
 * Both sides enter the level the same way -- `PopGame.start(assets,
 * exe, level, { effects })`, which is what `select()` does and what
 * `__princeEnterLevel` is for. `__princeShow` is not that: it forces
 * `drawn_room` as well, and a comparison that used it would be
 * measuring the look and not the game.
 *
 * A non-zero exit means a level where the two do not agree.
 */
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { SOUND_NAME } from './sound-trace.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const PORT = 8143;

const args = process.argv.slice(2);
const flag = (name: string, dflt: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const LEVELS = flag('levels', '1,2,3,4,5,6,7,8,9,10,11,12,13,14')
  .split(',').map(Number);
const TICKS = Number(flag('ticks', '400'));

/**
 * Something to do, and the same thing on both sides.
 *
 * `page-walk.ts`'s pattern: run right, jump, duck, draw the sword,
 * turn round. Not a recording -- the point is to make the game move
 * and make a noise, not to reproduce a run.
 */
const PATTERN = [
  { x: 1, y: 0, shift: false }, { x: 1, y: -1, shift: false },
  { x: 1, y: 0, shift: false }, { x: 0, y: 1, shift: false },
  { x: -1, y: 0, shift: true }, { x: 0, y: 0, shift: false },
];
const controlsAt = (t: number): { x: number; y: number; shift: boolean } =>
  PATTERN[((t / 11) | 0) % PATTERN.length]!;

/** The page's own hash, written once so the two cannot drift apart. */
function fnv(rgb: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < rgb.length; i++) h = Math.imul(h ^ rgb[i], 16777619);
  return h >>> 0;
}

const named = (i: number): string => `${i}:${SOUND_NAME[i] ?? '?'}`;

interface Side { hashes: number[]; asked: number[] }

/** The headless port: `src/pop`, driven by hand. */
async function portSide(level: number): Promise<Side> {
  const assets = new Assets(
    async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
  const asked: number[] = [];
  const game = await PopGame.start(assets, exe, level, {
    effects: {
      sound: (which: number) => { asked.push(which); },
      stopSounds: () => {},
      /**
       * Nothing is ever sounding.
       *
       * The headless side has no device, and the only place a level's
       * own loop asks is `play_level`'s wait, which a jump straight
       * to a level does not go through. The page's `SoundPlayer` does
       * have one -- which is why what was *heard* is not what is
       * compared here.
       */
      soundPlaying: () => false,
    },
  });
  const hashes: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    game.step(controlsAt(t));
    const surface = game.render();
    hashes.push(fnv(surface.toRgb(game.scene.screenPalette.toRgba())));
  }
  return { hashes, asked };
}

let bad = 0;

async function main(): Promise<void> {
  const server = (await serve(PORT, REPO)) as Server;
  const preinstalled = '/opt/pw-browsers/chromium';
  const browser: Browser = await chromium.launch(
    existsSync(preinstalled)
      ? {
        executablePath: preinstalled,
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
      }
      : { args: ['--autoplay-policy=no-user-gesture-required'] },
  );
  const page: Page = await browser.newPage();
  const thrown: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') thrown.push(m.text()); });
  page.on('pageerror', (e) => thrown.push(String(e)));
  // See `page-walk.ts`: esbuild's `keepNames` wrapper goes with the
  // source of anything handed to `page.evaluate`.
  await page.addInitScript(
    'window.__name = window.__name || function (f) { return f; };');
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 60000 });

  for (const level of LEVELS) {
    const port = await portSide(level);
    const got = await page.evaluate(async ([lvl, ticks, pattern]) => {
      const w = window as unknown as {
        __princeEnterLevel(l: number): Promise<void>;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown, hash: boolean):
        { hash: number } | null;
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

    let first = -1;
    let differ = 0;
    for (let t = 0; t < TICKS; t++) {
      if (got.hashes[t] !== port.hashes[t]) {
        differ += 1;
        if (first < 0) first = t;
      }
    }
    const sameSound = got.asked.length === port.asked.length
      && got.asked.every((v, i) => v === port.asked[i]);
    console.log(`level ${String(level).padStart(2)}`
      + `  pictures ${TICKS - differ} of ${TICKS}`
      + (first < 0 ? '' : `  first apart at ${first}`)
      + `  sounds ${got.asked.length} page / ${port.asked.length} port`
      + (sameSound ? '' : '  DIFFERENT'));
    if (differ) {
      bad += 1;
      console.log(`  !! level ${level}: the page draws a different picture on `
        + `${differ} of ${TICKS} ticks, from tick ${first}`);
    }
    if (!sameSound) {
      bad += 1;
      const n = Math.max(got.asked.length, port.asked.length);
      let at = 0;
      while (at < n && got.asked[at] === port.asked[at]) at += 1;
      console.log(`  !! level ${level}: the sounds asked for part at ${at}: `
        + `page ${got.asked[at] === undefined ? '--' : named(got.asked[at]!)}, `
        + `port ${port.asked[at] === undefined ? '--' : named(port.asked[at]!)}`);
    }
  }

  for (const t of thrown.slice(0, 10)) { bad += 1; console.log(`  !! the page threw: ${t}`); }
  console.log(`\n${bad === 0 ? 'the page and the port draw the same game' : `${bad} faults`}`);
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(bad === 0 ? 0 : 1);
}

await main();
