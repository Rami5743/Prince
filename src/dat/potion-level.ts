/**
 * The potion level: a hand-written `LEVELS.DAT` record, and nothing else.
 *
 * **This is not part of the game.** It is one extra level record that the
 * potion page (`potion.html`) and `tests/pop/potion-level.test.ts` drop
 * into a *copy* of `LEVELS.DAT` in place of level 2, so that the six
 * potions can be walked onto one after another. `original/prince1` is
 * never written to. Everything else -- `PopGame`, `src/pop`, the
 * renderer, the sound -- is exactly what the real game uses; the only
 * thing that differs is these 2305 bytes.
 *
 * ## Why it exists
 *
 * The game has **one** feather potion, in level 7 room 1 row 2 column 8,
 * and the level's falling entry drops the Prince into room 1 at row 1
 * column 1 with five tiles of open shaft between him and it -- which is
 * exactly why no probe in the suite could ever drink it, and why the
 * feather and the inversion were written out of the C with unit tests
 * only and both had a line missing. The two inversion potions are in
 * level 9 rooms 7 and 10, and the level starts in room 11. So: a level
 * where he starts a step away from each of the six in turn.
 *
 * ## The rooms
 *
 * A room is 10 columns by 3 rows, and a character in row `r` walks on
 * the floor of row `r`'s own tiles. Both rooms here are a wall row, a
 * corridor, and a wall row, which is the shape of level 7's room 2.
 *
 *     room 1                                room 2  (to its right)
 *     row 0  wall x 10                      row 0  wall x 10
 *     row 1  . _ U _ H _ L _ _ _            row 1  _ F _ I _ O _ _ _ .
 *     row 2  wall x 10                      row 2  wall x 10
 *
 *     .  tiles_20_wall      the ends of the corridor
 *     _  tiles_1_floor      plain floor, one step wide
 *     U  hurt       `proc_get_object` case 5: -1 hit point, sound 13
 *     H  heal       case 1: +1 hit point, sound 33, red flash 2
 *     L  life       case 2: `add_life`, a new flask, sound 30, red 4
 *     F  feather    case 3: `feather_fall()`, green flash 3, sound 39
 *     I  inversion  case 4: `toggle_upside()`, no flash and no sound
 *     O  open       case 6: `trigger_button(0, 0, -1)` -- every gate
 *
 * The Prince starts in room 1 at row 1 column 1, facing right, and
 * **the order is the one that shows something every time**: the hurt
 * potion first, so that the heal behind it has a flask to fill --
 * case 1 is `if (hitp_curr != hitp_max)` and does nothing at all when
 * he is full, which is measured and not a fault.
 *
 * They are a floor tile apart so that he can stand between any two.
 * A potion is drunk by **standing in front of it and pressing
 * Shift**: `control_standing` (`seg005:0358`) is
 * `if (control_shift2 == CONTROL_HELD && control_shift == CONTROL_HELD
 * && check_get_item()) return;`, and `get_item` crouches him first
 * and `seq_78_drink` runs for about forty ticks before
 * `SEQ_GET_ITEM` reaches `proc_get_object`.
 *
 * ## The kinds, and where the number comes from
 *
 * A potion tile's kind is `curr_room_modif >> 3` and the modifier in
 * the **file** is the kind itself: `alterModifiers` rewrites a potion's
 * byte as `(bg << 3) & 0xff` when the level is loaded, and
 * `start_anim_potion` then ORs `prandom(6) + 1` into the bottom three
 * bits for the bubbles. Measured on the game's own data: level 7's
 * feather has `bg` 3 in the file and reads 27 at runtime (3 << 3 | 3),
 * and level 9's inversions have `bg` 4 and read 32.
 */

import {
  LEVEL_PAYLOAD_SIZE, LEVEL_TILE_COUNT, ROOM_COUNT, TILES_PER_ROOM,
  resourceIdOfLevel,
} from './level.ts';

