#!/usr/bin/env python3
"""
What the original actually played, as notes.

    python3 tools/oracle/sound_notes.py <wav> <out.json> [--from S] [--to S]

Every digest in `tools/oracle/digests/` is a *picture*. The capture
chain ran DOSBox with `pcspeaker=false` and nothing in the suite had
ever put what `PRINCE.EXE` plays beside what the page plays -- which
is why three of the five bugs a human found by playing the game were
sound and the two scores did not move by a tick for any of them.

`dosbox_oracle.py --speaker` lets the mixer carry the square wave and
a `wave` line in the script toggles DOSBox's own recorder, which taps
the mixer and so works with `nosound=true` and costs the emulator
nothing. What comes out is a clean two-level square wave: the samples
are +/-5000 and nothing else, because the PC speaker has one bit.

So the note is recoverable exactly. This counts zero crossings, cuts
the stream where the half-period changes, and writes

    {"rate": 44100, "notes": [[start, duration, hz], ...]}

with the times in seconds from the start of the recording.

A rest is a gap: with the speaker gate shut DOSBox holds the output at
a constant level, so there are no crossings at all and the note simply
ends.
"""
import argparse, json, struct, sys, wave


def samples(path):
    with wave.open(path) as w:
        ch, width, rate, n = (w.getnchannels(), w.getsampwidth(),
                              w.getframerate(), w.getnframes())
        if width != 2:
            raise SystemExit('expected 16-bit samples, got %d bytes' % width)
        raw = w.readframes(n)
    data = struct.unpack('<%dh' % (len(raw) // 2), raw)
    return (list(data[::ch]) if ch > 1 else list(data)), rate


def crossings(data):
    """Where the square wave changes sign, in samples."""
    out = []
    prev = data[0] > 0
    for i in range(1, len(data)):
        cur = data[i] > 0
        if cur != prev:
            out.append(i)
            prev = cur
    return out


# A note boundary is where the half-period changes and stays
# changed. Two things make that harder than it sounds. The mixer
# resamples, so one half-period of a steady note comes out a sample
# long or short -- at 2500 Hz a half-period is nine samples and one
# sample is eleven per cent, which is two semitones. And the game's
# own notes are a semitone apart, which is six per cent. A per-
# crossing tolerance cannot have both, so the series is median-
# filtered first and the cut is made where the *median* moves.
SMOOTH = 5
# Two and a half per cent: under a semitone (5.9%) and over the
# jitter the median leaves behind.
STEP = 0.025
# Below this a "note" is the square wave turning on or off.
MIN_SECONDS = 0.012
# A half-period longer than this is the speaker gate shut, not a note.
SILENCE_HZ = 30.0


def _median(xs):
    ys = sorted(xs)
    return ys[len(ys) // 2]


def notes(data, rate, step=STEP, min_seconds=MIN_SECONDS):
    cross = crossings(data)
    if len(cross) < 4:
        return []
    half = [cross[i + 1] - cross[i] for i in range(len(cross) - 1)]
    quiet = rate / (2 * SILENCE_HZ)
    k = SMOOTH // 2
    med = [_median(half[max(0, i - k):i + k + 1]) for i in range(len(half))]
    cuts = [0]
    for i in range(1, len(half)):
        if half[i] > quiet or half[i - 1] > quiet \
                or abs(med[i] - med[i - 1]) > step * med[i - 1]:
            cuts.append(i)
    cuts.append(len(half))
    out = []
    for a, b in zip(cuts, cuts[1:]):
        if b - a < 4:
            continue
        start, end = cross[a], cross[b]
        if (end - start) / rate < min_seconds:
            continue
        # The first and last half-period of a run straddle the
        # boundary, so the pitch is taken from the inside of it -- and
        # from the *median* of what is inside, not the mean. A note
        # that follows one an octave away still has one transitional
        # half-period after the trim, and on a note of fifteen of them
        # a mean is dragged four per cent by it: the title's 69 Hz
        # after a 147 read 66.4, which is further off than a tune's
        # notes are apart.
        inner = half[a + 1:b - 1] or half[a:b]
        if max(inner) > quiet:
            continue
        hz = rate / (2 * _median(inner))
        out.append([round(start / rate, 4), round((end - start) / rate, 4),
                    round(hz, 1)])
    return out


def merge(ns, gap=0.004, cents=0.03):
    """One note the segmentation cut in two, put back together.

    The cut happens when the mixer's resampling makes one half-period
    an outlier. Two runs at the same pitch with no silence between
    them are one note; two with a rest between them are not, and the
    game's own rests are twenty milliseconds.
    """
    out = []
    for n in ns:
        if out:
            prev = out[-1]
            if (abs(prev[2] - n[2]) <= cents * n[2]
                    and n[0] - (prev[0] + prev[1]) <= gap):
                prev[1] = round(n[0] + n[1] - prev[0], 4)
                continue
        out.append(list(n))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wav')
    ap.add_argument('out')
    ap.add_argument('--from', dest='start', type=float, default=0.0)
    ap.add_argument('--to', dest='end', type=float, default=None)
    a = ap.parse_args()
    data, rate = samples(a.wav)
    lo = int(a.start * rate)
    hi = len(data) if a.end is None else min(len(data), int(a.end * rate))
    ns = merge(notes(data[lo:hi], rate))
    for n in ns:
        n[0] = round(n[0] + a.start, 4)
    with open(a.out, 'w') as f:
        json.dump({'rate': rate, 'seconds': round(len(data) / rate, 3),
                   'notes': ns}, f)
    print('%s: %d notes over %.2fs' % (a.out, len(ns), len(data) / rate))


if __name__ == '__main__':
    main()
