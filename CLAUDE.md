# Read this first

## ============================================================
## NEVER STOP WHILE A BUG YOU KNOW ABOUT IS STILL THERE
## ============================================================
##
## If you know what the next step is, **take it**. Do not write it
## down and hand it back. Do not end a turn with "the next pass
## should...", "what is left is...", "not fixed, narrowed" or a list
## of what you ruled out. Naming the work is not doing the work, and
## the player has had to come back and tell you so again and again.
##
## If you know something is broken and it is not fixed yet, you are
## not finished. Keep going: measure, fix, build, `npm test`,
## `git add -A`, commit, push -- then pick up the next one and do it
## again. Go round that loop until every problem you are aware of is
## solved.
##
## The only thing that ends this is the player telling you, in so
## many words, to stop or to do something else. A measurement you
## took and wrote up has fixed nothing.
##
## ## Running out of room is a problem to solve, not an excuse
##
## "I ran out of context" is not an ending. It is a thing you fix,
## and here is how. The moment you notice the window getting short,
## **write the state down in the repository** and carry straight on:
##
## 1. Put what you have learnt where the next session will find it --
##    the task's own description, `CLAUDE.md`, or a note next to the
##    code. Numbers, not impressions: what was measured, what the
##    score was before and after, which hypotheses are dead and what
##    each one cost.
## 2. Commit and push it. A note that is not pushed does not exist.
## 3. Then keep working. You still have the room you have; use it on
##    the bug and not on prose about the bug.
##
## Written down properly, running out costs the next session nothing
## but the reading. Stopping instead costs the player another round.
##
## ============================================================


## THE JOB IN HAND: close the last of the difference

`src/pop` is a direct translation of https://github.com/NagyD/SDLPoP
and it is now the game the player plays: `web/main.ts` starts
`PopGame`, and `game.js` carries it. The plan and what was kept is
`docs/sdlpop-translation.md`.

Where it stands, measured by `tools/dev/pop-report.ts` against the
captures of a real PRINCE.EXE:

    measured         19258 of 20011   96%
    retired           1883 of  3767   50%
    all              21141 of 23778   89%

and, for the first time, the parts of the game that are not
gameplay, by `tools/dev/scene-report.ts`:

    title              426 of   606   the opening, every page load
    expired            108 of   177   the hourglass
    cutscene2           34 of   137   cutscene8     74 of 188
    cutscene4           36 of   135   cutscene9      8 of 207
    cutscene6           37 of   137   cutscene12    33 of 136

**The pictures are not what is short.** Frames of each put beside the
port's come out diff 0 outside the mask -- `cutscene9` at capture
frames 198, 240 and 278 is the port's 82, 121 and 139 to the pixel.
What moves is *when*, and both things that move it are the
emulator's: **the cutscene frame is 3.2 video frames there and 3
here** (`cutscene_frame_time` is six sixtieths and the gaps read
+3 +3 +3 +3 +1 +3 +3 +3 +3 +3 +4 ...), which over seventy-two frames
is `cutscene9`'s whole drift, and the same six per cent lets a fourth
`proc_fade_frame` into a cutscene frame four times in five, so the
original's fade is 63 shades in 53 video frames against the port's
63. Neither is anything a driver that keeps time can reproduce.

## The scenes were never compared with anything, and four things were wrong

Every one of the forty-four digests before this round was *gameplay*.
`show_title` -- which the player sees on **every page load** --
`end_sequence`, `expired` and the six scenes between the levels were
written out of the C with unit tests only, and a unit test pins what
the author believed the C does. They are also the **easiest** thing
in the suite to measure: no keys are pressed in a cutscene, so there
is no key-edge lottery, no `which-key` search, no shift to choose and
no phase lottery.

`tools/oracle/scene_frames.py` cuts a capture into one picture per
video frame (writing only the frames that changed),
`digest.py --cutscene` fingerprints them with the stars and the
princess-room torches masked, `tools/oracle/scenes/<name>.json` says
what the scene is and what script reaches it,
`tools/oracle/scenecapture.sh` takes it, `tools/dev/scene-common.ts`
replays the port at 1/30 of a second against a model of the PC
speaker, and `tools/dev/scene-report.ts` scores it.

