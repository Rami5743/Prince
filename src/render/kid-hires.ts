/**
 * The Prince repainted, drawn over the picture at `quality: high`.
 *
 * `graphics/kid-10x/` holds all 219 of `KID.DAT`'s sprites repainted
 * at **ten times** the original's size, each one exactly ten times
 * its own frame so that a position in the game's own coordinates is
 * a position here. They came from the `gpt` branch; the working
 * notes are `graphics/KID-ART.md`.
 *
 * ## Two things stand between that artwork and the screen
 *
 * **It is not in the game's palette.** Measured over all 219: 74550
 * distinct opaque colours, of which exactly **one** is one of
 * `KID.DAT`'s own sixteen, and 864817 pixels that are partly
 * transparent. That is the thing the upscaler's own section warns
 * about -- a finished RGB pixel has no index left to change, so it
 * would stay bright through a `fade_out_2` and would not fade with
 * the screen it is on.
 *
 * The answer is not to quantise it back to sixteen colours, which
 * would throw the painting away. A fade moves every entry of a bank
 * towards black **together**, so the whole of it is one number:
 * `fadeOf` reads the live palette against the bank it was loaded
 * with and returns that ratio, and every pixel of the sprite is
 * multiplied by it. A faded screen fades him with it.
 *
 * **It has to go behind what is in front of him.** The Prince is
 * blitted into the 320 by 200 surface and the foreground tiles --
 * a pillar, a gate, the level door -- are drawn *after* him, so on
 * the finished surface his pixels are only where he is visible. His
 * bank is `PALETTE_BASE.kid`, 112 to 127, and the guard's is 128, so
 * **an index in that range is a pixel of his that survived**. The
 * repainted sprite is drawn only there.
 *
 * That one test does the clipping too: the level door cuts him off
 * by `paint.clip`, and a pixel that was clipped away was never
 * written, so it is not in his bank either. And the edge it cuts on
 * is a tile edge, which is where the occluder's own hard edge is, so
 * nothing is lost to the mask being at the surface's resolution.
 *
 * ## The soft edge is the hard part, and it was got wrong twice
 *
 * A painted outline is not the blit's outline: it is anti-aliased, so
 * the pixel at its edge is half air. Asking "is this surface pixel
 * his?" of such a pixel throws the painting's whole edge away and
 * gives it the staircase back -- which is what the first attempt did.
 *
 * Letting every soft pixel through instead is the other fault, and it
 * is worse: on the five ticks of the climb at the top of level 1's
 * room 1 the game draws **no** Prince at all -- he is behind the
 * ledge, 326 of his 326 solid pixels are somebody else's -- and a
 * rule that only guards the solid ones drew his outline in mid-air,
 * a ghost of him over the stone.
 *
 * So the soft edge is allowed exactly where it belongs: next to a
 * pixel of his that **survived**. `kept` is the solid pixels whose
 * index is still his, and a soft pixel is painted only within one
 * surface pixel of one of those. Measured over all 219 sprites, the
 * ink outside the blocky silhouette is 19163 pixels at a distance of
 * one and 118 at two or more, so one is the whole of the painting;
 * and where nothing of him survived, `kept` is empty and the sprite
 * is not drawn.
 */
import type { Surface } from './surface.ts';

/** `PALETTE_BASE.kid`: his sixteen entries begin here. */
export const KID_BANK = 112;
const BANK_SIZE = 16;

/** Where the sprites live, relative to the page. */
export const KID_HIRES_DIR = 'graphics/kid-10x';

/** The size the artwork was painted at, times the original's. */
export const KID_HIRES_SCALE = 10;

/** One sprite the game drew, in the game's own coordinates. */
export interface KidSprite {
  /** The resource id, 401..619. */
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly flipped: boolean;
}

/** A sprite scaled to one display factor, kept so it is scaled once. */
interface Scaled {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray;
}

