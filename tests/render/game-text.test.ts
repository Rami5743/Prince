/**
 * Every word the game itself draws, in the player's language.
 *
 * Three things have to hold and none of them is "the translation is
 * good", which no test can say:
 *
 * * **the words fit**. `rect_bottom_text` is `{193, 70, 202, 250}`, so
 *   a line under the room has a hundred and eighty pixels and a line
 *   that overruns is drawn off the end of the strip. Every string the
 *   game can draw, in both languages, is measured here.
 * * **the line reads the right way round**. A Hebrew line with a
 *   number in it is the whole of the bidi this game needs, and the
 *   number must not come out backwards.
 * * **nothing changes with the language at its default**. The engine
 *   is measured against captures of a real PRINCE.EXE, so a text layer
 *   set to English at the original quality has to draw the pixels the
 *   font drew before there was a text layer at all -- byte for byte,
 *   not approximately.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from '../helpers/fixtures.ts';
import {
  readFont, drawTextCentred, drawTextInRect, textWidth,
} from '../../src/render/font.ts';
import { GameText, toVisual, hasRtl, fitLine } from '../../src/render/text.ts';
import { HEBREW_GLYPHS } from '../../src/render/hebrew.ts';
import { Surface } from '../../src/render/surface.ts';

const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));
const font = readFont(exe);

/** `rect_bottom_text`. */
const STRIP = { left: 70, top: 193, right: 250, bottom: 202 };
const STRIP_WIDTH = STRIP.right - STRIP.left;

/** Every string `display_text_bottom` can be given. */
const EVERY_LINE = [
  'GAME PAUSED',
  'TIME HAS EXPIRED!',
  'Press Button to Continue',
  '1 SECOND LEFT',
  ...Array.from({ length: 14 }, (_, i) => `LEVEL ${i + 1}`),
  ...[60, 55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 4, 3, 2].map((n) => `${n} MINUTES LEFT`),
  ...[59, 30, 11, 2].map((n) => `${n} SECONDS LEFT`),
];