* **`transition_ltr` is instant.** SDLPoP marks the function `// stub`
  and puts `SDL_Delay(1000/120)` between its hundred and sixty
  two-pixel columns, which is a wipe lasting a second and a third;
  the port translated the stub. In the capture the wipe occupies
  **two** video frames -- 807 changes x 17 to 302 and 808 changes
  only x 212 to 302.
* **Every fade ran at twice the right speed.** `make_pal_buffer_fadein`
  and `make_pal_buffer_fadeout` are both given `wait_time` 2 and
  `fade_in_frame` spends it round one shade of the sixty-four, so a
  fade is 128 sixtieths. The driver stepped a shade per sixtieth.
* **A fade has a clock of its own.** `proc_cutscene_frame`'s inner
  busy loop calls `proc_fade_frame` over and over until the cutscene
  frame's `timer_0` runs out, so a six-sixtieth cutscene frame holds
  three shades one after another. The port put all three up at once
  and held the screen still for the other two thirds; the capture
  fades the princess room in over **fifty-three consecutive video
  frames, one change each**.
* **The port drew eight rows the original leaves black.** Every frame
  of the scene before level 2 differed from the capture in rows 192
  to 199 and nowhere else -- the capture's are black, the port
  carried the floor of the princess's room into them -- where rows 97
  to 179 of the same pair differ by five pixels in all. A scene
  played before a level gets the game's own offscreen, which is the
  192-row gameplay buffer; `show_title` makes its own over the whole
  320 by 200. `scr.clip_room` is that, and with it the port's picture
  is the capture's **to the pixel**.

And the measurement that makes a scene comparable at all: **the
original is playing the PC speaker tunes, and the length of the music
is the timing of the scene.** `show_title` stops dead at
`while (check_sound_playing())` three times over. The capture's first
such wait ends 24.77 seconds after the intro music starts, and sound
54 is 5937 units at tempo 240 -- 24.74 seconds as `IBM_SND1.DAT`
plays it against 46.59 as `MIDISND1.DAT` does.

Two things a scene capture cannot settle, both measured and written
up in `tools/oracle/README.md`: the **odd frames of a fade** (the
grab beats against the DAC write at exactly 33.3ms and catches half
of them mid-write) and the **princess's room**, whose six stars and
two torches both come out of `prandom`.

## `level13b`, and two cheats that were never there

* **`level13b` is level 13 with room 23 out of the picture: 324 of
  351.** `check_fall_flo` drops six floors on that room at
  `-(prandom(0xff) & 0x0f)` ticks each, so it can never be
  adjudicated, and that is the whole of what `level13` (327 of 374)
  and `jaffar` (253 of 298) are short. This probe leaves it on its
  **third** tick -- `u` at 3, `h` at 4 -- and tours nine rooms of
  level 13 no capture had ever drawn. `probe-check.ts` over two seeds
  says the whole 380 ticks differ on one.

  Its digest is the only one in the suite taken **without
  `--anchor-text`**, and that is a finding: the anchor renumbers by
  the first tick the strip under the room goes dark, and this
  capture's strip never does, so the detector took the tick the whole
  message ends and renumbered the run by -23. Both runs put the end
  of the message on tick 48 with no anchor at all, which neither side
  can fake. The twenty-four it is still short are the words under the
  room, and `textTicksToSkip` was measured both ways rather than
  guessed: **19258 of 20011 with the skip against 19149 without**,
  under either numbering, so the skip stays.

* **`c` and `shift+c` were not in `PopGame.cheat` at all**, and
  `tools/oracle/README.md` has had them in its catalogue of cheats
  since the cheats went in. `seg000.c:741` and `:746`.

* **The shell still applied its cheats before the tick.** The round
  that found this fixed `PopGame.cheat`, which is the path a
  recording replays through, and left `web/main.ts` calling
  `game.heal()`, `game.addLife()` and `game.killGuard()` straight off
  the key event -- on the wrong side of `play_level_2`'s clearing of
  `guardhp_delta` and `hitp_delta`. **K, Shift+S and Shift+T did
  nothing to the bar in the game the player plays**, which the last
  round said it had fixed and had not. All eleven go through
  `cheat()` now.

