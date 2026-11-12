/**
 * The cutscenes the port did not have.
 *
 * No capture reaches any of this -- a recording is one level of an
 * ordinary run -- so each scene is pinned here instead: that it draws
 * out of the game's own files, that the right people are in it, and
 * that it ends.
 *
 * What the numbers mean: the 256-colour palette is sixteen rows of
 * sixteen, and each bank of sprites is loaded into one of them, so
 * which row a pixel's index is in says which bank drew it. Row 13 is
 * the princess's room, 11 the story frame and its text, 12 the title
 * picture. A screen with no pixel in row 13 has not drawn the room.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import { Assets } from '../../src/render/assets.ts';
import { CutscenePlayer, UNIT_MS } from '../../src/pop/cutscene.ts';
import { g } from '../../src/pop/state.ts';
import { charids, chtabs } from '../../src/pop/types.ts';
import { tbl_cutscenes, hourglass_frame } from '../../src/pop/seg001.ts';
import { PopGame } from '../../src/pop/game.ts';
import { loadkid, play_kid } from '../../src/pop/seg006.ts';

const assets = new Assets(async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

/** Which sixteen-colour row each pixel of the screen came out of. */
function rowsOnScreen(pixels: Uint8Array): Set<number> {
  const rows = new Set<number>();
  for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) rows.add(pixels[i] >> 4);
  return rows;
}

interface Watched {
  /** Every palette row that was ever drawn. */
  rows: Set<number>;
  /** Every `charid` either character ever had while on the screen. */
  charids: Set<number>;
  /** Every sound the scene asked for, in order. */
  sounds: number[];
  /** How many seconds of the original's clock the scene took. */
  seconds: number;
  /** The most pixels that were ever lit at once. */
  mostLit: number;
  /** How many frames were drawn with `do_flash`'s colour behind them. */
  flashed: number;
}

/** Run a scene to the end on its own clock, watching what it draws. */
async function play(
  scene: Parameters<CutscenePlayer['begin']>[0],
  options: { remMin?: number; limitSeconds?: number; typeName?: string } = {},
): Promise<Watched> {
  const limitSeconds = options.limitSeconds ?? 300;
  // What to type when the hall of fame asks for a name: one key each
  // time round, and then Enter, which is what `input_str` returns on.
  const toType = [...(options.typeName ?? '')]
    .map((ch) => ({ key: '', ch }))
    .concat([{ key: 'enter', ch: '' }]);
  const sounds: number[] = [];
  const player = await CutscenePlayer.create(assets, exe,
    { sound: (which) => sounds.push(which) });
  // `rem_min` is the clock the level just finished left behind, and
  // `hourglass_frame` is the only thing that reads it here.
  if (options.remMin !== undefined) g.rem_min = options.remMin;
  player.begin(scene);
  const out: Watched = {
    rows: new Set(), charids: new Set(), sounds, seconds: 0, mostLit: 0, flashed: 0,
  };
  let units = 0;
  while (player.running && units < limitSeconds * 60) {
    player.advance(UNIT_MS);
    units++;
    if (player.wantsText && toType.length) {
      const next = toType.shift()!;
      player.pushKey(next.key, next.ch);
    }
    const pixels = player.render().pixels;
    for (const r of rowsOnScreen(pixels)) out.rows.add(r);
    let lit = 0;
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) lit++;
    if (lit > out.mostLit) out.mostLit = lit;
    if (g.Kid.frame) out.charids.add(g.Kid.charid);
    if (g.Guard.frame) out.charids.add(g.Guard.charid);
    // `do_flash(flash_color)` is `set_bg_attr(0, color)`: the black
    // of the palette made the flash's colour for a frame.
    const background = player.palette.entry(0);
    if (background[0] || background[1] || background[2]) out.flashed++;
  }
  out.seconds = units / 60;
  expect(player.running).toBe(false);
  return out;
}

