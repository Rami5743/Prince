/**
 * The game the player plays, against the game the suite measures.
 *
 *   npx tsx tools/dev/page-port.ts [--levels 1,2,3] [--ticks 400]
 *                                  [--scenes title,2,ending] [--cheats]
 *
 * `--scenes` does the same for the parts of the game that are not a
 * level, and compares them a different way, because a scene's clock
 * is the **sound's**: `show_title`, `load_intro` and `pv_scene` all
 * stop dead at `while (check_sound_playing())`, and the page asks a
 * real `AudioContext` where the headless side asks a model of the PC
 * speaker. Those two answer different lengths, so frame for frame
 * the two sides cannot agree and should not be asked to. What they
 * must agree on is the **sequence of pictures**: every picture the
 * port draws, in the order it draws them, however long either side
 * holds one. A wrong picture, a missing one, or one in the wrong
 * place is a fault; a picture held two frames longer is the device.
 *
 * `--cheats` puts all eleven of `process_key`'s cheats through both
 * sides at the same ticks, which is the other thing the player does
 * that no digest covers.
 *
 * `--entries` enters each level **by finishing the one before** --
 * Shift+L through the real transition, the scene, `play_level`'s
 * wait on the sound and `nextLevel`'s carry -- and compares the
 * level that comes up with the headless port given the carry it
 * worked out for itself. That is the path no digest has ever
 * covered: every probe enters a level by the skip chain or a cheat,
 * and level 7's black screen hid behind that for the whole life of
 * the port.
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
import { playScene, SpeakerClock } from './scene-common.ts';
import type { SceneName } from '../../src/pop/cutscene.ts';
import { PROOM_RANDOM_PIXELS } from '../../src/pop/seg001.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const PORT = 8143;

const args = process.argv.slice(2);
const flag = (name: string, dflt: string): string => {
  const i = args.indexOf(`--${name}`);
  // A flag that is on its own -- `--scenes --cheats` -- must not eat
  // the next flag as its value.
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : dflt;
};
const LEVELS = flag('levels', '1,2,3,4,5,6,7,8,9,10,11,12,13,14')
  .split(',').map(Number);
const TICKS = Number(flag('ticks', '400'));
const SCENES = flag('scenes', 'title,2,4,6,8,9,12,expired,ending').split(',');
const WANT_SCENES = args.includes('--scenes') || args.includes('--only-scenes');

const WANT_LEVELS = !args.includes('--only-scenes') && !args.includes('--only-entries');
const CHEATS = args.includes('--cheats');
const WANT_ENTRIES = args.includes('--entries') || args.includes('--only-entries');
const ENTRY_LEVELS = flag('entries', '2,3,4,5,6,7,8,9,10,11,12,13,14')
  .split(',').map(Number);
/** Ticks played in the level before, and in the level arrived at. */
const BEFORE = 60;
const AFTER = 150;

/**
 * The eleven cheats of `process_key`, and when to throw them in.
 *
 * `PopGame.cheat` queues them and `step` drains the queue where the
 * C reads the keyboard, so both sides take them the same way -- and
 * the page's own key handler goes through `cheat()` too, which is
 * the fault the round before last found in it.
 */
const CHEAT_KEYS = ['shift+s', 'shift+t', 'k', 'r', 'c', 'shift+c',
  'shift+i', 'shift+w', 'shift+b', '+', '-'];
const cheatsAt = (t: number): string | null => (CHEATS && t > 0 && t % 29 === 0
  ? CHEAT_KEYS[(((t / 29) | 0) - 1) % CHEAT_KEYS.length]! : null);

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
    const key = cheatsAt(t);
    if (key) game.cheat(key);
    game.step(controlsAt(t));
    const surface = game.render();
    hashes.push(fnv(surface.toRgb(game.scene.screenPalette.toRgba())));
  }
  return { hashes, asked };
}

/** A scene's name as `CutscenePlayer.begin` takes it. */
const sceneOf = (name: string): SceneName => (
  name === 'title' ? { kind: 'title' }
    : name === 'ending' ? { kind: 'ending' }
      : name === 'expired' ? { kind: 'expired' }
        : { kind: 'level', level: Number(name) });

