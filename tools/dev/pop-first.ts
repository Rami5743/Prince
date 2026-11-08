/** Where the translation first parts company with a capture. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';
import { runOf, type Digest } from './digest-common.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
for (const name of process.argv.slice(2)) {
  const digest = JSON.parse(readFileSync(join(REPO, 'tools/oracle/digests', `${name}.json`), 'utf8')) as Digest;
  const rec = parseRecording(readFileSync(join(REPO, 'tools/oracle/recordings', `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const port = await runOf(() => PopGame.start(assets, exe, rec.level), (g) => g.restart(assets, exe), ticks, digest);
  const dos = digest.hash ?? [];
  const n = Math.min(dos.length, port.hash.length);
  const bad: number[] = [];
  for (let i = 0; i < n; i++) if (dos[i] !== null && dos[i] !== port.hash[i]) bad.push(i);
  console.log(`${name}: ${n} ticks, first differing ${bad[0] ?? '-'}, differing ${bad.length}`);
  console.log('  ', bad.slice(0, 30).join(' '));
}
