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
