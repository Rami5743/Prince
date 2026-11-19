/**
 * A probe that draws every room of a level, and nothing else.
 *
 *   npx tsx tools/dev/room-tour.ts <level> [ticks per room] [first tick]
 *
 * ## Why
 *
 * Before these, the suite had drawn **59 of the game's 266 rooms**.
 * A recording of a level reaches the rooms a player walks through
 * and no others, so ten levels had two or three rooms apiece --
 * `level12` two of twenty-four, `level7` two of twenty-four,
 * `level9` three of twenty-four -- and the original's picture of
 * the rest had never been put beside the port's at all. That is
 * the unmeasured half of the game, and it is not the gameplay that
 * is missing from it: it is the **rooms**.
 *
 * ## What it writes
 *
 * `h`, `j`, `u` and `n` are `process_key`'s `next_room = room_L`,
 * `room_R`, `room_A`, `room_B`, and `check_the_end` then does
 * `loadkid`, `anim_tile_modif`, `start_chompers`, `check_fall_flo`
 * and `check_shadow` -- so drawing a room raises whatever that room
 * raises: its guard, its chompers, its falling floors, its shadow.
 * This prints the timeline and the `--cheat` arguments for a
 * depth-first walk of the level's `roomlinks` that visits every room
 * reachable from the one the level starts in, a fixed number of
 * ticks on each, with the Prince left standing where he began.
 *
 *     npx tsx tools/dev/room-tour.ts 2 24
 *     node tools/oracle/make_probe.mjs '1156.' \
 *       tools/oracle/recordings/rooms2.json --level 2 --cheat 28:h ...
 *     npx tsx tools/dev/probe-seeds.ts rooms2
 *     tools/oracle/firstcapture.sh rooms2 0 2
 *
 * ## Why a tour can be adjudicated where `gate2c` could not
 *
 * Round 14 killed a probe whose cheat had to land inside a six-tick
 * window, and wrote the rule down: a cheat reaches the emulator
 * several ticks after the tick it is asked for, so a probe that
 * depends on *when* it lands cannot be captured. A tour depends on
 * nothing of the sort. The room is still for two seconds either
 * side of every cheat, so the ticks the emulator spends taking the
 * key are the only ones lost, and the ones after it are the same
 * picture on both sides. Nothing is pressed, so there is no key
 * edge and no shift to choose; nobody fights, so the only `prandom`
 * left is the flames the digest masks.
 *
 * Measured before any capture was spent, by `probe-seeds.ts`: two
 * seeds 77776 apart draw **every tick the same** on the tours of
 * levels 1 to 12 and 14, and differ on 41 of level 13's, which is
 * `check_fall_flo` dropping six floors on room 23 -- the same six
 * that are the whole of what `level13` and `jaffar` are short.
 *
 * And then measured against the original: `rooms2` is **1153 of
 * 1153**, all twenty-four rooms of level 2, every tick to the pixel.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g } from '../../src/pop/state.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(
  async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

const level = Number(process.argv[2]);
/** Ticks the tour stands on each room. Two seconds is plenty. */
const hold = Number(process.argv[3] ?? 24);
/**
 * The tick the first cheat goes out on.
 *
 * The level's title is written under the room for the first
 * twenty-five ticks and `digest.py` skips them, so there is nothing
 * to gain by moving earlier.
 */
const first = Number(process.argv[4] ?? 28);

const game = await PopGame.start(assets, exe, level, { minutesLeft: 60, seed: 1 });
game.step({ x: 0, y: 0, shift: false });
const links = g.level.roomlinks;
const startRoom = g.drawn_room;
const neighbours = (r: number): [string, number][] => {
  const l = links[r - 1];
  return [['h', l.left], ['j', l.right], ['u', l.up], ['n', l.down]];
};
const reachable = new Set<number>([startRoom]);
const queue = [startRoom];
while (queue.length) {
  const r = queue.pop()!;
  for (const [, n] of neighbours(r)) {
    if (n >= 1 && n <= 24 && !reachable.has(n)) { reachable.add(n); queue.push(n); }
  }
}
const visited = new Set<number>([startRoom]);
const moves: { key: string; to: number }[] = [];
const back: Record<string, string> = { h: 'j', j: 'h', u: 'n', n: 'u' };
const walk = (r: number): void => {
  for (const [k, n] of neighbours(r)) {
    if (!(n >= 1 && n <= 24) || visited.has(n)) continue;
    visited.add(n);
    moves.push({ key: k, to: n });
    walk(n);
    moves.push({ key: back[k], to: r });
  }
};
walk(startRoom);
// A tour that ends on a room it has already stood on says nothing
// more, so the backtracking tail is trimmed.
while (moves.length > 1
  && moves.filter((m) => m.to === moves[moves.length - 1].to).length > 1) moves.pop();
const cheats: string[] = [];
let t = first;
for (const m of moves) { cheats.push(`${t}:${m.key}`); t += hold; }
const total = t + hold;
console.log(`level ${level}: start room ${startRoom}, ${reachable.size} rooms, `
  + `${moves.length} moves, ${total} ticks`);
console.log(`rooms: ${[...visited].sort((a, b) => a - b).join(' ')}`);
console.log(`TIMELINE ${total}.`);
console.log(`CHEATS ${cheats.map((c) => `--cheat ${c}`).join(' ')}`);