/**
 * How dark the palette is against the bank the sprites were painted
 * for, as one number in 0..1.
 *
 * `fade_out_2` walks every entry of the screen towards black in
 * sixty-four steps, so the sixteen entries of one bank keep their
 * ratios to each other and only their common scale moves. Summing
 * the whole bank and dividing is that scale, and it needs no state:
 * the base is the palette the sprites' own file was loaded with.
 */
export function fadeOf(live: Uint8Array, base: readonly number[]): number {
  let top = 0;
  let bottom = 0;
  for (let i = 0; i < BANK_SIZE; i++) {
    const at = (KID_BANK + i) * 4;
    top += live[at]! + live[at + 1]! + live[at + 2]!;
    bottom += base[i * 3]! + base[i * 3 + 1]! + base[i * 3 + 2]!;
  }
  if (bottom === 0) return 1;
  return Math.min(1, top / bottom);
}

/** Is any of the eight neighbours of (x, y), or (x, y) itself, set? */
function near(mask: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= w) continue;
      if (mask[yy * w + xx]) return true;
    }
  }
  return false;
}

/**
 * The repainted sprites, scaled to the factor the display draws at.
 *
 * A sprite is scaled once and kept: the art is ten times the game's
 * size and the canvas is three, so without this every frame would
 * average eleven source pixels for each of thirteen thousand.
 */
export class KidHiRes {
  private readonly source = new Map<number, ImageData>();
  private readonly scaled = new Map<string, Scaled>();
  private readonly covers = new Map<string, Uint8Array & { width: number }>();
  /** The bank the sprites were painted for: sixteen RGB triples, 0..255. */
  private base: readonly number[] = [];

  /** The sixteen colours of `KID.DAT`'s own header, DAC-expanded. */
  setBasePalette(rgb: readonly number[]): void {
    this.base = rgb;
  }

  /** Is there artwork for this frame yet? */
  has(id: number): boolean {
    return this.source.has(id);
  }

  /** Keep one decoded sprite. The page fetches and decodes them. */
  put(id: number, image: ImageData): void {
    this.source.set(id, image);
  }

  /**
   * Draw every sprite the game drew into the composed frame.
   *
   * `rgba` is the finished picture at `factor` times the surface,
   * which is what `presentHigh` has just composed; `surface` is the
   * 320 by 200 the game itself drew, and is the mask.
   */
  draw(
    rgba: Uint8ClampedArray,
    factor: number,
    surface: Surface,
    sprites: readonly KidSprite[],
    fade: number,
  ): number {
    let drawn = 0;
    const w = surface.width;
    const h = surface.height;
    const pitch = w * factor;
    for (const s of sprites) {
      const art = this.at(s.id, factor, s.flipped);
      const cover = this.coverage(s.id, s.flipped);
      if (!art || !cover) continue;
      const cw = cover.width;
      const ch = cover.length / cw;
      // What survived: the pixels the artwork is solid over and the
      // game's own blit still owns. Nothing survived means something
      // is drawn over the whole of him and the painting is not his
      // to put back.
      const kept = new Uint8Array(cw * ch);
      let any = false;
      for (let y = 0; y < ch; y++) {
        const py = s.y + y;
        if (py < 0 || py >= h) continue;
        for (let x = 0; x < cw; x++) {
          if (!cover[y * cw + x]) continue;
          const px = s.x + x;
          if (px < 0 || px >= w) continue;
          const index = surface.pixels[py * w + px]!;
          if (index >= KID_BANK && index < KID_BANK + BANK_SIZE) {
            kept[y * cw + x] = 1;
            any = true;
          }
        }
      }
      if (!any) continue;
      drawn++;
      for (let sy = 0; sy < art.height; sy++) {
        const y = s.y * factor + sy;
        if (y < 0 || y >= h * factor) continue;
        const row = ((y / factor) | 0) - s.y;
        for (let sx = 0; sx < art.width; sx++) {
          const x = s.x * factor + sx;
          if (x < 0 || x >= pitch) continue;
          const col = ((x / factor) | 0) - s.x;
          if (row < 0 || row >= ch || col < 0 || col >= cw) continue;
          if (cover[row * cw + col]) {
            // Solid: his if and only if the surface still says so.
            if (!kept[row * cw + col]) continue;
          } else if (!near(kept, cw, ch, col, row)) {
            // Soft: only beside a pixel of his that survived.
            continue;
          }
          const a = art.rgba[(sy * art.width + sx) * 4 + 3]! / 255;
          if (a <= 0.004) continue;
          const d = (y * pitch + x) * 4;
          for (let c = 0; c < 3; c++) {
            const paint = art.rgba[(sy * art.width + sx) * 4 + c]! * fade;
            rgba[d + c] = paint * a + rgba[d + c]! * (1 - a);
          }
        }
      }
    }
    return drawn;
  }

