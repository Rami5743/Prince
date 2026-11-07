#!/usr/bin/env python3
"""
Boil a capture down to something small enough to keep -- and exact.

A capture is a thousand pictures and twenty-five megabytes, which is not
a thing to put in a repository, and without it in the repository the
recordings the player sends can only be compared by hand on a machine
that happens to have the captures lying about.

## What this used to be, and why it is not that any more

The first version kept, per tick, the box around whatever had changed
since the tick before and how many pixels of it there were. That is
small and it is robust, but it is weak: two quite different pictures can
move the same pixels, and a port that is close gets no credit for being
exact. Worse, it put a ceiling on the measurement that was not real.
Two captures of the same recording agreed on 1397 of 1473 ticks by that
measure and the difference was written up as the original not being
deterministic.

It is deterministic. Captured twice at three thousand cycles and twice
at twenty thousand, the same recording gives the same pictures tick for
tick; all that differs is which video frame tick zero lands on, and the
torches, which pick their next flame from the game's own random numbers
and cannot be reproduced by anything. Outside the flames the four runs
are identical, pixel for pixel.

So the digest is now a *fingerprint of the picture*, not a description
of the movement, and the comparison it supports is exact.

## What is in it

* `palette` -- every colour the capture uses. DOSBox's output, grabbed
  and encoded, is a couple of units off the port's own idea of the same
  colour (81,84,81 where the port has 84,84,84), so the two cannot be
  compared as colours. They can be compared as *indices into this
  palette*: the port maps each of its pixels to the nearest entry, which
  is unambiguous because the entries are far apart.
* `mask` -- the pixels to leave out, run-length coded. These are found
  by how often they change: a flame changes on nearly every tick and
  nothing else in the game comes close.
* `hash` -- per tick, a hash of the masked index image. Equal hashes
  mean the two pictures are the same picture.
* `moved` -- per tick, the old box-and-count, kept because it says *how
  far out* a tick is when it is out, which a hash cannot.

  digest.py <dir> <out.json>
"""
import glob
import json
import zlib
import os
import re
import sys
import numpy as np
from PIL import Image

W, H = 320, 200
#: A pixel that changes on more than this fraction of ticks is a flame.
FLAME_SHARE = 0.12
#: How far the flame mask is grown around the pixels that change.
FLAME_GROW = 6
#: Pixels differing by more than this are different pixels.
TOLERANCE = 40


def load_dir(path):
    """Every tick's picture, indexed by the tick it is, not by how many
    came before it. `split_ticks --anchor-text` renumbers what it writes
    so that the game's own clock decides which tick is which, and that
    can leave the first few missing; reading the directory as a list
    would then slide the whole run along by that many ticks."""
    files = {}
    for f in glob.glob(os.path.join(path, 't*.png')):
        m = re.search(r't(\d+)', os.path.basename(f))
        if m:
            files[int(m.group(1))] = f
    if not files:
        return []
    out = [None] * (max(files) + 1)
    for t, f in files.items():
        out[t] = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
    return out


