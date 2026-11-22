/**
 * The tab's icon, and that it is the game's own title screen.
 *
 * The page carried `<link rel="icon" href="data:,">` -- a blank icon
 * on purpose -- for the whole life of the port, which is the kind of
 * thing nothing notices: no score can see a tab, and a page with no
 * icon looks exactly like a page whose icon failed to load.
 *
 * So this pins both halves. That the four files are what
 * `tools/dev/make-icon.ts` makes, byte for byte, out of
 * `TITLE.DAT`'s own resource 51 -- so the icon cannot drift from the
 * artwork, and a committed icon that was edited by hand fails here.
 * And that every page the player can open links them and none of
 * them is blank again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { REPO } from '../helpers/fixtures.ts';

const FILES = [
  'web/icons/icon-16.png',
  'web/icons/icon-32.png',
  'web/icons/icon-180.png',
  'favicon.ico',
];

describe('the tab icon', () => {
  it('is in the repository, at the four sizes the pages ask for', () => {
    for (const f of FILES) expect(existsSync(join(REPO, f)), f).toBe(true);
    for (const [f, n] of [['web/icons/icon-16.png', 16],
      ['web/icons/icon-32.png', 32], ['web/icons/icon-180.png', 180]] as const) {
      const p = PNG.sync.read(readFileSync(join(REPO, f)));
      expect([p.width, p.height], f).toEqual([n, n]);
    }
  });

  it('is cut out of TITLE.DAT and nothing else, byte for byte', () => {
    const before = FILES.map((f) => readFileSync(join(REPO, f)));
    execFileSync('npx', ['tsx', 'tools/dev/make-icon.ts'], { cwd: REPO });
    FILES.forEach((f, i) => {
      expect(readFileSync(join(REPO, f)).equals(before[i]!), f).toBe(true);
    });
  }, 120_000);

  it('is an icon file with a 16 and a 32 in it', () => {
    const ico = readFileSync(join(REPO, 'favicon.ico'));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // an icon, not a cursor
    expect(ico.readUInt16LE(4)).toBe(2); // two images
    expect([ico.readUInt8(6), ico.readUInt8(22)]).toEqual([16, 32]);
    for (const e of [6, 22]) {
      const at = ico.readUInt32LE(e + 12);
      const len = ico.readUInt32LE(e + 8);
      expect(at + len).toBeLessThanOrEqual(ico.length);
      // each one really is a PNG: the eight-byte signature
      expect(Array.from(ico.subarray(at, at + 8)))
        .toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('is linked by every page, and none of them is blank again', () => {
    for (const page of ['index.html', 'potion.html', 'web/index.html',
      'web/artifact.html']) {
      const html = readFileSync(join(REPO, page), 'utf8');
      expect(html, page).not.toContain('rel="icon" href="data:,"');
      expect(html, page).toMatch(/rel="icon"[^>]*icon-32\.png/);
      expect(html, page).toMatch(/rel="apple-touch-icon"[^>]*icon-180\.png/);
    }
  });

  it('shows something: the dome is not a flat square of one colour', () => {
    // A crop that missed would still be 16 by 16 and still be made of
    // the title screen's colours. What says it is the dome is that
    // the picture has range: the gold of the dome against the sky.
    const p = PNG.sync.read(readFileSync(join(REPO, 'web/icons/icon-16.png')));
    const lum: number[] = [];
    for (let i = 0; i < 16 * 16; i++) {
      lum.push(0.3 * p.data[i * 4]! + 0.6 * p.data[i * 4 + 1]! + 0.1 * p.data[i * 4 + 2]!);
    }
    const lo = Math.min(...lum);
    const hi = Math.max(...lum);
    expect(hi - lo).toBeGreaterThan(90);
    // and the brightest pixel is in the top half, where the dome is
    expect(lum.indexOf(hi) < 16 * 8).toBe(true);
  });
});
