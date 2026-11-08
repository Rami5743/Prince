#!/usr/bin/env python3
"""
Cut a grabbed video of the original into one picture per game tick.

The display is grabbed well above the game's own rate, so each tick is a
run of identical frames and a tick boundary is a change. Tearing -- the
grab catching a half-drawn frame -- shows up as two changes a single frame
apart, so changes closer together than `--min-gap` frames are treated as
one. The picture kept for a tick is the last frame of its run, which is
the one that is certainly finished.

  split_ticks.py <video> <outdir> [--crop W:H:X:Y] [--fps 30]
                 [--start SEC] [--min-gap 2] [--scale 320:199]
                 [--after-blank]

With --after-blank, counting starts at the first frame after the darkest
frame in the first few seconds: that is the flash of Ctrl+A restarting the
level, which is where the browser recording starts too.
"""
import argparse, os, subprocess, sys
import numpy as np
from PIL import Image


def stream(path, crop, fps, start, w, h):
    cmd = ['ffmpeg', '-v', 'error']
    if start:
        cmd += ['-ss', str(start)]
    cmd += ['-i', path, '-vf', f'crop={crop},fps={fps}' if crop else f'fps={fps}',
            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         bufsize=10 ** 7)
    size = w * h * 3
    i = 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield i, np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 3)
        i += 1
    try:
        p.stdout.close()
    except BrokenPipeError:
        pass
    p.terminate()
    p.wait()


