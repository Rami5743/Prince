#!/usr/bin/env bash
# A capture of one of the original's scenes, taken more than once.
#
#   tools/oracle/scenecapture.sh <name> [tries] [workdir]
#
# `firstcapture.sh` for `tools/oracle/scenes/<name>.json` instead of a
# recording. The differences are all in what a scene is:
#
# * there are no keys in a scene, so there is no `--shift` and no
#   phase lottery to take several captures against -- the tries are
#   there only because DOSBox occasionally fails to start, and because
#   the chain that reaches a scene by playing can lose a `shift+l`;
# * the unit is a video frame and not a game tick, so
#   `scene_frames.py` cuts the video and not `split_ticks.py`, and
#   there is no `--start` search for a restart flash and no
#   `--anchor-text`: the scene's own `start` in the spec says where in
#   the video it is, and `tools/dev/scene-report.ts` finds the frame
#   it begins on by looking;
# * `digest.py --cutscene` masks the six stars and the two torches of
#   the princess's room, which come out of `prandom`.
set -euo pipefail
name=${1:?usage: scenecapture.sh <name> [tries] [workdir]}
tries=${2:-2}
work=${3:-/tmp/scenecapture}
repo=$(cd "$(dirname "$0")/../.." && pwd)
spec="$repo/tools/oracle/scenes/$name.json"
digest="$repo/tools/oracle/digests/$name.json"
[ -f "$spec" ] || { echo "$name: no scene spec"; exit 2; }
mkdir -p "$work"
python3 - "$spec" > "$work/$name.txt" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1]))
print('\n'.join(spec['script']))
PY
start=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('start',0))" "$spec")
had=0; [ -f "$digest" ] && { had=1; cp "$digest" "$work/$name.json.was"; }
restore(){ if [ "$had" = 1 ]; then cp "$work/$name.json.was" "$digest"; else rm -f "$digest"; fi; }
trap restore EXIT
best=; bestscore=-1
for i in $(seq 1 "$tries"); do
  d="$work/$name-$i"
  rm -rf "${d:?}"; mkdir -p "$d"
  nice -n 19 python3 "$repo/tools/oracle/dosbox_oracle.py" --script "$work/$name.txt" \
    --out "$d/rep" --record "$d/run.mkv" --fps 30 --cycles 20000 >/dev/null 2>&1 || true
  nice -n 19 python3 "$repo/tools/oracle/scene_frames.py" "$d/run.mkv" "$d/frames" \
    --fps 30 --start "$start" >/dev/null 2>&1 || true
  [ -d "$d/frames" ] || { echo "  $name try $i: no frames"; continue; }
  python3 "$repo/tools/oracle/digest.py" "$d/frames" "$d/$name.json" --cutscene >/dev/null 2>&1 || continue
  cp "$d/$name.json" "$digest"
  out=$(cd "$repo" && npx tsx tools/dev/scene-report.ts "$name" 2>/dev/null | head -1 || true)
  score=$(awk '{print $2}' <<<"$out")
  echo "  $name try $i: $out"
  if [ -n "${score:-}" ] && [ "$score" -gt "$bestscore" ]; then
    bestscore=$score; best="$d"
  fi
done
restore; trap - EXIT
[ -n "$best" ] || { echo "$name: no usable capture"; exit 1; }
cp "$best/$name.json" "$work/$name.json"
echo "$name: best $bestscore -> $work/$name.json"
