/**
 * The exit door, heard in a real browser.
 *
 * The player reported that the exit door makes no sound. The capture
 * of the original settles what it *should* sound like and the port
 * agrees with it exactly -- `tools/dev/sound-report.ts gate1snd`
 * reads 94 of 96 noises, with the door's own 3.500 seconds against
 * the capture's 3.498 and `sound_41_end_level_music` inside four
 * milliseconds. But every one of those measurements is of
 * `src/pop` and `src/render`, through a stand-in for the audio
 * device. None of them is of the page.
 *
 * So this is the page: `gate1`'s own eight hundred ticks of level 1
 * replayed in Chromium with a real `AudioContext`, wrapped so that
 * every `start()` is written down. Three of the five bugs the player
 * found in one sitting were sound, and the one before this -- the
 * opening playing to nobody -- was in `web/main.ts` and invisible to
 * every tick score in the project.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/dev/serve.mjs';
import { REPO } from '../helpers/fixtures.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

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

/** `gate1`: six rooms of level 1, the only probe that opens the door. */
const rec = parseRecording(readFileSync(
  join(REPO, 'tools', 'oracle', 'recordings', 'gate1.json'), 'utf8'));
const timeline = decodeTimeline(rec.timeline).map(
  (c) => ({ x: c.x, y: c.y, shift: c.shift }));

/**
 * The door rises from tick 695 to tick 737 and the Prince climbs into
 * it at 761, which `sound_41_end_level_music` answers at 768. Before
 * that the run has to be got through, and sixty seconds of it are
 * nothing to do with the door -- so the first stretch is stepped as
 * fast as the browser will go, with the sound muted, and only the
 * last hundred and thirty ticks are played at the clock the player
 * hears.
 */
const FAST_UNTIL = 680;

interface Started { at: number; kind: string }

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
  // Every `start()` on the one context, written down before the page
  // has run a line. A buffer source is a digitised sound; an
  // oscillator is a note of a tune.
  await page.addInitScript(() => {
    const w = window as unknown as { __started: Started[] };
    w.__started = [];
    interface Started { at: number; kind: string }
    const Ctx = window.AudioContext;
    const note = (ctx: AudioContext, kind: string): void => {
      (window as unknown as { __ctx: AudioContext }).__ctx = ctx;
      w.__started.push({ at: ctx.currentTime, kind });
    };
    window.AudioContext = class extends Ctx {
      constructor(...a: unknown[]) {
        super(...(a as []));
        (window as unknown as { __ctx: AudioContext }).__ctx = this;
      }
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
  await page.waitForFunction('window.__princeReady === true', null, { timeout: 30000 });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => server?.close(() => r()));
});

describe('the exit door, on the page', () => {
  it('sounds for the three and a half seconds it rises', async () => {
    const log = await page.evaluate(async ([tl, fast]) => {
      const w = window as unknown as {
        __princeGoToLevel(l: number): void;
        __princePause(on: boolean): void;
        __princeMute(on: boolean): void;
        __princeStep(n: number, c: unknown): unknown;
        __princeLevel(): number;
        __started: Started[];
      };
      interface Started { at: number; kind: string }
      const ticks = tl as { x: number; y: number; shift: boolean }[];
      w.__princePause(true);
      w.__princeGoToLevel(1);
      // `changeScene` is a promise; give it a few frames to land.
      await new Promise((r) => setTimeout(r, 500));
      w.__princeMute(true);
      for (let t = 0; t < (fast as number); t++) w.__princeStep(1, ticks[t]);
      w.__princeMute(false);
      w.__started.length = 0;
      const ctx = (window as unknown as { __ctx: AudioContext }).__ctx;
      const marks: [number, number][] = [];
      // The last stretch at the player's own clock: one tick every
      // eighty-three milliseconds, which is what the audio context
      // measures its own time in.
      await new Promise<void>((done) => {
        let t = fast as number;
        const id = setInterval(() => {
          if (t >= ticks.length) { clearInterval(id); done(); return; }
          marks.push([t, ctx.currentTime]);
          w.__princeStep(1, ticks[t]);
          t++;
        }, 1000 / 12);
      });
      return { started: w.__started, marks, level: w.__princeLevel() };
    }, [timeline, FAST_UNTIL] as const);
    expect(consoleErrors).toEqual([]);

    /** Which tick of the run a context time falls in. */
    const tickOf = (at: number): number => {
      let best = FAST_UNTIL;
      for (const [t, c] of log.marks) if (c <= at) best = t;
      return best;
    };
    // One `start()` per note, so a tune arrives as a hundred of them
    // at one instant.
    const seen = new Set<string>();
    const starts: { tick: number; kind: string }[] = [];
    for (const s of log.started) {
      const key = `${s.at.toFixed(4)} ${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      starts.push({ tick: tickOf(s.at), kind: s.kind });
    }

    /**
     * `sound_15_leveldoor_sliding` is the 1.613-second recording, and
     * the only one in `DIGISND*.DAT` under 8000 Hz: 2750, where a
     * browser's `createBuffer` throws below 3000. Before
     * `MIN_BUFFER_RATE` the door played **nought** times here while
     * the capture of the original has one unbroken noise of 3.498
     * seconds over the same ticks. The byte-code asks on each of the
     * forty-odd ticks from 701, the sound is uninterruptible, so it
     * is three whole plays.
     */
    const door = starts.filter((s) => s.kind === 'buffer:1.613');
    expect(door.length, `the door: ${JSON.stringify(starts)}`).toBeGreaterThanOrEqual(2);
    expect(door[0].tick).toBeGreaterThanOrEqual(695);
    expect(door[0].tick).toBeLessThanOrEqual(705);
    expect(door[door.length - 1].tick).toBeGreaterThanOrEqual(730);

    /**
     * And the level ends on its music: `seq_70_go_up_on_level_door`'s
     * `SND_LEVEL` asks for `sound_41_end_level_music` at tick 768,
     * which the capture of the original starts at 94.28 - 92.35 into
     * the same run. It has no recording, so it is the MIDI.
     */
    const music = starts.filter((s) => s.kind === 'tune');
    expect(music.length, `the music: ${JSON.stringify(starts)}`).toBeGreaterThan(0);
    expect(music[0].tick).toBeGreaterThanOrEqual(765);
    expect(music[0].tick).toBeLessThanOrEqual(772);
  }, 180000);
});
