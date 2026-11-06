/**
 * Turn a raw DOSBox capture (640x400, a clean 2x upscale of the 320x200 VGA
 * screen) into a 320x200 golden reference PNG stored under tests/golden/.
 *
 *   node tools/oracle/make_golden.mjs <capture.png> <tests/golden/name.png>
 *
 * Fails if the capture is not an exact 2x upscale, so a golden file can never
 * silently record resampled pixels.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: make_golden.mjs <capture.png> <out.png>');
  process.exit(2);
}
const png = PNG.sync.read(readFileSync(src));
if (png.width !== 640 || png.height !== 400) {
  throw new Error(`expected a 640x400 capture, got ${png.width}x${png.height}`);
}
const out = new PNG({ width: 320, height: 200 });
for (let y = 0; y < 200; y++) {
  for (let x = 0; x < 320; x++) {
    const i = (y * 2 * 640 + x * 2) * 4;
    for (const [dy, dx] of [[0, 1], [1, 0], [1, 1]]) {
      const j = ((y * 2 + dy) * 640 + (x * 2 + dx)) * 4;
      for (let k = 0; k < 3; k++) {
        if (png.data[i + k] !== png.data[j + k]) {
          throw new Error(`capture is not a clean 2x upscale at (${x},${y})`);
        }
      }
    }
    const o = (y * 320 + x) * 4;
    out.data[o] = png.data[i];
    out.data[o + 1] = png.data[i + 1];
    out.data[o + 2] = png.data[i + 2];
    out.data[o + 3] = 255;
  }
}
writeFileSync(dst, PNG.sync.write(out));
console.log(`wrote ${dst}`);
