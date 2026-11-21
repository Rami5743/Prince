/**
 * The canvas the game draws onto.
 *
 * The backing store is exactly 320x200 so that one game pixel is one canvas
 * pixel; the element is then scaled up with nearest-neighbour filtering. The
 * original's pixels were not square (320x200 filled a 4:3 screen), so the
 * display offers both the true 4:3 shape and an unstretched 1:1 mode.
 */
import { SCREEN_WIDTH, SCREEN_HEIGHT, Surface } from './surface.ts';
import { fitLine, type OverlayItem } from './text.ts';
import {
  antialias, composeAntialiased, AA_FACTOR,
  type Antialiased, type AntialiasScratch,
} from './upscale.ts';

export type AspectMode = 'original-4-3' | 'square-pixels';
export type PictureQuality = 'original' | 'high';

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
  /**
   * `quality: high` for the **picture**, which is a bigger canvas.
   *
   * The words went onto a second canvas because a letter wants a
   * vector face and the game has none; the picture cannot do that --
   * there is nothing to draw it from but the art in the data files.
   * What it gets instead is `src/render/upscale.ts`: the art drawn
   * nine times as fine and sampled back down three by three, so the
   * canvas is three times as big **and** its edges carry colours the
   * palette does not hold -- measured, 24 colours on a dungeon frame
   * become 229. They are kept as mixtures of indices rather than as
   * finished colours, so a fade still fades them.
   *
   * At `original` none of this exists: the canvas is 320 by 200 and
   * `image-rendering: pixelated`, exactly as it was.
   */
  private quality: PictureQuality = 'original';
  /** The last surface anti-aliased, so a frame is filtered only once. */
  private hiFrom: Uint8Array | null = null;
  private hiPicture: Antialiased | null = null;
  private hiScratch: AntialiasScratch = {};
  private hiImage: ImageData | null = null;
  /**
   * The last thing presented, so a resize can put it back.
   *
   * Changing a canvas's backing store **clears it**, and the quality
   * changes its size. The game presents every
   * tick so it would not show for long -- but a paused game and a
   * scene that has stopped present nothing at all, and those would
   * be left looking at a blank canvas until something else moved.
   * These are references and not copies: the surface is the game's
   * own and goes on being drawn into, which is what should be put
   * back.
   */
  private last: { surface: Surface; palette: Uint8Array } | null = null;

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

  /**
   * The picture's quality, which the player may move at any moment.
   *
   * Only the canvas changes. Nothing is told about it: the next
   * `present` reads the same 320x200 surface it would have read
   * anyway, so a game in the middle of a tick does not notice, and a
   * player who changes their mind gets the original's own pixels back
   * on the very next frame.
   */
  setQuality(mode: PictureQuality): void {
    if (mode === this.quality) return;
    this.quality = mode;
    this.hiFrom = null;
    this.sizeCanvas();
  }

  /**
   * Give the canvas the backing store this quality asks for.
   *
   * There is one size at `high` and it is three times the game's,
   * which is also the size the anti-aliasing samples down from. A
   * bigger canvas would want a bigger sampling to be worth having,
   * and the measurement for that is in `upscale.ts`: a quarter of a
   * second a frame, against a tenth of a core for this.
   */
  private sizeCanvas(): void {
    const factor = this.quality === 'high' ? AA_FACTOR : 1;
    const width = SCREEN_WIDTH * factor;
    const height = SCREEN_HEIGHT * factor;
    let cleared = false;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = false;
      this.hiFrom = null;
      this.hiPicture = null;
      this.hiImage = null;
      cleared = true;
    }
    // Nearest neighbour is the original's own look and is what
    // `quality: original` is for; an anti-aliased picture is handed
    // to the browser to resize, and that has to be smooth or the
    // anti-aliasing is thrown away on the way to the glass.
    this.canvas.style.imageRendering = factor === 1 ? 'pixelated' : 'auto';
    if (cleared && this.last) this.present(this.last.surface, this.last.palette);
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
    const box = this.canvas.parentElement?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) {
      // Not laid out yet -- the observer below will come back to it.
      s.aspectRatio = this.aspect === 'original-4-3' ? '4 / 3' : '320 / 200';
      this.sizeCanvas();
      return;
    }
    const width = Math.min(box.width, box.height * this.ratio);
    s.width = `${Math.floor(width)}px`;
    s.height = `${Math.floor(width / this.ratio)}px`;
    s.aspectRatio = '';
    // The window may have grown enough to be worth more pixels.
    this.sizeCanvas();
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
    this.last = { surface, palette: paletteRgba };
    if (this.quality === 'high') this.presentHigh(surface, paletteRgba);
    else {
      surface.toRgba(paletteRgba, this.imageData.data);
      this.ctx.putImageData(this.imageData, 0, 0);
    }
    this.presentText(paletteRgba);
  }

  /**
   * The same picture, three times as big and with its edges
   * anti-aliased, in the palette it was drawn with.
   *
   * The **filtering** is done on the indices and only when the
   * indices have moved, which is what makes this affordable: the
   * flash puts the screen up twice inside one tick and a fade writes
   * a new palette every other sixtieth, and neither of them changes
   * a pixel of the surface. What runs on every frame is the compose,
   * and that is the flat fill the display always did plus the four
   * per cent of pixels that are a mixture -- measured at 1.8 ms and
   * 0.8 ms on a palace room.
   */
  private presentHigh(surface: Surface, paletteRgba: Uint8Array): void {
    const width = surface.width * AA_FACTOR;
    const height = surface.height * AA_FACTOR;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.imageSmoothingEnabled = false;
      this.hiImage = null;
    }
    const src = surface.pixels;
    let moved = this.hiFrom === null || this.hiFrom.length !== src.length;
    if (!moved) {
      const was = this.hiFrom!;
      for (let i = 0; i < src.length; i++) {
        if (was[i] !== src[i]) { moved = true; break; }
      }
    }
    if (moved || !this.hiPicture) {
      this.hiPicture = antialias(src, surface.width, surface.height, this.hiScratch);
      this.hiFrom = this.hiFrom?.length === src.length ? this.hiFrom : new Uint8Array(src.length);
      this.hiFrom.set(src);
    }
    if (!this.hiImage || this.hiImage.width !== width || this.hiImage.height !== height) {
      this.hiImage = this.ctx.createImageData(width, height);
    }
    composeAntialiased(this.hiPicture, paletteRgba, this.hiImage.data);
    this.ctx.putImageData(this.hiImage, 0, 0);
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
      ctx.direction = item.rtl ? 'rtl' : 'ltr';
      const baseline = this.fitToBand(ctx, item);
      const at = item.color * 4;
      const r = paletteRgba[at] ?? 255;
      const g = paletteRgba[at + 1] ?? 255;
      const b = paletteRgba[at + 2] ?? 255;
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      let x = item.left;
      if (item.xAlign === 0) { ctx.textAlign = 'center'; x = (item.left + item.right) / 2; }
      else if (item.xAlign > 0) { ctx.textAlign = 'right'; x = item.right; }
      else ctx.textAlign = 'left';
      ctx.fillText(item.text, x, baseline);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /**
   * Set the font for this line and say where its baseline goes.
   *
   * A line that declares no band keeps the size a seven-pixel capital
   * asks for and the baseline the original drew on, which is every
   * line of English in the game. A line that declares one is measured
   * -- `actualBoundingBox` is the ink, not the em, so it is the real
   * answer for this string in this face -- and made small enough to
   * sit inside it, because the strip under the room has eight rows
   * and a Hebrew lamed and qof together want twelve.
   */
  private fitToBand(ctx: CanvasRenderingContext2D, item: OverlayItem): number {
    const size = item.capHeight / CAP_RATIO;
    ctx.font = `${size}px ${VECTOR_FACE}`;
    const { top, bottom } = item;
    if (top === undefined || bottom === undefined) return item.baseline;
    const fitted = fitLine(item.baseline, size, top, bottom, (at) => {
      ctx.font = `${at}px ${VECTOR_FACE}`;
      const m = ctx.measureText(item.text);
      return { ascent: m.actualBoundingBoxAscent, descent: m.actualBoundingBoxDescent };
    });
    ctx.font = `${fitted.size}px ${VECTOR_FACE}`;
    return fitted.baseline;
  }
}
