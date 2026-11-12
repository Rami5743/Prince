# Prince of Persia, in a browser

A reimplementation of the 1990 DOS game that reads the original's own files —
its data, its artwork, and the tables inside `PRINCE.EXE` — and is checked,
pixel for pixel, against the original running under emulation.

Play it at **https://rami5743.github.io/Prince/**, or run it locally:

```bash
npm install
npm run build
npm run serve     # then open http://localhost:8099/web/
```

Arrow keys to move, shift to step carefully.

```bash
npm test          # 578 tests
npm run typecheck
```

## What it does so far

| | |
|---|---|
| Reads every `.DAT` file as shipped | ✅ no asset pipeline, nothing to drift |
| Decodes all five compression schemes | ✅ verified against the game's own output |
| Draws rooms | ✅ six test rooms match the original pixel for pixel |
| Dungeon **and** palace artwork | ✅ including the generated palace walls |
| Draws the Prince | ✅ from the frame table inside `PRINCE.EXE` |
| Runs the animation byte-code | ✅ the original's, read out of the executable |
| Stand, turn, run, stop, step, fall, land | ✅ checked frame by frame against a capture |
| Moves between rooms | ✅ |
| Jump up, jump forward, running jump | ✅ |
| Grab a ledge, hang, climb up and down | ✅ |
| Crouch | ✅ |
| Status bar: hit points | ✅ matches the original exactly |
| Gates, buttons and their wiring | ✅ |
| Loose floors: shake, give way, fall, crash | ✅ |
| Spikes and chompers | ✅ |
| Guards: placed, coloured, drawn with their swords | ✅ |
| Guard behaviour and sword fighting | ✅ the original's own code, translated |
| The potions, the shadow, the mirror, the skeleton, the mouse | ✅ |
| Sound | ✅ the game's own samples, on the game's own triggers |
| Status bar: the clock | ✅ |
| The cutscenes and the ending | ❌ not yet |

## How it is built

Nothing is transcribed by hand that the original can be asked for instead.

* **The data files** are read as they shipped — `original/prince1/` is the
  unmodified release.
* **The constants** — starting time and hit points, which levels are dungeon
  and which palace, where the mirror and the skeleton are — are read out of
  `PRINCE.EXE` at run time.
* **The animation** is the original's own byte-code, also read out of the
  executable and interpreted directly. How far the Prince moves in a frame is
  not a number in this source; it comes out of that table.

## How it is tested

Three layers, described in [docs/testing.md](docs/testing.md):

1. **Structural invariants** over every resource of all 25 data files.
2. **Comparison against the original.** `tools/oracle/` runs the real
   `PRINCE.EXE` under DOSBox on a virtual display, drives it with scripted
   keys, and captures the emulated VGA screen. Those captures are the ground
   truth, and the comparisons require *zero* differing pixels, not a
   similarity score.
3. **The port in a real browser**, read back through headless Chromium and
   diffed against the same captures.

The game the page runs is `src/pop`, a direct translation of
[SDLPoP](https://github.com/NagyD/SDLPoP) function for function. Against
captures of twenty-one recorded sessions of the real `PRINCE.EXE` it draws
**11673 of 12038 ticks** to the pixel. `tools/oracle/README.md` names what
every one of the rest is; once each capture's key edges are where the
emulator actually took them, three ticks of the twelve thousand are left
that nothing accounts for, and all three sit on a capture's own numbering.

Where the shipped data turned out to be irregular, the tests record the
irregularity exactly rather than loosening the check.

## Layout

```
original/prince1/   the game as it shipped, untouched
src/dat/            readers for the .DAT archive, palettes, images, levels
src/pop/            the game: SDLPoP translated function for function
src/game/           constants and tables from PRINCE.EXE, and the
                    hand-written port this replaced (its tests only)
src/render/         indexed 320x200 surface, room renderer, canvas
web/                the page
tools/oracle/       runs the original under DOSBox and captures frames
tools/dev/          tools for finding out what the original did
tests/golden/       captured frames of the original
docs/               the file inventory and the testing notes
```

## Documentation

* [CLAUDE.md](CLAUDE.md) — where the work stands and what is measured.
* [docs/sdlpop-translation.md](docs/sdlpop-translation.md) — the
  translation, and what each round of comparing it with the C found.
* [tools/oracle/README.md](tools/oracle/README.md) — how the original is
  captured and the port compared with it, tick by tick.
* [docs/status.md](docs/status.md) — the hand-written port that was
  replaced; out of date about the game as played.
* [docs/file-inventory.md](docs/file-inventory.md) — what each of the 33
  original files is for, and the decoded on-disk formats.
* [docs/testing.md](docs/testing.md) — how the port is compared with the
  original.
