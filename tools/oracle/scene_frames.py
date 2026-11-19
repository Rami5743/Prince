#!/usr/bin/env python3
"""
Cut a grabbed video of one of the original's *scenes* into pictures.

`split_ticks.py` cuts a capture into one picture per **game tick**,
which is the right unit for a level: the game plays twelve of them a
second and nothing happens between two. A cutscene has no such unit.
`show_title`, `load_intro` and the six scenes between the levels are
written in sixtieths of a second -- `start_timer(timer_0, 0x82)`,
`do_simple_wait(timer_1)` -- and the finest thing a thirty frames a
second grab can resolve is a video frame. So a scene is cut into one
picture per video frame, and the port is replayed in steps of 1/30 of
a second to match.

Only the frames on which the picture *changed* are written, under the
number of the video frame they are. A scene is mostly holding still --
the title spends three hundred frames on one picture waiting for the
music -- and a digest of three thousand identical hashes measures
nothing but the hold. The hundreds that are left are the scene's own
clock, which is what there is to measure.

    scene_frames.py <video> <outdir> [--fps 30] [--start SEC] [--limit N]

`--start` is where the scene begins in the video, in seconds, and
everything before it is thrown away. The title needs none of it -- the
original is already fading it in when the grab starts -- but a scene
reached by playing (`shift+l` to a level with a cutscene before it,
or the hour running out) is a minute or two in, and the numbers a
digest carries are frames from the start of what it kept.

## `--untear`, and why a scene is grabbed at sixty

A fade writes the palette in one burst -- `fade_in_frame` walks the
rows of `which_rows` in order, sixteen DAC entries apiece -- and in
DOSBox that burst takes about half of the two sixtieths the fade
spends on a shade, because an emulated `OUT` to 0x3C9 costs far more
against the frame than a real one ever did. So the emulator puts a
**half-written palette** on the screen for half of every step, and a
thirty frames a second grab lands on it about half the time. On real
hardware the same burst is under a millisecond of a fourteen
millisecond frame, so what the capture shows is the instrument and
not the game.

Grabbed at **sixty** the two halves fall in two different frames and
can be told apart, which is the whole point:

    72  393 px, rows 99-166     the early rows: a shade on
    73 2659 px, rows 21-191     the rest of the burst: the frame whole
    74  393 px                  the next burst, half done
    75 3413 px                  whole again

A frame is mid-burst when the change *into* it is a plain palette
step -- every pixel moved by one DAC unit -- and is less than half
the size of the change *out* of it. That is the signature of a burst
split in two: the early rows are a few hundred pixels and rows 13
and 14 are the room, which is most of the screen. `--untear` drops
those frames and renumbers what is left to thirty a second, so
everything downstream -- the digest, the spec's `frames`, `start`
and `range`, the replay's thirtieth -- is unchanged.

Measured on one capture of `cutscene2`, the three ways of reading
the same grab:

    the pinned 30fps capture                  73 of 136
    60fps, every changed frame, halved        62 of 136
    60fps, untorn, halved                    112 of 135
    60fps, untorn, port stepped at a 60th     95 of 153

The last is why the halving stays: a port that draws twice as often
has two frames per shade and gains nothing, and loses on everything
that is not a fade.
"""
import argparse, os, subprocess
import numpy as np
from PIL import Image

W, H = 320, 200


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('outdir')
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--untear', action='store_true',
                    help='drop the frames the grab caught in the middle of '
                         'a palette write, and renumber to thirty a second')
    a = ap.parse_args()
    if a.untear and (a.fps % 30 or a.fps < 60):
        raise SystemExit('--untear wants --fps 60 (or another multiple of 30)')
    out_div = int(a.fps // 30) if a.untear else 1
    os.makedirs(a.outdir, exist_ok=True)
    for f in os.listdir(a.outdir):
        if f.endswith('.png'):
            os.remove(os.path.join(a.outdir, f))
    cmd = ['ffmpeg', '-v', 'error']
    if a.start:
        cmd += ['-ss', str(a.start)]
    cmd += ['-i', a.video, '-vf', f'fps={a.fps}',
            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=10 ** 7)
    size = W * 2 * H * 2 * 3
    prev = None
    i = written = dropped = 0
    seen = set()
    # The last three frames on which the picture changed. A frame can
    # only be judged once the one after it is in, because what says it
    # is mid-burst is the change out of it.
    win = []

    def emit(idx, arr):
        nonlocal written
        t = idx // out_div
        if t not in seen:
            seen.add(t)
            written += 1
        Image.fromarray(arr).save(os.path.join(a.outdir, 't%d.png' % t))

    def mid_burst(before, frame, after):
        """Did the grab catch this frame halfway through a palette write?"""
        into = (frame != before).any(axis=2)
        out = (frame != after).any(axis=2)
        n_in = int(into.sum())
        if not n_in or n_in >= 0.5 * int(out.sum()):
            return False
        d = frame.astype(np.int16)[into] - before.astype(np.int16)[into]
        return bool(np.abs(d).max() <= 6)

    def take(idx, arr):
        """Take one changed frame, judging the one before it.

        The first and the last frame of a scene are kept whatever they
        are: there is nothing on one side of them to judge them by.
        """
        nonlocal dropped
        win.append((idx, arr))
        if len(win) == 2:
            emit(*win[0])
        if len(win) < 3:
            return
        (i0, a0), (i1, a1), (i2, a2) = win
        del win[0]
        if i2 == i1 + 1 and mid_burst(a0, a1, a2):
            dropped += 1
        else:
            emit(i1, a1)

    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        # DOSBox draws the 320x200 screen at exactly twice the size, so
        # the way back down is to take every other pixel; averaging
        # blurs every edge and nothing matches.
        arr = np.frombuffer(buf, dtype=np.uint8).reshape(H * 2, W * 2, 3)[::2, ::2]
        if prev is None or not np.array_equal(arr, prev):
            prev = arr.copy()
            if a.untear:
                take(i, prev)
            else:
                emit(i, prev)
        i += 1
        if a.limit and i >= a.limit:
            break
    if a.untear and win:
        emit(*win[-1])
    try:
        p.stdout.close()
    except BrokenPipeError:
        pass
    p.terminate(); p.wait()
    print('%d frames, %d of them a change%s -> %s'
          % (i, written,
             (', %d mid-burst dropped' % dropped) if a.untear else '',
             a.outdir))


if __name__ == '__main__':
    main()
