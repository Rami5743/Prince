/**
 * Why `cutscene4` scores 96% and `cutscene2`, `cutscene6` and
 * `cutscene12` score 54%, when all four are the same scene.
 *
 * `tbl_cutscenes` gives levels 2 and 6 the same generator, and
 * `cutscene_4` and `cutscene_12` differ from it by a single line:
 *
 *     cutscene_2_6   ... init_princess_right(); ... fade_in_1();
 *                        proc_cutscene_frame(26); fade_out_1();
 *     cutscene_4     ... princess_lying();      ... the same three
 *
 * Same sound, same hourglass, same twenty-six cutscene frames, same
 * two fades. So a 96 against a 54 cannot be the port's timing, and
 * it is not a bad capture either: three fresh captures of
 * `cutscene2` scored 72, 68 and 71 of 136 and two of `cutscene4`
 * scored 133 and 131.
 *
 * Put the capture's frames beside the port's and the whole of the
 * difference is **252 to 359 pixels of 64000**, every one of them
 * inside the princess's own 17-by-43 box, every one exactly **one
 * DAC unit brighter in the capture**. Everything else on the screen
 * -- 57000 pixels of room and of black -- is the port's picture to
 * the byte on the same frame. `cutscene4`'s fade is **diff 0 on
 * every frame**, with the same drift and the same rate.
 *
 * The one thing that differs is which palette bank the princess is
 * drawn out of:
 *
 *     cutscene2   standing, seq 94   359 pixels, all palette row 9
 *     cutscene4   lying,    seq 103  402 pixels, all palette row 10
 *
 * `make_pal_buffer_fadein` is given `FADE_CUTSCENE_ROWS` = 0x6689,
 * which is rows 0, 3, 7, 9, 10, 13 and 14, and `fade_in_frame` walks
 * them in that order writing sixteen DAC entries apiece. A thirty
 * frames a second grab and a two-sixtieth fade step beat together
 * exactly -- which is already written up in `cutscene.ts` as why the
 * odd frames of a fade never match -- and this says **where in the
 * write the grab lands**: after row 9 and before row 10. A princess
 * in row 9 is on the near side of the tear and is caught one shade
 * on; a princess in row 10 is on the far side and is not. Rows 0 and
 * 3 are on the near side too and show nothing, because what is
 * visible of row 0 is index 0, whose target is black and never
 * moves.
 *
 * So the three scenes' shortfall is the instrument, and this pins
 * the one fact that says so: the two poses are in two different
 * palette rows. If that ever stops being true the explanation above
 * is wrong and the scores should be looked at again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { CutscenePlayer } from '../../src/pop/cutscene.ts';
import { SpeakerClock, playScene } from '../../tools/dev/scene-common.ts';
import { FADE_CUTSCENE_ROWS } from '../../src/pop/screen.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Which palette rows the princess's own pixels are in, once the fade is over. */
async function princessRows(level: number): Promise<Map<number, number>> {
  const clock = await SpeakerClock.load(assets);
  const p = await CutscenePlayer.create(assets, exe, {
    sound: (w: number) => clock.play(w),
    soundPlaying: () => clock.playing,
    stopSounds: () => clock.stop(),
  });
  await playScene(assets, exe, { kind: 'level', level }, 100, () => {}, p, clock, {});
  const px = (p.render() as unknown as { pixels: Uint8Array }).pixels;
  // The room is rows 13 and 14, the background is row 0 and the
  // hourglass sand is row 3; what is left is the princess.
  const rows = new Map<number, number>();
  for (let i = 0; i < 320 * 200; i++) {
    const row = px[i] >> 4;
    if (row === 0 || row === 3 || row === 13 || row === 14) continue;
    rows.set(row, (rows.get(row) ?? 0) + 1);
  }
  return rows;
}

describe('the princess of a cutscene, and which palette row she is in', () => {
  it('is row 9 standing and row 10 lying', async () => {
    const standing = await princessRows(2);
    const lying = await princessRows(4);
    expect([...standing.keys()]).toEqual([9]);
    expect([...lying.keys()]).toEqual([10]);
    // Enough of her to be seen: a few hundred pixels either way.
    expect(standing.get(9)).toBeGreaterThan(300);
    expect(lying.get(10)).toBeGreaterThan(300);
  }, 120000);

  it('and level 6 and level 12 draw the standing one, as level 2 does', async () => {
    expect([...(await princessRows(6)).keys()]).toEqual([9]);
    expect([...(await princessRows(12)).keys()]).toEqual([9]);
  }, 120000);

  /**
   * And both rows are in the set the fade is given, so neither is
   * left out of it -- the difference is the order they are written
   * in, not whether they are written.
   */
  it('and the fade covers rows 0, 3, 7, 9, 10, 13 and 14', () => {
    const rows: number[] = [];
    for (let r = 0; r < 16; r++) if (FADE_CUTSCENE_ROWS & (1 << r)) rows.push(r);
    expect(rows).toEqual([0, 3, 7, 9, 10, 13, 14]);
  });
});
