/**
 * Every press in the recordings shorter than four ticks.
 *
 * DOSBox does not take a short press reliably -- `tools/oracle/README`
 * has the measurement -- and when it takes one late the capture stops
 * being evidence about the port for everything after it. `gate1`'s
 * two-tick tap of Right at 591 arrived fourteen ticks late, which cost
 * that recording two hundred ticks of its score and nothing in the
 * game.
 *
 * So before reading a run of differences as a fault in the
 * translation, look here for a short press before it, and settle it
 * with `tools/dev/late-key.ts`.
 *
 *   node --experimental-strip-types tools/dev/short-presses.ts [name...]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecording, decodeTimeline } from '../../src/game/recording.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(REPO, 'tools', 'oracle', 'recordings');
/** Four ticks: shorter than this and the emulator may or may not see it. */
const SHORT = 4;

const named = process.argv.slice(2);
const names = named.length
  ? named
  : readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();

type Key = 'left' | 'right' | 'up' | 'down' | 'shift';
const held: Record<Key, (c: { x: number; y: number; shift: boolean }) => boolean> = {
  left: (c) => c.x < 0,
  right: (c) => c.x > 0,
  up: (c) => c.y < 0,
  down: (c) => c.y > 0,
  shift: (c) => c.shift,
};

for (const name of names) {
  const rec = parseRecording(readFileSync(join(DIR, `${name}.json`), 'utf8'));
  const ticks = decodeTimeline(rec.timeline);
  const found: string[] = [];
  for (const key of Object.keys(held) as Key[]) {
    let start = -1;
    for (let i = 0; i <= ticks.length; i++) {
      const on = i < ticks.length && held[key](ticks[i]);
      if (on && start < 0) start = i;
      else if (!on && start >= 0) {
        if (i - start < SHORT) found.push(`${key}@${start}x${i - start}`);
        start = -1;
      }
    }
  }
  if (found.length) console.log(`${name.padEnd(10)} ${found.join(' ')}`);
}
