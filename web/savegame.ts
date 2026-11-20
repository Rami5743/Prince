/**
 * Saving a game and loading it back.
 *
 * The original has no such thing. This is SDLPoP's `quick_save` --
 * `seg000.c:256`'s `quick_process`, field for field and in its order --
 * and it lives **here, in the shell, and not in `src/pop`**, for two
 * reasons. One is that `src/pop` is the translation of the original and
 * a quicksave is not in the original. The other is measured:
 * `tests/pop/dropped-lines.test.ts` walks every field of `Globals` and
 * fails on any field that is written and never read, and a module in
 * `src/` that read all of them to save them would make that test say
 * nothing at all.
 *
 * Three of the fields the C saves are not in `Globals` -- they are
 * statics of their own segment -- and each has an accessor beside it:
 * `curr_guard_color` in `seg002`, `droppedout` in `seg006` and
 * `last_loose_sound` in `seg007`.
 *
 * Loading does not write the level data back by hand. It starts the
 * level afresh, which runs the whole of the loader, and then writes the
 * saved state over it -- which is what `restore_room_after_quick_load`
 * does too, through `load_lev_spr`.
 */
import { g } from '../src/pop/state.ts';
import { directions } from '../src/pop/types.ts';
import { load_room_links, setGuardColor, curr_guard_color } from '../src/pop/seg002.ts';
import { loadkid_and_opp, droppedout, setDroppedout } from '../src/pop/seg006.ts';
import { looseSound } from '../src/pop/seg007.ts';

export const SAVE_FORMAT = 'prince-save';
/**
 * Bumped whenever the set of fields changes, so that a save made by an
 * older page is refused rather than loaded into the wrong fields --
 * which is what SDLPoP's own `quick_version` string is for.
 */
export const SAVE_VERSION = 1;

export interface SaveGame {
  format: typeof SAVE_FORMAT;
  version: number;
  savedAt: string;
  /** For the slot's label, so the player can tell two saves apart. */
  level: number;
  minutesLeft: number;
  hitPoints: number;
  state: Record<string, unknown>;
}

/**
 * `quick_process`'s list, in its order.
 *
 * `exit_room_timer` is commented out in the C's own list and is put
 * back to nought on loading instead, which is in
 * `restore_room_after_quick_load`; `next_sound` and `current_sound`
 * are commented out there too, because the channel is the device's and
 * not the game's. The `#ifdef` fields -- `curr_tick`, `torch_colors`,
 * the super jump -- belong to SDLPoP's own additions and this port does
 * not have them.
 */
const FIELDS = [
  // the level
  'level', 'checkpoint', 'upside_down', 'drawn_room', 'current_level',
  'next_level', 'mobs_count', 'mobs', 'trobs_count', 'trobs', 'leveldoor_open',
  // the Prince
  'Kid', 'hitp_curr', 'hitp_max', 'hitp_beg_lev', 'grab_timer', 'holding_sword',
  'united_with_shadow', 'have_sword', 'kid_sword_strike', 'pickup_obj_type',
  'offguard',
  // the guard
  'Guard', 'Char', 'Opp', 'guardhp_curr', 'guardhp_max', 'demo_index',
  'demo_time', 'guard_notice_timer', 'guard_skill', 'shadow_initialized',
  'guard_refrac', 'justblocked',
  // collision
  'curr_row_coll_room', 'curr_row_coll_flags', 'below_row_coll_room',
  'below_row_coll_flags', 'above_row_coll_room', 'above_row_coll_flags',
  'prev_collision_row',
  // the flash
  'flash_color', 'flash_time',
  // sounds
  'need_level1_music', 'is_screaming', 'is_feather_fall',
  // random
  'random_seed',
  // the hour
  'rem_min', 'rem_tick',
  // the controls, saved and restored around a sword fight
  'control_x', 'control_y', 'control_shift', 'control_forward',
  'control_backward', 'control_up', 'control_down', 'control_shift2',
  'ctrl1_forward', 'ctrl1_backward', 'ctrl1_up', 'ctrl1_down', 'ctrl1_shift2',
  // what the guard has noticed
  'is_guard_notice', 'can_guard_see_kid',
] as const;

/** The three the C saves that are a segment's own static. */
const STATICS = {
  curr_guard_color: { get: (): number => curr_guard_color, set: setGuardColor },
  droppedout: { get: (): number => droppedout, set: setDroppedout },
  last_loose_sound: { get: looseSound.get, set: looseSound.set },
};

