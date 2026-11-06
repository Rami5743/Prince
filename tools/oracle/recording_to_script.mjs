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
 * Capture is DOSBox's AVI recorder rather than screenshots, because a
 * screenshot costs the better part of a second of wall-clock time and
 * would pull the key timings apart as it went.
 *
 *   node tools/oracle/recording_to_script.mjs <recording.json> [out.txt]
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

const src = process.argv[2];
if (!src) {
  console.error('usage: recording_to_script.mjs <recording.json> [out.txt]');
  process.exit(2);
}
const rec = parseRecording(readFileSync(src, 'utf8'));
const name = basename(src).replace(/\.json$/, '');
const out = process.argv[3] ?? `tools/oracle/scripts/replay-${name}.txt`;

const lines = [
  `# generated from ${basename(src)} -- the player's own key events, replayed`,
  'wait 25',
  'key Return',
  'wait 20',
];
for (let l = 1; l < rec.level; l++) lines.push('key shift+l', 'wait 70');
// The recording starts where the level does, so the game has to be settled
// before the first event goes in.
lines.push('wait 40', 'video');

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
  const wait = Math.max(0, e.ms - at) / 1000;
  if (wait >= 0.001) lines.push(`wait ${wait.toFixed(3)}`);
  at = e.ms;
  if (e.type === 'down') { down.add(key); lines.push(`keydown ${key}`); }
  else { down.delete(key); lines.push(`keyup ${key}`); }
  sent++;
}
for (const key of down) lines.push(`keyup ${key}`);
lines.push('wait 2', 'video', 'wait 2');

writeFileSync(out, lines.join('\n') + '\n');
console.error(`${out}: level ${rec.level}, ${sent} key edges `
  + `(${dropped} auto-repeats and strays dropped), `
  + `${(at / 1000).toFixed(1)}s of play`);
console.log(`python3 tools/oracle/dosbox_oracle.py --script ${out} \\
    --out /tmp/replay-${name}`);
