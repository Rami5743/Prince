/**
 * The Prince, traced, put beside the Prince as the original draws him.
 *
 *   npx tsx tools/dev/vector-sheets.ts <outdir> [--scale 8] [--per 24]
 *          [--sharp] [--exact]
 *
 * Two things, and the second is the one that decides whether the trace
 * is right at all:
 *
 * * **the sheets**, every sprite at `--scale` with the original's own
 *   pixels on the left and the outline on the right, to be looked at;
 * * **`--exact`**, which rasterizes the trace at the sprite's **own**
 *   size and counts the pixels that are not the index they started as.
 *   With `--sharp` -- the staircase, no curves -- that count has to be
 *   nought on every sprite, or the tracer has lost something or left a
 *   seam, and no amount of looking at a smoothed picture would say so.
 *
 * Chromium is the rasterizer because Chromium is what the page draws
 * with: a trace that looks right in another rasterizer and wrong in
 * the browser is of no use here.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { DatFile } from '../../src/dat/container.ts';
import { parsePalette } from '../../src/dat/palette.ts';
import { decodeImage, isImage, isEmptyPlaceholder } from '../../src/dat/image.ts';
import { vectorize, type VectorSprite, type VectorOptions } from '../../src/render/vectorize.ts';

/**
 * The settings put side by side on a sheet, so that a choice between
 * them is made by looking rather than by argument. The first column is
 * always the original's own pixels.
 */
const VARIANTS: readonly (readonly [string, VectorOptions])[] = [
  ['traced', { transparent: 0 }],
];

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME = join(REPO, 'original', 'prince1');

const args = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(args[i + 1]);
};
const OUT = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
  ?? join(REPO, 'vector-sheets');
const SCALE = flag('scale', 8);
const PER = flag('per', 24);
const SHARP = args.includes('--sharp');
const idsAt = args.indexOf('--ids');
const IDS = idsAt < 0 ? null : new Set(args[idsAt + 1]!.split(',').map(Number));
const EXACT = args.includes('--exact');

/** The hardware's own six-bit to eight-bit expansion. */
const dac = (v: number): number => (v << 2) | (v >> 4);

interface Shot {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly vecs: readonly VectorSprite[];
}

const kid = new DatFile(new Uint8Array(readFileSync(join(GAME, 'KID.DAT'))), 'KID.DAT');
const pal = parsePalette(kid.get(400));
const rgb = [...Array(16).keys()].map((i) => {
  const e = pal.vga[i]!;
  return [dac(e.r), dac(e.g), dac(e.b)] as const;
});

/** The sprite's own bank, as RGBA, for the denoise's colour distance. */
const paletteRgba = new Uint8Array(256 * 4);
for (let i = 0; i < 16; i++) {
  const [r, g, b] = rgb[i]!;
  paletteRgba[i * 4] = r;
  paletteRgba[i * 4 + 1] = g;
  paletteRgba[i * 4 + 2] = b;
  paletteRgba[i * 4 + 3] = 255;
}

const shots: Shot[] = [];
for (const entry of kid.entries.slice().sort((a, b) => a.id - b.id)) {
  if (entry.id <= 400) continue;
  if (IDS && !IDS.has(entry.id)) continue;
  const payload = kid.get(entry.id);
  if (isEmptyPlaceholder(payload) || payload.length === 100 || !isImage(payload)) continue;
  let img;
  try { img = decodeImage(payload); } catch { continue; }
  shots.push({
    id: entry.id,
    width: img.width,
    height: img.height,
    pixels: img.pixels,
    vecs: SHARP
      ? [vectorize(img.pixels, img.width, img.height, { transparent: 0, sharp: true })]
      : VARIANTS.map(([, o]) => vectorize(
        img.pixels, img.width, img.height, { ...o, palette: paletteRgba },
      )),
  });
}
console.log(`${shots.length} sprites, scale ${SCALE}${SHARP ? ', sharp' : ''}`);

