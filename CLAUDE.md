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


## A `goto` READ AS A `return`, SEVEN SEAMS THAT DEFAULTED TO NOTHING, AND TEN GLOBALS NOBODY READ

    measured   32260 of 33047   98%   (unmoved, run for run)
    scenes      2442 of  2601   94%   (unmoved)
    sounds       491 of   494  ->  **493 of 494**
    npm test     797 -> 825

    feather1snd   49 of 50  ->  **50 of 50**, exact
    gate1snd      94 of 96  ->  95 of 96

A round spent entirely in the vein the last one opened: divergences
**no score can see**, found by reading `sdlpop/src` beside
`src/pop`. Not one number moved, and the three fixes are each
something a player can meet.

### 1. `play_guard`'s `goto` is not a `return`

`seg006.c:1486` is a jump into the middle of its own body:

    if (Char.alive < 0) {
        if (guardhp_curr == 0) { Char.alive = 0; on_guard_killed(); }
        else goto loc_7A65;
    }
    if (Char.charid == charid_1_shadow) clear_char();
    loc_7A65:
    autocontrol_opponent();
    control();

The `goto` skips `clear_char` for a guard who is merely alive. What
it does **not** skip is the two calls after it, and the port had read
the whole kill branch as a `return`, so on the one tick
`guardhp_curr` reaches nought nothing ran at all.

`control()` with `Char.alive >= 0` -- which the line above has just
written -- is three lines long: a character standing on frame 15,
166, 158 or 171 is put into `seq_71_dying`. Measured, one tick after
the last hit point comes off with `Guard.alive` still -1 and the
guard standing on `seq_2_stand`:

    guard, frame 166    the C 179 (collapse 1)   the port 15
    guard, frame  15    the C 179                the port 15
    shadow              direction 86 (none)      direction -1

-- so a guard whose last hit point came off while he stood took an
extra tick to fall over, and the mirror shadow of level 4 stayed on
the screen an extra tick after he was killed.

**Every digest is unchanged, run for run.** The one probe in the
suite that kills a guard is `killguard6`, and `k` is `guardhp_delta
= -guardhp_curr; Guard.alive = 0` -- it writes `alive` itself, so it
never takes this branch at all and reads 299 of 299 either way.
`tests/pop/dropped-lines.test.ts` pins the three numbers.

### 2. Seven seams were declared outside `link.ts` and defaulted to nothing

The round before this one found `wire.ts` wiring a slot to
`() => {}` and made the test forbid it. `slot()` in `link.ts` makes
an **unwired** seam throw, so that is the whole of the protection --
except that seven seams are not `slot()`s at all. They are one
function on an object the calling segment already exports, and they
had silent defaults:

    seg003  dist.char_opp_dist      (): number => 0
    seg005  dist.char_opp_dist      (): number => 0
    seg003  rooms.goto_other_room   (_d: number): void => {}
    seg008  hp.draw_hp              (): void => {}
    seg008  mobs.draw_mobs          (): void => {}
    seg002  hp.draw_guard_hp        (_c, _m): void => {}
    seg002  hp.add_life             (): void => {}