/** The pictures a run drew, each one once, in the order they came. */
const sequence = (hashes: readonly number[]): number[] => {
  const out: number[] = [];
  for (const h of hashes) if (out[out.length - 1] !== h) out.push(h);
  return out;
};

/** How many of `a`'s pictures `b` draws, in order: a plain LCS. */
function common(a: readonly number[], b: readonly number[]): number {
  const prev = new Int32Array(b.length + 1);
  const cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev.set(cur);
  }
  return prev[b.length];
}

/**
 * A channel that is always empty, for both sides of the comparison.
 *
 * `show_title`, `load_intro` and `pv_scene` stop dead at
 * `while (check_sound_playing())`, and the page has to be muted to
 * be stepped at all -- `__princeSceneStep` runs the scene's clock a
 * hundred and fifty times faster than the audio device's, so an
 * unmuted page would wait for sounds that are still at their first
 * sample. Muted, the page's channel is always empty. So the
 * headless side is made deaf too, and the two runs are the same run.
 * What the waits should be is `scene-report.ts`'s business, against
 * the original.
 */
class DeafClock extends SpeakerClock {
  override get playing(): boolean { return false; }
}

/** The headless port's pictures of a scene, one per video frame. */
async function portScene(name: string, frames: number): Promise<number[]> {
  const assets = new Assets(
    async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
  const hashes: number[] = [];
  await playScene(assets, exe, sceneOf(name), frames, (_i, rgb) => {
    for (const [x, y] of PROOM_RANDOM_PIXELS) {
      const at = (y * 320 + x) * 3;
      rgb[at] = 0; rgb[at + 1] = 0; rgb[at + 2] = 0;
    }
    hashes.push(fnv(rgb));
  }, undefined, await DeafClock.load(assets), { seed: 1 });
  return hashes;
}

/**
 * The headless port's own transition: `nextLevel`'s carry, by hand.
 *
 * `web/main.ts`'s `nextLevel` reads five things off the level that
 * has just been finished and puts them back on the one that
 * follows, and this is the same five. If either side's carry is
 * wrong the pictures part on the first tick.
 */
async function portEntry(level: number, idle: number): Promise<Side> {
  const assets = new Assets(
    async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
  const effects = {
    sound: () => {}, stopSounds: () => {}, soundPlaying: () => false,
  };
  const before = await PopGame.start(assets, exe, level - 1, { effects });
  for (let t = 0; t < BEFORE; t++) { before.step(controlsAt(t)); before.render(); }
  const carried = {
    ticks: before.remainingTicks,
    sword: before.hasSword,
    lives: before.maxHitPoints,
    seamless: before.seamlessExit,
    hp: before.hitPoints,
  };
  const asked: number[] = [];
  const game = await PopGame.start(assets, exe, level, {
    seamless: carried.seamless,
    effects: { ...effects, sound: (which: number) => { asked.push(which); } },
  });
  game.remainingTicks = carried.ticks;
  game.hasSword = carried.sword || game.hasSword;
  game.beginningHitPoints = carried.lives;
  if (carried.seamless) game.carryHitPoints(carried.hp, carried.lives);
  /**
   * The ticks the page's own loop played before it could be stopped.
   *
   * The transition has to run unpaused -- the scene, the wait on the
   * sound and `select` are all on the page's `requestAnimationFrame`
   * clock -- so by the time the level is up and the loop is paused
   * again a few of its ticks have gone by, with nothing held. The
   * port plays the same few before the comparison starts.
   */
  for (let t = 0; t < idle; t++) {
    game.step({ x: 0, y: 0, shift: false });
    game.render();
  }
  const hashes: number[] = [];
  for (let t = 0; t < AFTER; t++) {
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

  for (const level of (WANT_LEVELS ? LEVELS : [])) {
    const port = await portSide(level);
    const got = await page.evaluate(async ([lvl, ticks, pattern, cheatKeys]) => {
      const w = window as unknown as {
        __princeEnterLevel(l: number): Promise<void>;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown, hash: boolean):
        { hash: number } | null;
        __princeAsked(): { tick: number; which: number }[];
        __princeCommand(key: string): boolean;
      };
      const P = pattern as { x: number; y: number; shift: boolean }[];
      w.__princePause(true);
      const keys = cheatKeys as string[];
      w.__princeMute(true);
      await w.__princeEnterLevel(lvl as number);
      const before = w.__princeAsked().length;
      const hashes: number[] = [];
      for (let t = 0; t < (ticks as number); t++) {
        if (keys.length && t > 0 && t % 29 === 0) {
          w.__princeCommand(keys[(((t / 29) | 0) - 1) % keys.length]!);
        }
        const r = w.__princeStep(1, P[((t / 11) | 0) % P.length], true);
        hashes.push(r ? r.hash : -1);
      }
      return { hashes, asked: w.__princeAsked().slice(before).map((a) => a.which) };
    }, [level, TICKS, PATTERN, CHEATS ? CHEAT_KEYS : []] as const);

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

  if (WANT_SCENES) {
    for (const name of SCENES) {
      const frames = name === 'title' ? 3100 : name === 'ending' ? 1400 : 500;
      const port = sequence(await portScene(name, frames));
      const got = await page.evaluate(async ([which, n]) => {
        const w = window as unknown as {
          __princePlayScene(s: unknown): Promise<void>;
          __princeSceneStep(ms: number): boolean;
          __princeSceneHash(): number | null;
          __princeSceneState():
          { running: boolean; playing: unknown; count: number } | null;
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
        // `changeScene` lets one scene change happen at a time, and
        // `load_intro` opens on `while (check_sound_playing())`: a
        // scene asked for over another one is dropped, and a scene
        // asked for over a tune runs black until the tune ends.
        for (let i = 0; i < 40 && w.__princeSceneState()?.running; i++) {
          esc();
          await new Promise((r) => setTimeout(r, 100));
        }
        w.__princePlaySound(-1);
        await new Promise((r) => setTimeout(r, 300));
        const s = which as string;
        await w.__princePlayScene(s === 'title' ? { kind: 'title' }
          : s === 'ending' ? { kind: 'ending' }
            : s === 'expired' ? { kind: 'expired' }
              : { kind: 'level', level: Number(s) });
        w.__princeSeed(1);
        const mine = w.__princeSceneState()?.count;
        const hashes: number[] = [];
        for (let t = 0; t < (n as number); t++) {
          // **This** scene's end, and not `__princeSceneStep`'s
          // return. When a scene finishes `endScene` runs whatever
          // was behind it -- for a scene the page was asked for by
          // hand that is `restartGame`, which puts the title up --
          // so `running` goes on being true, and for the title the
          // name does not even change. `count` does.
          const st = w.__princeSceneState();
          if (!st || !st.running || st.count !== mine) break;
          if (!w.__princeSceneStep(1000 / 30)) break;
          const h = w.__princeSceneHash();
          if (h !== null) hashes.push(h);
        }
        return hashes;
      }, [name, frames] as const);
      const page2 = sequence(got);
      const hit = common(port, page2);
      const ok = hit === port.length;
      console.log(`scene ${name.padEnd(8)} pictures ${hit} of ${port.length}`
        + ` port / ${page2.length} page${ok ? '' : '  DIFFERENT'}`);
      if (!ok) {
        bad += 1;
        let at = 0;
        while (at < port.length && at < page2.length && port[at] === page2[at]) at += 1;
        console.log(`  !! scene ${name}: the page's pictures part from the `
          + `port's at picture ${at} of ${port.length}`);
      }
    }
  }

  if (WANT_ENTRIES) {
    for (const level of ENTRY_LEVELS) {
      const got = await page.evaluate(async ([lvl, before, after, pattern]) => {
        const w = window as unknown as {
          __princeEnterLevel(l: number): Promise<void>;
          __princePause(on: boolean): void;
          __princeMute(on: boolean): void;
          __princeCommand(key: string): boolean;
          __princeStep(n: number, c: unknown, hash: boolean): { hash: number } | null;
          __princeAsked(): { tick: number; which: number }[];
          __princeLevel(): number;
          __princeState(): { ticks: number } | null;
        };
        const P = pattern as { x: number; y: number; shift: boolean }[];
        w.__princeMute(true);
        w.__princePause(true);
        await w.__princeEnterLevel((lvl as number) - 1);
        for (let t = 0; t < (before as number); t++) {
          w.__princeStep(1, P[((t / 11) | 0) % P.length], false);
        }
        // Shift+L, and then the page's own loop: the scene, the wait
        // on the sound, `nextLevel`'s carry and `select`. None of it
        // happens while the loop is paused.
        w.__princeCommand('shift+l');
        w.__princePause(false);
        // Polled as tightly as the page allows and stopped the
        // instant the level is up: every turn of the loop between
        // the two is a tick of the level the port has not played.
        const until = Date.now() + 40000;
        while (Date.now() < until && w.__princeLevel() !== (lvl as number)) {
          await new Promise((r) => setTimeout(r, 2));
        }
        w.__princePause(true);
        await new Promise((r) => setTimeout(r, 50));
        const arrived = w.__princeLevel();
        const idle = w.__princeState()?.ticks ?? 0;
        const mark = w.__princeAsked().length;
        const hashes: number[] = [];
        for (let t = 0; t < (after as number); t++) {
          const r = w.__princeStep(1, P[((t / 11) | 0) % P.length], true);
          hashes.push(r ? r.hash : -1);
        }
        return {
          arrived, idle, hashes,
          asked: w.__princeAsked().slice(mark).map((a) => a.which),
        };
      }, [level, BEFORE, AFTER, PATTERN] as const);
      /**
       * How many ticks the page's own loop played before it could be
       * stopped, searched rather than asked for.
       *
       * The transition has to run unpaused -- the scene, the wait on
       * the sound and `select` are all on the page's
       * `requestAnimationFrame` clock -- and the loop goes on
       * stepping the new level until the poll notices it. How many
       * turns that is depends on the machine, and
       * `__princeState().ticks` is the loop's own count, which is
       * not quite the number of `step`s. So the port is run at each
       * of nine starting points and the best taken: nothing is
       * excused by it, because agreeing needs a hundred and fifty
       * identical pictures and no wrong alignment gives that.
       */
      let port: Side | null = null;
      let differ = AFTER + 1;
      let first = -1;
      let idle = got.idle;
      for (let k = 0; k <= 8; k++) {
        const side = await portEntry(level, k);
        let n = 0;
        let at = -1;
        for (let t = 0; t < AFTER; t++) {
          if (got.hashes[t] !== side.hashes[t]) { n += 1; if (at < 0) at = t; }
        }
        if (n < differ) { differ = n; first = at; port = side; idle = k; }
        if (differ === 0) break;
      }
      if (!port) { bad += 1; continue; }
      const here = got.arrived === level;
      console.log(`entry ${String(level).padStart(2)}`
        + `  arrived at ${got.arrived} after ${idle} free ticks`
        + `  pictures ${AFTER - differ} of ${AFTER}`
        + (first < 0 ? '' : `  first apart at ${first}`));
      if (!here) {
        bad += 1;
        console.log(`  !! entry ${level}: Shift+L out of level ${level - 1} `
          + `reached level ${got.arrived}`);
      } else if (differ) {
        bad += 1;
        console.log(`  !! entry ${level}: the level reached through the `
          + `transition differs from the port's on ${differ} of ${AFTER} `
          + `ticks, from tick ${first}`);
      }
    }
  }

  for (const t of thrown.slice(0, 10)) { bad += 1; console.log(`  !! the page threw: ${t}`); }
  console.log(`\n${bad === 0 ? 'the page and the port draw the same game' : `${bad} faults`}`);
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(bad === 0 ? 0 : 1);
}

await main();
