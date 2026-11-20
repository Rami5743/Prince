/**
 * The canvas the game draws onto.
 *
 * The backing store is exactly 320x200 so that one game pixel is one canvas
 * pixel; the element is then scaled up with nearest-neighbour filtering. The
 * original's pixels were not square (320x200 filled a 4:3 screen), so the
 * display offers both the true 4:3 shape and an unstretched 1:1 mode.
 */
import { SCREEN_WIDTH, SCREEN_HEIGHT, Surface } from './surface.ts';
import type { OverlayItem } from './text.ts';

export type AspectMode = 'original-4-3' | 'square-pixels';

/**
 * The faces the crisp pass asks for, best first.
 *
 * A serif, because the release's own font is one, and a Hebrew serif
 * ahead of the Latin ones so that a mixed line -- `נותרו 60 דקות` --
 * comes out of a single family where the player has one. The last two
 * are what a Linux machine has; `serif` is the browser's own.
 */
const VECTOR_FACE = '"Frank Ruehl CLM", "David Libre", David, "Noto Serif Hebrew", '
  + '"Times New Roman", "Liberation Serif", "FreeSerif", "DejaVu Serif", serif';

/**
 * How tall a capital is as a fraction of the font size.
 *
 * The overlay is asked for a cap height in game pixels -- seven, which
 * is what the release's own glyphs are -- and a font size is not a cap
 * height. Nothing measures this: it is the ordinary ratio for a serif
 * face, and the one number that decides whether the crisp words look
 * the size of the words they replace.
 */
const CAP_RATIO = 0.7;

