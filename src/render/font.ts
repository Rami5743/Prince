/**
 * The game's own font, read out of `PRINCE.EXE`.
 *
 * The DAT files have no font in them. Level 1's `Press Button to Continue`
 * is drawn with a font that lives in the executable, at the one place in
 * the 123 335-byte release that looks like the original's `rawfont`: a
 * first and last character, four measurements, and then a word offset per
 * character.
 *
 *     first 32  last 131
 *     height above the baseline 7, below it 2
 *     a line apart 1, a character apart 1
 *
 * Each character is a plain bitmap -- height, width, a word the original
 * keeps for itself, and then one row per line of the glyph, the leftmost
 * pixel in the high bit. Nothing is compressed. A lowercase letter is as
 * tall as a capital with its first rows blank, and one with a tail is two
 * rows taller, so every glyph is drawn from the same top.
 */
import type { Sprite } from './surface.ts';
import type { Surface } from './surface.ts';

/** Where the font sits in the 123 335-byte release. */
const FONT_OFFSET = 0x1a20c;

export interface Glyph {
  readonly width: number;
  readonly height: number;
  /** One palette index per pixel: 0 for a hole, 1 for ink. */
  readonly sprite: Sprite;
}

export interface Font {
  readonly firstChar: number;
  readonly lastChar: number;
  readonly heightAbove: number;
  readonly heightBelow: number;
  readonly lineSpacing: number;
  readonly charSpacing: number;
  readonly glyphs: readonly (Glyph | null)[];
}

/**
 * Is there a glyph header at this offset? Height and width are stored as
 * words whose high byte is always zero, which is enough to tell a header
 * from the pixels on either side of it.
 */
function looksLikeGlyph(exe: Uint8Array, o: number): boolean {
  return o > 0 && o + 6 <= exe.length
    && exe[o + 1] === 0 && exe[o + 3] === 0
    && exe[o] <= 16 && exe[o + 2] >= 1 && exe[o + 2] <= 20;
}

export function readFont(exe: Uint8Array, base = FONT_OFFSET): Font {
  const dv = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const firstChar = exe[base];
  const lastChar = exe[base + 1];
  const count = lastChar - firstChar + 1;
  const glyphs: (Glyph | null)[] = [];
  for (let i = 0; i < count; i++) {
    let o = base + dv.getUint16(base + 10 + i * 2, true);
    // From the backtick on, every offset in the table is one past the
    // glyph it names. Rather than carry a rule about which half of the
    // alphabet it is, take the offset that has a header under it.
    if (!looksLikeGlyph(exe, o) && looksLikeGlyph(exe, o - 1)) o -= 1;
    if (!looksLikeGlyph(exe, o)) { glyphs.push(null); continue; }
    const height = exe[o];
    const width = exe[o + 2];
    const stride = Math.ceil(width / 8);
    const pixels = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = exe[o + 6 + y * stride + (x >> 3)] ?? 0;
        pixels[y * width + x] = (byte >> (7 - (x & 7))) & 1;
      }
    }
    glyphs.push({ width, height, sprite: { width, height, pixels } });
  }
  return {
    firstChar,
    lastChar,
    heightAbove: dv.getInt16(base + 2, true),
    heightBelow: dv.getInt16(base + 4, true),
    lineSpacing: dv.getInt16(base + 6, true),
    charSpacing: dv.getInt16(base + 8, true),
    glyphs,
  };
}

function glyphOf(font: Font, code: number): Glyph | null {
  if (code < font.firstChar || code > font.lastChar) return null;
  return font.glyphs[code - font.firstChar] ?? null;
}

/**
 * How wide the text is drawn, including the gap after every character but
 * the last. A character the font does not have takes no room at all.
 */
export function textWidth(font: Font, text: string): number {
  let width = 0;
  let drawn = 0;
  for (const ch of text) {
    const g = glyphOf(font, ch.charCodeAt(0));
    if (!g) continue;
    width += g.width;
    drawn += 1;
  }
  return width + Math.max(0, drawn - 1) * font.charSpacing;
}

/**
 * Draw text with its top row at `top`, in one colour. The glyphs share a
 * top rather than a baseline, so this is the row a capital letter starts
 * on; a tail hangs `heightBelow` rows further down.
 */
export function drawText(
  surface: Surface, font: Font, text: string, x: number, top: number, color: number,
): number {
  let at = x;
  for (const ch of text) {
    const g = glyphOf(font, ch.charCodeAt(0));
    if (!g) continue;
    surface.blitMono(g.sprite, at, top, color);
    at += g.width + font.charSpacing;
  }
  return at - font.charSpacing;
}

