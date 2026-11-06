/**
 * Loading the game's own files, in the browser or in Node.
 *
 * Nothing here converts or repacks anything: the port reads the original
 * `.DAT` files as shipped, so there is no asset pipeline that could drift
 * away from the original.
 */
import { DatFile } from '../dat/container.ts';
import { parsePalette, paletteToRgba, type Palette } from '../dat/palette.ts';
import { decodeImage, isEmptyPlaceholder, type DecodedImage } from '../dat/image.ts';

export type Fetcher = (name: string) => Promise<Uint8Array>;

/** Where the room-tile group's replacement images live. */
export const OPTIONAL_GRAPHICS_BASE = 1200;

/** Image ids the original fills in from the 1200-range, as it listed them. */
export const OPTIONAL_GRAPHICS_RANGES: readonly (readonly [number, number])[] = [
  [1, 9], [30, 31], [75, 77], [78, 83], [86, 91], [101, 123], [127, 143], [10, 13],
];

export interface SpriteSet {
  readonly palette: Palette;
  /** First index of this group's 16-colour block in the 256-colour palette. */
  readonly paletteBase: number;
  readonly paletteRgba: Uint8Array;
  /** Indexed by offset from the group header: 1..imageCount. Null where the slot is empty. */
  readonly images: readonly (DecodedImage | null)[];
}

export class Assets {
  private readonly dats = new Map<string, DatFile>();
  private readonly fetcher: Fetcher;

  constructor(fetcher: Fetcher) {
    this.fetcher = fetcher;
  }

  async dat(name: string): Promise<DatFile> {
    let d = this.dats.get(name);
    if (!d) {
      d = new DatFile(await this.fetcher(name), name);
      this.dats.set(name, d);
    }
    return d;
  }

  /** Load a sprite group: its header resource plus the images that follow. */
  async group(
    file: string, header: number, paletteBase = 0, withOptional = false,
  ): Promise<SpriteSet> {
    const d = await this.dat(file);
    const palette = parsePalette(d.get(header));
    const images: (DecodedImage | null)[] = [null];
    for (let i = 1; i <= palette.imageCount; i++) {
      const id = header + i;
      if (!d.has(id)) {
        images.push(null);
        continue;
      }
      const payload = d.get(id);
      images.push(isEmptyPlaceholder(payload) ? null : decodeImage(payload));
    }
    if (withOptional) {
      // Many slots of the room-tile group are empty on disk and are filled in
      // afterwards from a second set of resources at 1200 + id. The big
      // pillars of a dungeon level are there, which is why the group looks
      // half empty until this runs.
      for (const [from, to] of OPTIONAL_GRAPHICS_RANGES) {
        for (let id = from; id <= to; id++) {
          if (id >= images.length) continue;
          const resource = OPTIONAL_GRAPHICS_BASE + id;
          if (!d.has(resource)) continue;
          const payload = d.get(resource);
          if (isEmptyPlaceholder(payload)) continue;
          images[id] = decodeImage(payload);
        }
      }
    }
    return { palette, paletteBase, paletteRgba: paletteToRgba(palette), images };
  }

  /** A single image that is not part of a group, with a palette named separately. */
  async image(file: string, id: number): Promise<DecodedImage> {
    const d = await this.dat(file);
    return decodeImage(d.get(id));
  }

  async palette(file: string, id: number): Promise<Palette> {
    const d = await this.dat(file);
    return parsePalette(d.get(id));
  }
}

export function browserFetcher(baseUrl: string): Fetcher {
  return async (name) => {
    const res = await fetch(`${baseUrl}/${name}`);
    if (!res.ok) throw new Error(`cannot load ${name}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
}
