/**
 * Every word the **game itself** draws, in the player's language, and
 * at the quality he chose.
 *
 * `web/strings.ts` is the page around the game -- the opening page, the
 * two margins, the buttons. This is the other half: the strip under the
 * room, the story screens and the hall of fame, which the original
 * paints into the 320x200 screen with the bitmap font it carries in
 * `PRINCE.EXE`.
 *
 * **Nothing in `src/pop` reads a setting, and that is the whole shape of
 * this file.** The engine goes on asking for `60 MINUTES LEFT` and goes
 * on calling `show_text`; `PopGame` and `CutscenePlayer` take an
 * optional `GameText` and, when they are given none, draw exactly what
 * they drew before -- which is what every headless tool does, so the
 * digests are the original's by construction and not by promise.
 *
 * Two paths out of here, and which one runs is the `quality` setting:
 *
 * * **original** -- the words are blitted into the 320x200 surface, out
 *   of the release's own font for ASCII and out of `hebrew.ts` for the
 *   Hebrew letters the release has none of. A screenshot, a recording
 *   and `__princeFrame` all carry them, because they really are in the
 *   picture.
 * * **high** -- nothing is blitted at all. The line is put on the
 *   `overlay` list with the box it was asked to sit in, and
 *   `Display.presentText` draws it on a second canvas at the size the
 *   canvas is really shown at, with a vector font. The 320x200 surface
 *   keeps its background -- the black strip, the story frame -- so the
 *   crisp text has nothing underneath it to show through.
 */
import type { Font, Glyph } from './font.ts';
import { charWidth as asciiCharWidth } from './font.ts';
import type { Surface } from './surface.ts';
import { HEBREW_GLYPHS, isRtl } from './hebrew.ts';

export type TextLanguage = 'en' | 'he';
export type TextQuality = 'original' | 'high';

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * The five strings the game draws while it is being played, and the
 * one it draws over a dead Prince.
 *
 * There are no others: `display_text_bottom` (`seg008:2644`) is the one
 * way text reaches the strip under the room, and its callers are
 * `show_level`, `show_time`, `do_paused` and `play_kid_frame`.
 * `LEVEL 13` is not among them because `show_level` prints 12 for it,
 * which is the original's own joke and is left alone.
 */
const HE_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/^GAME PAUSED$/, 'המשחק מושהה'],
  [/^LEVEL (\d+)$/, 'שלב $1'],
  [/^(\d+) MINUTES LEFT$/, 'נותרו $1 דקות'],
  [/^(\d+) SECONDS LEFT$/, 'נותרו $1 שניות'],
  [/^1 SECOND LEFT$/, 'נותרה שנייה אחת'],
  [/^TIME HAS EXPIRED!$/, 'תם הזמן!'],
  [/^Press Button to Continue$/, 'הקש מקש כדי להמשיך'],
];

/**
 * One of the two title cards that are words rather than artwork.
 *
 * `TITLE_PRESENTS` and `TITLE_GAME` are opaque patches of `TITLE.DAT`
 * blitted over the title picture, and what is in them is
 * `Broderbund Software / presents` and `a game by / Jordan Mechner`.
 * They are pictures of words, so in Hebrew they are English words on
 * the screen of a game the player asked to be in Hebrew -- which is
 * the whole of what clause 1א says must not happen.
 *
 * `keepRows` is how many rows of the patch are **art** and are still
 * blitted: the Broderbund crown is the top twenty rows of its patch,
 * and the words begin under it. The rest of the patch is not drawn at
 * all, so what shows through is the title picture the caller drew
 * immediately before -- `show_title` is
 * `draw_full_image(TITLE_MAIN); draw_full_image(TITLE_PRESENTS);`
 * and the same for `TITLE_GAME`, so the background is already there
 * and nothing has to be put back.
 */
export interface TitleCard {
  /** Rows of the patch that are artwork and are blitted as before. */
  readonly keepRows: number;
  /** Each line: the row of the patch its glyphs start on, and the words. */
  readonly lines: readonly (readonly [number, string])[];
}

/** The words of one story screen, broken into lines by hand. */
export interface StoryScreen {
  readonly lines: readonly string[];
  /** The credits are a list of pairs and are laid out differently. */
  readonly credits?: boolean;
}

/**
 * The four story screens, read out of the pictures they are drawn as.
 *
 * `seg001`'s `STORY_ABSENCE`, `STORY_MARRY`, `STORY_HAIL` and
 * `STORY_CREDITS` are **not** text: they are four one-bit images in
 * `TITLE.DAT`, blitted whole with `blitters_white`. So a Hebrew story
 * cannot be a translation of anything the game says -- there is nothing
 * to translate -- and the English below is a transcription of the
 * pictures, taken off them pixel by pixel, so that the same screens can
 * be drawn as words when the player asks for words.
 */
