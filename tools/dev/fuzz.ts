/**
 * The fuller sweep: play every level badly, for a long time, on many
 * seeds, and check more than "it did not throw".
 *
 *   npx tsx tools/dev/fuzz.ts [seeds] [ticks]
 *
 * `tests/pop/levels-smoke.test.ts` does one seed and a thousand ticks,
 * because it runs on every `npm test`. This is the one `CLAUDE.md` says
 * to run by hand after a change to `src/pop`, and it adds the three
 * things the test cannot afford:
 *
 * * more seeds, so a path taken one run in ten is taken;
 * * three thousand ticks a level, so a level is finished and the next
 *   one carried into;
 * * **every global checked for `NaN`**, which is the shape of fault a
 *   C translation makes. C reads a byte past an array and gets a
 *   number; JavaScript gets `undefined`, and `undefined` compared is
 *   merely `false` while `undefined` added is `NaN`. The silent one is
 *   the worse of the two, and nothing but this looks for it.
 *
 * The cutscenes and the hall of fame are swept too: they were written
 * with unit tests only and never played badly at all.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { CutscenePlayer, type SceneName } from '../../src/pop/cutscene.ts';
import { g } from '../../src/pop/state.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const SEEDS = Number(process.argv[2] ?? 8);
const TICKS = Number(process.argv[3] ?? 3000);

let faults = 0;
const fault = (what: string): void => { faults += 1; console.log(`  !! ${what}`); };

/**
 * Every number the game keeps, walked, looking for one that is not a
 * number any more. Arrays and plain objects are walked too; the two
 * surfaces and the sprite banks are not, because they are bytes.
 */
function badNumbers(where: string, seen = new Set<unknown>()): string[] {
  const out: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (depth > 4 || v === null || v === undefined) return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${path} = ${v}`);
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      const a = v as unknown as { length: number; [i: number]: number };
      if (!(v instanceof Uint8Array) && !(v instanceof Int8Array)) {
        for (let i = 0; i < a.length; i++) {
          if (!Number.isFinite(a[i])) { out.push(`${path}[${i}] = ${a[i]}`); break; }
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < 64; i++) walk(v[i], `${path}[${i}]`, depth + 1);
      return;
    }
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      walk(val, `${path}.${k}`, depth + 1);
    }
  };
  walk(g, where, 0);
  return out;
}

function rndOf(seed0: number): () => number {
  let seed = seed0 >>> 0;
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

async function playBadly(seed: number): Promise<void> {
  const rnd = rndOf(seed);
  for (let start = 0; start <= 14; start++) {
    let level = start;
    let game = await PopGame.start(assets, exe, level);
    let hold = { x: 0, y: 0, shift: false };
    let left = 0;
    for (let t = 0; t < TICKS; t++) {
      if (left-- <= 0) {
        const r = rnd();
        hold = {
          x: r < 0.3 ? -1 : r < 0.6 ? 1 : 0,
          y: rnd() < 0.25 ? -1 : rnd() < 0.15 ? 1 : 0,
          shift: rnd() < 0.2,
        };
        left = 1 + Math.floor(rnd() * 14);
      }
      const c = rnd();
      // The cheats, through `cheat()` -- which is where the browser
      // sends them and where the queue is drained inside the tick.
      if (c < 0.004) {
        const keys = ['h', 'j', 'u', 'n', 'ctrl+b', 'k', 'r', 'shift+i',
          'shift+w', 'shift+b', 'shift+s', 'shift+t', '+', '-', 'c', 'shift+c'];
        game.cheat(keys[Math.floor(rnd() * keys.length)]!);
      }
      if (hold.shift && !(t % 97)) game.pressButton();
      try {
        game.step(hold);
        if (game.restartDue) game = await game.restart(assets, exe);
        const px = game.render().pixels;
        if (!px.some((p) => p !== 0)) fault(`seed ${seed} level ${level} tick ${t}: black`);
      } catch (e) {
        fault(`seed ${seed} level ${level} tick ${t}: ${(e as Error).message}`);
        break;
      }
      const bad = badNumbers('g');
      if (bad.length) { fault(`seed ${seed} level ${level} tick ${t}: ${bad.join(', ')}`); break; }
      if (game.gameWon) break;
      if (game.demoFinished || game.restartGameDue) {
        game = await PopGame.start(assets, exe, 0);
        level = 0;
        continue;
      }
      if (game.levelFinished) {
        const carried = {
          ticks: game.remainingTicks, sword: game.hasSword,
          lives: game.maxHitPoints, seamless: game.seamlessExit, hp: game.hitPoints,
        };
        level = level >= 14 ? 1 : level + 1;
        game = await PopGame.start(assets, exe, level, { seamless: carried.seamless });
        game.remainingTicks = carried.ticks;
        game.hasSword = carried.sword || game.hasSword;
        game.beginningHitPoints = carried.lives;
        if (carried.seamless) game.carryHitPoints(carried.hp, carried.lives);
      }
    }
    // And every room of the level drawn on its own, which is `showRoom`
    // and so `check_the_end`'s whole tail.
    for (let room = 0; room <= 25; room++) {
      try {
        game.showRoom(room);
        game.render();
      } catch (e) {
        fault(`seed ${seed} level ${level} showRoom ${room}: ${(e as Error).message}`);
      }
    }
  }
}

/** Every scene, played to the end, with keys thrown at it. */
async function playScenes(seed: number): Promise<void> {
  const rnd = rndOf(seed);
  const player = await CutscenePlayer.create(assets, exe, {});
  const scenes: SceneName[] = [
    { kind: 'title' }, { kind: 'ending' }, { kind: 'expired' },
    ...[2, 4, 6, 8, 9, 12].map((level) => ({ kind: 'level', level } as SceneName)),
  ];
  for (const scene of scenes) {
    const what = scene.kind === 'level' ? `cutscene ${scene.level}` : scene.kind;
    try {
      player.begin(scene);
      let frames = 0;
      while (player.running && frames++ < 9000) {
        // A player hammering the keyboard: the hall of fame asks for a
        // name, and `input_str` is the one place a key is required.
        if (player.wantsText && rnd() < 0.3) {
          const r = rnd();
          // `input_str` reads the C's own scancode names, which is
          // what `textInputKey` in the shell produces.
          player.pushKey(r < 0.2 ? 'enter' : r < 0.3 ? 'backspace' : '',
            r < 0.3 ? '' : 'abcdefghijklmnopqrstuvwxyz '[Math.floor(rnd() * 27)]!);
        }
        player.advance(1000 / 30);
        player.render();
        const bad = badNumbers('g');
        if (bad.length) { fault(`seed ${seed} ${what} frame ${frames}: ${bad.join(', ')}`); break; }
      }
      if (frames >= 9000) fault(`seed ${seed} ${what}: never ended in 9000 frames`);
    } catch (e) {
      fault(`seed ${seed} ${what}: ${(e as Error).message}`);
    }
  }
}

for (let s = 0; s < SEEDS; s++) {
  const seed = 20261113 + s * 7919;
  console.log(`seed ${seed}`);
  await playScenes(seed);
  await playBadly(seed);
}
console.log(faults ? `${faults} faults` : 'no faults');
