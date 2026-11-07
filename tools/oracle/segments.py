#!/usr/bin/env python3
"""
Compare a recording with the original a segment at a time.

A whole-run comparison answers two questions at once -- is the port in
the same place at the same moment, and does it draw what is there the
same way -- and the first drowns the second. A room change costs the
emulator about four frames, two of them black and two in which the
character does not advance, so every tick after one is a couple out and
the picture-by-picture difference says nothing useful.

This cuts the run at the original's own room changes, lines each piece
up on its own, and reports what is left. Within a segment the two runs
are doing the same thing at the same moment, so a difference there is a
difference in the drawing or in the game, which is what we are looking
for.

  segments.py <dos-dir> <port-dir> [--window N] [--range N] [--worst N]

Each line is one segment: where it starts and ends, the offset that
lines it up, how many of its ticks are then identical, and the ticks
that are not, worst first.
"""
import argparse
import glob
import os
import re
import numpy as np
from PIL import Image

# What is left once the fire is masked out is small and not always
# nothing: a pixel here and there where a flame's glow fell on the
# stonework. Anything under this is "the same picture".
SAME = 12


def flames(d, p):
    """Where either picture has fire, grown by two pixels.

    A flame picks its next picture at random, so the two runs can never
    agree on one; masking them is what makes the rest comparable. The
    same rule as `compare_ticks.py`.
    """
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


def load(path):
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int16)


class Frames:
    def __init__(self, d):
        self.files = index(d)
        self.cache = {}

    def __contains__(self, t):
        return t in self.files

    def get(self, t):
        if t not in self.files:
            return None
        if t not in self.cache:
            if len(self.cache) > 600:
                self.cache.clear()
            self.cache[t] = load(self.files[t])
        return self.cache[t]


def differs(a, b):
    """Pixels that really differ, the way `drift_map.py` counts them: the
    worst channel out by more than forty, with the fire masked out. A
    looser test counts the video's own colour rounding as a difference.
    """
    return int(((np.abs(a - b).max(axis=2) > 40) & ~flames(a, b)).sum())


def is_blank(frame):
    return frame is not None and frame.mean() < 6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dos')
    ap.add_argument('port')
    ap.add_argument('--range', type=int, default=8,
                    help='how far to look for the offset that lines a segment up')
    ap.add_argument('--worst', type=int, default=6,
                    help='how many bad ticks to name per segment')
    args = ap.parse_args()

    dos = Frames(args.dos)
    port = Frames(args.port)
    ticks = sorted(dos.files)
    if not ticks:
        raise SystemExit('no frames in ' + args.dos)

    # The original blanks the screen for two ticks at every room change.
    # Those are the seams: within a stretch between them the two runs run
    # at the same rate.
    blanks = [t for t in ticks if is_blank(dos.get(t))]
    seams = []
    for t in blanks:
        if not seams or t > seams[-1] + 1:
            seams.append(t)
    bounds = [ticks[0]] + [t for t in seams] + [ticks[-1] + 1]
    bounds = sorted(set(bounds))

    total_exact = 0
    total_ticks = 0
    for i in range(len(bounds) - 1):
        lo, hi = bounds[i], bounds[i + 1]
        inside = [t for t in range(lo, hi) if t in dos and not is_blank(dos.get(t))]
        if not inside:
            continue
        best = None
        for off in range(-args.range, args.range + 1):
            scored = []
            for t in inside:
                b = port.get(t + off)
                # A tick the port does not have, and one it spends blank
                # on a room change of its own, say nothing about whether
                # the two agree; leaving them out of the mean is what
                # stops one of them choosing the offset.
                if b is None or is_blank(b):
                    continue
                scored.append((differs(dos.get(t), b), t))
            if len(scored) < max(1, len(inside) // 2):
                continue
            mean = sum(n for n, _ in scored) / len(scored)
            if best is None or mean < best[0]:
                best = (mean, off, scored)
        if best is None:
            print(f'{lo:5d}..{hi - 1:<5d} {len(inside):4d} ticks   no overlap')
            continue
        mean, off, scored = best
        exact = sum(1 for n, _ in scored if n <= SAME)
        total_exact += exact
        total_ticks += len(scored)
        bad = sorted((n, t) for n, t in scored if n > SAME)[::-1]
        named = ' '.join(f't{t}:{n}' for n, t in bad[:args.worst])
        print(f'{lo:5d}..{hi - 1:<5d} {len(scored):4d} ticks  offset {off:+3d}'
              f'  {exact:4d} identical  {named}')

    print(f'\n{total_exact} of {total_ticks} ticks identical once each stretch'
          f' between room changes is lined up on its own')


if __name__ == '__main__':
    main()
