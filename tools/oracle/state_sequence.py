#!/usr/bin/env python3
"""
Reduce a run to the sequence of pictures it actually showed.

Comparing tick N of the port with tick N of the original needs the two to
agree on where tick N begins, and over a hundred seconds of emulator that
is worth a tick either way -- which looks exactly like a real difference.
This sidesteps it: a run is the list of distinct pictures it drew, each
with how long it stayed up. Two runs that behave the same produce the same
list, whatever the phase.

  state_sequence.py <dir-or-video> ... --out seq.json

For a directory of per-tick PNGs the length is in ticks. For a video it is
in grabbed frames, converted to ticks with --rate and --fps.
"""
import argparse, glob, json, os, re, subprocess, sys
import numpy as np
from PIL import Image


def from_dir(d, limit=0):
    paths = []
    for p in glob.glob(os.path.join(d, 't*.png')):
        m = re.search(r't(\d+)\.png$', os.path.basename(p))
        if m:
            paths.append((int(m.group(1)), p))
    paths.sort()
    if limit:
        paths = [x for x in paths if x[0] < limit]
    out = []
    prev = None
    for t, p in paths:
        a = np.asarray(Image.open(p).convert('RGB'))
        if prev is not None and np.array_equal(a, prev):
            out[-1][1] += 1
            continue
        out.append([t, 1, a])
        prev = a
    return out


def from_video(path, crop, fps, rate, start, skip, limit=0):
    """Stream the grab and return [first_frame_index, ticks, picture].

    A state ends where the picture changes, but a change one frame after
    the last is the grab catching a half-drawn screen, not a new state, so
    those are folded in. The picture kept is the last frame of the run --
    the one that is certainly finished.
    """
    cw, ch = (int(v) for v in crop.split(':')[:2])
    cmd = ['ffmpeg', '-v', 'error']
    if start:
        cmd += ['-ss', str(start)]
    cmd += ['-i', path, '-vf', f'crop={crop},fps={fps}', '-f', 'rawvideo',
            '-pix_fmt', 'rgb24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         bufsize=10 ** 7)
    size = cw * ch * 3
    per = fps / rate
    out = []
    i = -1
    prev = None
    run_start = None
    last_change = -99
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        i += 1
        if i < skip:
            continue
        if run_start is None:
            run_start = i
            prev = buf
            last_change = i
            continue
        if buf != prev:
            if i - last_change >= 2:
                out.append([run_start, max(1, int(round((i - run_start) / per))),
                            np.frombuffer(prev, dtype=np.uint8).reshape(ch, cw, 3)])
                run_start = i
                if limit and len(out) >= limit:
                    prev = buf
                    break
            last_change = i
        prev = buf
    if prev is not None and run_start is not None and not (limit and len(out) >= limit):
        out.append([run_start, max(1, int(round((i + 1 - run_start) / per))),
                    np.frombuffer(prev, dtype=np.uint8).reshape(ch, cw, 3)])
    try:
        p.stdout.close()
    except BrokenPipeError:
        pass
    p.terminate(); p.wait()
    return out


def hot(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 140) & (b < 120) & (r > b + 60)


def masked_diff(a, b, skip_rows):
    a = a[:a.shape[0] - skip_rows].astype(np.int16)
    b = b[:b.shape[0] - skip_rows].astype(np.int16)
    m = hot(a) | hot(b)
    o = m.copy()
    for k in (-2, -1, 1, 2):
        o |= np.roll(m, k, axis=0)
        o |= np.roll(m, k, axis=1)
    return int(((np.abs(a - b).max(axis=2)) * ~o > 40).sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--video', required=True)
    ap.add_argument('--port', required=True, help='directory of per-tick PNGs')
    ap.add_argument('--crop', default='640:400:192:184')
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--rate', type=float, default=12.0)
    ap.add_argument('--start', type=float, default=49.0)
    ap.add_argument('--skip', type=int, default=66,
                    help='video frames to drop before the run begins')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--skip-rows', type=int, default=18)
    ap.add_argument('--show', type=int, default=6)
    ap.add_argument('--offset', type=int, default=0,
                    help='port state index = original state index + offset')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()

    dos = from_video(a.video, a.crop, a.fps, a.rate, a.start, a.skip, a.limit)
    port = from_dir(a.port, 0)
    print(f'{len(dos)} states in the original, {len(port)} in the port')

    shown = 0
    tick_d = tick_p = 0
    bad = 0
    for k in range(min(len(dos), len(port) - a.offset)):
        if k + a.offset < 0:
            continue
        d = dos[k][2][::2, ::2]
        p = port[k + a.offset][2]
        n = masked_diff(d, p, a.skip_rows)
        same_len = dos[k][1] == port[k + a.offset][1]
        if n < 25 and same_len:
            tick_d += dos[k][1]
            tick_p += port[k + a.offset][1]
            continue
        bad += 1
        if shown < a.show:
            shown += 1
            print(f'state {k}: original tick {tick_d} for {dos[k][1]}, '
                  f'port tick {tick_p} for {port[k + a.offset][1]}, '
                  f'{n} pixels apart')
            if a.out:
                os.makedirs(a.out, exist_ok=True)
                canvas = Image.new('RGB', (d.shape[1] * 2 + 8, d.shape[0]), (20, 20, 20))
                canvas.paste(Image.fromarray(d), (0, 0))
                canvas.paste(Image.fromarray(p), (d.shape[1] + 8, 0))
                canvas.save(os.path.join(a.out, f'state-{k:05d}.png'))
        tick_d += dos[k][1]
        tick_p += port[k + a.offset][1]
    print(f'{bad} of {min(len(dos), len(port))} states differ')


if __name__ == '__main__':
    main()
