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
    key <xdotool-keyspec>   send one key press
    hold <key> <seconds>    press and hold a key
    keydown <key>           press and keep held
    keyup <key>             release
    shot <name>             capture a screenshot and name it <name>.png
    cmd <dos command>       typed into the DOS prompt, followed by Return
"""
import argparse, os, shutil, signal, subprocess, sys, time, glob

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


class Dosbox:
    def __init__(self, workdir, machine='vgaonly', cycles=3000, display=':77',
                 autoexec='', game=GAME):
        self.workdir = workdir
        self.capture = os.path.join(workdir, 'capture')
        self.display = display
        self.machine = machine
        self.cycles = cycles
        self.autoexec = autoexec
        self.game = game
        self.xvfb = None
        self.dosbox = None
        self.winid = None

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
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
        env = dict(os.environ, DISPLAY=self.display, SDL_VIDEODRIVER='x11')
        self.dosbox = subprocess.Popen(
            ['dosbox', '-conf', conf],
            env=env, stdout=open(os.path.join(self.workdir, 'dosbox.log'), 'w'),
            stderr=subprocess.STDOUT)
        # wait for the window
        for _ in range(60):
            time.sleep(0.5)
            try:
                out = subprocess.check_output(
                    ['xdotool', 'search', '--name', 'DOSBox'], env=env,
                    stderr=subprocess.DEVNULL).decode().split()
                if out:
                    self.winid = out[0]
                    break
            except subprocess.CalledProcessError:
                pass
        if not self.winid:
            raise RuntimeError('DOSBox window never appeared')
        self._xdo('windowactivate', self.winid)
        self._xdo('windowfocus', self.winid)
        time.sleep(0.5)
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

    def __exit__(self, *exc):
        for p in (self.dosbox, self.xvfb):
            if p and p.poll() is None:
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    p.kill()


def run_script(path, outdir, machine, cycles, autoexec, display):
    workdir = os.path.join(outdir, '_work')
    os.makedirs(workdir, exist_ok=True)
    made = []
    with Dosbox(workdir, machine=machine, cycles=cycles, display=display,
                autoexec=autoexec) as db:
        for raw in open(path):
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            op, _, rest = line.partition(' ')
            rest = rest.strip()
            if op == 'wait':
                time.sleep(float(rest))
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
            elif op == 'type':
                db.type_(rest)
            elif op == 'cmd':
                db.type_(rest)
                db.key('Return')
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
    ap.add_argument('--display', default=':77')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    run_script(a.script, a.out, a.machine, a.cycles, a.autoexec, a.display)


if __name__ == '__main__':
    main()