`char_opp_dist`'s is the worst of them: a **wrong answer** rather
than no answer. `link.ts` exports `unlinked()` now -- the same
throwing body `slot()` uses -- and all seven take it, so the hole is
gone from the port rather than merely forbidden in one file.
(`rooms.goto_other_room` also had its return type as `void` where
the C's is `int`.)

**And the two holes the stub test does not cover are pinned.** A
seam wired to the *wrong* function is two functions and TypeScript
is happy with either; a seam wired to one that **drops an
argument** is happy too, because a `(n: number) => void` is
assignable to a `(a: number, b: number, c: number) => void`.
`tests/pop/dropped-lines.test.ts` reads both files now: every
`x.key.fn = name;` in `wire.ts` must have `name === key`, and every
`key: slot<(a, b) => r>('name')` in `link.ts` must throw under its
own key and be wired to a function whose `.name` is that key and
whose `.length` is the arity the slot declares. One wrapper is
allowed and is named in the test. Both holes were checked by making
them: `l7.is_spike_harmful.fn = start_chompers` and
`l7.trigger_button.fn = function trigger_button(_a: number) {}`
each fail it.

### 3. Ten globals were written and never read, which is the `need_full_redraw` shape

Walked every field of `Globals` and counted reads against writes
across `src`:

    draw_mode            SDLPoP's `-draw` debug switch
    guard_refrac_timer   no such global in the C at all
    obj2_clip_top/_bottom/_left/_right
                         `save_obj`/`load_obj`, which nothing in the
                         C calls either
    start_level          SDLPoP's command line
    tile_table           shadowing the real const in `data.ts`
    torch_colors         `USE_COLORED_TORCHES`
    objtable_count       a dead mirror of `g.objtable.length`,
    wipetable_count      and of `g.wipetable.length`: four places
                         wrote them and nobody read them

All ten are gone, and the count is a **test** now:
`tests/pop/dropped-lines.test.ts` walks every field of `Globals`,
counts `g.field` reads against writes over the whole of `src`, and
fails on any field that is written and never read. **`loaded_room`
is the one exception and is named in the test**: the C writes it in
`get_room_address` and the only things that read it are the copy
protection and the coloured torches, neither of which this port
has. Checked by putting `need_full_redraw` back -- one declaration
and one write -- and watching it fail.

### 4. `get_tile_div_mod` reads off the ends of its tables, and `& 0xff` is not what the original gets

`get_tile_div_mod` (`seg006:0433`) is two unchecked array reads --
`obj_xl = tile_mod_tbl[xpos]; return tile_div_tbl[xpos];` -- and the
two tables are 256 bytes each, laid out `tile_div_tbl` then
`tile_mod_tbl`. So a negative `xpos` reads `tile_div_tbl` for `xl`
and the thirty-four bytes **in front of** `tile_div_tbl` for `xh`,
and SDLPoP writes both runs out verbatim to simulate it.

The port answered `tile_div_tbl[xpos & 0xff]` under a comment saying
the game's own range of x never notices. **It does not, and that is
measured**: over every recording in the suite, every tick, `xpos`
runs **30 to 242**. But eight seeds of random keys over all fourteen
levels get it to **-4**, where the two answers are not even the same
pair -- `& 0xff` gives `tile_div_tbl[252]` = 13 for `xh` where the
original gives the byte 0xB5 = 181 in front of the table.

So no score can move by it (measured: 32260 of 33047 either way, run
for run) and no score could have caught it. Both runs of bytes and
both overflow directions are in now, with SDLPoP's arithmetic
fallback past the bytes it knows.

### 5. What was read and is **right**, with what it cost

A rejected hypothesis is a measurement. Every one of these was
checked line by line against `sdlpop/src` and is faithful:

* **Call counts, every shared function.** A script that counts the
  calls each C function makes against the same function in the port
  flagged 62; all but `play_guard` are `#ifdef` branches SDLPoP
  added (`USE_JUMP_GRAB`, `USE_SUPER_HIGH_JUMP`, `USE_TELEPORTS`,
  `USE_COLORED_TORCHES`, `FIX_*`), the `l*.fn` indirection, or my
  extractor running two C functions together.
* **Comparison constants, every shared function.** The same script
  for every `name OP number` in a body: `autocontrol_guard_active`
  is De Morgan's of the C's guard, `control_hanging` and `land` the
  same, `up_pressed` and `grab_up_with_floor_behind` take the
  vanilla side of their `#ifdef`, `get_loose_frame`'s second test is
  `custom->loose_floor_delay > 11` which is false at the default 11,
  and `find_room_of_tile` has the `#ifndef FIX_CORNER_GRAB` order.
* **The `+` cheat does not add two minutes.** The C reads
  `if (rem_min < 0) {...} else ++rem_min; ++rem_min;` only with
  `ALLOW_INFINITE_TIME`; the `#else` is a single `++rem_min`, which
  is what the port has. An hour was nearly spent on that.
* **`process_key`'s whole switch against `web/main.ts`'s
  `commandKey`**, including `restartLevel`'s `current_level != 15`,
  `skipLevel`'s `< 4 || cheats` and its fifteen-minute crop, and the
  `need_show_text` tail's `text_time_total = text_time_remaining =
  24`.
* **`do_paused`'s `next_room = 0`**, which the port does not have
  and does not need: `check_the_end` leaves `next_room` either equal
  to `drawn_room` or nought, and both are a no-op on the next tick.
* **`timers`, `play_level_2`, `check_the_end`, `check_shadow`,
  `check_fall_flo`, `do_startpos`, `set_start_pos`, `play_kid_frame`,
  `read_user_control`, `control_kid`, `save_ctrl_1`/`rest_ctrl_1`,
  `release_arrows`, `play_seq`, `do_fall`, `land`, `take_hp`,
  `add_life`, `do_delta_hp`, `draw_hp`, `control_standing`,
  `control_crouched`, `check_get_item`, `do_pickup`, `fell_out`,
  `check_guard_fallout`, `check_killed_shadow`, `draw_tile_right`,
  `draw_tile_topright`, `draw_tile_fore`, `show_time`,
  `get_edge_distance`, `add_guard_to_objtable`, `hurt_by_sword`,
  `draw_objtable_item`** -- all faithful.

### 6. Two keys the page did not read, and one erase it skipped

Neither of these is in `src/pop` and neither could be: `pop-report.ts`
and `page-port.ts` both hand the game a `{x, y, shift}` and never go
through the page's key map at all, and `__princeHold` takes a
direction by name.

**`read_keyb_control` (`seg000:1500`) is four lists and they are not
the four a keyboard suggests:**

    up     UP, HOME, PAGEUP, KP_8, KP_7, KP_9
    down   DOWN, CLEAR, KP_5, KP_2
    left   LEFT, HOME, KP_4, KP_7
    right  RIGHT, PAGEUP, KP_6, KP_9

Two of those the page did not have, and both are keys a player
presses. **`KP_5` is `down`**, where the page had it standing for no
direction at all -- the middle key of the keypad did nothing. And
**Home and PageUp are the diagonals**, each in two lists at once; on
a keyboard with no numeric keypad they are the only way to jump
diagonally with the keys the original names, and the page had
neither. `Numpad1` and `Numpad3` are in no list of the C's and are
kept anyway, because taking them away would only cost a player a key
that works. `tests/browser/controls.test.ts` dispatches a real
`KeyboardEvent` for each of the thirteen and reads `held` back.

**And `showRoom` had a test the C does not.** The five
looking-around cheats are each two lines --
`draw_guard_hp(0, 10); next_room = room_L;` -- with nothing in front
of them, and the port opened on `if (room === g.drawn_room) return;`.
That costs nothing for `next_room`, because `check_the_end` is
`if (next_room != 0 && next_room != drawn_room)` and does nothing
either way; what it skipped is the **erase**. So Ctrl+B pressed in
the room the Prince is already in -- the ordinary way to stop
looking around -- left the guard's flasks painted under the room
where the original rubs them out, and nothing redraws them:
`draw_hp` only touches them while `guardhp_delta` is set. Measured:
**32260 of 33047 either way, run for run.**

### 7. `alter_mods_allrm` walks `1 .. used_rooms`, and three records say less than 24

    if (level.used_rooms > 24) level.used_rooms = 24;
    for (word room = 1; room <= level.used_rooms; room++) { ... }

The port passed a flat 24. Eleven of the sixteen records say 25 and
are capped, so for them it is the same walk -- but **level 10 says
21, level 14 says 7 and level 15 says 9**, and in the original the
rooms past the count keep their raw modifier byte: a gate with
modifier 1 stays 1 instead of becoming 188, a potion stays
unshifted, a wall keeps its stored byte instead of its connections.
**47 tiles of level 10 and 278 of level 14** are altered by the
difference, and level 15 has none.

It is unobservable in play, and that is measured rather than
assumed: walking `roomlinks` from the start room reaches **no room
past `used_rooms` on any of the sixteen records** (level 10 reaches
19 of its 21, level 14 six of its 7, level 15 six of its 9). The
score is 32260 of 33047 either way, run for run.

It did move a **test**, which is the useful half: `potions.test.ts`
walked rooms 1 to 24 of every level and so found four more
"inversion potions" in level 14's rooms 8, 12, 13 and 18 -- raw
bytes in rooms the game never alters and nothing can reach. The walk
is `1 .. used_rooms` now, and the reachability is pinned beside it.

### 8. The port carried three of SDLPoP's 1.3 sound priorities

`play_sound` keeps the most important sound of a tick in
`next_sound`, and `play_next_sound` starts it only if the channel is
free or if

    sound_interruptible[current] != 0 &&
    sound_prio_table[next_sound] <= sound_prio_table[current]

-- so the two tables decide what the player hears whenever two
things happen at once. SDLPoP defines `FIX_SOUND_PRIORITIES` by
default and runs `fix_sound_priorities()` before anything else,
whose own comment is **"Change values to match those in PoP 1.3"**:
`sound_48_spiked` 0x19 -> 0x15, `sound_10_sword_vs_sword` 0x0A ->
0x0D, and `sound_49_spikes` marked interruptible. The port had all
three of the 1.3 values, and **the executable this project is
measured against is 1.0**.

Read straight out of `PRINCE.EXE` and `UNCRKD.EXE`, which both hold
the two tables back to back at 0x1CCFA and 0x1CD27:

    index  0..23   14 1e 23 66 32 37 30 30 4b 50 0a 12
                   0c 0b 69 6e 73 78 7d 82 91 96 9b a0
    index 24..29   01 01 01 01 01 13
    index 30..39   written over by eight bytes of a far-pointer
                   table, `1e 00 b2 01 09 00 b0 00`, two bytes
                   shorter than the ten they replace -- the same
                   thing the release does to the `_` glyph of the
                   font, and the reason everything after it reads
                   two bytes early
    index 40..57   01 01 01 01 87 8c 0f 10 19 16 01 00
                   01 01 01 01 01 00

So the release has **0x0A at 10 and 0x19 at 48**, and the port has
them now. What they change in play: with 10 at 0x0A the sword clash
is worth more than either hurt sound, so a hit that lands on the
same tick as a parry is refused -- which is the behaviour SDLPoP's
fix exists to undo; with 48 at 0x19 against 49's 0x16 and 49
uninterruptible, the sound of someone being spiked never cuts the
spikes off.

**Nothing in the suite could have caught it**: none of the six sound
probes fights with a sword or steps on a spike, and no picture
digest can hear. Measured either way: pictures 32260 of 33047 run
for run, sounds 491 of 494. `tests/render/sound-priority.test.ts`
reads both tables out of both executables and checks the port
against every byte the release has not written over -- and names
the ten it has.

### 9. Six sounds a PC speaker cannot make, and the two lines that refuse them

**The one number that moved this round.** `play_sound` is four lines
and the port had one:

    if (next_sound < 0 || sound_prio_table[id] <= sound_prio_table[next_sound]) {
        if (NULL == sound_pointers[id]) return;
        if (sound_pcspeaker_exists[id] != 0 ||
            sound_pointers[id]->type != sound_speaker) {
            next_sound = id;
        }
    }

The two inner lines are about **the machine the game is played on**:
`sound_pointers[]` is what `load_sounds` put in for the sound card
that was chosen, and six of the fifty-eight have no PC speaker
version at all --

    1  falling        11  sword moving     19  draw sword
    20, 21, 22  the three loose-floor shakes

-- so on a speaker machine those six are thrown away *before*
`next_sound` is written and whatever the tick had chosen before them
stands.

**The refusal being inside the priority test is what makes it worth
noises.** A loose floor shaking is `sound_20_loose_shake_1` at 0x91
and a footstep is 0x9A, so without these lines the shake wins the
tick and the footstep is lost -- and then the shake is thrown away
by the device too and the player hears **nothing**, where the
original plays the footstep.

The capture runs a speaker machine (that is how `show_title`'s first
wait was settled at 24.77 seconds against `IBM_SND1.DAT`'s own
24.74), so measured against it:

    feather1snd   49 of 50  ->  **50 of 50**, exact
    gate1snd      94 of 96  ->  95 of 96
    sounds       491 of 494 ->  **493 of 494**

and the pictures and the scenes do not move by a tick or a frame.

The port does **not** hold `sound_pcspeaker_exists`; it asks the
machine, through a new `PopEffects.hasSound`, because that is what
`sound_pointers[]` is. `sound-common.ts` answers it out of
`IBM_SND1.DAT` itself -- `SpeakerChannel.has`, which is true for the
forty-eight tunes the file holds -- and the browser does not answer
it at all, because it has a recording or a tune for every one.
`tests/render/sound-priority.test.ts` pins the ten indices the
speaker cannot reach (the six, and 31, 34, 42 and 57, which have no
sound behind them at all) and checks them against the bytes of
`sound_pcspeaker_exists` the release has left readable.

### 10. And `play_next_sound`'s own test, which the port left to the device

    if (next_sound >= 0) {
        if (!check_sound_playing() ||
            (sound_interruptible[current_sound] != 0 &&
             sound_prio_table[next_sound] <= sound_prio_table[current_sound]))
        {
            current_sound = next_sound;
            play_sound_from_buffer(sound_pointers[current_sound]);
        }
    }
    next_sound = -1;

`SoundPlayer.mayTake` applies the same rule, so the right sound
reached the channel either way -- but the port wrote `current_sound`
whatever the device then did with it, and **`current_sound` is read
by `play_kid`**:

    if (check_sound_playing() && current_sound != 5) return;

-- a dying Prince waits for whatever is sounding unless it is a gate
opening. With a gate in the channel and a footstep asked for in the
same tick, the device refuses the footstep (0xA0 against the gate's
0x37) and the channel still holds 5, while `current_sound` said 23
and the Prince stopped to listen to a sound nobody was playing.

Everything the test needs is already here, so the port does the
whole of it now. Where there is **no device** -- `pop-report.ts`,
`sound-report.ts`, every test but the browser's --
`check_sound_playing` answers nought except while the death music or
a feather is being counted out, so the first half of the test is
true and almost nothing changes. Pictures 32260 of 33047 and sounds
493 of 494, either way.

**The exception is the potion level, and the capture settles it.**
`potion1` asks for `sound_18_drink` six times, and the fifth --
the inversion's, on tick 479 -- falls inside the feather's 365 to
588. `sound_39_low_weight` is priority 0 and uninterruptible, so the
original refuses it, and `potionsnd`'s capture has one unbroken
noise from 81.2 to 99.9 and then blips from 101.1 with **nothing in
between**. Five swallows, not six, and the page and the port now
agree on all sixteen sounds of the run rather than seventeen.

### 11. Every unguarded SDLPoP fix, checked one by one

`FIX_SOUND_PRIORITIES` was found by reading, so the rest were swept
for. Most `FIX_*` in `sdlpop/src` are gated at run time by
`fixes->fix_xxx` and are off, but a handful are plain `#ifdef` with
no runtime flag, and those are SDLPoP's behaviour unconditionally.
In the gameplay segments there are eight, and the port takes the
vanilla side of **every one but the one above**:

    FIX_CORNER_GRAB            `find_room_of_tile` checks the row
                               before the column -- port has the
                               `#ifndef` order
    FIX_ENTERING_GLITCHED_ROOMS  `goto_other_room`'s
                               `if (Char.room == 0) other_room = 0`
                               -- port reads `roomlinks[-1]` as the
                               C does
    FIX_SPRITE_XPOS            `x_to_xh_and_xl` as a shift and a
                               mask -- port has the signed form
    FIX_LOOSE_NEXT_TO_POTION   `redraw_at_trob()` for
                               `animate_potion` and `animate_sword`
                               -- port has `set_redraw_anim_curr`
    FIX_ABOVE_GATE             two more draws in `redraw_needed`
    FIX_BIGPILLAR_JUMP_UP      a tile test in `redraw_needed_above`
    FIX_BLACK_RECT             a third `draw_wipes` in `draw_tables`
    FIX_LEVEL_14_RESTARTING    clearing the bottom text in
                               `show_level`

(`FIX_COLL_FLAGS`, `FIX_DISAPPEARING_GUARD_A` and `_B` are commented
out in `config.h` and are not SDLPoP's behaviour either.)

### 12. Two paths the page had never been compared on, and both are exact

`tools/dev/page-port.ts` covered fourteen levels, nine scenes, the
eleven cheats and all thirteen transitions. It now also covers the
two things a player does that none of those reach.

**`--deaths`: a level played past a death and a restart.** No digest
reaches it (a recording ends where it ends, and only `probeF` and
`f6874819` restart at all), and **no browser test could**, because
the page's restart is `changeScene(restart)` in the animation loop
and `__princeStep` -- which every browser test drives -- leaves it
out. A page stepped through it plays straight on past the death with
`restartDue` stuck true. `__princeStepRestarting` is the loop's own
order instead: step, restart if it is due, and only then draw, which
is `digest-common.ts`'s `runOf` exactly.

    death  1  pictures 400 of 400  restarts page [224] port [224]
    death  7  pictures 400 of 400
              restarts page [40,100,160,220,280,340,379] port the same

Shift is held for a third of the ticks on top of `PATTERN` rather
than throughout, and that is measured rather than chosen: a Shift
held *into* the new level makes the Prince grab the ledge of level
7's shaft and live, and holding it throughout kills nobody at all on
any of the fourteen.

**`--potion`: `potion.html`, the one page that drinks a potion.**
It is the same bundle with one extra `LEVELS.DAT` record and a
second document, because `__princePotionLevel` is read before
`game.js` runs. Driven by `potion1`'s own timeline:

    potion    pictures 1012 of 1012  sounds 17 page / 17 port  drinks 6

**And `--entries 8` had been failing since the held-Shift restart
went in**, which nobody had noticed because the tool is not in `npm
test`. It plays sixty ticks of the level before and then sends
Shift+L -- and on level 7 sixty ticks is forty-three ticks after the
Prince is dead, so `process_key`'s own `if (rem_min != 0 && Kid.alive
> 6 && control_shift) key = Ctrl+A` turned the skip into a restart
and the tool read `arrived at 7`. That is the original's behaviour
and not a fault; the tool holds Shift for the first twenty ticks now,
which grabs the ledge. Measured in the headless port, the Prince's
state at tick 60 for each hold length: 0, 10, 14, 26 and 33 leave
level 7 **dead** and **20** leaves him alive, with every other level
alive under all six. All thirteen entries are exact again.

Both new comparisons are in `npm test`
(`tests/browser/page-vs-port.test.ts`), and the whole tool reads

    npx tsx tools/dev/page-port.ts --scenes --cheats --entries --deaths --potion

with 14 levels, 9 scenes, 13 entries, 2 death runs and the potion
level all exact.


## `rooms7` IS EXACT: A STUBBED `set_start_pos` AND A CAPTURE NUMBERED FROM THE WRONG TICK

    measured   32260 of 33047   98%   (was 32093 of 33067, 97%)
    scenes      2442 of  2601   94%   (unmoved)
    sounds       491 of   494         (unmoved)

    rooms7       942 of  1129  ->  **1109 of 1109**

The last gameplay shortfall with a real fault in it. It was two
things, and the old account -- "the twenty are the death:
`Char.alive` does not advance while the death music plays and the
port's `RESTART_PROMPT_DELAY` is a constant 46" -- was neither of
them. (`RESTART_PROMPT_DELAY` is in `src/game`, the hand-written
port nothing uses.)

### 1. The capture's tick nought was the level's *arrival*, not the Ctrl+A

`rooms7` is the one probe whose chain ends on level 7, and level 7
is the one level the chain has to hurry past: `DEADLY_WAIT` is two
seconds because a `shift+l` sent after that is eaten --
`process_key`'s `if (rem_min != 0 && Kid.alive > 6 && control_shift)
key = Ctrl+A` turns the Shift of a skip into a restart.

Two seconds is not enough room for the **splitter**. The emulator
takes the skip about 1.1 seconds late and the Ctrl+A about 1.45, so
the level's own arrival lands inside the window
`split_ticks.py --after-blank` searches, and it is a real black
screen where the Ctrl+A redraw is quicker than a video frame and
leaves none at all. The splitter says so itself:

    restart flash at video frame 71 (117.367s)
    title goes off at tick 24; renumbering by +1

against a Ctrl+A the video puts at **119.73** -- and the two are
indistinguishable, because both start level 7, both write `LEVEL 7`
for 24 ticks, and in both he falls down the shaft and dies. The
whole run was numbered **twenty-six ticks early**.

No `--start` can mend it: with the search started after the arrival
the blank walk goes off to the first room change of the tour (376 of
1030, measured), and the anchor lands on the arrival's title
whatever it is given. **Three fresh captures at two seconds scored
885, 913 and 925** against the pinned 942, so it was never the
capture lottery.

`LAST_DEADLY_WAIT` is **ten** seconds: the wait after the *last*
skip of a chain, where nothing follows but the Ctrl+A, which is
neither Shift nor Enter and so cannot be eaten. Ten puts both the
`--start` values `recapture.sh` tries between the two `LEVEL 7`
blocks -- the arrival's title is dark by `restartAt - W + 3.1` and
the Ctrl+A arrives at about `restartAt + 3.7`, so the candidates
`restartAt - 4` and `restartAt - 1` need W over 7.1 and over 4.1.
**Eight splits of two captures then read 1041 to 1057**, with no
spread worth the name, and the best is 1057 of 1109.

### 2. And the fifty-two ticks left were **nine pixels**, from a stub

`play_kid`'s resurrect is

    if (resurrect_time) {
        stop_sounds(); loadkid(); hitp_delta = hitp_max;
        seqtbl_offset_char(seq_2_stand); Char.x += 8;
        play_seq(); load_fram_det_col(); set_start_pos();
    }

and it reaches `set_start_pos` through a slot in `link.ts`, because
seg006 and seg003 are a cycle. **`wire.ts` had the slot wired to
`() => {}`.** `do_startpos` calls the real one directly, so nothing
but the `r` cheat ever went through the slot and nothing ever
noticed.

So `r` left the Prince standing wherever his corpse had come to
rest, with every one of that function's resets undone: `Char.y =
y_land[Char.curr_row + 1]`, `fall_y`, `fall_x`, `is_feather_fall`,
`upside_down`, `knock`, `is_screaming`, `offguard`, the sword
sheathed, and the `savekid()` that writes it all back.

Measured, on the tick after the `r`:

    the port    Char.y 179   where he died, on the floor of room 3
    y_land[3]          181   where `set_start_pos` puts him

Two pixels. Over the fifty-two ticks he then stands still that is
**194 pixels of each frame and nine outside the digest's mask** --
a sliver of the back of his cloak at x 77..78, y 152..160 -- and
the capture's picture is the port's shifted down by two:
differences in the box round him go 147 at dy 0 and **43 at dy 2**.

With the slot wired, **`rooms7` is 1109 of 1109** and nothing else
in the suite moves by a tick.

**The lesson is the slot.** `wire.ts` has thirty-odd of them and one
was a stub; the only thing that ever called it was a cheat, and the
only probe that uses that cheat is the one that was short.
`link.ts`'s own `slot()` makes an **unwired** seam throw ("has not
been linked in"), so the only way a call across a segment cycle can
quietly do nothing is an empty function in `wire.ts`.
`tests/pop/dropped-lines.test.ts` reads the file and fails on one:
there is no such thing as a seam that should do nothing.


## THE BUTTON AFTER A DEATH IS A HELD KEY, AND IT WAITS FOR THE DEATH

    measured   32093 of 33067   97%   (unmoved, run for run)
    retired     1883 of  3767         (unmoved, run for run)
    npm test     795 -> 797  (with the seam test below)

`process_key`, before its switch (`seg000:0784`):

    // If the Kid died, Enter or Shift will restart the level.
    if (rem_min != 0 && Kid.alive > 6 &&
        (control_shift || key == SDL_SCANCODE_RETURN)) {
        key = SDL_SCANCODE_A | WITH_CTRL; // Ctrl+A
    }

`control_shift` is the **state** of the key, not a press, so holding
Shift through a death begins the level again the moment the death is
over. The port had the line in `pressButton`, called by the driver
and by the page on the key's **edge**, and guarded by
`Kid.alive >= 0` instead of `> 6`, with no `rem_min` guard at all.

Three differences, all of them things a player meets:

* a Shift **already held** when the Prince died did nothing, because
  the edge was already past: the player had to let go and press
  again;
* a Shift **pressed during the death** began the level in the middle
  of the death animation, where the original makes him watch it out;
* a Prince who died on the **last tick of the hour** restarted the
  level instead of getting the hourglass.

Measured on level 7, whose entry kills him on tick 17 with no key
touched -- the tick `restartDue` goes true, Shift held from:

    tick  0   never      he catches the ledge and lives
    tick 18   **24**     the first tick `Kid.alive` is past 6
    tick 25     25
    tick 40     40
    rem_min 0   never

The line is in `PopGame.step`, where `process_key` is in the C --
after `timers()` and before `play_frame()` -- so it reads the held
control rather than an edge. `pressButton` keeps the same guard for
the page's own "any key while `Press Button to Continue` is up",
which is a deliberate departure written up in `web/main.ts`.

**Every digest in the suite is unchanged by it, run for run**, and
that is worth the line it takes: the first attempt moved the guard
to `Kid.alive > 6` and left the edge, and `gate2b` fell from 1179 to
**740**. The edge is the half that was wrong, not the guard.
`tests/pop/level7-entry.test.ts` pins all five numbers.


## THE GHOST OF THE PRINCE DRINKING: `redraw_screen` NEVER BLACKED THE ROOM

    measured   32093 of 33067   97%   (unmoved, to the tick)
    scenes      2442 of  2601   94%   (unmoved)
    sounds       491 of   494         (unmoved)
    npm test     786 -> 795

The player drank the upside-down potion on `potion.html` and **a copy
of him in the drinking pose stayed on the screen for the rest of the
level**. It is one line of `redraw_screen`, it was never the potion
level's and never the flip's, and the round before this one wrote
down that it could not happen.

### 1. The line: `is_blind_mode = 1; draw_tables(); is_blind_mode = 0;`

`redraw_screen` (`seg003:037B`) is

    redraw_room();
    is_blind_mode = 1;
    draw_tables();
    is_blind_mode = 0;
    memset(table_counts, 0, sizeof(table_counts));
    draw_moving();
    draw_tables();

and the port had the two `draw_tables` and **not the flag**.
`draw_tables` opens with
`if (is_blind_mode) draw_rect(&rect_top, color_0_black)`, so that one
line held up for one call is the whole of how `redraw_screen` blacks
the room. `redraw_room` only fills the tables, and **`tiles_0_empty`
draws nothing at all**, so the open air of a room is never painted
over by drawing the room again.

It cost nothing on `redraw_screen(1)`, which fills the room with
black above it anyway. On **`redraw_screen(0)`** -- which is reached
from exactly one place in play, `need_redraw_because_flipped` -- it
redrew the room *around* the Prince already standing in it.

### 2. Why a leftover sprite becomes permanent: the peel

`redraw_room` opens with `free_peels()`. So, logged tick by tick on
the potion level (`add_peel`/`restore_peels` instrumented):

    tick 225  restore_peels n=1 99,77 21x42   add_peel 99..120 77+42
    tick 226  free_peels n=1                  <- the flip
              restore_peels n=0 (twice)       add_peel 99..120 77+42
    tick 227  restore_peels n=1 99,77 21x42   add_peel 99..120 77+42
    tick 228  restore_peels n=1 99,77 21x42   add_peel 105..122 74+45

At 226 the peel that held the background under him is thrown away,
the room is drawn without being blacked, his pixels survive it, and
the new `add_peel` reads **his own sprite as if it were the
background**. 227 looks right because the contaminated peel is put
back over the very pixels it came from. At 228 he moves, the peel is
painted back at 99,77, and the drinking Prince is there for good --
nothing ever paints over the black air of a room again.

### 3. Measured against the original, which can now be asked

`potion1` replayed under `dosbox_oracle.py --game` with the potion
`LEVELS.DAT`, recorded at 30fps and scaled back to 320x200. Count the
pixels brighter than 60 in the box **x 90..140, y 68..118** -- the
black air of the corridor, where nothing but the Prince can ever be
-- and line the capture's video frames up with the port's ticks
(2.5 frames to a tick, f0125 against t0489):

    tick        489   491   493   495 .. 515
    PRINCE.EXE  572   872   855   803
    the port    572   872   855   803    with the fix
    the port    572   872  1007   972    without it

`toggle_upside` fires on tick 490 of `potion1`. **The ghost is 169
pixels the original never draws, from the third tick after the flip
and for ever after**, and with the line in the port agrees with the
capture exactly, tick for tick, on every one of them.

Drinking all six and comparing the picture at rest with the room
drawn whole (`redraw_screen(1)`), pixels left behind:

    hurt heal life feather   inversion   open
       0    0    0       0         169    322

-- the open one's 322 is the inversion's ghost still there plus its
own, because it is drunk after it.

### 4. The correction: "it changes no picture in this port" was wrong

The round that put `need_redraw_because_flipped` in wrote:

> **And it changes no picture in this port, which is worth writing
> down.** [...] Measured directly: levels 1 and 9, forty ticks apiece
> with `shift+i` on tick 20, the full-redraw branch against the cheap
> one -- **no tick differs, not one pixel**.

**That measurement held the Prince still, which is the one case the
fault cannot show**: a peel contaminated with his own pixels is
restored over the very pixels it came from until he moves. The flag
and the branch were right; what was missing was the black fill
*inside* the branch, and a still Prince never pays for it.

Measured again with him **walking** -- `shift+i` on tick 60, Right
held throughout, the picture at rest against the room drawn whole:

    level      1    2    9   13
    walking   45   92   39   92     pixels left behind
    standing   0    0    0    0

### 5. "It was not there on level 9", settled

It is there on level 9. The table above is `shift+i` on the real
levels and level 9 -- a palace -- leaves 39 pixels behind where the
dungeons leave 45 and 92. It is not dungeon-only, it is not
`gen_palace_wall_colors`, and it is not the potion level's own
record. What makes the potion level show it so plainly is that the
Prince goes from the wide drinking pose straight to standing still,
so the whole of the old sprite is left uncovered; a walking Prince
leaves only the sliver his next frame does not cover.

The player had simply never drunk an inversion potion anywhere else:
level 9's two are in rooms 7 and 10 and the level starts in room 11.

### 6. What could not have caught it, and what does now

* **No digest could.** `invert2`, the one capture of the inversion,
  is `shift+i` with the Prince standing -- 260 of 260 before and
  after this fix. Every score in the project is unmoved to the tick.
* **The page against the port could not.** The bug was in `src/pop`,
  so `tests/browser/page-vs-port.test.ts`-style comparison passes
  either way: measured, the new page-vs-port test over the seventy
  ticks around the flip passes with the ghost in.
* **What catches it** is the room drawn whole as ground truth, and
  the original's own pixel count:
  `tests/pop/potion-level.test.ts` (all six potions, 0 pixels left
  behind; reads 169 and 322 without the fix),
  `tests/pop/potions.test.ts` (`shift+i` while walking on levels 1,
  2, 9 and 13; reads 45 without it) and
  `tests/browser/potion-page.test.ts` (the page replaying `potion1`,
  required to draw the capture's own 572/872/855/803; reads 972 with
  the ghost).

### 7. And the blind cheat, which was the other half of the same line

`redraw_screen` is `if (is_blind_mode) { draw_rect(&rect_top,
color_0_black); } else { ... }` -- in blind mode the whole body is
skipped and the room is simply painted out. The port drew the room.
Both halves are in now, and `g.is_blind_mode` is saved and put back
around the forced `1` rather than written to nought, because the C
only reaches that line with it already nought.


## THE POTION ROOM: A SECOND PAGE, AND `PRINCE.EXE` PLAYS IT TOO

    https://rami5743.github.io/Prince/potion.html

    sounds     491 of 494   (was 466, and 417 at the top of the round)
    npm test   774 -> 786

One extra `LEVELS.DAT` record and all six potions are a step apart in
one corridor. **And the original reads it**: a copy of
`original/prince1` with that record written into it, mounted as C: by
`dosbox_oracle.py --game`, has `PRINCE.EXE` itself drawing the potion
corridor. The potions are capturable for the first time.

### 1. Why there had to be a level

`potion8` drinks level 8's blue one and it is the only potion in the
whole suite. The game has **one** feather -- level 7 room 1 row 2
column 8, with five tiles of open shaft between it and where the
falling entry drops the Prince -- and **two** inversion potions, in
level 9 rooms 7 and 10, where the level starts in room 11. So four of
the six kinds had never been drunk by anything, and when they were
finally read against the C both the feather and the inversion turned
out to have a line missing.

### 2. The level: `src/dat/potion-level.ts`

2305 bytes, hand-written, with a note on every tile. It stands in for
**level 2** and not level 1, which is measured and not a preference:
`control_crouched` holds the Prince down at the start of level 1 until
`sound_25_presentation` has finished (`need_level1_music` is
`current_level == 1`), so a potion page on level 1 opens with a Prince
who will not move for two seconds and looks broken. Level 2 is a
dungeon like level 7 (`levelType` is 0 for both), so the corridor is
built of the tiles the feather really stands on, and it is one
`shift+l` from the start for a capture.

    room 1                        room 2  (to its right)
    row 0  wall x 10              row 0  wall x 10
    row 1  . _ U _ H _ L _ _ _    row 1  _ F _ I _ O _ _ _ .
    row 2  wall x 10              row 2  wall x 10

The hurt one is **first** so that the heal behind it has a flask to
fill: case 1 is `if (hitp_curr != hitp_max)` and does nothing at all
when he is full, which is the C and not a fault.

**Three things cost a round each and are worth knowing before anyone
writes another level record:**

* **A blank door-link table hangs the game.** `get_doorlink_next(i)`
  is `doorlinks1[i] & 0x80 ? 0 : 1` -- bit 7 is "this is the last
  entry" -- and `do_trigger_list` is a `for (;;)` that walks `index++`
  until it finds one. A table of nought bytes never ends, and the
  level would not even load: `PopGame.start` never returned. The
  game's own levels pad the unused tail with `255, 0, 255, 0, ...`,
  so **0xFF is what an empty entry looks like**, and that is what the
  record is filled with.
* **`start_dir` is the direction he ends up facing**, not the one he
  starts in: `do_startpos` is `Char.direction = ~level.start_dir` and
  the start sequence turns him. 0 is right. It was wrong for a while
  and did not show, because the level was on slot 1 at the time and
  the level-1 music held him crouched through the turn.
* **A potion is drunk by standing in front of it and pressing
  Shift**, not by walking over it. `control_standing` (`seg005:0358`)
  is `if (control_shift2 == CONTROL_HELD && control_shift ==
  CONTROL_HELD && check_get_item()) return;`, `control_shift2` is a
  **latch** so the key has to go down again rather than be held, and
  `get_item` crouches him first -- the pickup happens on the *second*
  press, when `Char.frame` is already `frame_109_crouch`. A walk
  straight over six potions drinks none of them.

### 3. What each potion does, measured

`tests/pop/potion-level.test.ts` walks onto each one in turn and reads
the flash **between the tick and the frame**, because `render()` is
where `flash_if_hurt` counts it down:

    hurt       3/3 -> 2/3   sounds 18, 13        no flash
    heal       2/3 -> 3/3   sounds 18, 33        flash 4 x 2
    life       3/3 -> 4/4   sounds 18, 30        flash 4 x 4
    feather    is_feather_fall set, sounds 18, 39   flash 2 x 3
    inversion  upside_down set, sound 18 only    no flash
    open       nothing seen, sound 18 only       no flash

-- the C's own numbers, every one. `sound_18_drink` is the swallow in
`seq_78_drink` and every one of the six plays it; the inversion and
the open one play nothing else at all.

### 4. The page

`potion.html` is **the same bundle** as `index.html`. It sets
`window.__princePotionLevel` before `game.js` runs and `web/main.ts`
does two things with it: fetches `LEVELS.DAT` through
`levelsDatWithPotionLevel`, and opens on that level instead of on the
title. Nothing in `src/pop` knows about it -- the engine, the
renderer and the sound are the ones the real game uses, and
`original/prince1/LEVELS.DAT` is never written to. The page carries a
readout of hit points, the feather and the inversion, because the
green potion is the one effect in the game with nothing to see.

### 5. **The original plays it**, which is the part that matters

    npx tsx tools/dev/potion-game-dir.ts /tmp/potiongame
    python3 tools/oracle/dosbox_oracle.py --script <s> --out <o> \
        --cycles 20000 --game /tmp/potiongame --record run.mkv --fps 10

Thirty-two files copied and `LEVELS.DAT` written with the record in
place of level 2; the script is `wait 25; key Return; wait 4;
shift+l; wait 25`. At 45 seconds the emulator's screen is **the
potion corridor**: the Prince facing right at the left-hand wall,
three flasks a tile apart, `60 MINUTES LEFT` under the room -- the
same picture the port draws. `PRINCE.EXE` checks nothing about the
record beyond what it reads out of it, and the resource's checksum
(`(checksum + sum(payload)) mod 256 == 0xFF`) is worked out again
when the record is written.

### 6. And the capture: `potionsnd`, **25 of 25 noises, three times**

    sounds   491 of 494   (was 417 of 419 at the top of the round)

`potion1` is the probe: 1012 ticks of the potion level, sixteen
**careful steps** -- Shift+Right, which moves exactly one tile -- with
four taps of Shift after each. A careful step is tile-quantised, so it
does not care how late the emulator takes the key, and that is what
makes a potion capturable where `gate2c`'s six-tick window was not.
Swept for the harness's own slop, every combination of the two keys
going down and coming up a tick or two apart:

    shift down first, by 0, 1 or 2 ticks    all six drunk, every time
    right down first, by 1 or 2 ticks       the first potion lost,
                                            the other five drunk
    either key up first, by a tick          all six drunk
    the whole walk started 1..7 ticks late  all six drunk

-- so **Shift goes down two ticks before Right** and nothing else
needs care.

`soundcapture.sh` reads `"levels": "potion"` out of the spec, builds
the game directory with `tools/dev/potion-game-dir.ts` and passes
`--game`; `sound-report.ts` gives the port the same `LEVELS.DAT`
through `assetsFor(spec)`. Three captures scored **25, 24 and 25 of
their own total** -- exact every time. What the best one holds, with
`origin` 50.0:

    53.3 .. 54.2   four blips     the blue one, sound 13
    59.3 .. 61.8   2.548 s        the small red one, sound 33
    64.4 .. 66.8   2.404 s        the big red one, sound 30
    81.2 .. 99.9   **18.710 s**   the green one, sound 39
    101.1 ..       blips only     the upside-down one and the one
                                  that opens the gates, which play
                                  nothing but the swallow

against the tunes' own 2.484, 2.333 and 18.612. **The feather out of
the flask (18.710 s) and the feather out of `shift+w` (18.598 s)
agree with each other and with `IBM_SND1.DAT` to about a tenth of a
second**, which is the two halves of this round's work meeting in the
middle: `FEATHER_SOUND_TICKS` 223 is now measured twice, by two
different routes, against the original.

### 7. And a **picture** digest of it is `prandom`, which is measured

Before spending a capture on the eye as well as the ear, the question
`probe-seeds.ts` exists to ask: two runs of `potion1` at seeds 77776
apart, every tick's picture hashed.

    346 of 1012 ticks differ, from tick 0

It is the **bubbles**. `start_anim_potion` (`seg007:0852`) is
`curr_room_modif[tilepos] &= 0xf8; |= prandom(6) + 1`, so every flask
on the screen draws a phase the generator chose, `anim_tile_modif`
runs it on every room that is drawn, and the original seeds
`random_seed` from its own clock. A room with three flasks in it is
never the same picture twice. (Seeding *after* `PopGame.start`
instead of through it reads 137 of 1012, which is the same thing
measured wrong -- room 1's flasks were already seeded by then. The
346 is the honest number.)

So **the potion level is measurable by ear and not by eye**, and that
is the finding rather than a thing to go and fix: the only way to
make the pictures agree would be to mask the potion tiles out of
`digest.py`, which is weakening the one instrument that decides
whether a tick counts. `potionsnd`'s 25 of 25 is what this level has
to say, and it says it exactly.

## THE FEATHER SOUND: THE ORIGINAL GOES SILENT FOR EIGHTEEN AND A HALF SECONDS, AND A TUNE ENDS WHEN ITS SEQUENCE DOES

    measured   32093 of 33067   97%   (unmoved, to the tick)
    scenes      2442 of  2601   94%   (unmoved)
    sounds       466 of   469         (was 417 of 419)
    npm test     774 of   774         (was 769)

    feather1snd   49 of 50 noises   the first capture of a potion

The player said "there is still a problem with the feather sound" and
nothing more. Four things were measured and three of them say the
port is right; the fourth is the fault and it is in `Tune`.

### 1. The original really does go silent for eighteen and a half seconds

`sound_interruptible[39]` is **0** and `sound_prio_table[39]` is
**0x00**, so `play_next_sound` refuses everything else while the
feather is in the one channel. Nothing in the suite had ever heard
it, so a probe was built for it.

**`feather1`** is 686 ticks of level 1 with `shift+w` -- which is
`feather_fall()`, the same call `proc_get_object` case 3 makes -- on
tick 362, and the Prince walking back and forth on the flat of room 2
the whole way, so a footstep is asked for every four ticks. The
feather changes **no frame** of that run (measured: the trajectory is
identical tick for tick with the cheat and without), so what the
capture measures is the sound alone.

Three captures, 48, 48 and 47 of 50. What the best one has:

    58.564 .. 77.162   one unbroken noise, 18.598 s
    57.894 .. 57.900   the last footstep before it
    77.566 .. 77.579   the first footstep after it

-- against `IBM_SND1.DAT`'s own tune of **18.612 s** and the **223
ticks** `FEATHER_SOUND_TICKS` is set to. Fourteen milliseconds over
eighteen and a half seconds. And between those two instants the
capture has **nothing at all** while the Prince goes on asking for a
footstep every four ticks. So the port honours the table and the
table is the game: the silence the player hears after a feather is
the original's own.

### 2. `recordingSounds` and `sound-trace.ts` never replayed a probe's cheats

The picture side has called `game.cheat(key)` just before `step`
since the cheats went in. The **sound** side never did, so a probe
whose whole point is a cheat heard nothing: the port's channel
carried on with the footsteps the original refuses, and `feather1snd`
read 48 of 50 with the 18.598-second noise listed as "the original
alone". With the cheats passed through it is **49 of 50** and the
port's own feather is 30.167 .. 48.779 -- 18.612 s, the tune to the
millisecond. Every other sound probe is unmoved (title 212, gate1snd
94, level10bsnd 90, cutscene2snd 21), so **sounds 417 of 419 -> 466
of 469**.

The one it is short of is a four-millisecond click at 43.97.

### 3. A tune lasts to the end of its sequence, not to its last note

**This is the fault, and it is the feather's.** `midiNotes` stops at
the last note-off and `Tune.endsAt` was the last note's end, so the
page freed the one channel when the music stopped rather than when
the sequence did. A sequencer plays a sequence to its end, trailing
rest and all.

    sound   last note   end of track   the speaker's twin
    39       18.000       18.667         18.612   the feather
    54       22.794       24.294         24.737   the title
    24        3.200        3.600          2.967   the death
    56      121.700      124.700        120.042   the ending

So the feather's two arrangements are the same length to **55
milliseconds** once the trailing rest is counted, and three quarters
of a second apart without it -- and the capture's 18.598 settles
which is right. Measured in Chromium, the gap from `shift+w` to the
next footstep the page lets through:

    before   18.09 s
    after    18.70 s      the capture: 18.598, the port's clock: 18.583

`midiTune` and `speakerTune` return `{ notes, length }` now and
`midiNotes`/`speakerNotes` are wrappers, so `sound-common.ts` and
`scene-common.ts` are untouched. Only two speaker tunes have anything
after their last note -- 14 by 0.097 s and 18 by 0.174 -- and 39 is
not one of them, which is why `FEATHER_SOUND_TICKS` is the speaker
tune's own 18.612 and needs no change.

**`endsAt` alone could not do it**, and that cost an hour: `onended`
hung on the last node the loop made, which stops at the last *note*,
and `SoundPlayer.mayTake` reads `playing` directly and does none of
`isPlaying`'s lazy clearing. So the channel was freed at 18.09 s
however long `endsAt` said. `Tune` now adds one silent oscillator
that stops when the sequence does and carries `onended`.

### 4. The note cap was below the longest tune in the game

`Tune` caps a tune at a number of oscillators so a malformed file
cannot wedge the page, and the cap was **600**.
`sound_56_ending_music` is **1800 notes and 121.700 seconds**, and
six hundred of them is **42.000** -- the music under the hall of
fame, cut off a third of the way in, for the player who has just
finished the game. `TUNE_NOTE_CAP` is 2048 and
`tests/render/audio.test.ts` fails if any tune in the game ever
exceeds it. The next longest is sound 52 at 202.

### 5. What was measured and is **not** wrong, with its cost

* **The transition does not stall.** Drink the feather and then
  `shift+l`: **11219 ms** against the control's **11120**, three runs
  of each. `skipScene`/`select` call `effects.stopSounds()`, so the
  scene's own sound 27 takes the channel as usual and the player
  waits no longer than they ever did.
* **The tune is heard whole and once.** Every `AudioContext.start()`
  logged on a real keydown of Shift+W: **15 oscillators, all
  scheduled in one instant**, at 0.03, 1.36, 2.70, 3.36, 4.03, 5.36,
  6.70, 6.70, 7.36, 8.70, 9.36, 10.70, 12.03, 12.70 and 15.36
  seconds. No restart, no truncation, nothing dropped. The same on
  the deployed root `index.html` as on `web/index.html`.
* **It is not a loudness fault.** Rendered with `Tune`'s own
  envelope, the feather's RMS runs 0.024 to 0.076 a second where the
  footstep recording's is 0.049.
* **The MIDI is not a bad parse.** `MIDISND1.DAT`'s sound 39 is seven
  tracks of a single pitch each -- A1, C#4, F4, A2 -- which is an
  A-augmented chord held and re-struck, and the speaker's 248 notes
  of 75 ms are **the same chord arpeggiated**, 55, 69, 87, 110, 139,
  175, 220, 277, 349, 440. One machine sustains what the other
  ripples. The page plays the AdLib arrangement because it plays the
  better hardware's wherever there is one.

## LEVEL 1'S TWENTY-ONE ROOMS: 1011 OF 1011, AND THE ANCHOR HAS TWO DARK TICKS

    measured   32093 of 33067   97%   (was 31082 of 32056)
    rooms drawn by a capture   262 of 266   (was 250)

    rooms1   1011 of 1011   exact, first capture

`rooms1` was the one room tour with no digest. The round that built
the tours wrote it up as "two captures read 97 and 100 of about 995
-- and at an offset of +52 the same capture agrees with the port on
929 of its 997, so the run is right and the capture's tick nought is
not", re-split it eight ways, and kept the probe without the digest.
**It is the numbering, and the numbering has two separate faults.**

### 1. Level 1's Ctrl+A lands inside the first level's own title

`show_level` (`seg008:1831`) writes `LEVEL n` under the room for 24
ticks **and sets `is_show_time`**, so `N MINUTES LEFT` follows it for
24 more. That is four seconds of lit strip at the top of every
level, with one dark tick in the middle of it. Measured off the port
itself, the bottom strip's columns 100 to 220 over its first sixty
ticks, the same on levels 1, 2 and 9:

    #########################.#######################...........
    ticks 0..24 lit, 25 dark, 26..48 lit, dark from 49

Level 1 is the one level a chain reaches with **no `shift+l` in
front of it**: the script is `wait 25; key Return; wait 3;
key ctrl+a`, so Ctrl+A goes out three seconds after Return and the
restart happens while that four-second block is still on the screen.
`split_ticks.py --anchor-text 25` lines the run up on the first tick
the strip goes dark after being lit, and from the generator's own
`search from 27` that dark tick belongs to the level the game
started **before** the restart. The anchor read tick 14 and the
probe read 268 of 1000.

`recording_to_script.mjs` takes `--settle-l1` now; the default is
still 3, because every level-1 digest in the suite was taken with it
and the wait is spent out of the hour. `SETTLE_L1=9` on
`firstcapture.sh` or `recapture.sh` passes 9, which puts the restart
five seconds clear of the first level's words.

### 2. The one-tick gap is one video frame, and the splitter loses it

The dark tick between `LEVEL 1` and `60 MINUTES LEFT` lasts one tick
-- two and a half video frames at 30fps -- and `--hybrid` keeps for
each tick "the frame just before the next change", which drops a
one-frame dark altogether. When it is lost the anchor takes the
**next** dark tick, which is the port's 49, and the whole run is
numbered 24 ticks out.

So both anchors are tried, and `--after-blank` is dropped in the
same pass, because a restart whose redraw is quicker than a video
frame gives the blank search nothing and it walks off to the first
room change instead. Only when the ordinary four splits have agreed
on **less than half the run**, which costs nothing on a capture that
worked. Three tries of `rooms1`, six splits apiece:

    try 1  --after-blank  a25    93 of 992      98 of 997
           no blank       a49   703 of 1010    632 of 1011
           no blank       a25  1010 of 1011   **1011 of 1011**
    try 2  --after-blank  a25  1010 of 1010   1010 of 1010
    try 3  --after-blank  a25    96 of 993      96 of 993

-- so the blank search is the lottery (1010 on try 2, 93 to 98 on
tries 1 and 3) and the anchor with no blank search is not. **1011 of
1011**: 1012 ticks, forty room changes, all twenty-one rooms of
level 1, every one to the pixel.

**Twenty-one more rooms: 262 of the game's 266 are now drawn by the
original and by the port and the two pictures are the same picture.**
What is left is three of level 7's and room 5 of level 14, and both
have their account above.

## THE TWO POTIONS NOTHING HAD EVER DRUNK

    measured   31082 of 32056   97%   (unmoved, to the tick)
    scenes      2442 of  2601   94%   (unmoved)
    sounds       417 of   419         (unmoved)
    npm test     769 of   769         (was 760)

    page-port.ts --cheats   14 levels, 400 ticks, every picture, every sound

`potion8` drinks level 8's, which is the one that **hurts**, and it
is the only potion in the suite. The green one and the upside-down
one were written out of the C with unit tests only, and both had a
line missing.

**Where they are**, measured off `LEVELS.DAT` -- `tiles_10_potion`
with `curr_room_modif >> 3` for the kind, every tile of every room
of all fourteen levels:

    feather     level 7  room  1 row 2 col 8  modifier 27   the ONLY one
    inversion   level 9  room  7 row 1 col 7  modifier 32
                level 9  room 10 row 0 col 4  modifier 32   the ONLY two

Level 9's two are the **inversion** potions; the game's one feather
is level 7's, in room 1 -- the shaft the Prince falls into when the
level opens. `tests/pop/potions.test.ts` pins both lists.

### 1. The feather lasted one tick, because the port cannot hear

Vanilla's `is_feather_fall` is a flag, not a countdown. `timers`
(`seg003:0735`) is

    if (is_feather_fall) is_feather_fall++;
    if (is_feather_fall && (!check_sound_playing() ||
                            is_feather_fall > 225)) is_feather_fall = 0;

-- so the potion lasts **exactly as long as sound 39 is in the
channel**, capped at 225 ticks. The port has that line for line, and
headless `check_sound_playing()` is deaf, so the flag was cleared on
the tick after the potion was drunk. The potion did nothing at all.
Measured on level 7: hold Shift, grab the ledge of room 1, take
`shift+w`, let go --

    before   fall_y 3, 6, 9, ... dead on the floor of room 3, 0 hit points
    after    fall_y 1, 2, 3, 4 and no more; lands in room 3 with all three

`FEATHER_SOUND_TICKS` is **223**, the game's own tune measured out of
`IBM_SND1.DAT`: 18.612 seconds at twelve ticks a second, against
18.000 and 216 for `MIDISND1.DAT`'s arrangement. The capture plays
the speaker tunes -- that is how `show_title`'s first wait was
settled at 24.77 seconds -- and `DEATH_MUSIC_TICKS` 36 is sound 24's
speaker length (2.967s) by the same reckoning. So the feather runs
out on its sound, two ticks short of the C's cap.

**The rest of the port stays deaf and that is measured, not
assumed**: telling the game what is in the one channel took `gate1`'s
sound score from 90 of 96 to 26. The death music and the feather are
the two exceptions because the game reads their length back as a
timer; nothing else does.

### 2. A cheat was drained before `timers()`, one call too early

`play_level_2` is `guardhp_delta = 0; hitp_delta = 0; timers();
play_frame();` and `process_key` is four calls **inside**
`play_frame`, in `do_paused`. The port drained its queued cheats
before `timers()`, so a cheat that starts a timer had that timer
counted down in the tick it was asked for: `r` lost one of
`resurrect_time`'s twenty, and `shift+w` lost the feather
altogether -- `timers` ran `is_feather_fall++` and then cleared it,
because `play_next_sound` had not yet put sound 39 in the channel
for `check_sound_playing` to find. **Moved after `timers()`: every
run of the suite identical, 31082 of 32056 either way.**

`feather_fall` and `toggle_upside` are one function each now
(`seg000:15F8` and `seg000:15E9`), called by both `proc_get_object`
and the cheat, where the port had two copies of each body.

### 3. `need_redraw_because_flipped` was a line that was not there

`toggle_upside` is two lines and the port had one:

    upside_down = ~upside_down;
    need_redraw_because_flipped = 1;

and `draw_game_frame` (`seg000:920`) is a **three-way** branch where
the port had two:

    if (different_room) { ... redraw_screen(1); }
    else if (need_redraw_because_flipped) { need_redraw_because_flipped = 0;
                                            redraw_screen(0); }
    else { draw_moving(); draw_tables(); ... }

`play_kid_frame` (`seg000:1197`) sets the same flag when the Prince
dies while the screen is over, and the port wrote
`g.need_full_redraw = 1` there -- **a global nothing in `src/` ever
read**. Both are right now and `need_full_redraw` is gone from `g`,
so nothing can write to it again.

**And it changes no picture in this port, which is worth writing
down.** -- **THIS IS WRONG; see "THE GHOST OF THE PRINCE DRINKING"
at the top of this file.** The branch is right and the measurement
below is right as far as it goes, but it was taken with the Prince
**standing still**, which is the one case in which the missing black
fill inside `redraw_screen(0)` cannot show. With him walking the same
`shift+i` leaves 45, 92, 39 and 92 pixels of him behind on levels 1,
2, 9 and 13. What follows is kept as it was written.

The C updates the *screen* by rectangles --
`copy_screen_rect` inside two `flip_screen` calls -- so a tick that
turns the screen over leaves everything outside those rectangles
the old way up. The port composes the whole offscreen and flips it
on the way out, so it never had that picture to draw. Measured
directly: levels 1 and 9, forty ticks apiece with `shift+i` on tick
20, the full-redraw branch against the cheap one -- **no tick
differs, not one pixel**. The branch goes in because it is the C and
because the flag was a write-only global; it is not what the player
saw.

Also measured, and the comment in `resetGlobals` was wrong:
`set_start_pos` (`seg003:028A`) is `upside_down =
custom->start_upside_down`, which is nought, and `play_level` runs
`do_startpos` -> `set_start_pos` at the top of **every** level and
every restart. **The original never carries the inversion past a
level door.** Keeping `upside_down` across `resetGlobals` changed
nothing either way, because `startLevel` cleared it a moment later;
only `is_blind_mode` is kept now.

### 4. What case 4 does and does not do

`proc_get_object` case 4 is `toggle_upside();` and nothing else: no
`stop_sounds`, no `play_sound`, no flash. It is the only potion of
the six that makes no noise, and the port now has exactly that,
pinned. SDLPoP's `enable_super_high_jump`,
`fix_feather_fall_affects_guards`, `fix_quicksave_during_feather`
and `fix_feather_interrupted_by_leveldoor` are its own fixes and
stay out: vanilla's `fall_accel` slows **guards** too, and
`animate_leveldoor`'s `stop_sounds()` when the door finishes rising
really does cut a feather short.

### 5. No probe can drink either of them, and the line that blocks it

No cheat drinks a potion -- `do_pickup` is reached only from
`proc_get_object`, which `play_kid_frame` calls on a tile the Prince
is standing on. Level 7's feather is in room 1 at row 2 column 8,
and the Prince's falling entry grabs the ledge at **row 1 column 1**:
row 2 of that room reads wall, empty, empty, empty, empty, empty,
pillar, torch, **potion**, pillar, so the five tiles between him and
it are the shaft. He has to come back from room 2. Level 9's two are
rooms 7 and 10, neither of them the start room (11).

So the probe that would settle them is real play past a guard, and
`shift+w` is the next best thing: `process_key`'s Shift+W is
`feather_fall()`, the same call case 3 makes, so a capture of it
would measure everything but the tile. The inversion already has
one -- `invert2`, 260 of 260 -- and it is the cheat, which draws a
room whole and so never took the branch above.

## A GAMEPLAY FLASH IS A BLINK TRAIN, AND ESCAPE IS A FRAME ADVANCE

    measured   31082 of 32056   97%   (was 31080 of 32056)
    scenes      2442 of  2601   94%   (unmoved, to the frame)
    sounds       417 of   419         (unmoved)
    npm test     760 of   760         (was 755)

    addlife2     188 of   191  ->  190 of 191

Two bugs the player found by playing, and both were in the page's
own loop, where no tick score could see them. A third fell out of
measuring the first.

### 1. "Instead of a train of short flashes it is one long flash"

The gameplay flash does **not** go through `proc_cutscene_frame`.
`play_level_2` (`seg003.c:346`) is

    draw_game_frame();
    flash_if_hurt();         // seg003:0AFC -> do_flash(flash_color)
    remove_flash_if_hurt();  // seg003:0B1A -> --flash_time; remove_flash()
    do_simple_wait(timer_1);

and `do_flash` (`seg001.c:541`) is `reset_timer(timer_2);
set_timer_length(timer_2, 2); set_bg_attr(0, color);
do_simple_wait(timer_2)`. So the colour is up for the **first
sixtieth or two of a five-sixtieth tick** and off for the rest of
it, `flash_time` times over: eight blinks for a sword, four for a
life potion, three for the feather, two for a heal, eighteen for
Jaffar's death. The port's `flash()` put the colour up at the end
of `render()` and took it off at the top of the **next** `render()`,
so every flash was one solid block of colour as long as the whole
train.

**Measured, and the capture is sharper than the code.** A fresh
capture of `PRINCE.EXE` replaying `addlife2` (`shift+t` on level 2,
`flash_color` 4, `flash_time` 4), grabbed at **sixty** frames a
second, every frame's share of the screen that is pure black:

    frame  3380 3381 3382 3383 3384 3385 3386 3387 3388 3389 ...
    black% 43.1 43.1 43.1 43.1  0.0 43.1 43.1 43.1 43.1  0.0

**Four flashed frames -- 3384, 3389, 3394, 3399 -- one video frame
each, five apart**, which is one tick. A colour up for the full two
sixtieths would have to cover two sample instants of every pair, so
the emulator really shows it for about one sixtieth, and the page
takes it down on the first animation frame at least 12ms on (one
frame of a 60Hz display, two of a 120Hz one).

The flashed screen's commonest colour is **(170, 0, 0)**, which is
the hardcoded VGA red (42,0,0) through the DAC's
`(v << 2) | (v >> 4)`. Black goes 43.1% -> 0.0% and back, which is
the "every black pixel" model holding on a second capture.

`PopGame.render()` now only counts the tick down and says what
colour is owed (`flashColour`); `raiseFlash` and `dropFlash` are the
two halves, and `web/main.ts` presents **twice inside a tick** --
the flashed palette, then the plain one a sixtieth later.

**And it is worth two measured ticks, not nothing.**
`split_ticks.py` keeps for each tick the frame just before the next
change, which is one of the four *unflashed* frames above, so a
port whose tick picture carried the flash could never agree on a
flashing tick. `addlife2` 188 -> **190 of 191**, and that is the
only run in the suite that moved: 31080 -> **31082 of 32056**.

`tests/browser/flash.test.ts` counts it on the canvas the player
looks at: of 45 animation frames after a `shift+t`, **4 are flashed
and 41 are not**. With the take-down removed the same test reads
**20 of 45**, which is four ticks held end to end -- so the test
sees the bug and not merely the ticks.

#### The colour was the side-question, and both models agree

`set_bg_attr`'s commented-out original line is
`palette[vga_pal_index] = vga_palette[hc_pal_index]` -- the
hardcoded sixteen -- where SDLPoP's stand-in reads
`palette[hc_pal_index]`, the room's own. Measured for the four
colours a flash ever takes, on all fourteen levels:

    hardcoded   2=[0,42,0]  4=[42,0,0]  14=[63,63,21]  15=[63,63,63]
    levels 1-14 the same, every one, every entry

because `buildLevelScene` loads the EXE's own `vga_palette` into
entries 0 to 15 and the lowest sprite bank's base is 32. **The
difference is a no-op**; the capture's (170,0,0) confirms it from
the other side. `tests/pop/flash.test.ts` pins the table.

`flash_if_hurt`'s second branch stays out, as before: the captures
say the original does not flash red on a bare `hitp_delta < 0`, and
putting it in costs 14069 -> 14045.

### 2. Escape while paused advances one tick; it does not resume

`do_paused` (`seg000.c:1703`) is

    if (is_paused) {
        display_text_bottom("GAME PAUSED");
        is_paused = 0;
        do { idle(); delay_ticks(1); } while (! process_key());
        erase_bottom_text(1);
    }

and `process_key`'s own `case SDL_SCANCODE_ESCAPE` sets
`is_paused = 1` and returns the key. So the busy wait ends on **any**
key with `is_paused` already nought -- and if that key was Escape it
has just been set back to 1, so `play_frame` plays exactly one tick
and the next one pauses again.

`web/main.ts` had
`if (game.paused) { e.preventDefault(); game.paused = false; return; }`,
which swallowed the key before the page's own `process_key` could
see it, so Escape resumed like everything else. It now clears the
pause, asks for one tick (`stepOnce`) and **does not return**: the
key goes on through `commandKey`, Escape's case puts the pause back,
and an arrow that ended the pause is held in the tick that follows,
as `read_user_control` reads it.

**`src/pop` has no hole to fix, because it has no pause at all.**
`control_kid` there is `rest_ctrl_1(); read_user_control();
user_control(); save_ctrl_1();` with no `do_paused` between them,
and nothing in `src/pop` ever reads `g.is_paused` -- `PopGame.paused`
is a getter and a setter for the shell. A headless replay never
pauses, so the rule is pinned where it lives:
`tests/browser/pause.test.ts` presses Escape and watches
`__princeState().ticks` -- three Escapes, three single ticks, paused
after each, and then Space resumes.

And one smaller thing out of the same loop: **`do_paused` draws
nothing while it waits.** The page presented on every animation
frame while paused, which is `draw_game_frame` sixty times a second
-- counting the bottom text down and spending the flash. It
presents once on entering the pause now.

### 3. Looking around ran the game five times too fast

`tick()` ended with `if (!stepped && game && watchRoom !== null)
frame();` -- and `frame()` **steps the game**. So on every animation
frame that owed no step, with H, J, U or N held, the game took
another tick. Measured in Chromium:

    playing normally        24 ticks in 2s
    while looking around   120 ticks in 2s

Five times too fast, with the Prince off the screen where the
player could not see him do it. The line is gone; the watched room
is redrawn on the game's own tick, at most 83ms later, and
`__princeShow` still calls `frame()` once itself. (It also means
every browser test that drives the page through `__princeShow`,
which leaves `watchRoom` set, had been running at 60 ticks a
second.)

## THE ROOMS WERE THE UNMEASURED HALF, AND JAFFAR'S FLASH WAS HALF A SECOND OF WHITE

    measured   31080 of 32056   97%   (was 19478 of 20232)
    scenes      2442 of  2601   94%   (was 2440 of 2636)
    sounds       417 of   419         (unmoved)

    rooms drawn by a capture   262 of 266   (was 59 of 266)

    rooms2    1153 of 1153   rooms9    1104 of 1104
    rooms3    1060 of 1060   rooms10    749 of  750
    rooms4    1154 of 1154   rooms11   1104 of 1105
    rooms5     914 of  914   rooms12   1157 of 1157
    rooms6     626 of  627   rooms13    451 of  483
    rooms7    1109 of 1109   rooms14    221 of  221
    rooms8     967 of  967

    title        586 of   633  ->  588 of 633
    cutscene8    168 of   192  ->  168 of 180
    cutscene9    181 of   205  ->  181 of 194
    expired      190 of   229  ->  190 of 217

**Twelve room tours, 11602 ticks, eight of them exact.** Every room
of levels 2, 3, 4, 5, 6*, 8, 9, 10*, 11*, 12, 13* and 14 is now
drawn by the original and by the port and the two pictures are the
same picture (* one tick, or the account below). Only level 1's
twelve rooms, three of level 7's and room 5 of level 14 are left,
and each has a reason written down. (Level 1's twelve are drawn too
now -- `rooms1` 1011 of 1011, at the top of this file.)

### 1. `measured` had not moved in five rounds because it was not measuring the rooms

Walked every recording that has a digest and counted which rooms it
ever has on the screen:

    level  1  21 rooms  9 drawn     level  8  21 rooms   2 drawn
    level  2  24 rooms  3 drawn     level  9  24 rooms   3 drawn
    level  3  22 rooms  3 drawn     level 10  19 rooms   2 drawn
    level  4  24 rooms  4 drawn     level 11  23 rooms   2 drawn
    level  5  19 rooms  6 drawn     level 12  24 rooms   2 drawn
    level  6  14 rooms  6 drawn     level 13  11 rooms   9 drawn
    level  7  24 rooms  2 drawn     level 14   6 rooms   4 drawn

**59 of 266.** A recording of a level reaches the rooms a player
walks through and no others, so the original's picture of the other
two hundred and seven had never been put beside the port's at all.
Every gameplay shortfall has an account beside it and the accounts
are right; what they do not fix is that four fifths of the game was
never looked at.

**`tools/dev/room-tour.ts`** prints a depth-first walk of a level's
`roomlinks` as `h`, `j`, `u` and `n` cheats -- `next_room = room_L`,
`room_R`, `room_A`, `room_B` -- twenty-four ticks on each room, with
the Prince left standing where the level put him. `check_the_end`
does `loadkid`, `anim_tile_modif`, `start_chompers`,
`check_fall_flo` and `check_shadow`, so a room drawn this way raises
everything that room raises: its guard, its chompers, its falling
floors, its shadow.

**Round 14's rule does not bite here, and that is the point.** A
probe whose cheat has to land inside a few ticks cannot be captured,
because the emulator takes a cheat several ticks after the tick it
is asked for -- that is what killed `gate2c` on a six-tick window.
A tour does not care *when* the cheat lands: the room is still for
two seconds either side of it, so the ticks the emulator spends
reading the key are the only ones lost and every tick after it is
the same picture on both sides. Nothing is pressed, so there is no
key edge, no shift to choose and no key lottery; nobody fights, so
the only `prandom` left is the flames the digest masks.

`probe-seeds.ts` says so before a capture is spent -- two seeds
77776 apart, on each level's tour:

    levels 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14   0 ticks differ
    level 13                                          41 ticks differ

level 13's 41 being `check_fall_flo` on room 23, the same six floors
that are the whole of what `level13` and `jaffar` are short.

The first one captured:

    rooms2 try 1  gaps 46: 781 of 1146   clock 46: 782 of 1146
    rooms2 try 1  gaps 49: 170 of 1137   clock 49: 170 of 1137
    rooms2 try 2  gaps 46: 1153 of 1153  clock 46: 1153 of 1153
    rooms2 try 2  gaps 49: 1153 of 1153  clock 49: 1153 of 1153

**1153 of 1153** -- 1156 ticks, 46 room changes, all twenty-four
rooms of level 2, every one to the pixel, under both numberings and
both `--start` values. (The first try is the capture lottery this
file has measured five times over.) A tour costs about thirteen
minutes of DOSBox at two tries.

**The four that are not exact, and what each one is:**

* **`rooms8` was `startMinutes` and nothing else.** 944 of 967, and
  the twenty-three were ticks 26 to 48 in one block -- the block
  the README names under "The hour runs while the chain is
  skipping". Seven `shift+l` cost enough play that the capture
  arrives with `59 MINUTES LEFT` where a port given a fresh hour
  writes `60`. With `startMinutes` 59 it is **967 of 967**. Levels
  9 and up were given 59 from the start. **Give any new probe past
  level 8 the hour its capture arrived with.**
* **`rooms13`'s thirty-two are ticks 3 to 52**, `check_fall_flo`
  dropping six floors on room 23 -- the room level 13 starts in and
  the same `prandom` that is the whole of what `level13` and
  `jaffar` are short. Every tick from 53 on is exact.
* **`rooms7`'s 187** -- it is **1109 of 1109** now; what follows is
  how it read before the capture was numbered from the Ctrl+A and
  `set_start_pos` was wired in. See the top of this file.
  The Prince is
  dead on tick 17 and a tour played past a dead Prince scored **292
  of 1131** (342 at its best offset). Nothing a player can hold
  saves him: fifteen Shift hold lengths measured in the port, and
  he grabs and dies four ticks after the grab is let go every time
  -- hold 0 dies at 17, hold 40 at 52 -- and `shift+w` does not
  either, because the fall has already started. **`r` does:**
  `resurrect` on tick 24 leaves him alive in room 3 with three
  flasks, and it took the probe to **942 of 1129**. What is left is
  one offset: at **-20** the capture agrees on **1028 of 1129**,
  twenty ticks more than `exactAgreement` can walk, and the twenty
  are the death -- `Char.alive` does not advance while the death
  music plays and the port's `RESTART_PROMPT_DELAY` is a constant
  46.
* **`rooms14` won the game the first time.** Room 5 of level 14 is
  where `check_the_end` runs `end_sequence()`, so the tour's fourth
  cheat ended the level: the original played the ending while the
  headless port, which has no scene player, went on drawing the
  level -- 106 of 269, parting company on that exact tick with
  every tick before it drawn. `room-tour.ts --avoid 5` is the fix
  and the rebuilt probe is **221 of 221**. Its thirteen `shift+l`
  is the longest chain in the suite and two captures of it came
  back **nought at every offset from -600 to +600**, which is a
  lost skip; four tries found one.

**`rooms1` had no digest and that was a measurement.** (It has one
now, 1011 of 1011: see the top of this file. What follows is how it
read before the cause was found.) Two captures
read 97 and 100 of about 995 -- and at an offset of **+52** the
same capture agrees with the port on **929 of its 997**, so the run
is right and the capture's tick nought is not. Level 1 is the one
level a chain reaches with no `shift+l` in front of it, so Ctrl+A
is sent while the level is still coming up and DOSBox takes it
about four seconds late; `split_ticks.py --after-blank` then finds
a blank that is not the restart. Re-split eight ways -- both
numberings, with and without `--anchor-text`, `--start` 22 to 31 --
it reads 97, 100, 189, and 710 of 1006 with `--after-blank` dropped
and `--start 31.3`. Picking a `--start` by score is fitting the
instrument to the port, so the probe is kept and the digest is not.

And one thing to know about the instrument that picks the probes:
**`probe-seeds.ts`'s threshold is three hundred pixels**, which is
"bigger than a torch". It said 0 for `rooms8`, whose twenty-three
missing ticks were the hour's text, and for `rooms14`, whose ending
it could never reach because the port it replays has no scene
player to diverge into. It is a filter, not a proof.

### 2. Jaffar's flash was five cutscene frames of white, not five blinks

`proc_cutscene_frame` sets the background colour, waits
`delay_ticks(1)` -- two sixtieths -- and puts it back, all inside
one cutscene frame. The driver put it back in `step()`, where the
next frame is the next **cutscene** frame. `pv_scene` is the one
place that shows: `flash_time` is 5 and `cutscene_frame_time` is 7,
so the white stayed up for five cutscene frames end to end.

Port frames of the title, mean brightness:

    before   2103  83.9   2104..2120  168.5   2121  84.2
    after    2104 and 2107 and 2111 and 2114 and 2118 are 168,
             everything between them 84

A fresh capture of `PRINCE.EXE` reads 84 on every frame but two --
2097 and 2111 are 168 and 2098, 2101, 2104, 2108 and 2112 are not
-- which is five two-sixtieth blinks grabbed at sixty a second and
halved back to thirty by `--untear`. `remove_flash` is owed those
two sixtieths on the scene's own clock now. Title 586 -> 588, and
the player sees Jaffar conjure instead of the screen going white
for half a second.

### 3. Three scenes were measured past the end of their own scene

The round before this one found two scenes whose `frames` stopped
**before** the scene did, and wrote the rule down: "the port's own
last changing frame, and then a little". It swept the six cutscenes
upwards and none gained. Nobody swept downwards.

`exactAgreement` truncates to `min(capture frames, port frames)`, so
a `frames` past the end of the port's scene adds capture frames
nothing can agree with -- and for a scene reached by a chain of
`shift+l`, what the capture draws there is **the next level**:

    cutscene8   capture frame 429 (report 318): the whole screen
                changes and level 8 is up; the port's picture last
                changed on 309
    cutscene9   481 (report 357): level 9; the port's on 343
    expired     817 (report 464): the level again; the port's on 435

Swept, agreed of total:

    cutscene8   310: 168/180   318: 168/180   320: 168/182
                340: 168/191   380: 168/192  (was)
    cutscene9   350: 181/194   356: 181/194   360: 181/196
                420: 181/205  (was)
    expired     450: 190/217   460: 190/217   470: 190/222
                480: 190/229  (was)

**The title is left at 3100 and that is a measurement too**: its
capture stops at 2998 and the port's title is still changing at 3000
and 3060, so its last two frames are the clock, not the next level.

### 4. The hourglass sand is real, and it is the grab

Job 1 of the round was the title's twenty-one frames of hourglass
sand. A fresh title capture, every failing frame diffed against the
port's pixel by pixel with the digest's own mask on:

    13 frames   5-6 px at x 161, y 157..164   the hourglass sand
     5 frames   252-366 px, x 123..161, y 124..166   the princess
                and the hourglass, one DAC unit apart
    11 frames   ~41000 px, the whole screen, mean one shade apart
     4 frames   19460 px, mean 168 against 84   the flash, above
     4 frames   the scene's two ends

So the sand is really there, and it is **the cutscene-frame clock
against the drift the fade needs**, not a phase the port can fix.
`draw_hourglass` advances `hourglass_sandflow` once per cutscene
frame in the port exactly as in the C, and the same is true of the
capture -- but the capture's fade covers its 64 shades in 54 video
frames where the port takes 63, so `exactAgreement` walks the drift
to line the **shade** up, and at a drift that is not a multiple of
the cutscene frame the **sand** is then one step out. One frame in
three and a half, which is thirteen of the forty-four.

`cutscene2`'s own remainder, the same way, against a fresh capture:

    10 frames   252-359 px inside the princess's 17x43 box, one DAC
                unit apart -- the split palette burst `--untear`
                cannot undo
    13 frames   the whole screen, one shade apart
     3 frames   the first three shades of the fade-in

Two things were tried for it and both lose, with their cost:

* **stepping the fade clock after the generator instead of before**
  (so a fade starts in the frame it is asked for) -- title 586 ->
  **599**, and ending 805 -> 791, expired 190 -> 184, cutscene9 181
  -> 179: **2440 -> 2431** in all.
* **a flat cutscene fade rate re-swept** against the current
  `wait_time`-aware model (`POP_CUTSCENE_FADE_UNITS`, which only
  touches the `wait_time` nought fades):

      2 everywhere   2414      1.7143   2188
      1.8            2244      1.68     2185
      1.75           2194      1.6      2189

  against the kept `{6: 2, 7: 12/7}`'s **2440**. The capture's fade
  really is 54 to 57 video frames for 64 shades, read off a fresh
  `cutscene2` capture shade by shade (the brightest channel steps
  2,2,3,5,6,7,9,9,10,12,13,... over frames 33 to 86) -- and a port
  that runs at the capture's rate scores **worse**, because
  `exactAgreement` charges `SLIP` 2 for each change of drift and
  gains 1 for a match. A port slower than the capture needs a
  **monotone** drift and pays once per step; a port at the capture's
  own rate but a different phase has to wobble up and down, and
  wobbling costs more than it gains. The fade stays at two
  sixtieths a shade.

### 5. The emulator's cutscene frame is 3 video frames, where it keeps time

Measured off the digests by grouping each capture's changes (two
frames one apart are one cutscene frame torn in half) and taking the
gaps between groups:

    cutscene2    26 cutscene frames   every one of 24 gaps is 3
    cutscene4    26                   every one of 24 gaps is 3
    cutscene6    26                   3.083
    cutscene12   26                   3.364 (three frames changed
                                      nothing: gaps of 5 and 6)
    cutscene8    60                   3.357
    cutscene9    72                   3.309
    expired     102                   3.388, a regular interleave --
                                      3433433433434333433433343...

So `cutscene_frame_time` 6 is **exactly** three video frames where
the emulator keeps time, and the long scenes are the emulator
falling behind its own timer. Making the port keep the emulator's
time was tried again, scaling the cutscene frame alone (the fade
clock is separate now, which the three earlier attempts did not
have):

    scale 1.00, fade 2        (the port)      2440
    scale 1.13, fade 2                        1962
    scale 1.13, fade 1.695                    1757
    scale 1.09, fade 1.635                    1874
    scale 1.10, fade 1.65                     1855
    scale 1.20, fade 1.80                     1666

That is the fifth round to try the scene clock and the fifth to
lose. **Do not spend a sixth on it.**

## THIS ROUND, IN ONE BLOCK

    measured   19478 of 20232   96%   unmoved, to the tick
    scenes      2440 of  2636   93%   was 2029 of 2236
    sounds       417 of   419         unmoved

    title        560 of   633  ->  586 of 633    the cutscene fade's rate
    ending       446 of   477  ->  805 of 836    `frames` was half the capture
    expired      167 of   188  ->  190 of 229    `frames` cut the fade off
    cutscene12   119 of   135  ->  122 of 135    a better capture
    everything else frame for frame

Four sections follow, newest first. What moved a number: a cutscene
fade's rate is not in the code (`wait_time` nought) and the port was
running every fade at `fade_in_2`'s two sixtieths; and two scenes'
`frames` stopped the comparison before the scene did. What did not
move a number and is right anyway: `next_sound` in a scene,
`mid_draw` in the capture's splitter, and the page compared with the
port over the scenes, the cheats and all thirteen transitions.

**The scenes' remaining 196, with what each is:**

    title        47   the pv_scene fade-out: 21 frames differ by the
                      five pixels of hourglass sand, whose phase is
                      on the cutscene-frame clock and not the
                      shade's, and 2 by the princess one frame on.
                      30 of its 53 fade frames are exact to the pixel.
    ending       31   the two fades and the Prince running in
    expired      39   27 inside the scene, 12 after the port's own
                      last picture (frame 435 of 480)
    cutscene8    24   12 inside, 12 after (the port's scene ends at
                      309 of 380)
    cutscene9    24   13 inside, 11 after (345 of 420)
    cutscene12   13   the split burst
    cutscene2     7   the split burst, which costs about seven a
    cutscene6     7   cutscene and is what `--untear` cannot undo
    cutscene4     4   the control: no figure in a palette row on the
                      near side of the tear, and no capture lottery

`tools/dev/scene-moves.ts` prints the capture's per-frame moved box
beside the port's, which reads a scene's shortfall without the
capture's video being to hand; `scene-apart.ts` prints the same
comparison as runs. Between them, and a `--untear`'d capture kept
rather than thrown away, a scene's remainder can be read in minutes
instead of being written off as the clock.

## EVERY SCENE TAKEN FOUR TIMES AGAIN: ONE MOVED

    scenes      2440 of  2636   93%   (was 2437)
    cutscene12   119 of   135  ->  122 of 135

With `mid_draw` in the instrument and the cutscene fade's rate in
the port, all eight scenes with a chain were captured four more
times. **A rejection is a measurement, so every try is written
down:**

    title       558  556  538  518   against 586 -- kept
    expired     187  185  187  186   against 190 -- kept
    cutscene12  117  122  116    1   against 119 -> **122**
    cutscene8   161    1  159  161   against 168 -- kept
    cutscene9   181  179    1    1   against 181 -- tied, kept
    cutscene2   115  122  118  119   against 129 -- kept
    cutscene4   130  130  130  130   against 131 -- kept
    cutscene6   123  116  122  114   against 128 -- kept

Two things worth keeping out of that table:

* **`cutscene4` is the control and it has no lottery at all**: 130,
  130, 130, 130. It is the one scene of the six with no figure in a
  palette row on the near side of the tear. Every other scene's four
  span seven to twenty frames, which is what the lottery is worth.
* **`expired` reads 185 to 187 four times out of four** against the
  190 that is pinned, so the 190 is a good capture rather than a
  lucky one, and the twenty-seven frames it is short of are not the
  grab.

`mid_draw` takes the title's denominator from 633 to 611-621 and
leaves the cutscenes' at 135, which says what the torn screen is:
it happens where a figure is moving across the princess room in a
scene long enough for the emulator to fall behind, and the
thirty-second cutscenes never do it.

## THE PAGE'S SCENES, AGAINST THE PORT'S, PICTURE FOR PICTURE

`tools/dev/page-port.ts` required the page and the headless port to
draw the same picture on every tick of fourteen levels. It now does
the same for the **scenes**, which is where four of the last six
bugs the player met lived, and for the **cheats**:

    npx tsx tools/dev/page-port.ts --scenes --cheats --entries

    level  1 .. 14   pictures 600 of 600   sounds equal
    scene title      pictures 504 of 504 port / 504 page
    scene 2,4,6,8,9,12,expired,ending   every one exact

Fourteen levels at six hundred ticks with all eleven cheats thrown
in, all nine scenes and all thirteen transitions: the page draws the
port's picture and asks for the port's sounds, everywhere.
`tests/browser/page-vs-port.test.ts` runs the scene before level 2
and the arrival at level 7 in `npm test`.

And `--entries` enters each level **by finishing the one before**:
Shift+L, the scene, `play_level`'s wait on the sound, `nextLevel`'s
carry and `select`, against the headless port given the carry it
worked out for itself off its own run of the level before.

    entry  2 .. 14   arrived  pictures 150 of 150, every one

**All thirteen, exact.** That is the path no digest has ever
covered -- every probe enters a level by the skip chain or a cheat
-- and it is how level 7's black screen hid for the whole life of
the port. The alignment is searched over nine starting points
because the transition has to run unpaused (the scene, the sound
wait and `select` are all on the page's `requestAnimationFrame`
clock) and the loop plays a few ticks of the new level before the
poll can stop it; `__princeState().ticks` is the loop's own count
and is not the number of `step`s, which cost an hour. Nothing is
excused by the search: agreeing needs a hundred and fifty identical
pictures.

A scene cannot be compared the way a level is, and the three things
that had to be settled first are the finding:

* **A scene's clock is the sound's.** `show_title`, `load_intro` and
  `pv_scene` all stop at `while (check_sound_playing())`, and the
  page has to be muted to be stepped at all -- `__princeSceneStep`
  runs the scene's clock a hundred and fifty times faster than the
  audio device's. Muted, the page's channel is always empty, so the
  title's three waits collapse: its holds read
  `65,102,33,135,117,301,47,80,132,17,60,181` against the port's
  `65,102,33,135,117,291,301,85,332,80,132,17,7,18,507,60,40`, and
  the ones that differ are exactly the three sound waits. So the
  headless side is made **deaf** too and the two runs are the same
  run. What the waits should be is `scene-report.ts`'s business,
  against the original.
* **The princess room's stars and torches are `prandom`.** Measured
  rather than derived: four runs of `cutscene_2_6` at four seeds,
  two hundred frames apiece, differ on **194 pixels** and they fall
  in three blocks -- `x 16..24 y 97..128` (the six stars),
  `x 96..104` and `x 214..222`, both `y 99..115` (the two torches).
  That is `PROOM_RANDOM_RECTS` in `seg001.ts`, and it is the same
  thing `digest.py --cutscene` masks against the original. Without
  the torches the comparison was **ordered**: playing the title
  first made every cutscene after it differ, which looked like
  state leaking out of `pv_scene` and was forty-four pixels of one
  torch flame.
* **A scene that ends starts another one.** `endScene` runs whatever
  was behind it, which for a scene asked for by hand is
  `restartGame` -- the title. So `running` stays true and, for the
  title, even the scene's *name* does not change. `__princeSceneState`
  carries a `count` of scenes begun now, and the comparison stops
  when that moves.

Two hooks went into the page for it, both narrow: `__princeSceneHash`
(a fingerprint of the picture a scene has on the screen;
`CutscenePlayer.render()` draws nothing, so unlike `__princeFrame`
for a level it can be asked for at any time without changing what it
measures) and `__princeSeed`. `__princeCommand` is the third: it is
`process_key` by name rather than by a `KeyboardEvent`, so the cheat
comparison drives the page's **own** path to `game.cheat` and not a
second copy of the switch.

## TWO SCENES WERE BEING CUT OFF BEFORE THEY ENDED: SCENES 2055 -> 2437

    measured   19478 of 20232   (unmoved, to the tick)
    scenes      2437 of  2636   (was 2055 of 2236)   92%
    sounds       417 of   419   (unmoved)

    ending       446 of   477  ->  805 of 836   94% -> 96%
    expired      167 of   188  ->  190 of 229   89% -> 83%

A scene spec's `frames` says how many video frames of the port to
play. It is **not** a free parameter: `exactAgreement` truncates the
comparison to `min(capture frames, port frames)`, so a `frames` that
stops before the scene does throws away every frame after it,
agreed or not. Nobody had ever checked one against the scene's own
length.

* **`expired`** asked for 420 and the port's picture last changes on
  **435**. `time_expired` is `fade_in_1`, 102 cutscene frames at six
  sixtieths and `fade_out_1`; the fifteen frames cut off are the end
  of that fade and the capture agrees with twenty-three of the
  changes in them. **167 of 188 -> 190 of 229.** Past about 480 the
  capture is drawing the next level, which the port is not being
  asked to play, so the denominator grows and the agreed count does
  not: 480 is where it plateaus.
* **`ending`** asked for 1600 against a capture 3737 frames long and
  an offset of 1060, so **barely half of it was being looked at**.
  The scene never ends -- `input_str` spins on the hall of fame's
  cursor and nobody types, in the capture or in the port -- so the
  comparison runs as far as the capture does.

      frames 1600   446 of 477   94%
      frames 1800   512 of 543   94%
      frames 2100   612 of 643   95%
      frames 2500   745 of 776   96%
      frames 3000   805 of 836   96%   and it plateaus

  Three hundred and fifty-nine frames, and the **percentage rises
  the whole way**, which says what they are: the blinking underscore
  the round before this one put back into the font, drawn right for
  two thousand frames nobody was counting.

The six cutscenes and the title were swept the same way and none of
them gains a frame -- their `frames` already cover their scenes
(`cutscene8` ends at 309 of 380, `cutscene9` at 345 of 420) and
anything past the end is the next level. So the check is: **the
port's own last changing frame, and then a little**, and `frames`
beyond that buys nothing and costs percentage.

## A CUTSCENE FADE HAS NO CLOCK: SCENES 2029 -> 2055

    measured   19478 of 20232   (unmoved, to the tick)
    scenes      2055 of  2236   (was 2029 of 2236)   91% -> 92%
    sounds       417 of   419   (unmoved)

    title        560 of   633  ->  586 of 633   88% -> 93%

### 1. `fade_in_1` passes `wait_time` **0**, and SDLPoP writes it `/*0*/ 2`

`title` was the largest single shortfall left and had never had a
frame-level reading. `tools/dev/scene-apart.ts` puts the whole of it
in one block:

    same  capture 2316..2380  port 2315..2373  (20)
    DIFF  capture 2387..2448  port 2380..2441  (49)
    same  capture 2449..2998  port 2442..2991  (63)

Forty-nine of the seventy-three, in one place, and the place is
**`pv_scene`'s fade-out** -- the princess's room inside the title,
the last thing before the story screen. A fresh capture reproduces
it to the frame (DIFF 2387..2448) so it is not the capture's.

Both sides start that fade on the **same video frame**, 2374. The
mean brightness of every frame of it, the port's beside the
capture's:

    port  83.2 80.6 78.0 75.4 72.9 70.3 67.8 65.2 62.7 60.1 ...
    cap   83.2      78.1 75.5 72.8 70.3 67.7      62.7 60.1 ...

Matched shade by shade against the port's own frames the capture
reads 0, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, ... -- **63 shades
over 54 video frames, stepping 1, 1, 1, 1, 1, 2 without a break.**
Seven shades every six frames, where the port does one a frame. And
forty frames later, in the same capture, `fade_in_2` of the story
screen steps **one shade per video frame exactly**, which is what
the port does to every fade in the game.

Two different rates in one capture, and the C says why in a comment
it has had all along:

    fade_in_2:  make_pal_buffer_fadein(surface, which_rows, 2)
    fade_in_1:  make_pal_buffer_fadein(surface, 0x6689, /*0*/ 2)

`/*0*/` is the **original's** value, kept beside SDLPoP's
substitution. With nought there is no timer between two shades at
all -- `fade_out_frame`'s `do_simple_wait(timer_1)` returns at once
-- and `proc_cutscene_frame`'s inner loop, which has no
`delay_ticks(1)` while fading, spins until the cutscene frame's own
timer stops. **So a cutscene fade is not on a clock. It runs at
whatever rate the machine can compute and write a palette**, and the
port had been reading `wait_time` 2 out of SDLPoP and applying it to
every fade in the game.

`ceil(cutscene_frame_time / 2)` shades fit in a cutscene frame,
which is the arithmetic of the `do..while`:

* at **6**, which every scene but one uses, three shades in six
  sixtieths -- the same two sixtieths a shade `wait_time` 2 gives,
  which is why the six cutscenes never showed this;
* at **7**, which `pv_scene` switches to before Jaffar conjures,
  four in seven: 1.75 sixtieths a shade against the capture's 1.714.

`CUTSCENE_FADE_RATE` in `src/pop/cutscene.ts` is `{6: 2, 7: 12/7}`
-- the capture's numbers, with `t / ceil(t / 2)` as the fallback for
a frame time no capture has measured. `scr.fade_start` takes the
`wait_time` now, so `fade_in_2` and `fade_out_2` keep their 2.

**Flat rates were swept again and every one of them loses**, because
a flat rate moves the six cutscenes' fades as well:

    2      (every fade, the old port)   scenes 2029 of 2236
    1.7143 (every fade)                        1818 of 2232
    1.75   (every fade)                        1833 of 2230
    1.6667 (every fade)                        1829 of 2221
    {6: 2, 7: 1.75}                            2044 of 2236
    {6: 2, 7: 12/7}  (kept)                    2055 of 2236

That is the fourth round to touch the fade rate and the first to
win, and what it had that the other three did not is the `/*0*/`:
the rate was never a constant to be fitted, it is **two** constants
and only one of them is in the code.

### 2. `next_sound` is a scene's queue too, and the port had none

`play_sound` does not play anything. In a level `PopGame` has had
the queue since the gate stuttered; in a **scene** the line is in
`proc_cutscene_frame`:

    if (!check_sound_playing()) {
        play_next_sound();
    }

-- so a sound asked for while another is still in the channel is
**held** until the channel is free instead of cutting it off, and
`next_sound` survives from one cutscene frame to the next because
`play_next_sound` is the only thing that clears it. The port's
cutscene `play_sound` went straight to the channel. `pv_scene` asks
for five sounds and two of them land on top of a sound already
playing.

`show_title` and `end_sequence` are the exception and the C says so
by name: their three sounds go through `play_sound_from_buffer`, and
those three stay immediate.

**It moves no score, and it is measured both ways: 2055 of 2236
either side of it.** The call site and the first
`play_next_sound` after it are separated by no timer wait, so a
queued sound starts on the same sixtieth the old code started it on
unless something else is in the channel. What it fixes is the
cutting-off, which only an ear can hear.

### 3. Thirteen frames of the title are the capture's screen tear

`scene_frames.py --untear` dropped frames where the grab caught the
original's **palette** write half done. There is a second tear and
it is the **picture**. `draw_proom_drects` composes the princess
room offscreen and copies the rectangles that changed one at a time,
and in DOSBox that copy straddles a video frame:

    cap 1885   into (182,150)-(212,166)   out (97,99)-(221,149)
    cap 2205   into (161,150)-(214,166)   out (97,99)-(221,149)
    cap 2307   into (161,150)-(319,165)   out (16,99)-(319,149)

-- the split at row 150 every time. Each of the thirteen is
**exactly the top of the frame before over the bottom of the frame
after, to the pixel** (`B == topA + bottomC`, 0 px differ, all
thirteen), which is a picture neither of them ever held.

The rule is `mid_draw` in `scene_frames.py`: every row the frame
owes to the one after it is above every row it owes to the one
before it. Nothing else is needed -- outside those rows the frame is
one of its neighbours, so the frame is the composite. `MIN_TEAR` is
16 pixels a side, because a tear of one or two pixels on row 99 is a
torch flickering between two screen writes and the digest masks the
princess room's torches, so such a frame hashes the same as the
whole one and is worth keeping. Without the threshold it drops 30
frames and 17 of them were agreeing; with it, on the same capture:

    no mid_draw   559 of 637
    mid_draw      559 of 624      the same agreed, 13 fewer misses

It needs a fresh capture to land, so the digests in the repository
do not have it yet.

## THE ENDING'S CAPTURE WAS PRESSING ITS OWN KEYS: SCENES 1874 -> 2029

    measured   19478 of 20232   (unmoved, to the tick)
    scenes      2029 of  2236   (was 1874 of 2238)   84% -> 91%
    sounds       417 of   419   (unmoved)

    ending       325 of   480  ->  446 of 477   68% -> 94%
    cutscene2    122 of   135  ->  129 of 136
    cutscene6    110 of   135  ->  128 of 135
    cutscene12   110 of   135  ->  119 of 135

### 1. `do_wait` takes any key, and the spec was sending three

The round before this one fixed the ending's chain by sending the
four `h` **three times over, twelve seconds apart** -- the chain
drifts, and a group spent on a level that is not up yet is lost.
Three captures then reached the ending and scored 281, 303 and 285
of about 555, none of them beating the pinned 325 of 480, and the
remainder was written up as the emulator's clock wandering past
`exactAgreement`'s sixteen frames over eighteen hundred frames.

**It was not the clock, and the frames say so in one picture.**
`tools/dev/scene-apart.ts` is new -- `scene-report --first` prints
the first forty misses, which tells you nothing about a scene that
is a hundred and fifty short; this prints the comparison as *runs*.
On the ending it printed one solid block:

    same  capture 396..799    port 380..786    (63)
    DIFF  capture 800..1150   port 787..1137   (175)
    same  capture 1151..1153  port 1138..1140

A run that goes wrong and then comes **right again** is not a clock
running away. Put the two frames side by side and the capture is
showing the landscape where the port is still showing the story
text. Counting the frames each side holds each picture:

                            text   landscape
    the capture (3 groups)   342          22
    the port                 450         121

and 450 and 121 are `pop_wait(900)` and `do_wait(start_timer(240))`
at a sixtieth apiece, to the frame. So the **capture** was short.

`do_wait` is
`while (check_timer(timer) == 0 && do_paused() == 0) idle();`
and `do_paused` ends on `return key || control_shift`: **any key
ends it**. `disable_keys` guards `proc_cutscene_frame` and nothing
else. The third group of `h` lands about twenty-eight seconds after
the first, by which time `end_sequence_anim` is long over, and it
walked straight into the story text and cut it off -- and the one
after it cut the landscape off.

So the spec sends **one** group of four `h`, and waits **45
seconds** after the last `shift+l` instead of twenty. A long wait
can only ever be too long: the chain can lag, it cannot run early.
Three captures that way:

    text 454 frames, landscape 123   (the port: 450 and 121)
    355, 362 and 372 of about 477

against the 325 of 480 that was pinned. `remMin` was swept 55 to 60
against the new capture and **58 still wins**, 372 against 256 for
every other value.

**The lesson is the one this file keeps learning.** A capture is the
authority, but only about what it captured. A script that presses
keys to reach a scene is pressing them *into* the scene as well, and
every wait in `seg001.c` that is a `do_wait` will take them.

### 2. `_` is eight bytes `PRINCE.EXE` does not hold

With the keys out of the way the ending's remainder was a comb: one
frame in three wrong, from the moment the hall of fame asks for a
name to the end of the capture. The round before this one read that
as "the port's six-sixtieth blink is half a period out".

It is not a phase. Diffed pixel by pixel, the capture changes
**six** pixels as the cursor blinks -- x 72 to 77 on row 92, a clean
bar -- and the port changed **thirteen**, on rows 86 to 91.

`draw_text_cursor` is `draw_text_character('_')` and nothing else,
so this is the font. The 1527 bytes at `FONT_OFFSET` are SDLPoP's
`hc_font_data` -- the DOS game's own font, glyph for glyph -- byte
for byte, **except for eight of them**: 1008 to 1015, the eight rows
of `_`. Where the font has `00 00 00 00 00 00 00 fc` the release has
seven bytes of a far-pointer table, `f0 03 b2 00 08 00 b0`, and one
byte fewer, with the glyph's `flags` word reading 0xF001 where every
other glyph in the font has 1. Both `PRINCE.EXE` and `UNCRKD.EXE`
have it, and the clean glyph is nowhere in either.

That missing byte is also the whole of why every offset in the table
**from the backtick on is one past the glyph it names**, which
`looksLikeGlyph` has been stepping over since the font went in.
Nobody had asked why.

`UNDERSCORE_ROWS` in `src/render/font.ts` puts the eight rows back
where the glyph's `flags` word says the release has written over
them. **372 -> 446 of 477**, and the player who has just finished
the game types their name against an underscore instead of a smear.
`tests/render/font.test.ts` pins the glyph.

### 4. A scene has a capture lottery, and it is worth twelve frames

`cutscene2` scored 122 of 135 and `cutscene6` and `cutscene12` 110,
on one untorn capture apiece -- and all three are the **same scene
from the same generator**, `cutscene_2_6`. Twelve frames between two
runs of one piece of code wanted an account.

Put the failing frames side by side, with the digest's own mask on,
and the whole of `cutscene6`'s fade-in difference is **359 pixels in
the princess's own 17-by-43 box, one DAC unit apart**, on one frame
in three; plus two frames in twenty-five where the capture has no
picture matching the port's at all, which is the fade running 7
shades per 6 video frames against the port's 6. Both are the fade's
beat against the grab -- the same thing `--untear` was built for, and
the half of it `--untear` cannot undo: when a palette burst is split
so that **both** sixtieth-frames of a step carry row 9 one shade out,
there is no whole frame in the pair to keep.

Which half of a step the burst falls in is where DOSBox happened to
start, so it is different in every capture. Measured: four captures
of `cutscene6`, same script, same port, minutes apart --

    110   116   118   128    of 135

-- which is the twelve frames, and more. `tools/oracle/README.md`
used to say a scene had no capture lottery because no key is pressed
in one. It has one, it is the grab, and `scenecapture.sh` takes
**four** tries by default now rather than two, as `recapture.sh` has
since the round that measured 314, 315, 456 and 529 for `9b60bf3a`.

Every scene still short was then taken four more times, and **every
try is written down, because a rejection is a measurement too**:

    cutscene2    129  121  122         against 122  ->  **129**
    cutscene6    128  116  118         against 110  ->  **128**
    cutscene12     1  118  119  109    against 112  ->  **119**
    cutscene8      1  166    1         against 168  --  kept
    cutscene9    169    1  176    1    against 181  --  kept
    title        506  525  517  544    against 560  --  kept
    expired      157  166  167  163    against 167  --  kept

Seven captures of `cutscene12` now span **109 to 119** and four of
`title` span 506 to 544 against a pinned 560, so four tries is the
floor and not a guarantee. `cutscene8`, `cutscene9` and `cutscene12`
lose a `shift+l` about one try in three, which reads as 1 of 48 and
is unmistakable.

### 5. The page, against the port, tick for tick

`page-walk.ts` asks of the page whether a sound happened and whether
the picture moved. That is a floor. **`tools/dev/page-port.ts` is the
ceiling**: the same inputs into the page and into the headless
`PopGame`, with two things required to be equal on every tick --

* **the picture**, a hash of the very surface `display.present` was
  given against a hash of what `PopGame.render()` hands back, which
  is equality to the byte;
* **the `play_sound` calls**, in order. Not what was *heard*: that is
  the audio device's clock, and a page stepped as fast as Chromium
  can go hears a different set from one played at twelve ticks a
  second. What the byte-code asked for is the game.

    npx tsx tools/dev/page-port.ts [--levels 1,2] [--ticks 400]

    level  1  pictures 400 of 400  sounds 23 page / 23 port
    ...
    level 14  pictures 400 of 400  sounds 53 page / 53 port

**Fourteen levels, 5600 ticks: every picture the same picture, every
sound the same sound.** So the page is not diverging from the port
today -- and the next time it does, this says so on the first tick
instead of after a player reports it.
`tests/browser/page-vs-port.test.ts` runs two of the fourteen (level
1, and level 7 because its opening is the one that differs) in
`npm test`.

Three things the page needed before it could be compared at all, and
all three are the kind of thing that makes a comparison a lie:

* **`__princeEnterLevel`**, because `__princeShow` is a *look*: it
  also forces `drawn_room` through `drawRoomNow`, which runs
  `check_the_end` a second time. The headless port has made no such
  call.
* **a hash from `__princeStep` itself**, because `__princeFrame()`
  is `game.render()` *again* -- and `render` is `draw_game_frame`: it
  ticks the words under the room, takes the flash off and calls
  `play_next_sound`. A comparison that read the picture that way
  would be changing the thing it measured. (`page-walk.ts` does read
  it that way, every fifth tick, which is worth knowing when reading
  its sound counts.)
* **the palette read after `render()` and not before it**, which
  `__princeStep` had the wrong way round: `flash()` puts the colour
  up inside `draw_game_frame`, so a palette read first is the palette
  of the tick before.

### 6. What is left of the ending

Thirty-one frames of 477: the two fades -- `fade_out_1` into the
story screen and `fade_out_2` into the hall of fame -- and the
Prince running in. The 175-frame block is gone and so is the comb.

## THE TEAR WAS THE GRAB, AND IT IS GONE: SCENES 1610 -> 1874

    measured   19478 of 20232   (unmoved, to the tick)
    scenes      1874 of  2238   (was 1610 of 2222)
    sounds       417 of   419   (unmoved)

### 1. `scene_frames.py --untear`: the instrument again, for the fourth time

The round before this one proved **where** the scenes' 612 went --
the grab lands inside the original's own palette write, after row 9
and before row 10, and the three worst cutscenes are the three with
a princess in row 9. It then said the pictures were right and left
the score where it was. Explaining a shortfall is not recovering it.

**The burst is about half the step, and at sixty frames a second
its two halves fall in two different frames.** `fade_in_frame`
computes the whole palette and writes it in one go, `set_pal_arr`
per row in the order of `which_rows`. On the hardware that is 768
`OUT`s, under a millisecond of a fourteen-millisecond frame; in
DOSBox an emulated `OUT` to 0x3C9 costs enough that the write takes
about sixteen milliseconds of the twenty-eight the fade spends on a
shade. So the emulator really does put a half-written palette on the
screen, for half of every step, and a thirty frames a second grab
lands on it about half the time.

Grabbed at sixty, one capture of `cutscene2`, pixels changed per
frame through the fade-in:

    72   393 px  rows  99-166   the early rows: a shade on
    73  2659 px  rows  21-191   the rest of the burst: the frame whole
    74   393 px                 the next burst, half done
    75  3413 px                 whole again

A frame is mid-burst when the change **into** it is a plain palette
step -- no pixel moved by more than one DAC unit -- and is less than
half the size of the change **out** of it. Rows 13 and 14 are the
room, which is most of the screen, so the far side of a split burst
is always the big one. `--untear` drops those frames and renumbers
what is left back to thirty a second, so **nothing downstream
changes**: the digest, the spec's `frames`, `start` and `range`, and
the replay's thirtieth are all as they were.

Three ways of reading the same sixty-frame grab of `cutscene2`:

    the pinned 30fps capture                  73 of 136
    60fps, every changed frame, halved        62 of 136
    60fps, untorn, halved                    112 of 135
    60fps, untorn, port stepped at a 60th     95 of 153

The last is why the halving stays and why `SceneSpec.fps` and
`playScene`'s `stepMs` are there but unused by any spec: a port that
draws twice as often has two identical frames per shade and gains
nothing by it, while losing on everything that is not a fade.

**Every scene retaken, with no change to the port:**

    title       512 of 616  ->  560 of 633
    cutscene2    73 of 136  ->  122 of 135
    cutscene4   131 of 136  ->  131 of 135   the control
    cutscene6    75 of 136  ->  110 of 135
    cutscene8   121 of 188  ->  168 of 192
    cutscene9   136 of 206  ->  181 of 205
    cutscene12   70 of 136  ->  110 of 135
    expired     167 of 188  ->  167 of 191   kept the old capture
    ending      325 of 480  ->  unchanged; see below

`cutscene4` is the control and it does not move: it is the only one
of the six with no figure in a palette row on the near side of the
tear, it was already at 96%, and it stays there. The three that sat
at 54% are the three with a standing princess in row 9.

`expired`'s two tries scored 167 of 191 and 162 of 184 against the
pinned 167 of 188 -- the same agreed count on more frames -- so its
old capture is kept. Its figures are the hourglass, which the mask
covers, so there was nothing there for the tear to take.

**The ending's chain is fixed, and it still keeps its old capture.**

The first two tries scored 0 of 282: the game was still standing in
a level room at 290 seconds where a capture that reaches the end has
the princess's room. The cause is measurable and is not a lost
`shift+l` -- the chain simply **drifts**. At 214 seconds the Prince
is walking into a palace level's exit door and at 232 a fresh level
is starting with `59 MINUTES LEFT` under it, so the last skip landed
about eighteen seconds after the script expected it and the four `h`
were spent on a level that was not up yet.

So the four `h` are now sent **three times over, twelve seconds
apart**. A group of four reaches room 5 from any of 4, 3, 2 and 1,
and once `end_sequence_anim` is running it sets `disable_keys`, so
the groups that follow are ignored. Three tries, three captures that
reached the ending: **281, 303 and 285 of about 555**.

And the best of them is still **not** as good as the 325 of 480 that
is pinned, so the old capture stays. What the new ones say is where
the ending's remainder now lives:

* the first eight hundred frames are all but exact -- five misses in
  the whole of the fade, the room, the embrace and the running in;
* and then the two sides part company altogether. Port frame 787
  against capture 1091 differs on **25855 pixels** and 788 against
  1092 on **40949** of 64000, which is not a cursor and not a shade:
  it is two different pictures. Over eight hundred frames the
  emulator's clock has wandered past `exactAgreement`'s sixteen and
  everything after it is lost.
* `remMin` was swept 53 to 58 against the new capture in case the
  longer chain had spent more of the hour: 58 still wins, 303
  against 228 for every other value.

`exactAgreement`'s window **stays at sixteen**. It is the one thing
that decides whether a picture counts, and the round before this one
measured what widening it buys (range 32: 1648 of 2227; range 64:
1650). The honest reading is that the ending is one long scene and
the capture's clock is not the port's over eighteen hundred frames.

### 2. The retired 1884, and why `gate2c` is not it

Taken in order, the three retired runs:

* **`exitdoor` has nothing to recover.** Its 811 ticks are `gate1`'s
  own route with longer presses, and `gate1` is measured at **809 of
  810**. The ground is already counted.
* **`gate2` and `gate2b` are the same run of level 2** -- 1307 and
  1653 ticks, rooms 5, 4 and 6 -- and the guard of room 4 is on the
  screen from **tick 29**. There is no prefix to keep.
* So the move is to **kill the guard**. `k` is `kill_guard`, which is
  `guardhp_delta = -guardhp_curr` and nothing random at all, and a
  recording has carried cheats since `killguard6`.

`gate2c` is `gate2b` with `k` on tick 58, and **headless it is
perfect**: the Prince survives all 1653 ticks instead of dying at
180, the tour grows to rooms 5, 4, 6 and 1, and two seeds 77776
apart draw **every one of the 1653 ticks the same**. That is
`tools/dev/probe-seeds.ts`, which is new -- `probe-check.ts` takes a
bare timeline and a probe's cheats are now the thing that decides
whether it can be adjudicated at all.

**And the window is six ticks wide, which the oracle cannot hit.**

    k at 50-55   the Prince dies at tick 180 -- the keys are a fight
                 and without a guard to fight he runs into it
    k at 56-61   1653 ticks, four rooms, two seeds nought apart
    k at 62      two seeds part on 56 ticks
    k at 65      ... on 750: the guard has already acted

Four captures scored **38, 40, 40 and 169** of 1617. Sweeping the
port's own kill tick against the best of them says where the
emulator read the key:

    port k@56   98 of 1617      port k@61  167
    port k@58  169              port k@62  163
    port k@59  168              port k@64  855
    port k@60  168              port k@66   97

The emulator took the `k` about **six ticks late**, at 64, where the
guard has already made a choice -- so the capture is of a run that
is `prandom` and the port is of one that is not, and they part at
tick 131. `recording_to_script.mjs` sends a cheat at the same
`(t - 1) / 12` every control edge goes out at, so this is the
harness's ordinary tick of slop landing on the one tick in the run
where slop is fatal.

So **a probe whose cheat has to land inside a few ticks cannot be
captured**, and that is the thing to know before designing the next
one. `gate2c`'s recording is kept, with its note, because the design
is right and only the window is too narrow; its digest is not, and
nothing was added to the measured set. `gate2b` stays retired.

### 3. The page, walked and listened to: `tools/dev/page-walk.ts`

    npx tsx tools/dev/page-walk.ts [--levels 1,2,3] [--ticks 500]

Four of the last five bugs the player met were in `web/main.ts` or
`src/render`, where no tick score can see them, so there is now a
thing that does what the player does. It drives `web/index.html` in
Chromium with a real `AudioContext`, wrapped so that every `start()`
is written down, and walks all fourteen levels -- played, then put
through all eleven cheats -- and then the six scenes between the
levels, the hourglass and the ending, each at the clock the player
hears. At each it asks the two questions the suite cannot: **did a
sound happen, and did the picture change**, and with them: did
anything throw, did any global stop being a number, did the screen
go black and stay black.

    level  1  pictures  60  changes 100  lit 39333  [6:gate_closing_fast]
    level  7  pictures  64  changes 100  lit 35086  [0:fell_to_death 1:falling]  (he died)
    cutscene 2  pictures 79  lit 51738  [27:cutscene_2_4_6_12]
    the ending  pictures 104 lit 41457  [26:embrace 56:ending_music]

It comes back clean. Four things it taught on the way, every one of
them about the page rather than the port, and all four are now in
the tool so that nobody has to learn them again:

* **`__princeShow(level, 1)` is a *look*, not a start.** It leaves
  room 1 on the screen, and on level 6 that is not where the Prince
  is -- the walk sat watching an empty room for five hundred ticks
  while the game played somewhere else. A key puts `drawn_room`
  back, which is what the page itself does.
* **`load_intro` opens on `while (check_sound_playing())`**, so a
  scene asked for while the title's twenty-three-second tune is
  still in the channel runs black and silent until it ends. That is
  the original's own behaviour; the walk now asks for
  `SOUND_SILENCE` first.
* **`changeScene` lets one scene change happen at a time**, so a
  scene asked for while another is running is dropped on the floor.
* **A dead Prince is not a still picture.** `Press Button to
  Continue` holds the screen, and levels 5, 6 and 11 kill anyone who
  runs right off the start.

### 4. Two new instruments inside the page, and why

* **`SoundPlayer.failed`**, and `__princeSoundFailures()` on the
  page. `read` catches whatever the decoding throws and writes the
  sound down as "neither a recording nor a tune", after which every
  `play` of it returns on one line, silently. That is exactly how
  the exit door was lost for the whole life of the port --
  `sound_15_leveldoor_sliding` is recorded at 2750 Hz and Chromium's
  `createBuffer` throws under 3000 -- and no measurement this
  project takes could see it, because none of them goes through
  `AudioContext`. `tests/browser/every-sound-reads.test.ts` now asks
  the page to read all fifty-eight and to **play** every index of
  `soundids` and count the nodes that start. Both come back clean,
  and either would have caught the door the day it broke.
* **`SoundPlayer.started`**, and `__princeHeard()`. The last two
  hundred sounds that really reached the channel, by index, so a
  walk through the page can say *which* sound was heard where
  instead of how long its buffer was. It is what turned "level 6
  made no sound" into "level 6 starts on `25:presentation`".

One thing it settled on the way: every level but the first asks for
`15:leveldoor_sliding` on tick 1 and `14:leveldoor_closing` on tick
3. That is the entry door closing behind the Prince, and the
headless port asks for the same two on the same two ticks -- so the
page and `src/pop` agree, and it is the game.

## THE EXIT DOOR WAS 2750 HZ, AND THE THREE BAD CUTSCENES ARE ONE PALETTE ROW

    measured   19478 of 20232     scenes   1610 of 2222
    sounds       417 of   419     (was 415; `gate1snd` 92 -> 94)

### 1. The player could not hear the exit door, and it was never the port

The round before this one found a real fault two lines from it --
`sound_interruptible` is a table the game **writes** -- and measured
that the rising door was already right. It was. The door was never
`src/pop`'s.

**`sound_15_leveldoor_sliding` is recorded at 2750 Hz.** Every other
recording in `DIGISND*.DAT` is at 8200, 11000 or 14000. The Web Audio
spec only obliges a browser to take 8000 and up, and **Chromium's
`createBuffer` throws `NotSupportedError` under 3000** (measured:
2000, 2750 and 2999 throw, 3000 and up do not). So the door threw
where it was read, `SoundPlayer.read`'s `catch` wrote index 15 down
as "neither a recording nor a tune", and every `play(15)` for the
rest of the session returned on that one line.

In a real browser, `gate1`'s own eight hundred ticks of level 1
replayed through the page with every `AudioContext.start()` written
down, over the forty-two ticks the exit door rises:

    before   nought plays
    after    three plays of the 1.613 s recording, ticks 697, 717, 737

`MIN_BUFFER_RATE` is 8000 and a sample is held for an integer number
of the new rate's -- 2750 x 3 = 8250 Hz -- which is not a resampling
but the zero-order hold the DAC it was recorded for did anyway.
`tests/browser/exit-door.test.ts` plays to the door and counts;
`tests/render/every-sound.test.ts` pins that 15 is the only recording
in the game under 8000 Hz.

**No measurement against the original could see it**, and that is the
lesson again: the capture of `PRINCE.EXE` has one unbroken noise of
3.498 seconds there and the port sounds for 3.500, so the ear reads
the door as exact -- because neither side of that comparison goes
through a browser. Same blind spot as the opening that played to
nobody.

### 2. The ear was splitting tunes the port's side did not split

`gate1snd` 92 of 96 -> **94**, with no change to the port.

`sound_notes.py` breaks a noise at a rest of over fifty milliseconds
(`ACTIVE_GAP`); `occupancy` gave one interval per `play_sound`. So a
tune with rests in it arrived as three capture noises against one
port interval and two of the three read as "the original alone".

Both of `gate1snd`'s were `sound_41_end_level_music`, the one
`play_sound` of the Prince climbing into the exit door. The game's
own tune has stretches of 0.688, 1.063 and 9.375 seconds; the capture
of the original measures **0.683, 1.062 and 6.791** (the last cut off
by the end of the recording), the third starting at 94.281 against
the tune's own 94.285. Four milliseconds over eight seconds.
`noises()` splits the port's side by the same rule; `--whole` keeps
the old model.

Two are left and neither is a sound: clicks of nought and eight
milliseconds at 30.65 s and 33.81 s, where the seven blips around
them all sit a steady 0.216 s off whatever origin is chosen.

### 3. Level 12's shadow, looked at

No probe can reach him (`check_shadow` returns on the sword still
lying in room 15), but a test can: drop the tile, draw room 15, and
he falls in on `seq_7_fall`. Rendered on the eighth tick of the fall,
old blitter beside new, the stone ledge behind him at x 42..49,
y 62..65:

    before   29 of the 32 pure black
    after     0 of the 32, the wall's own 48,69,89

That is the box: 150 pixels of a 16 by 32 rectangle, the ledge and
the pillar edge swallowed. `tests/pop/shadow12.test.ts`.

### 4. The three bad cutscenes are **one palette row**, and it is the grab

`cutscene4` 131 of 136 against `cutscene2` 73, `cutscene6` 75 and
`cutscene12` 70 -- all four the same scene, two of them the same
generator. `cutscene_4` differs from `cutscene_2_6` by a single
line: `princess_lying()` where the other has `init_princess_right()`.
Same sound, same hourglass, same twenty-six cutscene frames, same two
fades.

**It is not a bad capture.** Three fresh captures of `cutscene2`
scored 72, 68 and 71 of 136; two of `cutscene4` scored 133 and 131;
three of `cutscene12` scored 67, 1 and 67 (so its digest stays at 70
and its rgb565 capture is not the reason -- the fresh ones are
`svga_s3` and score lower).

**It is not the fade rate either**, which three rounds have now
tried. Both captures run the fade at **7 shades per 6 video frames**
where the port runs 6 per 6 -- the 54-against-64 that FADE_UNITS
1.6875 was meant to fix -- and `exactAgreement`'s drift absorbs it:
`cutscene4` is **diff 0 on every frame of the fade** with that drift
walking -8 to -5 exactly as `cutscene2`'s does.

Put the frames side by side and the whole of `cutscene2`'s
difference is **252 to 359 pixels of 64000**, every one inside the
princess's own 17-by-43 box, every one exactly **one DAC unit
brighter in the capture**, on three frames of every six. The other
57000 pixels are the port's picture to the byte on the same frame.

The one thing that differs is which palette bank she is drawn out of,
and **all six scenes fit it**. Figures on screen in the middle of the
fade, by palette row, with the score beside them:

    cutscene2    standing princess  row 9   359 px      73 of 136
    cutscene6    standing princess  row 9   359 px      75 of 136
    cutscene12   standing princess  row 9   359 px      70 of 136
    cutscene9    standing princess  row 9   359 px     136 of 206
    cutscene8    crouching princess row 10  285 px     121 of 188
                 + the mouse        row 7    40 px
    cutscene4    lying princess     row 10  402 px     131 of 136

`make_pal_buffer_fadein` is given `FADE_CUTSCENE_ROWS` = 0x6689 --
rows 0, 3, 7, 9, 10, 13, 14 -- and `fade_in_frame` walks them in that
order writing sixteen DAC entries apiece. A thirty frames a second
grab and a two-sixtieth fade step beat together exactly, which
`cutscene.ts` has said since the title was captured; this says
**where in the write the grab lands: after row 9 and before row 10.**

Rows 7 and 9 are on the near side and are caught one shade on; rows
10, 13 and 14 are not written yet. Rows 0 and 3 are on the near side
too and cost nothing: what is visible of row 0 is index 0, whose
target is black and never moves, and row 3's hundred and fifty-nine
pixels are the princess-room torches the cutscene mask covers. So
**`cutscene4` is the only one of the six with nothing in row 7 or row
9, and it is the only one that keeps its fade.** `cutscene8` loses
its fade on forty pixels of mouse.

So the port's scene pictures are right and the remaining 612 of the
scenes is, for five of the six, the instrument.
`tests/pop/cutscene-fade-rows.test.ts` pins the rows the explanation
rests on, so that if they ever stop being true the scores are looked
at again.

**And that is `cutscene8`'s one lost frame.** Its pin went 122 to 121
when the DAC model went in, the only number that moved the wrong way.
`scene-report cutscene8 --first` shows it failing on the same three
frames of every six, from frame 4 to frame 56, with the drift walking
-1 to 6 -- the mouse's forty pixels of row 7. The frame the DAC model
cost is one of that alternating run that had been matching under the
old `v << 2` by a rounding coincidence, on a capture that is still
`rgb565` because three attempts to retake it mis-skipped the chain.

**Do not spend another round on the scene fade rate.** Three have
gone on it and this one says why they all lost: the rate is already
absorbed, and what is left is a tear inside the original's own
palette write.

### 5. The gameplay's 754, re-measured against this round's port

Every measured shortfall already had an account written beside it.
This round changed the port in three places that could have moved
them -- the true DAC expansion, `blitXor`, `set_sound_interruptible`
-- so the two biggest were taken again with `which-key.ts --by 1,2,3`
and both still come out exactly where they were:

    level6      x at 290 three ticks later    417 of 417, exact
    13ab6867    y at 416 two ticks later      726 of 728

That is 237 of the 754, still one control of one key edge apiece.
The rest is what it was: `level10`'s guard at tick 315, `level5`'s
skill-3 guard and the floors `check_fall_flo` drops on level 13's
room 23 (`level13`, `level13b`, `jaffar`) are `prandom`;
`addlife2`'s last two are the flash the splitter cannot see;
`demo`'s last two are `autocontrol_opponent`; `probeF`'s seventeen
are one block its capture holds and `f6874819`'s does not.
**Nothing in the measured set is known to be the port's.**

## FIVE MORE THE PLAYER FOUND BY PLAYING, AND FOUR WERE IN THE PORT

Same round as the two instruments below. The scores before and
after: measured 19477 -> **19478**, scenes 1610 both ways, sounds
415 both ways. Four real faults, one of them on every page load, and
the suite saw **one tick** of them.

### 1. The opening was silent, and ran at the wrong speed because of it

A browser will not let a page sound before the player has touched
it, and `show_title` was the first thing the page did -- so every
sound and every tune of the opening went into `SoundPlayer.play`'s
`if (!this.woken) return` and was dropped, on **every page load**.
`sound-report` scores the title at 212 notes of 212, which is the
clearest statement there is that the model was right and the page
was not.

Worse than silence: `show_title` stops dead at
`while (check_sound_playing())` three times over, and with nothing
ever in the channel all three fell through at once. From the page
being ready to the demo starting:

    before   71.0s, nought sounds started
    after   100.7s, 563          (the capture draws the demo at ~108.5s)

The page now holds on the game's own black screen with `press any
key to begin` until the context is allowed to run. Two things that
cost an hour:

* **`AudioContext.resume()` does not resolve while it is blocked.**
  Awaiting it before drawing the prompt hangs before the prompt.
  Read `state` instead.
* **Headless Chromium has no autoplay policy.** A context made with
  no gesture reads `running` under every value of
  `--autoplay-policy` and under none -- measured, four out of four.
  So the fault cannot be reproduced with a flag.
  `tests/browser/sound-gate.test.ts` puts the policy back itself.
  The rest of the browser suite passes
  `--autoplay-policy=no-user-gesture-required` so that it tests the
  game and not the policy, and the two tests that drive a scene with
  `__princeSceneStep` -- a hundred and fifty times faster than the
  clock the audio keeps -- call the new `__princeMute`.

### 2. The box behind the shadow was `blitters_3_xor`

The VGA's XOR write-mode XORs the sprite's byte into the screen's,
so a sprite pixel of **nought changes nothing**: `d ^ 0 == d`.
`Surface.blitXor` XORed `base + v`, so every *transparent* pixel of
the sprite's box had the bank's palette base XORed into what was
behind it. The Kid's bank base is **112**.

The only thing in the game drawn that way is the shadow -- an
`blitters_2_or` and a `blitters_3_xor` of one frame a pixel apart --
and on level 12 he carries a sword, which puts him in a bank whose
base is not nought. `blitOr` already had the `if (v === 0) return`
that `blitXor` did not.

**`shadow6` is exact now, 279 of 280 to 280**, and that tick had been
written off in this repository as "the comparison running off the
end of the capture".

### 3. Level 3's checkpoint never fired

`do_startpos` opens on `if (current_level == 3 && checkpoint)`, and
`PopGame.restart` carried `checkpoint` across **after**
`PopGame.start` had already run `startLevel()`. Same shape as the
cheats applied before the tick: the state put back on the wrong side
of the call that reads it. `hitp_beg_lev` was the same fault with a
patch over it; the carried set goes in before `startLevel` now and
the patch is gone. Without the fix the test reads "expected 9 to be
2" -- room 9, the top of the level.

### 4. `sound_interruptible` is a table the game **writes**

`animate_leveldoor` sets `sound_interruptible[15]` to 0 before every
`play_sound` of the level door going up and to 1 before every one of
it coming down. The port had the table as a constant and neither
line.

Measured first, as the rule says: over `gate1` the port asks for
sound 15 on **42 consecutive ticks** and a real `SoundPlayer` turns
those into **three whole plays** of a 1.613-second recording, not 42
eighty-three-millisecond attacks. So the rising door was already
right -- by luck, because the static table holds 0 for 15 -- and the
luck is what the second line takes away.

`tests/render/every-sound.test.ts` is the other half: **every** index
in `soundids` has a recording, a tune or a beep behind it. (31, 34,
42 and 57 have none and none of them is a `soundids` value.)

### 5. Two comparisons, and one that cannot exist

* **The transition is pinned on the page.** The capture says 11.7
  seconds from the `shift+l` to level 2, about four of them black.
  The page: scene starts at 0.02s, ends at 7.04s, level up at
  11.09s -- three runs of three -- against 7.1s for the whole thing
  before the wait went in. `tests/browser/cutscene.test.ts`.
* **Level 12's shadow cannot be reached by a probe**, and the line
  is `if (curr_tile2 == tiles_22_sword) return;` in `check_shadow`:
  the tile at row 0 column 1 of room 15 *is* a sword when the level
  begins (raw 54, masked 22) and no cheat writes a tile. Same wall
  as the mirror of level 4. `tests/pop/shadow12.test.ts` pins both
  halves.

### What this half of the round says about method

* **Measure before fixing, even when the fix looks obvious.** The
  exit door was reported as silent and is not; what was actually
  wrong was a table two lines away from it.
* **The page is not the port.** Three of these four are in
  `web/main.ts` or in `src/render`, and the tick scores moved by
  one between them.

## THE EYE WAS COLOUR-BLIND, AND THE ENDING HAD BEEN MEASURED AGAINST THE WRONG SCENE

Two instruments wrong again, and the second one cost the whole of
the worst number in the project.

### 1. `machine=vgaonly` threw the low bit of red and blue away

Lossless encoding was not enough. **DOSBox 0.74's `vgaonly` draws
mode 13h through a sixteen-bit lookup** --
`vga.dac.xlat16[i] = ((blue>>1)&0x1f) | (green&0x3f)<<5 | ((red>>1)&0x1f)<<11`
-- so red and blue keep five bits of the DAC's six and the low bit
of each never reached a single capture this project has ever taken.
The frames say it without reading a line of DOSBox: over six
different scene captures, red and blue have **not one odd six-bit
value between them** and green has twenty to twenty-nine.

`machine=svga_s3` takes the true-colour path and renders a DAC entry
the way the hardware does, `(v << 2) | (v >> 4)` -- 20 comes out 81
and 60 comes out 243 -- which is one-to-one over the sixty-four
values. It needs **`scaler=normal2x`** with it: the S3 does not
double mode 13h, so it paints 320x200 into the corner of the window
and the capture's `crop 640:400` would take a quarter of the
picture. (A scene cut that way scores 2 of 137 however right the
port is, which is how that was found.)

**And the port's own expansion was wrong too.** Six bits are a
fraction of full scale, so 63 is 255 and not 252.
`ScreenPalette.toRgba` had a bare `v << 2` under a comment claiming
it was what the DAC did, which made every colour in the game 1.2 per
cent dark and the white of the title screen (252,252,252).

The two cannot be mixed, and that is measured: with the port on the
true expansion and the old captures still RGB565 the gameplay suite
fell from 19477 to **15519**, `shadow5` 300 of 300 to **0**. So a
digest now carries a **`dac` field** saying which DAC its capture
went through, `PaletteMap` puts the port's pixel through that DAC
before it searches the palette, and a digest without the field is
`rgb565` -- which every digest taken before this round is. It is
deliberately **not** sniffed from the colours: the forty gameplay
digests also went through the old YUV encoder, so thirty-one of
`b4ff4672`'s thirty-six colours are not multiples of four and it is
`vgaonly` all the same.

With the model in place the gameplay score is unchanged to the tick.

### 2. The ending: 1 of 564 to 325 of 480

**The first ending capture never reached the ending.** Everything the
last round read off it was read off a cutscene between two levels:
that capture's princess room is at 218.5 seconds, it fades in over
sixty-three frames and it has an hourglass on the carpet -- and four
seconds later the screen is black again and six seconds later a
level is starting with `59 MINUTES LEFT` under it. The chain had
lost a `shift+l`.

**Check what follows the room.** A capture that reached the ending
has `the tyrant Jaffar lies dead`, then the landscape, then the hall
of fame after it. One `ffmpeg -ss` tells you.

In a capture that did reach it there is **no fade and no hourglass**:
black at video frame 104, the whole room and all 46 of its colours
at 108, nothing in between, and the box `draw_hourglass` fills is
carpet on every frame of the embrace. Both of which are what the C
has had all along -- `end_sequence_anim` opens on
`copy_screen_rect(&screen_rect)`, calls no `fade_in_1`, and never
sets `hourglass_state` after `reset_cutscene` zeroed it.

    the fade out, the room up whole        1 -> 108 of 480
    `init_ending_princess` back to the C's
      `init_princess`, facing left
    the hourglass out                    108 -> 219
    the spec's `remMin` 57 -> 58         219 -> 325

**The princess's "wrong x" was her direction.** `load_frame_to_obj`
is `obj_x = (char_dx_forward(dx) << 1) - 116` and `char_dx_forward`
negates `dx` for a character facing left, so turning a character
round moves them by **four times the frame's own dx**. The
thirty-nine pixels the last round wrote down and could not account
for -- "the capture has her centred on 134 where `Char.x = 136`
draws her centred on 173" -- is exactly that, and the fitted
`x = 118` it went looking for does not exist.

`remMin` is read straight by the hall of fame: `show_hof` prints
`hof[i].min - 1`, and the capture's reads **57:57**.

Between what is left the port is exact **to the pixel** -- capture
frames 492 to 1084 against the port's 450 to 1042, nought unmasked
differences. What is left is the two fades, the name box's cursor
(from capture frame 1203 the run alternates three exact and three
not, so the port's six-sixtieth blink is half a period out and
nothing else in those frames differs), and the Prince running in.

### The emulated CPU is part of a scene's clock

`proc_cutscene_frame` draws the whole room before it waits for
`timer_0` and `fade_in_frame` writes 256 DAC entries before it waits
for `timer_1`, so on a slow enough machine both are **work-bound**.
Same script, three cycle counts:

    cycles  20000   fade 63 video frames   held scene changes every 3
    cycles  60000   fade 15                every 2 or 3
    cycles 150000   fade 16                every 3 to 7

At the 20000 the suite captures with, the fade is 63 frames against
the port's 64 and the held scene changes every 3, which is
`cutscene_frame_time` 6 at a sixtieth apiece. **The capture and the
code agree at that cycle count**, which is why `FADE_UNITS` is 2.
Re-measured on the true-colour digests, where a fade frame can match
for the first time: 2 gives 1604, 1.8 gives 1445, 1.75 gives 1425,
1.6875 gives 1393. Three rounds have tried to make the port keep the
emulator's fade time; all three lost.

### Two things left where they are, with their numbers

* **`exactAgreement`'s window.** It searches offsets within +/-16 of
  the one `bestOffset` chose, and over an eighteen-hundred-frame
  scene the emulator's clock wanders further: the ending's own
  offset reads 18 at the first drawn frame and 36 by the hall of
  fame. Widening it and changing nothing else: range 32 gives
  1648 of 2227, range 64 gives 1650. **It stays at 16** -- 46
  frames is not worth loosening the one thing that decides whether a
  picture counts.
* **A scene spec's `start` is good for one capture.** Two captures
  of the ending's own script put the scene twelve seconds apart, and
  a scene outside `range` reads 1 however right the port is. The
  ending carries `start: 231.0, range: 900` now. Three fresh
  `cutscene8` captures all came back 1 of 37 and all three had
  mis-skipped the chain -- the scene at 95 seconds in them is not
  cutscene 8 -- so `cutscene8` kept its old capture.

### What this round says about method

* **Check the instrument before the port, and then check the
  instrument again.** Last round found the encoder; this round found
  the emulated video card behind it and a wrong expansion in the
  port itself.
* **Know what you captured.** A capture of the wrong scene is
  indistinguishable from a capture of the right one until you look
  at what comes after it, and three "faults" were written into the
  port off one.

## THE ORACLE HAS AN EAR NOW, AND THE EYE WAS THROWING HALF ITS LIGHT AWAY

Two instruments this round, and between them they found five faults
in parts of the game nothing had ever looked at.

### 1. The sound, compared with the original for the first time

Every one of the fifty digests before this round was a **picture**.
The capture chain ran DOSBox with `pcspeaker=false`, nothing in the
suite had ever compared a sound with anything, and that is why three
of the five bugs a human found in one sitting were sound while
neither score moved by a tick.

`dosbox_oracle.py --speaker` lets the mixer carry the PC speaker's
square wave and a `wave` line in the script toggles DOSBox's own
recorder, which taps the mixer, works with `nosound=true` and costs
the emulator no wall clock. **It changes nothing else** -- the game's
speaker code and its timer interrupts run whatever the mixer does
with the result -- so a sound capture is the same run as a picture
capture and every picture digest stays valid.

    title         212 of 212 notes    6 of 6 sounds
    cutscene2snd   21 of  21 notes    1 of 1 sound    +0.00s
    gate1snd       92 of  96 noises   origin 28.45  (92 against 56)
    level10bsnd    90 of  90 noises   origin 174.40 (90 against 70)
    sounds        415 of 419

The title the player hears on **every page load** is the original's,
sound for sound and note for note, with every start inside 0.18
seconds over seventy-two seconds. `level10bsnd` is the run the gate
stutter was found on and it is exact.

The whole instrument is written up in `tools/oracle/README.md` --
what a square wave can be read as, what it cannot (two notes of one
pitch with no rest between them are one note; a note under two and a
half cycles has no pitch), why an effect is measured as *noise* and
not as notes, and why a recording's origin is known and not searched
for. Three things fell out of building it:

* **The stored "divisor" is the pitch in hertz.** The title's notes
  are 73, 110, 117, 147, 156, 185, 196, 208 and the recording of the
  original playing them measures 73.0, 110.1, 116.5, 147.1, 155.3,
  185.1, 196.1, 207.0 Hz. As 8253 divisors those would be ten and
  sixteen kilohertz.
* **The ear settles `check_sound_playing`, which the eye could only
  assume.** It is read in three places that are *play* and not sound.
  Against `gate1`'s capture, with the game told what is in the one
  channel: **26 of 96**. Deaf, which is what every picture digest
  rests on: **90 of 96**.
* **`SOUND_NAME` was wrong from index 9 on** and this file had been
  quoting it: 19 is `draw_sword` and not the footstep, 23 is the
  footstep, **24 is `death_regular`** and not `loose_shake_3`. It is
  built from `soundids` now.

### 2. Every scene capture had been thrown away in YUV

`-qp 0` is lossless in whatever space the encoder works in, and
`-pix_fmt yuv444p` makes ffmpeg convert the grabbed RGB to YUV first,
which rounds: a test image comes back a unit or three out, and
`libx264rgb` with `-pix_fmt rgb24` comes back with a maximum
difference of **nought**.

It mattered because `digest.py` hashes palette **indices** and a
scene's palette holds a thousand entries off its own fades, near
duplicates two units apart. A gameplay capture has two or three dozen
colours far apart (`0fbffa60` has 42, `level3` 26) and never noticed.
A scene is nothing but fades.

    title       426 -> 473 of 582     cutscene6     37 ->  70 of 137
    expired     108 -> 158 of 173     cutscene8     74 -> 122 of 188
    cutscene2    34 ->  72 of 137     cutscene9      8 -> 129 of 206
    cutscene4    36 -> 130 of 136     cutscene12    33 ->  70 of 136

    the same eight scenes   756 of 1723  ->  1224 of 1695

`cutscene9` was the worst run in the suite at 8 of 207. Not one frame
of that came from a change to the port, a scorer or a mask: the
pictures were right and the instrument was rounding them away. **So
before reading a scene's shortfall as timing, check when its capture
was taken.**

### 3. The ending is reachable, and three faults were in it

`tools/oracle/README.md` had the ending down as out of reach -- a
thirteen-level chain *and* the Prince in room 5 of level 14. It is
**four taps of `h`**. `check_the_end` runs `end_sequence()` when the
*drawn* room of level 14 is 5, `h` is `next_room = room_L`, and that
level's rooms go 4, 3, 2, 1, 5. The game is won with nobody moving.

All three faults are things the player sees at the end of the game he
has just finished, and none could be seen by any other means:

* the port drew the **eight rows under the room** that the original
  leaves black -- 2560 of the 3100 pixels of a frame;
* **`end_sequence_anim` had no `fade_in_1` at all**, so the
  princess's room was simply *there* where the capture fades it in
  over sixty-three video frames;
* and no **hourglass**, because `load_intro` calls `reset_cutscene`,
  which zeroes `hourglass_state`.

It is pinned at 1 of 564, which is what the port honestly scores, and
what is left is written up in the commit and in the test: after the
fade the capture's palette is the port's **with the low bit of every
channel cleared**, exactly, on 39125 of a frame's 64000 pixels.
Flooring every fade's target to an even shade is **dead** -- it takes
the other eight scenes from 1225 to 410 -- and flooring the ending's
alone leaves it at 1. With the low bit ignored a frame still differs
by a thousand pixels round the Prince and the princess.

### 4. The demo, which needs no key at all

The last of the three parts of the game with no capture. Boot the
original and press **nothing**: at about 108.5 seconds the title has
run its story, the screen goes black and the demo level is drawn.
There is no Ctrl+A -- a key during the attract mode starts a real
game -- so `--after-blank` from `--start 106` is the whole of the
numbering and `--anchor-text` is not used, because the demo draws no
level title.

**219 of 221, first try**, and its two missing ticks are the last
two: the demo's fight is `autocontrol_opponent`, which reads
`prandom`, and the port's own demo at seeds 1 and 77777 is the same
picture for 218 ticks and differs on 372 of the 381 after that. So
every tick of the demo that anything could adjudicate is drawn
exactly.

A recording may carry `seed` now, and `demo` is the only one that
does: `PopGame.start` seeds level 0 from the clock, which is the C's
own `random_seed = (dword)time(NULL)` -- right in the browser, where
the attract mode should differ every time, and wrong for a replay.

### What the two instruments say about method

* **A capture is cheap and it is the authority**, and that now
  includes what the machine *plays*. Three of last round's five bugs
  and three of this round's were settled by taking a capture rather
  than by reading.
* **Check the instrument before the port.** A thousand frames of
  scene were being lost to a colour conversion, and every one of them
  had been written up as the emulator's clock.

## FIVE BUGS THE PLAYER FOUND BY PLAYING, AND ALL FIVE WERE REAL

Everything above and below this is the tick score. **These five were
not.** A human being played the page and reported them, and not one
of them could be seen by `pop-report.ts` or `scene-report.ts` at all.
Both scores are **exactly the same before and after all five fixes**
-- measured 19258 of 20011, all 21141 of 23778, scenes 756 of 1723 --
which is the clearest statement there is of what the suite cannot
see. Three of the five were sound, and **the sound had never been
compared with anything.**

### 1 and 2. The melody of every tune in the game was twelve seconds late

`src/render/music.ts` skipped a MIDI sysex with `p += varLen()`.
JavaScript reads `p` **before** calling `varLen`, so the bytes
`varLen` ate for the length were added back on and the skip landed
one byte short, every time. Every melody track in `MIDISND1.DAT`
opens with the AdLib instrument definition,
`F0 07 00 00 34 01 00 0C F7`, so the reader came back onto its last
two bytes, `F7 00`, and read them as a delta time of **15232 ticks**.

The accompaniment played on time and stopped after two or three
seconds; the melody arrived twelve seconds later, by which time the
scene was over and the next level was being played. That is the
player's "the sound is cut off, comes back, is cut off again, and
only returns during the next level after you have already been
playing for a while", and it is the same fault for the healing potion
as for the transition.

**The measurement is the game's own second copy of the music.** Every
tune ships twice -- MIDI for an AdLib, a tune for the PC speaker --
so the two must last the same time. Seconds, before -> after, with
the speaker's in brackets:

    24 death           15.9 ->  3.2 ( 3.0)    36 out of time  52.6 -> 15.7 (12.7)
    26 embrace         29.4 -> 13.5 (11.7)    39 feather      39.2 -> 18.0 (18.6)
    27 scene between   33.4 -> 11.0 (10.7)    41 end of level 35.1 -> 11.3 (11.3)
    30 big potion      13.7 ->  3.1 ( 2.3)    50 princess     60.6 -> 13.0 ( 9.5)
    32 shadow          30.7 ->  6.9 ( 4.9)    52 Jaffar goes  51.2 -> 27.4 (28.0)
    33 small potion    14.0 ->  2.1 ( 2.5)    54 the title    46.6 -> 22.8 (24.7)
    35 cutscene 8/9    10.1 -> 10.1 ( 9.8)    55 absence      38.8 -> 15.0 (14.9)
    37 victory          2.6 ->  2.6 ( 2.5)    56 the ending  145.5 ->121.7 (120.0)

Seventeen tunes, every one now within half of its speaker twin where
before they ran two to six times long. `tests/render/audio.test.ts`
pins it, and it needs nothing outside the game's own files.

It matters far beyond the music, because **the game waits for the
sound**: `while (check_sound_playing())` holds `show_title`,
`load_intro` and `play_level` where they stand. The title the player
sees on every page load was waiting on 46.6 seconds of stranded
melody; `DEATH_MUSIC_TICKS` is 36 and sound 24 was 190 ticks, so the
wait for `Press Button to Continue` was sixteen seconds.

### 3. The flash left a black box round every torch

`set_bg_attr(0, color)` fills the screen with the colour and puts the
frame back over it with **black punched out**, so what flashes is
every black *pixel*. The port gave palette entry nought the colour
and nothing else -- and a sprite drawn with `blitters_0_no_transp`
does not use entry nought for its black. It uses its own bank's,
`paletteBase + 0`, which is black in the palette and is a different
entry. `draw_tile_anim` draws a torch flame exactly that way.

A **new capture** of `PRINCE.EXE` taking `shift+t` on level 2
settles it, because no digest can: `split_ticks.py` keeps for each
tick the frame just before the next change, which is the frame the
flash has already come off. Share of the screen still black on the
flash frame:

                       the room   the strip under it
    the original         0.0%           0.0%
    the port, before     2.9%           1.9%
    the port, after      0.0%           0.0%

against 40.8% and 97.2% on the frames either side, in the capture and
in the port alike. The flash covers the whole 320 by 200, the words
and the hit points with it.

### 4. There was no gate-opening sound, and 1 again: the pause could not be skipped

Two lines of the C the shell did not have.

**`proc_cutscene_frame`** is
`if (!disable_keys && do_paused()) { stop_sounds(); ...; return 1; }`
and `do_paused` ends on `return key || control_shift`, so **any** key
ends a scene -- an arrow, the space bar, shift on its own. Only
`end_sequence_anim` and `time_expired` set `disable_keys`. The shell
took Escape and nothing else.

**`play_level`**, between whatever came before and
`draw_level_first`, is
`while (check_sound_playing() && !do_paused()) idle(); stop_sounds();`
The scene's tune is let finish and is **then stopped**. Without it
the tune played on into the level -- sound 27 is priority 1 and
marked **not interruptible** in the original's own tables -- and
`play_next_sound`'s rule then refused every gate, every footstep and
every loose floor for as long as it lasted. That is the whole of "no
gate-opening sound", and the title's own music does the same thing to
level 1.

`stop_sounds()` is in `select()`, which is where every level begins.
The **wait** in front of it is in `nextLevel` and in `restart`, which
are the two places the player meets it; a jump straight to a level
(`__princeShow`, `__princeGoToLevel`) is not a path the original has,
and making those wait put a quarter of an hour on `npm test`.

Measured in a real browser, recorded sounds started in the first four
seconds of level 2 reached through the transition and then run about:
**nought before, five after**.

And the pause itself, from the `shift+l` to the level being up:

    the original, off a fresh capture of PRINCE.EXE   11.7s
      (level 1 fades out at 29.0 -- a hard cut, not a fade --
       the princess's room fades in over 54 video frames from
       29.567 to 31.333, the scene holds to 35.0, **black from
       36.0 to 39.5**, which is this very wait, level 2 at 40.0)
    the port, before                                   7.1s
    the port, after                                   11.1s
    the port, after, with any key                     1.0s, the
                                                 moment it is pressed

So the port's transition was four and a half seconds **shorter** than
the original's and could not be cut short. It is the original's
length now and any key ends it.

### 5. Level 7 opened on a black screen

`draw_level_first` opens with `next_room = Kid.room; check_the_end();`
and `startLevel` wrote `check_the_end`'s body out by hand and set only
`drawn_room`. On thirteen of the fourteen levels the two numbers are
equal and nothing shows. **Level 7 is the exception.** `do_startpos`
does `next_room = Char.room = level.start_room`, which is 17, and
then `set_start_pos`'s falling entry does `goto_other_room(3)` --
which moves `Char.room` to the room below, 1, and leaves `next_room`
at 17. So the level's first `check_the_end` found 17 against a drawn
room of 1 and drew **room 17**, which is empty.

A fresh capture settles the picture: at 118.0 seconds into the
`level7` chain the original's screen is **room 1**, the shaft with
the Prince falling into it. A digest of that capture -- 224 ticks,
161 comparable, the first capture in the suite to cover level 7's
opening at all -- scores the port **132 of 161 without the line and
137 with it**. The pinned `level7` digest, whose first fourteen ticks
the capture does not have (`hash` is null for 0..13), is 147 of 147
either way, which is why nobody had ever seen this.

**The death is the original's own.** The same capture has the Prince
dead on the floor of room 3 twelve ticks in, exactly as the port
does: the fall is six rows at terminal velocity and `land()` makes
that `take_hp(100)`. What the black screen took away was not the
chance to live but the chance to **see** -- holding shift on the way
down grabs the ledge in room 1 and he keeps all three flasks.
Verified in the real page, arriving from level 6 through the real
transition. `tests/pop/level7-entry.test.ts` pins all four facts.

### `play_sound` does not play anything, and the gate stuttered

`play_sound` writes the sound into `next_sound`, keeping the most
important of however many are asked for in one tick, and
`play_next_sound` -- the last line of `draw_game_frame` -- starts that
one and no other. The translation went straight to the device on
every call, so a tick that asked for several started several, each
one stopping the one before it after nought milliseconds.

Level 10 has two gates rising together and asks for
`sound_5_gate_opening` **four times in the same tick**:
`tools/dev/sound-trace.ts` counts twenty-four such ticks in that one
recording, and none in it now. The gate stuttered where the original
creaks.

The *choice* was already right -- `SoundPlayer.mayTake` is
`play_next_sound`'s own test, so the most important sound of the tick
ended up in the channel either way, and every one of the six ticks in
the suite that ask for two different sounds comes out the same under
both. What the queue fixes is the stutter. `tests/pop/next-sound.test.ts`.

A thing to know about it: **the tick's sound is asked for in
`render()`**, because that is where `draw_game_frame` has it. A
driver that steps without drawing hears nothing, which is what
`sound-trace.ts` did for its first half hour.

### Two hypotheses about the scene timing, both dead, with their cost

The capture of the level 1 to 2 transition measures the original's
fades exactly: the fade **in** runs from 29.567 to 31.333 and the
fade **out** from 34.200 to 36.000 -- **54 video frames each**, 1.80
seconds, where the port takes 63 or 64. And `make_pal_buffer_fadein`
is given `wait_time` 2, which is 64 shades at two sixtieths = 2.13
seconds = 64 frames. So the capture and the code disagree by 17 per
cent, and the obvious move is to believe the capture.

**It scores worse.** `scene-report.ts` over all eight scenes:

    FADE_UNITS   2 (the code)    756 of 1723
                 1.8             706 of 1716
                 1.75            689 of 1703
                 1.6875 (= 54/64) 684 of 1697

And the same for the other half of the drift, the cutscene frame
being 3.2 video frames in the emulator against the port's 3. Running
the port's scene clock at that rate, through `SCENE_STEP_MS`:

    1/30 (the code)   756 of 1723
    1/31              676 of 1735
    1/32              608 of 1738
    1/29              670 of 1664

Both directions lose. So the emulator's fade and its cutscene frame
really are the emulator's, as the round before this one said, and
making the port keep the emulator's time does not buy the pictures
back. Do not spend another round on it without something new to go
on -- what is left is **local**, not a rate, because a constant
offset is what `scene-report` already searches for.

### Every level's entry, through the transition, against a straight jump

Level 7's fault was invisible to the suite because **every probe
enters a level by the skip chain or a cheat, never by finishing the
level before**. So all thirteen transitions were walked in a real
browser, each arrival put beside the same level entered directly:
room, frame, x, y, hit points and sword. Every one agrees to the tick
(frame 45 against 46 where the sample caught one a tick later), level
13's running entry and level 7's falling entry included, and nothing
threw. Level 7 was the only one.

### What this round says about the method

* **Nothing in either score moved, and five real bugs were fixed.**
  A digest is a picture of a tick. It cannot hear, it cannot see a
  flash (the splitter keeps the frame the flash has already come off),
  and it never enters a level any way but the skip chain -- which is
  why level 7's opening, the one level whose entry differs, had never
  been drawn.
* **A capture is cheap and it is the authority.** Three of these five
  were settled by taking a new capture rather than by reading: the
  level 7 opening, the flash over the torches, and the length of the
  transition. `tools/oracle/dosbox_oracle.py --record` plus
  `ffmpeg -vf fps=30` and a mean-colour sweep is ten minutes.
* **`tools/dev/sound-trace.ts`** is new: it replays a recording with
  the real `SoundPlayer` behind a stand-in device and prints every
  sound the byte-code asked for, whether the player heard it, and
  what was in the one channel instead.
* Playwright and Chromium are in the container and the page runs
  under them with real audio (`--autoplay-policy=no-user-gesture-required`,
  and wrap `AudioContext` in `page.addInitScript` to log every
  `start`). That is how "no gate sound" went from a guess to nought
  against five.

## THE JOB IN HAND: close the last of the difference

`src/pop` is a direct translation of https://github.com/NagyD/SDLPoP
and it is now the game the player plays: `web/main.ts` starts
`PopGame`, and `game.js` carries it. The plan and what was kept is
`docs/sdlpop-translation.md`.

Where it stands, measured by `tools/dev/pop-report.ts` against the
captures of a real PRINCE.EXE:

    measured         32260 of 33047   98%
    retired           1883 of  3767   50%
    all              34143 of 36814   93%

(The jump is the thirteen room tours: see the top of this file. The
suite had drawn 59 of the game's 266 rooms and now draws 262.)

(`demo` is the new one: 219 of 221, and its two missing ticks are
the last two, which is where `prandom` takes the attract mode over.)

and, for the first time, the parts of the game that are not
gameplay, by `tools/dev/scene-report.ts`:

    title              586 of   633   the opening, every page load
    expired            190 of   229   the hourglass
    cutscene2          129 of   136   cutscene8    168 of 192
    cutscene4          131 of   135   cutscene9    181 of 205
    cutscene6          128 of   135   cutscene12   122 of 135
    ending             805 of   836   from 1

    scenes            2440 of  2636

and what the player *hears*, for the first time, by
`tools/dev/sound-report.ts`:

    title         212 of 212 notes    gate1snd      95 of  96 noises
    cutscene2snd   21 of  21 notes    level10bsnd   90 of  90 noises
    feather1snd    50 of  50 noises   the feather, by `shift+w`, exact
    potionsnd      25 of  25 noises   all six potions, drunk out of
                                      the flask on a level of our own

    sounds        493 of 494

**Most of what used to be short was the encoder, not the clock** --
see the top of this file: the same eight scenes went from 756 to 1224
on captures taken losslessly, with no change to the port. What
follows was written before that and is kept because the frame-level
readings in it are still right; the *conclusion* that the remainder
is all the emulator's clock is now only about the remainder.

Frames of each put beside the
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
