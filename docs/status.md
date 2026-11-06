# Where this stands, and what to do next

A note for whoever picks the work up — a new session, or the same person a
week later. It says what is done, what is known to be wrong, what the next
piece of work is, and the few conventions that are easy to break by
accident.

Read [README.md](../README.md) for what the project is,
[docs/testing.md](testing.md) for how it is checked, and
[docs/file-inventory.md](file-inventory.md) for what is in each original
file.

## The short version

The game is playable in a browser from the original's own files. Standing,
turning, running, stepping carefully, every jump, walking into a wall,
grabbing a ledge, hanging, climbing, falling, landing and dying are in, and
so are the traps. Guards wake, draw, walk in and fight, and can be killed —
but the fight's timing has not been measured against the original. **Sound
is not written at all.**

Play it at <https://rami5743.github.io/Prince/>.

## Done, and checked against the original

Everything in this list is compared with frames captured from the real
`PRINCE.EXE` under DOSBox, and the comparison requires every pixel to be
equal — see [docs/testing.md](testing.md).

| | checked by |
|---|---|
| Title screen | `tests/oracle/title-screen.test.ts`, `tests/browser/render.test.ts` |
| Six rooms, dungeon and palace | `tests/render/rooms.test.ts` |
| The first seven levels as they open | `tests/golden/level0*-start.png` |
| Hit point markers | `tests/game/status-bar.test.ts` |
| Running, across a room boundary | `tests/game/run.test.ts` |
| The running jump | `tests/game/run-jump.test.ts` |
| Stepping carefully, and level 1's opening | `tests/game/careful-step.test.ts` |
| A guard standing in a room, with his sword | `tests/game/guard.test.ts` |
| The traps: gates, buttons, loose floors, spikes, chompers | `tests/game/traps.test.ts` |
| Walking at a gate, open and shut | `tests/game/gate.test.ts` |
| Chompers snapping, and cutting | `tests/game/chomper.test.ts` |
| A guard waking, closing, and fighting | `tests/game/guard.test.ts`, `tests/game/swordfight.test.ts` |
| Hanging, dying, the painful landing | `tests/game/hang.test.ts`, `tests/game/death.test.ts` |
| Walking into a wall | `tests/game/run.test.ts`, `tests/oracle/play-session.test.ts` |
| Taking hold of a ledge and climbing it | `tests/oracle/play-session.test.ts` |
| Two whole play sessions on level 1 | `tests/oracle/play-session.test.ts` |
| A held Up climbing and carrying on | `tests/game/hang.test.ts` |
| Nothing leaves the world, however badly it is played | `tests/game/fuzz.test.ts` |
| Climbing and a sword fight, in a real browser | `tests/browser/play.test.ts` |
| The blank while the view changes room | `tests/game/run-jump.test.ts` |
| A tap shorter than a frame still counts | `tests/browser/play.test.ts` |
| Recordings replay to what they recorded | `tests/game/recording.test.ts` |

`npm test` runs all of it; `npm run typecheck` is separate. Both should be
clean before anything is pushed.

## The play-session comparison

The move-by-move comparisons above all passed while the game was plainly
wrong to play, because each of them starts from a fresh level and pins a
single move. `tests/oracle/play-session.test.ts` plays a level the way a
person plays it -- several moves in a row, each inheriting what the last one
left behind -- and that is what found the bug below. It reports the first
capture it cannot reproduce and carries on, so one run names every place the
port and the original part company. See [docs/testing.md](testing.md) §5.

Level 1's opening reproduces 34 of its 51 captures and the climbing session
34 of its 54; the test lists what the rest are. Between them they found
four real bugs, every one of them reachable in the first ten seconds of
play and none of them visible to the move-by-move comparisons:

* the Prince walked through the wall at the end of a room and fell into the
  room below -- nothing in the port ever set `ACTION.bumped`;
* once that was stopped, the bump fired in mid-air too and pushed a falling
  Prince sideways through the floor;
* a smashed floor left no rubble where it landed;
* Up on its own would not take hold of a ledge, so climbing was impossible
  unless the player knew to hold Shift -- and even then it stopped dead at
  the top instead of carrying on while the key was down.

