# Prince of Persia, in a browser

A reimplementation of the 1990 DOS game that reads the original's own files —
its data, its artwork, and the tables inside `PRINCE.EXE` — and is checked,
pixel for pixel, against the original running under emulation.

```bash
npm install
npm run build
npm run serve     # then open http://localhost:8099/web/
```

Arrow keys to move, shift to step carefully.

```bash
npm test          # 237 tests
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
| Jump, climb, crouch | ❌ not yet |
| Guards and sword fighting | ❌ not yet |
| Traps: spikes, choppers, loose floors | partly drawn, not yet active |
| Sound | ❌ not yet |
| Status bar, time, hit points | ❌ not yet |

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

Where the shipped data turned out to be irregular, the tests record the
irregularity exactly rather than loosening the check.

## Layout

```
original/prince1/   the game as it shipped, untouched
src/dat/            readers for the .DAT archive, palettes, images, levels
src/game/           constants and tables from PRINCE.EXE, tiles, physics,
                    the animation interpreter, the Prince
src/render/         indexed 320x200 surface, room renderer, canvas
web/                the page
tools/oracle/       runs the original under DOSBox and captures frames
tools/dev/          tools for finding out what the original did
tests/golden/       captured frames of the original
docs/               the file inventory and the testing notes
```

## Documentation

* [docs/file-inventory.md](docs/file-inventory.md) — what each of the 33
  original files is for, and the decoded on-disk formats.
* [docs/testing.md](docs/testing.md) — how the port is compared with the
  original.