describe('the words the game draws', () => {
  it('has a Hebrew letter for every letter of the alphabet', () => {
    const alphabet = 'אבגדהוזחטיךכלםמןנסעףפץצקרשת';
    for (const ch of alphabet) expect(HEBREW_GLYPHS.has(ch), ch).toBe(true);
    // Seven rows above the line, which is what a capital of the
    // release's own font is; the five that hang below it are nine,
    // which is `heightAbove + heightBelow`. A yod is three and is
    // meant to be: a short glyph is a high one, because the font's
    // glyphs share a top rather than a baseline.
    for (const [ch, g] of HEBREW_GLYPHS) {
      if (ch === 'י' || ch === '׳' || ch === '״') continue;
      expect(g.height, ch).toBe('ךןףץק'.includes(ch) ? 9 : 7);
    }
  });

  it('translates every line the game can draw', () => {
    const he = new GameText(font, { language: 'he' });
    for (const line of EVERY_LINE) {
      const said = he.translate(line);
      expect(said, line).not.toBe(line);
      expect(hasRtl(said), line).toBe(true);
    }
  });

  it('fits every line inside the strip under the room, in both languages', () => {
    for (const language of ['en', 'he'] as const) {
      const text = new GameText(font, { language });
      for (const line of EVERY_LINE) {
        const said = text.translate(line);
        const width = text.storyLineWidth(said);
        expect(width, `${language}: ${said}`).toBeLessThanOrEqual(STRIP_WIDTH);
      }
    }
  });

  it('lays a Hebrew line out from the right, with its number the right way round', () => {
    // `נותרו 60 דקות`: the digits keep their own order and everything
    // else is reversed, so the visual line ends with the first Hebrew
    // word's last letter and has `60` in the middle, unreversed.
    const visual = toVisual('נותרו 60 דקות');
    expect(visual).toContain('60');
    expect(visual).not.toContain('06');
    expect([...visual].reverse().join('')).toBe('נותרו 06 דקות');
    // The mark at the end of a Hebrew sentence belongs at its left.
    expect(toVisual('תם הזמן!').startsWith('!')).toBe(true);
    // A hall of fame time is not Hebrew and is left alone.
    expect(toVisual('3:45')).toBe('3:45');
  });

  it('leaves room under the line for the tails Hebrew has and English has not', () => {
    const he = new GameText(font, { language: 'he', quality: 'original' });
    const en = new GameText(font, { language: 'en', quality: 'original' });
    const hebrew = new Surface();
    const english = new Surface();
    he.bottomText(hebrew, '60 MINUTES LEFT', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    en.bottomText(english, '60 MINUTES LEFT', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    const rowsOf = (s: Surface): number[] => {
      const rows: number[] = [];
      for (let y = 188; y < 200; y++) {
        for (let x = STRIP.left; x < STRIP.right; x++) {
          if (s.pixels[y * 320 + x] !== 0) { rows.push(y); break; }
        }
      }
      return rows;
    };
    const heRows = rowsOf(hebrew);
    const enRows = rowsOf(english);
    // The English line is exactly where the capture has it, rows 193
    // to 199, and the Hebrew is one row up with a tail on 199.
    expect(enRows[0]).toBe(193);
    expect(heRows[0]).toBe(192);
    expect(heRows[heRows.length - 1]).toBe(199);
  });

  it('draws the English strip exactly as the font did before it existed', () => {
    const text = new GameText(font, { language: 'en', quality: 'original' });
    for (const line of EVERY_LINE) {
      const was = new Surface();
      const now = new Surface();
      drawTextCentred(was, font, line, STRIP.left, STRIP.right - 1, STRIP.top, 15);
      text.bottomText(now, line, STRIP.left, STRIP.top, STRIP.right - 1, 15);
      expect([...now.pixels], line).toEqual([...was.pixels]);
    }
    // And nothing is left on the overlay for the canvas to draw.
    expect(text.overlay).toEqual([]);
  });

  it('draws a hall of fame row exactly as `draw_text` did', () => {
    const text = new GameText(font, { language: 'en', quality: 'original' });
    // `hof_rects[0]`, and the two alignments `show_hof_text` uses.
    const rect = { left: 90, top: 70, right: 266, bottom: 79 };
    for (const align of [-1, 1]) {
      const was = new Surface();
      const now = new Surface();
      drawTextInRect(was, font, 'JORDAN', rect.left, rect.top, rect.right, rect.bottom,
        align, 0, 0xB7);
      text.showText(now, 'JORDAN', rect.left, rect.top, rect.right, rect.bottom,
        align, 0, 0xB7);
      expect([...now.pixels], `align ${align}`).toEqual([...was.pixels]);
    }
  });

  it('measures a character the way `get_char_width` does', () => {
    const text = new GameText(font, { language: 'he' });
    expect(text.charWidth('A')).toBe(7);
    // A Hebrew letter is the glyph and the same one-pixel gap.
    expect(text.charWidth('א')).toBe(HEBREW_GLYPHS.get('א')!.width + font.charSpacing);
    // A character neither font has takes no room at all, as the C's does.
    expect(text.charWidth('☃')).toBe(0);
  });

  it('keeps the strip clear and puts the line on the overlay at `high`', () => {
    const text = new GameText(font, { language: 'he', quality: 'high' });
    const surface = new Surface();
    text.bottomText(surface, '60 MINUTES LEFT', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(surface.pixels.some((v) => v !== 0), 'nothing is blitted').toBe(false);
    expect(text.overlay).toHaveLength(1);
    const item = text.overlay[0]!;
    // The canvas runs bidi itself, so the overlay carries the logical
    // line and not the visual one.
    expect(item.text).toBe('נותרו 60 דקות');
    expect(item.rtl).toBe(true);
    // The baseline is the original's own -- the last row of the
    // screen -- and the line carries the band of rows its ink has to
    // stay inside. A vector face is not the height of its cell the
    // way a bitmap glyph is, so where exactly it sits is settled at
    // the canvas, by measuring this string in this face; what is
    // settled here is the room it has, which is row 192 (the first
    // under the 192-row room) to the bottom of the screen.
    expect(item.baseline).toBe(STRIP.top + 7);
    expect(item.top).toBe(STRIP.top - 1);
    expect(item.bottom).toBe(STRIP.top + 7);
    // Asking again replaces the line rather than piling up beside it.
    text.bottomText(surface, 'GAME PAUSED', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(text.overlay).toHaveLength(1);
    text.bottomText(surface, null, STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(text.overlay).toHaveLength(0);
  });

  it('rubs out the row a Hebrew line used above the rectangle', () => {
    /**
     * The caller blacks `rect_bottom_text`, rows 193 to 201, because
     * that is the rectangle the C blacks -- and a Hebrew line is
     * drawn one row higher than that, so its top row is outside what
     * the caller rubs out. Measured on the page before this: the
     * tops of `שלב 1` were left standing in white over the floor of
     * the room after the strip went empty, and again after the
     * quality moved to `high`, which blits nothing at all.
     */
    const row = (surface: Surface): number[] => {
      const out: number[] = [];
      for (let x = STRIP.left; x < STRIP.right; x++) {
        out.push(surface.pixels[(STRIP.top - 1) * surface.width + x]!);
      }
      return out;
    };
    const black = (surface: Surface): boolean => row(surface).every((v) => v === 0);

    const he = new GameText(font, { language: 'he', quality: 'original' });
    const surface = new Surface();
    // What the engine does before every line: black the C's rectangle,
    // which does not reach row 192.
    const clear = (): void => surface.fillRect(
      STRIP.left, STRIP.top, STRIP.right - STRIP.left, 9, 0,
    );

    clear();
    he.bottomText(surface, 'LEVEL 1', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(black(surface), 'the Hebrew line really uses row 192').toBe(false);

    // The strip goes empty, which is what `show_level` does after
    // twenty-four ticks.
    clear();
    he.bottomText(surface, null, STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(black(surface), 'and the row is rubbed out with it').toBe(true);

    // And again for the quality moving, which blits nothing.
    clear();
    he.bottomText(surface, 'LEVEL 1', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(black(surface)).toBe(false);
    he.quality = 'high';
    clear();
    he.bottomText(surface, 'LEVEL 1', STRIP.left, STRIP.top, STRIP.right - 1, 15);
    expect(black(surface), 'nothing is left over the room at `high`').toBe(true);
  });

  it('has a story screen for Hebrew and none for English at the original quality', () => {
    const he = new GameText(font, { language: 'he', quality: 'original' });
    const en = new GameText(font, { language: 'en', quality: 'original' });
    const enHigh = new GameText(font, { language: 'en', quality: 'high' });
    for (const id of [7, 8, 9, 10]) {
      expect(he.story(id), `he ${id}`).not.toBeNull();
      // English at the original quality is the original's own picture.
      expect(en.story(id), `en ${id}`).toBeNull();
      expect(enHigh.story(id), `en high ${id}`).not.toBeNull();
    }
    // `STORY_FRAME` and the title images are pictures in every language.
    for (const id of [0, 1, 2, 3, 4, 5, 6]) expect(he.story(id), `${id}`).toBeNull();
  });

  it('fits every story line inside the frame', () => {
    const width = GameText.STORY.right - GameText.STORY.left;
    for (const language of ['he', 'en'] as const) {
      const text = new GameText(font, { language, quality: 'high' });
      for (const id of [7, 8, 9, 10]) {
        for (const line of text.story(id)!.lines) {
          // A credits line is two columns and is measured as one.
          const words = line.split('|').join(' ');
          expect(text.storyLineWidth(words), `${language} ${id}: ${line}`)
            .toBeLessThanOrEqual(width);
        }
      }
    }
  });

  it('types a Hebrew name into the box from the right', () => {
    const text = new GameText(font, { language: 'he', quality: 'original' });
    const surface = new Surface();
    const box = { left: 86, top: 69, right: 226, bottom: 79 };
    // What `input_str` does: start the input, paint the box, then one
    // `draw_text_character` per keystroke with the cursor blinking.
    text.beginTextInput(box.left, box.top, box.right, box.bottom);
    text.noteFill(box.left, box.top, box.right, box.bottom, 0xB7);
    let x = box.left + 4;
    for (const ch of 'דן') {
      text.drawChar(surface, x, 76, '_', 0xB7); // the cursor, erased
      x += text.drawChar(surface, x, 76, ch, 0xBE);
      text.drawChar(surface, x, 76, '_', 0xBE); // and put back after it
    }
    // The letters are drawn as one line against the right-hand end of
    // the box, with the cursor on its left, which is where a Hebrew
    // reader's next letter goes.
    const ink: number[] = [];
    for (let px = 0; px < 320; px++) {
      for (let py = box.top; py < box.bottom; py++) {
        if (surface.pixels[py * 320 + px] === 0xBE) { ink.push(px); break; }
      }
    }
    expect(ink.length).toBeGreaterThan(0);
    const rightmost = ink[ink.length - 1]!;
    expect(rightmost, 'the name reaches the right of the box')
      .toBeGreaterThan(box.right - 30);
    expect(rightmost).toBeLessThan(box.right);
  });
});

describe('the measurements the strip rests on', () => {
  it('still centres the English lines where the capture has them', () => {
    // `tests/render/font.test.ts`'s own two, which come off a capture
    // of PRINCE.EXE: the text layer must not have moved them.
    expect(textWidth(font, 'LEVEL 1')).toBe(41);
    expect(textWidth(font, 'Press Button to Continue')).toBe(150);
  });
});

/**
 * Fitting a vector line into the rows the original gave it.
 *
 * The numbers here are **measured**, off Chromium's own
 * `actualBoundingBox` for the two Hebrew lines at the size a
 * seven-pixel capital asks for, with the baseline on row 200 and the
 * band rows 192 to 200 -- which is every row the strip under the room
 * has. They are in a unit test because a browser cannot tell a tail
 * that fits from a tail the canvas has cut off at its own edge: both
 * read as ink stopping at row 199.
 */
describe('fitting a crisp line into the strip', () => {
  const TOP = 192;
  const BOTTOM = 200;
  const SIZE = 10;

  it('moves the baseline when moving is enough', () => {
    // `שלב 3`: the lamed climbs 8.26 rows above the baseline and
    // nothing hangs below, so the ink is 7.96 rows and fits -- but at
    // baseline 200 its top is row 191.74, a quarter of a row over the
    // floor of the room. Measured on the page before this.
    const fitted = fitLine(200, SIZE, TOP, BOTTOM, () => ({ ascent: 8.26, descent: -0.3 }));
    expect(fitted.size, 'nothing is made smaller').toBe(SIZE);
    expect(fitted.baseline).toBeCloseTo(200.26, 2);
    expect(fitted.baseline - 8.26, 'and the top is exactly on row 192').toBeCloseTo(TOP, 6);
  });

  it('makes the line smaller when the ink is taller than the band', () => {
    // `נותרו 60 דקות`: 6.8 above and a qof's tail 2.0 below is 8.8
    // rows in 8, and the tail was going off the bottom of the screen.
    const seen: number[] = [];
    const fitted = fitLine(200, SIZE, TOP, BOTTOM, (at) => {
      seen.push(at);
      const k = at / SIZE;
      return { ascent: 6.8 * k, descent: 2.0 * k };
    });
    expect(fitted.size).toBeCloseTo(SIZE * (8 / 8.8), 6);
    expect(seen, 'the face is measured again after it is resized').toHaveLength(2);
    // The tail now ends on the last row of the screen, not past it.
    expect(fitted.baseline + 2.0 * (fitted.size / SIZE)).toBeCloseTo(BOTTOM, 6);
    expect(fitted.baseline - 6.8 * (fitted.size / SIZE)).toBeCloseTo(TOP, 6);
  });

  it('leaves a line that already fits exactly where it was', () => {
    // Every line of English: `LEVEL 1` and `60 MINUTES LEFT` have no
    // ascender past the capital and no descender at all.
    const fitted = fitLine(200, SIZE, TOP, BOTTOM, () => ({ ascent: 7, descent: 0 }));
    expect(fitted).toEqual({ size: SIZE, baseline: 200 });
  });

  it('says nothing when the canvas cannot measure', () => {
    const fitted = fitLine(200, SIZE, TOP, BOTTOM, () => ({ ascent: NaN, descent: NaN }));
    expect(fitted).toEqual({ size: SIZE, baseline: 200 });
    expect(fitLine(200, SIZE, 200, 200, () => ({ ascent: 99, descent: 99 })))
      .toEqual({ size: SIZE, baseline: 200 });
  });
});
