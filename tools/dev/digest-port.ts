/**
 * The port's side of `tools/oracle/digest.py`: what moved, tick by tick.
 *
 *   node --experimental-strip-types tools/dev/digest-port.ts \
 *       <recording.json> <out.json>
 *
 * The same four numbers and a count the capture is boiled down to, read
 * off the port's own rendering of the same recording, so the two can be
 * compared without keeping twenty megabytes of pictures about.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Assets } from '../../src/render/assets.ts';
import { Game } from '../../src/game/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { digestOfRun } from './digest-common.ts';

const GAME_DIR = join(import.meta.dirname, '..', '..', 'original', 'prince1');

const path = process.argv[2];
const out = process.argv[3];
if (!path || !out) {
  console.error('usage: digest-port.ts <recording.json> <out.json>');
  process.exit(2);
}
const rec = parseRecording(readFileSync(path, 'utf8'));
const ticks = decodeTimeline(rec.timeline);
const assets = new Assets(async (n) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const digest = await digestOfRun(
  () => Game.start(assets, exe, rec.level), (g) => g.restart(assets, exe), ticks,
);
writeFileSync(out, JSON.stringify({ ticks: digest }));
console.log(`${digest.length} ticks -> ${out}`);
