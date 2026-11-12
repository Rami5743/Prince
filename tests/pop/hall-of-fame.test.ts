/**
 * The hall of fame, which the port did not have.
 *
 * `end_sequence` ends in it: the game asks the player who they are,
 * puts the name beside the time that is left and keeps the six best
 * runs. The C writes them to `PRINCE.HOF` beside the game's files;
 * a page has nowhere to put a file, so the same bytes go into
 * `localStorage`. That is the one substitution, and this pins both
 * halves of it -- the bytes, and that the screen can be got through
 * when there is no `localStorage` at all.
 *
 * No capture reaches any of this: every recording is one level of an
 * ordinary run, and the hall of fame comes after level 14.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { CutscenePlayer, UNIT_MS, HOF_STORAGE_KEY } from '../../src/pop/cutscene.ts';
import { g } from '../../src/pop/state.ts';
import {
  hof, hof_count, hof_read, hof_write, MAX_HOF_COUNT, HOF_ENTRY_BYTES,
} from '../../src/pop/seg001.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** A `localStorage` of the shape the page has one, or one that throws. */
function fakeStorage(throwing = false): Storage {
  const map = new Map<string, string>();
  const boom = (): never => { throw new DOMException('denied', 'SecurityError'); };
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (throwing ? boom() : map.get(k) ?? null),
    setItem: (k: string, v: string) => { if (throwing) boom(); map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  } as Storage;
}

const slot = globalThis as unknown as { localStorage?: Storage };
let saved: Storage | undefined;

beforeEach(() => { saved = slot.localStorage; });
afterEach(() => {
  if (saved === undefined) delete slot.localStorage;
  else slot.localStorage = saved;
});

/**
 * Play a scene through, typing `name` into the hall of fame when it
 * asks. Answers which palette rows were ever drawn and how long it took.
 */
async function play(
  scene: Parameters<CutscenePlayer['begin']>[0],
  options: { name?: string; remMin?: number; remTick?: number } = {},
): Promise<{ rows: Set<number>; seconds: number; finished: boolean }> {
  const player = await CutscenePlayer.create(assets, exe);
  if (options.remMin !== undefined) g.rem_min = options.remMin;
  if (options.remTick !== undefined) g.rem_tick = options.remTick;
  player.begin(scene);
  const toType = [...(options.name ?? '')]
    .map((ch) => ({ key: '', ch }))
    .concat([{ key: 'enter', ch: '' }]);
  const rows = new Set<number>();
  let units = 0;
  while (player.running && units < 300 * 60) {
    player.advance(UNIT_MS);
    units++;
    if (player.wantsText && toType.length) {
      const next = toType.shift()!;
      player.pushKey(next.key, next.ch);
    }
    for (const v of player.render().pixels) if (v !== 0) rows.add(v >> 4);
  }
  return { rows, seconds: units / 60, finished: !player.running };
}

describe('PRINCE.HOF', () => {
  it('is 176 bytes: a count and six packed records', async () => {
    slot.localStorage = fakeStorage();
    // The two file slots are `cutscene.ts`'s, and it fills them in
    // when it is built -- which is where the C's `init_game_main`
    // calls `hof_read()` too.
    await CutscenePlayer.create(assets, exe);
    hof_read();
    expect(hof_count).toBe(0);
    hof[0] = { name: 'JORDAN', min: 42, tick: 300 };
    hof[1] = { name: 'MECHNER', min: 7, tick: 11 };
    // `hof_count` is not exported as a setter, so the count that is
    // written is whatever the last `hof_read` left; write and read
    // back the records, which is what the layout is about.
    hof_write();
    const stored = slot.localStorage.getItem(HOF_STORAGE_KEY)!;
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    expect(bytes.length).toBe(2 + MAX_HOF_COUNT * HOF_ENTRY_BYTES);
    expect(bytes.length).toBe(176);
    // `char name[25]` NUL-padded, then `short min` and `short tick`,
    // little-endian, exactly as the original's `fwrite(&hof, ...)`.
    expect(String.fromCharCode(...bytes.slice(2, 8))).toBe('JORDAN');
    expect(bytes[2 + 6]).toBe(0);
    const dv = new DataView(bytes.buffer);
    expect(dv.getInt16(2 + 25, true)).toBe(42);
    expect(dv.getInt16(2 + 27, true)).toBe(300);
    expect(dv.getInt16(2 + 29 + 25, true)).toBe(7);
    // And it reads back what it wrote.
    hof[0] = { name: '', min: 0, tick: 0 };
    hof_read();
    expect(hof[0]).toEqual({ name: 'JORDAN', min: 42, tick: 300 });
    expect(hof[1]).toEqual({ name: 'MECHNER', min: 7, tick: 11 });
  });

  it('is empty where there is no file', async () => {
    slot.localStorage = fakeStorage();
    await CutscenePlayer.create(assets, exe);
    hof_read();
    expect(hof_count).toBe(0);
    expect(hof.every((e) => e.name === '')).toBe(true);
  });
});

