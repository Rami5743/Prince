# How this port is tested

The goal is an exact copy, so the tests are written to fail on *any*
difference, not to score a similarity. There are three layers.

## 1. Structural invariants over the shipped data

`tests/dat/` walks every resource of all 25 `.DAT` files and asserts the
things that must hold if the readers are right:

* every checksum recomputes,
* the resources tile the file with no gaps and no overlap,
* each sprite group's header declares exactly the number of images that
  follow it,
* every image decodes to exactly `width * height` pixels, with no pixel value
  above its bit depth, and without the decompressor reading past the payload
  it was handed.

Where the shipped data turned out to be irregular, the test records the
irregularity as an exact expectation instead of loosening the check. For
example `usedRooms` reads 25 on most levels and 7 on level 14, so the suite
pins those exact values and the engine is forbidden from relying on the field.
If a future change makes the data read differently, the test says so.

## 2. Comparison against the original game

`tools/oracle/` runs the real `PRINCE.EXE` under DOSBox on a virtual X
display, drives it with scripted key events, and captures the emulated VGA
screen with DOSBox's own frame capture. Those captures are the ground truth.

```bash
python3 tools/oracle/dosbox_oracle.py \
    --script tools/oracle/scripts/title-burst.txt \
    --out /tmp/oracle-title
node tools/oracle/make_golden.mjs /tmp/oracle-title/t03.png \
    tests/golden/title-background.png
```

DOSBox captures at 640x400, a doubled 320x200 screen; `make_golden.mjs`
refuses to write a golden file unless the capture is an exact 2x upscale, so a
reference frame can never quietly contain resampled pixels.

One wrinkle: DOSBox renders through a 16-bit RGB565 surface, so a captured
frame holds the game's output quantised to 5/6/5 bits. The helper
`toCaptureSpace()` applies the same quantisation to our own output. This is a
change of representation, not a tolerance — the comparison still requires
every pixel to be equal.

`tests/oracle/title-screen.test.ts` is the first of these: decoding
`TITLE.DAT` resource 51 with palette 50 must reproduce the captured title
screen with **zero** differing pixels out of 64 000. Passing it means the
container reader, the LZ decompressor, the 4-bit unpacking and the palette
conversion are all simultaneously correct.

The golden frames are committed, so the suite runs anywhere; DOSBox is only
needed to add or refresh a reference.

## Running

```bash
npm test
```

```bash
npm run typecheck
```

## Reference used for the file formats

The compression schemes were cross-checked against the SDLPoP project's
description of the format. The implementation here is written independently in
TypeScript; what was taken is the description of the on-disk layout, which the
test suite then verifies against the original game's own output.

## 3. Rooms, compared tile for tile

`tests/render/rooms.test.ts` draws six rooms -- three dungeon, three palace --
and requires each to equal a capture of the same room, pixel for pixel. Five
of the six match with nothing left over at all. The sixth is three pixels of
a potion's rising bubble, whose shape and position are right and whose colour
is still unexplained; the test pins those three pixels, so the exception
cannot quietly grow.

Some tiles look different from one moment to the next. Torch flames pick a
random frame and mostly advance by one per tick, so two torches side by side
are rarely in step; gates are part way through opening; potion bubbles rise.
The capture caught each of those in some state. Rather than exclude them, the
test is given the state the capture was in -- found once by searching each
tile's own small range of states against the capture, then pinned in the test
with the rest of the case.

The Prince is drawn too, from his own state. That state was recovered the
same way: the room renders exactly without him, so whatever is left over is
him, and `tools/dev/find-prince.ts` searches the frame table and a window of
positions for the one combination that makes the leftover vanish. The answers
turned out to agree with the level data -- every capture is frame 15, the
standing frame, half a tile from where the level says the Prince starts,
facing the way it says, except on level 1 where he has fallen a row because
that level drops him in. Once the game logic runs, it will have to produce
those same numbers.

`tools/dev/render-room.ts` is the tool that does the first search, and writes
our frame, theirs, and a difference map side by side:

```bash
node --experimental-strip-types tools/dev/render-room.ts 4 1 \
    tests/golden/level04-start.png /tmp/out
```

## 4. The port, in a real browser

`tests/browser/render.test.ts` serves the repository, opens the page in
headless Chromium, and reads back the exact 320x200 frame the page drew
through a `__princeFrame()` hook. That frame is then compared with the same
DOSBox capture, again requiring zero differing pixels.

So the title screen is verified twice: once as a decode in Node, and once as
something a browser actually painted.
