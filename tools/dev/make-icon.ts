/**
 * The browser tab's icon, cut out of the game's own title screen.
 *
 * The page had `<link rel="icon" href="data:,">` -- a deliberately
 * blank icon -- so the tab showed the browser's blank page glyph.
 * This writes a real one, and it is **the opening screen's own
 * pixels**: `TITLE.DAT` resource 51, decoded through the title's own
 * palette (group 50) and expanded with the DAC's `(v << 2) | (v >> 4)`
 * exactly as the game draws it.
 *
 *     npx tsx tools/dev/make-icon.ts [--sheet]
 *
 * ## The crop was chosen by looking, at the size a tab really shows
 *
 * A favicon is 16 pixels, or 32 on a high-resolution screen, and the
 * title screen is 320 by 200 of fine ornament: squeezed whole into 16
 * it is a brown smudge. Five crops were put side by side at 16, 24
 * and 32 and looked at --
 *
 *     the whole arch, 200x200      a brown blob at 16; the arch
 *                                  reads at 32 and nothing inside it
 *     the arch's head, 120x120     the ogee reads, the palace is dust
 *     the palace, 80x80            good at 32, soft at 16
 *     the palace, 64x64            good at 32, soft at 16
 *     the dome, 36x36              reads at 16 AND at 32
 *
 * -- so the subject is **the dome**, not the palace and not the arch.
 * At `(126, 42)`, 36 by 36, the frame holds the great dome, the
 * minaret beside it and the terrace below, which is the most of the
 * picture that survives being made sixteen pixels wide.
 *
 * A border was tried, in the frame's own gold and in its blue, on a
 * light tab bar and a dark one. It buys nothing the mid-tone ochre
 * does not already give and it costs two of the sixteen pixels, so
 * there is none.
 *
 * ## Down with a box filter, up with none
 *
 * Shrinking is an **average** -- nearest-neighbour throws away eight
 * of every nine pixels and turns the dome into noise, which the sheet
 * shows plainly. Enlarging is nearest, because the thing being
 * enlarged is pixel art and a soft 180-pixel dome would be a lie
 * about what this game looks like. 180 is exactly five times 36.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { DatFile } from '../../src/dat/container.ts';
import { parsePalette } from '../../src/dat/palette.ts';
import { decodeImage } from '../../src/dat/image.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `TITLE.DAT` group 50: the title screen and the four patches on it. */
const TITLE_SCREEN = 51;
/** The dome, in the title screen's own coordinates. */
export const CROP = { x: 126, y: 42, size: 36 } as const;

/** The DAC's own expansion: six bits are a fraction of full scale. */
const dac = (v: number): number => (v << 2) | (v >> 4);

/** The title screen as RGB, 320 by 200. */
function titleScreen(): { w: number; h: number; px: Uint8Array } {
  const dat = new DatFile(
    new Uint8Array(readFileSync(join(REPO, 'original/prince1/TITLE.DAT'))),
    'TITLE.DAT',
  );
  const pal = parsePalette(dat.get(50));
  const img = decodeImage(dat.get(TITLE_SCREEN));
  const px = new Uint8Array(img.width * img.height * 3);
  for (let i = 0; i < img.width * img.height; i++) {
    const e = pal.vga[img.pixels[i]! & 15]!;
    px[i * 3] = dac(e.r);
    px[i * 3 + 1] = dac(e.g);
    px[i * 3 + 2] = dac(e.b);
  }
  return { w: img.width, h: img.height, px };
}

/** The crop, averaged down to `n` by `n`. */
function shrink(src: ReturnType<typeof titleScreen>, n: number): PNG {
  const { x: cx, y: cy, size } = CROP;
  const out = new PNG({ width: n, height: n });
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const x0 = cx + Math.floor((x * size) / n);
      const x1 = Math.max(cx + Math.floor(((x + 1) * size) / n), x0 + 1);
      const y0 = cy + Math.floor((y * size) / n);
      const y1 = Math.max(cy + Math.floor(((y + 1) * size) / n), y0 + 1);
      let r = 0, g = 0, b = 0, k = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * src.w + xx) * 3;
          r += src.px[s]!; g += src.px[s + 1]!; b += src.px[s + 2]!; k++;
        }
      }
      const d = (y * n + x) * 4;
      out.data[d] = r / k; out.data[d + 1] = g / k; out.data[d + 2] = b / k;
      out.data[d + 3] = 255;
    }
  }
  return out;
}

/** The crop at `f` times its own size, pixel for pixel. */
function enlarge(src: ReturnType<typeof titleScreen>, f: number): PNG {
  const { x: cx, y: cy, size } = CROP;
  const n = size * f;
  const out = new PNG({ width: n, height: n });
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = ((cy + ((y / f) | 0)) * src.w + cx + ((x / f) | 0)) * 3;
      const d = (y * n + x) * 4;
      out.data[d] = src.px[s]!; out.data[d + 1] = src.px[s + 1]!;
      out.data[d + 2] = src.px[s + 2]!; out.data[d + 3] = 255;
    }
  }
  return out;
}

/**
 * An `.ico` holding PNGs, which every browser since IE 11 reads.
 *
 * Six bytes of directory, then sixteen per image, then the PNGs.
 * A browser asks for `/favicon.ico` whether the page names one or
 * not, so one at the root is a 404 saved as much as an icon.
 */
function ico(images: PNG[]): Buffer {
  const blobs = images.map((p) => PNG.sync.write(p));
  const head = Buffer.alloc(6 + 16 * blobs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // an icon, not a cursor
  head.writeUInt16LE(blobs.length, 4);
  let at = head.length;
  blobs.forEach((blob, i) => {
    const e = 6 + 16 * i;
    const n = images[i]!.width;
    head.writeUInt8(n >= 256 ? 0 : n, e);
    head.writeUInt8(n >= 256 ? 0 : n, e + 1);
    head.writeUInt8(0, e + 2); // not a palette
    head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); // planes
    head.writeUInt16LE(32, e + 6); // bits a pixel
    head.writeUInt32LE(blob.length, e + 8);
    head.writeUInt32LE(at, e + 12);
    at += blob.length;
  });
  return Buffer.concat([head, ...blobs]);
}

function main(): void {
  const src = titleScreen();
  const dir = join(REPO, 'web/icons');
  mkdirSync(dir, { recursive: true });

  const small = [16, 32].map((n) => shrink(src, n));
  for (const p of small) {
    writeFileSync(join(dir, `icon-${p.width}.png`), PNG.sync.write(p));
  }
  const big = enlarge(src, 5); // 36 * 5 = 180, the one Apple asks for
  writeFileSync(join(dir, 'icon-180.png'), PNG.sync.write(big));
  writeFileSync(join(REPO, 'favicon.ico'), ico(small));

  console.log(`from TITLE.DAT ${TITLE_SCREEN}, crop ${CROP.size}x${CROP.size}`
    + ` at (${CROP.x}, ${CROP.y})`);
  console.log('  web/icons/icon-16.png   web/icons/icon-32.png');
  console.log(`  web/icons/icon-180.png  (${big.width}x${big.height}, pixel for pixel)`);
  console.log('  favicon.ico             (16 and 32)');
}

main();