describe('the ending', () => {
  it('plays the princess\'s room, the closing story and the title', async () => {
    // The hall of fame is the last thing in `end_sequence`, and it
    // will not come back until a name has been typed into it.
    const seen = await play({ kind: 'ending' }, { typeName: 'KID' });
    // The princess's room, out of PV.DAT: row 13 is `id_chtab_8_princessroom`
    // and row 14 the bed that is ORed into the holes it leaves.
    expect(seen.rows.has(13)).toBe(true);
    expect(seen.rows.has(14)).toBe(true);
    // The people in it: the Prince runs in, the princess turns and
    // hugs him, and the mouse comes in after them.
    expect([...seen.charids].sort((a, b) => a - b)).toEqual([
      charids.charid_0_kid, charids.charid_5_princess, charids.charid_24_mouse,
    ]);
    // `draw_full_image(STORY_FRAME)` and `STORY_HAIL`, out of TITLE.DAT's
    // group 40, which is loaded into row 11.
    expect(seen.rows.has(11)).toBe(true);
    // and `TITLE_MAIN`, group 50, row 12.
    expect(seen.rows.has(12)).toBe(true);
    // It is a picture, not a few stray pixels.
    expect(seen.mostLit).toBeGreaterThan(50000);
    // Long enough to read the story and short enough to end: 32.6
    // seconds before the hall of fame, and about fifteen more with
    // it -- two fades, the name typed a key at a time, `pop_wait(120)`
    // and the title wiped on again.
    expect(seen.seconds).toBeGreaterThan(25);
    expect(seen.seconds).toBeLessThan(70);
  }, 60000);

  it('is the only thing level 15 of the cutscene table does not have',
    () => {
      // `tbl_cutscenes`: a scene before levels 2, 4, 6, 8, 9 and 12,
      // and nothing before the rest.
      const withScene = tbl_cutscenes
        .map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
      expect(withScene).toEqual([2, 4, 6, 8, 9, 12]);
    });
});

describe('the hour running out', () => {
  it('plays the hourglass in the princess\'s room, with nobody in it',
    async () => {
      const seen = await play({ kind: 'expired' }, { remMin: 0 });
      // The room, out of PV.DAT, and the bed ORed into it.
      expect(seen.rows.has(13)).toBe(true);
      expect(seen.rows.has(14)).toBe(true);
      // `time_expired` puts nobody in the room: `reset_cutscene` has
      // cleared both frames and nothing sets them again.
      expect([...seen.charids]).toEqual([]);
      // Neither story screen is in it.
      expect(seen.rows.has(11)).toBe(false);
      expect(seen.rows.has(12)).toBe(false);
      // `proc_cutscene_frame(2)` and then `(100)` at six sixtieths
      // each, with a fade either side: 12.4 seconds.
      expect(seen.seconds).toBeGreaterThan(10);
      expect(seen.seconds).toBeLessThan(16);
    }, 60000);

  it('draws the hourglass itself, run right out', async () => {
    const player = await CutscenePlayer.create(assets, exe);
    player.begin({ kind: 'expired' });
    player.advance(UNIT_MS * 60);
    // `set_hourglass_state(7)`, and `draw_hourglass` puts
    // `hourglass_state + 2` of the princess-room bank in the mid
    // table. `add_midtable` keeps the id one lower than it is asked
    // for, the way `chtab_addrs` is indexed.
    const glass = g.midtable.filter((m) => m.chtab_id === chtabs.id_chtab_8_princessroom);
    expect(glass.map((m) => m.id)).toEqual([7 + 2 - 1]);
    // `hourglass_sandflow = -1`: no sand is running, so there is no
    // flow frame in the fore table either.
    expect(g.foretable.filter((f) => f.id >= 9).length).toBe(0);
  }, 30000);

  it('is how much sand is left, by the clock', () => {
    // `time_bound = {6, 17, 33, 65}` and `6 - bound_index`.
    const at = (min: number): number => { g.rem_min = min; return hourglass_frame(); };
    expect(at(0)).toBe(6);
    expect(at(5)).toBe(6);
    expect(at(6)).toBe(5);
    expect(at(16)).toBe(5);
    expect(at(17)).toBe(4);
    expect(at(33)).toBe(3);
    expect(at(60)).toBe(3);
    expect(at(65)).toBe(2);
  });

  it('comes for a Prince who dies on the last tick of the hour, '
    + 'on a level that is otherwise past expiring', async () => {
    // `play_frame`'s own test does not fire above level 12.
    const game = await PopGame.start(assets, exe, 13);
    g.rem_min = 0;
    expect(game.timeExpired).toBe(false);
    // `play_kid`'s does, and it has no level guard: this is the line
    // the translation had dropped.
    loadkid();
    // `is_dead()`: the frame he is lying in, not his hit points.
    g.Char.frame = 185; // frame_185_dead
    g.Char.alive = 7;
    play_kid();
    expect(g.game_expired).toBe(1);
    expect(game.timeExpired).toBe(true);
  });
});