* **A bad capture is the commonest cause of a short run, and nobody
  was recapturing.** Nine recordings were taken again this round with
  the current `recapture.sh` -- which tries both `--start` values and
  both numberings, and did neither when most of these digests were
  made. Four of the nine moved and `level3` became exact:

      gate1     596 of 799 -> 809 of 810   (and out of the retired list)
      level9    374 of 421 -> 418 of 421   (421 of 421 with one edge)
      level3    366 of 367 -> 367, exact
      level13   324 of 371 -> 327 of 374
      level10   259 of 368 -> 261 of 369
      level6    332 of 419 -> 334 of 417   (417 of 417 with one edge)
      level5, level10b, jaffar, exitdoor, gate2, gate2b -- unmoved

  The three probes that would not move are the three whose shortfall
  is `prandom`: `level5`'s skill-3 guard, `level10`'s guard at tick
  315, and the six floors `check_fall_flo` drops on level 13's room
  23 at `-(prandom(0xff) & 0x0f)` apiece. Those are the ones a
  replacement probe is for, and `level5b` and `level10b` are it.

  So: **before reading a short run as the port's, recapture it** --
  and `level3` says why both `--start` values must be tried every
  time. Its fresh captures read 366 and 367 at `--start 56` and 86
  and 88 at 59, where the search finds a dark frame six seconds past
  the restart.

* **`gate1` was never a retired run, and it opens the exit door.**
  It was retired on one capture that scored 596 of 799, blamed on "a
  two-tick tap DOSBox took fourteen ticks late". Four captures with
  the current `recapture.sh` -- which tries both `--start` values and
  both numberings, and did neither when `gate1` was retired -- score
  **809, 574, 594 and 808** of ~810. Eight hundred and ten ticks of
  level 1, six rooms of it, are back in the measured set at 809.

  And it reaches a **button**: at tick 738 the run steps on room 9's
  opener, `leveldoor_open` goes 0 to 1, and `animate_leveldoor` adds
  one to `curr_modifier` every tick to 43 -- so ticks 738 to 781 are
  the exit door rising and the capture has all of them. Nothing else
  in the suite reaches a button at all, so `trigger_button` on a
  level door and `animate_leveldoor` had never been put beside the
  original. They are exact.

  Its one remaining tick, 603, is the capture holding still: 601, 602
  and 603 have nothing changed while the port moves.

* **`level6` and `level9` are exact.** They were the two runs in the
  measured set written off in a line and never checked.

      level9   374 -> 418 of 421, and 421 of 421 with `y at 68` one earlier
      level6   332 -> 334 of 417, and 417 of 417 with `x at 290` three later

  `level9`'s old digest was numbered from the wrong frame: the fresh
  captures read **nought** at `--start 156` and 416, 418, 418 at 159.
  `level6`'s fresh capture wants its one edge **three** ticks later
  where the old capture wanted **two**, and each is exact under its
  own -- two captures of one recording, two different shifts of one
  edge, which is the clearest thing a capture can say about whose
  fault an edge is.

  A **gate** settled `level6` before the recapture did. Room 24 has an
  opener at row 1 column 4 that the run crosses, and the gate it opens
  -- room 2's, row 1 column 9 -- shows in the left sliver at x 0 to
  19. Its eighteen opening moves (a pixel a tick, 327 to 344) and
  seven closing moves (a pixel every four, 396 to 416) fall on the
  same absolute ticks in the capture as in the **unshifted** port,
  where moving the press at 290 carries them two ticks later. So the
  button was crossed on the port's own tick.

* **`exitdoor` is the one that really is systematic: eleven captures
  of eleven**, all within four ticks of 592. It is `gate1`'s route
  with longer presses, and its Right at 591 and Shift at 594 reach the
  emulator in one tick. `probe-check` says why no capture can settle
  it: mean 0.9381 and **worst 0.1023** at `shift@84-1`, where
  `palace4` is 0.973/0.758. One control of one edge moved one tick
  changes nine tenths of the run. **That number is what retires a
  recording** -- and `gate1`'s 809 beside it is why retirement has to
  be measured and not guessed.

* **`gate2b` measures the numbering.** Four fresh captures read 1179,
  1161, 293 and 587 under `--numbering clock` and **277, 237, 72 and
  222** under the gap-walk: nine hundred ticks on one capture, where
  the four shortest of the old twenty-one gave two to four. Past the
  fight it is still a fight, so it stays retired. `gate2` has nothing
  to recapture towards: 18, 41, 4 against the kept 110.

* **Nothing in the suite is now known to be the port's.** Every run
  that is short has a measurement beside it in
  `tools/oracle/README.md` and in
  `tests/oracle/recordings-vs-original.test.ts` saying what it is
  instead -- a key edge the emulator took a tick or two off the
  recording's time, a capture's own numbering, the comparison running
  off the end of a short capture, or `prandom`, whose seed the
  original takes from its clock.
