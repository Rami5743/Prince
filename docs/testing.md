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

One capture set is taken with the emulator deliberately slowed
(`--cycles 400`). A running jump lasts about nine game ticks, and a capture
costs roughly half a second of real time, so at full speed the whole jump
falls between two captures and is never seen; slowed down, consecutive
captures are a tick or two apart. `tools/oracle/scripts/level3-runjump.txt`
is captured that way, and `tests/game/run-jump.test.ts` requires ten of its
thirteen frames to be reproduced exactly. The other three are black: the
original blanks the screen while it changes room, and the port does not.

`tools/oracle/scripts/level1-step.txt` is captured the same way, at
`--cycles 300`. It holds Right and Shift once the level has settled, and
`tests/game/careful-step.test.ts` requires seventeen of its eighteen frames
exactly. It is what pins two things at once: that a held key gives one
careful step rather than one a frame, and that level 1 opens its gate as the
Prince drops in. The eighteenth frame is three pixels out at (164..166,126)
and is recorded as unexplained.

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

## 4. Movement

`tests/game/sequence.test.ts` and `tests/game/kid.test.ts` check the moving
parts. The level entry is the one piece of movement the captures pin down
exactly -- every level but the first faces the Prince the wrong way and plays
a turn -- so both run that and require the position and facing the captures
show, once through the interpreter alone and once through the whole game
object.

The rest states the properties the original's moves have: a run goes forward
and keeps going, a turn reverses the facing, standing still holds the
standing frame forever, and walking about never leaves the floor heights the
level defines or a room that is not linked.

### Running, frame by frame

`tests/game/run.test.ts` is the strongest of these. `tests/golden/level3-run`
holds eleven frames captured from the original while the Right key was held
on level 3. The port is given the same input, every simulated frame is
rendered, and each capture has to be reproduced by one of them pixel for
pixel -- including the moment the Prince runs out of one room into the next.

The one allowance is torch flames: the original picks each flame's phase at
random on entering a room, so no simulation can agree on it. Differences
inside a flame's box are ignored, and only there.

Nine of the eleven are reproduced exactly, in the order they were captured.
The two that are not are recorded as such, with what is known about them,
rather than excused.

To capture a run of your own:

```bash
python3 tools/oracle/dosbox_oracle.py \
    --script tools/oracle/scripts/level3-run.txt --out /tmp/run
```

```bash
node --experimental-strip-types tools/dev/match-run.ts 3 /tmp/run
```

## 4a. Recordings from the browser

The page can record a session. **record keys** starts the level again and
then writes down every key, tick by tick; **save recording** downloads it
as a JSON file.

The game is deterministic, so the level and the input are enough to replay
a session exactly. The file also carries what the engine did on each tick,
so a replay can be checked against what the player actually saw, and the
raw key events with the tick each landed on, which is how you tell a press
that was acted on late from one that was dropped.

```bash
node --experimental-strip-types tools/dev/replay.ts recording.json
```

That prints the first tick where the replay disagrees with the recording,
and how long each press waited for the next step.

Dropping the file in `tests/recordings/` is all it takes to turn it into a
test: `tests/game/recording.test.ts` replays everything it finds there and
requires the states to match tick for tick. A recording of a session that
went wrong is therefore the shortest path from "it does this when I play
it" to a failing test.

## 5. A whole play session

The comparisons above each pin one move. They pass even when the game is
plainly wrong to play, because a bug that only appears after a few moves --
once a fall, a turn and a landing have each left their state behind -- is
never reached by a capture of one move from a fresh level.

A *session* closes that gap. It is a level played the way a person plays it,
written down once in `tools/oracle/sessions/*.session` and used for both
sides:

```
level 1
cycles 400
settle 40
phase - 4
phase r 10
phase - 4
```

Each `phase` names the keys held -- `l r u d`, `s` for Shift, `-` for none --
and how many frames to capture while they are held. `tools/oracle/session.mjs`
turns that into an emulator script, so the two sides cannot drift apart:

```bash
node tools/oracle/make_session_script.mjs tools/oracle/sessions/level1-open.session
```

That prints the capture command to run. The captures are committed under
`tests/golden/session-<name>/`.

### What a session can and cannot tell you

Two capture runs of the same session do not agree frame for frame. The
emulator is driven by wall-clock key events, so a `keydown` lands on
whichever game tick it happens to land on, and a move that begins a tick
earlier ends somewhere else. `tests/golden/session-level1-grab` and
`tests/golden/session-level1-down` open with exactly the same input, and
their captures agree -- torch flames aside -- only as far as the eighth.
After that the second careful step of one run starts from a different place
than the other's and they part company by a couple of thousand pixels.

So a session's count is a lower bound and a regression guard, not a score.
What it is good for is *categorical* differences: the Prince fell through
the floor where the original stood still, he never climbed where the
original climbed. Those were all four of the bugs the sessions have found,
and none of them is sensitive to a tick either way. A difference of a few
pixels in one capture, on the other hand, usually means the two runs were a
tick apart, and chasing it is a waste of a day.

Two things follow for writing a session. Let each phase settle -- end it
with the Prince standing still -- so the next one starts from the same
place in both. And press the modifier before the direction, which the
generator does: if a bare arrow key reaches the game even for one tick, the
Prince runs where the session asked him to step.

### How the two clocks are lined up

The original runs in real time under the emulator and the port runs tick by
tick, so there is no shared clock. What they do share is *order*: the session
fixes the order of the captures and which keys were held for each. For each
capture in turn, `tests/helpers/session.ts` steps the port forward -- with
that capture's keys held -- until a rendered frame equals it, up to a budget
of ticks. Equality is every pixel of the 320x200 screen, with the usual torch
flame allowance and nothing else.

So the test reports the first capture the port could not reproduce, not just
a pass or a fail. That index says which move the two parted company on, and
`/tmp/session-<name>-failure/` gets three pictures -- ours, theirs, and a map
of where they differ.

`tests/oracle/play-session.test.ts` pins, per session, how many leading
captures the port reproduces. A regression makes that number smaller and a
fix makes it larger; either way the test says so rather than quietly
changing.

## 5. The port, in a real browser

`tests/browser/render.test.ts` serves the repository, opens the page in
headless Chromium, and reads back the exact 320x200 frame the page drew
through a `__princeFrame()` hook. That frame is then compared with the same
DOSBox capture, again requiring zero differing pixels.

So the title screen is verified twice: once as a decode in Node, and once as
something a browser actually painted.