def shrink(arr, sw, sh):
    """DOSBox draws the 320x200 screen at exactly twice the size, so the
    way back is to take every other pixel. Averaging instead would blur
    every edge in the picture and leave nothing that matches exactly."""
    h, w = arr.shape[:2]
    if w == sw * 2 and h == sh * 2:
        return Image.fromarray(arr[::2, ::2])
    return Image.fromarray(arr).resize((sw, sh), Image.BILINEAR)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('outdir')
    ap.add_argument('--crop', default='640:398:192:184')
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--min-gap', type=int, default=2)
    ap.add_argument('--scale', default='320:199')
    ap.add_argument('--after-blank', action='store_true')
    ap.add_argument('--blank-within', type=float, default=8.0,
                    help='seconds from --start to look for the restart flash')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--hybrid', action='store_true',
                    help='number ticks by the clock but cut them at the '
                         'screen changes, which is where they really are')
    ap.add_argument('--rate', type=float, default=12.0,
                    help="the game's own ticks per second; 0 counts changes "
                         'instead of trusting the clock')
    ap.add_argument('--anchor-text', type=int, default=-1,
                    help='renumber so that the tick the level title goes '
                         'off the bottom of the screen is this one. The '
                         'restart flash is a frame of video and lands a '
                         'tick either side of where it should between one '
                         'run and the next; the title is a count the game '
                         'itself keeps, so it says which tick is which '
                         'exactly. Pass the port\'s own number for it.')
    a = ap.parse_args()

    cw, ch = (int(v) for v in a.crop.split(':')[:2])
    sw, sh = (int(v) for v in a.scale.split(':'))
    os.makedirs(a.outdir, exist_ok=True)

    # Where to start counting. The flash of Ctrl+A restarting the level is
    # a single very dark frame, and the tick after it is the first of the
    # run -- the same place the browser recording starts. Finding it takes
    # a pass of its own, because the darkest frame is only known once the
    # window has been looked at whole.
    skip_until = -1
    if a.after_blank:
        window = int(a.blank_within * a.fps)
        sums = []
        for i, frame in stream(a.video, a.crop, a.fps, a.start, cw, ch):
            sums.append(int(frame.sum()))
            if i + 1 >= window:
                break
        if not sums:
            raise SystemExit('no frames to look at for the restart flash')
        dark = min(range(len(sums)), key=lambda i: sums[i])
        skip_until = dark
        print(f'restart flash at video frame {dark} '
              f'({dark / a.fps + a.start:.3f}s), '
              f'sum {sums[dark]} against a median of '
              f'{sorted(sums)[len(sums) // 2]}')

    if a.rate and a.hybrid:
        # Where the screen changes IS a tick boundary; the clock only says
        # which tick it is. Sampling purely by the clock drifts against the
        # game's own frame timing and lands a frame either side of a
        # boundary now and then, which shows up as a whole tick of
        # difference that is not there. Ticks in which nothing moved leave
        # no change at all, and keep the picture of the tick before.
        per = a.fps / a.rate
        frames = []
        for i, frame in stream(a.video, a.crop, a.fps, a.start, cw, ch):
            if i <= skip_until:
                continue
            frames.append(frame)
            if a.limit and len(frames) > (a.limit + 2) * per:
                break
        changes = []
        for i in range(1, len(frames)):
            if not np.array_equal(frames[i], frames[i - 1]):
                if changes and i - changes[-1] < 2:
                    continue        # a tear, not a new tick
                changes.append(i)
        if not changes:
            raise SystemExit('no changes found')
        # Number the ticks against the capture's own clock, and not by
        # adding up the gaps.
        #
        # A tick is 2.5 frames at 30 against 12, so the boundaries fall 2
        # and 3 frames apart in turn, and a gap of 4 is a 3 that the
        # emulator was late for. Rounding that gap on its own gives 2 --
        # `round(4 / 2.5)` -- and invents a tick: the picture of the tick
        # before is written twice and everything after it is a tick out
        # for the rest of the run. One frame of jitter in twelve hundred
        # ticks is enough, and it happened: of the four captures of
        # `f6874819` taken in the third round, three have the Prince's
        # stride at ticks 119 to 130 and the fourth has the same stride
        # with tick 121 written twice, which cost that run its alignment
        # from 122 to the end.
        #
        # Against the clock there is no such thing: tick n is where
        # `base + n * per` says it is, and a change is given the nearest
        # tick that is not one already taken. The rate is measured first,
        # over the whole capture, so that `per` is the emulator's own
        # twelfth of a second and not the nominal one -- a tenth of a per
        # cent is a tick and a half over a long recording, which is the
        # fault the gap-walk was written to avoid.
        base = changes[0]
        walked = 0
        for n in range(1, len(changes)):
            walked += max(1, int(round((changes[n] - changes[n - 1]) / per)))
        fit = (changes[-1] - base) / walked if walked else per
        # A rate that far out is not jitter, it is a broken capture.
        if not 0.9 * per <= fit <= 1.1 * per:
            print(f'measured {fit:.4f} frames a tick against {per:.4f}: '
                  f'keeping the nominal rate')
            fit = per
        pics = {}
        t = -1
        for n, f in enumerate(changes):
            t = max(t + 1, int(round((f - base) / fit)))
            end = changes[n + 1] - 1 if n + 1 < len(changes) else len(frames) - 1
            pics[t] = frames[min(end, len(frames) - 1)]
        last = max(pics)
        # The title bar is the game's own clock: it writes the level's
        # name under the room and takes it away a fixed number of ticks
        # later, and nothing the player does changes when. Lining the
        # numbering up on that is exact, where lining it up on a frame of
        # video is a tick either way.
        shift = 0
        if a.anchor_text >= 0:
            held = None
            seen_text = False
            for t in range(0, last + 1):
                if t in pics:
                    held = pics[t]
                if held is None:
                    continue
                strip = shrink(held, sw, sh)
                bar = np.asarray(strip)[sh - 8:, 100:220]
                lit = int((bar.max(axis=2) > 120).sum())
                if lit > 0:
                    seen_text = True
                elif seen_text:
                    shift = a.anchor_text - t
                    print(f'title goes off at tick {t}; '
                          f'renumbering by {shift:+d}')
                    break
        written = 0
        held = None
        for t in range(0, (a.limit or last + 1)):
            if t in pics:
                held = pics[t]
            if held is None:
                continue
            if t + shift < 0:
                continue
            shrink(held, sw, sh).save(
                os.path.join(a.outdir, f't{t + shift:05d}.png'))
            written += 1
        # What the game's clock actually did. If the emulator keeps
        # time, the first and last tick boundaries are `per` frames
        # apart for every tick between them; if it does not, a key sent
        # on the wall clock lands in the wrong tick and there is no
        # fixing that after the fact.
        spanned = changes[-1] - changes[0]
        rate = max(pics) * a.fps / spanned if spanned else 0
        print(f'{written} ticks written to {a.outdir} '
              f'({len(changes)} changes, {last + 1} ticks spanned, '
              f'tick 0 at video frame {base + skip_until + 1}, '
              f'{rate:.4f} ticks a second)')
        return

    if a.rate:
        # The game keeps a steady twelve ticks a second -- measured, by
        # counting changes over a long idle stretch where every tick moves
        # a torch -- so the clock says which tick a video frame belongs to.
        # Counting changes cannot: a tick in which nothing on screen moves
        # leaves no trace, and the numbering slips behind by one every
        # time. The frame kept is the middle of the tick's run, which is
        # the one furthest from a tear.
        per = a.fps / a.rate
        want = {}
        for t in range(a.limit or 100000):
            f = int(round(skip_until + 1 + (t + 0.5) * per))
            want.setdefault(f, t)
        last = max(want)
        written = 0
        for i, frame in stream(a.video, a.crop, a.fps, a.start, cw, ch):
            t = want.get(i)
            if t is not None:
                img = shrink(frame, sw, sh)
                img.save(os.path.join(a.outdir, f't{t:05d}.png'))
                written += 1
            if i >= last:
                break
        print(f'{written} ticks written to {a.outdir}')
        return

    prev = None
    last_change = -99
    pending = None          # (tick, frame array) waiting for the next change
    tick = -1
    written = 0

    def keep(t, arr):
        nonlocal written
        img = shrink(arr, sw, sh)
        img.save(os.path.join(a.outdir, f't{t:05d}.png'))
        written += 1

    for i, frame in stream(a.video, a.crop, a.fps, a.start, cw, ch):
        if i <= skip_until:
            continue
        if tick < 0:
            tick = 0
            prev = frame
            last_change = i
            pending = (0, frame)
            continue
        changed = not np.array_equal(frame, prev)
        if changed and i - last_change >= a.min_gap:
            if pending is not None:
                keep(pending[0], pending[1])
            tick += 1
            pending = (tick, frame)
            last_change = i
        elif pending is not None:
            pending = (pending[0], frame)   # keep the newest of the run
        prev = frame
        if a.limit and tick >= a.limit:
            break
    if pending is not None:
        keep(pending[0], pending[1])
    print(f'{written} ticks written to {a.outdir}')


if __name__ == '__main__':
    main()
