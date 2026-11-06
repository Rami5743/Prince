/**
 * An 8-bit indexed drawing surface, the same shape as the VGA mode the game
 * ran in: 320x200 bytes, one palette index per pixel, against a 256-colour
 * palette.
 *
 * The 256 colours are not one flat palette. The original divides them into
 * sixteen blocks of sixteen and gives each sprite group a block of its own:
 * the room tiles live at one offset, the wall pieces at another, the Prince
 * at another. A sprite's pixels are 4-bit values that are written into the
 * screen with its group's offset added. That is why the torch flames come out
 * orange while the stonework around them stays grey, even though both are
 * drawn from colour indices 0..15 on disk.
 *
 * Keeping that arrangement, rather than converting each sprite to RGB as it
 * is drawn, is also what makes the game's palette effects possible: the
 * original changes colours under pixels that have already been drawn.
 */

export const SCREEN_WIDTH = 320;
export const SCREEN_HEIGHT = 200;
export const PALETTE_SIZE = 256;
export const BLOCK_SIZE = 16;

export interface Sprite {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

/** The 256-colour hardware palette, as 6-bit components like the DAC took. */
export class ScreenPalette {
  /** r, g, b per entry, each 0..63. */
  readonly rgb6 = new Uint8Array(PALETTE_SIZE * 3);
  private readonly rgba = new Uint8Array(PALETTE_SIZE * 4);
  private dirty = true;

  /** Load sixteen colours into the block starting at `base`. */
  loadBlock(base: number, colors: readonly { r: number; g: number; b: number }[]): void {
    for (let i = 0; i < colors.length && base + i < PALETTE_SIZE; i++) {
      const o = (base + i) * 3;
      this.rgb6[o] = colors[i].r;
      this.rgb6[o + 1] = colors[i].g;
      this.rgb6[o + 2] = colors[i].b;
    }
    this.dirty = true;
  }

  /** RGBA bytes, expanding each 6-bit component the way the DAC did. */
  toRgba(): Uint8Array {
    if (this.dirty) {
      for (let i = 0; i < PALETTE_SIZE; i++) {
        this.rgba[i * 4] = (this.rgb6[i * 3] << 2) & 0xff;
        this.rgba[i * 4 + 1] = (this.rgb6[i * 3 + 1] << 2) & 0xff;
        this.rgba[i * 4 + 2] = (this.rgb6[i * 3 + 2] << 2) & 0xff;
        this.rgba[i * 4 + 3] = 255;
      }
      this.dirty = false;
    }
    return this.rgba;
  }
}

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

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      this.pixels.fill(color, yy * this.width + x0, yy * this.width + x1);
    }
  }

  /** Copy every pixel, including the sprite's colour 0. */
  blitOpaque(src: Sprite, x: number, y: number, base = 0): void {
    this.blit(src, x, y, base, false);
  }

  /** Copy every pixel except the sprite's colour 0, which is see-through. */
  blitTransparent(src: Sprite, x: number, y: number, base = 0): void {
    this.blit(src, x, y, base, true);
  }

  /** Paint the sprite's non-zero pixels in one flat colour. */
  blitMono(src: Sprite, x: number, y: number, color: number): void {
    this.each(src, x, y, (dp, v) => {
      if (v !== 0) this.pixels[dp] = color;
    });
  }

  blitXor(src: Sprite, x: number, y: number, base = 0): void {
    this.each(src, x, y, (dp, v) => {
      this.pixels[dp] ^= base + v;
    });
  }

  private blit(src: Sprite, x: number, y: number, base: number, transparent: boolean): void {
    this.each(src, x, y, (dp, v) => {
      if (transparent && v === 0) return;
      this.pixels[dp] = base + v;
    });
  }

  private each(src: Sprite, x: number, y: number, fn: (dp: number, v: number) => void): void {
    const sx0 = Math.max(0, -x);
    const sy0 = Math.max(0, -y);
    const sx1 = Math.min(src.width, this.width - x);
    const sy1 = Math.min(src.height, this.height - y);
    for (let sy = sy0; sy < sy1; sy++) {
      let sp = sy * src.width + sx0;
      let dp = (y + sy) * this.width + (x + sx0);
      for (let sx = sx0; sx < sx1; sx++, sp++, dp++) fn(dp, src.pixels[sp]);
    }
  }

  /** Expand to RGBA for putImageData. */
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
