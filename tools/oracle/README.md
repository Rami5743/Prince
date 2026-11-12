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

  So each recording is captured at `--shift -1`, `--shift 0` and
  `--shift 1`, and `tools/dev/pick-shift.ts` says which to keep:
  whichever of them the port draws more of exactly. Two was not
  enough. In `0fbffa60` the player lets go of Left at tick 283 and
  both the shift-0 and the shift-1 capture have the Prince run on and
  off the left of the room, because the emulator read the release a
  tick after its own tick 283 either way -- and one tick there costs
  four, since `control_running` can only stop him on frames 7 and 11
  and the next one is four ticks away.

  Deciding it on one tick was tried first and does not work. The two
  captures are the same picture until the first key that matters is
  read (`first_divergence.py` still finds that tick), so asking the
  port only about that tick keeps the rest of the comparison clean of
  the choice -- but it is a tick chosen for being the first thing the
  keys change, which is exactly the sort of tick a port gets wrong,
  and then the wrong capture wins it. For `probeF` that one tick
  chose the capture the port draws 459 ticks of over the one it draws
  1053 of.

  Counting whole runs cannot hide a difference between the port and
  the original: both candidates *are* the original, and a port that is
  wrong somewhere is wrong against both of them. What it could hide is
  the port reading the keyboard a tick late or early, because then the
  capture that is out by a tick in the same direction would win --
  which is what the `PHASE` check below is for.

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

* **Nothing else may run on the machine while a capture runs.** The
  schedule is a wall clock: `dosbox_oracle.py` sleeps to each block's
  absolute time and fires an `xdotool`. A busy machine makes that late,
  and a key edge that is late is a key the game reads in the wrong
  tick. It is not theoretical -- in the third round's capture of
  `0fbffa60` the player lets go of Left at tick 283 and the original
  runs on for four more ticks and off the left of the room, and
  `tools/dev/replay-what-if.ts` shows the port draws those four ticks
  exactly when the key is held for them. Run anything you must run
  under `nice -n 19`, and nothing at all if it can wait.

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

### A recording that does not start on level 1

`recording_to_script.mjs` reaches the recording's level with one
`shift+l` per level and a `wait 70` after each, so the Ctrl+A restart --
and with it the flash `--after-blank` looks for -- is seventy seconds
further in per level. `--start` has to follow: `49 + 70 * (level - 1)`.

Left at 49 for a level-2 capture the search finds the title screen's own
fade instead, numbers the run from there, and the keys land seventy
seconds before the pictures they are compared against; `gate2` scored
143 ticks of 1313 that way, with the capture's Prince standing at the
level door while the port's played the level.

### A press goes out a tick early -- and so does a release

Both edges are scheduled at `(t - 1) / 12`. The game reads the
keyboard once a tick, so an edge has to be in the emulator before the
tick that is to see it, and that holds for a key going up exactly as
it does for one going down.

This was tried the other way round and measured, and the measurement
is kept here so it is not tried again. Sending a release at `t / 12`
instead -- a tick later than the press schedule -- and capturing all
twenty-two recordings again dropped the suite from **12849 ticks of
14521 to 6503 of 14549**. `13ab6867` alone fell from 569 to 46: it
lets go of Right at tick 38, and from tick 40 on the capture's Prince
is still running, falling a tick behind the port and then five and
then nine. `gate2` fell from 616 to 172, `72b3522f` from 384 to 59,
`848ee3c4` from 1420 to 211. One of the new videos split again with
the old numbering scored the same 46, so the numbering is not in it:
the captures themselves are different, and worse.

### The capture's phase is not the schedule's, and `palace4` sits on it

The argument for the later release came from `palace4`, which went
from 466 of 521 to 511 on it. That reading was wrong, and what is
really going on is worth knowing before any other run is read as a
fault.

The script's `origin` has no fixed relation to the DOS game's own
12 Hz timer. An edge scheduled at `(t - 1) / 12` therefore lands at
some unknown point inside a tick, the same point for every edge of
one capture and a different one in the next. That phase is what
`digests/shifts.txt` is really recording, and most of the time it is
comfortably inside a tick and the capture comes out the same twice.

