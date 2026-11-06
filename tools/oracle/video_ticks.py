#!/usr/bin/env python3
"""
Recover the game's own tick from a grabbed video of the original.

The emulator is grabbed at a steady frame rate that is well above the
game's, so a game tick shows up as a run of identical video frames. Count
the changes and you know which tick each video frame belongs to, and how
fast the emulator is running the game -- neither of which can be assumed,
because DOSBox does not run the game at the port's twelve steps a second.

  video_ticks.py <video> [--crop W:H:X:Y] [--from SEC] [--to SEC]
                 [--dump DIR] [--threshold N]

Prints the tick rate and, with --dump, writes one PNG per tick named by
its tick number so a tick can be looked at beside the port's.
"""
import argparse, os, subprocess, sys

def frames(path, crop, fps, start, end):
    vf = []
    if crop:
        vf.append('crop=' + crop)
    vf.append('fps=%g' % fps)
    cmd = ['ffmpeg', '-v', 'error']
    if start:
        cmd += ['-ss', str(start)]
    if end:
        cmd += ['-to', str(end)]
    cmd += ['-i', path, '-vf', ','.join(vf), '-f', 'rawvideo',
            '-pix_fmt', 'rgb24', '-']
    probe = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', path],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = (int(v) for v in probe.split('x'))
    if crop:
        parts = crop.split(':')
        w, h = int(parts[0]), int(parts[1])
    size = w * h * 3
    out = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    i = 0
    while True:
        buf = out.stdout.read(size)
        if len(buf) < size:
            break
        yield i, buf
        i += 1
    out.stdout.close()
    out.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--crop', default=None,
                    help='ffmpeg crop, W:H:X:Y; the game area of the display')
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--from', dest='start', type=float, default=None)
    ap.add_argument('--to', dest='end', type=float, default=None)
    ap.add_argument('--threshold', type=int, default=0,
                    help='bytes that must differ before it counts as a change')
    ap.add_argument('--map', default=None,
                    help='write "tick videoframe" pairs here')
    a = ap.parse_args()

    prev = None
    ticks = 0
    total = 0
    first_change = None
    rows = []
    for i, buf in frames(a.video, a.crop, a.fps, a.start, a.end):
        total = i + 1
        if prev is not None and buf != prev:
            if a.threshold:
                d = sum(1 for x, y in zip(buf, prev) if x != y)
                if d <= a.threshold:
                    continue
            ticks += 1
            if first_change is None:
                first_change = i
            rows.append((ticks, i))
        prev = buf
    span = (total - 1) / a.fps
    print(f'{total} video frames over {span:.2f}s at {a.fps}fps')
    print(f'{ticks} changes -> {ticks / span:.4f} ticks per second'
          if span else 'no span')
    if first_change is not None:
        print(f'first change at video frame {first_change} '
              f'({first_change / a.fps:.3f}s)')
    if a.map:
        with open(a.map, 'w') as f:
            for t, i in rows:
                f.write(f'{t} {i}\n')
        print(f'wrote {len(rows)} tick/frame pairs to {a.map}')


if __name__ == '__main__':
    main()
