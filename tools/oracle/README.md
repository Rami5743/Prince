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

### `exitdoor`: not a late press but two keys that must coincide

`exitdoor` is retired as "a four-tick press DOSBox took three ticks
late, in four captures of four". Moving each control of each edge on
its own says it more exactly, and more usefully.

The recording presses Right at tick 591 and holds it to 594, and
presses Shift at 594. The port therefore starts a run at 592 -- by 594
`control()` is in `control_startrun`, where Shift means nothing -- and
runs off the ledge of the room at 596. The capture's Prince takes a
`safe_step` instead, which `control_standing` only reaches with
`control_shift == CONTROL_HELD`, so the original had Shift down when it
read the Right.

    shift at 594 three ticks earlier:  794 of 801   (from 593)
    x     at 591 three ticks later:    785 of 801

Either reading says the same thing: in the emulator the two edges
arrived in one tick, where the recording has them three apart. 201 of
`exitdoor`'s 208 missing ticks are that one coincidence, and nothing
in the port tells the two timings apart -- `forward_pressed` and
`control_standing` are the C line for line.

### The hour does stop for a death, and the old captures could not say

`show_time` has a `Kid.alive < 0` guard in the C -- the clock only
runs while the Prince is alive -- and the translation dropped it,
because the capture of `probeF` said `59 MINUTES LEFT` at its tick
735 and a clock that stopped for that run's two deaths could not have
got there. `docs/sdlpop-translation.md` called that measurement
inconclusive once `SETTLE_L1` came down; it is worse than
inconclusive, it was backwards.

Write `S` for the ticks of the hour already spent when the capture's
own tick nought begins, and `D` for the ticks the Prince has been
dead. A clock that never stops crosses the minute at tick `719 - S`;
one that stops crosses at `719 - S + D`.

* **Old capture**, `SETTLE_L1` = 25, so `S` is about 298. Never
  stopping puts its crossing at **421** -- and the run restarts the
  level at 433 and both sides say `60 MINUTES LEFT` at 459. A clock
  that crossed at 421 says 59 there. So that capture's clock stopped
  too, and its `59` at 735 is the 298 ticks it had already spent.
* **New capture**, `SETTLE_L1` = 3, so `S` is about 34. Never
  stopping puts its crossing at **685**, and it says `60` at 735 to
  756. So it stops.

Both captures rule out the dropped guard, and the fresh one measures
it: against it the port scores **1176 of 1193 with the guard and 1153
without**, the difference being exactly ticks 734 to 756, the
twenty-three the minutes are in words for. The guard is back in
`src/pop/seg008.ts`.

`probeF` and `f6874819` are the only two runs whose clock crosses a
minute, and both digests were from the old wait. Both are recaptured;
`tools/oracle/recapture.sh probeF 0 4` scored 468, 464, 464 and
**1153** over four tries before the guard went back, which is the
phase lottery and not the clock.

Both were recaptured at the corrected wait, with the guard back in:

    f6874819   466, 1189, 468, 467   of ~1192   -> keeping 1189
    probeF     468,  464, 464, 1153  of ~1193   -> keeping 1153 (1176 with the guard)

`f6874819`'s three remaining ticks are 24, 25 and 48 -- one tick of
drift at the very start. `probeF`'s seventeen are one block, 1129 to
1148, where its capture holds a picture the port does not; that is the
capture and not the port, and `f6874819` says so, because it is the
same run and its own fresh capture has nothing there at all. A second
round of four probeF captures all came out at 467 to 469, which is the
phase lottery and the reason the suite keeps the best of several.

The suite stands at **11673 of 12038**. It was 11690 of 12036 against
the two old digests, and the seventeen are `probeF`'s capture, not a
regression: the two numbers are taken against different captures and
only the later pair is honest about the clock.

### `which-key` moves one control at a time now, and the table moves with it

It used to move all three controls of an edge together, which cannot
express a player pressing two keys in the same thousandth of a second
and the emulator reading them in two different ticks. That is
`848ee3c4` 926 -- Right and Up together, and the eight ticks it cost
were the last in the suite nothing accounted for. Run again with each
control of a multi-control edge tried on its own:

| run        | as recorded  | one control of one edge, moved |
|------------|--------------|--------------------------------|
| `0fbffa60` |  642 of  724 | edge 569 two later: **722**    |
| `13ab6867` |  572 of  728 | Up at 573 two later: **721**   |
| `9b60bf3a` |  529 of  557 | Right at 380 two later: **550** |
| `b4ff4672` |  395 of  428 | Right at 251 one earlier: **428, exact** |
| `palace4`  |  519 of  521 | Right at 20 one earlier: **521, exact** |
| `5920a8c2` |  413 of  415 | Shift at 240 one earlier: **414** |
| `848ee3c4` | 1432 of 1446 | Up at 926 one later: **1440**  |

Where the old table had `palace4` at 516 and `9b60bf3a` at 531, the
per-control version has 521 and 550. What no single edge explains is
now two, seven, seven, nought, nought, one and six -- twenty-three
ticks of twelve thousand, and six of those twenty-three are ticks two
captures of the original disagree about.

### The residue, with the edge put where the emulator took it

`which-key.ts` says which edge a capture wants moved; while it is in
the wrong place the whole run after it is marked wrong, so the ticks
that are genuinely the port's cannot be seen at all. Two tools were
added for the other half of that:

* `tools/dev/residue.ts <name> [edge-tick] [x|y|shift|all] [by]` --
  the shift applied, then the list of ticks still apart with the
  drift the alignment carries there. With no edge it is `pop-first`.
* `tools/dev/which-tick.ts <name> <from> <to> [edge-tick which by]` --
  per tick: the capture's box of what moved, the port's, and -- the
  useful one -- whether the capture's fingerprint is a picture the
  port draws on *some* tick. "The port's tick 456" says the capture
  is the port's own run shifted; "nothing the port ever draws" says
  the two really do draw something different.

Note that the edge tick these take is the one in the recording's
decoded timeline, which is where the control *changes*. `848ee3c4`'s
Up, written "926" in the table above, is the edge at **925**; given
926 the tool moves nothing and reports 1432.

With each run's edge where `which-key` puts it:

| run | with the edge moved | what is left |
|-----|---------------------|--------------|
| `palace4` (Right@20 −1) | 521 of 521 | nothing |
| `b4ff4672` (Right@251 −1) | 428 of 428 | nothing |
| `5920a8c2` (Shift@240 −1) | 414 of 415 | tick 1 |
| `0fbffa60` (edge@569 +2) | 722 of 724 | 266, 690, 694 |
| `848ee3c4` (Up@925 +1) | 1440 of 1446 | 74, 77–81 |
| `13ab6867` (Up@573 −3) | 727 of 728 | 584 |
| `9b60bf3a` (Right@394 +3) | 551 of 557 | 83, 554–558 |
| `f6874819` (as recorded) | 1189 of 1192 | 24, 25, 48 |
| `probeF` (as recorded) | 1176 of 1193 | 433, 708, 1129–1148 |