`palace4` lands on the boundary. Three captures of it, the same
recording at the same shift on the same schedule, scored **466, 512
and 428** against an unchanged port, and the 428 one has the familiar
signature: exact to 195, then -1, -2, -3 from the release of Left at
196 on. The 512 one has no difference there at all.

So the port is within one tick of the original at that release -- as
close as this oracle can resolve -- and task 28, "letting go of a
direction during a run", was never a fault in the port. The digest
kept here is the 512 capture. A `palace4` that scores in the 400s
after a change is not evidence that the change broke anything; capture
it twice before reading anything into it.

### A press too short for the emulator

Give a press four ticks at least. A shorter one is a coin toss, and the
coin can land a long way off: `gate1`'s two-tick tap of Right at 591 to
592 reached the game fourteen ticks late, at 605, which is the tick the
player let Shift go.

It took a while to see, because fourteen ticks late is not a difference
you read as lateness. The capture's Prince stands at the lip from 592 to
604 and only then starts the run the port starts at 592, and everything
after it is a run that has already happened. `latekey.mjs` -- move an
edge on by n ticks, replay, score -- is what settled it: n of 0 to 13
scores 591 to 644 of 796 and n of 14 scores 790, so the capture is the
port's own run with the tap delivered at 605.

So a recording whose player taps is not fully adjudicated by its
capture, and a pin under one of those taps measures the replay rather
than the translation.

### `--numbering clock`

Numbering a change by adding up the rounded gaps before it is exact only
while the rounding is. A tick is two and a half frames at thirty against
twelve, so a three-tick gap is seven frames or eight, and `ticks_in`
reads seven as two: the lean towards the shorter reading has to be there
-- without it a one-tick gap the emulator was late for, four frames,
reads as two and invents a tick -- but it costs a tick every time the
screen holds still for three, and every tick after it is out.

`--numbering clock` puts tick n at `base + n * per` instead, with `per`
measured from the capture's own one-tick gaps, and gives a change the
nearest tick not already spoken for. A mis-read gap then costs that one
change and nothing after it. `gate2`, where the Prince stands about a
good deal, came out 1246 ticks long against the recording's 1313 under
the gap-walk.

The measured `per` is worth reading in its own right: it says how fast
the emulator really ran. `gate1` gives 11.94 ticks a second at
`--cycles 20000`, which is the game's 12; `gate2` on the same cycles
gives 11.35, because level 2 has more to draw than level 1 and DOSBox
could not keep up. A capture that is five per cent slow is useless
whatever the numbering does, because the keys were sent on a twelve-a-
second schedule. Raise `--cycles` until the measured rate comes back to
12.

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

"Room by room" means cutting the run at the ticks where the screen
changes wholesale. That used to mean half the screen, and a room
change is not nearly that: the rooms of a level share their walls and
their floors, so going from room 6 to room 5 of level 1 moves
thirty-five per cent of the pixels, where an ordinary tick moves half
a per cent. Nothing lies in between, so the threshold is not delicate
-- it is fifteen per cent now and anything from a tenth to a fifth
gives the same cuts.

It matters because a missed cut makes the mask too small. The flames
are not the only thing the original does not reproduce: the bubbles
over a potion start at `prandom(6) + 1` when the room is first drawn,
out of the same generator, and three captures of `0fbffa60` disagree
about them on every tick the flask of room 5 is on the screen. With
the old threshold that run was one segment of 459 ticks and the flask
was in the last 290 of them, so its bubbles changed on six per cent of
the segment and went unmasked.

### The measurement's own test

    python3 tools/oracle/agree.py <dir-a> <dir-b>

Two captures of the same recording at the same shift, from two
separate runs of DOSBox. The original is deterministic, so outside the
mask they have to be the same pictures tick for tick; where they are
not, the mask is too small and the port is being marked wrong for
something the original does not reproduce either. This is the only
check here that can fail honestly -- every other one compares the port
with a single capture and cannot tell a fault in the one from a fault
in the other.

