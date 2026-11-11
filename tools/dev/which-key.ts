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
 * `--by` is how many ticks to try moving each edge; one by default,
 * because one is the oracle's own resolution, and `1,2` because the
 * emulator has been measured taking a press two ticks late as well.
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

async function score(name: string, ticks: Controls[], digest: Digest, level: number): Promise<number> {
  const port = await runOf(
    () => PopGame.start(assets, exe, level),
    (g) => g.restart(assets, exe),
    ticks,
    digest,
  );
  return exactAgreement(digest, port, inputChanges(ticks)).agreed;
}

const args = process.argv.slice(2);
const byArg = args.indexOf('--by');
const BY = byArg >= 0 ? args[byArg + 1].split(',').map(Number) : [1];
const names = args.filter((a, i) => !a.startsWith('--') && i !== byArg + 1);

for (const name of names) {
  const digest = JSON.parse(
    readFileSync(join(REPO, 'tools', 'oracle', 'digests', `${name}.json`), 'utf8'),
  ) as Digest;
  const rec = parseRecording(
    readFileSync(join(REPO, 'tools', 'oracle', 'recordings', `${name}.json`), 'utf8'),
  );
  const base = decodeTimeline(rec.timeline) as Controls[];
  const was = await score(name, base, digest, rec.level);
  /** Every tick at which any of the three controls changed. */
  const edges: number[] = [];
  for (let t = 1; t < base.length; t++) {
    const a = base[t - 1];
    const b = base[t];
    if (a.x !== b.x || a.y !== b.y || a.shift !== b.shift) edges.push(t);
  }
  const gains: { at: number; by: number; to: number }[] = [];
  for (const at of edges) {
    for (const k of BY) {
      for (const by of [-k, k]) {
      // Move this one edge, and only this one: the ticks it is moved
      // across take the state of whichever side of it they now fall.
      const ticks = base.map((c) => ({ ...c }));
      if (by < 0) for (let t = at + by; t < at; t++) { if (t >= 0) ticks[t] = { ...base[at] }; }
      else for (let t = at; t < at + by; t++) { if (t < ticks.length) ticks[t] = { ...base[at - 1] }; }
      const got = await score(name, ticks, digest, rec.level);
      if (got > was) gains.push({ at, by, to: got });
      }
    }
  }
  gains.sort((p, q) => q.to - p.to);
  console.log(`${name}: ${was} as recorded, ${edges.length} edges`);
  for (const g of gains.slice(0, 8)) {
    console.log(`   edge at ${g.at} moved ${Math.abs(g.by)} ${g.by > 0 ? 'later' : 'earlier'}: ${g.to} (+${g.to - was})`);
  }
  if (gains.length === 0) console.log('   no single edge is worth anything');
}