* **`level10b`'s three ticks, the one difference that had no account,
  were the splitter counting 11.85 ticks a second.** `split_ticks.py
  --hybrid` numbers a capture by walking the gaps between picture
  changes and rounding each one short, and on `level10b` that made
  460 changes into 460 ticks at **11.8503 a second** where
  `--numbering clock` makes the same changes span **466** at
  **12.0052**, which is the rate the game keeps. Six ticks lost over
  four hundred is a run that reads three ahead by its middle. The
  probe holds Down for 125 ticks while nothing moves but two torches,
  which is why it bit there and nowhere else.

  `firstcapture.sh` and `recapture.sh` now split every capture both
  ways and keep the better, as they already do for the two `--start`
  values. Across the four shortest runs of the old twenty-one it is
  worth two to four ticks apiece and never loses: `13ab6867` 572 to
  **574**, `b4ff4672` 395 to **396** (and 429 of 429, exact, with its
  one edge moved).

  And the fourteen that were left of `level10b` after that are
  settled by **a clock nobody had noticed: a closing gate**.
  `animate_door` with `anim_type` 0 does `curr_modifier +=
  door_delta[0]`, which is -1, once per tick and nothing else -- no
  `prandom`, no key -- and the picture drops a pixel every four of
  those. Level 10's room 5 has one closing from the level start, in
  the sliver to the left of the screen, and thirteen of the fourteen
  ticks are in that sliver. Counted over ticks 35 to 300 the port
  moves it **95** times and the capture moves it **95** times; what
  differs is only *when* the capture thinks they happened -- two
  ticks early over 69 to 141, one tick late over 192 to 296. The
  game played the same ticks and the capture's numbering wandered.

  **Any level with a gate closing has a free tick counter in the
  corner of the screen**, and counting its moves says what the
  splitter cannot: how many ticks the emulator really ran.
* **The cheats were there all along.** The capture chain has always
  run the original as `prince megahit` -- `shift+l` past level 3 is
  refused without it -- so every cheat of `process_key` was available
  to a probe and none had been used. A recording carries them now
  (`RecordedCheat`, `make_probe.mjs --cheat 40:j`, `PopGame.cheat`),
  and `recording_to_script.mjs` sends them to the emulator.

  `h`, `j`, `u` and `n` set `next_room`, and `check_the_end` then
  does `loadkid`, `anim_tile_modif`, `start_chompers`,
  `check_fall_flo` and `check_shadow`, whose own tail is
  `enter_guard`. So drawing a room raises the shadow of level 5 and
  of level 6 and puts whoever a room's guard is on the screen --
  Jaffar included -- with the Prince nowhere near, which is what
  makes them measurable: a guard who can see him is `prandom` and
  `gate2b` settled that years ago.

      shadow5     300 of 300   exact on all four captures
      killguard6  299 of 299   exact
      invert2     260 of 260   exact
      potion8     246 of 246   exact
      shadow6     279 of 280   the one is the capture ending early
      addlife2    188 of 191   the two are a flash the oracle cannot see
      jaffar      253 of 298   ticks 3-47, which are level 13's floors

  **No cheat opens the exit door.** `leveldoor_open` is written in
  five places and not one is a cheat, so the mirror of level 4 and
  the skeleton of level 3 stay out of reach: both need the button
  pressed, which is real play past a guard.
* **A potion is measured, by its effect.** Level 8's potion is one
  room from the start on the same row and its modifier is 40, so
  `curr_room_modif >> 3` is 5 and it is the one that hurts. The flask
  goes out of the room at tick 139 and off the bar at 158, 3/3 to
  2/3. Not the bubbles -- `start_anim_potion` seeds them from
  `prandom(6) + 1` and no two runs of the original agree.
* **A cheat ran before the tick instead of inside it.**
  `process_key` is not called before `play_frame`, it is called four
  calls *inside* it, in `do_paused`; and `play_level_2` clears
  `guardhp_delta` and `hitp_delta` immediately before `play_frame`.
  So a cheat that sets one of those deltas -- `shift+s`, `shift+t`,
  `k` -- has it carried to `do_delta_hp` and `draw_hp` in the same
  tick, and the port, applying cheats before `step`, wiped it every
  time. **Shift+S, Shift+T and K did nothing to the bar in the game
  the player plays.** `addlife2` 60 of 191 to 188, `killguard6` 179
  of 299 to **299, exact**. `cheat` queues now and `step` drains the
  queue where the C reads the key.
