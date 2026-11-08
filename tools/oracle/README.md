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

* **The original runs at twelve ticks a second under DOSBox**, the same
  as the port, and `split_ticks.py` now says so for every capture it
  makes: it counts the screen changes and divides by the video it took,
  and a twelve-hundred-tick run comes out at 12.0119.
* **The game area is 640x400 at (192,184)** on the 1024x768 Xvfb, drawn at
  exactly twice the 320x200 of the game, so the way back down is to take
  every other pixel. Averaging blurs every edge and nothing matches.
  ffmpeg grabs that rectangle and nothing else; encoding the whole
  desktop losslessly costs more processor than the emulator does, and
  what it costs comes out of the emulator.
* **Ctrl+A restarts the level**, with one black frame and then the level's
  own opening. That is the same place a browser recording starts, so it is
  what the replay anchors on -- but only roughly. Which video frame that
  flash lands on moves by a tick between one run and the next, so the
  ticks are numbered from the game's own clock instead: `--anchor-text 25`
  finds the tick the level title goes off the bottom of the screen and
  calls it 25, which is what the port calls it.

  Twenty-five and not twenty-four. The original draws the level as soon
  as it has built it and only then starts the clock, so the opening
  picture is on the screen twice: the frame it was drawn on, and the
  frame the first tick does nothing in. `runOf` used to step before it
  drew and so had only the second of them, which put everything the
  level says about itself a tick ahead of the room it says it about --
  three ticks of every single run scored wrong for a fault in the
  measurement. The capture of `probeF` settles it: the level is
  restarted mid-run at tick 431 and 431 and 432 are the same picture.
* **A key edge goes out in the tick before the one it belongs to.** The
  game reads the keyboard once a tick, at the start of the tick, so a
  press meant for tick T has to be down before T begins. Sent at the
  middle of T itself, every press in `probeE` was read a tick late.
* **Where the schedule's clock sits inside one of the game's ticks
  cannot be chosen, so every recording is captured twice.** The
  schedule starts when Ctrl+A has restarted the level, and the game's
  own tick boundaries fall wherever that landed -- anywhere in a tick,
  differently on every run. The margin either side is half a tick, so
  about half of all captures come out with every key edge of the run a
  tick early, and no value of `--settle` fixes that: the uncertainty is
  a whole tick wide and the window is a whole tick wide.

  It is not a rounding error. In `0fbffa60` the player lets go of Right
  on tick 35. Read on 35, the Prince pulls up at the lip of the floor
  in room 1 of level 1; read on 34 he is one frame further into his
  stride, `control_running` will not take the key on that frame, and he
  runs over the edge. The same capture scores 35 ticks of 731 against
  the port one way and 326 the other.

  So each recording is captured at `--shift 0` and at `--shift 1`, and
  `tools/dev/pick-shift.ts` says which to keep. The two captures are
  the same picture until the first key that matters is read --
  `first_divergence.py` says which tick that is -- and on that one
  tick at most one of them can be the picture the port draws. That is
  the only thing the port is asked, and the rest of the comparison is
  what it is being measured on.

  `tools/dev/oracle-report.ts` checks a finished capture from the
  other end and marks it `PHASE` if it is wrong: it lines the capture
  up against the port over the ticks before the player touched
  anything, where only the level's own clock is running -- the number
  under the room, which the keys cannot move -- and then over the ticks
  after. If the two halves want different offsets, the keys went in at
  the wrong moment. A fault in the port moves both halves together and
  does not show up there, which is the point: this measures the
  harness, not the game.

  Which shift each capture was taken at is written down in
  `tools/oracle/digests/shifts.txt`.

* **Twenty thousand cycles, not three thousand.** At three thousand the
  emulator cannot redraw a room inside a tick: the screen is black for
  two of them and the game loses one. At twenty thousand there is no
  black frame and no lost tick, so what is left to measure is the game.

