#!/usr/bin/env python3
"""
Boil a capture down to something small enough to keep.

A capture is five hundred pictures and twenty megabytes, which is not a
thing to put in a repository, and without it in the repository the ten
recordings the player sent can only be compared by hand on a machine
that happens to have the captures lying about.

What a comparison actually reads is not the pictures but what moved: the
box around whatever changed from one tick to the next, and how much of
it there was. That is four numbers and a count per tick, it is the same
on both sides whatever the palette is doing, and the whole of a run fits
in a few kilobytes.

  digest.py <dir> <out.json>

The flames are masked out, as everywhere else: a fire picks its next
picture at random and the two sides can never agree on one.
"""
import glob
import json
import os
import re
import sys
import numpy as np
from PIL import Image


def flames(d, p):
    def hot(a):
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        return (r > 140) & (b < 120) & (r > b + 60)
    m = hot(d) | hot(p)
    out = m.copy()
    for dy in (-2, -1, 1, 2):
        out |= np.roll(m, dy, axis=0)
    for dx in (-2, -1, 1, 2):
        out |= np.roll(m, dx, axis=1)
    return out


def moved(a, b):
    """Where the picture changed, as [x0, y0, x1, y1, n], or None."""
    d = (np.abs(a - b).max(axis=2) > 40) & ~flames(a, b)
    ys, xs = np.nonzero(d)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), int(d.sum())]


def digest_dir(path):
    files = {}
    for f in glob.glob(os.path.join(path, 't*.png')):
        m = re.search(r't(\d+)', os.path.basename(f))
        if m:
            files[int(m.group(1))] = f
    out = []
    prev = None
    for t in sorted(files):
        now = np.asarray(Image.open(files[t]).convert('RGB')).astype(np.int16)
        out.append(None if prev is None else moved(prev, now))
        prev = now
    return out


if __name__ == '__main__':
    ticks = digest_dir(sys.argv[1])
    with open(sys.argv[2], 'w') as f:
        json.dump({'ticks': ticks}, f, separators=(',', ':'))
    print(f'{len(ticks)} ticks -> {sys.argv[2]}')