and of those:

* **`5920a8c2` tick 1** is the same thing as its old tick 289: the
  port draws a level's opening picture twice -- the frame
  `draw_level_first` drew it on and the frame the first tick does
  nothing in -- and this capture has it once. `probeF`'s restart has
  it twice, so it is the capture.
* **`0fbffa60` 266** is a room change: the capture's changed box runs
  to y 198, into the strip of words, where the port's stops at 191.
  That is `ROOM_CHANGE_BLANK`.
* **`0fbffa60` 690 and 694** are something the original does not
  reproduce. The capture changes **twelve pixels** on 690 and
  **three** on 694, and on 691, 692 and 693 it changes three or four
  in the same little box at x 14 to 15, y 42 to 47 -- a fixed spot
  the Prince is nowhere near, which is what an unmasked flame or a
  potion's bubbles look like. `start_anim_potion` seeds the bubbles
  from `prandom(6) + 1`, and `agree.py` on two captures of this very
  recording found that class of difference and nothing else: "the
  bubbles of the potion in room 5, which no two runs of the original
  agree about".
* **`848ee3c4` 74 and 77 to 81** are the six `agree.py` already names:
  two captures of the original disagree there.
* **`f6874819`'s three** and **`probeF`'s nineteen** are written up
  under the hour above.

* **`13ab6867` 584** is the capture holding still. Its 581, 582 and
  583 have nothing changed at all while the port is moving, and 584
  changes **one pixel**; the alignment then slips from −2 to +1 over
  584 to 586 and the two agree again. That is `split_ticks` numbering
  by the clock over a stretch it saw no change in.

#### Three ticks, not two: `13ab6867` after all

`which-key.ts` tried each edge at ±1 and ±2 and said Up at 573 two
ticks *later* was worth 721 of 728. Tried at ±3 as well, the same Up
**three ticks earlier** is worth **727**, and what is left is the one
tick above.

That is the reading this file already had from the capture's own
pixels and never followed up: "frames 34, 35 and 36 at ticks 571, 572
and 573 ... the run-jump therefore began at 571, three ticks before
the recording's Up". The pixels were right and the tool's range was
too narrow. `late-key.ts 13ab6867 572 588 --y --shift` scoring 609 at
−3 is not the same experiment: it moves the whole press window and
both controls, where this moves the one control's one edge.

So **run `which-key.ts --by 1,2,3`**, not the default.

`9b60bf3a` wants three ticks as well, and a different edge with
them: Right at **394** three ticks later is 551 of 557 where Right
at 380 two later was 550, and its 379 goes with the change.

#### `9b60bf3a` 554 to 558: the comparison runs off the end

The digest has **559 tick slots, 557 of them filled**, against a
recording of 558 ticks -- so the port's run is 559 pictures, indices
0 to 558. By tick 554 the alignment is carrying **+3**, so the
capture's 556, 557 and 558 are asked for the port's 559, 560 and
561, which do not exist; `exactAgreement`'s `cost` charges one for a
`k` past the end, so those three can never match whatever the port
draws. Only 554 and 555 are real comparisons, and both are the last
two ticks of a capture that is a tick shorter than the run it is of.

So **three** ticks of 12038 are left that nothing accounts for:
`13ab6867` 584 and `9b60bf3a` 554 and 555 -- and recapturing both
runs three times settles all three as their captures' own numbering.
See **the last three ticks, settled by recapturing** below.

#### `9b60bf3a` 83 is not a loose floor running ahead

It was written down as "a falling loose floor runs a tick ahead of
the capture". It does not. Replaying the recording and printing the
mob each tick gives the falling floor's `y` as

    tick   76  77  78  79  80  81  82  83   84
    port    2   8  17  29  44  62  83 107   landed at 125

and the capture's own box of what moved has its bottom at 45, 62, 83
and 107 on ticks 80 to 83 -- the same numbers, tick for tick. The
fall is in step.

What is out of step is the capture's numbering. The port and the
capture agree at offset 0 for ticks 79 to 82 and at offset 1 from 84
on, so the capture gains a tick between them; `which-tick.ts` prints
the port's box at the *aligned* tick, which is why the port's column
reads 125 against the capture's 107 at 83 and looks like a lead. The
room change is at 78 and this capture has 557 ticks where the
recording has 558, so a tick invented or dropped around a landing two
ticks after a room change is exactly what the splitter does.

So nothing in `animate_loose`, `move_loose`, `loose_fall`,
`mob_down_a_row` or `do_mobs` is wrong -- all five were put beside
the C again in the same round and are the same line for line.

### The last three ticks, settled by recapturing

Three fresh captures of each of the two runs, on an idle machine,
with `agree.py` between every pair. Nothing was replaced: the kept
digests still score better than any of the six.

**`13ab6867`** — fresh captures score **569, 566 and 570** of ~728
as recorded, against the kept digest's 572, so the run is stable and
its 156 missing ticks are reproducibly there. The three captures are
the same pictures as each other outside the mask (729 of 732, 732 of
732 and 729 of 730; the odd ones out are 250, 251 and 284, which is
the mask) -- but **293 to 610 of the ~730 ticks need a slip of up to
six to line two of them up**. The numbering wanders by several ticks
between two captures of one run.

And that is what tick 584 was. With Up at 573 three ticks earlier the
port scores **724, 722 and 725** of the fresh captures, and 584 is
not among what is left:

    kept digest   727 of 728   584
    capture 1     724 of 727   581 582 583
    capture 2     722 of 728   248 249 250  580 581 582
    capture 3     725 of 728   581 582 583

A fault in the port would be on the same tick in all four. It is on
a different tick in every one, which is a capture holding a picture
for a tick it did not really hold it for.

**`9b60bf3a`** — fresh captures score **315, 315 and 313**, against
the kept digest's 529. That is the phase lottery this file already
describes (314, 315, 456, 529 over four captures of an unchanged
port), and the digest stays. What the fresh ones do settle is tick
83: `agree.py` between captures 1 and 3, and between 2 and 3, both
come back

    not agreed: 1 82 83 84

so **two runs of the original disagree there**, and the capture
cannot adjudicate the port on 83 at all. With the shift, the port's
remaining difference against the fresh captures is 83 and nothing
else before tick 317.

So there is no tick in the suite left that is the port's.

### `760c3e74`: no edge closes it, three ticks either way

Searched again with each of the four edges between 270 and 340
(`x@291`, `x@307`, `x@327`, `x@328`) moved one, two and three ticks
either way: the best is `x@327` three later at **1540** of 1566,
against 1538 as recorded. Nothing there is worth anything.

