#!/usr/bin/env python3
"""
Reference-capture harness: runs the ORIGINAL Prince of Persia (DOS) inside
DOSBox on a virtual X display, drives it with scripted key events, and saves
pixel-exact PNG screenshots of the emulated VGA screen.

The screenshots produced here are the ground truth the browser port is tested
against. DOSBox's own Ctrl+F5 capture writes the raw 320x200 (or 320x400)
framebuffer, not a scaled window, so the pixels are exactly what the game drew.

Usage:
    dosbox_oracle.py --script scripts/title.txt --out out/title

Script file: one command per line.
    wait <seconds>          sleep
    origin                  start the clock the `at` commands count from
    at <seconds>            sleep until that many seconds after `origin`
    key <xdotool-keyspec>   send one key press
    hold <key> <seconds>    press and hold a key
    keydown <key>           press and keep held
    keyup <key>             release
    shot <name>             capture a screenshot and name it <name>.png
    cmd <dos command>       typed into the DOS prompt, followed by Return
"""
import argparse, os, shutil, signal, subprocess, sys, time, glob, random

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
GAME = os.path.join(REPO, 'original', 'prince1')

CONF = """[sdl]
fullscreen=false
output=surface
autolock=false
waitonerror=false
usescancodes=true
[dosbox]
machine={machine}
captures={captures}
memsize=16
[render]
aspect=false
scaler=none
frameskip=0
[cpu]
core=normal
cputype=386
cycles=fixed {cycles}
[mixer]
nosound=true
[sblaster]
sbtype=none
[gus]
gus=false
[speaker]
pcspeaker=false
tandy=off
disney=false
[midi]
mididevice=none
[autoexec]
mount c {gamedir}
c:
{autoexec}
"""


def free_display():
    """An X display number nothing else is using.

    Runs used to share one fixed display, which meant that a DOSBox left
    behind by an earlier run would be found by the next one: its window
    matched the search, so the keys went to the wrong emulator and the
    screenshots came out of the wrong session -- or never appeared at all.
    Each run now gets a display of its own.
    """
    for _ in range(200):
        n = random.randint(80, 980)
        if not os.path.exists('/tmp/.X%d-lock' % n) and \
           not os.path.exists('/tmp/.X11-unix/X%d' % n):
            return ':%d' % n
    raise RuntimeError('no free X display')