describe('the scenes between the levels', () => {
  it('come before the six levels `tbl_cutscenes` names and no others', () => {
    const has = [];
    for (let level = 0; level <= 15; level++) {
      if (CutscenePlayer.hasCutsceneFor(level)) has.push(level);
    }
    expect(has).toEqual([2, 4, 6, 8, 9, 12]);
  });

  it('is the princess alone before levels 2 and 6', async () => {
    for (const level of [2, 6]) {
      const seen = await play({ kind: 'level', level }, { remMin: 40 });
      expect(seen.rows.has(13)).toBe(true);
      expect([...seen.charids]).toEqual([charids.charid_5_princess]);
      // `cutscene_2_6` plays `sound_27_cutscene_2_4_6_12` and nothing else.
      expect(seen.sounds).toEqual([27]);
      expect(seen.seconds).toBeGreaterThan(3);
      expect(seen.seconds).toBeLessThan(8);
    }
  }, 60000);

  it('is the princess lying down before level 4', async () => {
    const seen = await play({ kind: 'level', level: 4 }, { remMin: 40 });
    expect([...seen.charids]).toEqual([charids.charid_5_princess]);
    expect(seen.sounds).toEqual([27]);
  }, 30000);

  it('is the mouse and the princess before levels 8 and 9', async () => {
    for (const level of [8, 9]) {
      const seen = await play({ kind: 'level', level }, { remMin: 20 });
      expect([...seen.charids].sort((a, b) => a - b)).toEqual([
        charids.charid_5_princess, charids.charid_24_mouse,
      ]);
      // `sound_35_cutscene_8_9`.
      expect(seen.sounds).toEqual([35]);
    }
  }, 60000);

  it('before level 12 is one of two scenes, and the clock picks', async () => {
    // `cutscene_12`: `hourglass_frame() >= 6` -- fewer than six
    // minutes left -- is the short one, with its own sound; anything
    // else falls through to `cutscene_2_6`.
    const hurried = await play({ kind: 'level', level: 12 }, { remMin: 3 });
    expect(hurried.sounds).toEqual([40]); // sound_40_cutscene_12_short_time
    const unhurried = await play({ kind: 'level', level: 12 }, { remMin: 40 });
    expect(unhurried.sounds).toEqual([27]); // sound_27_cutscene_2_4_6_12
    // They are the same length to the frame, which is worth pinning
    // because it reads like a mistake and is not: the short one is
    // `proc_cutscene_frame(2)` and then `(24)`, the other one `(26)`.
    expect(hurried.seconds).toBe(unhurried.seconds);
  }, 60000);
});

describe('the title sequence', () => {
  it('is the titles, the story, Jaffar\'s scene and the credits',
    async () => {
      const seen = await play({ kind: 'title' });
      // TITLE.DAT group 50 is row 12 -- the picture, `Broderbund
      // Software presents`, `a game by Jordan Mechner` -- and group
      // 40 is row 11, the story frame and its text.
      expect(seen.rows.has(12)).toBe(true);
      expect(seen.rows.has(11)).toBe(true);
      // `load_intro(0, pv_scene, 0)` in the middle of it: the
      // princess's room out of PV.DAT, with the princess and the
      // Grand Vizier in it.
      expect(seen.rows.has(13)).toBe(true);
      expect([...seen.charids].sort((a, b) => a - b)).toEqual([
        charids.charid_5_princess, charids.charid_6_vizier,
      ]);
      // The sounds, in the order the C asks for them: the main theme,
      // story 1, story 2, the gate closing, the princess's door, story
      // 3 as Jaffar comes and story 4 as he leaves.
      expect(seen.sounds).toEqual([54, 55, 50, 4, 51, 53, 52]);
      /**
       * Jaffar conjuring the hourglass: `flash_time = 5` and
       * `flash_color = 15`, five frames of white behind the room.
       * `cutscene_frame_time` is 7 by then, so thirty-five sixtieths
       * -- and the C sets the colour and puts it back inside one
       * frame, which would show nothing at all if the driver did not
       * hold it for the frame it was asked on.
       */
      expect(seen.flashed).toBe(5 * 7);
      // A minute or so, with no speaker to wait for.
      expect(seen.seconds).toBeGreaterThan(50);
      expect(seen.seconds).toBeLessThan(90);
    }, 120000);
});