So its twenty-eight stay what this file already measured them to be:
the release at 291 taken two ticks early, which makes the port draw
its ticks 286 to 326 exactly and costs more than it gains over the
rest of a twenty-six-second run (361 of 1564 with the shift). That is
the schedule's clock and the game's parting company over a long run,
and no single edge can express it.

## Levels 3 and 5 to 14, measured for the first time

Every recording in the suite before this round was in levels 1 to 4,
and `palace4` was the only one past level 2. Ten of the game's
fourteen levels had never been put beside a capture at all, and the
eleven probes `level3` and `level5` to `level14` are that ground.

They are the shape of `level2` and `palace4` -- a pause either side of
every move, so that an edge the emulator takes a tick early lands
while the Prince is standing still -- and they were designed against
the port before they were captured. `tools/dev/` has no tool for that
yet; the search is in the round's scratch and the criterion is worth
writing down: a probe is worth capturing when moving **each control of
each edge** a tick either way leaves the run nearly unchanged.
`palace4` scores 0.973 by that measure and `level2` 0.975, and both
are drawn exactly; a random route scores 0.5 and measures the
schedule.

Four things came out of them. Three are the harness and one is the
port.

### The level skip loses a `shift+l` to a cutscene, and to level 7

`recording_to_script.mjs` reaches the recording's level with one
`shift+l` per level. The game plays a scene before levels 2, 4, 6, 8,
9 and 12 -- 4.8 seconds for most of them, 8.2 before level 8 and 9.3
before level 9, measured by running `CutscenePlayer` to the end of
each -- and a `shift+l` sent while one is playing changes nothing.
With a flat ten-second wait the eighth skip was simply lost: a capture
of `level9` came back showing `LEVEL 8` and one of `level10` showing
`LEVEL 9`, and both scored **nought** against a port that was playing
the level asked for.

Level 7 is worse. It drops the Prince down a three-room shaft with
nothing under him -- `set_start_pos` has its own `goto_other_room(3)`
for level 7 -- and he is dead 1.42 seconds later. A few seconds after
that the game puts up `Press Button to Continue`, and from then a
`shift+l` is eaten by the prompt. The wait at level 7 is now four
seconds, which is after the fall and before the prompt.

Nothing else in the game kills a Prince who is left standing: the port
was run for 150 ticks with no keys on every level from 2 to 14 and
only level 7 died.

### The hour runs while the chain is skipping

This is `SETTLE_L1` again, one level up. Ctrl+A restarts the level and
not the hour, and neither does `shift+l`: by the time a chain has
reached level 9 it has spent about 87 seconds of play, so the
capture's `show_time` says `59 MINUTES LEFT` under the room where a
port that starts every level with a fresh hour says `60`. That is 23
ticks of every run from level 9 down, and it was the whole of what
`level9` to `level13` were short.

It cannot be fixed by waiting less. Reaching level 13 at all costs
about a hundred seconds of play -- a flat five-second wait loses five
of the thirteen skips of a chain to level 14 and ends on level 9, and
three seconds with each scene's own length added still loses two --
and the hour's first minute is sixty seconds. The two cannot both be
had.

So the clock the capture arrived with is written in the recording as
`startMinutes`, read off the capture's own tick 26, and
`PopGame.start` is given it through `minutesLeft`. It is the same kind
of thing as `level`: part of the state the run begins in, not part of
what the run measures. It took `level11` from 354 to **377 of 377**
and `level12` from 360 to **383 of 383**.

### One second is not enough margin to find the restart flash

`split_ticks.py --after-blank` is told where to start looking for the
Ctrl+A flash, and that used to be one second before the script sends
it. The chain's own clock runs a little early or late, and when the
flash falls before the search starts the splitter takes the next dark
frame it finds instead. `level3`'s capture was numbered from a frame
**6.1 seconds** past the real restart -- `which-tick.ts` says its tick
0 is the port's tick 51 -- and scored 86 of 355 against a port that
was drawing the run exactly. Split again from four seconds earlier,
the same video scores **366 of 367**.

The generator now prints `search from N` as well as `restart at N`,
and `firstcapture.sh` and `recapture.sh` use it. It is four seconds,
or as much of it as there is between the restart and whatever happened
before: for a level-1 recording the thing before is the title screen
going a tenth of a second earlier, so one second is all there is.

Going earlier still is not safe either -- `level9` at `restart - 6`
scores 24 and `level10` 59, because the search then finds the fade
into the level instead.

### `check_fall_flo` and `check_shadow` were missing from the level start

The one in the port, and the one this round was for.

`draw_level_first` ends with `anim_tile_modif`, `start_chompers`,
`check_fall_flo`, `check_shadow` -- the same four calls, in the same
order, that `check_the_end` makes when a room changes. `PopGame`'s
`startLevel` had the first two and then `enter_guard()`, which is the
tail of `check_shadow` and nothing else.

What a capture can see is level 13. `check_fall_flo` makes the floors
of the room above fall of their own accord while the Prince is in room
23 or 16, and level 13 starts him in room 23: the whole top right of
the first room is them coming down. The capture of `level13` has
something moving in the box (192,1)-(319,118) from its third tick and
`which-tick.ts` says it is `nothing the port ever draws`. With the two
calls back the run goes from **282 to 324 of 371**.

The other half of it no capture here sees, because `check_shadow`
places the shadow of levels 5, 6 and 12 when the drawn room is 24, 1
or 15 and none of those is the room its level starts in -- but a
Prince who begins a level in one, as he does after Ctrl+A in the
browser, used to meet nobody.

### Where the eleven stand

    level3    366 of  367     level9    374 of  421
    level5    387 of  417     level10   259 of  368
    level6    332 of  419     level11   377 of  377
    level7    147 of  147     level12   383 of  383
    level8    421 of  421     level13   324 of  371
                              level14   425 of  425

and `which-key.ts --by 1,2,3` says what is left is one key edge
apiece, the same as the rest of the suite:

    level6    x at 290 two ticks later:   418 of 419
    level9    y at 382 one tick later:    418 of 421
    level10   x at 260 one tick later:    343 of 368
    level5    x at 102 three ticks later: 397 of 417
    level3    x at  20 one tick later:    367 of 367, exact
    level13   no single edge is worth anything

### What the probes could not reach

The mirror of level 4, the shadow of levels 5, 6 and 12, the skeleton
of level 3, the fat guard of level 6 and Jaffar are all **gated behind
real play** and none of them is reachable in a short probe:

* the **mirror** appears in room 4 of level 4 only once the exit door
  has been opened (`seg007`'s `curr_room_tiles[tilepos] = tiles_13_mirror`
  under `leveldoor_open`), and room 4 is six rooms right of the start
  past a skill-4 guard;
* the **shadow** of level 5 needs room 24 (three rooms from the
  start), of level 6 room 1 (five rooms), of level 12 room 15 with the
  sword already taken out of it;
