/**
 * A copy of the game directory with the potion level in it.
 *
 *   npx tsx tools/dev/potion-game-dir.ts <outdir>
 *
 * `src/dat/potion-level.ts` is one extra `LEVELS.DAT` record, and the
 * page drops it into the copy of the file it fetched. The **original**
 * reads `LEVELS.DAT` off the disc, so the same record written into a
 * copy of `original/prince1` makes `PRINCE.EXE` itself play the potion
 * corridor -- which is the only way the six potions can ever be
 * measured against the authority rather than against a reading of the
 * C. `tools/oracle/dosbox_oracle.py --game <outdir>` mounts it as C:.
 *
 * It refuses to write into `original/prince1`: that directory is the
 * game as it shipped and every capture in the suite rests on it.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync }
  from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { levelsDatWithPotionLevel, POTION_LEVEL_NUMBER } from '../../src/dat/potion-level.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = join(REPO, 'original', 'prince1');

const out = process.argv[2];
if (!out) throw new Error('usage: potion-game-dir.ts <outdir>');
const dest = resolve(out);
if (dest === resolve(GAME)) {
  throw new Error('that is the original game directory; give it somewhere else');
}
mkdirSync(dest, { recursive: true });
let copied = 0;
for (const name of readdirSync(GAME)) {
  if (!statSync(join(GAME, name)).isFile()) continue;
  if (name === 'LEVELS.DAT') continue;
  copyFileSync(join(GAME, name), join(dest, name));
  copied += 1;
}
const patched = levelsDatWithPotionLevel(new Uint8Array(readFileSync(join(GAME, 'LEVELS.DAT'))));
writeFileSync(join(dest, 'LEVELS.DAT'), patched);
console.log(`${dest}: ${copied} files copied, LEVELS.DAT written with the potion`
  + ` level in place of level ${POTION_LEVEL_NUMBER}`);
