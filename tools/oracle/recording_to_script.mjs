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
 * ## Why the edges go in the middle of a tick
 *
 * The game looks at the keyboard once a tick and nowhere else, so the
 * only thing that matters about when a key goes down is *which tick it
 * lands in*. The recorder knows that: every event it keeps carries the
 * tick that was current when it arrived.
 *
 * What the emulator cannot know is where the original's tick boundaries
 * fall in wall-clock time. Ctrl+A anchors the run, but the phase of the
 * timer after it is whatever it is. Sending an edge at exactly `tick/12`
 * seconds therefore puts it within a hair of a boundary and it lands on
 * either side by luck: measured on `probeE`, every press went in one
 * tick early and the original ran a tick ahead of the port for the whole
 * of the rest of the run.
 *
 * So each edge goes out at the *middle* of its tick, `(tick + 0.5) / 12`.
 * Half a tick of phase error either way then changes nothing, and
 * nothing is lost by it: a press and a release inside one tick is not
 * something the game can see anyway.
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

const lines = [
  `# generated from ${basename(src)} -- the player's own key events, replayed`,
  'wait 25',
  'key Return',
  'wait 25',
];
for (let l = 1; l < rec.level; l++) lines.push('key shift+l', 'wait 70');
// Ctrl+A restarts the level, which is where the recording starts too.
lines.push('key ctrl+a', `wait ${settle.toFixed(3)}`);

const chain = [];
const down = new Set();
let at = 0;
let sent = 0;
let dropped = 0;
for (const e of rec.events) {
  const key = KEYS[e.key];
  if (!key) continue;
  // Auto-repeat: the browser fires keydown over and over while a key is
  // held. The emulator needs the edges, not the repeats.
  if (e.type === 'down' && down.has(key)) { dropped++; continue; }
  if (e.type === 'up' && !down.has(key)) { dropped++; continue; }
  const want = rawMs ? e.ms / 1000 : (e.tick + 0.5 + shift) * TICK;
  const wait = Math.max(MIN_GAP, want - at);
  chain.push('sleep', wait.toFixed(3));
  at = Math.max(want, at + MIN_GAP);
  if (e.type === 'down') { down.add(key); chain.push('keydown', '--window', '@W', key); }
  else { down.delete(key); chain.push('keyup', '--window', '@W', key); }
  sent++;
}
for (const key of down) chain.push('keyup', '--window', '@W', key);
lines.push(`xdo ${chain.join(' ')}`, 'wait 3');

writeFileSync(out, lines.join('\n') + '\n');
console.error(`${out}: level ${rec.level}, ${sent} key edges `
  + `(${dropped} auto-repeats and strays dropped), `
  + `${at.toFixed(1)}s of play, settle ${settle}s`
  + `${rawMs ? ', raw millisecond stamps' : ', edges centred in their ticks'}`
  + `${shift ? `, shifted ${shift} ticks` : ''}`);
console.log(`python3 tools/oracle/dosbox_oracle.py --script ${out} \\
    --out /tmp/replay-${name} --record /tmp/replay-${name}/run.mkv --fps 30`);
