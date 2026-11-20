/**
 * The canvas the game draws onto.
 *
 * The backing store is exactly 320x200 so that one game pixel is one canvas
 * pixel; the element is then scaled up with nearest-neighbour filtering. The
 * original's pixels were not square (320x200 filled a 4:3 screen), so the
 * display offers both the true 4:3 shape and an unstretched 1:1 mode.
 */
import { SCREEN_WIDTH, SCREEN_HEIGHT, Surface } from './surface.ts';

export type AspectMode = 'original-4-3' | 'square-pixels';

export class Display {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly imageData: ImageData;
  private aspect: AspectMode = 'original-4-3';

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
  }
}