/**
 * Which level record the potion level stands in for.
 *
 * **Level 2 and not level 1**, for one measured reason:
 * `control_crouched` holds the Prince down at the start of level 1
 * until `sound_25_presentation` has finished -- `need_level1_music`
 * is `current_level == 1` -- so a potion page on level 1 opens with
 * a Prince who will not move for the first two seconds and looks
 * broken. Level 2 is a dungeon like level 7 (`levelType` is 0 for
 * both), so the corridor is built out of the same tiles the feather
 * really stands on, and it is one `shift+l` from the start for a
 * capture under DOSBox.
 */
export const POTION_LEVEL_NUMBER = 2;

/** The six kinds `proc_get_object` knows, by the name the C gives them. */
export const POTION_KIND = {
  heal: 1, life: 2, feather: 3, inversion: 4, hurt: 5, open: 6,
} as const;

const W = 20; // tiles_20_wall
const F = 1; // tiles_1_floor
const P = 10; // tiles_10_potion

/**
 * The two rooms, tile by tile, with the modifier of each.
 *
 * `fg` is the tile code and `bg` is the byte the file holds: for a
 * potion that is its kind, and for everything here it is nought.
 */
interface RoomSpec {
  readonly fg: readonly number[];
  /** Only the tiles that need one; the rest are nought. */
  readonly bg: Readonly<Record<number, number>>;
}

const ROOMS: readonly RoomSpec[] = [
  // Room 1: the wall at column 0 stops him walking out of the left of
  // the level, and columns 7, 8 and 9 are the run into room 2.
  {
    fg: [
      W, W, W, W, W, W, W, W, W, W,
      W, F, P, F, P, F, P, F, F, F,
      W, W, W, W, W, W, W, W, W, W,
    ],
    bg: {
      12: POTION_KIND.hurt, // row 1 column 2
      14: POTION_KIND.heal, // row 1 column 4
      16: POTION_KIND.life, // row 1 column 6
    },
  },
  // Room 2: the corridor carries on from room 1's column 9 into this
  // room's column 0, and the wall at column 9 is the far end.
  {
    fg: [
      W, W, W, W, W, W, W, W, W, W,
      F, P, F, P, F, P, F, F, F, W,
      W, W, W, W, W, W, W, W, W, W,
    ],
    bg: {
      11: POTION_KIND.feather, // row 1 column 1
      13: POTION_KIND.inversion, // row 1 column 3
      15: POTION_KIND.open, // row 1 column 5
    },
  },
];

/** Where each potion is, for the page's legend and for the tests. */
export const POTION_PLACES: readonly {
  readonly name: keyof typeof POTION_KIND;
  readonly kind: number;
  readonly room: number;
  readonly row: number;
  readonly column: number;
}[] = ROOMS.flatMap((spec, i) => Object.entries(spec.bg).map(([pos, kind]) => ({
  name: (Object.keys(POTION_KIND) as (keyof typeof POTION_KIND)[])
    .find((k) => POTION_KIND[k] === kind)!,
  kind,
  room: i + 1,
  row: Math.floor(Number(pos) / 10),
  column: Number(pos) % 10,
})));

/** Room 1, row 1, column 1: a step to the left of the first potion. */
const START_ROOM = 1;
const START_POS = 11;
/**
 * Facing right: `dir_0_right` is 0, and this byte is the direction he
 * ends up facing.
 *
 * `do_startpos` (`seg003:0038`) is `Char.direction = ~level.start_dir`
 * -- "he starts facing the wrong way and turns into the right one" --
 * so for the first few ticks of the level he is the other way round
 * and the start sequence turns him. It cost a round to see, because
 * the level was on slot 1 at the time and `need_level1_music` held
 * him crouched through the turn.
 */
const START_DIR = 0;

/** `tile` 30 is what the game's own unused rooms carry: no guard. */
const NO_GUARD_TILE = 30;

const OFF_FG = 0;
const OFF_BG = 720;
const OFF_DOORLINKS1 = 1440;
const OFF_DOORLINKS2 = 1696;
const OFF_ROOMLINKS = 1952;
const OFF_USED_ROOMS = 2048;
const OFF_ROOM_XS = 2049;
const OFF_ROOM_YS = 2073;
const OFF_START_ROOM = 2112;
const OFF_START_POS = 2113;
const OFF_START_DIR = 2114;
const OFF_GUARDS = 2119;