* the **skeleton** of level 3 needs `leveldoor_open` as well -- it
  rises in room 1 when the Prince stands on column 2 or 3 and the exit
  is open -- and level 3 starts in room 9;
* **Jaffar** is in room 1 of level 13 and the Prince starts in 23.

And a guard, once he can see the Prince, is driven by `prandom`, whose
seed the original takes from its own clock: `gate2b` settled years of
this and a fight cannot be adjudicated by a capture at all. A route
long enough to reach any of these would have to go past one.

### Level 13's first twenty ticks are not the port's and never can be

`check_fall_flo` gives each of the six floors above the room a delay
of `-(prandom(0xff) & 0x0f)`, and the original's `prandom` is seeded
from its own clock. So the floors of level 13's first room come down
in a different order in every run of the original, and no capture can
adjudicate the port there.

`tools/dev/probe-check.ts` is what says so, and it is worth running
before any new probe is captured at all. It renders a run twice at two
seeds and lists the ticks that differ by more than a torch's worth of
pixels:

    level 13, 408 ticks, 16 edges
      rooms 13,23  distinct pictures 250  died -1  guard -1
      robustness over 48 moves: mean 0.9637, worst 0.8064 at x@60-1
      seeds 1 and 77777 differ by more than 300 pixels on 20 ticks:
        3:338px(96-231,0-8) 4:709px ... 14:2089px ... 8 more

Every other probe in the suite comes back with **nought** ticks over
that threshold -- including `level14`, whose five torches add up to
more than 300 pixels between them on 89 ticks but never more than 300
in one place. `palace4` reads 0 as well, which is the check saying
what everyone already knew about it.

So `level13`'s pin of 324 of 371 cannot go much higher: about twenty
of the forty-seven it is short are ticks the original disagrees with
itself about, and the rest are the alignment carrying that difference
along. It is kept as a regression guard -- the port's own floors are
deterministic from seed 1 -- and not as a measurement.

### The guard in the room, and `level5b` and `level10b`

The thing that designed the eleven probes asked whether anybody was in
the room with the Prince by testing `Guard.charid === 0`. That is the
*Prince's* own id and never a guard's -- an ordinary guard is
`charid_2_guard` -- so the test never fired and two of the routes walk
into one. `level5` spends about a hundred ticks with a skill-3 guard
standing twenty units from the Prince, and `level10` meets one at its
tick 315.

A guard who can see the Prince is driven by `prandom`, whose seed the
original takes from its own clock. That is what retired `gate2b`, and
it applies here: those runs cannot be adjudicated where the guard is.

`probe-check.ts` tests it properly now (`direction !== dir_56_none`
and the same room, whoever he is), and two guard-free routes were
searched for and captured:

* **`level5b`: 416 of 416, and 416, 415, 414 over three captures.**
  So the nineteen `level5` is short of exact were the guard and
  nothing else, and level 5 is drawn perfectly.
* **`level10b`: 361 of 403**, and it is the one difference in the
  suite that is the port's and is not understood. It is written up
  under **the three ticks of level 10** below.

`level10b` also caught the other half of the flash-search problem.
`restart - 4` is right for `level3` and wrong for `level10b`, which
reads nought from four seconds before and 360 from one: four is back
inside the fade into the level. A split costs forty seconds against a
capture's three minutes, so `firstcapture.sh` and `recapture.sh` now
split each capture at both and keep the better, printing which won.


## Every cheat the original has, and which of them a capture can use

The capture chain already runs the original as **`prince megahit`** --
it has to, because `shift+l` past level 3 is refused without it
(`seg000.c`: `if (current_level < custom->shift_L_allowed_until_level
/* 4 */ || cheats_enabled)`). So the whole of `process_key`'s
`if (cheats_enabled)` block is available to a probe, and it was never
used. This is what is in it, read off `seg000.c` with the
`USE_DEBUG_CHEATS` and SDLPoP-only cases (`ctrl+v`, `ctrl+c`, F6, F9,
`ctrl+tab`, `t`, `f`) left out:

| key | what it does | can a capture use it |
|-----|--------------|----------------------|
| `h` `j` `u` `n` | `next_room = room_L/R/A/B` -- draw another room | **yes, and it is the useful one** |
| `ctrl+b` | `next_room = Kid.room` -- back to the Prince | yes |
| `k` | `guardhp_delta = -guardhp_curr; Guard.alive = 0` | yes |
| `r` | revive: `resurrect_time = 20; Kid.alive = -1` | yes |
| `shift+i` | `toggle_upside()` -- the screen turns over | needs a two-key tap |
| `shift+w` | `feather_fall()` | needs a two-key tap |
| `shift+b` | blind mode | needs a two-key tap |
| `shift+s` | a hit point back, with the small potion's flash | needs a two-key tap |
| `shift+t` | `add_life()` -- another flask on the bar | needs a two-key tap |
| `+` `-` | a minute on the clock either way | yes |
| `c` `shift+c` | the room numbers, as words under the room | yes |

