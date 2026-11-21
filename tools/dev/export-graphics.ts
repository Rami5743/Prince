/**
 * Every picture in the game's own data files, written out as PNGs.
 *
 *   npx tsx tools/dev/export-graphics.ts <outdir>
 *
 * The original keeps its art in `.DAT` archives as planar, RLE- or
 * LZ-packed **palette indices**, with the palette in a separate
 * resource -- the "shape-list header" that opens each group and says
 * how many images follow it. So a picture cannot be read out on its
 * own: it has to be paired with the right header, and which header
 * governs which resource is a table hard-coded in `PRINCE.EXE`,
 * which is `src/dat/groups.ts`.
 *
 * Three things this gets right that a naive dump does not:
 *
 * * **The palette is the group's, not the file's.** `PV.DAT` holds
 *   four groups with four different palettes; an image drawn with
 *   the wrong one is the right shape in the wrong colours.
 * * **The DAC expansion.** The stored components are six bits and
 *   the hardware's expansion is `(v << 2) | (v >> 4)`, so 63 is 255
 *   and not 252. (`src/dat/palette.ts`'s own `to8` is the naive
 *   shift, which this file deliberately does not use -- see
 *   `src/render/surface.ts`.)
 * * **Colour 0 is transparent in a sprite and black in a
 *   background.** The engine blits a character with
 *   `blitters_10_transp` and a room tile with
 *   `blitters_0_no_transp`, so the same index means two different
 *   things depending on what is being drawn. Each group says which
 *   it is.
 *
 * Alongside every group it writes a contact sheet, which is the
 * quickest way to see what a group holds.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { DatFile } from '../../src/dat/container.ts';
import { parsePalette, PALETTE_SIZE, type Palette } from '../../src/dat/palette.ts';
import { decodeImage, isImage, isEmptyPlaceholder } from '../../src/dat/image.ts';
import { SPRITE_GROUPS, TILESET_GROUPS, TILESET_FILES } from '../../src/dat/groups.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = join(REPO, 'original', 'prince1');
const OUT = process.argv[2] ?? join(REPO, 'graphics');

/** One group of images and the header that colours them. */
interface Group {
  readonly file: string;
  readonly header: number;
  readonly name: string;
  /** Colour 0: transparent in a sprite, black in a background. */
  readonly sprite: boolean;
  /** Where the palette comes from, if not this file's own header. */
  readonly paletteFile?: string;
}

/**
 * Every group in the game, with what it holds and how colour 0 is
 * meant. The sprite groups are the ones the engine draws through a
 * transparent blitter; the tile sets and the title art are not.
 */
const GROUPS: Group[] = [
  ...SPRITE_GROUPS.map((g) => ({
    file: g.file,
    header: g.header,
    name: g.what,
    // The title and opening screens are full-page artwork, drawn
    // whole; everything else in this list is a figure or an object.
    sprite: g.file !== 'TITLE.DAT',
  })),
  ...TILESET_FILES.flatMap((file) => TILESET_GROUPS.map((g) => ({
    file,
    header: g.header,
    name: g.what,
    sprite: false,
  }))),
  // GUARD.DAT carries the ordinary guard's sprites and no palette of
  // its own: GUARD1.DAT and GUARD2.DAT are nothing but the header.
  { file: 'GUARD.DAT', header: 750, name: 'guard', sprite: true, paletteFile: 'GUARD1.DAT' },
];

const dats = new Map<string, DatFile>();
function dat(name: string): DatFile {
  let d = dats.get(name);
  if (!d) {
    d = new DatFile(new Uint8Array(readFileSync(join(GAME, name))), name);
    dats.set(name, d);
  }
  return d;
}

/** The hardware's own six-bit to eight-bit expansion. */
function dac(v: number): number {
  return (v << 2) | (v >> 4);
}

