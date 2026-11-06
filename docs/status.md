# Where this stands, and what to do next

A note for whoever picks the work up — a new session, or the same person a
week later. It says what is done, what is known to be wrong, what the next
piece of work is, and the few conventions that are easy to break by
accident.

Read [README.md](../README.md) for what the project is,
[docs/testing.md](testing.md) for how it is checked, and
[docs/file-inventory.md](file-inventory.md) for what is in each original
file.

## The short version

The game is playable in a browser from the original's own files. Standing,
turning, running, stepping carefully, every jump, grabbing a ledge, hanging,
climbing, falling, landing and dying are in, and so are the traps and the
guards as figures in the rooms. **Guard behaviour, sword fighting and sound
are not written yet** — those are the next pieces.

Play it at <https://rami5743.github.io/Prince/>.

## Done, and checked against the original

Everything in this list is compared with frames captured from the real
`PRINCE.EXE` under DOSBox, and the comparison requires every pixel to be
equal — see [docs/testing.md](testing.md).

| | checked by |
|---|---|
| Title screen | `tests/oracle/title-screen.test.ts`, `tests/browser/render.test.ts` |
| Six rooms, dungeon and palace | `tests/render/rooms.test.ts` |
| The first seven levels as they open | `tests/golden/level0*-start.png` |
| Hit point markers | `tests/game/status-bar.test.ts` |
| Running, across a room boundary | `tests/game/run.test.ts` |
| The running jump | `tests/game/run-jump.test.ts` |
| Stepping carefully, and level 1's opening | `tests/game/careful-step.test.ts` |
| A guard standing in a room, with his sword | `tests/game/guard.test.ts` |
| The traps: gates, buttons, loose floors, spikes, chompers | `tests/game/traps.test.ts` |
| Hanging, dying, the painful landing | `tests/game/hang.test.ts`, `tests/game/death.test.ts` |

`npm test` runs all of it; `npm run typecheck` is separate. Both should be
clean before anything is pushed.

## Known to be unfinished

* **Guard behaviour and sword fighting.** Guards are placed, coloured and
  drawn, and they hold their swords correctly, but they do not act. In the
  original this is `autocontrol_guard*` and `control_with_sword` in
  `seg005.c`/`seg007.c` of the reference implementation. Nothing in
  `src/game/guard.ts` decides anything yet.
* **Sound.** Not started. The sequence interpreter already reads the sound
  numbers out of the byte-code and hands them to `effects.sound`, which
  nothing listens to. `DIGISND*.DAT` / `MIDISND*.DAT` hold the samples and
  the music; see the file inventory.
* **The clock.** The status bar shows hit points but not the time left.
* **Cut-scenes.** The princess, the mouse and the vizier are decoded but
  never animated.
* **The screen does not blank on a room change.** The original blanks it for
  a few frames; the port does not. This is why a handful of captured frames
  in the jump and run tests are recorded as unreproduced.

## Known oddities, recorded rather than smoothed over

* One capture in `tests/game/careful-step.test.ts` is three pixels out at
  (164..166, 126) and is pinned as unexplained.
* Level 5's potion bubble leaves a three-pixel residual whose colour is in
  no game file.
* Torch flames are the one thing the comparisons ignore: the original picks
  each flame's phase at random when a room is entered.

## Conventions worth not breaking

* **Work on `main` and push.** The owner asked for that explicitly; there is
  no branch dance and no pull request unless asked.
* **Nothing is transcribed by hand that the original can be asked for.**
  Constants, frame tables and animation byte-code are read out of
  `PRINCE.EXE` at run time. If a number is needed, find where the original
  keeps it.
* **A behaviour is not finished until a capture of the original agrees with
  it.** `tools/oracle/dosbox_oracle.py` drives the real game; a capture is
  turned into a golden frame with `tools/oracle/make_golden.mjs`, which
  refuses anything that is not a clean 2x of 320x200. Where that was not
  possible, the test says so and why — see the head of
  `tests/game/hang.test.ts` for the form that takes.
* **Slow the emulator down for short moves.** A jump lasts about nine game
  ticks and a capture costs roughly half a second of real time, so at full
  speed a whole move falls between two captures. `--cycles 300` or `400`
  puts consecutive captures a tick or two apart.
* **After changing anything the page uses**: `npm run build`, then
  `node tools/dev/build-pages.mjs` for the GitHub Pages copy at the
  repository root (`index.html`, `game.js`). Both are committed.
* **Do not write to `.claude/`.** Claude Code guards that directory, and
  every attempt to put a permission file there raises an approval prompt —
  which is the opposite of what such a file is for. Permission rules are the
  owner's to set, from the app.

## Where the pieces are

```
src/dat/            the .DAT archive, palettes, images, level records
src/game/
  exe-constants.ts  numbers read out of PRINCE.EXE
  exe-tables.ts     frame tables and the animation byte-code, with its
                    packed holds expanded -- see the comment there
  sequence.ts       the byte-code interpreter
  control-latch.ts  the original's second layer of input: held, released,
                    ignored. This is what stops a held key repeating
  kid.ts            the Prince: what each key does in each state
  traps.ts          gates, buttons, loose floors, spikes, chompers
  guard.ts          guards: placement, colour, frames. No behaviour yet
  physics.ts        tiles, columns, edges, collision
  game.ts           one level, stepped twelve times a second
src/render/         indexed surface, room renderer, canvas
web/                the page: main.ts, index.html, artifact.html
tools/oracle/       the original under DOSBox, and the capture scripts
tools/dev/          tools for working out what the original did
```

## A good next step

Guard behaviour, in this order:

1. `autocontrol_guard` — how a guard notices the Prince and decides to
   advance, retreat or wait. It reads `can_guard_see_kid`, which is in
   `seg007.c` of the reference.
2. Drawing a sword, and the fight: `control_with_sword`, `swordfight`,
   `sword_strike`, `parry`.
3. Capture a fight from the original on level 2 or 3 and pin it frame by
   frame, the way `tests/game/run-jump.test.ts` does.

Sound can follow; it is independent of all of the above.