  /**
   * Where the sprite is solid, at the surface's own resolution.
   *
   * One byte a surface pixel: 1 where the artwork is mostly opaque
   * over that whole pixel, which is where the game's own blit must
   * have written something, and 0 at the soft edge and outside. It is
   * the half of the mask that says "a pixel of his belongs here", and
   * `draw` only asks who owns a surface pixel where this says so.
   */
  private coverage(id: number, flipped: boolean): (Uint8Array & { width: number }) | null {
    const key = `${id}:${flipped ? 1 : 0}`;
    const had = this.covers.get(key);
    if (had) return had;
    const src = this.source.get(id);
    if (!src) return null;
    const w = Math.round(src.width / KID_HIRES_SCALE);
    const h = Math.round(src.height / KID_HIRES_SCALE);
    const out = Object.assign(new Uint8Array(w * h), { width: w });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = flipped ? w - 1 - x : x;
        let sum = 0;
        let n = 0;
        for (let yy = y * KID_HIRES_SCALE; yy < (y + 1) * KID_HIRES_SCALE; yy++) {
          for (let xx = sx * KID_HIRES_SCALE; xx < (sx + 1) * KID_HIRES_SCALE; xx++) {
            sum += src.data[(yy * src.width + xx) * 4 + 3]!;
            n++;
          }
        }
        out[y * w + x] = sum / n > 160 ? 1 : 0;
      }
    }
    this.covers.set(key, out);
    return out;
  }

  /** One sprite at one factor, scaled and flipped on first use. */
  private at(id: number, factor: number, flipped: boolean): Scaled | null {
    const key = `${id}:${factor}:${flipped ? 1 : 0}`;
    const had = this.scaled.get(key);
    if (had) return had;
    const src = this.source.get(id);
    if (!src) return null;
    const w = Math.round((src.width / KID_HIRES_SCALE) * factor);
    const h = Math.round((src.height / KID_HIRES_SCALE) * factor);
    const out = new Uint8ClampedArray(w * h * 4);
    // a box average, which is what shrinking is: nearest would throw
    // away eight of every nine pixels and give the painting back its
    // staircase.
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * src.height) / h);
      const y1 = Math.max(Math.floor(((y + 1) * src.height) / h), y0 + 1);
      for (let x = 0; x < w; x++) {
        const sx = flipped ? w - 1 - x : x;
        const x0 = Math.floor((sx * src.width) / w);
        const x1 = Math.max(Math.floor(((sx + 1) * src.width) / w), x0 + 1);
        let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
        for (let yy = y0; yy < y1; yy++) {
          for (let xx = x0; xx < x1; xx++) {
            const i = (yy * src.width + xx) * 4;
            const al = src.data[i + 3]! / 255;
            r += src.data[i]! * al; g += src.data[i + 1]! * al; b += src.data[i + 2]! * al;
            a += al; n++;
          }
        }
        const d = (y * w + x) * 4;
        // the colour is the average of what is *there*, so a soft edge
        // does not pull the skin towards black
        out[d] = a > 0 ? r / a : 0;
        out[d + 1] = a > 0 ? g / a : 0;
        out[d + 2] = a > 0 ? b / a : 0;
        out[d + 3] = (a / n) * 255;
      }
    }
    const made: Scaled = { width: w, height: h, rgba: out };
    this.scaled.set(key, made);
    return made;
  }
}
