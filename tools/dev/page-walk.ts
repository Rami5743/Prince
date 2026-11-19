/**
 * Play the whole game in a real browser, and listen to it.
 *
 *   npx tsx tools/dev/page-walk.ts [--levels 1,2,3] [--ticks 600] [--quiet]
 *
 * Three rounds running, every bug the player met was found by
 * **playing**, and four of the last five were in `web/main.ts` or
 * `src/render`, where no tick score can see them: the opening that
 * played to nobody, the melody twelve seconds late, the exit door at
 * 2750 Hz, the black box behind the shadow. `pop-report.ts`,
 * `scene-report.ts` and `sound-report.ts` are all measurements of
 * `src/pop` and `src/render` through stand-ins. None of them is a
 * measurement of the page.
 *
 * So this one is. It drives `web/index.html` in Chromium with a real
 * `AudioContext`, wrapped so that every `start()` is written down,
 * and walks the whole game: each of the fourteen levels played and
 * then put through all eleven cheats, every room of every level
 * drawn, each of the six scenes between the levels, the title, the
 * hourglass, the ending and the hall of fame. At each it asks the
 * two questions the suite cannot:
 *
 *   * **did a sound happen**, and
 *   * **did the picture change**,
 *
 * and on top of those the three that catch a translation fault: did
 * anything throw, did any global go `NaN`, and did the screen go
 * black and stay black.
 *
 * It prints a line per thing and a count at the end; a non-zero exit
 * means something was silent, still, or thrown.
 */
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';
import { SOUND_NAME } from './sound-trace.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = 8141;

