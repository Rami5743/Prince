/**
 * One room of one level, as `src/pop` draws it, written out as a PNG.
 *
 *   npx tsx tools/dev/pop-room.ts <level> <room> <out.png> [ticks]
 *   npx tsx tools/dev/pop-room.ts --find <tile-name>
 *
 * `pop-frames.ts` needs a recording and `scene-frames.ts` is for the
 * cutscenes; this is for the things that are in a room and that no
 * recording reaches -- the mirror of level 4, the skeleton of level
 * 3, the shadow of 5, 6 and 12, Jaffar, the fat guard, each kind of
 * potion. `showRoom` is `check_the_end`'s own path, so a room drawn
 * here raises whatever that room raises: the shadow, the guard, the
 * chompers, the falling floors.
 *
 * It exists because of the one bug a picture found and no number
 * could: `blitters_3_xor` XORed the sprite's transparent pixels and
 * put a black box round the shadow. The score did not move by a tick
 * and the box is plain to see. So: draw it and look at it.
 *
 * `--find` answers the other half -- which room a thing is in --
 * by walking every tile of every level for a tile id:
 *
 *   npx tsx tools/dev/pop-room.ts --find mirror
 *   level  4 room  4  at row 1 column 4
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Assets } from '../../src/render/assets.ts';
import { PopGame } from '../../src/pop/game.ts';
import { tiles } from '../../src/pop/types.ts';
import { g } from '../../src/pop/state.ts';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAME_DIR = join(REPO, 'original', 'prince1');
const assets = new Assets(
  async (n: string) => new Uint8Array(readFileSync(join(GAME_DIR, n))));
const exe = new Uint8Array(readFileSync(join(GAME_DIR, 'UNCRKD.EXE')));

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
  const v = new DataView(out.buffer);
  v.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  v.setUint32(body.length + 8, crc(out.subarray(4, body.length + 8)));
  return out;
};
/** A 320x200 RGB buffer as a PNG, doubled so that it is easy to look at. */
function png(rgb: Uint8Array, w = 320, h = 200, scale = 2): Uint8Array {
  const raw = new Uint8Array((w * scale * 3 + 1) * h * scale);
  let p = 0;
  for (let y = 0; y < h * scale; y++) {
    raw[p++] = 0;
    for (let x = 0; x < w * scale; x++) {
      const s = ((y / scale | 0) * w + (x / scale | 0)) * 3;
      raw[p++] = rgb[s]; raw[p++] = rgb[s + 1]; raw[p++] = rgb[s + 2];
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w * scale); dv.setUint32(4, h * scale);
  ihdr[8] = 8; ihdr[9] = 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of parts) { out.set(a, at); at += a.length; }
  return out;
}

const args = process.argv.slice(2);

if (args[0] === '--find') {
  const want = args[1] ?? '';
  const id = Object.entries(tiles).find(
    ([name]) => name === want || name.replace(/^tiles_\d+_/, '') === want,
  )?.[1];
  if (id === undefined) {
    throw new Error(`no such tile: ${want}; try ${Object.keys(tiles).join(', ')}`);
  }
  for (let level = 1; level <= 14; level++) {
    await PopGame.start(assets, exe, level, {});
    for (let room = 1; room <= 24; room++) {
      for (let pos = 0; pos < 30; pos++) {
        // `level.fg` is the tile grid, 24 rooms of 30, masked to 0x1f.
        const t = g.level.fg[(room - 1) * 30 + pos] & 0x1f;
        if (t === id) {
          console.log(`level ${String(level).padStart(2)} room ${String(room).padStart(2)}`
            + `  at row ${pos / 10 | 0} column ${pos % 10}`);
        }
      }
    }
  }
} else {
  const level = Number(args[0] ?? 1);
  const room = Number(args[1] ?? 1);
  const out = args[2] ?? '/tmp/pop-room.png';
  const ticks = Number(args[3] ?? 0);
  const game = await PopGame.start(assets, exe, level, {});
  for (let t = 0; t < ticks; t++) {
    game.step({ x: 0, y: 0, shift: false });
    game.render();
  }
  game.showRoom(room);
  const rgb = game.render().toRgb(game.scene.screenPalette.toRgba());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png(rgb));
  console.log(`level ${level} room ${room} after ${ticks} ticks -> ${out}`);
}
