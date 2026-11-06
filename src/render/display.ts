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
  }

  setAspect(mode: AspectMode): void {
    this.aspect = mode;
    this.applyAspect();
  }

  private applyAspect(): void {
    const s = this.canvas.style;
    s.imageRendering = 'pixelated';
    s.aspectRatio = this.aspect === 'original-4-3' ? '4 / 3' : '320 / 200';
  }

  present(surface: Surface, paletteRgba: Uint8Array): void {
    surface.toRgba(paletteRgba, this.imageData.data);
    this.ctx.putImageData(this.imageData, 0, 0);
  }
}