const STORY_EN: Readonly<Record<number, StoryScreen>> = {
  7: {
    lines: [
      'In the Sultan’s absence the',
      'Grand Vizier JAFFAR rules with',
      'the iron fist of tyranny. Only',
      'one obstacle remains between',
      'Jaffar and the throne: the',
      'Sultan’s beautiful young',
      'daughter...',
    ],
  },
  8: {
    lines: [
      'Marry Jaffar... or die within',
      'the hour. All the Princess’s',
      'hopes now rest on the brave',
      'youth she loves. Little does',
      'she know that he is already a',
      'prisoner in Jaffar’s',
      'dungeons....',
    ],
  },
  9: {
    lines: [
      'The tyrant Jaffar lies dead,',
      'his power shattered. Throughout',
      'the land the people of Persia',
      'hail their Princess... and the',
      'brave youth who saved her from',
      'the forces of darkness. No',
      'longer a stranger, he shall',
      'from this day forth be known',
      'as... PRINCE OF PERSIA.',
    ],
  },
  10: {
    credits: true,
    lines: [
      'Programmed by|Lance Groody',
      'Graphics by|Leila Bronstein',
      '|Avril Harrison',
      '|James St. Louis',
      'Sound design by|Tom Rettig',
      'Music composed by|Francis Mechner',
      'Produced by|Brian Eheler',
      'Directed by|Jordan Mechner',
    ],
  },
};

const STORY_HE: Readonly<Record<number, StoryScreen>> = {
  7: {
    lines: [
      'בהיעדרו של הסולטאן שולט',
      'הוזיר הגדול ג׳אפר ביד ברזל.',
      'מכשול אחד בלבד נותר בין',
      'ג׳אפר ובין כס המלוכה: בתו',
      'היפה והצעירה של הסולטאן...',
    ],
  },
  8: {
    lines: [
      'הינשאי לג׳אפר... או מותי',
      'בתוך שעה. כל תקוותיה של',
      'הנסיכה נתונות עתה בנער',
      'האמיץ שהיא אוהבת. היא אינה',
      'יודעת כי הוא כבר אסיר',
      'בצינוקיו של ג׳אפר...',
    ],
  },
  9: {
    lines: [
      'העריץ ג׳אפר מוטל מת, וכוחו',
      'נופץ. בכל רחבי הארץ מריעים',
      'בני פרס לנסיכתם... ולנער',
      'האמיץ שהצילה מידי כוחות',
      'האופל. לא עוד זר, מהיום הזה',
      'ואילך ייקרא... נסיך פרס.',
    ],
  },
  10: {
    credits: true,
    lines: [
      'תכנות|לאנס גרודי',
      'גרפיקה|ליילה ברונשטיין',
      '|אבריל הריסון',
      '|ג׳יימס סנט לואיס',
      'עיצוב קול|טום רטיג',
      'מוזיקה|פרנסיס מכנר',
      'הפקה|בריאן איילר',
      'בימוי|ג׳ורדן מכנר',
    ],
  },
};

// ---------------------------------------------------------------------------
// Right to left
// ---------------------------------------------------------------------------

/**
 * A line in the order the glyphs are drawn in, left to right.
 *
 * The bitmap path draws one glyph after another along a row, so it has
 * to be handed the **visual** order; the vector path does not, because
 * a canvas with `direction = 'rtl'` runs the real bidi algorithm over
 * the logical string.
 *
 * This is bidi for the one case the game has: a right-to-left line with
 * numbers in it. A run of digits and Latin keeps its own order and the
 * runs are laid out from the right, which puts `60` the right way round
 * inside `נותרו 60 דקות`. Everything else -- the spaces, the full stop
 * at the end, the `!` -- is carried with the Hebrew, which is what
 * leaves `תם הזמן!` with its mark at the left-hand end where a Hebrew
 * reader expects it.
 */
export function toVisual(text: string): string {
  const runs: { ltr: boolean; text: string }[] = [];
  for (const ch of text) {
    const ltr = /[0-9A-Za-z]/.test(ch);
    const last = runs[runs.length - 1];
    if (last && last.ltr === ltr) last.text += ch;
    else runs.push({ ltr, text: ch });
  }
  // A neutral between two numbers -- the `:` of a hall of fame time --
  // belongs to the number, not to the Hebrew around it.
  for (let i = 1; i < runs.length - 1; i++) {
    const run = runs[i]!;
    if (!run.ltr && /^[.:,’'-]+$/.test(run.text)
      && runs[i - 1]!.ltr && runs[i + 1]!.ltr) {
      runs[i - 1]!.text += run.text + runs[i + 1]!.text;
      runs.splice(i, 2);
      i--;
    }
  }
  let out = '';
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    out += run.ltr ? run.text : [...run.text].reverse().join('');
  }
  return out;
}

