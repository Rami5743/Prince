import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { DatFile } from '../../src/dat/container.ts';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GAME_DIR = join(REPO, 'original', 'prince1');
export const GOLDEN_DIR = join(REPO, 'tests', 'golden');

const cache = new Map<string, DatFile>();

export function dat(name: string): DatFile {
  let d = cache.get(name);
  if (!d) {
    d = new DatFile(new Uint8Array(readFileSync(join(GAME_DIR, name))), name);
    cache.set(name, d);
  }
  return d;
}

/** Every .DAT file shipped with the game. */
export const ALL_DATS = [
  'CDUNGEON.DAT', 'CPALACE.DAT', 'DIGISND1.DAT', 'DIGISND2.DAT', 'DIGISND3.DAT',
  'EDUNGEON.DAT', 'EPALACE.DAT', 'FAT.DAT', 'GUARD.DAT', 'GUARD1.DAT',
  'GUARD2.DAT', 'IBM_SND1.DAT', 'IBM_SND2.DAT', 'KID.DAT', 'LEVELS.DAT',
  'MIDISND1.DAT', 'MIDISND2.DAT', 'PRINCE.DAT', 'PV.DAT', 'SHADOW.DAT',
  'SKEL.DAT', 'TITLE.DAT', 'VDUNGEON.DAT', 'VIZIER.DAT', 'VPALACE.DAT',
] as const;

/** The graphics files, i.e. the ones whose resources decode as images. */
export const GRAPHICS_DATS = [
  'CDUNGEON.DAT', 'CPALACE.DAT', 'EDUNGEON.DAT', 'EPALACE.DAT',
  'VDUNGEON.DAT', 'VPALACE.DAT', 'FAT.DAT', 'GUARD.DAT', 'KID.DAT',
  'PV.DAT', 'SHADOW.DAT', 'SKEL.DAT', 'TITLE.DAT', 'VIZIER.DAT',
] as const;

export interface Frame {
  width: number;
  height: number;
  /** RGB triples, 3 bytes per pixel. */
  rgb: Uint8Array;
}

export function goldenFrame(name: string): Frame {
  const path = join(GOLDEN_DIR, name);
  if (!existsSync(path)) throw new Error(`missing golden frame ${name}`);
  const png = PNG.sync.read(readFileSync(path));
  const rgb = new Uint8Array(png.width * png.height * 3);
  for (let i = 0; i < png.width * png.height; i++) {
    rgb[i * 3] = png.data[i * 4];
    rgb[i * 3 + 1] = png.data[i * 4 + 1];
    rgb[i * 3 + 2] = png.data[i * 4 + 2];
  }
  return { width: png.width, height: png.height, rgb };
}

/**
 * DOSBox renders through a 16-bit RGB565 surface, so a captured frame holds
 * the game's 8-bit-per-channel output quantised to 5/6/5 bits. Applying the
 * same quantisation to our own output makes the two directly comparable
 * without loosening the comparison itself: every pixel must still match.
 */
export const q5 = (v: number): number => ((v >> 3) << 3) | (v >> 3 >> 2);
export const q6 = (v: number): number => ((v >> 2) << 2) | (v >> 2 >> 4);

export function toCaptureSpace(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    out[i] = q5(rgb[i]);
    out[i + 1] = q6(rgb[i + 1]);
    out[i + 2] = q5(rgb[i + 2]);
  }
  return out;
}

export interface Mismatch {
  count: number;
  first?: { x: number; y: number; got: number[]; want: number[] };
}

export function compareRgb(
  got: Uint8Array,
  want: Uint8Array,
  width: number,
  height: number,
): Mismatch {
  let count = 0;
  let first: Mismatch['first'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      if (got[i] !== want[i] || got[i + 1] !== want[i + 1] || got[i + 2] !== want[i + 2]) {
        count++;
        if (!first) {
          first = {
            x, y,
            got: [got[i], got[i + 1], got[i + 2]],
            want: [want[i], want[i + 1], want[i + 2]],
          };
        }
      }
    }
  }
  return { count, first };
}