On `0fbffa60`, captured twice: 658 of 724 ticks agreed with the old
threshold and 716 of 724 with this one.

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

### `13ab6867` 571: the capture jumps three ticks before the key

Worth reading before any other long run is called a fault, because
the measurement took a round and the answer is not in the port.

The recording holds Right from tick 528, adds Shift at 573 and Up at
574, and lets both go at 587. The port reads Up at 574, `run_jump`
starts `seq_4_run_jump`, and `check_on_floor` ends it inside the same
tick: frame 34's weight is three, so `dx_weight()` is `x - 3` = 150,
which is column 6, the gap. He falls from x158, lands in the room
below and is hurt.

The capture does something else, and two independent captures of it
do exactly the same thing: frames **34, 35 and 36 at ticks 571, 572
and 573** -- matched pixel for pixel against the port's own rendering
of those frames, so there is no doubt which they are -- then frame
102 at 574 from five pixels further right, then the ledge of room 2
grabbed and held until the Shift goes up. The run-jump therefore
began at 571, three ticks before the recording's Up.

Nothing in the way of that is different from the C: `control_running`,
`run_jump` and its two-tile scan, `read_user_control`, `check_action`,
`check_on_floor`, `dx_weight` and frame 34's own table entry
(`{33, 0, 0, 0, 0x43}`) were each put beside `seg005.c` and `seg006.c`
and each is the same.

`tools/dev/late-key.ts 13ab6867 572 588 --y --shift` scores:

    -4: 608   -3: 609   -2: 570   -1: 570    0: 570
     1: 570    2: 718    3: 594    4: 592   (of 728)

So the port draws 718 of the 728 with that one press delivered two
ticks later, and 570 as recorded. It is not the whole schedule's
phase: `pick-shift` measured shift 1 at **47** of 728, so moving every
edge of the run by a tick destroys it. It is this press, and it is
worth two or three ticks.

`tools/dev/which-key.ts` then tried **every** edge of the recording
moved a tick and two ticks either way, and exactly one of them is
worth anything: the edge at 573, two ticks later, scores **721 of
728**. Nothing else in the run moves the number at all. So the 156
ticks are that one edge and nothing else, and the pin stays at 572
only to catch a regression.

## Where the last three hundred ticks are

The twenty-one runs a capture can settle stand at **11649 of 12034**.
Each of the eight below has had four captures taken of it (the
spreads are in `tests/oracle/recordings-vs-original.test.ts`), so
the phase is not what is left. What is left is mostly one key edge
apiece: `tools/dev/which-key.ts` moves every edge of a recording a
tick and two ticks either way and reports the ones that are worth
something.

| run        | exact        | apart | one edge moved a tick or two |
|------------|--------------|-------|------------------------------|
| `13ab6867` |  572 of  728 |   156 | 573 two later: **721** |
| `0fbffa60` |  642 of  724 |    83 | 626 one earlier: **714** |
| `760c3e74` | 1513 of 1564 |    52 | 263 two later: 1540 |
| `b4ff4672` |  395 of  428 |    34 | 251 one earlier: **428, exact** |
| `9b60bf3a` |  529 of  557 |    28 | 424 one later: 531 |
| `848ee3c4` | 1421 of 1446 |    26 | none of its 157 edges |
| `palace4`  |  514 of  521 |     7 | 20 one earlier: 516 |
| `5920a8c2` |  413 of  415 |     2 | 240 one earlier: 414 |
| `f6874819` | 1189 of 1190 |     2 | (being measured) |

So three single key edges -- `13ab6867` 573, `0fbffa60` 626 and
`b4ff4672` 251 -- are **254** of the suite's missing ticks, and what
is left of those three runs is seven, ten and nothing. The oracle
cannot place an edge to better than a tick, and where the edge
decides which frame of the run `control_running` stops on, one tick
is thirty of them.

What remains that no edge explains, and is therefore the port's:

    9b60bf3a   26      848ee3c4   25      760c3e74   24
    0fbffa60   10      13ab6867    7      palace4     5
    5920a8c2    1      b4ff4672    0

