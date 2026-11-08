# Read this first

## THE JOB IN HAND: close the last of the difference

`src/pop` is a direct translation of https://github.com/NagyD/SDLPoP
and it is now the game the player plays: `web/main.ts` starts
`PopGame`, and `game.js` carries it. The plan and what was kept is
`docs/sdlpop-translation.md`.

Where it stands, measured by `tools/dev/pop-report.ts` against the
nineteen captures of a real PRINCE.EXE:

* the translation draws **10605 of 11094** ticks exactly;
* the hand-written port, which it replaced, drew 10380. That port is
  still in `src/game` and on `backup/handwritten-port`; nothing but
  its own unit tests uses it now.
* Thirteen of the nineteen runs are exact or within one tick. What is
  left is mostly `13ab6867` (158), `9b60bf3a` (104), `0fbffa60` (94),
  `760c3e74` (63) and `b4ff4672` (35); tasks 35, 37 and 38 say what is
  known about three of them.

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