export class Display {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private aspect: AspectMode = 'original-4-3';
  /**
   * The second canvas, over the first, for `quality: high`.
   *
   * The game's own canvas is 320 by 200 and nothing drawn into it can
   * be sharper than that. So the crisp words are not drawn into it at
   * all: they go on a canvas of the same size and place whose backing
   * store is the size the picture is really shown at, times the
   * device's own pixel ratio. The 320 by 200 surface underneath keeps
   * its background -- the strip under the room is still blacked, the
   * story frame is still drawn -- and `tools/dev/page-port.ts` goes on
   * reading that surface and seeing the headless port's own picture.
   */
  private overlay: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private textSource: (() => readonly OverlayItem[]) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('cannot get a 2d context');
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.imageData = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    this.applyAspect();
    this.watch();
  }

  setAspect(mode: AspectMode): void {
    this.aspect = mode;
    this.applyAspect();
  }

  /** The width of one screen height, in the shape of pixel chosen. */
  private get ratio(): number {
    return this.aspect === 'original-4-3' ? 4 / 3 : SCREEN_WIDTH / SCREEN_HEIGHT;
  }

  /**
   * The biggest the picture can be inside the box it is given.
   *
   * This is worked out here rather than left to CSS, and that is not a
   * preference. The page gives the game the whole height of the window,
   * so the width has to follow from the height -- and a rule that asks
   * for the height of the element's own container is circular, because
   * the container is sized by what is in it. Measured, in a window 760
   * pixels wide: the container-query form drew the game **two pixels
   * square**. Reading the box and setting the two lengths cannot go
   * wrong that way.
   */
  private applyAspect(): void {
    const s = this.canvas.style;
    s.imageRendering = 'pixelated';
    const box = this.canvas.parentElement?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) {
      // Not laid out yet -- the observer below will come back to it.
      s.aspectRatio = this.aspect === 'original-4-3' ? '4 / 3' : '320 / 200';
      return;
    }
    const width = Math.min(box.width, box.height * this.ratio);
    s.width = `${Math.floor(width)}px`;
    s.height = `${Math.floor(width / this.ratio)}px`;
    s.aspectRatio = '';
    this.placeOverlay();
  }

  /**
   * The crisp text canvas, exactly over the game's own.
   *
   * It is made the first time something asks to draw on it, so a page
   * at `quality: original` never has a second canvas at all.
   */
  private makeOverlay(): CanvasRenderingContext2D | null {
    if (this.overlayCtx) return this.overlayCtx;
    const parent = this.canvas.parentElement;
    if (!parent || typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.id = 'screen-text';
    canvas.setAttribute('aria-hidden', 'true');
    const s = canvas.style;
    s.position = 'absolute';
    s.pointerEvents = 'none';
    s.background = 'transparent';
    s.border = '0';
    s.imageRendering = 'auto';
    s.zIndex = '1';
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    parent.appendChild(canvas);
    this.overlay = canvas;
    this.overlayCtx = ctx;
    this.placeOverlay();
    return ctx;
  }

  /**
   * Put the text canvas where the game's canvas is.
   *
   * The stage centres the game in its box, so the offset is read off
   * the element rather than assumed -- and the border is a pixel, so
   * the content box is what the picture fills, not the border box.
   */
  private placeOverlay(): void {
    const canvas = this.overlay;
    if (!canvas) return;
    const game = this.canvas;
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(game) : null;
    const borderLeft = style ? parseFloat(style.borderLeftWidth) || 0 : 0;
    const borderTop = style ? parseFloat(style.borderTopWidth) || 0 : 0;
    const width = game.clientWidth || game.offsetWidth;
    const height = game.clientHeight || game.offsetHeight;
    canvas.style.left = `${game.offsetLeft + borderLeft}px`;
    canvas.style.top = `${game.offsetTop + borderTop}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const dpr = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
  }

  /**
   * Where the crisp words come from, or null for none.
   *
   * `web/main.ts` points this at the text layer. Nothing else does, so
   * a page that never asked for the better text never draws one.
   */
  setTextSource(source: (() => readonly OverlayItem[]) | null): void {
    this.textSource = source;
  }

  /** Follow the box the page gives the game, which a resize changes. */
  private watch(): void {
    const parent = this.canvas.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    new ResizeObserver(() => this.applyAspect()).observe(parent);
  }

  present(surface: Surface, paletteRgba: Uint8Array): void {
    surface.toRgba(paletteRgba, this.imageData.data);
    this.ctx.putImageData(this.imageData, 0, 0);
    this.presentText(paletteRgba);
  }

  /**
   * The words, on the canvas over the picture, at the canvas's own
   * resolution.
   *
   * The colour is looked up in the palette the picture was just drawn
   * with, so a line fades with the screen it is on rather than staying
   * bright through a `fade_out_2` -- the palette is the whole of how
   * the original fades, and the overlay reads the same one.
   */
  private presentText(paletteRgba: Uint8Array): void {
    const items = this.textSource?.() ?? [];
    if (items.length === 0) {
      if (this.overlayCtx && this.overlay) {
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
      }
      return;
    }
    const ctx = this.makeOverlay();
    const canvas = this.overlay;
    if (!ctx || !canvas) return;
    if (canvas.width < 2 || canvas.height < 2) this.placeOverlay();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Game pixels, stretched the way the picture under them is: the
    // original's pixels were not square and the letters are not either.
    ctx.setTransform(canvas.width / SCREEN_WIDTH, 0, 0, canvas.height / SCREEN_HEIGHT, 0, 0);
    ctx.textBaseline = 'alphabetic';
    for (const item of items) {
      const size = item.capHeight / CAP_RATIO;
      ctx.font = `${size}px ${VECTOR_FACE}`;
      ctx.direction = item.rtl ? 'rtl' : 'ltr';
      const at = item.color * 4;
      const r = paletteRgba[at] ?? 255;
      const g = paletteRgba[at + 1] ?? 255;
      const b = paletteRgba[at + 2] ?? 255;
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      let x = item.left;
      if (item.xAlign === 0) { ctx.textAlign = 'center'; x = (item.left + item.right) / 2; }
      else if (item.xAlign > 0) { ctx.textAlign = 'right'; x = item.right; }
      else ctx.textAlign = 'left';
      ctx.fillText(item.text, x, item.baseline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
