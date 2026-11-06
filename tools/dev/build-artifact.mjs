/**
 * Bundle the page and the game's data into a self-contained folder that can
 * be published as a single shareable page.
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const out = process.argv[2];
if (!out) throw new Error('usage: build-artifact.mjs <outdir>');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/** Everything the VGA port actually reads. */
const DATA_FILES = [
  'UNCRKD.EXE', 'LEVELS.DAT', 'PRINCE.DAT', 'KID.DAT', 'TITLE.DAT',
  'VDUNGEON.DAT', 'VPALACE.DAT',
  'GUARD.DAT', 'GUARD1.DAT', 'GUARD2.DAT',
  'FAT.DAT', 'SKEL.DAT', 'VIZIER.DAT', 'SHADOW.DAT', 'PV.DAT',
];
// The artifact host serves only a fixed set of file types, and `.DAT` is not
// one of them, so the game's files travel as base64 inside one JSON file.
const bundleData = {};
for (const f of DATA_FILES) {
  bundleData[f] = readFileSync(join('original', 'prince1', f)).toString('base64');
}
writeFileSync(join(out, 'data.json'), JSON.stringify(bundleData));

execFileSync('npx', [
  'esbuild', 'web/main.ts', '--bundle', '--format=esm', '--target=es2022',
  '--minify', `--outfile=${join(out, 'game.js')}`,
], { stdio: 'inherit' });

// This host serves only a fixed set of file types and `.DAT` is not one of
// them, so the game's files travel as base64 inside one JSON file.
const dataSource = `<script type="module">
  let pack = null;
  window.__princeFetcher = async (name) => {
    pack ??= await (await fetch('./data.json')).json();
    const b64 = pack[name];
    if (!b64) throw new Error(\`no data for \${name}\`);
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  };
<\/script>`;
writeFileSync(
  join(out, 'index.html'),
  readFileSync('web/artifact.html', 'utf8').replace('<!--DATA-SOURCE-->', dataSource),
);
const bundle = readFileSync(join(out, 'game.js'), 'utf8');
console.log(`bundle ${(bundle.length / 1024).toFixed(0)} kB,`
  + ` data ${(readFileSync(join(out, 'data.json')).length / 1024).toFixed(0)} kB`);