/** Draw text centred between `left` and `right`. */
export function drawTextCentred(
  surface: Surface, font: Font, text: string,
  left: number, right: number, top: number, color: number,
): void {
  const width = textWidth(font, text);
  drawText(surface, font, text, left + ((right - left + 1 - width) >> 1), top, color);
}

// ---------------------------------------------------------------------------
// `seg009.c`'s own measurements.
//
// `drawText` and `drawTextCentred` above are the shell's, and the strip
// under the room is drawn with them. The hall of fame is drawn by the C's
// `draw_text`, which measures differently -- `get_char_width` adds the gap
// after *every* character, including the last -- and aligns inside a
// rectangle. These four are that, line for line, for the one case the hall
// of fame needs: a single line that fits.
// ---------------------------------------------------------------------------

// seg009:3E77
/** `get_char_width`: the glyph and the gap after it, or nought for a hole. */
export function charWidth(font: Font, code: number): number {
  const g = glyphOf(font, code);
  let width = 0;
  if (g) {
    width += g.width;
    if (width) width += font.charSpacing;
  }
  return width;
}

// seg009:403F
/** `get_line_width` / `get_cstring_width`. */
export function lineWidth(font: Font, text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(font, ch.charCodeAt(0));
  return width;
}

// seg009:0791
/** `get_text_center_y`: the baseline a line of text sits on in a rect. */
export function textCenterY(font: Font, top: number, bottom: number): number {
  const empty = bottom - font.heightAbove - font.heightBelow - top;
  return ((empty - (empty % 2)) >> 1) + font.heightAbove + (empty % 2) + top;
}

// seg009:3706
/**
 * `draw_text_character`: one glyph with its baseline at `y`, which is
 * where `textstate.current_y` is. Answers how far `current_x` moves.
 */
export function drawTextCharacter(
  surface: Surface, font: Font, code: number, x: number, y: number, color: number,
): number {
  const g = glyphOf(font, code);
  if (!g) return 0;
  surface.blitMono(g.sprite, x, y - font.heightAbove, color);
  return font.charSpacing + g.width;
}

// seg009:3F01
/**
 * `draw_text`, for one line.
 *
 * `find_linebreak` never fires here: the only text this draws is a hall
 * of fame row, and `input_str` will not take a character that would put
 * the cursor past the right edge of a box 140 pixels inside a 176-pixel
 * rectangle, so a name cannot be wide enough to wrap.
 *
 * `x_align` and `y_align` are the C's: negative left or top, nought
 * centre or middle, positive right or bottom.
 */
export function drawTextInRect(
  surface: Surface, font: Font, text: string,
  left: number, top: number, right: number, bottom: number,
  xAlign: number, yAlign: number, color: number,
): void {
  const rectWidth = right - left;
  const rectHeight = bottom - top;
  const fontLineDistance = font.heightAbove + font.heightBelow + font.lineSpacing;
  const textHeight = fontLineDistance - font.lineSpacing;
  let textTop = top;
  if (yAlign >= 0) {
    if (yAlign <= 0) {
      // The +1 is for simulating SHR + ADC/SBB.
      textTop += ((rectHeight + 1) / 2 | 0) - ((textHeight + 1) / 2 | 0);
    } else {
      textTop += rectHeight - textHeight;
    }
  }
  const currentY = textTop + font.heightAbove;
  const width = lineWidth(font, text);
  let textLeft = left;
  if (xAlign >= 0) {
    if (xAlign <= 0) textLeft += (rectWidth / 2 | 0) - (width / 2 | 0);
    else textLeft += rectWidth - width;
  }
  const savedLeft = surface.clipLeft;
  const savedRight = surface.clipRight;
  const savedTop = surface.clipTop;
  const savedBottom = surface.clipBottom;
  // `set_clip_rect(rect_ptr)` / `reset_clip_rect()`.
  surface.clipLeft = Math.max(savedLeft, left);
  surface.clipRight = Math.min(savedRight, right);
  surface.clipTop = Math.max(savedTop, top);
  surface.clipBottom = Math.min(savedBottom, bottom);
  let at = textLeft;
  for (const ch of text) {
    at += drawTextCharacter(surface, font, ch.charCodeAt(0), at, currentY, color);
  }
  surface.clipLeft = savedLeft;
  surface.clipRight = savedRight;
  surface.clipTop = savedTop;
  surface.clipBottom = savedBottom;
}
