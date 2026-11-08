#!/usr/bin/env python3
"""
The first tick on which two captures of the same recording part company.

Each recording is captured twice, the second time with the whole key
schedule a tick later (`recording_to_script.mjs --shift 1`), because
where the schedule's clock sits inside one of the game's ticks is not
something the replay can choose -- see tools/oracle/README.

This is a diagnostic, not a step of the pipeline. It was the pipeline
once: `tools/dev/pick-shift.ts` used to keep whichever capture the port
agreed with on this one tick. That is wrong whenever the port is
itself wrong about this tick, which is a tick chosen for being the
first thing the keys change and so exactly the sort of tick a port
gets wrong. `probeF` is the case that showed it -- the single tick
chose the capture the port draws 459 of, over the one it draws 1053
of. The picker now counts whole runs.

What it is still good for is saying whether two captures are the same
run at all, and where to start looking when they are not.

  first_divergence.py <dir-shift0> <dir-shift1> <recording.json>

Prints the tick, or `none` if the two captures are the same run.
"""
import glob
import os
import re
import sys
import numpy as np
from PIL import Image

TOLERANCE = 40
#: As in digest.py: a pixel that changes on more than this fraction of
#: the ticks is a flame, and no two runs agree on those.
FLAME_SHARE = 0.12
FLAME_GROW = 6


def load(path):
    out = {}
    for f in glob.glob(os.path.join(path, 't*.png')):
        m = re.search(r't(\d+)', os.path.basename(f))
        if m:
            out[int(m.group(1))] = np.asarray(
                Image.open(f).convert('RGB')).astype(np.int16)[0:192]
    return out


def flames(frames):
    ts = sorted(frames)
    pairs = [(frames[a], frames[b]) for a, b in zip(ts, ts[1:]) if b == a + 1]
    hot = np.zeros((192, 320), dtype=bool)
    if len(pairs) >= 8:
        counts = np.zeros((192, 320), dtype=np.int32)
        for a, b in pairs:
            counts += (np.abs(a - b).max(axis=2) > TOLERANCE)
        hot = counts > FLAME_SHARE * len(pairs)
    out = hot.copy()
    for _ in range(FLAME_GROW):
        prev = out.copy()
        for d in (-1, 1):
            out |= np.roll(prev, d, axis=0)
            out |= np.roll(prev, d, axis=1)
    return out


def first_press(path):
    """The first tick the player pressed anything. Nothing before it can
    tell the two captures apart, and the first tick or two of a capture
    are whatever the video happened to catch."""
    import json
    for e in json.load(open(path)).get('events', []):
        if e.get('type') == 'down':
            return int(e['tick'])
    return 0


def main():
    a = load(sys.argv[1])
    b = load(sys.argv[2])
    if not a or not b:
        print('none  (a capture is empty)')
        return
    start = first_press(sys.argv[3]) if len(sys.argv) > 3 else 0
    mask = flames(a) | flames(b)
    for t in sorted(t for t in set(a) & set(b) if t >= start):
        if (((np.abs(a[t] - b[t]).max(axis=2) > TOLERANCE)) & ~mask).sum() > 0:
            print(t)
            return
    print('none')


if __name__ == '__main__':
    main()
