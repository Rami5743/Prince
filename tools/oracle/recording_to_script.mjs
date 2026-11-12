#!/usr/bin/env node
/**
 * Turn a recording made in the browser into an emulator script, from
 * the per-tick timeline.
 *
 * It used to come from the raw key events, on the grounds that the
 * timeline is only what the page decided the keys were and replaying
 * that could never show up a fault in the page's own reading. True,
 * and the wrong trade: the two do not agree about which tick a press
 * belongs to. The page reads the keyboard once a tick and writes down
 * what was down at that moment, so an event arriving in the middle of
 * tick T is stamped T by the recorder and first shows in the timeline
 * at T+1 -- and T+1 is the tick the port acts on it in. Sending it for
 * T put every such edge a whole tick early in the emulator, which in
 * `0fbffa60` is the difference between the Prince pulling up at the
 * lip of a floor and running over it.
 *
 * `--raw-ms` still replays the events themselves, with their
 * millisecond stamps, which is what showed the difference.
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
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

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

/**
 * How long to give the game to reach the next level after `shift+l`.
 *
 * It was seventy seconds, which is far more than the level change
 * needs and more than the capture can afford: the clock in the status
 * bar is running the whole time, and a minute of it is the difference
 * between the capture's `59 MINUTES LEFT` and the port's `60`, which
 * is eleven pixels of difference on every tick the line is on screen.
 * Ctrl+A restarts the level but not the hour.
 *
 * Ten seconds, and it cannot usefully be shorter.
 *
 * Two things pull against each other here, and they were measured
 * against each other until one of them gave.
 *
 * The shorter the wait, the less of the hour the chain spends -- and
 * the hour runs while the chain skips. A capture that has spent a
 * minute of it says `59 MINUTES LEFT` under the room where the port,
 * which starts every level with a fresh hour, says `60`, and that is
 * eleven pixels of difference on each of the 23 ticks that line is
 * up. It is the whole of what `level9` to `level13` were short.
 *
 * The longer the wait, the more reliably each `shift+l` is taken.
 * Five seconds flat loses five of the thirteen skips of a chain to
 * level 14 -- it ends on level 9 -- because the game plays a scene
 * before levels 2, 4, 6, 8, 9 and 12 and a `shift+l` sent while one
 * is playing changes nothing. Three with a scene's own length added
 * for those levels still loses two.
 *
 * The two cannot both be had: reaching level 13 at all costs about a
 * hundred seconds of play, and the hour's first minute is sixty. So
 * the wait is the generous one that works, and the clock the capture
 * arrived with is handed to the port instead -- see `startMinutes`
 * in `src/game/recording.ts`.
 */
const SKIP_WAIT = arg('skip-wait', 10);
/** When the game is at the title screen, in seconds from the start. */
const BOOT = 25;
/**
 * How long level 1 is left running before the first `shift+l` -- or,
 * for a level-1 recording, before the Ctrl+A that the capture starts
 * on.
 *
 * It was twenty-five seconds, and that is three hundred ticks of the
 * hour the game is played against. Ctrl+A restarts the level and not
 * the hour, so the capture began with `rem_tick` three hundred short
 * of the 719 the port starts a level with, and its clock crossed the
 * minute around tick 420 where the port's crosses at 721. Nothing
 * shows that until a death restarts the level and `show_level` asks
 * `show_time` for the minutes in words: `848ee3c4` says
 * `59 MINUTES LEFT` on its tick 681 and `760c3e74` on its 584, where
 * the port says `60`, and the two blocks are 47 ticks of the suite.
 *
 * The level is up two tenths of a second after Return -- measured off
 * the capture's own video, where the title goes at 25.93 and the room
 * is drawn at 26.13 -- so three seconds is ten times the margin the
 * load needs and leaves the hour only 34 ticks short, which is well
 * inside the first minute for the whole of any run so far.
 *
 * It cannot go the other way instead. The title screen is only the
 * title screen from about twenty-one seconds to about thirty: after
 * that the game runs its own story and then the demo level, and
 * Return no longer means "start".
 */
const SETTLE_L1 = 3;
const lines = [
  `# generated from ${basename(src)} -- the player's own key events, replayed`,
  `wait ${BOOT}`,
  'key Return',
  `wait ${SETTLE_L1}`,
];
/**
 * The level skip, as Shift held down over a tap of L.
 *
 * `xdotool key shift+l` presses and releases the pair as fast as X
 * will take them, and DOSBox's keyboard does not reliably see Shift
 * down at the moment L arrives: a capture of a level-4 probe came
 * back on level 1 with the hour untouched, all three skips lost.
 * Holding Shift either side of L, with a sixth of a second of air
 * around it, is taken every time.
 */
