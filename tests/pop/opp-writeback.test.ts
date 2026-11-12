/**
 * Two `_and_opp` lines, one too many and one missing.
 *
 * `Opp` is the one scratch character the C keeps beside `Kid` and
 * `Guard`: `loadkid_and_opp()` is `loadkid(); Opp = Guard;` and
 * `savekid_and_opp()` is `savekid(); Guard = Opp;`. Which of the pair
 * a function uses decides whether what it did to the other character
 * is kept or thrown away, and the translation had it wrong twice --
 * once each way.
 *
 * `tests/pop/dropped-lines.test.ts` already pins `play_guard_frame`'s,
 * which cost the shadow of level 12. These are the other two, found by
 * the same reading.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { g, newChar } from '../../src/pop/state.ts';
import { l5 } from '../../src/pop/link.ts';
import { play_kid_frame } from '../../src/pop/seg000.ts';
import { play_opp_seq } from '../../src/pop/seg001.ts';
import { charids } from '../../src/pop/types.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

describe('`play_kid_frame` ends in `savekid`, not `savekid_and_opp`', () => {
  it('leaves the guard alone whatever the Prince\'s frame wrote to `Opp`',
    async () => {
      // Level 3, whose room 3 has a skeleton, so there is a guard to
      // clobber at all.
      await PopGame.start(assets, exe, 3);
      g.Guard.direction = 0;
      g.Guard.x = 70;
      g.Guard.charid = charids.charid_2_guard;
      const before = { ...g.Guard };

      /**
       * `user_control` calls `control()` through the one slot
       * `play_kid_frame`'s subtree offers, so this stands for
       * anything inside the Prince's frame that writes `Opp`. In the
       * C nothing does today, which is why the suite's score is the
       * same either way -- `pop-report.ts` reads 11673 of 12038 with
       * `savekid` and with `savekid_and_opp`. The line still decides
       * what happens the moment something does.
       */
      const real = l5.control.fn;
      l5.control.fn = (): void => { g.Opp.x = 123; g.Opp.charid = 99; };
      try {
        play_kid_frame();
      } finally {
        l5.control.fn = real;
      }
      expect(g.Opp.x, 'the slot ran').toBe(123);
      // `savekid_and_opp` would have copied all of that into `Guard`.
      expect(g.Guard.x).toBe(before.x);
      expect(g.Guard.charid).toBe(before.charid);
    });
});

describe('`play_opp_seq` begins with `loadshad_and_opp`', () => {
  it('puts the Prince in `Opp`, which is the line the port dropped', () => {
    // `play_opp_seq` is `loadshad_and_opp(); if (Char.frame) {...}`,
    // and `loadshad_and_opp` is `loadshad(); Opp = Kid;`. With
    // `Guard.frame` nought nothing else happens, so what is left is
    // the two loads.
    g.Guard = newChar();
    g.Guard.charid = charids.charid_5_princess;
    g.Guard.x = 42;
    g.Guard.frame = 0;
    g.Kid = newChar();
    g.Kid.charid = charids.charid_24_mouse;
    g.Kid.x = 180;
    // Something else entirely in `Opp` beforehand.
    g.Opp = newChar();
    g.Opp.charid = 99;
    g.Opp.x = 7;

    play_opp_seq();

    // `loadshad()`: `Char` is the princess.
    expect(g.Char.charid).toBe(charids.charid_5_princess);
    expect(g.Char.x).toBe(42);
    // `Opp = Kid`, which the translation did not do.
    expect(g.Opp.charid).toBe(charids.charid_24_mouse);
    expect(g.Opp.x).toBe(180);
  });
});