**None of them opens the exit door.** `leveldoor_open` is written in
exactly five places and not one of them is a cheat: `seg007.c:455`
(the button's `trigger_button`), `seg002.c:88` and `:558` (level 6's
shadow and the victory music), `seg003.c:97` (`start_level` clearing
it) and `seg003.c:530` (level 8's mouse). So **the mirror of level 4
and the skeleton of level 3 stay out of reach**: the mirror is
`curr_room_tiles[tilepos] = tiles_13_mirror` under `leveldoor_open`,
and `check_skel` tests `leveldoor_open != 0 ||
!custom->skeleton_require_open_level_door`, whose default is 1
(`data.h:799`). Both need the button pressed, which is real play.

### What H, J, U and N open, which is most of the rest

`check_the_end` is the whole of what a view costs:

    if (next_room != 0 && next_room != drawn_room) {
        drawn_room = next_room; load_room_links();
        different_room = 1; loadkid();
        anim_tile_modif(); start_chompers();
        check_fall_flo(); check_shadow();
    }

-- and `check_shadow` ends in `enter_guard`. So drawing a room is
enough to raise the shadow of level 5 (room 24, while tile 3 of it is
still a potion), the shadow of level 6 (room 1), to set level 13's
floors falling (rooms 23 and 16), and to put *whoever that room's
guard is* on the screen, Jaffar included. None of it needs the Prince
to go there, so none of it needs a route past a guard who can see him
-- which is the wall that `gate2b` ran into and the reason the last
round called these unreachable.

Three probes use it, and the routes avoid what cannot be measured:

* **`shadow5`** -- level 5, 7 -> *up* 10 -> *right* 11 -> *right* 24.
* **`shadow6`** -- level 6, 24 -> *left* 2 -> 15 -> 6 -> 18 -> 1, with
  the guard of room 6 drawn on the way.
* **`jaffar`** -- level 13, 23 -> *up* 17 -> *left* 1. That is the one
  way to his room that does not pass through room 16, whose own
  `check_fall_flo` would start six floors falling at
  `-(prandom(0xff) & 0x0f)` ticks each and make the rest of the run
  unmeasurable.

The level 12 shadow is **not** reachable this way: `check_shadow`
returns early while `get_tile(15, 1, 0) == tiles_22_sword`, and level
12's sword is in room 15 at tile 1, five rooms from the start.

### What the four came back with

    shadow5   300 of 300   exact -- and 299 of 299 on three more captures
    shadow6   279 of 280   279 on all four
    jaffar    253 of 298   252, 253, 253 over the three that reached level 13
    potion8   246 of 246   exact, once its capture's minute was read

**Three of the four are exact and the fourth is the generator.**

`shadow5` is exact on every capture, which says the shadow of level 5
-- `do_init_shad` with `init_shad_5`, frame 15 at x55 facing right --
is drawn as the original draws it, and so are the four rooms on the
way. `shadow6` draws the guard of room 6 as well as the shadow of
room 1, and its one tick is 281 at a drift of -16: the comparison
running off the end of a capture that holds 280 ticks of a 420-tick
run, which is `9b60bf3a`'s last three all over again.

`jaffar` is short by **ticks 3 to 47 and nothing else**, one block,
all at a drift of +1. The probe starts in room 23, `check_fall_flo`
gives each of the six floors above it a delay of
`-(prandom(0xff) & 0x0f)`, and `probe-check.ts` at a sixty-pixel
threshold says **212 of its 300 ticks** differ between two seeds --
the floors come down in a different order every run and leave their
debris behind. Jaffar's own room, from tick 140 on, agrees exactly.
The same arithmetic caps `level13` at 324 of 371.

### `process_key` runs inside the tick, and two cheats proved it

`play_level_2` clears `guardhp_delta` and `hitp_delta` and *then*
calls `play_frame`; the keyboard is pumped four calls deeper, in
`do_paused`, which `control_kid` reaches from `play_kid_frame`. So a
cheat that sets one of those deltas -- `shift+s`, `shift+t`, `k` --
has it carried to `do_delta_hp` and `draw_hp` in the same tick.

`PopGame.cheat` applied them *before* `step`, which is on the wrong
side of the clearing, and the delta was wiped every time. Two probes
found it and the capture said so in pixels:

    addlife2    60 of 191   ->  188   `shift+t` on level 2
    killguard6 179 of 299   ->  299   `h` `h` `h` then `k` on level 6

`addlife2`'s capture has a **fourth flask at (21,194)-(26,198)** from
its tick 62 where the port went on drawing three; `killguard6`'s
guard fell over in both runs, but in the port his hit points stayed
on the screen because `guardhp_delta` never reached `do_delta_hp`.
`killguard6` is now **exact**, so the guard's death -- frames 179 to
185 of `seq_remove_guard` -- is drawn as the original draws it.

This is a fault in the game the player plays, not only in the
harness: in the browser the shell calls `heal()`, `addLife()` and
`killGuard()` on the key event, outside `step`, so Shift+S, Shift+T
and K all did nothing to the bar. `cheat` queues now, and `step`
drains the queue right after clearing the deltas.

### The capture cannot see a flash, and this is the second time

`addlife2`'s last two ticks are 62 and 63, and they are the red
flash `add_life` asks for. Take `flash_color` and `flash_time` out
and the probe reads **190 of 191**, so the capture does not show the
flash at all.

That is the harness. `play_level_2` runs `draw_game_frame`, then
`flash_if_hurt`, then `do_simple_wait(1)`, then
`remove_flash_if_hurt` -- the flash is on the screen only during the
wait and is taken off before the next frame is drawn. And
`split_ticks.py` keeps, for each tick, the frame just *before* the
next change, which is the frame the flash has already come off. So a
flash that really happens is invisible to this oracle by
construction.

The flash stays in the port, where the player can see it. The first
measurement to point this way was `flash_if_hurt`'s second branch --
red whenever `hitp_delta` is negative -- which is left out of the
port for the same reason; that one should probably go back in now
that the cause is understood, but it costs ticks against the
captures and nothing is gained by changing it blind.

### A potion, measured by what it does

`potion8` is the first run in the suite that drinks one. The nearest
potion to a level start is **not** level 1's room 5: level 8 starts
in room 1 at column 8 of row 1, room 2 is to its right, and room 2's
row 1 reads torch, floor, torch, floor, pillar, **potion** -- all of
them floors, because `tile_is_floor` excludes only empty, big-pillar
top, doortop, wall and the four lattices. One room crossing, no
climb, and `level8` is a probe the port already draws exactly.

What kind of potion it is comes from `do_pickup(curr_room_modif
[curr_tilepos] >> 3)` in `seg005.c`: this one's modifier is 40, so
the type is 5 -- the one that hurts. The run is `16.,60r,60.,20s,
30.,20s,40.`: he runs right, bumps the wall at column 6 and settles
on column 5, the first Shift crouches him (`get_item` with
`Char.frame != frame_109_crouch`) and the second drinks
(`seq_78_drink`, frames 191 to 205). The flask goes out of the room
at tick 139 and off the bar at 158, 3/3 to 2/3.

It read **223 of 246** first, and the twenty-three were ticks 26 to
48 in one unbroken block -- the signature this file already has a
section for: `show_level` puts `LEVEL 8` up for twenty-five ticks and
`show_time` follows it with the clock for twenty-three. This chain
arrived at level 8 having spent a minute, so its capture says
`59 MINUTES LEFT` where a port starting the level with a fresh hour
says `60`. With that read off the capture and written into the
recording as `startMinutes` it is **246 of 246, exact**.

Worth noting for the next probe: `level8`'s own recording wants
**60** there and `potion8` wants **59**, so a chain to level 8 sits
right on the crossing. The minute has to be read off each capture's
own tick 26 and never assumed from the level.

That is the thing to measure. `0fbffa60` already proved no two runs
of the original agree about a potion's bubbles -- `start_anim_potion`
seeds them from `prandom(6) + 1` -- so a probe that measured the
bubbles would measure the generator. The flask and the hit point are
the game.

The whole table of potions, by `modifier >> 3`, for whoever wants the
next one: 1 health, 2 life, 3 feather, 4 invert, 5 hurt, 6 open. A
health potion drunk at full hit points does **nothing** (`case 1`
tests `hitp_curr != hitp_max`), which rules out most of level 1's.
The invert potions are level 9's rooms 7 and 10 (modifier 32) and the
feather is level 7's room 1 (modifier 27), which is the level that
kills the Prince before he can reach it.

A cheat goes into a recording as `{ tick, key }` in its `cheats`
array (`RecordedCheat`), `make_probe.mjs --cheat 40:j` writes one,
`PopGame.cheat` applies it where `control_kid` reads the keyboard,
and `recording_to_script.mjs` sends the key to the emulator as a
quarter-second tap at the same `(t - 1) / 12` every control edge goes
out at. A quarter of a second is right because `process_key` is
driven by the keyboard interrupt's scancode and not by what is held:
the tap is one event however long it lasts, and the typematic repeat
is half a second away.

### The wait at level 7 was four seconds and its own comment said two

`recording_to_script.mjs` gives level 7 a wait of its own because the
level drops the Prince down a shaft and kills him, and once
`Press Button to Continue` is up a `shift+l` is eaten by the prompt
instead of changing the level. The comment beside the constant read
"Two seconds is after the fall ... Four was tried and is not safe",
and the constant was **four**. Both went in in the same commit.

Four is on the edge rather than wrong: the prompt was measured on the
screen 5.5 seconds after a chain reached level 7, so a chain running
a little late loses the skip and every level after it is one behind.
That is the whole of the "nought from two that stopped at level 9"
in `level10b`'s spread, and this round it was three captures of three
-- `0 of 374`, `0 of 373`, `0 of 372` -- against a port that scores
361 on the kept digest. It is now **two**.

Two seconds is after the level is drawn (two tenths) and after the
fall (1.42 seconds), and nowhere near the prompt.

One thing to watch when a probe past level 8 is recaptured: two
seconds off the chain is twenty-four ticks of the hour it spends, and
the hour is what `startMinutes` carries. The crossing from `60` to
`59` is somewhere between level 8 and level 9, so a recapture of
`level9` to `level13` may want `startMinutes` of 60 where the
recording says 59. Read it off the capture's own tick 26, as ever.

### Turning the screen over, which nothing had ever measured

`toggle_upside` is one of the cheats and it is also what the type-4
potion does, and the port's flip was in `web/main.ts` -- the finished
picture turned over on its way to the canvas. The comment said that
"looks the same and leaves everything measured against a capture
alone", and the second half was the trouble: `PopGame.render` handed
back the picture the right way up, so a capture of the original with
the screen over could not be compared with the port at all. In the C
it is `draw_game_frame`'s own business:

    if (upside_down) flip_screen(offscreen_surface);
    while (drects_count) { ... copy_screen_rect(&drects[...]); }
    if (upside_down) flip_screen(offscreen_surface);

so it is in `PopGame.render` now, as a mirror of all two hundred rows
-- which is what `flip_not_ega` does to the offscreen surface, and
what the shell was already doing, so nothing the player sees changes.

Which axis it mirrors about is **not** settled by reading, because
the two halves of the C disagree: `flip_not_ega` mirrors the whole
surface about row 99.5, and `copy_screen_rect` mirrors each dirty
rect about `SCREEN_GAMEPLAY_HEIGHT`, which is 192 and not 200. Seven
rows apart, and the difference is whether the row of flasks comes out
at the top of the screen with the room or stays where it is.

`invert2` settles it: level 2, the Prince standing still in room 5
the whole time, `shift+i` at tick 60 and again at 190. The port
scored **131 of 260** on it -- every one of the 130 inverted ticks
wrong and every upright one right. Rendering each tick three ways and
hashing each against the capture's own palette and mask:

    all 200 rows mirrored        0 of 130
    the 192 rows of the room   129 of 130
    not mirrored at all          1 of 130

**The room turns over and the row of flasks does not.** `PopGame`
mirrors rows 0 to 191 within themselves now and leaves 192 to 199
alone, and `invert2` is **260 of 260**.

That is also the first time a two-key cheat has been through the
chain, so the `shift+l`-shaped tap works: Shift down, a sixth of a
second, the letter for eight hundredths, more air, Shift up, with the
recording holding Shift over the same ticks so that both sides see
the same `control_shift`.

### The three ticks of level 10: the splitter counting 11.85 a second

**Settled.** It was not the port and it was not one capture.

`split_ticks.py --hybrid` numbers a capture by walking the gaps
between picture changes and rounding each one *short* --
`ticks_in(gap) = max(1, round(gap / per - 0.3))` -- and the lean is
there for a good reason (a late one-tick gap of four frames would
otherwise read as two and invent a tick). It can only ever
undercount, and an undercount is a capture that reads *ahead* of the
port, which is exactly the +3 this file described.

On a fresh capture of `level10b` the two numberings say:

    gaps    460 changes, 460 ticks spanned, 11.8503 ticks a second
    clock   460 changes, 466 ticks spanned, 12.0052 ticks a second

Twelve point nought is the rate the game keeps and the rate this file
opens with. So the gap-walk lost **six ticks over four hundred**, and
six lost ticks of numbering is a run that reads three ahead by its
middle.

Level 10's room 1 is why it bit there. The probe holds Down from tick
108 to 235 -- a hundred and twenty-five ticks in which nothing moves
but the two torches at row 1, columns 2 and 5 -- so every tick of the
crouch is a gap for the walk to round, and a flame that holds its
frame for three ticks makes a seven-frame gap, which `ticks_in` reads
as two.

The score hardly notices, because the alignment absorbs a slow drift:
**360** for the gap-walk against **361** for the clock. What changes
is what the score is made of. `which-key --by 1,2,3` against the
gap-walk found one edge worth ten ticks (the Down release, 361 to
371); against the clock numbering it finds a different one worth
**twenty-eight** -- Right at tick 68 taken two ticks later, **389 of
403**. With that edge where the emulator took it the +3 is gone
altogether and fourteen ticks are left:

    58, 108-110 (drift +1), and 240 244 260 264 268 272 284 288 292 296

-- the last ten on a four-tick period, which is a frame of the run
cycle and not a timing.

`firstcapture.sh` and `recapture.sh` now split every capture both
ways and keep the better, exactly as they already do for the two
`--start` values. It costs one more split per try and it is the only
way to know which numbering a capture wanted.

### What the clock numbering is worth on the rest of the suite

Not much, and the measurement is worth keeping so nobody spends
another round on it. The four shortest runs of the old twenty-one
were captured again, four times each, split both ways:

    13ab6867   gaps 569 570 569 569   clock 572 574 573 573   (kept 572)
    0fbffa60   gaps 626 621 626  93   clock 629 ... 629   85   (kept 642)
    b4ff4672   gaps ... 374 ...       clock 395 396 373 ...    (kept 395)
    9b60bf3a   gaps 310 186 ...       clock 313 312 ...        (kept 529)

The clock numbering wins every pair it is compared with, by two to
four ticks, and it never loses. But two to four ticks is all it is:
`level10b` lost six because it holds one picture for a hundred and
twenty-five ticks, and no other run in the suite stands still for
anything like that long. `0fbffa60` and `9b60bf3a` came back far
below their kept digests for the ordinary reason -- the phase
lottery this file has described four times -- and their digests
stay.

Two pins move: **`13ab6867` 572 to 574** and **`b4ff4672` 395 to
396**. And the fresh `13ab6867` changes which edge it wants, which
matters more than the two ticks: the old capture's best was Up at
573 three ticks earlier (727 of 728) and the new one does not want
that at all (573 of 728), wanting **y at 416 two ticks later, 726 of
728**, with tick 1 and the edge tick itself all that is left. Two
captures of one run, two different edges, the same conclusion --
which is the clearest statement yet of what `which-key` is really
measuring. It is not finding the port's fault; it is finding where
*this* capture put *this* edge.

`b4ff4672` with its Right at 251 one tick earlier is **429 of 429**,
exact.

### A closing gate is a clock, and it settles the rest of level 10

With the numbering right and `x@68` where the emulator took it,
`level10b` is 389 of 403 and fourteen ticks are left: 58, 108 to 110,
and ten on a four-tick period from 240 to 296. Rendering the port's
own frames beside the capture's, **thirteen of the fourteen are the
same little region** -- x 0 to 31 and x 256 to 271, y 128 to 175,
which is the sliver of the room to the left and the right-hand
column of the room. Level 10's room 5 has a gate at row 2, column 9,
and room 1 has gates at row 2, columns 7 and 9; the Prince plays in
room 1, so room 5's gate shows in the left sliver. All three are
closing from the level start -- `process_trobs` lists them as
`5:29:0 1:29:0 1:27:0`, type 0, closing.

And a closing gate is a **clock**. `animate_door` with `anim_type` 0
does `curr_modifier += door_delta[0]`, which is `-1`, once per tick
and nothing else: no `prandom`, no key, no dependence on the Prince.
Its picture drops a pixel every four of those. So the number of
times the gate moves between two ticks is the number of game ticks
the run really played, written into the picture where both the port
and the capture can be read for it.

Counted over ticks 35 to 300:

    port    95 moves
    capture 95 moves

**The same 95.** What differs is only *when* the capture thinks they
happened:

    51-62    the same ticks in both
    69-79    the capture two ticks early
    93-141   two early, then it skips 107 and 125 and catches up
    192-296  the port every fourth tick from 192, the capture from 193

So the capture's numbering wanders by up to two ticks over the run
while the game underneath played exactly the same ticks. That is the
whole of `level10b`'s fourteen, and it needs no reference to the port
at all -- the gate is in the capture, and the capture disagrees with
itself.

It is worth keeping as an instrument. Any level with a gate closing
has a free tick counter in the corner of the screen, and counting its
moves says what the splitter's numbering cannot: how many ticks the
emulator really ran.

### The old reading, kept because it was wrong in an instructive way

What follows is what this file said before the numbering was measured.
It is left here because every line of it is a correct observation and
the conclusion is still wrong: three independent captures agreeing on
the same ticks does not mean the port is at fault, it can mean the
*splitter* is deterministic.


This is the one run in the suite whose difference is the port's, is
reproducible, and has no account.

**The measurement.** Five captures of `level10b`: 361, 361 and 360
from the three that reached level 10, nought from two that stopped at
level 9, and 323 from a sixth. `agree.py` between two of the good
ones says **431 of 434 ticks agree outside the mask** -- the original
reproduces itself there, so the capture can adjudicate the port.

**What the run does.** The Prince crouches at tick 108 -- the probe
holds Down from 108 to 235, which is `seq_50_crouch`, frames 107, 108
and 109 and then frame 109 held -- and stands up when Down is let go,
frames 110 to 118.

**What the capture says.** Its tick 236 is the port's own picture from
tick **239**, matched by eye against `pop-frames.ts`: the capture's
Prince is half way up where the port's is still in a deep crouch. So
the original stood up three ticks before the port did.
`which-key.ts --by 1,2,3` agrees from the other end -- the Down
release three ticks earlier is worth ten ticks, 361 to 371 -- and
nothing else it tries is worth anything.

**What is left, and why it is odd.** With that release moved, the
ticks still apart are 0, the three of the crouch going down (108, 109,
110), and then **every tick the Prince moves from 253 to 296, all at
a drift of +3**. The port is three ticks behind the original for the
rest of the run -- through a standstill, a run right, a bump into the
wall, a turn and a run left.

Three things that would explain it, and do not:

* a lag does not survive a standstill, and the Prince stands still
  from 246 to 255 with both runs' keys read on the same ticks;
* the scoring's alignment is already carrying the +3, so it is not
  the comparison -- the pictures differ *at* that offset;
* it is not one capture's numbering, because three independent
  captures put it on the same ticks.

What has not been tried: `--rate`. `recording_to_script.mjs` takes
one, and the splitter measures the capture's own rate (`level3` came
out at 11.9703 ticks a second). Three ticks in two hundred and fifty
is 1.2 per cent, which is larger than that, but a schedule written at
a rate the emulator is not keeping is the shape of thing that would
put every key of the second half of a run three ticks out while
leaving the first half alone.