/**
 * The levels the game plays a cutscene before, and how long to wait
 * for one.
 *
 * `tbl_cutscenes` in `src/pop/seg001.ts` has a scene before levels 2,
 * 4, 6, 8, 9 and 12, and the one before level 8 runs for 8.2 seconds
 * and the one before level 9 for 9.3 -- measured by running
 * `CutscenePlayer` to the end of each. A `shift+l` sent while one is
 * playing does not change the level, so with the flat ten-second wait
 * the eighth skip was simply lost: a capture of `level9` came back
 * showing `LEVEL 8` and one of `level10` showing `LEVEL 9`, and both
 * scored nought against a port that was playing the level asked for.
 *
 * Twelve seconds on top covers the longest of them with a margin, and
 * costs nothing but wall clock: the hour is reset at every level, so
 * unlike the wait before a level-1 Ctrl+A (see `SETTLE_L1`) this one
 * is not spent out of the clock the run is played against.
 */
/**
 * How long the scene before each of those levels runs, measured by
 * driving `CutscenePlayer` to the end of each: 4.8 seconds for the
 * ones before 2, 4, 6 and 12, 8.2 before level 8 and 9.3 before
 * level 9. The wait after arriving at one of those levels has to
 * cover its scene and then leave a moment for the level itself.
 */
const CUTSCENE_SECONDS = { 2: 12, 4: 12, 6: 12, 8: 12, 9: 12, 12: 12 };
/**
 * Level 7 drops the Prince down a shaft and kills him, and a dead
 * Prince stops the chain.
 *
 * `start_level` puts him in room 17 with nothing under him -- see
 * `set_start_pos`'s own `goto_other_room(3)` for level 7 -- and he
 * falls through room 1 into room 3 and dies on tick 17, a second and
 * a half after the level is drawn. The game then lies him there and
 * after a few seconds puts up `Press Button to Continue`, and from
 * that moment a `shift+l` is eaten by the prompt instead of changing
 * the level: a capture of `level9` came back on level 8 with the
 * video showing the dead Prince and that prompt at the moment the
 * eighth skip went out.
 *
 * Two seconds is after the fall -- he is dead by 1.42 seconds, plus
 * a couple of tenths for the level to load -- and well before the
 * prompt. Four was tried and is not safe: a chain to level 14 at
 * four seconds had `Press Button to Continue` on the screen 5.5
 * seconds after it arrived at level 7, so the skip was eaten, and
 * the whole chain then ran a level behind and lost a second skip to
 * the scene before level 9. It ended on level 12.
 *
 * Nothing else in the game kills a Prince who is left standing: the
 * port was run for 150 ticks with no keys on every level from 2 to
 * 14 and only level 7 died.
 */
const DEADLY_LEVELS = new Set([7]);
const DEADLY_WAIT = arg('deadly-wait', 4);
let skipSeconds = 0;
let lastWait = SETTLE_L1;
for (let l = 1; l < rec.level; l++) {
  // `shift+l` takes the game from level `l` to level `l + 1`, and it
  // is the level arrived at that may have a scene before it.
  const w = DEADLY_LEVELS.has(l + 1) ? DEADLY_WAIT
    : SKIP_WAIT + (CUTSCENE_SECONDS[l + 1] ?? 0);
  skipSeconds += w;
  lastWait = w;
  lines.push(
    'xdo keydown --window @W shift sleep 0.15'
    + ' keydown --window @W l sleep 0.08 keyup --window @W l'
    + ' sleep 0.15 keyup --window @W shift',
    `wait ${w}`,
  );
}
// Ctrl+A restarts the level, which is where the recording starts too.
lines.push('key ctrl+a', `wait ${settle.toFixed(3)}`);
/**
 * When Ctrl+A goes out, which is where `split_ticks.py --after-blank`
 * has to start looking for the flash.
 */
const restartAt = BOOT + SETTLE_L1 + skipSeconds;
/**
 * Where `split_ticks.py --after-blank` should start looking for that
 * flash, which is not the same second.
 *
 * It used to be `restartAt - 1`, and one second is not enough margin:
 * the chain's own clock runs a little early or late, and when the
 * flash falls before the search starts the splitter takes the next
 * dark frame it finds instead. A capture of `level3` was numbered
 * from a frame 6.1 seconds past the real restart -- its tick 0 is the
 * port's tick 51 -- and scored 86 of 355 against a port that was
 * drawing the run exactly. Split again from four seconds earlier the
 * same video scores **366 of 367**.
 *
 * Four seconds, or as much of it as there is between the restart and
 * whatever happened before it: the level's own fade is in there, and
 * the search must start after that. For a level-1 recording the thing
 * before is the title screen going, a tenth of a second before the
 * room is drawn, so one second is all there is and one second is what
 * it was always given.
 */