/** A typed array as something `JSON.stringify` keeps. */
interface PackedArray { $: 'u8' | 'i8' | 'i16'; v: number[] }

function pack(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $: 'u8', v: [...value] } satisfies PackedArray;
  if (value instanceof Int8Array) return { $: 'i8', v: [...value] } satisfies PackedArray;
  if (value instanceof Int16Array) return { $: 'i16', v: [...value] } satisfies PackedArray;
  if (Array.isArray(value)) return value.map(pack);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = pack(v);
    return out;
  }
  return value;
}

function unpack(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unpack);
  if (typeof value === 'object' && value !== null) {
    const tagged = value as Partial<PackedArray>;
    if (tagged.$ === 'u8' && Array.isArray(tagged.v)) return Uint8Array.from(tagged.v);
    if (tagged.$ === 'i8' && Array.isArray(tagged.v)) return Int8Array.from(tagged.v);
    if (tagged.$ === 'i16' && Array.isArray(tagged.v)) return Int16Array.from(tagged.v);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = unpack(v);
    return out;
  }
  return value;
}

/** Everything the C's `quick_save` writes, as a plain object. */
export function snapshot(): SaveGame {
  const state: Record<string, unknown> = {};
  const live = g as unknown as Record<string, unknown>;
  for (const field of FIELDS) state[field] = pack(live[field]);
  for (const [name, slot] of Object.entries(STATICS)) state[name] = slot.get();
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    level: g.current_level,
    minutesLeft: g.rem_min,
    hitPoints: g.hitp_curr,
    state,
  };
}

/** True when this is a save this page knows how to read. */
export function readable(save: unknown): save is SaveGame {
  if (typeof save !== 'object' || save === null) return false;
  const s = save as Partial<SaveGame>;
  return s.format === SAVE_FORMAT && s.version === SAVE_VERSION
    && typeof s.state === 'object' && s.state !== null;
}

/**
 * Write a saved game over the globals.
 *
 * The level must already have been started, so that the loader has put
 * the sprites and the room back; this is the second half, and the tail
 * of it is `restore_room_after_quick_load` (`seg000.c:393`).
 */
export function restore(save: SaveGame): void {
  const live = g as unknown as Record<string, unknown>;
  for (const field of FIELDS) {
    if (!(field in save.state)) continue;
    live[field] = unpack(save.state[field]);
  }
  for (const [name, slot] of Object.entries(STATICS)) {
    const value = save.state[name];
    if (typeof value === 'number') slot.set(value);
  }

  // `restore_room_after_quick_load`, from `next_room = drawn_room = Kid.room`
  // on. The lines above it -- `reset_level_unused_fields`, `load_lev_spr`
  // and keeping `curr_guard_color` and `next_level` across them -- are the
  // level being started again, which the shell has already done.
  g.next_room = g.Kid.room;
  g.drawn_room = g.Kid.room;
  load_room_links();

  // `hitp_delta = guardhp_delta = 1`, which is how the C forces the
  // flasks to be painted again.
  g.hitp_delta = 1;
  g.guardhp_delta = 1;
  if (g.Guard.room !== g.drawn_room) {
    // "Like in clear_char()": a room the player was looking at may have
    // had a guard where this one has none.
    g.Guard.direction = directions.dir_56_none;
    g.guardhp_curr = 0;
  }
  loadkid_and_opp();
  // "Get rid of the `press button` message if the kid was dead."
  g.text_time_total = 0;
  g.text_time_remaining = 0;
  g.exit_room_timer = 0;
}

// --------------------------------------------------------------- the slots

const SLOT_KEY = (n: number): string => `prince.save.${n}`;
export const SLOTS = [1, 2, 3] as const;

export function readSlot(n: number): SaveGame | null {
  try {
    const text = window.localStorage.getItem(SLOT_KEY(n));
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    return readable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSlot(n: number, save: SaveGame): boolean {
  try {
    window.localStorage.setItem(SLOT_KEY(n), JSON.stringify(save));
    return true;
  } catch {
    // Out of room, or site data turned off.
    return false;
  }
}

export function clearSlot(n: number): void {
  try {
    window.localStorage.removeItem(SLOT_KEY(n));
  } catch {
    // Nothing to do: there was nothing there to begin with.
  }
}