## `level6` and `level9`, the two that were never checked

Every other short run in the measured set had a measurement beside it.
These two were written off in one line -- "one key edge or the guard
apiece" -- and nobody had run the tools at them. Both are now
accounted for and neither is the port's.

### `level9` is exact once **two** edges move, in opposite directions

    y at 382 one tick later    374 -> 418 of 421
    y at 68  one tick earlier  374 -> 377 of 421
    both together              374 -> 421 of 421, exact

Only ticks 0 and 1 are left, and the digest has no hash for them.

The direction is the whole argument. A port that sampled the keyboard
a tick off would want **every** edge of **every** run moved the same
way, and `tools/dev/every-key.ts` has already measured that it does
not: the suite scores 10951, 11206, **11690**, 11121 and 10493 at -2,
-1, 0, +1 and +2. One capture wanting one edge a tick each way over
thirty-five seconds is the schedule's clock and the game's parting
company, which this file describes for `760c3e74` as well.

### `level6` is one hold, and a gate says which end of it moved

`pop-first` puts all eighty-seven after tick 332: the capture's
pictures to the pixel from 0 to 332 and nothing after. Over all 24
edges, `which-key.ts --by 1,2,3` finds four moves worth anything, and
they are two readings of the same hold -- Left from 290 to 333:

    x at 290 two ticks later     418 of 419
    x at 334 two ticks earlier   416 of 419
    x at 334 three earlier       416 of 419
    x at 290 three later         412 of 419