describe('the end of the ending', () => {
  it('asks for a name, keeps it with the time left, and writes it', async () => {
    slot.localStorage = fakeStorage();
    // Forty-one minutes and 300 ticks of the forty-second left.
    const seen = await play({ kind: 'ending' }, { name: 'JORDAN', remMin: 42, remTick: 300 });
    expect(seen.finished).toBe(true);
    // Row 11 is TITLE.DAT group 40: the story frame, `HOF_POP` and
    // the text drawn in its colour 7, which is 0xB7.
    expect(seen.rows.has(11)).toBe(true);
    // The entry the run earned, in memory and on the way to the file.
    expect(hof_count).toBe(1);
    expect(hof[0]).toEqual({ name: 'JORDAN', min: 42, tick: 300 });
    const stored = slot.localStorage.getItem(HOF_STORAGE_KEY);
    expect(stored).not.toBe(null);
    const bytes = Uint8Array.from(atob(stored!), (c) => c.charCodeAt(0));
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(1);
    expect(String.fromCharCode(...bytes.slice(2, 8))).toBe('JORDAN');
  }, 120000);

  it('gets through the screen on a page whose localStorage throws', async () => {
    slot.localStorage = fakeStorage(true);
    const seen = await play({ kind: 'ending' }, { name: 'NOBODY', remMin: 10, remTick: 5 });
    // The scene ended rather than leaving the page sitting on a box
    // it could not get out of.
    expect(seen.finished).toBe(true);
    expect(hof[0]).toEqual({ name: 'NOBODY', min: 10, tick: 5 });
  }, 120000);

  it('the title then shows it, and did not before', async () => {
    slot.localStorage = fakeStorage();
    // Nothing stored: `if (hof_count)` is false and the title has no
    // hall of fame in it.
    const without = await play({ kind: 'title' });
    expect(without.finished).toBe(true);
    expect(hof_count).toBe(0);
    // Somebody finishes the game, which is the only way an entry is
    // made, and the title that follows shows it.
    await play({ kind: 'ending' }, { name: 'JORDAN', remMin: 42, remTick: 300 });
    const after = await play({ kind: 'title' });
    expect(after.finished).toBe(true);
    expect(hof_count).toBe(1);
    // `transition_ltr()` is 160 steps of half a sixtieth and
    // `pop_wait(timer_0, 0xF0)` is 240 sixtieths: 320 in all.
    expect(after.seconds - without.seconds).toBeCloseTo(320 / 60, 1);
  }, 240000);
});

/**
 * Typed at badly.
 *
 * `input_str` is the one place in the port where the player types,
 * and no capture reaches it. Everything about it is a corner: a
 * Backspace on an empty box, twenty-five characters into a box that
 * holds twenty-four, a name wider than the box it is drawn in, a key
 * that produces no character at all. This plays the ending through
 * on a stream of them and asks only that it ends and that what comes
 * out is what the C's two limits allow.
 */
describe('the name box, typed at badly', () => {
  it('ends however the keys come, and keeps what the C would keep', async () => {
    for (let s = 0; s < 6; s++) {
      slot.localStorage = fakeStorage();
      let seed = 20261112 + s * 7919;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      };
      const player = await CutscenePlayer.create(assets, exe);
      g.rem_min = 30 + s;
      g.rem_tick = 100 * s;
      player.begin({ kind: 'ending' });
      let typed = 0;
      let units = 0;
      for (; player.running && units < 300 * 60; units++) {
        player.advance(UNIT_MS);
        if (!player.wantsText) continue;
        const r = rnd();
        // Escape clears the box and `end_sequence` opens it again --
        // `while (input_str(...) <= 0)` -- so it must not be the way
        // out, and the loop must still end.
        if (r < 0.04) player.pushKey('escape', '');
        else if (r < 0.14) player.pushKey('backspace', '');
        else if (r < 0.18) player.pushKey('delete', '');
        else if (r < 0.22) player.pushKey('', ''); // a key with no character
        else if (typed > 40 && r < 0.3) player.pushKey('enter', '');
        else {
          typed++;
          player.pushKey('', String.fromCharCode(0x21 + Math.floor(rnd() * 94)));
        }
      }
      expect(player.running, `seed ${s} ended`).toBe(false);
      const name = hof[0]!.name;
      // `max_length` is 24, and the box is 140 pixels wide, so the
      // pixel guard bites first -- but never the other way round.
      expect(name.length).toBeLessThanOrEqual(24);
      expect([...name].every((c) => c >= ' ' && c <= '~')).toBe(true);
      // A name was taken and written: `input_str` only returns a
      // length greater than nought.
      expect(name.length).toBeGreaterThan(0);
      expect(slot.localStorage.getItem(HOF_STORAGE_KEY)).not.toBe(null);
    }
  }, 240000);
});
