#!/usr/bin/env node
/**
 * Turn a recording made in the browser into an emulator script, from the
 * *raw key events* rather than from the per-tick timeline.
 *
 * This is the difference that matters. The timeline is what the page
 * decided the keys were, after its own reading of the keyboard; replaying
 * that would compare the port against its own idea of the input and could
 * never show up a fault in the reading itself. The raw events are what the
 * player's fingers did, with millisecond stamps, and those are what the
 * original gets here.
 *
 * Two things make the replay keep time with the recording.
 *
 * The whole schedule goes out as one chained xdotool invocation with its
 * own `sleep`s. A process per key edge costs twenty to forty milliseconds
 * that the script's waits know nothing about, and a few hundred edges of
 * that is seconds of drift -- which is what made the first replay part
 * company with the port after about nine seconds.
 *
 * And the schedule is anchored on Ctrl+A, the original's restart-level
 * key, because that is what the recorder does too: it restarts the level
 * and begins at once. Without it the emulator has been standing about at
 * the level start for however long the script waited, and the first key
 * arrives to a Prince in a different pose from the port's.
 *
 *   node tools/oracle/recording_to_script.mjs <recording.json> [out.txt]
 *
 * `--settle <seconds>` is how long after Ctrl+A the level is running
 * again; see tools/oracle/README for how it was measured.
 *
 * ## Where inside a tick an edge goes
 *
 * The game looks at the keyboard once a tick and nowhere else, at the
 * start of the tick, so the only thing that matters about when a key
 * goes down is *which tick first sees it*. The recorder knows that:
 * every event it keeps carries the tick that was current when it
 * arrived, which is the tick the port acted on it in.
 *
 * For the original to act on it in that tick too, the edge has to be
 * down before that tick begins, and far enough before it that the X
 * server, DOSBox's keyboard emulation and the game's own read have all
 * happened. Measured, that is a whole tick: each edge goes out at
 * `(tick - 1) / 12`.
 *
 * The measurement is `probeE`, captured at a quarter of a tick either
 * side. At `(tick - 1)/12` the port and the capture line up at offset
 * nought for every one of the run's 165 ticks, with no drift anywhere.
 * At `(tick - 1.5)/12` the original acts a tick early from the first
 * press; at `(tick - 0.5)/12` it acts a tick late. So the window is
 * about a tick wide and this is the middle of it.
 *
 * Nothing is lost by the quantising: a press and a release inside one
 * tick is not something the game can see anyway.
 *
 * `--raw-ms` puts the millisecond stamps back, which is what this did
 * before, and is kept for showing that the difference is real.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseRecording } from '../../src/game/recording.ts';

/** Browser `code` to the name xdotool knows it by. */
const KEYS = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Numpad1: 'KP_1', Numpad2: 'KP_2', Numpad3: 'KP_3', Numpad4: 'KP_4',
  Numpad5: 'KP_5', Numpad6: 'KP_6', Numpad7: 'KP_7', Numpad8: 'KP_8',
  Numpad9: 'KP_9',
  ShiftLeft: 'shift', ShiftRight: 'shift',
};

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
}

const src = process.argv[2];
if (!src) {
  console.error('usage: recording_to_script.mjs <recording.json> [out.txt]');
  process.exit(2);
}
const rec = parseRecording(readFileSync(src, 'utf8'));
const name = basename(src).replace(/\.json$/, '');
const out = process.argv[3] ?? `tools/oracle/scripts/replay-${name}.txt`;
const settle = arg('settle', 1.6);
const rawMs = process.argv.includes('--raw-ms');
/**
 * Whole ticks to move the whole schedule by.
 *
 * Centring takes care of where inside a tick an edge lands; this takes
 * care of *which* tick, which depends on how long the emulator takes to
 * restart the level after Ctrl+A and is therefore a property of the
 * machine it is run on, not of the recording. It is measured once --
 * `tools/oracle/calibrate.mjs` -- and does not move again until the
 * emulator's speed does.
 */
const shift = arg('shift', 0);
/**
 * How long one of the original's ticks lasts, in seconds of wall clock.
 *
 * A twelfth, and `split_ticks.py` says that is right to a tenth of a
 * per cent: counting the screen changes of a twelve-hundred-tick
 * capture and dividing by the video it took gives 12.0119 ticks a
 * second. `--rate` is here because that tenth of a per cent is still a
 * tick and a half over the longest recording, and because the number
 * is worth being able to change without editing this file.
 */