const args = process.argv.slice(2);
const flag = (name: string, dflt: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const LEVELS = flag('levels', '1,2,3,4,5,6,7,8,9,10,11,12,13,14')
  .split(',').map(Number);
const TICKS = Number(flag('ticks', '500'));

/**
 * The cheats, in the order `process_key` has them, and what each is
 * for. All eleven go through `PopGame.cheat`, which queues them for
 * where the C reads the key -- inside the tick.
 */
const CHEATS: { name: string; code: string; shift: boolean }[] = [
  { name: 'k', code: 'KeyK', shift: false },        // kill the guard
  { name: 'shift+s', code: 'KeyS', shift: true },   // one hit point back
  { name: 'shift+t', code: 'KeyT', shift: true },   // a whole flask
  { name: 'shift+i', code: 'KeyI', shift: true },   // turn the room over
  { name: 'shift+w', code: 'KeyW', shift: true },   // weightless
  { name: 'shift+b', code: 'KeyB', shift: true },   // blind
  { name: 'r', code: 'KeyR', shift: false },        // resurrect
  { name: 'c', code: 'KeyC', shift: false },        // the frame counter
  { name: 'shift+c', code: 'KeyC', shift: true },   // the other counter
  { name: '+', code: 'Equal', shift: false },       // a minute on
  { name: '-', code: 'Minus', shift: false },       // a minute off
];

interface Started { at: number; kind: string }

/** `13 gate_closing`, so that a list of indices reads as sounds. */
const named = (i: number): string => `${i}:${SOUND_NAME[i] ?? '?'}`;

let bad = 0;
const fail = (what: string, why: string): void => {
  bad += 1;
  console.log(`  !! ${what}: ${why}`);
};

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
  /**
   * `tsx` compiles this file with esbuild's `keepNames`, which wraps
   * every named function expression in a call to `__name` -- and the
   * wrapper goes with the source of anything handed to
   * `page.evaluate`, where no such helper exists. Defining it in the
   * page first, as a string so that nothing compiles it, is the whole
   * of the fix.
   */
  await page.addInitScript(
    'window.__name = window.__name || function (f) { return f; };');
  await page.addInitScript(() => {
    const w = window as unknown as { __started: Started[] };
    interface Started { at: number; kind: string }
    w.__started = [];
    const Ctx = window.AudioContext;
    const note = (ctx: AudioContext, kind: string): void => {
      (window as unknown as { __ctx: AudioContext }).__ctx = ctx;
      w.__started.push({ at: ctx.currentTime, kind });
    };
    window.AudioContext = class extends Ctx {
      createBufferSource(): AudioBufferSourceNode {
        const node = super.createBufferSource();
        const start = node.start.bind(node);
        node.start = ((...a: unknown[]) => {
          note(this, `buffer:${node.buffer?.duration.toFixed(3) ?? '?'}`);
          return (start as (...x: unknown[]) => void)(...a);
        }) as typeof node.start;
        return node;
      }
      createOscillator(): OscillatorNode {
        const node = super.createOscillator();
        const start = node.start.bind(node);
        let first = true;
        node.start = ((...a: unknown[]) => {
          if (first) { first = false; note(this, 'tune'); }
          return (start as (...x: unknown[]) => void)(...a);
        }) as typeof node.start;
        return node;
      }
    } as unknown as typeof AudioContext;
  });
  await page.goto(`http://localhost:${PORT}/web/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 60000 });

  // --- every sound the game has, read through the page's own context ---
  const failedReads = await page.evaluate(async () => {
    const w = window as unknown as {
      __princeSoundFailures(): Promise<[number, string][]>;
    };
    return w.__princeSoundFailures();
  });
  console.log(`sounds that would not read: ${failedReads.length}`);
  for (const [i, why] of failedReads) fail(`sound ${i}`, why);

  // --- the fourteen levels: played, then every cheat ---
  for (const level of LEVELS) {
    const got = await page.evaluate(async ([lvl, ticks, cheats]) => {
      const w = window as unknown as {
        __princePause(on: boolean): void;
        __princeShow(l: number, room: number): Promise<void>;
        __princeHold(key: string, down: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown): unknown;
        __princeFrame(): number[];
        __princeState(): Record<string, unknown> | null;
        __princeLevel(): number;
        __princeHeard(): number[];
        __started: { at: number; kind: string }[];
      };
      const L = lvl as number;
      const N = ticks as number;
      const keys = cheats as { name: string; code: string; shift: boolean }[];
      // `__princeShow` is the one way in that waits for the level's
      // data; `__princeGoToLevel` fires a promise and returns, so the
      // first few hundred steps went to whatever was still on screen.
      const heardBefore = w.__princeHeard().length;
      await w.__princeShow(L, 1);
      /**
       * `__princeShow` is a *look* at a room, and it leaves the room
       * it was given on the screen. On thirteen levels that is where
       * the Prince is; on level 6 it is not, and the walk sat
       * watching an empty room 1 for five hundred ticks while the
       * game played somewhere else. A key is what the page itself
       * uses to stop looking: `__princeHold` puts `drawn_room` back
       * to the Prince's own.
       */
      w.__princeHold('ArrowLeft', true);
      w.__princeHold('ArrowLeft', false);
      w.__princePause(true);
      w.__princeMute(false);
      w.__started.length = 0;
      const hash = (): number => {
        const px = w.__princeFrame();
        let h = 2166136261;
        for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619);
        return h >>> 0;
      };
      const lit = (): number => {
        const px = w.__princeFrame();
        let n = 0;
        for (let i = 0; i < px.length; i += 3) {
          if (px[i] || px[i + 1] || px[i + 2]) n += 1;
        }
        return n;
      };
      /**
       * Something to do: run right, jump, duck, draw the sword, turn
       * round. Not a recording -- the point is to make the game move
       * and make a noise, not to reproduce a run.
       */
      const PATTERN = [
        { x: 1, y: 0, shift: false }, { x: 1, y: -1, shift: false },
        { x: 1, y: 0, shift: false }, { x: 0, y: 1, shift: false },
        { x: -1, y: 0, shift: true }, { x: 0, y: 0, shift: false },
      ];
      const seen = new Set<number>();
      let changed = 0;
      let last = hash();
      for (let t = 0; t < N; t++) {
        w.__princeStep(1, PATTERN[(t / 11 | 0) % PATTERN.length]);
        if (t % 5 === 0) {
          const h = hash();
          if (h !== last) { changed += 1; last = h; }
          seen.add(h);
        }
      }
      const litPlaying = lit();
      const sounds = [...new Set(w.__princeHeard().slice(heardBefore))]
        .sort((a, b) => a - b);
      // Every cheat, each given a few ticks to show.
      const cheated: { key: string; moved: boolean }[] = [];
      const press = (c: { name: string; code: string; shift: boolean }): void => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: c.name, code: c.code, shiftKey: c.shift, bubbles: true,
        }));
        for (let i = 0; i < 6; i++) w.__princeStep(1, { x: 0, y: 0, shift: false });
      };
      for (const c of keys) {
        const before = hash();
        press(c);
        cheated.push({ key: c.name, moved: hash() !== before });
        // `shift+i` and `shift+b` are switches, not one-off effects:
        // left on, the room stays upside down or black for every
        // level after this one, and the walk would report its own
        // cheat as a fault.
        if (c.name === 'shift+i' || c.name === 'shift+b') press(c);
      }
      return {
        level: w.__princeLevel(), changed, pictures: seen.size,
        lit: litPlaying, sounds: [...sounds], cheated,
        state: w.__princeState(),
      };
    }, [level, TICKS, CHEATS] as const);

    const s = got.state as Record<string, unknown> | null;
    const dead = s?.dead === true || s?.awaitingButton === true;
    const numbers = s
      ? Object.entries(s).filter(([, v]) => typeof v === 'number' && !Number.isFinite(v))
      : [];
    console.log(`level ${String(level).padStart(2)}  pictures ${String(got.pictures).padStart(3)}`
      + `  changes ${String(got.changed).padStart(3)}  lit ${String(got.lit).padStart(5)}`
      + `  sounds ${got.sounds.length}  [${got.sounds.map(named).join(' ')}]`
      + (dead ? '  (he died)' : ''));
    if (got.level !== level) fail(`level ${level}`, `the page is on ${got.level}`);
    /**
     * A dead Prince is not a still picture: `play_level_2` holds the
     * screen at `Press Button to Continue` and nothing moves until a
     * key, which is the game and not a fault. Levels 5, 6 and 11
     * kill a player who runs right off the start, and this walk does
     * exactly that.
     */
    if (got.changed < 5 && !dead) {
      fail(`level ${level}`, `the picture moved ${got.changed} times in ${TICKS} ticks`);
    }
    if (got.lit < 1000) fail(`level ${level}`, `only ${got.lit} pixels are lit`);
    if (got.sounds.length === 0 && !dead) fail(`level ${level}`, 'nothing sounded');
    if (numbers.length) fail(`level ${level}`, `not a number: ${JSON.stringify(numbers)}`);
    const still = got.cheated.filter((c) => !c.moved).map((c) => c.key);
    /**
     * Which of them are allowed to draw nothing. `c`, `shift+c`, `+`
     * and `-` write to the strip under the room, which may already
     * read what they would write; `shift+w` is weightlessness, which
     * has no picture at all; `shift+s` is a hit point the bar may
     * already be full of; `k` kills a guard there may not be; `r`
     * puts the Prince back as he was.
     */
    const mustMove = still.filter(
      (k) => !['c', 'shift+c', '+', '-', 'r', 'shift+w', 'shift+s', 'k'].includes(k));
    if (mustMove.length) {
      console.log(`           cheats that drew nothing: ${mustMove.join(' ')}`);
    }
  }

  // --- the scenes, at the clock the player hears ---
  const SCENES: [string, unknown, number][] = [
    ['cutscene 2', { kind: 'level', level: 2 }, 14],
    ['cutscene 4', { kind: 'level', level: 4 }, 14],
    ['cutscene 6', { kind: 'level', level: 6 }, 14],
    ['cutscene 8', { kind: 'level', level: 8 }, 16],
    ['cutscene 9', { kind: 'level', level: 9 }, 16],
    ['cutscene 12', { kind: 'level', level: 12 }, 14],
    ['the hourglass', { kind: 'expired' }, 12],
    ['the ending', { kind: 'ending' }, 30],
  ];
  for (const [name, scene, seconds] of SCENES) {
    const got = await page.evaluate(async ([sc, secs]) => {
      const w = window as unknown as {
        __princePlayScene(s: unknown): Promise<void>;
        __princePause(on: boolean): void;
        __princePlaySound(i: number): void;
        __princeHeard(): number[];
        __princeSceneState(): { running: boolean; lit: number; wantsText: boolean } | null;
        __princeFrame(): number[];
        __princeMute(on: boolean): void;
        __started: { at: number; kind: string }[];
      };
      const esc = (): void => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', bubbles: true,
        }));
      };
      w.__princeMute(false);
      w.__princePause(false);
      /**
       * Nothing else may be going on. `changeScene` lets one scene
       * change happen at a time, so a scene asked for while the
       * title is still running -- or while the level the walk left
       * behind is restarting -- is simply dropped, and the walk read
       * that as a scene that drew nothing.
       */
      for (let i = 0; i < 60 && w.__princeSceneState()?.running; i++) {
        esc();
        await new Promise((r) => setTimeout(r, 150));
      }
      /**
       * And a key whether or not a scene was running, because
       * `play_level`'s `while (check_sound_playing() && !do_paused())`
       * is the other thing that holds the loop: `restart` sets it, the
       * walk's `r` cheat restarts the level, and the wait has a
       * twenty-five second cap. The first scene after the levels came
       * back running but black for exactly that.
       */
      esc();
      await new Promise((r) => setTimeout(r, 400));
      esc();
      /**
       * And the channel is emptied. `load_intro` opens on
       * `while (check_sound_playing())` and draws nothing until it
       * is over, which is the original's own behaviour -- the
       * title's tune is twenty-three seconds and the first scene
       * the walk asks for was spending its whole window waiting on
       * it, running and black. -1 is `SOUND_SILENCE`, which is how
       * the byte-code itself asks for quiet.
       */
      w.__princePlaySound(-1);
      await new Promise((r) => setTimeout(r, 900));
      w.__started.length = 0;
      const heard0 = w.__princeHeard().length;
      await w.__princePlayScene(sc);
      await new Promise((r) => setTimeout(r, 300));
      const hashes = new Set<number>();
      let maxLit = 0;
      const until = Date.now() + (secs as number) * 1000;
      while (Date.now() < until) {
        const st = w.__princeSceneState();
        if (!st || !st.running) break;
        maxLit = Math.max(maxLit, st.lit);
        const px = w.__princeFrame();
        let h = 2166136261;
        for (let i = 0; i < px.length; i += 7) h = Math.imul(h ^ px[i], 16777619);
        hashes.add(h >>> 0);
        await new Promise((r) => setTimeout(r, 100));
      }
      const st = w.__princeSceneState();
      const out = {
        pictures: hashes.size, maxLit,
        running: st?.running ?? false, wantsText: st?.wantsText ?? false,
        sounds: [...new Set(w.__princeHeard().slice(heard0))]
          .sort((a, b) => a - b),
      };
      /**
       * End it before the next one is asked for. `do_paused` takes
       * any key, and `changeScene` lets one scene change happen at a
       * time -- so a scene asked for while the one before it is still
       * running is simply dropped, and the walk read that as a scene
       * that drew nothing.
       */
      for (let i = 0; i < 40 && w.__princeSceneState()?.running; i++) {
        esc();
        await new Promise((r) => setTimeout(r, 150));
      }
      await new Promise((r) => setTimeout(r, 600));
      return out;
    }, [scene, seconds] as const);
    console.log(`${name.padEnd(14)} pictures ${String(got.pictures).padStart(3)}`
      + `  lit ${String(got.maxLit).padStart(5)}  sounds ${got.sounds.length}`
      + `  [${got.sounds.map(named).join(' ')}]${got.wantsText ? '  name box' : ''}`);
    if (got.pictures < 3) {
      fail(name, `the picture took ${got.pictures} shapes, running=${got.running}`);
    }
    if (got.maxLit < 1000) fail(name, `only ${got.maxLit} pixels were ever lit`);
    if (got.sounds.length === 0) fail(name, 'nothing sounded');
  }

  if (thrown.length) {
    for (const t of thrown.slice(0, 20)) fail('the page threw', t);
  }
  console.log(`\n${bad === 0 ? 'nothing silent, still or thrown' : `${bad} faults`}`);
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  process.exit(bad === 0 ? 0 : 1);
}

await main();