def flame_mask(frames):
    """The pixels that are on fire.

    Found by how often they change rather than by what colour they are.
    A torch picks a new flame nearly every tick; a pixel the Prince walks
    over changes a handful of times in a run.

    Counted room by room, not over the whole run. A torch in a room the
    run visits for fifty of its twelve hundred ticks changes on nearly
    all fifty and on four per cent of the run, which no threshold over
    the whole thing can tell from a pixel the Prince crossed twice. The
    run is cut at the ticks where the whole screen changed -- that is a
    room change -- and each piece is counted on its own.

    Grown generously afterwards. A flame is not only the pixels that
    change often: its edges reach further on some ticks than on others,
    and what the Prince happens to be standing in front of changes
    rarely and still has to go.
    """
    pairs = [(i, a, b) for i, (a, b) in enumerate(zip(frames, frames[1:]))
             if a is not None and b is not None]
    if len(pairs) < 8:
        return np.zeros((H, W), dtype=bool)
    # Where the whole screen changed: a room change, and the start of a
    # new set of torches.
    cuts = [0]
    for i, a, b in pairs:
        if (np.abs(a - b).max(axis=2) > TOLERANCE).sum() > 0.5 * W * H:
            cuts.append(i + 1)
    cuts.append(len(frames))
    hot = np.zeros((H, W), dtype=bool)
    for lo, hi in zip(cuts, cuts[1:]):
        part = [(a, b) for i, a, b in pairs if lo <= i < hi]
        if len(part) < 8:
            continue
        counts = np.zeros((H, W), dtype=np.int32)
        for a, b in part:
            counts += (np.abs(a - b).max(axis=2) > TOLERANCE)
        hot |= counts > FLAME_SHARE * len(part)
    out = hot.copy()
    for _ in range(FLAME_GROW):
        prev = out.copy()
        for d in (-1, 1):
            out |= np.roll(prev, d, axis=0)
            out |= np.roll(prev, d, axis=1)
    return out


def rle(mask):
    """The mask as run lengths, starting with a run of `false`."""
    flat = mask.reshape(-1)
    runs = []
    want = False
    i = 0
    while i < flat.size:
        j = i
        while j < flat.size and bool(flat[j]) == want:
            j += 1
        runs.append(int(j - i))
        want = not want
        i = j
    return runs


def palette_of(frames):
    """Every colour the capture uses, as a list of [r, g, b]."""
    seen = set()
    for f in frames:
        if f is None:
            continue
        for c in np.unique(f.reshape(-1, 3), axis=0):
            seen.add((int(c[0]), int(c[1]), int(c[2])))
    return sorted(seen)


def index_image(frame, lookup):
    flat = frame.reshape(-1, 3)
    keys = (flat[:, 0].astype(np.int32) << 16) | \
           (flat[:, 1].astype(np.int32) << 8) | flat[:, 2].astype(np.int32)
    return lookup[keys]


def hash_image(idx, mask_flat):
    """CRC-32 of the index image, with the masked pixels forced to the
    same value on both sides. Plain CRC-32 so that the port can compute
    exactly the same number without a line of cleverness."""
    a = idx.copy()
    a[mask_flat] = 0xffff
    return zlib.crc32(a.astype('<u2').tobytes()) & 0xffffffff


def moved(a, b, mask):
    """Where the picture changed, as [x0, y0, x1, y1, n], or None."""
    d = (np.abs(a - b).max(axis=2) > TOLERANCE) & ~mask
    ys, xs = np.nonzero(d)
    if len(xs) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()), int(d.sum())]


def digest_dir(path):
    frames = load_dir(path)
    mask = flame_mask(frames)
    pal = palette_of(frames)
    lookup = np.full(1 << 24, 0, dtype=np.uint16)
    for i, (r, g, b) in enumerate(pal):
        lookup[(r << 16) | (g << 8) | b] = i
    mask_flat = mask.reshape(-1)
    hashes = []
    moves = []
    prev = None
    for f in frames:
        if f is None:
            hashes.append(None)
            moves.append(None)
            continue
        hashes.append(hash_image(index_image(f, lookup), mask_flat))
        moves.append(None if prev is None else moved(prev, f, mask))
        prev = f
    return {
        'version': 2,
        'palette': [list(c) for c in pal],
        'mask': rle(mask),
        'hash': hashes,
        'ticks': moves,
    }


if __name__ == '__main__':
    out = digest_dir(sys.argv[1])
    with open(sys.argv[2], 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"{sum(1 for h in out['hash'] if h is not None)} ticks "
          f"(numbered to {len(out['hash']) - 1}), {len(out['palette'])} colours, "
          f"{int(sum(out['mask'][1::2]))} masked pixels -> {sys.argv[2]}")
