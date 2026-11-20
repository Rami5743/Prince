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
# A spec with `"levels": "potion"` is measured against a copy of the
# game directory with `src/dat/potion-level.ts` written into
# LEVELS.DAT -- the only way the six potions can be reached at all,
# since the game's own feather is at the bottom of a shaft in level 7
# and its two inversion potions are thirteen levels in.
# `original/prince1` is never written to; the copy is made here.
levels=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get('levels',''))" "$spec")
gameopt=()
if [ "$levels" = potion ]; then
  gamedir="$work/$name.gamedir"
  rm -rf "${gamedir:?}"
  (cd "$repo" && npx tsx tools/dev/potion-game-dir.ts "$gamedir") >/dev/null
  gameopt=(--game "$gamedir")
fi
rec=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get('recording',''))" "$spec")
if [ -n "$rec" ]; then
  # A recording is reached the way every picture capture reaches one,
  # and the generated script is used unchanged but for the `wave` that
  # starts the recorder before anything is played. The schedule is not
  # touched: `wave` is one `xdotool key` before `origin`.
  sh=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1])).get('shift',0))" "$spec")
  node "$repo/tools/oracle/recording_to_script.mjs" \
    "$repo/tools/oracle/recordings/$rec.json" "$work/$name.body.txt" \
    --settle 0.04 --shift "$sh" >/dev/null 2>&1
  { echo wave; cat "$work/$name.body.txt"; echo "wait 2"; } > "$work/$name.txt"
  # The restart is the run's own tick nought and the generator prints
  # the second it falls on, so a recording's offset is known and not
  # searched for. It is known to a few tenths -- the script's clock is
  # not the emulator's -- and `scoreNoise` refines it half a second
  # either way and no further. Letting it go free was tried first and
  # it chose an offset two and a half seconds out on one coincidence.
  origin=$(node "$repo/tools/oracle/recording_to_script.mjs" \
    "$repo/tools/oracle/recordings/$rec.json" /dev/null --settle 0.04 \
    --shift "$sh" 2>&1 >/dev/null | sed -n 's/^restart at //p')
else
  python3 -I -c "import json,sys; print('\n'.join(json.load(open(sys.argv[1]))['script']))" "$spec" \
    > "$work/$name.txt"
fi
had=0; [ -f "$digest" ] && { had=1; cp "$digest" "$work/$name.json.was"; }
restore(){ if [ "$had" = 1 ]; then cp "$work/$name.json.was" "$digest"; else rm -f "$digest"; fi; }
trap restore EXIT
best=; bestscore=-1
for i in $(seq 1 "$tries"); do
  d="$work/$name-$i"
  rm -rf "${d:?}"; mkdir -p "$d"
  nice -n 19 python3 "$repo/tools/oracle/dosbox_oracle.py" --script "$work/$name.txt" \
    --out "$d/rep" --cycles 20000 --speaker "${gameopt[@]}" >/dev/null 2>&1 || true
  wav=$(find "$d/rep" -name '*.wav' | head -1)
  [ -n "$wav" ] || { echo "  $name try $i: no wave"; continue; }
  python3 -I "$repo/tools/oracle/sound_notes.py" "$wav" "$d/$name.sound.json" \
    ${origin:+--origin "$origin"} >/dev/null || continue
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
