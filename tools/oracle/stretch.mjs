#!/usr/bin/env node
/**
 * The same run, slowed down to something the emulator can replay.
 *
 * DOSBox takes a press of four ticks or more reliably and a shorter
 * one about half the time -- see the README, and
 * `tools/dev/short-presses.ts` for which recordings are full of them.
 * A recording of a sword fight is nothing but short presses, so a
 * capture of it measures the emulator's keyboard and not the port:
 * `gate2` is 1309 ticks of level 2 and the port agrees with its
 * capture on 108 of them, parting company at the first one-tick tap.
 *
 * This writes the recording out again with every stretch of unchanged
 * keys given at least `--min` ticks, so the Prince does the same
 * things in the same order and the replay can be trusted. He will not
 * end up where he did -- a four-tick step is further than a one-tick
 * one -- so a stretched recording is a probe of its own, not a truer
 * copy of the player's run. `exitdoor` is `gate1` stretched this way
 * and it is the only capture that reaches the climb up the level door.
 *
 *   node tools/oracle/stretch.mjs <in.json> <out.json> [--min 4]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRecording, decodeTimeline, encodeTimeline, RECORDING_FORMAT, RECORDING_VERSION }
  from '../../src/game/recording.ts';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

const [inPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!inPath || !outPath) {
  console.error('usage: stretch.mjs <in.json> <out.json> [--min 4]');
  process.exit(2);
}
const min = Number(arg('min', 4));
const rec = parseRecording(readFileSync(inPath, 'utf8'));
const ticks = decodeTimeline(rec.timeline);

/** The run-length form of the timeline, with every run at least `min`. */
const same = (a, b) => a.x === b.x && a.y === b.y && a.shift === b.shift;
const out = [];
let i = 0;
while (i < ticks.length) {
  let j = i;
  while (j < ticks.length && same(ticks[j], ticks[i])) j++;
  const want = Math.max(j - i, min);
  for (let k = 0; k < want; k++) out.push(ticks[i]);
  i = j;
}

const CODE = { left: 'Numpad4', right: 'Numpad6', up: 'Numpad8', down: 'Numpad2' };
const events = [];
let was = { x: 0, y: 0, shift: false };
for (let t = 0; t < out.length; t++) {
  const now = out[t];
  const ms = Math.round((t * 1000) / 12);
  const edge = (key, down) => events.push({ ms, tick: t, type: down ? 'down' : 'up', key });
  if (now.x !== was.x) {
    if (was.x < 0) edge(CODE.left, false);
    if (was.x > 0) edge(CODE.right, false);
    if (now.x < 0) edge(CODE.left, true);
    if (now.x > 0) edge(CODE.right, true);
  }
  if (now.y !== was.y) {
    if (was.y < 0) edge(CODE.up, false);
    if (was.y > 0) edge(CODE.down, false);
    if (now.y < 0) edge(CODE.up, true);
    if (now.y > 0) edge(CODE.down, true);
  }
  if (now.shift !== was.shift) edge('ShiftLeft', now.shift);
  was = now;
}

writeFileSync(outPath, `${JSON.stringify({
  format: RECORDING_FORMAT,
  version: RECORDING_VERSION,
  recordedAt: new Date().toISOString(),
  level: rec.level,
  ticksPerSecond: 12,
  timeline: encodeTimeline(out),
  events,
}, null, 1)}\n`);
console.log(`${inPath}: ${ticks.length} ticks -> ${out.length}, min hold ${min}`);
