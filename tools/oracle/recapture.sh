#!/usr/bin/env bash
# Capture one recording several times and keep the best of them.
#
#   tools/oracle/recapture.sh <name> <shift> [tries] [workdir] [rate]
#
# It writes the winner to <workdir>/<name>.json and prints every
# try's score, so the spread is on the record.
#
# ## Why more than once
#
# Three captures of `9b60bf3a` at the same shift, minutes apart on an
# idle machine, scored 529, 290 and 456 of its 557 ticks against an
# unchanged port; a fourth scored 187. The run is the same every
# time. What moves is where the capture thinks each tick begins:
# `split_ticks.py` finds the Ctrl+A restart by the frame the screen
# goes black and numbers every tick from it, a video frame is two and
# a half ticks' worth of time at 30 fps, and a run has stretches in
# which nothing on the screen moves at all -- the torches pick their
# flame from the game's random numbers -- so a tick there has to be
# interpolated. Either can put the whole numbering out by a tick.
#
# ## Why keeping the best is not fitting the oracle to the port
#
# How black the flash frame was, and how many ticks the splitter had
# to invent, were both tried as a way of telling a good capture from
# a bad one without scoring it. Neither predicts the score: the
# 187 had a change for every one of its ticks, and the 529's flash
# was the blackest of a set whose scores ranged over three hundred.
# So the score is the only measure there is.
#
# Using it is still sound, because every capture is of the same run
# of the same original. A tick the port draws wrongly is drawn
# wrongly against all of them, so no capture can hide it; what varies
# between captures is only their own numbering, which can only ever
# subtract from the agreement. The best of several is therefore the
# closest estimate of the port's own error, and more tries can only
# move it towards the truth.
set -euo pipefail
name=${1:?usage: recapture.sh <name> <shift> [tries] [workdir]}
shift_=${2:?}
tries=${3:-3}
work=${4:-/tmp/recapture}
# The tick rate the key schedule is written at. Twelve a second is the
# nominal one; the emulator's own game clock is a shade slower, and
# over a long run that difference is whole ticks of key timing.
rate=${5:-12}
repo=$(cd "$(dirname "$0")/../.." && pwd)
digest="$repo/tools/oracle/digests/$name.json"
mkdir -p "$work"
# One second before the Ctrl+A, which the generator prints: the level's
# own fade, a tenth of a second after Return, is over by 26.5, so
# looking from one second before the restart finds its flash and not
# that one. It used to be `27 + 10 * (level - 1)` here, which stopped
# being right when the skip wait grew for the levels the game plays a
# cutscene before.
start=$(node "$repo/tools/oracle/recording_to_script.mjs" \
  "$repo/tools/oracle/recordings/$name.json" "$work/$name.txt" \
  --settle 0.04 --shift "$shift_" --rate "$rate" 2>&1 >/dev/null \
  | sed -n 's/^search from //p')
[ -n "$start" ] || { echo "$name: the generator did not say where to search"; exit 2; }
# Kept outside the repository: scoring a candidate means putting it
# in `digests/` for a moment, and a stray file there is a stray file
# in a commit.
keep="$work/$name.json.was"
cp "$digest" "$keep"
trap 'cp "$keep" "$digest"; rm -f "$keep"' EXIT
best=; bestscore=-1
for i in $(seq 1 "$tries"); do
  d="$work/$name-$i"
  rm -rf "${d:?}"; mkdir -p "$d"
  nice -n 19 python3 "$repo/tools/oracle/dosbox_oracle.py" --script "$work/$name.txt" \
    --out "$d/rep" --record "$d/run.mkv" --fps 30 --cycles 20000 >/dev/null 2>&1 || true
  nice -n 19 python3 "$repo/tools/oracle/split_ticks.py" "$d/run.mkv" "$d/dos" \
    --crop 640:400:0:0 --scale 320:200 --start "$start" --after-blank \
    --fps 30 --rate 12 --hybrid --anchor-text 25 >/dev/null 2>&1 || true
  [ -d "$d/dos" ] || { echo "  try $i: no ticks"; continue; }
  python3 "$repo/tools/oracle/digest.py" "$d/dos" "$d/$name.json" >/dev/null 2>&1 || continue
  cp "$d/$name.json" "$digest"
  # The whole of the report and then its first line, not `| head -1`.
  # `set -o pipefail` is on, and `head` closing the pipe after one line
  # kills `tsx` with SIGPIPE often enough to matter: the substitution
  # comes back non-zero, `set -e` takes the script out through its own
  # trap, and the run ends after one try with no winner and no error.
  # It cost a whole capture of `f6874819`.
  out=$(cd "$repo" && npx tsx tools/dev/pop-report.ts "$name" 2>/dev/null || true)
  line=${out%%$'\n'*}
  score=$(awk '{print $2}' <<<"$line")
  echo "  try $i: $line"
  if [ -n "${score:-}" ] && [ "$score" -gt "$bestscore" ]; then bestscore=$score; best=$i; fi
done
cp "$keep" "$digest"
[ -n "$best" ] || { echo "$name: no usable capture"; exit 1; }
cp "$work/$name-$best/$name.json" "$work/$name.json"
echo "$name: keeping try $best, $bestscore exact -> $work/$name.json"
