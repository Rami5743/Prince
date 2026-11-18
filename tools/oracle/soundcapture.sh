#!/usr/bin/env bash
# What the original plays, recorded.
#
#   tools/oracle/soundcapture.sh <name> [tries] [workdir]
#
# `scenecapture.sh` for the ear instead of the eye. The differences:
#
# * DOSBox is run with `--speaker`, which lets the mixer carry the PC
#   speaker's square wave. It changes nothing else: the game's speaker
#   code, its timer interrupts and every `check_sound_playing()` built
#   on them run whatever the mixer does with the result, so a sound
#   capture is the same run as a picture capture and the picture
#   digests taken with the speaker off stay valid.
# * the script's own `wave` lines toggle DOSBox's recorder, which taps
#   the mixer and so works with `nosound=true` and costs no wall clock;
# * `sound_notes.py` turns the WAV into notes and the digest is that
#   list, written to `digests/<name>.sound.json`.
#
# The video is not grabbed at all. The notes carry their own clock --
# the offset against the port is searched for, as a scene's is -- and
# not running ffmpeg leaves the emulator the whole processor.
set -euo pipefail
name=${1:?usage: soundcapture.sh <name> [tries] [workdir]}
tries=${2:-2}
work=${3:-/tmp/soundcapture}
repo=$(cd "$(dirname "$0")/../.." && pwd)
spec="$repo/tools/oracle/sounds/$name.json"
digest="$repo/tools/oracle/digests/$name.sound.json"
[ -f "$spec" ] || { echo "$name: no sound spec"; exit 2; }
mkdir -p "$work"
python3 -I - "$spec" > "$work/$name.txt" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1]))
print('\n'.join(spec['script']))
PY
had=0; [ -f "$digest" ] && { had=1; cp "$digest" "$work/$name.json.was"; }
restore(){ if [ "$had" = 1 ]; then cp "$work/$name.json.was" "$digest"; else rm -f "$digest"; fi; }
trap restore EXIT
best=; bestscore=-1
for i in $(seq 1 "$tries"); do
  d="$work/$name-$i"
  rm -rf "${d:?}"; mkdir -p "$d"
  nice -n 19 python3 "$repo/tools/oracle/dosbox_oracle.py" --script "$work/$name.txt" \
    --out "$d/rep" --cycles 20000 --speaker >/dev/null 2>&1 || true
  wav=$(find "$d/rep" -name '*.wav' | head -1)
  [ -n "$wav" ] || { echo "  $name try $i: no wave"; continue; }
  python3 -I "$repo/tools/oracle/sound_notes.py" "$wav" "$d/$name.sound.json" >/dev/null || continue
  cp "$d/$name.sound.json" "$digest"
  out=$(cd "$repo" && npx tsx tools/dev/sound-report.ts "$name" 2>/dev/null | head -1 || true)
  score=$(awk '{print $2}' <<<"$out")
  echo "  $name try $i: $out"
  if [ -n "${score:-}" ] && [ "$score" -gt "$bestscore" ]; then
    bestscore=$score; best="$d"
  fi
done
restore; trap - EXIT
[ -n "$best" ] || { echo "$name: no usable capture"; exit 1; }
cp "$best/$name.sound.json" "$work/$name.sound.json"
echo "$name: best $bestscore -> $work/$name.sound.json"
