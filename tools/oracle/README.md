# Comparing the port with the original, frame for frame

The pieces here replay a recording made in the browser against a real
`PRINCE.EXE` under DOSBox and line the two runs up tick by tick.

## What it is for

A session (`sessions/*.session`) is a scripted bit of play with a
screenshot at each step; it is good for a handful of moments and bad for a
whole level, because every screenshot costs the better part of a second
of wall clock and pulls the key timings about. These tools take the other
road: grab the display as video, send the player's own key events at the
times they were pressed, and recover the game's ticks from the grab.

## The measurements it rests on

* **The original runs at exactly 12 ticks a second under DOSBox**, the
  same as the port. Counted by grabbing an idle level 1 at 30 fps and
  counting the frames where the picture changed: 275 changes over 22.83
  seconds. (`video_ticks.py`)
* **The game area is 640x400 at (192,184)** on the 1024x768 Xvfb, drawn at
  exactly twice the 320x200 of the game, so the way back down is to take
  every other pixel. Averaging blurs every edge and nothing matches.
* **Ctrl+A restarts the level**, with one black frame and then the level's
  own opening. That is the same place a browser recording starts, so it is
  what the replay anchors on.

## Running one

    node tools/oracle/recording_to_script.mjs rec.json /tmp/rec.txt --settle 0.04
    python3 tools/oracle/dosbox_oracle.py --script /tmp/rec.txt --out /tmp/rep \
        --record /tmp/rep/run.mkv --fps 30
    python3 tools/oracle/split_ticks.py /tmp/rep/run.mkv /tmp/dos \
        --crop 640:400:192:184 --scale 320:200 --start 49 --after-blank \
        --fps 30 --rate 12 --hybrid
    node --experimental-strip-types tools/dev/replay-frames.ts rec.json /tmp/port --stride 1
    python3 tools/oracle/compare_ticks.py /tmp/dos /tmp/port --out /tmp/diff

`--start 49` is where to begin looking for the restart flash and depends
on the waits the generated script opens with.

## A second source: SDLPoP

`https://github.com/NagyD/SDLPoP` is the game's logic as C, reconstructed
from the original. It is not the oracle -- where it and a capture of
`PRINCE.EXE` disagree, the capture wins -- but it answers in seconds what
a capture takes a careful experiment to answer, and it says *why*.

It has settled, in one afternoon: which sequence each of the four deaths
uses and that spikes and a chomper take every hit point; that a guard
follows the Prince through a door only from `Guard.x < 91` going left or
`>= 165` going right, and is then shifted by a room's width like the
Prince; that a blow lands on frame 154 and may be parried on 153, with a
reach of 8 to 28 against an unarmed man; that a lunge may be started
from frames 157, 158, 165, 170 or 171; and the whole of
`autocontrol_guard_active`, which decides what a guard does purely on
the distance to the Prince.

Each of those was then checked against a capture, and each held.

## Asking the original a question of my own

A browser recording settles an argument about a run the player actually
had. It is no use for a question of my own -- *what does the original do
if Right is held while a wall cuts a turn short* -- because the player
would have to go and do that, and would land somewhere slightly
different each time.

`make_probe.mjs` writes a recording from a timeline instead, in the same
format, so everything downstream of it works on it unchanged:

    node --experimental-strip-types tools/oracle/make_probe.mjs \
        '14.,11l,36r,30.' /tmp/probe.json
    node tools/oracle/recording_to_script.mjs /tmp/probe.json /tmp/probe.txt --settle 0.04
    python3 tools/oracle/dosbox_oracle.py --script /tmp/probe.txt --out /tmp/rep \
        --record /tmp/rep/run.mkv --fps 30
    python3 tools/oracle/split_ticks.py /tmp/rep/run.mkv /tmp/dos \
        --crop 640:400:192:184 --scale 320:200 --start 49 --after-blank \
        --fps 30 --rate 12 --hybrid
    node --experimental-strip-types tools/dev/replay-frames.ts /tmp/probe.json /tmp/port --stride 1
    python3 tools/oracle/segments.py /tmp/dos /tmp/port

