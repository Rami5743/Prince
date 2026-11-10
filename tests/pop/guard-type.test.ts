/**
 * Which kind of guard each level has.
 *
 * `enter_guard` reads `tbl_guard_type[current_level]` twice: a type of
 * 2 brings a guard back as a skeleton, with his sword drawn and
 * `seq_63_guard_active_after_fall`, and anything else brings him back
 * sheathed and standing idle; and only a type of 0 is recoloured.
 *
 * The translation was handed `guardType === 4 ? 2 : 0`, which says the
 * shadow of level 12 is a skeleton and the skeletons of level 3 are
 * ordinary guards. The skeleton knocked into the pit on level 3 came
 * back as a guard who would not fight.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { guards } from '../../src/pop/seg002.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** `tbl_guard_type`: a guard, the fat one, a skeleton, the vizier, the shadow. */
const EXPECTED: Record<number, number> = {
  1: 0, 2: 0, 3: 2, 4: 0, 5: 0, 6: 1, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 4, 13: 3,
};

describe('tbl_guard_type', () => {
  for (const [level, type] of Object.entries(EXPECTED)) {
    it(`level ${level} has guard type ${type}`, async () => {
      await PopGame.start(assets, exe, Number(level));
      expect(guards.type(Number(level))).toBe(type);
    });
  }
});
