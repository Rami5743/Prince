/**
 * Developer tool: print how a captured play session compares with the port.
 *
 *   node --experimental-strip-types tools/dev/session-report.ts level1-open
 *
 * Prints every capture, the tick that reproduced it, and for one that was
 * not reproduced how close the port got. Pictures of each failure -- ours,
 * theirs, and a map of where they differ -- go in the artifacts directory.
 */
import { join } from 'node:path';
import { alignSession } from '../../tests/helpers/session.ts';
import { GOLDEN_DIR } from '../../tests/helpers/fixtures.ts';

const name = process.argv[2];
if (!name) {
  console.error('usage: session-report.ts <session-name> [artifacts-dir]');
  process.exit(2);
}
const artifacts = process.argv[3] ?? join('/tmp', `session-${name}-failures`);
const result = await alignSession(name, join(GOLDEN_DIR, `session-${name}`), { artifacts });

for (const m of result.matches) {
  console.log(
    `${m.name} [${m.phase.padEnd(2)}] `
    + (m.tick === null
      ? `UNREPRODUCED closest tick ${String(m.bestTick).padStart(3)}, `
        + `${String(m.bestDiff).padStart(6)} px out  ${m.state}`
      : `tick ${String(m.tick).padStart(3)}`),
  );
}
const total = result.matches.length;
console.log(`\n${result.reproduced} of ${total} reproduced; artifacts in ${artifacts}`);