* **The oracle cannot see a flash, and that is its fault and not the
  port's.** `addlife2`'s last two ticks are the red flash `add_life`
  asks for; take it out and the probe reads 190 of 191.
  `play_level_2` puts the flash up *after* `draw_game_frame`, waits,
  and takes it off before the next frame is drawn, and
  `split_ticks.py` keeps for each tick the frame just before the next
  change -- the frame the flash has already come off. So the flash
  stays in the port, where the player can see it. The same thing is
  why `flash_if_hurt`'s second branch is left out: `3764b76d` loses
  three hit points and not one of its 17670 black pixels changes
  colour on any tick of the run.
* **Four real faults were fixed this round, all found by reading
  the C beside the port:**
  * `showRoom` wrote `check_the_end` out by hand and had dropped
    `loadkid`, `check_fall_flo` and `check_shadow`, so looking into
    another room met nobody. Same fault as `startLevel`'s, in the
    other place a room is drawn whole.
  * the upside-down flip was in `web/main.ts`, so `PopGame.render`
    handed back the picture the right way up and no capture could
    measure it. Moved into `render`, it scored 131 of 260 -- and
    `invert2` says the original mirrors **the 192 rows of the room
    within themselves** (129 of 130) and not all 200 (0 of 130). The
    room turns over and the row of flasks does not. 260 of 260 now.
  * `cheat` applied before `step`, above.
  * `recording_to_script.mjs`'s level-7 wait was four seconds while
    its own comment said two. Level 7 kills the Prince and
    `Press Button to Continue` eats a `shift+l`; four is on the edge
    and a late chain loses the skip and is a level behind ever after.
    Three captures of `level10b` in a row came back nought for it.
* the hand-written port, which it replaced, is still in `src/game` and
  on `backup/handwritten-port`; nothing but its own unit tests uses it
  now.

**Before reading any of those as a fault, run
`tools/dev/which-key.ts`.** It moves every key edge of the recording a
tick and two ticks either way and scores each one. The oracle cannot
place an edge to better than a tick, and where the edge decides which
frame of the run `control_running` stops on -- frame 7 or frame 11 --
one tick is thirty of them:

    0fbffa60   edge 569 two ticks later:   722 of 724, from 642
    13ab6867   y at 416 two ticks later:   726 of 728, from 574
    9b60bf3a   Right at 394 three later:   551 of 557, from 529
    b4ff4672   Right at 251 one earlier:   429 of 429, from 396
    palace4    Right at  20 one earlier:   521 of 521, from 519
    5920a8c2   Shift at 240 one earlier:   414 of 415, from 413
    848ee3c4   Up at 925 one later:       1440 of 1446, from 1432
    level10b   Right at 68 two later:      389 of 403, from 361

**And the edge a run wants is the capture's, not the port's.** Two
captures of `13ab6867` want two *different* edges: the old one Up at
573 three ticks earlier (727 of 728) and a fresh one y at 416 two
ticks later (726 of 728), and neither wants the other's at all. That
is the clearest statement of what `which-key` measures. The same
thing happened to `level10b` when its capture was renumbered: the
edge worth ten ticks became a different edge worth twenty-eight.

**Run it as `which-key.ts --by 1,2,3`.** The default range of one
tick, and even `1,2`, is too narrow: against the old capture
`13ab6867` read 721 with its Up two ticks later and **727** with the
same Up three ticks earlier. And the edge tick these
tools take is the one in the decoded timeline, where the control
changes -- `848ee3c4`'s Up, written "926" in the old tables, is the
edge at **925**.

**It moves one control of an edge at a time, not the whole edge.** A
player who presses Right and Up in the same thousandth of a second
makes one edge of the recording, the script sends both at the same
instant, and the emulator can read them in two different ticks --
which moving the edge as a whole can never express. `848ee3c4` 926 is
exactly that and was the last of the suite's unexplained ticks; the
same change takes `palace4` from 516 to **exact** and `9b60bf3a` from
531 to 550.

`760c3e74`'s is the release at 292, taken two ticks early: the port
draws its ticks 286 to 326 exactly when it is given at 290.