/** Does this line want laying out from the right? */
export function hasRtl(text: string): boolean {
  for (const ch of text) if (isRtl(ch)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// The overlay, which is what `quality: high` draws
// ---------------------------------------------------------------------------

/** One line of text, in game pixels, waiting for the canvas pass. */
export interface OverlayItem {
  readonly key: string;
  /** The box the line is aligned inside. */
  readonly left: number;
  readonly right: number;
  /** The row a capital letter stands on. */
  readonly baseline: number;
  /** `-1` left, `0` centre, `1` right -- `draw_text`'s own convention. */
  readonly xAlign: number;
  /** The words, in logical order: the canvas runs bidi itself. */
  readonly text: string;
  readonly rtl: boolean;
  /** The palette entry the original would have drawn it in. */
  readonly color: number;
  /** How tall a capital is, in game pixels. */
  readonly capHeight: number;
  /**
   * The rows the ink must stay inside, where there is a limit.
   *
   * A bitmap glyph is exactly as tall as its cell, so the original
   * never had to think about this. A vector face is not, and
   * `fitLine` below is what is done about it. A line with no band
   * is drawn at the size and on the baseline it asks for.
   */
  readonly top?: number;
  readonly bottom?: number;
}

/** The strip under the room, and the rows of the hall of fame. */
export const TEXT_CAP_HEIGHT = 7;

/** What a canvas says about the ink of one line at one size. */
export interface LineInk {
  /** How far the ink reaches above the baseline. */
  readonly ascent: number;
  /** How far below. */
  readonly descent: number;
}

/**
 * Fit a vector line into the rows the original gave it.
 *
 * A bitmap glyph is exactly as tall as its cell, so the original
 * never had to think about this: `rect_bottom_text` is eight rows and
 * its seven strings have no ascender past the capital and no
 * descender at all. A vector face has both, and in Hebrew it has them
 * in the same line -- `נותרו 60 דקות` ends in a qof whose tail, left
 * where it fell, went **off the bottom of the screen**, and `שלב 3`
 * put the top of its lamed a quarter of a row over the floor of the
 * room.
 *
 * So: move the baseline if moving is enough, and only make the line
 * smaller when the ink is taller than the band however it is placed.
 * `measure` is the canvas, which is the only thing that knows what
 * this string is in this face; it is called again after a resize
 * because the ink of a face is not quite proportional to its size.
 *
 * This is here rather than in `display.ts` because it is arithmetic
 * and can be tested as arithmetic: a browser test cannot tell a tail
 * that fits from a tail the canvas has cut off at its own edge.
 */
export function fitLine(
  baseline: number, size: number, top: number, bottom: number,
  measure: (size: number) => LineInk,
): { size: number; baseline: number } {
  const band = bottom - top;
  if (!(band > 0)) return { size, baseline };
  const { ascent, descent } = measure(size);
  if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return { size, baseline };
  const ink = ascent + descent;
  if (ink > band) {
    const smaller = size * (band / ink);
    const fitted = measure(smaller);
    const drop = Number.isFinite(fitted.descent) ? fitted.descent : 0;
    return { size: smaller, baseline: bottom - drop };
  }
  if (baseline + descent > bottom) return { size, baseline: bottom - descent };
  if (baseline - ascent < top) return { size, baseline: top + ascent };
  return { size, baseline };
}

/**
 * Where the words sit inside each card, measured off the pictures.
 *
 * Image 1 is 128 by 47: rows 0 to 19 are the crown, 20 to 28 are
 * `Broderbund Software` and 35 to 45 are `presents`. Image 2 is 122
 * by 30 and is nothing but words: 4 to 15 are `a game by` and 18 to
 * 28 are `Jordan Mechner`. The Hebrew lines are put on the same rows,
 * which is why the card still reads as the same card.
 */
const TITLE_CARDS: Readonly<Record<number, TitleCard>> = {
  // full_image_id.TITLE_PRESENTS
  1: {
    keepRows: 20,
    lines: [[21, 'ברודרבונד סופטוור'], [36, 'מציגה']],
  },
  // full_image_id.TITLE_GAME
  2: {
    keepRows: 0,
    lines: [[5, 'משחק מאת'], [19, 'ג׳ורדן מכנר']],
  },
};

/** The gap between the two columns of the credits. */
const GUTTER = 8;

// ---------------------------------------------------------------------------

export interface GameTextOptions {
  language?: TextLanguage;
  quality?: TextQuality;
}

export class GameText {
  private readonly font: Font;
  private lang: TextLanguage;
  private qual: TextQuality;
  /**
   * The lines the **screen** is showing, keyed so that a line drawn
   * again in the same place replaces it.
   */
  private readonly lines = new Map<string, OverlayItem>();
  /**
   * The lines drawn into the **offscreen** surface, which the screen
   * is not showing yet.
   *
   * A cutscene composes a picture offscreen and copies it over, and
   * the two are a block apart: `show_title` draws `TITLE_PRESENTS`,
   * waits, copies the rectangle to the screen, and only then paints
   * the offscreen back to the plain picture. So a word drawn into the
   * offscreen is on the screen from the **copy** until the next copy
   * over the same rectangle -- not from the moment it was drawn.
   *
   * At `quality: original` that is free, because the words are
   * pixels of the surface and the copy carries them. At `high` the
   * words are not in the surface at all, so the overlay has to keep
   * the same two sets and `commitOverlay` is the copy. Measured on
   * the page before this: both Hebrew title cards and every story
   * screen of the opening showed their words for two seconds and
   * then lost them for three, while the picture under them stayed.
   */
  private readonly pendingLines = new Map<string, OverlayItem>();
  /** `scr.target(true)`: which of the two the next line goes into. */
  private offscreen = false;
  /**
   * The hall of fame's name box, while it is taking a name.
   *
   * `input_str` draws a name one glyph at a time at an advancing x,
   * which is left to right and cannot be anything else: it is a loop
   * over `draw_text_character`, and the C has no notion of a line
   * that grows the other way. So for Hebrew the glyphs are not drawn
   * one at a time at all. What is typed is **read off the calls** --
   * the C's own protocol says which is which, and there are only
   * three kinds -- and the whole box is drawn again from the right
   * every time it changes, which is what typing Hebrew looks like.
   *
   * The box is `start_text_input`'s rectangle and the colour is the
   * one `input_str` filled it with on the line after.
   */
  private box: {
    left: number; top: number; right: number; bottom: number; bg: number;
  } | null = null;
  /** What has been typed into it, in logical order. */
  private typed = '';
  /** Whether `draw_text_cursor` last drew the cursor or erased it. */
  private cursorUp = false;
  /** Whether the last strip drawn put ink in the row above its rectangle. */
  private liftedRow = false;
  /** `arg_4`: how far inside the box `input_str` starts. */
  private static readonly BOX_INSET = 4;

  constructor(font: Font, options: GameTextOptions = {}) {
    this.font = font;
    this.lang = options.language ?? 'en';
    this.qual = options.quality ?? 'original';
  }

  get language(): TextLanguage { return this.lang; }
  set language(value: TextLanguage) { this.lang = value; }
  get quality(): TextQuality { return this.qual; }
  set quality(value: TextQuality) { this.qual = value; }
  /** `quality: high` keeps the surface clear and draws on the canvas. */
  get vector(): boolean { return this.qual === 'high'; }

  /** Everything the canvas pass has to draw, oldest first. */
  get overlay(): readonly OverlayItem[] { return [...this.lines.values()]; }

  /**
   * `scr.target(offscreen)`, for the duration of one call.
   *
   * The caller sets it and puts it back, so a game that has one
   * surface and never sets it writes to the screen's own list, which
   * is what it did before there were two.
   */
  get drawingOffscreen(): boolean { return this.offscreen; }
  set drawingOffscreen(on: boolean) { this.offscreen = on; }

  // --------------------------------------------------------------- words

  /** The words the game asked for, in the player's language. */
  translate(text: string): string {
    if (this.lang !== 'he') return text;
    for (const [pattern, into] of HE_PATTERNS) {
      if (pattern.test(text)) return text.replace(pattern, into);
    }
    return text;
  }

  /** The story screen behind a `full_image_id`, or null for the picture. */
  story(id: number): StoryScreen | null {
    const table = this.lang === 'he' ? STORY_HE : STORY_EN;
    const screen = table[id];
    if (!screen) return null;
    // English at the original quality is the original's own picture:
    // the four story screens are artwork, not font text, and there is
    // nothing about them a bitmap redraw could improve.
    if (this.lang === 'en' && !this.vector) return null;
    return screen;
  }

  // ------------------------------------------------------------- measuring

  private glyph(ch: string): Glyph | null {
    const hebrew = HEBREW_GLYPHS.get(ch);
    if (hebrew) return hebrew;
    const code = ch.charCodeAt(0);
    if (code < this.font.firstChar || code > this.font.lastChar) return null;
    return this.font.glyphs[code - this.font.firstChar] ?? null;
  }

  /** `get_char_width`: the glyph and the gap after it. */
  charWidth(ch: string): number {
    const hebrew = HEBREW_GLYPHS.get(ch);
    if (hebrew) return hebrew.width + this.font.charSpacing;
    return asciiCharWidth(this.font, ch.charCodeAt(0));
  }

  /** `get_cstring_width`. */
  cstringWidth(text: string): number {
    let width = 0;
    for (const ch of text) width += this.charWidth(ch);
    return width;
  }

  /** The shell's own measure: no gap after the last character. */
  private shellWidth(text: string): number {
    let width = 0;
    let drawn = 0;
    for (const ch of text) {
      const g = this.glyph(ch);
      if (!g) continue;
      width += g.width;
      drawn += 1;
    }
    return width + Math.max(0, drawn - 1) * this.font.charSpacing;
  }

  // -------------------------------------------------------------- drawing

  private blitLine(
    surface: Surface, text: string, x: number, top: number, color: number,
  ): void {
    let at = x;
    for (const ch of text) {
      const g = this.glyph(ch);
      if (!g) continue;
      surface.blitMono(g.sprite, at, top, color);
      at += g.width + this.font.charSpacing;
    }
  }

  private remember(item: OverlayItem): void {
    const into = this.offscreen ? this.pendingLines : this.lines;
    into.delete(item.key);
    into.set(item.key, item);
  }

  /** Both lists, for a screen that has just been painted over. */
  clearOverlay(): void {
    this.lines.clear();
    this.pendingLines.clear();
  }

  /** The screen's own list, for `pal_restore_free_fadeout`'s black. */
  clearShownOverlay(): void { this.lines.clear(); }

  /** Does this line have ink inside the box? */
  private static touches(
    item: OverlayItem, left: number, top: number, right: number, bottom: number,
  ): boolean {
    const itemTop = item.baseline - item.capHeight;
    return item.right > left && item.left < right
      && item.baseline + 2 > top && itemTop < bottom;
  }

  /** Everything whose line sits inside this box, on the surface in hand. */
  clearOverlayIn(left: number, top: number, right: number, bottom: number): void {
    const from = this.offscreen ? this.pendingLines : this.lines;
    for (const [key, item] of [...from]) {
      if (GameText.touches(item, left, top, right, bottom)) from.delete(key);
    }
  }

  /**
   * `read_peel_from_screen`: the words inside the rectangle, kept.
   *
   * A peel is a rectangle of the screen put aside and painted back
   * later, and the hall of fame uses one to take its name box away
   * again. At `quality: original` the words in that rectangle are
   * pixels and the peel carries them; at `high` they are not, so the
   * peel has to carry them itself or the time beside the name is
   * painted out and never comes back.
   */
  readPeelOverlay(
    left: number, top: number, right: number, bottom: number,
  ): readonly OverlayItem[] {
    const from = this.offscreen ? this.pendingLines : this.lines;
    const out: OverlayItem[] = [];
    for (const item of from.values()) {
      if (GameText.touches(item, left, top, right, bottom)) out.push(item);
    }
    return out;
  }

  /** `restore_peel`: the rectangle's words as they were when it was read. */
  restorePeelOverlay(
    left: number, top: number, right: number, bottom: number,
    words: readonly OverlayItem[],
  ): void {
    this.clearOverlayIn(left, top, right, bottom);
    const into = this.offscreen ? this.pendingLines : this.lines;
    for (const item of words) into.set(item.key, item);
  }

  /**
   * `method_1_blit_rect(onscreen_surface_, offscreen_surface, rect)`:
   * the offscreen's words reach the screen.
   *
   * Whatever the screen was showing in that rectangle is painted over
   * by the copy, and whatever the offscreen holds there is now shown.
   * The offscreen keeps its own words, exactly as it keeps its own
   * pixels.
   */
  commitOverlay(left: number, top: number, right: number, bottom: number): void {
    for (const [key, item] of [...this.lines]) {
      if (GameText.touches(item, left, top, right, bottom)) this.lines.delete(key);
    }
    for (const [key, item] of this.pendingLines) {
      if (GameText.touches(item, left, top, right, bottom)) this.lines.set(key, item);
    }
  }

  /**
   * The strip under the room: `show_text(&rect_bottom_text,
   * halign_center, valign_bottom, ...)` with the rectangle blacked
   * first, which the caller has already done.
   */
  bottomText(
    surface: Surface, text: string | null,
    left: number, top: number, right: number, color: number,
  ): void {
    this.lines.delete('bottom');
    /**
     * Rub out the row above the rectangle, if the last line used it.
     *
     * The caller blacks `rect_bottom_text`, which is rows 193 to 201,
     * because that is the rectangle the C blacks. A Hebrew line is
     * drawn one row higher than that, so its top row is **outside**
     * what the caller rubs out -- and it stayed on the screen when
     * the strip went empty, when the line changed to a short one, and
     * when the quality moved to `high`, which draws nothing into the
     * surface at all. Measured on the page: the tops of `שלב 1` were
     * left standing in white over the floor of the room.
     *
     * Row 192 is the first row under the 192-row gameplay buffer and
     * the hit points are to the left of `left`, so there is nothing
     * else in it to rub out.
     */
    if (this.liftedRow) {
      surface.fillRect(left, top - 1, right - left + 1, 1, 0);
      this.liftedRow = false;
    }
    if (text === null) return;
    const words = this.translate(text);
    const rtl = hasRtl(words);
    /**
     * A Hebrew line under the room is drawn one row higher.
     *
     * `rect_bottom_text` is `{193, 70, 202, 250}` on a screen two
     * hundred rows tall, so `show_text` puts the baseline on row 200
     * and **anything below the line is off the screen**. The original
     * never notices: the seven strings it draws have no descender in
     * them, not one `g`, `y` or `p`. Hebrew is not so lucky --
     * `דקות` ends in a qof and `להמשיך` in a final kaf, and both hang
     * below the line. Measured on the page before this: `נותרו 60
     * דקות` came out reading `נותרד 60 דהות`, with the two tails
     * clipped away and the letters turned into different letters.
     *
     * Row 192 is the first row under the room -- the gameplay buffer
     * is 192 rows, 0 to 191 -- so moving up one is free, and it buys
     * the first of the two tail rows. It is done only for a line that
     * needs it, so the English strip is drawn exactly where the
     * capture has it.
     */
    const lift = rtl ? 1 : 0;
    if (this.vector) {
      // The band is row 192 -- the first row under the 192-row room
      // -- to the bottom of the screen, which is every row the strip
      // can have. The baseline is the original's own; the fit only
      // moves it when the ink would leave the band.
      this.remember({
        key: 'bottom', left, right, baseline: top + TEXT_CAP_HEIGHT,
        xAlign: 0, text: words, rtl, color, capHeight: TEXT_CAP_HEIGHT,
        top: top - 1, bottom: top + TEXT_CAP_HEIGHT,
      });
      return;
    }
    const visual = rtl ? toVisual(words) : words;
    const width = this.shellWidth(visual);
    if (lift) {
      surface.fillRect(left, top - lift, right - left + 1, lift, 0);
      this.liftedRow = true;
    }
    this.blitLine(
      surface, visual, left + ((right - left + 1 - width) >> 1), top - lift, color,
    );
  }

  /**
   * `draw_text` for one line, which is how the hall of fame draws a
   * name and a time. `xAlign`/`yAlign` are the C's.
   */
  showText(
    surface: Surface, text: string,
    left: number, top: number, right: number, bottom: number,
    xAlign: number, yAlign: number, color: number,
  ): void {
    const words = this.translate(text);
    const rtl = hasRtl(words);
    const baseline = this.baselineIn(top, bottom, yAlign);
    /**
     * In Hebrew the two columns of a hall of fame row change sides.
     *
     * `show_hof` (`seg001:0E94`) draws the name against the left of
     * the row and the time against the right, which is the order a
     * left-to-right reader reads them in: who, then how long. A
     * Hebrew reader starts at the other end, so the name belongs on
     * the right and the time on the left -- and a Hebrew name left
     * where the C puts it reads as the last column of the row rather
     * than the first.
     *
     * The mirror is here and not in `seg001`, which may not learn
     * that a player has preferences, and it is the whole of what it
     * touches: `scr.show_text` has exactly one caller in the game and
     * it is `show_hof_text`. Nothing moves in English, where
     * `this.lang` is `en` and `xAlign` is the C's own.
     */
    if (this.lang === 'he') xAlign = -xAlign;
    const key = `t:${left},${top},${right},${bottom},${xAlign},${color}`;
    if (this.vector) {
      this.remember({
        key, left, right, baseline, xAlign,
        text: words, rtl, color, capHeight: TEXT_CAP_HEIGHT,
        top, bottom,
      });
      return;
    }
    const visual = rtl ? toVisual(words) : words;
    const width = this.cstringWidth(visual);
    let at = left;
    if (xAlign === 0) at += ((right - left) / 2 | 0) - (width / 2 | 0);
    else if (xAlign > 0) at += (right - left) - width;
    const savedLeft = surface.clipLeft;
    const savedRight = surface.clipRight;
    const savedTop = surface.clipTop;
    const savedBottom = surface.clipBottom;
    surface.clipLeft = Math.max(savedLeft, left);
    surface.clipRight = Math.min(savedRight, right);
    surface.clipTop = Math.max(savedTop, top);
    surface.clipBottom = Math.min(savedBottom, bottom);
    this.blitLine(surface, visual, at, baseline - this.font.heightAbove, color);
    surface.clipLeft = savedLeft;
    surface.clipRight = savedRight;
    surface.clipTop = savedTop;
    surface.clipBottom = savedBottom;
  }

  /**
   * Where `draw_text`'s own baseline falls, which is **not**
   * `get_text_center_y`.
   *
   * `seg009:3F01` works the top of the line out with
   * `((rect_height + 1) / 2) - ((text_height + 1) / 2)`, two
   * truncating divisions that simulate SHR and ADC, and
   * `get_text_center_y` works a different one out with a remainder
   * added back. For an odd-height rectangle the two agree; for an
   * even one they are a row apart. This is `draw_text`'s, because
   * `draw_text` is what the hall of fame calls -- and it has to be
   * exactly that, or the page and the headless port draw different
   * pictures with the language at its default and
   * `tools/dev/page-port.ts` says so.
   */
  private baselineIn(top: number, bottom: number, yAlign: number): number {
    const rectHeight = bottom - top;
    const textHeight = this.font.heightAbove + this.font.heightBelow;
    let textTop = top;
    if (yAlign >= 0) {
      if (yAlign <= 0) {
        textTop += ((rectHeight + 1) / 2 | 0) - ((textHeight + 1) / 2 | 0);
      } else {
        textTop += rectHeight - textHeight;
      }
    }
    return textTop + this.font.heightAbove;
  }

  /**
   * `SDL_StartTextInput()`, with the rectangle it is given.
   *
   * Nothing but the hall of fame's name box calls it, so this is the
   * one place a right-to-left line is typed rather than drawn whole.
   */
  beginTextInput(left: number, top: number, right: number, bottom: number): void {
    this.box = { left, top, right, bottom, bg: 0 };
    this.typed = '';
    this.cursorUp = false;
  }

  /** `SDL_StopTextInput()`. */
  endTextInput(): void {
    this.box = null;
    this.typed = '';
  }

  /** `draw_rect`: which colour the box was painted, and what it wipes. */
  noteFill(left: number, top: number, right: number, bottom: number, color: number): void {
    const box = this.box;
    if (box && box.left === left && box.top === top
      && box.right === right && box.bottom === bottom) {
      box.bg = color;
      this.typed = '';
      this.cursorUp = false;
    }
    this.clearOverlayIn(left, top, right, bottom);
  }

  /** Is a Hebrew name being typed into the box at this baseline? */
  private typingRtl(y: number): boolean {
    const box = this.box;
    return this.lang === 'he' && box !== null && y > box.top && y <= box.bottom + 2;
  }

  /**
   * One call of `draw_text_character` inside the name box, read as
   * what it means rather than as a glyph at an x.
   *
   * `input_str` has exactly three kinds of call and the colour says
   * which: the cursor is always `_`, and anything else drawn in the
   * background colour is the erase half of a backspace.
   */
  private typeInto(surface: Surface, ch: string, color: number): void {
    const box = this.box!;
    if (ch === '_') this.cursorUp = color !== box.bg;
    else if (color === box.bg) this.typed = this.typed.slice(0, -1);
    else this.typed += ch;
    const line = (this.cursorUp ? '_' : '') + toVisual(this.typed);
    const right = box.right - GameText.BOX_INSET;
    const baseline = this.baselineIn(box.top, box.bottom, 0);
    if (this.vector) {
      this.remember({
        key: 'name', left: box.left + GameText.BOX_INSET, right,
        baseline, xAlign: 1, text: this.typed + (this.cursorUp ? '_' : ''),
        rtl: true, color, capHeight: TEXT_CAP_HEIGHT,
      });
      return;
    }
    surface.fillRect(box.left, box.top,
      box.right - box.left, box.bottom - box.top, box.bg);
    this.blitLine(surface, line, right - this.shellWidth(line),
      baseline - this.font.heightAbove, color === box.bg ? this.textColour : color);
  }

  /** The colour the name is drawn in, kept from the last glyph that was. */
  private textColour = 15;

  /**
   * `draw_text_character`: one glyph with its baseline at `y`, which is
   * how `input_str` draws a name as it is typed and blinks a cursor at
   * the end of it.
   *
   * At `quality: high` the glyph is not blitted; it is remembered at
   * the place it would have gone, keyed by that place, so that the
   * cursor redrawn in the background colour **replaces** the one drawn
   * in the text colour rather than piling up beside it. That is the C's
   * own erase, and it is why nothing here has to know what a cursor is.
   */
  drawChar(surface: Surface, x: number, y: number, ch: string, color: number): number {
    const g = this.glyph(ch);
    if (!g) return 0;
    if (this.typingRtl(y)) {
      if (color !== this.box!.bg) this.textColour = color;
      this.typeInto(surface, ch, color);
      return this.font.charSpacing + g.width;
    }
    if (this.vector) {
      this.remember({
        key: `c:${x},${y}`, left: x, right: x + g.width,
        baseline: y, xAlign: -1, text: ch, rtl: isRtl(ch), color,
        capHeight: TEXT_CAP_HEIGHT,
      });
    } else {
      surface.blitMono(g.sprite, x, y - this.font.heightAbove, color);
    }
    return this.font.charSpacing + g.width;
  }

  // ---------------------------------------------------------- the story

  /** Where a story screen's words go: the window inside `STORY_FRAME`. */
  static readonly STORY = {
    left: 24, right: 296, top: 27, lineHeight: 16,
    /** The credits put the name beside the job rather than under it. */
    creditsSplit: 150,
  } as const;

  /**
   * Draw a story screen's words where the original blits its picture.
   *
   * The caller has already drawn `STORY_FRAME`, so this is the inside
   * of the frame and nothing else.
   */
  drawStory(surface: Surface, id: number, color: number): void {
    const screen = this.story(id);
    if (!screen) return;
    const { left, right, top, lineHeight, creditsSplit } = GameText.STORY;
    const rtl = this.lang === 'he';
    const split = left + creditsSplit;
    for (const [index, line] of screen.lines.entries()) {
      const y = top + index * lineHeight;
      const key = `s${id}:${index}`;
      if (!screen.credits) {
        this.storyLine(surface, line, y, rtl ? 1 : -1, color, key, left, right);
        continue;
      }
      /**
       * The credits are a job and a name on one line.
       *
       * The original right-aligns the job against the gutter and
       * left-aligns the name after it, so the two columns face each
       * other across it. Hebrew turns that over: the job is the
       * column the eye starts at, so it goes on the right, and both
       * columns are aligned to the side the reader begins from.
       */
      const [job = '', name = ''] = line.split('|');
      if (rtl) {
        this.storyLine(surface, job, y, 1, color, `${key}:a`, split, right);
        this.storyLine(surface, name, y, 1, color, `${key}:b`, left, split - GUTTER);
      } else {
        this.storyLine(surface, job, y, 1, color, `${key}:a`, left, split);
        this.storyLine(surface, name, y, -1, color, `${key}:b`, split + GUTTER, right);
      }
    }
  }

  private storyLine(
    surface: Surface, text: string, top: number,
    xAlign: number, color: number, key: string, left: number, right: number,
  ): void {
    if (text === '') return;
    if (this.vector) {
      this.remember({
        key, left, right, baseline: top + TEXT_CAP_HEIGHT, xAlign,
        text, rtl: hasRtl(text) || this.lang === 'he',
        color, capHeight: TEXT_CAP_HEIGHT,
      });
      return;
    }
    const visual = hasRtl(text) ? toVisual(text) : text;
    const width = this.shellWidth(visual);
    let at = left;
    if (xAlign === 0) at = left + ((right - left - width) >> 1);
    else if (xAlign > 0) at = right - width;
    this.blitLine(surface, visual, at, top, color);
  }

  /**
   * The Hebrew words of a title card, or null to blit the picture.
   *
   * English keeps the original's own artwork at both qualities: the
   * card is a drawing of a logotype and there is nothing a redraw
   * could add to it.
   */
  titleCard(id: number): TitleCard | null {
    if (this.lang !== 'he') return null;
    return TITLE_CARDS[id] ?? null;
  }

  /** The words of a title card, centred where the picture's are. */
  drawTitleCard(
    surface: Surface, id: number, left: number, top: number, right: number,
    color: number,
  ): void {
    const card = TITLE_CARDS[id];
    if (!card || this.lang !== 'he') return;
    for (const [row, line] of card.lines) {
      this.storyLine(surface, line, top + row, 0, color, `tc${id}:${row}`, left, right);
    }
  }

  /** How wide a story line is drawn, for the test that pins they fit. */
  storyLineWidth(text: string): number {
    return this.shellWidth(hasRtl(text) ? toVisual(text) : text);
  }
}