The emulator gave the original **forty-two** ticks of Left where the
recording says forty-four. Either end expresses that, and the score
cannot tell them apart: a shift of everything after an edge is free,
because the edge's own tick is in `freeSlipAt`.

**A gate tells them apart.** Level 6 starts in room 24 at the level
door, and row 1 of that room reads torch, door, door, torch,
**opener**, pillar. The Prince's run crosses the button at column 4;
the gate it opens is room 2's, at row 1 column 9, which shows in the
left sliver of the screen at x 0 to 19 -- the same instrument that
settled `level10b`. `animate_door` moves it a pixel a tick while it
opens and a pixel every four while it closes, and the box of what
moved reads it straight off:

    opening   y1 93, 92, 91 ... 76   ticks 327 to 344
    closing   y1 75, 76, 77 ... 80   ticks 396, 400, 404, 408, 412, 416

The capture and the **unshifted** port put all twenty-five of those
moves on the same absolute tick. Move the press at 290 two ticks later
and the port's gate goes with it -- y1 93 at 329 where the capture has
it at 327 -- because the button is then crossed two ticks later.

So the original crossed the button on the port's own tick: the press
was read at 290 in both, and what the emulator took early is the
**release**. `x at 334 two earlier` is the consistent reading, and its
residue is ticks 343 and 344, where the capture has something changing
at x 20 to 29 that the port does not.