function rgbaOf(pal: Palette): Uint8Array {
  const out = new Uint8Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    out[i * 4] = dac(pal.vga[i]!.r);
    out[i * 4 + 1] = dac(pal.vga[i]!.g);
    out[i * 4 + 2] = dac(pal.vga[i]!.b);
    out[i * 4 + 3] = 255;
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

interface Pic {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

function writePng(
  path: string, pic: Pic, rgba: Uint8Array, transparent: boolean, scale = 1,
): void {
  const png = new PNG({ width: pic.width * scale, height: pic.height * scale });
  for (let y = 0; y < pic.height * scale; y++) {
    for (let x = 0; x < pic.width * scale; x++) {
      const v = pic.pixels[((y / scale) | 0) * pic.width + ((x / scale) | 0)]!;
      const c = (v & 15) * 4;
      const o = (y * pic.width * scale + x) * 4;
      png.data[o] = rgba[c]!;
      png.data[o + 1] = rgba[c + 1]!;
      png.data[o + 2] = rgba[c + 2]!;
      png.data[o + 3] = transparent && v === 0 ? 0 : 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

/** A group's images laid out on one sheet, biggest cell wins. */
function contactSheet(
  path: string, pics: readonly Pic[], rgba: Uint8Array, transparent: boolean,
): void {
  if (pics.length === 0) return;
  const cw = Math.max(...pics.map((p) => p.width)) + 4;
  const ch = Math.max(...pics.map((p) => p.height)) + 4;
  const cols = Math.min(pics.length, Math.max(1, Math.ceil(Math.sqrt(pics.length * ch / cw))));
  const rows = Math.ceil(pics.length / cols);
  const png = new PNG({ width: cols * cw, height: rows * ch });
  for (let i = 0; i < png.data.length; i += 4) {
    // A mid grey, so that both the black of the art and the hole a
    // transparent colour 0 leaves can be seen against it.
    png.data[i] = 60; png.data[i + 1] = 60; png.data[i + 2] = 72; png.data[i + 3] = 255;
  }
  pics.forEach((pic, i) => {
    const x0 = (i % cols) * cw + 2;
    const y0 = ((i / cols) | 0) * ch + 2;
    for (let y = 0; y < pic.height; y++) {
      for (let x = 0; x < pic.width; x++) {
        const v = pic.pixels[y * pic.width + x]!;
        if (transparent && v === 0) continue;
        const c = (v & 15) * 4;
        const o = ((y0 + y) * cols * cw + x0 + x) * 4;
        png.data[o] = rgba[c]!;
        png.data[o + 1] = rgba[c + 1]!;
        png.data[o + 2] = rgba[c + 2]!;
        png.data[o + 3] = 255;
      }
    }
  });
  writeFileSync(path, PNG.sync.write(png));
}

mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
let total = 0;
let skipped = 0;

for (const group of GROUPS) {
  const file = dat(group.file);
  const headerFile = group.paletteFile ? dat(group.paletteFile) : file;
  let pal: Palette;
  try {
    const raw = headerFile.get(group.header);
    if (raw.length !== PALETTE_SIZE) throw new Error(`header is ${raw.length} bytes`);
    pal = parsePalette(raw);
  } catch (err) {
    lines.push(`${group.file} ${group.header}  NO PALETTE: ${String(err)}`);
    continue;
  }
  const rgba = rgbaOf(pal);

  // The group runs from the header to the next header in the file,
  // or to the end of it. `imageCount` in the header is what the
  // engine loads; the archive sometimes holds more.
  const headers = file.entries
    .map((e) => e.id)
    .filter((id) => id !== group.header && GROUPS.some(
      (g) => g.file === group.file && g.header === id,
    ))
    .filter((id) => id > group.header)
    .sort((a, b) => a - b);
  const end = headers.length ? headers[0]! : Infinity;

  const dir = join(OUT, group.file.replace(/\.DAT$/, ''), `${group.header}-${slug(group.name)}`);
  mkdirSync(dir, { recursive: true });

  const pics: Pic[] = [];
  for (const entry of file.entries) {
    if (entry.id <= group.header || entry.id >= end) continue;
    const payload = file.get(entry.id);
    if (isEmptyPlaceholder(payload)) continue;
    if (!isImage(payload)) { skipped++; continue; }
    let decoded;
    try {
      decoded = decodeImage(payload);
    } catch {
      skipped++;
      continue;
    }
    const pic: Pic = {
      id: entry.id,
      width: decoded.width,
      height: decoded.height,
      pixels: decoded.pixels,
    };
    pics.push(pic);
    writePng(join(dir, `${String(entry.id).padStart(4, '0')}.png`), pic, rgba, group.sprite);
    total++;
  }
  contactSheet(join(dir, '_contact-sheet.png'), pics, rgba, group.sprite);
  lines.push(
    `${group.file.padEnd(13)} ${String(group.header).padStart(4)}  `
    + `${String(pics.length).padStart(3)} images  ${group.sprite ? 'sprites ' : 'opaque  '}`
    + group.name,
  );
}

const readme = `The original's graphics, decoded
================================

Every picture in Prince of Persia 1's own data files, one PNG each,
written by tools/dev/export-graphics.ts out of original/prince1.

How the original stores them, which is why they need decoding:

  * a .DAT file is an archive of numbered resources;
  * a picture is planar palette indices, packed with one of five
    schemes (raw, RLE row- or column-major, LZ row- or
    column-major), behind a six-byte header giving its size, depth
    and scheme;
  * the colours are NOT in the picture. Each group of pictures opens
    with a "shape-list header" resource holding sixteen VGA entries,
    and which header governs which picture is a table hard-coded in
    PRINCE.EXE. GUARD.DAT has no header of its own at all -- its
    palette is GUARD1.DAT's and GUARD2.DAT's.

So a folder here is one group, named <header id>-<what it is>, and
every PNG in it is coloured with that group's own palette.

  * the components are six bits, expanded the way the hardware did:
    (v << 2) | (v >> 4), so 63 is 255 and not 252;
  * colour 0 is written **transparent** for the groups the engine
    draws through a transparent blitter (the characters, the sword,
    the flames and potions, the cut-scene figures) and **opaque**
    for the ones it does not (the tile sets, the title and opening
    artwork). The table below says which each group is.
  * _contact-sheet.png in each folder is the whole group on one
    page, on a grey ground so that both the art's own black and the
    holes left by a transparent colour 0 can be seen.

Not here, because they are not in the .DAT files: the **font**,
which lives inside PRINCE.EXE (see src/render/font.ts), and the
level maps, which are tile numbers rather than pictures.

Groups
------

${lines.join('\n')}

${total} images.
`;
writeFileSync(join(OUT, 'README.txt'), readme);
console.log(readme);
console.log(`skipped ${skipped} resources that are not pictures`);
