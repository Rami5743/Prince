#!/usr/bin/env python3
"""
Where the character is in each tick's picture.

The room does not move and the flames are masked, so what changes from
one tick to the next is the character. This prints the bounding box of
that change for each tick of a directory, which turns `the port draws
him somewhere else` and `the port does not draw him at all` into two
different and checkable statements.

  where.py <dir-of-ticks> [--from N] [--to N]

A line reads `t37  x 150..170  y 92..118  n 243`: the columns and rows
that changed and how many pixels did. `n 0` is a tick in which nothing
moved, which for a character in mid-air means it was not drawn.
"""
import argparse
import numpy as np
from segments import Frames, flames


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--from', dest='lo', type=int, default=0)
    ap.add_argument('--to', dest='hi', type=int, default=10 ** 9)
    args = ap.parse_args()
    f = Frames(args.dir)
    ticks = sorted(t for t in f.files if args.lo <= t <= args.hi)
    for t in ticks:
        a, b = f.get(t - 1), f.get(t)
        if a is None or b is None:
            continue
        d = (np.abs(a - b).max(axis=2) > 40) & ~flames(a, b)
        # The strip under the room is the words and the hit points, which
        # change for their own reasons.
        d[192:, :] = False
        ys, xs = np.nonzero(d)
        if len(xs) == 0:
            print(f't{t:<5d} nothing moved')
        else:
            print(f't{t:<5d} x {xs.min():3d}..{xs.max():3d}  '
                  f'y {ys.min():3d}..{ys.max():3d}  n {len(xs)}')


if __name__ == '__main__':
    main()