A gate opened by the Prince is not a free clock the way level 10's
level-start gate is -- its phase is the Prince's -- but its *absolute*
numbering still separates "the press moved" from "the stop moved",
which nothing in the score can.

### Both routes are sound

`tools/dev/probe-check.ts` on each, which is the check that should
have been quoted when they were written off:

    level6   mean 0.9742  worst 0.7895 at y@20-1      no guard, no death, seeds agree
    level9   mean 0.9524  worst 0.6374 at shift@270-1 no guard, no death, seeds agree

(`palace4` is 0.973/0.758 and `level2` 0.975/0.833.) So neither is a
route that measures the schedule, and neither needs a replacement
probe the way `level5` and `level10` did.

### What `probe-check` says about `exitdoor`, which *is* a route that measures the schedule

    exitdoor   level 1, 811 ticks, 62 edges, rooms 1,2,3,5,6,9
               guard in the room from tick 116
               mean 0.9381  worst **0.1023** at shift@84-1
               two seeds differ on none of its ticks

A worst case of **one tenth** is the number that retires a run. Moving
one control of one edge by one tick changes nine tenths of the run, so
a capture of it cannot adjudicate the port whatever the numbering
does. `gate1` is the same recording with its presses shortened below
the four ticks DOSBox takes reliably, so it is worse. Neither is worth
recapturing as it stands; what they need is a route built the way
`level2` and `level5b` were.

## The round that recaptured the retired four, and what fell out

`gate1`, `exitdoor`, `gate2` and `gate2b` were retired before
`recapture.sh` tried **both `--start` values and both numberings**,
and before `which-key` moved one control of an edge at a time. All
four were taken again with the current scripts. Eighteen captures.

    gate1     809  574  594  808   of ~810   (kept digest was 596 of 799)
    exitdoor  591  594  590  593  590  594  590  594   of ~810
    gate2b   1179 1161  293  587   of ~1648  (kept 1174)
    gate2      18   41    4        of ~1306  (kept 110)

### `gate1` was never a retired run

Two of its four captures are the port's own run to the pixel. The
"two-tick tap DOSBox took fourteen ticks late" was one capture's
accident, and the eight hundred and ten ticks it was blamed for are
measured now: **809 of 810**, with the one tick left (603) being the
capture holding a picture still while the port moves -- its 601, 602
and 603 have nothing changed at all, and `which-tick` says its 603 is
the port's 600, 601, 602, 603 *and* 606.

**It opens the exit door.** The run steps on room 9's button at tick
738, `leveldoor_open` goes 0 to 1, and `animate_leveldoor` adds one to
`curr_modifier` every tick until 43 -- so ticks 738 to 781 are the
exit door rising, and the capture has all of them. Nothing else in the
suite reaches a button at all.

### `exitdoor` is the one that really is systematic

Eleven captures of eleven, all within four ticks of 592. It is the
same route as `gate1` and differs only in the lengths of its presses,
and the difference is one coincidence: it presses Right at 591 and
Shift at 594 and the emulator reads both in one tick (`shift@594`
three earlier is 794 of 801; `x@591` three later is 785).

`probe-check` says why no capture of it can ever settle it: over its
62 edges the mean is 0.9381 and the **worst is 0.1023**, at
`shift@84-1` -- one control of one edge moved one tick changes nine
tenths of the run. `palace4` is 0.973/0.758. That is the number that
retires a recording, and `gate1`'s score beside it is the proof that
retirement has to be measured and not guessed.

### `gate2b` measures the numbering, not the game

Its four fresh captures read 1179, 1161, 293 and 587 under
`--numbering clock` and **277, 237, 72 and 222** under the gap-walk.
Nine hundred ticks on one capture, where the four shortest of the old
twenty-one gave two to four. A run in which the Prince stands about is
exactly where rounding each gap short loses ticks, and `gate2b` stands
about for a long time. Past the fight it is still a fight.

### `gate2` has nothing to recapture towards

39, 61, 24 under the gap-walk and 18, 41, 4 under the clock, against
the kept 110. Forty one-tick taps and DOSBox drops about half of any
press that short.

### And two of the eleven level probes had bad digests

    level9   374 of 421 -> 418 of 421, and 421 of 421 with one edge
    level6   332 of 419 -> 334 of 417, and 417 of 417 with one edge

`level9`'s old digest was numbered from the wrong frame: the fresh
captures read **nought** at `--start 156` and 416, 418, 418 at 159.
Nobody had recaptured it since `--start` grew its second candidate.
Its three remaining ticks are 68, 69 and 70, which is `y at 68` one
tick earlier -- **421 of 421, exact**.

`level6` is stable (334, 333, 333) and its fresh capture wants `x at
290` **three** ticks later, **417 of 417 -- exact**, where the old
capture's best was the same edge **two** ticks later. Two captures of
one recording, two different shifts of one edge, each exact under its
own: the same thing `13ab6867` says, and the end of any suggestion
that `level6`'s eighty-three were the port's.

### Six more probes recaptured, and what moved

The same treatment for every probe still short of exact. Three tries
each, both `--start` values, both numberings:

    level3    366 -> 367 of 367, exact
    level13   324 -> 327
    level10   259 -> 261
    level5    387, unmoved over 386, 387, 387
    level10b  361, unmoved over 330, 361, 329
    jaffar    253, unmoved over 253, 253, 253

The three that moved were numbering and nothing else. The three that
did not are the three whose shortfall is `prandom`: `level5`'s
skill-3 guard, `level10`'s guard at tick 315, and the six floors
`check_fall_flo` drops on level 13's room 23 at
`-(prandom(0xff) & 0x0f)` ticks each. Those cannot be recaptured
towards, which is why `level5b` and `level10b` exist.

`level3` is worth noting on its own: at `--start 56` the two fresh
captures read 366 and 367 and at 59 they read 86 and 88. That is the
splitter taking a dark frame six seconds past the restart, the fault
`level3` found in the first place, and it is still there in one of
the two candidates every time. Trying both is what makes it harmless.
