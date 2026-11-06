/**
 * Build the page that GitHub Pages serves from the repository root.
 *
 * Unlike the single-page build, Pages will serve the game's own files as they
 * are, so the page reads them straight out of `original/prince1/`.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync('npx', [
  'esbuild', 'web/main.ts', '--bundle', '--format=esm', '--target=es2022',
  '--minify', '--outfile=game.js',
], { stdio: 'inherit' });

const dataSource = `<script type="module">
  window.__princeDataUrl = './original/prince1';
<\/script>`;

const page = readFileSync('web/artifact.html', 'utf8')
  .replace('<!--DATA-SOURCE-->', dataSource)
  // The page skeleton an artifact host adds has to be written out here.
  .replace(/^/, '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
  .replace('<header>', '</head>\n<body>\n<header>')
  + '\n</body>\n</html>\n';

writeFileSync('index.html', page);
writeFileSync('.nojekyll', '');
console.log('wrote index.html and game.js for GitHub Pages');
