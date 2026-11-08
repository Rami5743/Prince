#!/usr/bin/env python3
"""
Does the original agree with itself?

    agree.py <dir-a> <dir-b> [--slip 6]

Two directories of pictures written by `split_ticks.py`, from two
captures of *the same recording at the same key shift* -- two separate
runs of DOSBox, hours apart if you like. The original is deterministic,
so outside the mask the two should be the same pictures tick for tick.
Where they are not, the mask is too small, and every tick the mask is
too small for is a tick the port is marked wrong on for something the
original does not reproduce either.

This is the measurement's own test, and it is the only one that can
fail honestly: everything else compares the port with one capture and
cannot tell a fault in the port from a fault in the capture.

What it found, on `0fbffa60` captured twice with the same schedule:
658 of 724 ticks agreed while a room change meant half the screen
changing, and 716 of 724 once it meant fifteen per cent of it. The
sixty-odd in between were the bubbles of the potion in room 5, which
`start_anim_potion` starts at `prandom(6) + 1` and no two runs of the
original agree about.

`--slip n` allows the two captures to be numbered up to n ticks apart,
which they are when one of them was split by an older `split_ticks.py`.
A capture split by the current one needs no slip, and the count of
ticks that needed one is printed.
"""
import glob
import os
import re
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from digest import TOLERANCE, flame_mask  # noqa: E402


def load(directory):
    """Every picture in a capture directory, by tick."""
    out = {}
    for path in sorted(glob.glob(os.path.join(directory, 't*.png'))):
        n = int(re.search(r't(\d+)', os.path.basename(path)).group(1))
        out[n] = np.array(Image.open(path).convert('RGB')).astype(np.int16)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    slip = 6
    if '--slip' in sys.argv:
        slip = int(sys.argv[sys.argv.index('--slip') + 1])
    if len(args) != 2:
        print(__doc__.strip())
        return 2
    a = load(args[0])
    b = load(args[1])
    if not a or not b:
        print('no pictures in one of the directories')
        return 2
    # The mask is the first capture's, which is the one a digest of it
    # would carry.
    frames = [a.get(i) for i in range(max(a) + 1)]
    keep = ~flame_mask(frames)
    agreed = 0
    slipped = 0
    bad = []
    for i in sorted(a):
        best = None
        for k in range(-slip, slip + 1):
            j = i + k
            if j not in b:
                continue
            if (np.abs(a[i] - b[j]).max(axis=2) > TOLERANCE)[keep].sum() == 0:
                best = k
                break
        if best is None:
            bad.append(i)
        else:
            agreed += 1
            slipped += best != 0
    print(f'{agreed} of {len(a)} ticks agree outside the mask '
          f'({keep.size - keep.sum()} pixels masked, {slipped} needed a slip)')
    if bad:
        print('not agreed: ' + ' '.join(str(i) for i in bad[:40])
              + (' ...' if len(bad) > 40 else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
