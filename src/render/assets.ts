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

export interface SpriteSet {
  readonly palette: Palette;
  readonly paletteRgba: Uint8Array;
  /** Indexed by offset from the group header: 1..imageCount. Null where the slot is empty. */
  readonly images: readonly (DecodedImage | null)[];
}

export class Assets {
  private readonly dats = new Map<string, DatFile>();

  constructor(private readonly fetcher: Fetcher) {}

  async dat(name: string): Promise<DatFile> {
    let d = this.dats.get(name);
    if (!d) {
      d = new DatFile(await this.fetcher(name), name);
      this.dats.set(name, d);
    }
    return d;
  }

  /** Load a sprite group: its header resource plus the images that follow. */
  async group(file: string, header: number): Promise<SpriteSet> {
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
    return { palette, paletteRgba: paletteToRgba(palette), images };
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
