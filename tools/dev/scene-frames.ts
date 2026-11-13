/**
 * The port's own frames of a scene, as PNGs, to put beside a capture's.
 *
 *   npx tsx tools/dev/scene-frames.ts <title|ending|expired|N> <outdir> <from> <to>
 *
 * `pop-frames.ts` for the cutscenes. The capture's side is whatever
 * `tools/oracle/scene_frames.py` wrote.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { playScene } from './scene-common.ts';
import { assets, exe } from './scene-report.ts';
import type { SceneName } from '../../src/pop/cutscene.ts';

const which = process.argv[2] ?? 'title';
const outdir = process.argv[3] ?? '/tmp/scene';
const from = Number(process.argv[4] ?? 0);
const to = Number(process.argv[5] ?? from + 10);
const scene: SceneName = which === 'title' ? { kind: 'title' }
  : which === 'ending' ? { kind: 'ending' }
    : which === 'expired' ? { kind: 'expired' }
      : { kind: 'level', level: Number(which) };

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(body.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(body.length + 8, crc(out.subarray(4, body.length + 8)));
  return out;
};
function png(rgb: Uint8Array, w = 320, h = 200): Uint8Array {
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

mkdirSync(outdir, { recursive: true });
await playScene(assets, exe, scene, to + 1, (i, rgb) => {
  if (i >= from && i <= to) writeFileSync(join(outdir, `t${i}.png`), png(rgb));
});
console.log(`${which} ${from}..${to} -> ${outdir}`);
