#!/usr/bin/env node
/**
 * A recording the player never made.
 *
 * The oracle replays a browser recording against the original, which is
 * the right way to settle an argument about a run the player actually
 * had. It is the wrong way to settle a question of my own -- `what does
 * the original do if Down is pressed four times from here` -- because
 * asking the player to go and press Down four times is slow, imprecise,
 * and lands him somewhere slightly different every time.
 *
 * This writes a recording from a timeline instead, in the same format,
 * so everything downstream of it -- `recording_to_script.mjs`, the
 * DOSBox run, `split_ticks.py`, `replay-frames.ts`, `segments.py` --
 * works on it unchanged.
 *
 *   node tools/oracle/make_probe.mjs '20.,1d,3.,1d,3.,40.' out.json [--level 1]
 *
 * The timeline is the recording's own run-length form: `12.` is twelve
 * ticks of nothing, `30r` thirty of Right, `6us` six of Up and Shift.
 * Key edges are placed at the start of the tick they belong to, which is
 * the best the replay can do anyway; see the README on why a press of
 * two ticks or less is a coin toss, and give a probe press four.
 */
import { writeFileSync } from 'node:fs';
import { decodeTimeline, encodeTimeline, RECORDING_FORMAT, RECORDING_VERSION }
  from '../../src/game/recording.ts';

/** The browser `code` the recorder writes for each direction. */
const CODE = { left: 'Numpad4', right: 'Numpad6', up: 'Numpad8', down: 'Numpad2' };

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

const timeline = process.argv[2];
const out = process.argv[3];
if (!timeline || !out) {
  console.error("usage: make_probe.mjs '<timeline>' <out.json> [--level N]");
  process.exit(2);
}
const level = Number(arg('level', 1));
const ticksPerSecond = 12;
const ticks = decodeTimeline(timeline);

const events = [];
let was = { x: 0, y: 0, shift: false };
for (let t = 0; t < ticks.length; t++) {
  const now = ticks[t];
  const ms = Math.round((t * 1000) / ticksPerSecond);
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
// Let go of whatever is still down, so the emulator is not left holding it.
const end = Math.round((ticks.length * 1000) / ticksPerSecond);
if (was.x < 0) events.push({ ms: end, tick: ticks.length, type: 'up', key: CODE.left });
if (was.x > 0) events.push({ ms: end, tick: ticks.length, type: 'up', key: CODE.right });
if (was.y < 0) events.push({ ms: end, tick: ticks.length, type: 'up', key: CODE.up });
if (was.y > 0) events.push({ ms: end, tick: ticks.length, type: 'up', key: CODE.down });
if (was.shift) events.push({ ms: end, tick: ticks.length, type: 'up', key: 'ShiftLeft' });

writeFileSync(out, JSON.stringify({
  format: RECORDING_FORMAT,
  version: RECORDING_VERSION,
  recordedAt: new Date().toISOString(),
  level,
  ticksPerSecond,
  timeline: encodeTimeline(ticks),
  events,
  states: [],
}, null, 1));
console.log(`${out}: ${ticks.length} ticks, ${events.length} key edges, level ${level}`);