const svgOf = (s: Shot, scale: number, which = 0): string => {
  const body = s.vecs[which]!.layers.map((l) => {
    const [r, g, b] = rgb[l.index & 15]!;
    return `<path d="${l.path}" fill="rgb(${r},${g},${b})"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width * scale}"`
    + ` height="${s.height * scale}" viewBox="0 0 ${s.width} ${s.height}"`
    + ` shape-rendering="geometricPrecision">${body}</svg>`;
};

mkdirSync(OUT, { recursive: true });

const preinstalled = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(preinstalled)
    ? { executablePath: preinstalled, args: ['--no-sandbox'] }
    : {},
);

if (EXACT) {
  // Rasterize each trace at the sprite's own size and count the pixels
  // that came back a different index.
  const page = await browser.newPage();
  const jobs = shots.map((s) => ({
    id: s.id, w: s.width, h: s.height, svg: svgOf(s, 1),
    want: [...s.pixels],
    // The colour each index must come back as, so the check is of the
    // index and not merely of where the ink is.
    rgb: rgb.map((c) => [...c]),
  }));
  const bad = await page.evaluate(async (list) => {
    const out: { id: number; wrong: number; of: number; worst: string }[] = [];
    for (const job of list) {
      const canvas = document.createElement('canvas');
      canvas.width = job.w; canvas.height = job.h;
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      const url = `data:image/svg+xml;base64,${btoa(job.svg)}`;
      await new Promise<void>((ok, no) => {
        img.onload = () => ok(); img.onerror = () => no(new Error(`${job.id}`));
        img.src = url;
      });
      ctx.clearRect(0, 0, job.w, job.h);
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, job.w, job.h).data;
      let wrong = 0; let worst = '';
      for (let i = 0; i < job.want.length; i++) {
        const want = job.want[i]!;
        const a = d[i * 4 + 3]!;
        if (want === 0) {
          if (a > 128) { wrong++; if (!worst) worst = `${i} should be clear`; }
          continue;
        }
        if (a < 128) {
          wrong++;
          if (!worst) worst = `${i} is clear, wanted ${want}`;
          continue;
        }
        const c = job.rgb[want & 15]!;
        const off = Math.abs(d[i * 4]! - c[0]!) + Math.abs(d[i * 4 + 1]! - c[1]!)
          + Math.abs(d[i * 4 + 2]! - c[2]!);
        if (off > 12) {
          wrong++;
          if (!worst) {
            worst = `${i} is ${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`
              + ` wanted index ${want} = ${c.join()}`;
          }
        }
      }
      out.push({ id: job.id, wrong, of: job.want.length, worst });
    }
    return out;
  }, jobs);
  let total = 0;
  for (const b of bad) {
    total += b.wrong;
    if (b.wrong > 0) console.log(`  ${b.id}  ${b.wrong} of ${b.of}   ${b.worst}`);
  }
  console.log(`coverage: ${total} pixels wrong over ${shots.length} sprites`);
}

// The sheets.
let sheet = 0;
for (let i = 0; i < shots.length; i += PER) {
  const group = shots.slice(i, i + PER);
  const cells = group.map((s) => {
    const w = s.width * SCALE; const h = s.height * SCALE;
    const png = pngOf(s, SCALE);
    return `<div class="cell"><div class="id">${s.id}</div>`
      + `<div class="pair">`
      + `<img class="orig" width="${w}" height="${h}" src="${png}">`
      + s.vecs.map((_, k) => `<span class="vec">${svgOf(s, SCALE, k)}</span>`).join('')
      + `</div></div>`;
  }).join('');
  const heads = SHARP ? '' : `<div class="head">original | ${
    VARIANTS.map(([n]) => n).join(' | ')}</div>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; background: #3c3c48; font: 11px monospace; color: #cfc8b8; }
    .wrap { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; padding: 10px; }
    .cell { background: #30303a; padding: 4px; }
    .id { text-align: center; color: #c8a24a; }
    .head { color: #9a93a8; text-align: center; padding: 2px 0 4px; }
    .pair { display: flex; gap: 6px; align-items: flex-start; }
    .orig { image-rendering: pixelated; }
  </style>${heads}<div class="wrap">${cells}</div>`;
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('body');
  await el!.screenshot({ path: join(OUT, `sheet-${String(sheet).padStart(2, '0')}.png`) });
  await page.close();
  sheet++;
}
console.log(`wrote ${sheet} sheets to ${OUT}`);
await browser.close();

/** The original's own pixels as a data URL, alpha and all. */
function pngOf(s: Shot, scale: number): string {
  void scale;
  const png = new PNG({ width: s.width, height: s.height });
  for (let i = 0; i < s.width * s.height; i++) {
    const v = s.pixels[i]!;
    const [r, g, b] = rgb[v & 15]!;
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = v === 0 ? 0 : 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}
