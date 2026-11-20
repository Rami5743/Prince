/**
 * A Hebrew face for the game's own font, at the game's own cell size.
 *
 * `font.ts` reads the 1990 release's `rawfont` out of `PRINCE.EXE`, and
 * that font is ASCII: `firstChar` 32, `lastChar` 131, and nothing in
 * between is a Hebrew letter. The strip under the room is 180 pixels
 * wide and seven rows tall, so Hebrew there has to be drawn the same
 * way the English is -- one bitmap per letter, blitted in one colour --
 * or it cannot be drawn at all at `quality: original`.
 *
 * **The weight is measured off the original's own glyphs, not chosen.**
 * Dumping `E`, `B`, `T` and `L` out of the release says what the face
 * does: a capital is 7 rows tall and 5 or 6 columns wide, a vertical
 * stem is **two** columns, and a horizontal bar is **one** row.
 *
 *     'E' 5x7        'B' 6x7        'T' 6x7
 *     #####          #####.         ######
 *     ##...          ##..##         ..##..
 *     ##...          ##..##         ..##..
 *     ####.          #####.         ..##..
 *     ##...          ##..##         ..##..
 *     ##...          ##..##         ..##..
 *     #####          #####.         ..##..
 *
 * So every letter below is seven rows above the baseline with two-column
 * stems and one-row bars, which is why it sits beside a digit out of the
 * release's own font without looking like a different typeface. The five
 * letters that hang below the line -- ך, ן, ף, ץ and ק -- are nine rows,
 * which is exactly `heightAbove + heightBelow`, the room the original
 * leaves for the tail of a `g` or a `y`.
 *
 * `י` is three rows and no more: a yod is drawn at the top of the line
 * and the font's glyphs share a top rather than a baseline, so a short
 * glyph is a high one.
 */
import type { Glyph } from './font.ts';

/** One letter, drawn from its top-left corner. `#` is ink. */
const ROWS: Readonly<Record<string, readonly string[]>> = {
  // alef: the main stroke rises to the right, with an arm at each end.
  'א': [
    '....##',
    '##.##.',
    '.####.',
    '..##..',
    '.####.',
    '.##.##',
    '##....',
  ],
  // bet: the foot sticks out to the left, which is the whole of what
  // tells it from a kaf.
  'ב': [
    '.######',
    '.....##',
    '.....##',
    '.....##',
    '.....##',
    '.....##',
    '#######',
  ],
  'ג': [
    '.####.',
    '..##..',
    '..##..',
    '..##..',
    '..##..',
    '.###..',
    '##..##',
  ],
  // dalet: a square corner, and the bar reaches the right edge.
  'ד': [
    '#######',
    '....##.',
    '....##.',
    '....##.',
    '....##.',
    '....##.',
    '....##.',
  ],
  // he: the left leg hangs free of the bar.
  'ה': [
    '######',
    '....##',
    '....##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
  ],
  'ו': [
    '####',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
  ],
  'ז': [
    '#####',
    '.##..',
    '.##..',
    '.##..',
    '.##..',
    '.##..',
    '.##..',
  ],
  'ח': [
    '#######',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
  ],
  'ט': [
    '##.###',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '.####.',
  ],
  // yod: three rows, and so drawn at the top of the line.
  'י': [
    '###',
    '.##',
    '.##',
  ],
  'ך': [
    '######',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
  ],
  'כ': [
    '.#####',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '.#####',
  ],
  // lamed: the one letter of the alphabet that climbs above the line,
  // and the font has no room above the line -- `heightAbove` is the top
  // of the cell. So the climb is inside the cell, which is what keeps
  // it from reading as a kaf: measured on the story screen, a lamed
  // whose body filled the cell left `של` looking like `שכ` on every
  // line it appeared in.
  'ל': [
    '##.....',
    '###....',
    '.######',
    '.....##',
    '.....##',
    '.....##',
    '.######',
  ],
  'ם': [
    '######',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '######',
  ],
  // mem: the left stroke is angled and clear of the bar; a final mem's
  // is neither.
  'מ': [
    '.######',
    '.....##',
    '.....##',
    '##...##',
    '##...##',
    '##...##',
    '#######',
  ],
  'ן': [
    '####',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
    '..##',
  ],
  'נ': [
    '.####',
    '...##',
    '...##',
    '...##',
    '...##',
    '...##',
    '#####',
  ],
  // samekh: rounded at all four corners, where a final mem is square.
  'ס': [
    '.####.',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '.####.',
  ],
  'ע': [
    '##..##',
    '##..##',
    '.#..##',
    '.##.##',
    '..####',
    '....##',
    '..####',
  ],
  'ף': [
    '######',
    '##..##',
    '.#####',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
  ],
  'פ': [
    '######',
    '##..##',
    '.#####',
    '....##',
    '....##',
    '....##',
    '######',
  ],
  'ץ': [
    '##..##',
    '.#..##',
    '.##.##',
    '..####',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
  ],
  'צ': [
    '##..##',
    '.#..##',
    '.##.##',
    '..####',
    '....##',
    '....##',
    '######',
  ],
  // qof: the stem stops on the line and the left leg carries on under it.
  'ק': [
    '######',
    '....##',
    '....##',
    '##..##',
    '##..##',
    '##..##',
    '##..##',
    '##....',
    '##....',
  ],
  // resh: rounded, where a dalet's corner is square.
  'ר': [
    '.#####',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
    '....##',
  ],
  'ש': [
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '.######.',
    '########',
  ],
  // tav: the left leg is inset and kicks left at the foot, which is what
  // tells it from a het.
  'ת': [
    '#######',
    '.##..##',
    '.##..##',
    '.##..##',
    '.##..##',
    '.##..##',
    '###..##',
  ],
  // The two Hebrew marks that stand in for a quote and an apostrophe.
  '׳': [
    '##',
    '##',
    '.#',
  ],
  '״': [
    '##.##',
    '##.##',
    '.#..#',
  ],
};

function glyphFrom(rows: readonly string[]): Glyph {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = rows[y]!;
    for (let x = 0; x < width; x++) pixels[y * width + x] = row[x] === '#' ? 1 : 0;
  }
  return { width, height, sprite: { width, height, pixels } };
}

/** The face, built once. Keyed by the letter itself. */
export const HEBREW_GLYPHS: ReadonlyMap<string, Glyph> = new Map(
  Object.entries(ROWS).map(([ch, rows]) => [ch, glyphFrom(rows)]),
);

/** Does this character belong to the Hebrew face rather than the release's? */
export function isHebrewGlyph(ch: string): boolean {
  return HEBREW_GLYPHS.has(ch);
}

/**
 * Is this character written right to left?
 *
 * The Hebrew block and the two marks above. A digit, a space and the
 * punctuation around them are not, which is what `layoutRtl` is for.
 */
export function isRtl(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x0590 && code <= 0x05ff;
}
