/**
 * `seg009.c`, the part of it the game's logic needs.
 *
 * The rest of that file is DAT loading, decompression and SDL, which
 * the port already has in `src/render/assets.ts` and does not need
 * translating.
 */
import { g } from './state.ts';
import { scr } from './screen.ts';

// seg009:0467
export function prandom(max: number): number {
  // The C does this in 32-bit unsigned arithmetic; `Math.imul` keeps
  // the multiply exact and `>>> 0` puts it back in range.
  g.random_seed = (Math.imul(g.random_seed, 214013) + 2531011) >>> 0;
  return ((g.random_seed >>> 16) % (max + 1));
}

/** The seed is the clock in the original; a replay wants it fixed. */
export function set_seed(seed: number): void {
  g.random_seed = seed >>> 0;
}

// ---------------------------------------------------------------------------
// `input_str`, which is how the hall of fame takes a name.
// ---------------------------------------------------------------------------

/** The C's `char buffer[]`, which it writes into and the caller reads. */
export interface StrBuffer { text: string }

// seg009:053C
/**
 * `input_str`: a box with a blinking cursor in it, until Enter or Escape.
 *
 * The C blocks on `key_test_quit()` between two ticks of `timer_0`; a
 * page cannot, so this is a generator like every other blocking loop of
 * the cutscenes, and `yield 1` is one sixtieth of a second of waiting.
 * The shape is the C's: the cursor is toggled at the top of the inner
 * loop, the timer is started, a key left over from the pass before is
 * acted on, and then the loop waits six sixtieths for the next one.
 *
 * Answers what the C answers: how long the name is, or -1 for Escape.
 */
export function* input_str(
  rect: { left: number; top: number; right: number; bottom: number },
  buffer: StrBuffer, max_length: number, initial: string, has_initial: number,
  arg_4: number, color: number, bgcolor: number,
): Generator<number, number, void> {
  scr.start_text_input(rect.left, rect.top, rect.right, rect.bottom);

  let key: string | null = null;
  let entered = '';
  let length = 0;
  let cursor_visible = 0;
  scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
  const init_length = initial.length;
  if (has_initial) {
    buffer.text = initial;
    length = init_length;
  }
  let current_xpos = rect.left + arg_4;
  const ypos = scr.text_center_y(rect.top, rect.bottom);
  // `draw_cstring(initial)` with the text colour set.
  let at = current_xpos;
  for (const ch of initial) at += scr.draw_text_character(at, ypos, ch, color);
  current_xpos += scr.cstring_width(initial) + (init_length !== 0 ? arg_4 : 0);

  /** `draw_text_cursor(xpos, ypos, color)`. */
  const draw_text_cursor = (xpos: number, y: number, c: number): void => {
    scr.draw_text_character(xpos, y, '_', c);
  };

  for (;;) {
    key = null;
    entered = '';
    for (;;) {
      if (cursor_visible) draw_text_cursor(current_xpos, ypos, color);
      else draw_text_cursor(current_xpos, ypos, bgcolor);
      cursor_visible = cursor_visible ? 0 : 1;
      const deadline = scr.now() + 6;
      if (key !== null) {
        if (cursor_visible) {
          draw_text_cursor(current_xpos, ypos, color);
          cursor_visible = cursor_visible ? 0 : 1;
        }
        if (key === 'enter') {
          scr.stop_text_input();
          return length;
        }
        break;
      }
      while (scr.now() < deadline) {
        const press = scr.take_key();
        if (press) { key = press.key; entered = press.ch; break; }
        yield 1;
      }
    }
    // Only the printable ASCII chars.
    const code = entered.charCodeAt(0);
    const entered_char = entered.length === 1 && code <= 0x7e ? entered : '';
    scr.clear_kbd_buf();

    if (key === 'escape') {
      scr.rect(rect.left, rect.top, rect.right, rect.bottom, bgcolor);
      buffer.text = '';
      scr.stop_text_input();
      return -1;
    }
    if (length !== 0 && (key === 'backspace' || key === 'delete')) {
      --length;
      draw_text_cursor(current_xpos, ypos, bgcolor);
      current_xpos -= scr.char_width(buffer.text[length]!);
      scr.draw_text_character(current_xpos, ypos, buffer.text[length]!, bgcolor);
      buffer.text = buffer.text.slice(0, length);
      draw_text_cursor(current_xpos, ypos, color);
    } else if (entered_char !== '' && code >= 0x20 && code <= 0x7e
      && length < max_length) {
      // Would the new character put the cursor past the right side?
      if (scr.char_width('_') + scr.char_width(entered_char) + current_xpos
        < rect.right) {
        draw_text_cursor(current_xpos, ypos, bgcolor);
        buffer.text = buffer.text.slice(0, length) + entered_char;
        length++;
        current_xpos += scr.draw_text_character(current_xpos, ypos, entered_char, color);
      }
    }
  }
}
