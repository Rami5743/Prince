/**
 * Developer tool: decode graphics resources to PNG so they can be looked at.
 *   node --experimental-strip-types tools/dev/dump-images.ts <DAT> <outdir> [ids...]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PNG } from 'pngjs';
import { DatFile } from '../../src/dat/container.ts';
import { parsePalette, to8 } from '../../src/dat/palette.ts';
import { decodeImage, isImage } from '../../src/dat/image.ts';

const [datPath, outDir, ...idArgs] = process.argv.slice(2);
if (!datPath || !outDir) {
  console.error('usage: dump-images.ts <DAT> <outdir> [ids...]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const dat = new DatFile(new Uint8Array(readFileSync(datPath)), basename(datPath));

// The palette for a group is the nearest lower id that is a 100-byte payload.
const palIds = dat.entries.filter((e) => e.size === 100).map((e) => e.id);
function paletteFor(id: number) {
  let best = -1;
  for (const p of palIds) if (p <= id && p > best) best = p;
  if (best < 0) return null;
  try {
    return parsePalette(dat.get(best));
  } catch {
    return null;
  }
}

const wanted = idArgs.length ? idArgs.map(Number) : dat.ids();
let written = 0;
for (const id of wanted) {
  const payload = dat.get(id);
  if (payload.length === 100 || !isImage(payload)) continue;
  let img;
  try {
    img = decodeImage(payload);
  } catch (e) {
    console.error(`id ${id}: ${(e as Error).message}`);
    continue;
  }
  const pal = paletteFor(id);
  const png = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.width * img.height; i++) {
    const v = img.pixels[i];
    let r: number, g: number, b: number;
    if (pal && img.depth > 1) {
      r = to8(pal.vga[v].r);
      g = to8(pal.vga[v].g);
      b = to8(pal.vga[v].b);
    } else {
      r = g = b = v ? 255 : 0;
    }
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  const name = `${String(id).padStart(4, '0')}_${img.width}x${img.height}_m${img.method}_d${img.depth}.png`;
  writeFileSync(join(outDir, name), PNG.sync.write(png));
  written++;
}
console.log(`wrote ${written} images to ${outDir}`);
