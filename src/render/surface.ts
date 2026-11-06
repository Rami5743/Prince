/**
 * An 8-bit indexed drawing surface, the same shape as the VGA mode the game
 * ran in: 320x200 bytes, one palette index per pixel.
 *
 * Working in palette indices rather than RGB is not an optimisation. The
 * original composes the screen by writing colour *indices* and only converts
 * once, at the DAC; palette effects such as the level-entry flash change the
 * colours under pixels that were already drawn. Keeping the same two stages
 * is what makes the output comparable to the original's.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;

export class Surface {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;

  constructor(width = SCREEN_WIDTH, height = SCREEN_HEIGHT) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  clear(color = 0): void {
    this.pixels.fill(color);
  }

  /** Copy every pixel, including index 0. */
  blitOpaque(
    src: { width: number; height: number; pixels: Uint8Array },
    x: number,
    y: number,
  ): void {
    this.blit(src, x, y, false);
  }

  /** Copy every pixel except index 0, which the original treats as see-through. */
  blitTransparent(
    src: { width: number; height: number; pixels: Uint8Array },
    x: number,
    y: number,
  ): void {
    this.blit(src, x, y, true);
  }

  private blit(
    src: { width: number; height: number; pixels: Uint8Array },
    x: number,
    y: number,
    transparent: boolean,
  ): void {
    const x0 = Math.max(0, -x);
    const y0 = Math.max(0, -y);
    const x1 = Math.min(src.width, this.width - x);
    const y1 = Math.min(src.height, this.height - y);
    for (let sy = y0; sy < y1; sy++) {
      let sp = sy * src.width + x0;
      let dp = (y + sy) * this.width + (x + x0);
      for (let sx = x0; sx < x1; sx++, sp++, dp++) {
        const v = src.pixels[sp];
        if (transparent && v === 0) continue;
        this.pixels[dp] = v;
      }
    }
  }

  /** Expand to RGBA using a 16-entry palette, for putImageData. */
  toRgba(paletteRgba: Uint8Array, out?: Uint8ClampedArray): Uint8ClampedArray {
    const dst = out ?? new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 4;
      dst[i * 4] = paletteRgba[c];
      dst[i * 4 + 1] = paletteRgba[c + 1];
      dst[i * 4 + 2] = paletteRgba[c + 2];
      dst[i * 4 + 3] = 255;
    }
    return dst;
  }

  /** RGB triples, for comparing against a captured frame. */
  toRgb(paletteRgba: Uint8Array): Uint8Array {
    const dst = new Uint8Array(this.width * this.height * 3);
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 4;
      dst[i * 3] = paletteRgba[c];
      dst[i * 3 + 1] = paletteRgba[c + 1];
      dst[i * 3 + 2] = paletteRgba[c + 2];
    }
    return dst;
  }
}