const searchFrom = restartAt - (rec.level === 1 ? 1 : Math.min(4, Math.max(1, lastWait - 1)));

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
let sent = 0;
let dropped = 0;
if (rawMs) {
  const down = new Set();
  for (const e of rec.events) {
    const key = KEYS[e.key];
    if (!key) continue;
    if (e.type === 'down' && down.has(key)) { dropped++; continue; }
    if (e.type === 'up' && !down.has(key)) { dropped++; continue; }
    if (e.type === 'down') down.add(key); else down.delete(key);
    edges.push({ want: e.ms / 1000, type: e.type, key });
    sent++;
  }
} else {
  /**
   * The schedule comes from the *timeline*, not from the raw events.
   *
   * It used to come from the events, on the grounds that the timeline
   * is only what the page decided the keys were and replaying it could
   * never show up a fault in the page's own reading. That is true and
   * it was the wrong trade, because the two do not agree about which
   * tick a press belongs to. The page reads the keyboard once a tick
   * and writes down what was down at that moment; an event that
   * arrives in the middle of tick T is therefore stamped T by the
   * recorder and first appears in the timeline at T+1 -- which is the
   * tick the port acts on it in. Sending it for T put every such edge
   * a whole tick early in the emulator.
   *
   * `0fbffa60` is the one that showed it: `34 up Numpad6 ms 2837`, the
   * timeline clear at 35, and the schedule firing at 2.75. Read on 34
   * the Prince is on frame 7 of his stride and `control_running` pulls
   * him up at the lip of the floor in room 1; read on 35 he is on
   * frame 8, cannot pull up, and runs over the edge. The capture
   * scored 35 ticks of 731 against the port.
   *
   * The timeline is also exactly what `decodeTimeline` hands the port,
   * so both sides of the comparison are now given the same thing.
   */
  const ticks = decodeTimeline(rec.timeline);
  const held = { Left: false, Right: false, Up: false, Down: false, shift: false };
  const wanted = (c) => ({
    Left: c.x < 0, Right: c.x > 0, Up: c.y < 0, Down: c.y > 0, shift: c.shift,
  });
  for (let t = 0; t < ticks.length; t++) {
    const now = wanted(ticks[t]);
    for (const key of ['Left', 'Right', 'Up', 'Down', 'shift']) {
      if (now[key] === held[key]) continue;
      held[key] = now[key];
      edges.push({
        want: (t - 1 + shift) * TICK,
        type: now[key] ? 'down' : 'up',
        key: key === 'shift' ? 'shift' : key,
      });
      sent++;
    }
  }
  /**
   * The cheats, as a tap of their key on the tick that reads them.
   *
   * `process_key` is driven by the keyboard interrupt's scancode and
   * not by what is held, so a cheat is one event however long the key
   * is down -- the typematic repeat is half a second away. The tap is
   * a quarter of a second from the same `(t - 1) / 12` every control
   * edge goes out at, which is long enough that the tick cannot miss
   * it and short enough that it cannot repeat.
   *
   * Only the single-key cheats are written this way. One with Shift in
   * it would hold `control_shift` down for the ticks of the tap as
   * well, and the Prince would step or stoop for it.
   */
  const CHEAT_HOLD = 0.25;
  for (const c of rec.cheats ?? []) {
    if (!/^[a-z]$/.test(c.key)) {
      throw new Error(`cheat ${JSON.stringify(c.key)} is not one key`);
    }
    edges.push({ want: (c.tick - 1 + shift) * TICK, type: 'down', key: c.key });
    edges.push({
      want: (c.tick - 1 + shift) * TICK + CHEAT_HOLD, type: 'up', key: c.key,
    });
    sent += 2;
  }
  edges.sort((a, b) => a.want - b.want);
  // Nothing is scheduled before the origin.
  for (const e of edges) if (e.want < 0) e.want = 0;
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
// Let go of anything still down at the end, so nothing is held into the
// next run.
for (const key of new Set(edges.filter((e) => e.type === 'down').map((e) => e.key))) {
  if (edges.filter((e) => e.key === key).at(-1)?.type === 'down') {
    lines.push(`xdo keyup --window @W ${key}`);
  }
}
/**
 * The tail, which has to cover the rest of the run and not the rest of
 * the schedule.
 *
 * It was a flat `wait 3` after the last key edge, which is three
 * seconds of video past the last thing the player did. That is enough
 * for a recording that ends while he is still pressing something and
 * not enough for one that does not: a probe whose last fifty ticks are
 * the Prince standing still loses them, and a probe with no keys at
 * all -- the opening of a level, watched -- was recorded for three
 * seconds and nothing else. The wait now runs to the end of the
 * timeline and three seconds past it.
 */
const runEnd = rawMs
  ? (rec.events.at(-1)?.ms ?? 0) / 1000
  : decodeTimeline(rec.timeline).length * TICK;
lines.push(`wait ${Math.max(3, runEnd - at + 3).toFixed(3)}`);

writeFileSync(out, lines.join('\n') + '\n');
console.error(`${out}: level ${rec.level}, ${sent} key edges `
  + `(${dropped} auto-repeats and strays dropped), `
  + `${at.toFixed(1)}s of play, settle ${settle}s`
  + `${rawMs ? ', raw millisecond stamps' : ', edges a tick ahead of their own'}`
  + `${shift ? `, shifted ${shift} ticks` : ''}`
  + `, ${(EDGE_COST * 1000).toFixed(1)}ms taken off each sleep`);
console.error(`restart at ${restartAt}`);
console.error(`search from ${searchFrom}`);
console.log(`python3 tools/oracle/dosbox_oracle.py --script ${out} \\
    --out /tmp/replay-${name} --record /tmp/replay-${name}/run.mkv --fps 30`);