## Running one

    node tools/oracle/recording_to_script.mjs rec.json /tmp/rec.txt --settle 0.04
    python3 tools/oracle/dosbox_oracle.py --script /tmp/rec.txt --out /tmp/rep \
        --record /tmp/rep/run.mkv --fps 30 --cycles 20000
    python3 tools/oracle/split_ticks.py /tmp/rep/run.mkv /tmp/dos \
        --crop 640:400:0:0 --scale 320:200 --start 49 --after-blank \
        --fps 30 --rate 12 --hybrid --anchor-text 25
    python3 tools/oracle/digest.py /tmp/dos tools/oracle/digests/NAME.json
    node --experimental-strip-types tools/dev/oracle-report.ts NAME

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

Two things in the harness are a tick wide, and neither of them is the
game.

**Which tick a key press lands in.** The game reads the keyboard once a
tick and nowhere else, so the only thing that matters about a press is
which tick it falls in. The emulator is sent it on the clock, and where
the clock sits inside a tick depends on how long DOSBox took to restart
the level. `recording_to_script.mjs` sends each edge at the middle of
its tick, which is the best that can be done without asking the game,
and that is still half a tick either way; over a long run the two
clocks part company further, and by the thousandth tick of `probeF` a
press lands two ticks from where it should.

**A room change.** The original holds the screen black for one tick
longer than the port. That is the redraw and not the game -- see
`ROOM_CHANGE_BLANK` -- and it shifts every tick after it by one.

So the comparison lets the alignment slip, and pays two disagreements
for each tick of slip; it slips for nothing at a room change and at a
tick where the player's keys changed.

## The original is deterministic

It was written here that it is not: two captures of the same recording
agreed on 1397 of 1473 ticks, and ninety-five per cent was called the
ceiling. That was the measurement, not the game.

Captured twice at three thousand cycles and twice at twenty thousand,
the same recording gives the same pictures tick for tick. The only
pixels that differ between two of the original's own runs are the
torches, which pick their next flame from the game's random numbers and
cannot be reproduced by anything; outside them the four runs are
identical. What differs between runs is which video frame tick zero
lands on, which `split_ticks.py --anchor-text` now settles by numbering
the ticks from the game's own clock -- the tick the level title goes
off the bottom of the screen.

The oracle runs at twenty thousand cycles. At three thousand the
emulator cannot redraw a room inside a tick, so it loses one at every
room change, and the port and the capture drift apart for a reason that
has nothing to do with the game.

## All the recordings, in the suite

The captures cannot go in the repository -- a thousand pictures and
twenty-five megabytes each -- but a fingerprint of each tick can.
`digest.py` writes, per tick, the capture's screen as indices into the
capture's own palette with the flames masked out, and a CRC of that.
The port computes the same number from its own rendering, so equal
means the same picture to the pixel.

Indices rather than colours because DOSBox's output, grabbed off an X
display and encoded, is a unit or three away from the port's idea of
the same colour -- 81,84,81 where the port has 84,84,84 -- and no
tolerance can be folded into a hash. A capture uses two or three dozen
colours and they are far apart, so which one a pixel is is never in
doubt.

The flame mask is found by how often a pixel changes rather than by
what colour it is, counted room by room: a torch in a room the run
visits for fifty of its twelve hundred ticks changes on nearly all
fifty and on four per cent of the run, which no threshold over the
whole thing can tell from a pixel the Prince crossed twice.

    python3 tools/oracle/digest.py /tmp/dos tools/oracle/digests/NAME.json

Nineteen runs are pinned in `tests/oracle/recordings-vs-original.test.ts`:
the sixteen recordings the player has sent, and three probes.

`f6874819` is the one he sent with a list of six bugs, and it is the
clearest example of a run that stops being the same run. The port and
the capture are the same picture on every tick to 77. Then, at the
right-hand end of room 2, the capture's Prince stops nine units short
of the port's and stays in the room while the port's crosses into room
3 -- and from there they are not in the same room, so none of the
remaining thousand ticks measures anything.

Where a recording cannot answer, a probe can, and `probeE` answers
that one: the same keys on the same ticks, sent again, and the
original crosses into room 3 on the same tick as the port and its
guard then walks left at the port's pace, frame for frame. So the
recording's own capture is the odd one out there, and the port is
right. `probeC` is the same opening followed by the climb at the left
of room 2, and `probeF` is the whole of `f6874819` sent again.

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
