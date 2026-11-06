/**
 * End-to-end check against the original game.
 *
 * tests/golden/title-background.png was captured from PRINCE.EXE running in
 * DOSBox (see tools/oracle/). Decoding TITLE.DAT resource 51 with palette 50
 * has to reproduce that frame exactly — not approximately. If it does, the
 * container reader, the LZ decompressor, the 4-bit pixel unpacking and the
 * palette conversion are all correct together.
 */
import { describe, it, expect } from 'vitest';
import { dat, goldenFrame, toCaptureSpace, compareRgb } from '../helpers/fixtures.ts';
import { decodeImage } from '../../src/dat/image.ts';
import { parsePalette, to8 } from '../../src/dat/palette.ts';

describe('against the original game', () => {
  it('the title background is reproduced pixel for pixel', () => {
    const d = dat('TITLE.DAT');
    const pal = parsePalette(d.get(50));
    const img = decodeImage(d.get(51));
    const golden = goldenFrame('title-background.png');

    expect([img.width, img.height]).toEqual([golden.width, golden.height]);

    const rgb = new Uint8Array(img.width * img.height * 3);
    for (let i = 0; i < img.pixels.length; i++) {
      const c = pal.vga[img.pixels[i]];
      rgb[i * 3] = to8(c.r);
      rgb[i * 3 + 1] = to8(c.g);
      rgb[i * 3 + 2] = to8(c.b);
    }

    const diff = compareRgb(
      toCaptureSpace(rgb), golden.rgb, golden.width, golden.height,
    );
    expect(diff.first).toBeUndefined();
    expect(diff.count).toBe(0);
  });
});