About a hundred ticks of twelve thousand: **99.2 per cent**.

**That column has since been taken apart and almost none of it is
the port's.** Five of `palace4`'s were a real fault and are fixed --
`blitters_2_or` is an OR and was drawn as a plain transparent blit,
which is the same picture over black and a different one over the
Prince. The rest were read off the captures' own pixels and are the
harness:

| run        | what it is | where it is written |
|------------|------------|---------------------|
| `760c3e74` | 27 | the release at 292, taken two ticks early |
| `760c3e74` | 24 | the capture's hour -- **gone, recaptured** |
| `848ee3c4` | 23 | the capture's hour -- **gone, recaptured** |
| `848ee3c4` | 14 | two pixels of him either side of a wall's edge |
| `0fbffa60` |  4 | the spikes, compared across the Prince's own tick |
| `0fbffa60` |  6 | the stop on frame 7 against frame 11 |
| `9b60bf3a` | 26 | the run started a tick earlier (above) |
| `palace4`  |  5 | the OR blitter -- **fixed** |
| `palace4`  |  2 | the edge at 20, a tick early |
| `5920a8c2` |  1 | the restart's opening frame, drawn once not twice |
| `f6874819` |  1 | the room-change blank |

The suite now stands at **11690 of 12036**, and `848ee3c4`'s fourteen
are the only ticks in it that nothing above accounts for. They are
two small things and both are a pixel or two wide. At 74 to 81 the
Prince is one tick's worth of a step out of place at the bottom of
room 1, which is the usual key read. At 926 to 933 he is standing
behind the wall of column 8 with `obj_clip_right` at `8 << 5` = 256,
which is what `clip_char` computes and what the C computes, and the
capture has nothing of him at 254 and 255 where the port has two
columns of his tunic: the original's edge is two pixels to the left
of the port's and nobody has yet found where those two pixels come
from. It is not the OR blitter -- `848ee3c4` is 1432 with it and
1432 without -- and it is not the wall clip, which is worth two
ticks there and would have to be wider, not narrower, to explain it.

Two of those entries have since been read off the capture's own
pixels and are **not** the port's. Both are the strip of words under
the room, and both were found the same way: render the port's tick,
blank the text rectangle (70,193 to 250,202), hash it in the
capture's palette with the capture's mask, and see which of the two
the capture's number is.

### The hour the capture had already spent, and the cure

`848ee3c4` and `760c3e74` both die and restart level 1, and both
captures used to say `59 MINUTES LEFT` where the port says `60`. The
cause is in `recording_to_script.mjs`: Ctrl+A restarts the level and
not the hour, and the script let level 1 run for `SETTLE_L1` = 25
seconds -- three hundred ticks of the hour -- before pressing it, so
the capture's `rem_tick` began three hundred short of the 719 the
port starts with and crossed the minute around tick 420 where the
port's crosses at 721.

Measured off a capture's own video: the title screen goes at 25.93
seconds and the room is drawn at 26.13, so the level needs two tenths
of a second after Return. `SETTLE_L1` is now **3**, which leaves the
hour 34 ticks short instead of three hundred -- inside the first
minute for the whole of any run in the suite -- and the restart flash
is then at `BOOT + SETTLE_L1 - 1` = 27 seconds, which is what
`recapture.sh` now passes as `--start`.

It cannot go the other way instead: the title screen is only the
title screen from about twenty-one seconds to about thirty, and after
that the game runs its own story and then the demo level, where
Return no longer means "start". Probed with a script of one `wait 60`
and the video read at three-second steps.

The two runs were recaptured at the new wait. `760c3e74` went from
1513 of 1564 to **1538 of 1566** and `848ee3c4` from 1423 of 1446 to
**1432**, and the two blocks of words are gone from both. The phase
lottery is harsher at the shorter wait -- `848ee3c4` scored 1285,
348, 349, 1432, 350, 357, 350 and 1286 over eight captures, and
`760c3e74` 1538, 1537, 316 and 1203 over four -- so take four at
least, as `recapture.sh` does.