**And recapture.** The oracle's phase moves between captures of the
same recording: four captures of `9b60bf3a` at the same shift, minutes
apart on an idle machine, scored 314, 315, 456 and **529** of its 557
ticks against a port that did not change. `tools/oracle/recapture.sh`
takes a recording several times and keeps the best, and says in its
own comments why that is sound and not fitting the oracle to the port.

### Four things about the oracle, measured the hard way

Read these before calling any difference a fault. Each cost a round.

1. **The schedule is `(t - 1) / 12` for a key going up as well as one
   going down.** Sending a release at `t / 12` instead took the suite
   from 12849 to 6503. `tools/oracle/README.md` has the numbers.
2. **A capture is worth taking four times.** The phase is not the only
   thing that moves: four captures of `9b60bf3a` at the same shift
   scored 314, 315, 456 and 529 of 557 against an unchanged port.
   `tools/oracle/recapture.sh` does this for you. Never read a run of
   differences as a fault until the capture has been taken again.
3. **The capture's phase is not the schedule's.** `origin` has no fixed
   relation to the DOS game's own 12 Hz timer, so every edge of one
   capture lands at the same unknown point inside a tick and at a
   different one in the next. Three captures of `palace4`, same
   recording, same shift, unchanged port: **466, 512 and 428** of 521.
   A run that reads worse after a change may simply be a new capture.
   Capture twice before believing it.
4. **A capture is a fresh run of `PRINCE.EXE`, so the port has to be
   one too.** `g` and the segments' own statics used to carry over, and
   `gate2` scored 235 alone and 616 after the twenty-one recordings
   before it. `resetGlobals` and the three `resetSeg*` fix that; do not
   undo them to make a number look better.
5. **A capture taken before `SETTLE_L1` came down cannot be used to
   measure the clock.** The old wait spent about 298 ticks of the hour
   before the capture's own tick nought, and the two runs whose clock
   crosses a minute -- `probeF` and `f6874819` -- were read that way
   and cost the C's `Kid.alive < 0` guard in `show_time`. Both are
   recaptured and the guard is back; `tools/oracle/README.md` has the
   arithmetic.
6. **The splitter's default numbering loses a tick wherever the
   screen holds still for three.** `split_ticks.py --hybrid` walks
   the gaps between picture changes and rounds each short, so it can
   only undercount, and an undercount is a capture that reads
   *ahead*. On `level10b` it made 460 changes into 460 ticks at
   11.8503 a second where `--numbering clock` made them span 466 at
   **12.0052**, which is the rate the game keeps. `firstcapture.sh`
   and `recapture.sh` try both now and keep the better. It is worth
   two to four ticks on an ordinary run and six on one that stands
   still for a hundred and twenty-five.
7. **The port does not read the keyboard a tick late.**
   `tools/dev/every-key.ts` moves *every* edge of *every* recording by
   the same number of ticks: the suite scores 10951, 11206, **11690**,
   11121 and 10493 at -2, -1, 0, +1 and +2. Nought wins by 484 and by
   569, and run by run in seventeen of the twenty-one, so an edge that
   wants moving is that capture's and not the port's.

**Do not stop while ticks are still different.** The tools:

* `tools/dev/pop-report.ts [name...]` -- the score.
* `tools/dev/pop-first.ts [name...]` -- where a run first parts
  company, under the same alignment the score uses, so a run that is
  simply a tick or two ahead all the way through is not reported.
* `tools/dev/pop-frames.ts <rec.json> <outdir> <from> <to>` -- the
  translation's frames as PNGs, to put beside the capture's. The
  captures live outside the repository (see `tools/oracle/README.md`);
  `tools/oracle/digests/shifts.txt` says which capture of each
  recording the digest was taken from.
* `tools/dev/recording-trace.ts <rec.json> --all` -- the same run
  through the hand-written port. Where the two ports agree and the
  capture does not, the difference is old; where they disagree, the
  translation has usually dropped a line of the C.
* `tools/dev/short-presses.ts` -- every press in the recordings
  shorter than four ticks, which is what DOSBox takes reliably.
* `tools/dev/late-key.ts <rec> <from> <to> <n,n,n>` -- the same run
  with one press moved on by n ticks, scored.
* `tools/dev/which-key.ts <name...> [--by 1,2]` -- every edge of a
  recording, and every control of an edge on its own, moved a tick or
  two either way and scored. What it finds is the harness's own
  resolution; what is left over is the port's.