A session's key order matters: the generator presses Shift before the
direction and releases it after, because if a bare arrow key reaches the
game first, even for one tick, the Prince runs instead of stepping and the
whole session goes somewhere else. That one detail was worth nine captures.

Adding a session is cheap -- a short file under `tools/oracle/sessions/`, a
capture, and an entry in the test -- and is the best way to spend an hour on
this port. Levels 2 and 3, hanging and climbing, and the traps all deserve
one.

## Getting a bug out of a browser and into a test

The page has **record keys** and **save recording** on it. The first starts
the level again and records every key tick by tick; the second downloads
the lot as a file. Drop that file in `tests/recordings/` and it replays
itself as a test -- see [docs/testing.md](testing.md) §4a. It is the
shortest path there is from "it does this when I play it" to something
that fails.

## Known to be unfinished

* **Guard behaviour and sword fighting.** A guard is now stepped every
  frame -- until recently nothing stepped one at all, which is why they
  stood in their opening frame for ever -- and he comes on guard when the
  Prince turns up in his room on his row: sequence 55 draws the sword and
  settles into the stance, which is what `tests/golden/session-level2-guard`
  shows the original doing. He does nothing else. He does not advance,
  strike or parry, and nothing stops the Prince walking through him. He
  does now walk in: `session-level2-meet` shows the original's guard
  leaving his corner once he is on guard and closing to about a sword's
  length, and the port does the same. He will not turn round, so a Prince
  who gets behind him is ignored; the capture has not pinned when a guard
  decides to turn.

  There is now a fight. The Prince draws when an armed guard comes near,
  Up lunges, Down blocks, forward and back step in and out, and a lunge
  that reaches someone who is not blocking costs a hit point. A guard that
  runs out of them drops; so does the Prince. It can be won and it can be
  lost, and a guard can no longer be walked past -- stepping in stops at
  the point of the blade, so the only way through is to win.

  **Its timing is not the original's and is not claimed to be.** How long a
  guard waits between lunges, how its skill changes that, and exactly when
  the original counts a blow as landed are all unmeasured -- the head of
  `src/game/sword.ts` says so, and so does
  `tests/game/swordfight.test.ts`. A guard also still does not stop the
  Prince walking past, which the original surely does. Pinning any of it
  wants captures of a fight, and a fight is the hardest thing to capture:
  it depends on skill, on timing and on the original's own randomness, and
  two capture runs of the same session already disagree.

  Be careful reading `session-level2-guard` on that last point: it does
  *not* show the original stopping the Prince at the guard. I claimed it
  did and was wrong. Neither Prince gets near the guard in it -- the
  original's stops on one of room 4's two loose floors and drops to the row
  below, and the port's run-stop carries it one tile further onto solid
  floor. Whether a guard blocks the Prince is still an open question and
  wants a capture of its own, with the Prince walked right up to one.

  What the capture does not settle is what makes a guard come on guard at
  the moment he does -- he waited five captures after the Prince walked in
  -- so the port draws its sword a little too eagerly. Captures at several
  distances would settle it.
* **Sound.** Not started. The sequence interpreter already reads the sound
  numbers out of the byte-code and hands them to `effects.sound`, which
  nothing listens to. `DIGISND*.DAT` / `MIDISND*.DAT` hold the samples and
  the music; see the file inventory.
* **The clock.** The status bar shows hit points but not the time left.
* **Cut-scenes.** The princess, the mouse and the vizier are decoded but
  never animated.

* **After a climb the Prince stands still** where the original walks on
  along the floor he has just reached. The last twenty captures of the
  climbing session follow from that one difference.
* **A shut gate does not stop him.** He bumps into it, is pushed back the
  few units the bump is worth, and the next stride carries him past its
  face in one frame -- after which his column is the far side of it and
  nothing checks the tile behind him. Doing it properly means refusing the
  move rather than correcting it afterwards. `tests/game/gate.test.ts`
  records it.
* **Picking the sword up is half there.** The Prince carries one on every
  level but the first, and on level 1 he picks it up by standing on it,
  which runs the original's own sequence 91. Whether the original lets him
  walk onto that tile at all, or stops him in front of it, is not pinned;
  `getEdgeDistance` treats a sword on the floor as something to stop short
  of.