### `848ee3c4` 681 to 703: the capture's hour started before the capture did

Twenty-three of the twenty-five, in one block, and every one of them
is the same two words.

The Prince dies at 595, the player presses a button at 654, the level
starts again, `show_level` puts `LEVEL 1` up for twenty-five ticks and
`show_time` follows it with the minutes left for twenty-three. Blank
the port's text rectangle on those twenty-three and the capture is
**not** matched; draw `59 MINUTES LEFT` in it instead of the port's
`60 MINUTES LEFT` and tick 684 is matched exactly, 4153230464 for
4153230464. The port is one minute behind -- or rather the capture is
one minute ahead.

It is ahead because Ctrl+A restarts the level and not the hour, and
`recording_to_script.mjs` lets level 1 run for `SETTLE_L1` seconds
before it presses Ctrl+A. Whatever of that wait is left after the
title screen's cutscene is clock the capture has spent and the port
has not, so the capture's `rem_tick` crosses zero -- and `rem_min`
drops to 59 -- somewhere in the first half of the run, while the
port's crosses at 721. Nothing shows it until a restart asks for the
minutes in words.

The same arithmetic bounds the offset from both sides. `848ee3c4`
says `59` at its tick 680, so the capture's clock crossed at or
before 679 and the wait is worth at least 40 ticks. `probeF` restarts
at 433 and both sides say `60` at 459 -- it scores 1193 of 1193 --
so that capture's clock had not crossed by 459 and the wait is worth
fewer than 260. The `SKIP_WAIT` comment in `recording_to_script.mjs`
already names this as the reason that wait came down from seventy
seconds to ten; `SETTLE_L1` is the same wait for a level-1 recording
and is still 25.

It also makes the measurement behind the dropped `Kid.alive < 0`
guard in `show_time` inconclusive. `probeF` saying `59` at 735 was
read as proof that the original's hour does not stop for a death; a
capture whose clock is forty to two hundred and sixty ticks ahead
says `59` there whether the hour stopped or not. Dropping the guard
is still worth 23 ticks of `probeF` and 23 of `f6874819` and costs
nothing, so it stays -- but it is fitted to the oracle, not measured.

### `760c3e74` 288 to 320: a release the emulator took two ticks early

Twenty-four of its fifty-one, and the whole of what no edge was
thought to explain. Settled against a fresh capture, pixel for pixel.

The Prince runs left along the ledge of room 8 and the player lets
Left go at tick 292. The port reads it on 292, which is frame 9;
`control_running` can only stop a run on frame 7 or frame 11, so he
runs on to 11, the first frame of `seq_13_stop_run` carries him past
the lip, and he falls at 295 and lands at 300.

The capture does the same thing three ticks sooner. Its tick 289 is
**frame 54 at x152** -- found by rendering the port's Prince at every
frame and every x within thirty and comparing the hundred-by-sixty
box around him, and only that one is a pixel-for-pixel match -- so
the original was already two frames into `seq_13_stop_run` there, and
it can only have started it on frame 7.

Give the port the release two ticks earlier and it draws the capture
exactly: every tick from 286 to 326 agrees to the pixel, where the
unshifted port has a twelve-tick hole and comes out four ticks late.

The shift is not kept, because the same recording's later edges are
*not* early: from 340 to 400 the unshifted port matches the capture
on every tick and the shifted one does not, and over the whole run
the shift scores 361 of 1564 against 1513. That is the thing the
harness cannot help -- the schedule's clock and the game's part
company over a long run, so one edge of a twenty-six-second recording
can be two ticks early while the next is on time.

### `0fbffa60` 594 to 597: the spikes are the alignment, not the game

Four more of its eighty-two. The spikes of room 6 go back in on
tick 595 of the capture and tick 595 of the port -- the same absolute
tick, counted from the restart, and the same three pictures as they
retract (176, 188, 106, 26 lit pixels). But the Prince at that moment
is a tick apart, the scoring aligns on him, and the spikes are then
compared across that tick and disagree for the four ticks they are
moving. They agree again the moment the spikes stop moving. There is
nothing in the port to fix: `animate_spike` and `start_anim_spike`
are the C line for line, and the clock they run on is the same one.