The timeline is the recording's own run-length form: `12.` is twelve
ticks of nothing, `30r` thirty of Right, `6us` six of Up and Shift. Give
a press four ticks at least; a shorter one is a coin toss, for the
reason at the end of this file.

The probe above is the one that settled the jammed keyboard. It runs the
Prince left into the left wall of level 1's room 1 and presses Right
while he is still running, so the run-turn starts and the wall stops it
three frames in. The two runs are identical to tick 32. From 33 the
original turns, is facing right by 38 and running by 40; the port stood
still until the key came up on 61. Lining the whole run up, the port now
matches the original on 61 of its 91 ticks where it matched 26 before.

The second probe it settled was `14.,14r,6ru,46.` -- run right from the
start of level 1 and jump. The two runs are identical to the port's tick
34; then the original drops straight down the gap at the right of room 1
and lands on the bottom row at about screen x 155, while the port sailed
on through the three wall tiles beyond the gap and came down at x 230,
three tiles further along. `where.py` is what showed it: it prints the
bounding box of whatever moved in each tick, which tells `the port draws
him somewhere else` apart from `the port does not draw him at all`.

## What a capture cannot settle

A recording is a list of what was held on each of the port's ticks. The
original is sent those presses on the clock, because that is the only
thing a keyboard understands, and the two only stay in step while the
original's ticks are as long as the port's. At a room change they are
not: the original stops to blank the screen and draw the new room, and
the capture shows it two to four ticks behind for a while afterwards.

So a key that goes up within a few ticks of a decision the game is about
to make is not evidence either way. The first descent of level 1 is one:
the Prince falls through the loose floor of room 1 with Shift held, and
whether he catches the ledge of room 2 on the way down turns on whether
Shift is still down three ticks later. The recorded run has it going up
on tick 81 and the grab falling due on 78; the original did not grab and
the port did.

The probe `11.,50r,1.,34s,20.` is the same descent with Shift held
fifteen ticks longer, which puts the decision well clear of the key.
The original grabs the ledge, hangs, and lets go -- the same as the
port, tick for tick. The difference in the recording is the measurement,
not the game.

`replay-frames.ts --stall n` feeds a replay the presses the original was
reading rather than the ones the port recorded, skipping n of them at
every room change. It is an instrument for asking whether a difference
is this drift, not a fix: fitted across the ten captures the best n is
nothing like constant, which is itself the answer -- the drift depends
on what the emulator was doing, and a capture whose key edges fall near
a decision cannot be made to line up.

## How close a capture can get

The original was captured twice from the same recording, `848ee3c4`,
and the two runs of `PRINCE.EXE` were compared with each other. Over
ticks 100 to 400 they are the same picture on 143 of 301 ticks, with
the rest within a couple of hundred pixels, and the alignment between
them wanders between two and four ticks. Their first difference is at
tick 81, long before a guard is on the screen.

So "identical on every tick" is not a thing the original does against
itself, and a figure like that is the ceiling for the port, not a
failure of it.

Two reasons. The key events go in on the clock, so a press lands a tick
either side of where it did last time; and the fight is driven by the
game's own random numbers, which are not the same twice. Once the
Prince dies at a different tick, everything after it is a different
run, which is why a recording that ends in a sword fight has a tail
that cannot be measured at all.

`align.py` is the measure to use where that matters. It walks the two
runs together and lets the alignment slip by a tick at a time, so a
port that does the same thing a tick out is counted as doing the same
thing, and prints the drift it needed, which is itself worth reading.
`segments.py` -- one offset per stretch between room changes -- is the
stricter test and the better one where the two runs really are in step.

## All fifteen recordings, in the suite

