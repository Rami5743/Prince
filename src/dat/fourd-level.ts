/**
 * "4-D Prince of Persia", a 1994 modification, as a map.
 *
 * `original/fourd/KIRILL.DAT` is the level file of a Russian
 * modification released by the scene group Drink Or Die. Its own
 * `FILE_ID.DIZ` claims "100% new levels and FX!", and the measurement
 * -- record by record against this repository's own `LEVELS.DAT` --
 * says what that is worth:
 *
 *     level    foreground tiles changed   room links changed
 *       1            0 of 720                   0 of 96
 *       2          423                         80
 *       3          616                         86
 *       4          570                         84
 *       5          501                         63
 *       6          484                         90
 *       7          463                         62
 *       8..11        0                          0
 *
 * **Six levels are new and five are the original's own**, 3057 of the
 * eleven levels' 7920 tiles in all.
 *
 * And it is eleven levels, not sixteen. The file is the same 37031
 * bytes with its index at the same offset, but only 2000..2010 have a
 * payload: 2011 and the four after it are written `id 0, offset 0,
 * size 0`, so levels 12, 13, 14, Jaffar and the princess are not in
 * it at all.
 *
 * So the map handed to the game is **built**, not served: the eleven
 * records the mod has, and the original's own for the five it has
 * not, which is the only way the game can be finished. Neither file
 * on disc is written to -- this is the same thing
 * `levelsDatWithPotionLevel` does with one record.
 */
import { DatFile } from './container.ts';
import { FIRST_LEVEL_RESOURCE, LAST_LEVEL_RESOURCE } from './level.ts';

/** The levels the modification actually supplies. */
export const FOURD_FIRST = 2000;
export const FOURD_LAST = 2010;

/** The six it rewrote; the rest of its eleven are the original's. */
export const FOURD_NEW_LEVELS: readonly number[] = [2, 3, 4, 5, 6, 7];

/**
 * The original's `LEVELS.DAT` with the modification's records in it.
 *
 * Both files have the same sixteen-entry index at the same offset and
 * the same 2305-byte records, so a record is copied as bytes --
 * payload and checksum byte together -- and nothing has to be parsed
 * or re-checksummed. A record the modification leaves blank is left
 * as the original's.
 */
export function levelsDatWithFourD(
  original: Uint8Array,
  kirill: Uint8Array,
): Uint8Array {
  const out = original.slice();
  const dst = new DatFile(out, 'LEVELS.DAT');
  const src = new DatFile(kirill, 'KIRILL.DAT');
  let taken = 0;
  for (let id = FIRST_LEVEL_RESOURCE; id <= LAST_LEVEL_RESOURCE; id++) {
    if (id < FOURD_FIRST || id > FOURD_LAST) continue;
    const from = src.entries.find((e) => e.id === id && e.size > 0);
    const to = dst.entries.find((e) => e.id === id);
    if (!from || !to || from.size !== to.size) continue;
    // the checksum byte and the payload, as they stand
    out.set(kirill.subarray(from.offset, from.offset + 1 + from.size), to.offset);
    taken++;
  }
  if (taken === 0) throw new Error('KIRILL.DAT: no level record could be used');
  return out;
}