const RATE = arg('rate', 12);
const TICK = 1 / RATE;
/** Nothing is sent closer together than this, so two edges cannot merge. */
const MIN_GAP = 0.002;
/**
 * What a command in the chain costs, in seconds of wall clock.
 *
 * Chaining the whole schedule into one `xdotool` was supposed to settle
 * this: a process per edge costs twenty to forty milliseconds and a few
 * hundred of those is seconds of drift. It settled most of it. What is
 * left is that `keydown` and `keyup` are not free either -- each is a
 * round trip to the X server -- and `sleep` overshoots a little.
 *
 * Measured on this machine, with Xvfb and nothing else running: a chain
 * of two hundred key edges and two hundred sleeps takes 12.7 ms per edge
 * longer than the sleeps asked for, and the same chain with the keys
 * taken out overshoots by 1.0 ms per sleep. So a key edge costs about
 * twelve milliseconds and a sleep about one.
 *
 * Twelve milliseconds is a seventh of a tick, and it accumulates: by the
 * twenty-fifth edge of a recording the schedule is two ticks late, which
 * is two ticks of the Prince doing the wrong thing. Each sleep is now
 * shortened by what the commands around it cost.
 */
const SLEEP_COST = 0.0010;
const EDGE_COST = 0.0130;

const lines = [
  `# generated from ${basename(src)} -- the player's own key events, replayed`,
  'wait 25',
  'key Return',
  'wait 25',
];
for (let l = 1; l < rec.level; l++) lines.push('key shift+l', 'wait 70');
// Ctrl+A restarts the level, which is where the recording starts too.
lines.push('key ctrl+a', `wait ${settle.toFixed(3)}`);

/**
 * The schedule, in blocks that each start at an absolute time.
 *
 * One chained `xdotool` for the whole run was an improvement on a
 * process per edge, but it is still a chain: what each command costs
 * pushes the next one later, and thirteen milliseconds an edge over a
 * hundred and thirty edges is two ticks by the end. So the schedule is
 * cut into blocks, and `dosbox_oracle.py` sleeps to the block's own
 * absolute time before firing it. The drift inside a block is a few
 * edges' worth and the next block starts where it should.
 */
const BLOCK_GAP = 0.3;
const edges = [];
const down = new Set();
let sent = 0;
let dropped = 0;
for (const e of rec.events) {
  const key = KEYS[e.key];
  if (!key) continue;
  // Auto-repeat: the browser fires keydown over and over while a key is
  // held. The emulator needs the edges, not the repeats.
  if (e.type === 'down' && down.has(key)) { dropped++; continue; }
  if (e.type === 'up' && !down.has(key)) { dropped++; continue; }
  const want = rawMs ? e.ms / 1000 : (e.tick - 1 + shift) * TICK;
  if (e.type === 'down') down.add(key); else down.delete(key);
  edges.push({ want, type: e.type, key });
  sent++;
}
lines.push('origin');
let at = 0;
let block = [];
let blockStart = 0;
const flush = () => {
  if (!block.length) return;
  lines.push(`at ${blockStart.toFixed(4)}`, `xdo ${block.join(' ')}`);
  block = [];
};
for (let i = 0; i < edges.length; i++) {
  const e = edges[i];
  if (!block.length) {
    // The block's own clock starts here. Starting the process costs
    // about twenty-three milliseconds and the keydown itself twelve,
    // and the `at` has to be that much earlier.
    blockStart = Math.max(0, e.want - EDGE_COST);
    at = e.want;
  } else {
    const wait = Math.max(MIN_GAP, e.want - at - EDGE_COST);
    block.push('sleep', wait.toFixed(4));
    at = Math.max(e.want, at + MIN_GAP);
  }
  block.push(e.type === 'down' ? 'keydown' : 'keyup', '--window', '@W', e.key);
  const next = edges[i + 1];
  if (!next || next.want - e.want >= BLOCK_GAP) flush();
}
flush();
for (const key of down) lines.push(`xdo keyup --window @W ${key}`);
lines.push('wait 3');

writeFileSync(out, lines.join('\n') + '\n');
console.error(`${out}: level ${rec.level}, ${sent} key edges `
  + `(${dropped} auto-repeats and strays dropped), `
  + `${at.toFixed(1)}s of play, settle ${settle}s`
  + `${rawMs ? ', raw millisecond stamps' : ', edges a tick ahead of their own'}`
  + `${shift ? `, shifted ${shift} ticks` : ''}`
  + `, ${(EDGE_COST * 1000).toFixed(1)}ms taken off each sleep`);
console.log(`python3 tools/oracle/dosbox_oracle.py --script ${out} \\
    --out /tmp/replay-${name} --record /tmp/replay-${name}/run.mkv --fps 30`);
