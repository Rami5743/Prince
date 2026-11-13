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

    scene_frames.py <video> <outdir> [--fps 30] [--limit N]
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
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    for f in os.listdir(a.outdir):
        if f.endswith('.png'):
            os.remove(os.path.join(a.outdir, f))
    cmd = ['ffmpeg', '-v', 'error', '-i', a.video, '-vf', f'fps={a.fps}',
           '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=10 ** 7)
    size = W * 2 * H * 2 * 3
    prev = None
    i = written = 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        # DOSBox draws the 320x200 screen at exactly twice the size, so
        # the way back down is to take every other pixel; averaging
        # blurs every edge and nothing matches.
        arr = np.frombuffer(buf, dtype=np.uint8).reshape(H * 2, W * 2, 3)[::2, ::2]
        if prev is None or not np.array_equal(arr, prev):
            Image.fromarray(arr).save(os.path.join(a.outdir, 't%d.png' % i))
            written += 1
            prev = arr.copy()
        i += 1
        if a.limit and i >= a.limit:
            break
    try:
        p.stdout.close()
    except BrokenPipeError:
        pass
    p.terminate(); p.wait()
    print('%d frames, %d of them a change -> %s' % (i, written, a.outdir))


if __name__ == '__main__':
    main()
