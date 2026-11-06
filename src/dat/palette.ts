/**
 * Shape-list resource — 100 bytes, the header of a group of images.
 *
 *   offset 0  : image count of the group that follows
 *   offset 1  : uint16 row bits
 *   offset 3  : colour count (always 16)
 *   offset 4  : 16 * { r, g, b }, each 0..63   (VGA)
 *   offset 52 : 16 bytes                        (CGA)
 *   offset 68 : 32 bytes                        (EGA)
 *
 * The image count is what ties a palette to its sprites: resource 400 of
 * KID.DAT says 219, and ids 401..619 are exactly 219 images. One resource
 * carries the colours for every video mode, which is why the character
 * sprite files need no per-mode variants.
 */

export interface Rgb6 {
  /** 0..63, as stored — this is what the VGA DAC received. */
  r: number;
  g: number;
  b: number;
}

export interface Palette {
  /** Number of images in the group this header introduces. */
  readonly imageCount: number;
  readonly rowBits: number;
  readonly colorCount: number;
  /** 16 entries, components 0..63. */
  readonly vga: readonly Rgb6[];
  readonly cga: Uint8Array;
  readonly ega: Uint8Array;
}

export const PALETTE_SIZE = 100;

export function parsePalette(payload: Uint8Array): Palette {
  if (payload.length !== PALETTE_SIZE) {
    throw new Error(`palette must be ${PALETTE_SIZE} bytes, got ${payload.length}`);
  }
  const vga: Rgb6[] = [];
  for (let i = 0; i < 16; i++) {
    const o = 4 + i * 3;
    vga.push({ r: payload[o], g: payload[o + 1], b: payload[o + 2] });
  }
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    imageCount: payload[0],
    rowBits: dv.getUint16(1, true),
    colorCount: payload[3],
    vga,
    cga: payload.slice(52, 68),
    ega: payload.slice(68, 100),
  };
}

/**
 * Expand a stored 6-bit component to 8 bits the way the VGA DAC did:
 * the six bits are the high bits of the output. 63 -> 252, not 255.
 */
export function to8(c6: number): number {
  return (c6 << 2) & 0xff;
}

/** RGBA bytes for the 16 palette entries, alpha 255 throughout. */
export function paletteToRgba(pal: Palette): Uint8Array {
  const out = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    out[i * 4 + 0] = to8(pal.vga[i].r);
    out[i * 4 + 1] = to8(pal.vga[i].g);
    out[i * 4 + 2] = to8(pal.vga[i].b);
    out[i * 4 + 3] = 255;
  }
  return out;
}