The captures cannot go in the repository -- five hundred pictures and
twenty megabytes each -- but what a comparison reads out of them can.
`digest.py` boils a capture down to what moved on each tick: the box
around whatever changed and how many pixels of it there were. That is
four numbers and a count, it is the same on both sides whatever the
palette is doing, and all fifteen runs come to a hundred and sixty
kilobytes. They are in `digests/`, and `tests/oracle/recordings-vs-
original.test.ts` replays every recording against them on every `npm
test`.

    python3 tools/oracle/digest.py /tmp/dos tools/oracle/digests/NAME.json
    node --experimental-strip-types tools/dev/digest-port.ts \
        tools/oracle/recordings/NAME.json /tmp/port.json

The ceiling for that test is the 1412-of-1470 above, not 1470: these are
pins that must not go down, not targets to reach.

## What each tool does

* `recording_to_script.mjs` -- a recording's raw key events become one
  chained `xdotool` invocation with its own sleeps. A process per key edge
  costs twenty to forty milliseconds that the script's waits know nothing
  about, and a few hundred edges of that is seconds of drift.
* `dosbox_oracle.py` -- runs DOSBox on a display of its own. `--record`
  grabs that display with ffmpeg; DOSBox's own ctrl+alt+F5 capture writes
  nothing in this build, and grabbing the display leaves key timing alone.
* `split_ticks.py` -- cuts the video into one picture per game tick.
  `--hybrid` numbers ticks by the clock but cuts them where the picture
  changes, which is where a tick really ends.
* `compare_ticks.py` -- compares two directories of per-tick pictures. The
  torches are masked out: a flame picks its next frame at random and the
  two sides can never agree on one.
* `digest.py` -- a capture boiled down to what moved on each tick, small
  enough to keep in the repository and compare against on every test run.
* `align.py` -- the two runs walked together with the alignment free to
  move a tick at a time; prints the drift and what is left after it.
* `where.py` -- the bounding box of what moved from one tick to the next,
  which for a room that does not move is the character. Run it over both
  directories side by side to see where each has him.
* `make_probe.mjs` -- a recording written from a timeline, for a question
  the player never happened to ask.
* `state_sequence.py` -- compares the two as sequences of distinct
  pictures with how long each was held, which does not depend on agreeing
  where tick zero is.

## What it cannot tell you

The clock and the picture changes disagree by a tick here and there: the
emulator's frame timing wanders a little, and a screen that is being
redrawn is grabbed half-finished. Treat a one-tick difference as a maybe
and a sustained one as real.

## What a room change costs the emulator

A room change does not cost the port anything: the character steps as it
always does and the screen is blank for one tick while the new room is
drawn. Under DOSBox it costs about four frames. The grabbed video of
level 1's room 3 shows it exactly: the Prince is at frame 54 on tick 116
in both runs, the room changes on 117 in both, and then the original is
black on 117 and 118 and holds the next two frames for two ticks each,
so its frame 57 lands on 121 where the port has it on 119.

That is the redraw overrunning the frame, not the game: screenshots
taken through DOSBox's own capture show the new room already drawn on
the tick after the change, which is what `tests/game/run.test.ts` and
`run-jump.test.ts` match pixel for pixel.

So expect the comparison to slip two ticks at every room change, and
read `drift_map.py`'s per-window offsets rather than the raw tick
numbers after one. A window whose mean is near zero at a shifted offset
is the port doing exactly what the original does.

## What the replay cannot resolve

The script sends the player's key edges at the milliseconds the browser
recorded them, which is as fine as the recording gets, but the two runs
do not agree about where a tick begins. A press of two ticks or less is
therefore a coin toss: the original may see it on one tick, on two, or
on none.

The recorded run `756b259c` has one. The player lets Up go for four
ticks and presses it again for two, while the Prince is running; the
port starts a running jump and the original keeps running, and the two
have nothing to do with each other from there on. The recording
`b4ff4672` has the same two jumps in the same two places with a press
four ticks long, and there the original jumps exactly as the port does.
Nothing in the port tells those two apart, and nothing should: refusing
the short one makes `756b259c` agree for 178 more ticks and `b4ff4672`
disagree for 111.

So treat a divergence that begins on a press of a tick or two as the
replay's own limit, and look for the first difference that begins
somewhere else.
