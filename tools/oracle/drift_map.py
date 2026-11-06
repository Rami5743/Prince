#!/usr/bin/env python3
"""
Difference map that re-finds the alignment as it goes.

A run that includes a death cannot be compared at one fixed offset. The
emulator's Prince and the port's need not die on the same tick, the
prompt that follows is forty-five ticks later in both, and the button
that answers it is whichever press the player happened to make next --
so the two levels start again a few ticks apart and everything after is
late rather than different. A fixed offset paints that whole stretch as
wrong.

This walks the run in windows and, for each, keeps the offset that fits
best, printing it alongside the map. A window whose mean difference is
near zero at a shifted offset is the port doing exactly what the
original does, a little later.

  drift_map.py <dos-dir> <port-dir> [--limit N] [--window N] [--range N]

The offsets it reports are only trustworthy while the differences are
small: once a window is genuinely different, the best offset for it is
noise, and the search will wander. Read the map first and the offsets
second.
"""
import argparse, glob, os, re
import numpy as np
from PIL import Image


def index(d):
    out = {}
    for p in glob.glob(os.path.join(d, 't*.png')):
        m = re.search(r't(\d+)\.png$', os.path.basename(p))
        if m:
            out[int(m.group(1))] = p
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dos')
    ap.add_argument('port')
    ap.add_argument('--limit', type=int, default=1400)
    ap.add_argument('--window', type=int, default=25)
    ap.add_argument('--range', type=int, default=20)
    ap.add_argument('--rows', type=int, default=182)
    ap.add_argument('--settle', type=int, default=400,
                    help='stop moving the offset once a window is this far out')
    a = ap.parse_args()

    dos, port = index(a.dos), index(a.port)
    cache = {}

    def load(which, t):
        key = (which, t)
        if key not in cache:
            p = (dos if which == 'd' else port).get(t)
            cache[key] = None if p is None else np.asarray(
                Image.open(p).convert('RGB'), dtype=np.int16)[:a.rows]
            if len(cache) > 4000:
                cache.clear()
        return cache[key]

    def hot(x):
        r, g, b = x[..., 0], x[..., 1], x[..., 2]
        return (r > 140) & (b < 120) & (r > b + 60)

    def diff(x, y):
        if x is None or y is None:
            return None
        m = hot(x) | hot(y)
        o = m.copy()
        for k in (-2, -1, 1, 2):
            o |= np.roll(m, k, axis=0)
            o |= np.roll(m, k, axis=1)
        return int(((np.abs(x - y).max(axis=2)) * ~o > 40).sum())

    line = ''
    offsets = []
    off = 0
    for start in range(0, a.limit, a.window):
        best = (None, off)
        for cand in range(off - a.range, off + a.range + 1):
            tot = n = 0
            for t in range(start, min(start + a.window, a.limit), 3):
                v = diff(load('d', t), load('p', t + cand))
                if v is None:
                    continue
                tot += v
                n += 1
            if n and (best[0] is None or tot / n < best[0]):
                best = (tot / n, cand)
        # Once a window is badly out, the offset that fits it best means
        # nothing; keep the one that was working rather than wander off.
        if best[0] is not None and best[0] < a.settle:
            off = best[1]
        offsets.append((start, off, int(best[0]) if best[0] is not None else -1))
        for t in range(start, min(start + a.window, a.limit)):
            v = diff(load('d', t), load('p', t + off))
            line += ' ' if v is None else '.' if v < 25 else ',' if v < 150 \
                else ':' if v < 800 else '#'
    for i in range(0, len(line), 100):
        print(f'{i:4d} {line[i:i + 100]}')
    print(f'exact {line.count(".")}/{len(line)}   '
          '. exact  , <150  : <800  # big')
    print('offsets:', ' '.join(f'{s}:{o:+d}({m})' for s, o, m in offsets if m >= 0))


if __name__ == '__main__':
    main()