class Dosbox:
    def __init__(self, workdir, machine='vgaonly', cycles=3000, display=None,
                 autoexec='', game=GAME, record=None, fps=30):
        # Absolute: DOSBox resolves `captures=` against its own working
        # directory, so a relative path there is silently appended to it and
        # no screenshot is ever written.
        self.workdir = os.path.abspath(workdir)
        self.capture = os.path.join(self.workdir, 'capture')
        self.display = display or free_display()
        self.machine = machine
        self.cycles = cycles
        self.autoexec = autoexec
        self.game = game
        self.xvfb = None
        self.dosbox = None
        self.winid = None
        # Video is grabbed off the X display, not through DOSBox's own AVI
        # capture: ctrl+alt+F5 produces no file in this build, and grabbing
        # the display also leaves the emulator's key timing untouched.
        self.record = os.path.abspath(record) if record else None
        self.fps = fps
        self.ffmpeg = None

    def __enter__(self):
        os.makedirs(self.capture, exist_ok=True)
        conf = os.path.join(self.workdir, 'dosbox.conf')
        with open(conf, 'w') as f:
            f.write(CONF.format(machine=self.machine, captures=self.capture,
                                cycles=self.cycles, gamedir=self.game,
                                autoexec=self.autoexec))
        dn = int(self.display[1:])
        self.xvfb = subprocess.Popen(
            ['Xvfb', self.display, '-screen', '0', '1024x768x24'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True)
        time.sleep(1.5)
        env = dict(os.environ, DISPLAY=self.display, SDL_VIDEODRIVER='x11')
        self.dosbox = subprocess.Popen(
            ['dosbox', '-conf', conf],
            env=env, stdout=open(os.path.join(self.workdir, 'dosbox.log'), 'w'),
            stderr=subprocess.STDOUT, start_new_session=True)
        # Wait for the window, and take only one belonging to the process just
        # started -- never whatever else happens to be called DOSBox.
        for _ in range(60):
            time.sleep(0.5)
            if self.dosbox.poll() is not None:
                raise RuntimeError('DOSBox exited at once; see dosbox.log')
            try:
                out = subprocess.check_output(
                    ['xdotool', 'search', '--pid', str(self.dosbox.pid)], env=env,
                    stderr=subprocess.DEVNULL).decode().split()
                if out:
                    self.winid = out[-1]
                    break
            except subprocess.CalledProcessError:
                pass
        if not self.winid:
            raise RuntimeError('DOSBox window never appeared')
        self._xdo('windowactivate', self.winid)
        self._xdo('windowfocus', self.winid)
        time.sleep(0.5)
        if self.record:
            os.makedirs(os.path.dirname(self.record) or '.', exist_ok=True)
            # Grab the game's own rectangle, not the whole 1024x768
            # display. Encoding the desktop losslessly at thirty frames
            # a second costs more processor than the emulator does, and
            # what it costs comes out of the emulator: measured on the
            # long probe, the game fell two ticks behind the clock over
            # a thousand of them, and a key sent on the clock then lands
            # two ticks late. The game area is a sixth of the pixels.
            self.ffmpeg = subprocess.Popen(
                ['ffmpeg', '-y', '-loglevel', 'error',
                 '-f', 'x11grab', '-draw_mouse', '0',
                 '-framerate', str(self.fps), '-video_size', '640x400',
                 '-i', self.display + '+192,184',
                 '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0',
                 '-pix_fmt', 'yuv444p', self.record],
                env=dict(os.environ, DISPLAY=self.display),
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                stderr=open(self.record + '.log', 'w'), start_new_session=True)
            time.sleep(1.0)
        return self

    def _xdo(self, *args):
        env = dict(os.environ, DISPLAY=self.display)
        subprocess.run(['xdotool', *args], env=env, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def key(self, spec, repeat=1):
        for _ in range(repeat):
            self._xdo('key', '--window', self.winid, '--clearmodifiers', spec)
            time.sleep(0.06)

    def hold(self, spec, seconds):
        self.keydown(spec)
        time.sleep(seconds)
        self.keyup(spec)

    def keydown(self, spec):
        self._xdo('keydown', '--window', self.winid, spec)

    def keyup(self, spec):
        self._xdo('keyup', '--window', self.winid, spec)

    def xdo(self, args):
        """One xdotool process for a whole chain of commands.

        A separate process per key edge costs twenty to forty milliseconds
        of wall clock that the script's own waits know nothing about, and
        over a few hundred edges that is seconds of drift -- which is what
        made a replayed recording part company with the port after about
        nine seconds. xdotool takes `sleep` as a command of its own, so the
        entire schedule goes in one invocation and the waits are the only
        thing that times it. `@W` stands for the window id.
        """
        env = dict(os.environ, DISPLAY=self.display)
        argv = ['xdotool'] + [self.winid if a == '@W' else a for a in args]
        subprocess.run(argv, env=env, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def type_(self, text):
        self._xdo('type', '--window', self.winid, '--delay', '60', text)

    def shot(self, name, outdir):
        before = set(glob.glob(os.path.join(self.capture, '*.png')))
        self.key('ctrl+F5')
        for _ in range(40):
            time.sleep(0.25)
            now = set(glob.glob(os.path.join(self.capture, '*.png')))
            new = now - before
            if new:
                src = new.pop()
                time.sleep(0.2)
                os.makedirs(outdir, exist_ok=True)
                dst = os.path.join(outdir, name + '.png')
                shutil.move(src, dst)
                return dst
        raise RuntimeError('screenshot %r was not produced' % name)

    def stop_record(self):
        if not self.ffmpeg or self.ffmpeg.poll() is not None:
            return
        try:
            self.ffmpeg.communicate(b'q', timeout=15)
        except subprocess.TimeoutExpired:
            self.ffmpeg.kill()
            self.ffmpeg.wait()

    def __exit__(self, *exc):
        self.stop_record()
        # Both were started in sessions of their own, so the whole group can
        # be signalled; a DOSBox that ignores SIGTERM is killed outright. A
        # survivor would hold its display and break the next run.
        for p in (self.dosbox, self.xvfb):
            if not p or p.poll() is not None:
                continue
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(os.getpgid(p.pid), sig)
                except (ProcessLookupError, PermissionError):
                    break
                try:
                    p.wait(timeout=5)
                    break
                except subprocess.TimeoutExpired:
                    continue


def run_script(path, outdir, machine, cycles, autoexec, display,
               record=None, fps=30):
    outdir = os.path.abspath(outdir)
    workdir = os.path.join(outdir, '_work')
    os.makedirs(workdir, exist_ok=True)
    made = []
    origin = None
    with Dosbox(workdir, machine=machine, cycles=cycles, display=display,
                autoexec=autoexec, record=record, fps=fps) as db:
        for raw in open(path):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            op, _, rest = line.partition(' ')
            rest = rest.strip()
            if op == 'wait':
                time.sleep(float(rest))
            elif op == 'origin':
                # The clock the rest of the script is measured against.
                # Everything after this is sent at an absolute time, so
                # that what one command costs does not push the next one
                # late: a chained `xdotool` drifts about thirteen
                # milliseconds per key edge, and a long recording has
                # enough edges for that to come to two ticks.
                origin = time.monotonic()
            elif op == 'at':
                if origin is None:
                    origin = time.monotonic()
                delay = origin + float(rest) - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
            elif op == 'key':
                parts = rest.split()
                db.key(parts[0], int(parts[1]) if len(parts) > 1 else 1)
            elif op == 'hold':
                k, s = rest.split()
                db.hold(k, float(s))
            elif op == 'keydown':
                db.keydown(rest)
            elif op == 'keyup':
                db.keyup(rest)
            elif op == 'xdo':
                db.xdo(rest.split())
            elif op == 'type':
                db.type_(rest)
            elif op == 'cmd':
                db.type_(rest)
                db.key('Return')
            elif op == 'video':
                # DOSBox's own AVI capture. Unlike a screenshot it costs no
                # wall-clock time, so the key timings of a replayed
                # recording are not pulled about by the act of recording.
                db.key('ctrl+alt+F5')
                time.sleep(0.4)
            elif op == 'shot':
                made.append(db.shot(rest, outdir))
                print('captured', made[-1], flush=True)
            else:
                raise SystemExit('unknown oracle command: %r' % op)
    return made


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--script', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--machine', default='vgaonly')
    ap.add_argument('--cycles', type=int, default=3000)
    ap.add_argument('--autoexec', default='prince megahit')
    ap.add_argument('--display', default=None,
                    help='X display to use; one is chosen if not given')
    ap.add_argument('--record', default=None,
                    help='grab the X display to this video file while the '
                         'script runs (lossless; needs ffmpeg)')
    ap.add_argument('--fps', type=int, default=30)
    a = ap.parse_args()
    a.out = os.path.abspath(a.out)
    os.makedirs(a.out, exist_ok=True)
    run_script(a.script, a.out, a.machine, a.cycles, a.autoexec, a.display,
               record=a.record, fps=a.fps)


if __name__ == '__main__':
    main()
