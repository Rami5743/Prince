/**
 * Which single key edge, moved by one tick, would close the run.
 *
 * The oracle cannot place a key edge to better than a tick. The
 * schedule sends each edge at `(t - 1) / 12` of wall clock, the game
 * reads the keyboard on its own tick, and where the two clocks sit
 * relative to each other is not under anyone's control -- so an edge
 * can be read on the tick the recording says or on the one before.
 * Most of the time that costs nothing. Now and then it decides which
 * frame of the run `control_running` stops on, and then the Prince
 * comes to rest two tiles from where the port puts him and thirty
 * ticks are marked wrong.
 *
 * This tries every edge of a recording moved by a tick either way and
 * prints the ones that are worth something. An edge worth tens of
 * ticks is the oracle's own resolution, not a fault in the port; what
 * is left when every such edge is accounted for is the port's.
 *
 *   node --experimental-strip-types tools/dev/which-key.ts <name> [more...] [--by 1,2]
 *
 * `--by` is how many ticks to try moving each edge. One is the
 * oracle's own resolution, and the emulator has been measured taking
 * a press two and three ticks off as well, so the default is now
 * `1,2,3`.
 *
 * **It has to be three.** Three is not a theoretical extra: `13ab6867`
 * reads 572 of 728 as recorded and 721 with its Up at 573 two ticks
 * later, which is where the range of `1,2` left it -- and **727**
 * with the same Up three ticks *earlier*, which is exactly what
 * `tools/oracle/README` had already read off that capture's own
 * pixels (its run-jump begins on frame 34 at tick 571, three before
 * the recording's Up). Seven of the suite's unexplained ticks were
 * the tool's range and not the port.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, exactAgreement, inputChanges, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

type Controls = { x: number; y: number; shift: boolean };
/** Which of the three controls of an edge to move, or all of them. */
type Which = 'x' | 'y' | 'shift' | 'all';

async function score(
  name: string, ticks: Controls[], digest: Digest, level: number, minutes = 60,
): Promise<number> {
  const port = await runOf(
    () => PopGame.start(assets, exe, level, { minutesLeft: minutes }),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  return exactAgreement(digest, port, inputChanges(ticks)).agreed;
}

const args = process.argv.slice(2);
const byArg = args.indexOf('--by');
const BY = byArg >= 0 ? args[byArg + 1].split(',').map(Number) : [1, 2, 3];
const names = args.filter((a, i) => !a.startsWith('--') && i !== byArg + 1);

for (const name of names) {
  const digest = JSON.parse(
    readFileSync(join(REPO, 'tools', 'oracle', 'digests', `${name}.json`), 'utf8'),
  ) as Digest;
  const rec = parseRecording(
    readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
  );
  const base = decodeTimeline(rec.timeline) as Controls[];
  const was = await score(name, base, digest, rec.level, rec.startMinutes);
  /**
   * Every tick at which any of the three controls changed, and which
   * of them did.
   *
   * One control at a time, not the whole edge. A player who presses
   * Right and Up in the same thousandth of a second makes one edge of
   * the recording, and `recording_to_script.mjs` sends both at the
   * same instant -- but they go out as two `xdotool` events and the
   * emulator can read them in two different ticks, which is a thing
   * moving the edge as a whole can never express. `848ee3c4` 926 is
   * one: Right and Up together, the port takes both on 926 and makes
   * a standing jump into a wall, the original takes Right on 926 and
   * steps. Moving the whole edge is worth nothing there; moving its
   * Up alone is worth all eight of the ticks it costs.
   */
  const edges: { at: number; which: Which }[] = [];
  for (let t = 1; t < base.length; t++) {
    const a = base[t - 1];
    const b = base[t];
    const parts: Which[] = [];
    if (a.x !== b.x) parts.push('x');
    if (a.y !== b.y) parts.push('y');
    if (a.shift !== b.shift) parts.push('shift');
    if (parts.length === 0) continue;
    for (const p of parts) edges.push({ at: t, which: p });
    // And the whole edge together, when there is more than one of it.
    if (parts.length > 1) edges.push({ at: t, which: 'all' });
  }
  const gains: { at: number; which: Which; by: number; to: number }[] = [];
  for (const { at, which } of edges) {
    for (const k of BY) {
      for (const by of [-k, k]) {
        // Move this one edge, and only this one: the ticks it is moved
        // across take the state of whichever side of it they now fall.
        const ticks = base.map((c) => ({ ...c }));
        const put = (t: number, from: Controls): void => {
          if (t < 0 || t >= ticks.length) return;
          ticks[t] = which === 'all' ? { ...from } : { ...ticks[t], [which]: from[which] };
        };
        if (by < 0) for (let t = at + by; t < at; t++) put(t, base[at]);
        else for (let t = at; t < at + by; t++) put(t, base[at - 1]);
        const got = await score(name, ticks, digest, rec.level, rec.startMinutes);
        if (got > was) gains.push({ at, which, by, to: got });
      }
    }
  }
  gains.sort((p, q) => q.to - p.to);
  console.log(`${name}: ${was} as recorded, ${edges.length} edges`);
  for (const g of gains.slice(0, 8)) {
    const when = `${Math.abs(g.by)} ${g.by > 0 ? 'later' : 'earlier'}`;
    console.log(`   ${g.which} at ${g.at} moved ${when}: ${g.to} (+${g.to - was})`);
  }
  if (gains.length === 0) console.log('   no single edge is worth anything');
}
