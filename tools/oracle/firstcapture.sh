#!/usr/bin/env bash
# The first captures of a recording that has no digest yet.
#
#   tools/oracle/firstcapture.sh <name> <shift> [tries] [workdir]
#
# `recapture.sh` is for a recording already in `digests/`: it keeps the
# old digest safe while it scores the candidates and puts it back. A
# new recording has nothing to keep, and scoring a candidate still
# means putting it in `digests/` for a moment -- so this does the same
# dance with an empty hand, and leaves `digests/<name>.json` holding
# the best of the tries.
#
# Everything else is `recapture.sh`: why more than once, and why
# keeping the best of several is not fitting the oracle to the port,
# are written up there and in `tools/oracle/README.md`.
set -euo pipefail
name=${1:?usage: firstcapture.sh <name> <shift> [tries] [workdir]}
shift_=${2:?}
tries=${3:-4}
work=${4:-/tmp/firstcapture}
repo=$(cd "$(dirname "$0")/../.." && pwd)
digest="$repo/tools/oracle/digests/$name.json"
rec="$repo/tools/oracle/recordings/$name.json"
[ -f "$rec" ] || { echo "$name: no recording"; exit 2; }
mkdir -p "$work"
# `recording_to_script.mjs` prints the second it sends Ctrl+A on, which
# is where `split_ticks.py --after-blank` has to start looking for the
# restart flash. It used to be worked out here as
# `27 + 10 * (level - 1)`, and that went wrong the moment the skip wait
# stopped being the same for every level: the game plays a cutscene
# before levels 2, 4, 6, 8, 9 and 12, and the generator now waits for
# it. Asking the generator is the only way to keep the two in step.
start=$(node "$repo/tools/oracle/recording_to_script.mjs" "$rec" "$work/$name-$shift_.txt" \
  --settle 0.04 --shift "$shift_" 2>&1 >/dev/null | sed -n 's/^search from //p')
[ -n "$start" ] || { echo "$name: the generator did not say where to search"; exit 2; }
had=0; [ -f "$digest" ] && { had=1; cp "$digest" "$work/$name.json.was"; }
restore(){ if [ "$had" = 1 ]; then cp "$work/$name.json.was" "$digest"; else rm -f "$digest"; fi; }
trap restore EXIT
best=; bestscore=-1
for i in $(seq 1 "$tries"); do
  d="$work/$name-s$shift_-$i"
  rm -rf "${d:?}"; mkdir -p "$d"
  nice -n 19 python3 "$repo/tools/oracle/dosbox_oracle.py" --script "$work/$name-$shift_.txt" \
    --out "$d/rep" --record "$d/run.mkv" --fps 30 --cycles 20000 >/dev/null 2>&1 || true
  nice -n 19 python3 "$repo/tools/oracle/split_ticks.py" "$d/run.mkv" "$d/dos" \
    --crop 640:400:0:0 --scale 320:200 --start "$start" --after-blank \
    --fps 30 --rate 12 --hybrid --anchor-text 25 >/dev/null 2>&1 || true
  [ -d "$d/dos" ] || { echo "  $name shift $shift_ try $i: no ticks"; continue; }
  python3 "$repo/tools/oracle/digest.py" "$d/dos" "$d/$name.json" >/dev/null 2>&1 || continue
  cp "$d/$name.json" "$digest"
  out=$(cd "$repo" && npx tsx tools/dev/pop-report.ts "$name" 2>/dev/null || true)
  line=${out%%$'\n'*}
  score=$(awk '{print $2}' <<<"$line")
  echo "  $name shift $shift_ try $i: $line"
  if [ -n "${score:-}" ] && [ "$score" -gt "$bestscore" ]; then bestscore=$score; best=$d; fi
done
restore; trap - EXIT
[ -n "$best" ] || { echo "$name: no usable capture at shift $shift_"; exit 1; }
cp "$best/$name.json" "$work/$name-s$shift_.json"
echo "$name: shift $shift_ best $bestscore -> $work/$name-s$shift_.json"