### `5920a8c2` 289: the one tick is the end of the same message

The run restarts the level at its tick 241. The port draws the new
level's opening picture on 241 **and** 242 -- the frame
`draw_level_first` drew and the frame the first tick does nothing in
-- and this capture draws it only on 241, so everything to 265 is one
tick apart, the `LEVEL 1` text ends a tick earlier and the minutes
after it end a tick earlier. The scoring's free slip absorbs all of
it except the last tick, 289, where the port still has
`60 MINUTES LEFT` up and the capture has already rubbed it out:
blanking the port's text rectangle there gives 3995135724, which is
the capture's number exactly.

It is the capture and not the port. `probeF`'s restart has the
opening picture **twice**, on 431 and 432, which is what the port
does; this one has it once. Two captures of the same thing, one tick
apart.

### `9b60bf3a` 400 to 429: a run-turn the original does not do

The largest of them, measured against the capture's own pictures.
The Prince is running right, the player lets go on tick 405 and
presses Left on 406. The port's `control_running` sees
`control_x == CONTROL_HELD_BACKWARD` and starts `seq_6_run_turn`,
which carries him from x89 out to x112 over thirteen frames and then
flips him with a `dx` of -14. Every one of those thirteen was checked
against the sequence bytes in the executable and against SDLPoP's
`seqtbl.c`, frame by frame and `dx` by `dx`: `35 36 37 38 39 3a 3b 3c
3d 3e 3f 40 41` with `+1 +1 +8 +0 +7 +3 +1 +0 +2 -1 0 0 -1` and then
`fb f2 fe`. The port draws exactly that and nothing else.

The capture's Prince does not travel: he turns on the spot. The only
way out of `control_running` that does that is the branch above it,
`control_x == CONTROL_RELEASED && (frame == 7 || frame == 11)`, which
stops the run first. The port's frame at the start of 405 is 6 and
the capture's would have to be 7 -- so the whole twenty-six ticks
turn on the run having started one tick earlier in the capture than
in the port.

That is the same one-tick key read as the rest of the table, and the
tools say so from both ends: moving the window from 394 by two ticks
scores 537 of 557 against 529, and no single edge moved by one does
anything. What stops it being settled either way is that this
capture has 557 ticks where the recording has 558 -- it is missing
one, and the alignment is already carrying +3 by tick 400 -- so the
capture cannot say which tick its run began on to better than three.

`0fbffa60`'s two runs both sit on `seq_13_stop_run`, which
`control_running` starts when the player lets go on frame 7 or frame
11, and both were measured frame by frame against the capture's own
pictures.

* **589 to 601.** The Prince's box in the capture at tick t is the
  port's at t+1, exactly, for eleven ticks together: the port is one
  tick behind. The Left press is at tick 590 in the recording and the
  capture acts on it at 589. Moving it a tick earlier is worth five
  ticks of the score (642 to 647), no more, because the alignment
  already absorbs most of a uniform lag.
* **629 to 657.** This one is not a lag. The port leaves room 1 at
  626 still running and decelerates to x174; the capture's Prince
  stops at the room boundary, around x195, and stands there until
  642. Twenty pixels and two tiles apart, so one of the two stopped a
  whole frame of the run sooner. Whichever it is, it is in the three
  lines of `control_running` or in which tick the room changes.

The same sequence is what `9b60bf3a` 400 and `848ee3c4` 681 are
about, so it is worth about a hundred of the three hundred and
eighty-five.

`13ab6867` is not in the table: its 156 are the one press measured
above, not the port.

## The port does not read the keyboard a tick late

The residue keeps reading as "one key edge, one tick out", and the
obvious suspicion is that it is not one edge of one capture but the
*port*, sampling input a tick off the original. If that were so, every
run would want the same shift.