/** The 2305 bytes of the level record. */
export function potionLevelPayload(): Uint8Array {
  const d = new Uint8Array(LEVEL_PAYLOAD_SIZE);
  for (let room = 0; room < ROOMS.length; room++) {
    const spec = ROOMS[room];
    for (let pos = 0; pos < TILES_PER_ROOM; pos++) {
      const i = room * TILES_PER_ROOM + pos;
      d[OFF_FG + i] = spec.fg[pos];
      d[OFF_BG + i] = spec.bg[pos] ?? 0;
    }
  }
  // Every other room is empty space with no links, which the Prince
  // can never reach: the corridor is walled at both ends.
  for (let i = ROOMS.length * TILES_PER_ROOM; i < LEVEL_TILE_COUNT; i++) {
    d[OFF_FG + i] = 0;
    d[OFF_BG + i] = 0;
  }
  // roomLinks[(room - 1) * 4 + dir], dir 0 left, 1 right, 2 up, 3 down.
  d[OFF_ROOMLINKS + 0 * 4 + 1] = 2; // room 1's right is room 2
  d[OFF_ROOMLINKS + 1 * 4 + 0] = 1; // room 2's left is room 1
  /**
   * The door-link table, which a level with no buttons still needs.
   *
   * `get_doorlink_next(i)` is `doorlinks1[i] & 0x80 ? 0 : 1` -- bit 7
   * is **"this is the last entry"** -- and `do_trigger_list`
   * (`seg007:09E5`) is a `for (;;)` that walks `index++` until it
   * finds one. A table of nought bytes therefore never ends, and a
   * blank level hangs the moment anything walks a list: measured, the
   * level would not even load. The game's own levels pad the unused
   * tail of the table with `255, 0, 255, 0, ...`, so 0xFF is what an
   * empty entry looks like -- bit 7 set, and a tile position of 31,
   * which is past the thirty a room has, so `trigger_1` finds no
   * target and nothing is triggered.
   */
  d.fill(0xff, OFF_DOORLINKS1, OFF_DOORLINKS1 + 256);
  d.fill(0x00, OFF_DOORLINKS2, OFF_DOORLINKS2 + 256);
  d[OFF_USED_ROOMS] = ROOMS.length;
  // Where the rooms sit on the level's own map, which `get_room_address`
  // does not read but the editor's view of a level does.
  d[OFF_ROOM_XS + 0] = 1; d[OFF_ROOM_YS + 0] = 1;
  d[OFF_ROOM_XS + 1] = 2; d[OFF_ROOM_YS + 1] = 1;
  d[OFF_START_ROOM] = START_ROOM;
  d[OFF_START_POS] = START_POS;
  d[OFF_START_DIR] = START_DIR & 0xff;
  for (let i = 0; i < ROOM_COUNT; i++) d[OFF_GUARDS + i] = NO_GUARD_TILE;
  return d;
}

/**
 * A copy of `LEVELS.DAT` with the potion level in place of level 1.
 *
 * The record is the same 2305 bytes as the one it replaces, so it is
 * written where it stands and only the resource's checksum byte has to
 * be worked out again: the format's rule is
 * `(checksum + sum(payload)) mod 256 === 0xFF`.
 */
export function levelsDatWithPotionLevel(bytes: Uint8Array): Uint8Array {
  const out = bytes.slice();
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const indexOffset = dv.getUint32(0, true);
  const count = dv.getUint16(indexOffset, true);
  const want = resourceIdOfLevel(POTION_LEVEL_NUMBER);
  for (let i = 0, p = indexOffset + 2; i < count; i++, p += 8) {
    if (dv.getUint16(p, true) !== want) continue;
    const offset = dv.getUint32(p + 2, true);
    const size = dv.getUint16(p + 6, true);
    const payload = potionLevelPayload().subarray(0, size);
    out.set(payload, offset + 1);
    let sum = 0;
    for (const b of payload) sum = (sum + b) & 0xff;
    out[offset] = (0xff - sum) & 0xff;
    return out;
  }
  throw new Error(`LEVELS.DAT has no resource ${want}`);
}
