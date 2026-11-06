/**
 * Play a level headlessly from a written-out input timeline and print what
 * the Prince does, tick by tick.
 *
 *   node --experimental-strip-types tools/dev/play.ts <level> "<timeline>"
 *
 * The timeline is a comma-separated list of `<ticks><key>` items, where key
 * is one of  .  (nothing)  l r u d  and an optional `s` adds Shift:
 *
 *   node --experimental-strip-types tools/dev/play.ts 1 "12.,30r,6u,20."
 *
 * With `--sheet <file.png> <from> <to>` it also writes the rendered frames of
 * that tick range as one contact sheet, which is how an animation is looked
 * at without a browser.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import type { Controls } from '../../src/game/kid.ts';
import { decodeTimeline } from '../../src/game/recording.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');

/** The timeline spelling lives with the recording format now. */
export const parseTimeline = decodeTimeline;

export interface Tick {
  tick: number;
  controls: Controls;
  frame: number;
  action: number;
  room: number;
  x: number;
  y: number;
  column: number;
  row: number;
  alive: number;
  hitPoints: number;
}

export interface SheetOptions { file: string; from: number; to: number }

export async function play(
  level: number, timeline: Controls[], sheet?: SheetOptions,
): Promise<Tick[]> {
  const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
  const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
  const game = await Game.start(assets, exe, level);
  const out: Tick[] = [];
  const shots: Uint8Array[] = [];
  for (let t = 0; t < timeline.length; t++) {
    game.step(timeline[t]);
    if (sheet && t >= sheet.from && t <= sheet.to) {
      shots.push(game.render().toRgb(game.scene.screenPalette.toRgba()).slice(0, 320 * 200 * 3));
    }
    out.push({
      tick: t, controls: timeline[t],
      frame: game.kid.frame, action: game.kid.action, room: game.kid.room,
      x: game.kid.x, y: game.kid.y,
      column: game.kid.currentColumn, row: game.kid.currentRow,
      alive: game.kid.alive, hitPoints: game.hitPoints,
    });
  }
  if (sheet && shots.length) writeSheet(sheet.file, shots);
  return out;
}

/** Lay rendered frames out in a grid, four to a row, and write one PNG. */
function writeSheet(file: string, shots: Uint8Array[]): void {
  const W = 320, H = 200;
  const cols = Math.min(4, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const png = new PNG({ width: cols * W, height: rows * H });
  shots.forEach((rgb, i) => {
    const ox = (i % cols) * W, oy = Math.floor(i / cols) * H;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 3;
        const d = ((oy + y) * cols * W + ox + x) * 4;
        png.data[d] = rgb[s]; png.data[d + 1] = rgb[s + 1];
        png.data[d + 2] = rgb[s + 2]; png.data[d + 3] = 255;
      }
    }
  });
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, PNG.sync.write(png));
}

const KEY = (c: Controls): string =>
  (c.x === -1 ? 'L' : c.x === 1 ? 'R' : c.y === -1 ? 'U' : c.y === 1 ? 'D' : '-')
  + (c.shift ? '+S' : '  ');

if (process.argv[1]?.endsWith('play.ts')) {
  const level = Number(process.argv[2] ?? 1);
  const spec = process.argv[3] ?? '40.';
  const si = process.argv.indexOf('--sheet');
  const sheet = si > 0
    ? { file: process.argv[si + 1], from: Number(process.argv[si + 2]), to: Number(process.argv[si + 3]) }
    : undefined;
  const ticks = await play(level, parseTimeline(spec), sheet);
  console.log('tick key   frame act room    x    y  col row  alive hp');
  for (const t of ticks) {
    console.log(
      String(t.tick).padStart(4),
      KEY(t.controls),
      String(t.frame).padStart(5),
      String(t.action).padStart(3),
      String(t.room).padStart(4),
      String(t.x).padStart(5),
      String(t.y).padStart(5),
      String(t.column).padStart(4),
      String(t.row).padStart(3),
      String(t.alive).padStart(6),
      String(t.hitPoints).padStart(3),
    );
  }
}
