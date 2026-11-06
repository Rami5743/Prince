#!/usr/bin/env python3
"""
Compare the port's frames with the original's, tick by tick.

Both sides are a directory of PNGs named by tick -- `split_ticks.py` makes
the original's out of a grabbed video, `replay-frames.ts` makes the
port's. The original's picture is the emulator's own output scaled back
down, so the colours are near but not bit-exact; `--tolerance` is how far
apart a channel may be before a pixel counts as different, and
`--min-pixels` how many such pixels make a tick a difference.

  compare_ticks.py <dos-dir> <port-dir> [--offset N] [--out DIR]
                   [--first N] [--limit N]

`--offset` shifts the port's tick numbering against the original's.
"""
import argparse, glob, os, re
import numpy as np
from PIL import Image


def flames(d, p):
    """Where either picture has fire, grown by two pixels."""
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


def load(path, size):
    im = Image.open(path).convert('RGB')
    if im.size != size:
        im = im.resize(size, Image.BILINEAR)
    return np.asarray(im, dtype=np.int16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dos')
    ap.add_argument('port')
    ap.add_argument('--offset', type=int, default=0,
                    help='port tick = original tick + offset')
    ap.add_argument('--out', default=None, help='write pictures of the first differences here')
    ap.add_argument('--first', type=int, default=8, help='how many differences to picture')
    ap.add_argument('--limit', type=int, default=0, help='stop after this many ticks')
    ap.add_argument('--tolerance', type=int, default=24)
    ap.add_argument('--min-pixels', type=int, default=12)
    ap.add_argument('--skip-rows', type=int, default=16,
                    help='ignore this many rows at the bottom (the status bar)')
    ap.add_argument('--keep-flames', action='store_true',
                    help='do not mask the torches out')
    a = ap.parse_args()

    def ticks_of(d):
        out = {}
        for p in glob.glob(os.path.join(d, 't*.png')):
            m = re.search(r't(\d+)\.png$', p)
            if m:
                out[int(m.group(1))] = p
        return out

    dos = ticks_of(a.dos)
    port = ticks_of(a.port)
    if not dos or not port:
        raise SystemExit(f'nothing to compare: {len(dos)} / {len(port)}')
    size = Image.open(sorted(dos.values())[0]).size
    if a.out:
        os.makedirs(a.out, exist_ok=True)

    shown = 0
    first_bad = None
    bad = 0
    checked = 0
    worst = []
    for t in sorted(dos):
        if a.limit and t >= a.limit:
            break
        pt = t + a.offset
        if pt not in port:
            continue
        d = load(dos[t], size)
        p = load(port[pt], size)
        h = size[1] - a.skip_rows
        d, p = d[:h], p[:h]
        diff = np.abs(d - p).max(axis=2)
        if not a.keep_flames:
            # A flame picks its next frame at random, so the two sides can
            # never agree on one and the fire would drown out everything
            # else. Anything flame-coloured on either side, and its
            # immediate surroundings, is left out of the count.
            diff = diff * ~flames(d, p)
        n = int((diff > a.tolerance).sum())
        checked += 1
        worst.append((n, t))
        if n >= a.min_pixels:
            bad += 1
            if first_bad is None:
                first_bad = t
            if a.out and shown < a.first:
                shown += 1
                ys, xs = np.where(diff > a.tolerance)
                box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
                canvas = Image.new('RGB', (size[0] * 3 + 16, size[1]), (20, 20, 20))
                canvas.paste(Image.open(dos[t]).convert('RGB'), (0, 0))
                canvas.paste(Image.open(port[pt]).convert('RGB').resize(size), (size[0] + 8, 0))
                mask = Image.fromarray(((diff > a.tolerance) * 255).astype(np.uint8))
                canvas.paste(mask.convert('RGB'), (size[0] * 2 + 16, 0))
                canvas.save(os.path.join(a.out, f'diff-t{t:05d}.png'))
                print(f'  tick {t}: {n} pixels, box {box}')
    worst.sort(reverse=True)
    print(f'{checked} ticks compared, {bad} differ by {a.min_pixels}+ pixels')
    if first_bad is not None:
        print(f'first difference at original tick {first_bad} (port tick {first_bad + a.offset})')
    print('worst:', ', '.join(f't{t}:{n}' for n, t in worst[:10]))


if __name__ == '__main__':
    main()