* **Bumping is only half there.** `checkBumped` in `src/game/kid.ts` stops
  the Prince at a wall he walks into, which is sequence 47. The original also
  has sequences 45 and 46 -- bumping while in the air, which knocks him down
  -- and neither is wired up. A gate's state is not consulted either: the
  bump treats any tile with a side to it as solid, so a gate that is open may
  stop him when it should not. No capture has caught that yet.

## Known oddities, recorded rather than smoothed over

* One capture in `tests/game/careful-step.test.ts` is three pixels out at
  (164..166, 126) and is pinned as unexplained. The session comparison sees
  what looks like the same thing during a fall, at (160..163, 126..128).
* Level 5's potion bubble leaves a three-pixel residual whose colour is in
  no game file.
* Torch flames are the one thing the comparisons ignore: the original picks
  each flame's phase at random when a room is entered.

## Conventions worth not breaking

* **Work on `main` and push.** The owner asked for that explicitly; there is
  no branch dance and no pull request unless asked.
* **Nothing is transcribed by hand that the original can be asked for.**
  Constants, frame tables and animation byte-code are read out of
  `PRINCE.EXE` at run time. If a number is needed, find where the original
  keeps it.
* **A behaviour is not finished until a capture of the original agrees with
  it.** `tools/oracle/dosbox_oracle.py` drives the real game; a capture is
  turned into a golden frame with `tools/oracle/make_golden.mjs`, which
  refuses anything that is not a clean 2x of 320x200. Where that was not
  possible, the test says so and why — see the head of
  `tests/game/hang.test.ts` for the form that takes.
* **Slow the emulator down for short moves.** A jump lasts about nine game
  ticks and a capture costs roughly half a second of real time, so at full
  speed a whole move falls between two captures. `--cycles 300` or `400`
  puts consecutive captures a tick or two apart.
* **After changing anything the page uses**: `npm run build`, then
  `node tools/dev/build-pages.mjs` for the GitHub Pages copy at the
  repository root (`index.html`, `game.js`). Both are committed.
* **Do not write to `.claude/`.** Claude Code guards that directory, and
  every attempt to put a permission file there raises an approval prompt —
  which is the opposite of what such a file is for. Permission rules are the
  owner's to set, from the app.

## Where the pieces are

```
src/dat/            the .DAT archive, palettes, images, level records
src/game/
  exe-constants.ts  numbers read out of PRINCE.EXE
  exe-tables.ts     frame tables and the animation byte-code, with its
                    packed holds expanded -- see the comment there
  sequence.ts       the byte-code interpreter
  control-latch.ts  the original's second layer of input: held, released,
                    ignored. This is what stops a held key repeating
  kid.ts            the Prince: what each key does in each state
  traps.ts          gates, buttons, loose floors, spikes, chompers
  guard.ts          guards: placement, colour, frames. No behaviour yet
  physics.ts        tiles, columns, edges, collision
  game.ts           one level, stepped twelve times a second
src/render/         indexed surface, room renderer, canvas
web/                the page: main.ts, index.html, artifact.html
tools/oracle/       the original under DOSBox, and the capture scripts
tools/dev/          tools for working out what the original did
```

## A good next step

In the order I would do them.

**More sessions.** Four bugs so far, all of them reachable in the first ten
seconds of play and none of them visible to the move-by-move comparisons.
An hour buys a session. Read what docs/testing.md says about what a session
can tell you first -- in particular, chase categorical differences and leave
the forty-pixel ones alone. Nothing yet covers the gates, the potions, or
a level other than the first.

**Guard behaviour**, which is the largest thing missing and the reason no
level can actually be finished. Guards are placed, coloured, drawn and hold
their swords correctly; nothing in `src/game/guard.ts` decides anything. In
order: `autocontrol_guard` -- how a guard notices the Prince and decides to
advance, retreat or wait, which reads `can_guard_see_kid` -- then drawing a
sword, then the fight itself. Be careful how this is arrived at. The
convention here is that what gets taken from elsewhere is a *description*
of a format, with the implementation written here and then checked against
the original's own output; guard logic copied out of another project would
not be that, and the licences differ. Capturing a fight and pinning it is
the honest route, and the session harness is the tool for it.

**Sound**, which is independent of everything above. The sequence
interpreter already reads the sound numbers out of the byte-code and hands
them to `effects.sound`, which nothing listens to.

**The clock** and the cut-scenes are the remainder.