`tools/dev/every-key.ts` moves **every** edge of **every** recording by
the same number of ticks and scores the suite. At the commit that
scored 11690 of 12036:

               -2    -1     0     1     2
    TOTAL   10951 11206 11690 11121 10493   of 12036

Nought wins by 484 ticks over a tick earlier and by 569 over a tick
later, and it wins run by run in seventeen of the twenty-one. The
whole per-run table is in the tool's own comment. So the port reads
the keyboard on the tick the original does, and `which-key`'s edges
are the harness putting one edge of one capture inside the wrong tick.

Two runs do want a shift, and both say something.

* **`palace4` at a tick earlier is 521 of 521 -- exact.** Its two
  remaining ticks are the phase of that capture sitting just the wrong
  side of a tick boundary, which is the knife-edge described above.
  There is nothing of `palace4` left that is the port's.
* `848ee3c4` gains six at a tick earlier and gives them back at two.

### Where `read_user_control` runs, against the C

Settled by reading, because the frame-7-against-frame-11 stop turns on
it. The chain in SDLPoP is

    play_level_2 -> timers, play_frame, draw_game_frame, do_simple_wait
    play_frame   -> do_mobs, process_trobs, check_skel,
                    check_can_guard_see_kid, play_kid_frame, ...
    play_kid_frame -> loadkid_and_opp, load_fram_det_col,
                    check_killed_shadow, play_kid, play_seq, ...
    play_kid     -> fell_out, control_kid
    control_kid  -> rest_ctrl_1, do_paused (which is where
                    read_keyb_control samples the keyboard),
                    read_user_control, user_control, save_ctrl_1

so the keyboard is read at the *start* of the tick, before `play_seq`
advances the animation, and `control_running` therefore sees the frame
that was on the screen at the end of the previous tick.
`src/pop/seg000.ts` and `src/pop/seg006.ts` have that order call for
call, and `clip_char`, `forward_pressed`, `safe_step`,
`control_standing` and `control_running` were each put beside
`seg005.c` and `seg006.c` line for line and are the same. Nothing in
the port is reordered or dropped there.

### `848ee3c4`'s fourteen: both blocks are the harness after all

They were the last ticks in the suite that nothing accounted for.
Neither is the port.

**926 to 933 -- Right and Up pressed on the same tick, and the
emulator took the Up a tick later.** The recording presses Right and
Up together at tick 926 and holds both to 942. The port's
`control_standing` sees `control_forward == CONTROL_HELD` *and*
`control_up == CONTROL_HELD`, which in keyboard mode is
`standing_jump()`, and he jumps into the wall of column 8 and is
bumped -- eight ticks of that, cycling frames 15, 16, 17, 18, 19, 50,
51, 52 while a wall hides all but four columns of him. The capture
does something else, and `tools/dev/pop-frames.ts` and the digest's
own hashes say exactly what: the capture's ticks 926, 927 and 928 are
the port's own pictures from ticks 950, 951 and 952 -- frames 121, 122
and 123 at x173, x174 and x175, the `safe_step` of distance 4 that
`forward_pressed` takes when a wall is within 8. So the original read
Right on 926 and Up on 927, and took the step before the jump could
be asked for.

    tools/dev/late-key.ts 848ee3c4 925 942 0,1,2 --y
        delay 0: 1432    delay 1: 1440    delay 2: 1440   (of 1446)

All eight, for one key of a two-key press a tick late. The shift is
not kept: the recording says both on 926 and the pin stays where the
port scores.

**74 to 81 -- two captures of the original disagree there.** The
recording taps Right for two ticks, at 72 and 73, with Shift held: a
safe step, and a press shorter than the four ticks DOSBox takes
reliably. `tools/oracle/agree.py` on two separate captures of
`848ee3c4` -- the one the digest is taken from and another -- answers
without the port in it at all:

    not agreed: 74 77 78 79 80 81 146 ... 299

which is the port's own six mismatched ticks, exactly. Where two runs
of the original disagree, the capture cannot adjudicate the port.

So the fourteen are six the oracle cannot settle and eight of a
two-key press, and the hundred that were "the port's" are now none.