* `tools/dev/every-key.ts [-2,-1,0,1,2]` -- the whole suite with
  *every* edge of *every* recording moved by the same amount, which
  is the check that the port is not reading the keyboard late.

**Before reading a run of differences as a fault, check for a tap.**
`gate1` looked like the worst difference in the set -- exact for 591
ticks and nothing after -- and it is a two-tick tap of Right that
reached the emulator fourteen ticks late. Moved there, the port draws
790 of the 796. A late press does not read as lateness; it reads as
the original doing something else.

## The score cannot see most of the game: fuzz it

Three of this round's bugs were found by **playing badly**, not by
reading: fourteen levels, random keys, the cheats, through the doors,
checking only that nothing throws and nothing goes `NaN`. Two were
`TypeError`s that stop the page dead (level 5 about one run in ten,
level 10 about one in five); the third drew nobody at all and said
nothing.

All three are one shape, and it is the shape to look for in a C
translation: **C reads a byte past an array and gets a number;
JavaScript gets `undefined`.** Taking a field off it throws; comparing
it does not -- `undefined >= 30` is `false`, and `enter_guard` built
a guard out of nothing. The silent one is the worse of the two.
`roomLinksOf` in `src/pop/state.ts` is now the one place that answers
for a room that is not a room, and `tests/pop/fell-out.test.ts` pins
the four cases.

`tests/pop/levels-smoke.test.ts` now plays badly for a thousand ticks
of every level on a fixed seed, which costs two seconds. The fuller
sweep is **`tools/dev/fuzz.ts`** now, rather than a thing to write
again each round:

    npx tsx tools/dev/fuzz.ts [seeds] [ticks]

Eight seeds, three thousand ticks of every level, the cheats thrown
in at random, every room of every level drawn through `showRoom`,
**every global walked for a number that is not a number any more**,
and the title, the ending, the hourglass and the six level cutscenes
played to the end with keys hammered at the hall of fame's name box.
Two faults came out of its first run -- the two cheats above -- and
it is clean after them.

## The player plays `game.js`, not `src/`

GitHub Pages serves `index.html` and `game.js` from the repository root.
Nothing builds them for you: no workflow, no hook. A fix that is in `src/`
and not in `game.js` does not exist as far as the player is concerned.

This has already happened once, and cost a whole night: six commits of
real fixes sat in `src/` while the player refreshed the page and saw the
same bugs, and reasonably concluded that nothing had been fixed.

`npm run build` now writes both bundles, and `npm test` runs it. So:

* **Never finish a change without `npm test` and `git add -A`.** The
  rebuilt `game.js` and `index.html` have to go in the same commit.
* **Before saying anything is fixed, check `git log -1 -- game.js`**
  against `git log -1 -- src/`. If `src/` is newer, the player has not
  got the fix.

## Work, do not report on work

**Nothing runs after you stop calling tools.** A turn ends the moment
you write your final message; there is no background worker carrying on
with what you said you would do next. So "I am continuing" at the end of
a turn is not a plan, it is a stop -- and it has read as one to the
player three times now.

So: never end a turn on what you are about to do. Do it, and end on what
is done and deployed. If a bug needs another measurement, take the
measurement in the same turn. If the context is running out, say so
plainly rather than promising to continue.

A turn that spends itself describing a plan, measuring something and
writing up the measurement has fixed nothing, however good the
write-up. The player wants bugs gone from the game they can play.

## What the port is measured against

A real `PRINCE.EXE` under DOSBox. `tools/oracle/README.md` has the
pipeline and the three measurements it rests on. Where a capture of the
original and a reading of the code disagree, the capture wins.

## Never end a turn by naming the next thing

Do not finish a turn with "what is still missing is X" or "X is the next
big thing". Naming the work is not doing it, and the player has to come
back and tell you to do the thing you just described -- which has now
happened four times.

If you can see what is missing, start it in the same turn. Report what
is done and deployed, and if something really is too big to begin, say
so in one line and say why, not as a plan for next time.

## Stopping is not finishing

If you stop while bugs remain, that is not a finish, it is a pause --
and the only correct thing to do with a pause is start again. Begin the
next turn by picking the work back up, not by summarising where it got
to. Keep going round the loop -- measure, fix, build, commit -- until
every difference against the original is gone. "I ran out of room" is
not an ending either; say what is done and deployed, then carry on.
