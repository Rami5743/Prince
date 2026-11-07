#!/usr/bin/env python3
"""
Line two runs up tick by tick, letting the alignment slip as it goes.

`segments.py` cuts a run at the original's room changes and gives each
piece one offset. That is the right thing when the two runs are in step
within a piece, and they are not always: the emulator loses a little
time whenever it redraws, the recording's key events are sent on the
clock rather than on the game's ticks, and the hybrid tick splitter puts
a boundary where the picture changes, which near a room change is a
frame either way. A single offset per segment then calls a run that does
exactly the same thing a tick out "completely different".

This asks the other question: is the port doing the same thing at all,
and how far out of step is it? It walks the two runs together, allowing
the offset to move by one tick at a time, and reports how many of the
original's ticks have a picture in the port that matches -- together
with the drift it needed to find them.

  align.py <dos-dir> <port-dir> [--range N] [--slip C] [--worst N]

`--slip` is what a tick of drift costs against a pixel of difference;
raising it makes the alignment stiffer.
"""
import argparse
import glob
import os
import re
import numpy as np
from PIL import Image

SAME = 12


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


def index(d):
    out = {}
    for f in glob.glob(os.path.join(d, 't*.png')):
        m = re.search(r't(\d+)', os.path.basename(f))
        if m:
            out[int(m.group(1))] = f
    return out


class Frames:
    def __init__(self, d):
        self.files = index(d)
        self.cache = {}

    def get(self, t):
        if t not in self.files:
            return None
        if t not in self.cache:
            if len(self.cache) > 400:
                self.cache.clear()
            self.cache[t] = np.asarray(
                Image.open(self.files[t]).convert('RGB')).astype(np.int16)
        return self.cache[t]


def differs(a, b):
    return int(((np.abs(a - b).max(axis=2) > 40) & ~flames(a, b)).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dos')
    ap.add_argument('port')
    ap.add_argument('--range', type=int, default=8)
    ap.add_argument('--slip', type=float, default=40.0)
    ap.add_argument('--worst', type=int, default=8)
    ap.add_argument('--from', type=int, default=0, dest='first')
    ap.add_argument('--to', type=int, default=10 ** 9, dest='last')
    args = ap.parse_args()

    dos = Frames(args.dos)
    port = Frames(args.port)
    ticks = [t for t in sorted(dos.files) if args.first <= t <= args.last]
    offs = list(range(-args.range, args.range + 1))

    # cost[t][o] is how far out the two pictures are at that offset.
    cost = []
    for t in ticks:
        a = dos.get(t)
        row = []
        for o in offs:
            b = port.get(t + o)
            row.append(1e9 if b is None else differs(a, b))
        cost.append(row)

    # The cheapest walk through it, paying `slip` for every tick of drift.
    n, m = len(ticks), len(offs)
    best = [[0.0] * m for _ in range(n)]
    back = [[0] * m for _ in range(n)]
    best[0] = [float(c) for c in cost[0]]
    for i in range(1, n):
        for j in range(m):
            pick, val = j, best[i - 1][j]
            for k in (j - 1, j + 1):
                if 0 <= k < m and best[i - 1][k] + args.slip < val:
                    pick, val = k, best[i - 1][k] + args.slip
            best[i][j] = val + cost[i][j]
            back[i][j] = pick
    j = min(range(m), key=lambda j: best[n - 1][j])
    path = [0] * n
    for i in range(n - 1, -1, -1):
        path[i] = j
        j = back[i][j]

    matched = [i for i in range(n) if cost[i][path[i]] <= SAME]
    runs = []
    for i in range(n):
        o = offs[path[i]]
        if runs and runs[-1][0] == o:
            runs[-1][2] = ticks[i]
        else:
            runs.append([o, ticks[i], ticks[i]])
    print('drift: ' + '  '.join(f'{a}..{b}:{o:+d}' for o, a, b in runs))
    worst = sorted(range(n), key=lambda i: -cost[i][path[i]])[:args.worst]
    print('worst: ' + ' '.join(f't{ticks[i]}:{cost[i][path[i]]}' for i in worst))
    print(f'{len(matched)} of {n} ticks identical once the drift is allowed '
          f'to move a tick at a time')


if __name__ == '__main__':
    main()
