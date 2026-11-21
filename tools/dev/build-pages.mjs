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

const shell = readFileSync('web/artifact.html', 'utf8');

/** The skeleton an artifact host adds, which Pages does not. */
const wrap = (body) => body
  .replace(/^/, '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
  .replace('<aside class="margin" id="margin-title">',
           '</head>\n<body>\n<aside class="margin" id="margin-title">')
  + '\n</body>\n</html>\n';

writeFileSync('index.html', wrap(shell.replace('<!--DATA-SOURCE-->', dataSource)));

/**
 * `potion.html`: the same bundle, the same engine, one level record.
 *
 * The page sets `window.__princePotionLevel` before `game.js` runs,
 * and `web/main.ts` then fetches `LEVELS.DAT` through
 * `levelsDatWithPotionLevel` and opens on that level instead of on
 * the title. Nothing is forked: it is this build's own `game.js`,
 * and `original/prince1/LEVELS.DAT` is not touched -- the swap is in
 * the copy the page fetched. The level itself, and a note on every
 * tile of it, is `src/dat/potion-level.ts`.
 */
const potionSource = `<script type="module">
  window.__princeDataUrl = './original/prince1';
  window.__princePotionLevel = true;
<\/script>`;

/**
 * The potion page's extra panel: a skeleton, with no words in it.
 *
 * The words it used to carry were written here, in the script that
 * *generates* the page, and so were the one piece of the page that
 * stayed English when the language changed -- nothing relabelled
 * them, because `Chrome` only knows about `web/strings.ts`. The ids
 * are what `Chrome.buildPotion` fills, and the readout is its own
 * timer rather than an inline script, so `yes`/`no` and `3 of 3`
 * change language with everything else.
 */
const potionPanel = `<details class="panel" id="panel-potion" open>
  <summary id="potion-label"></summary>
  <div class="panel-body" style="font-variant-numeric: tabular-nums">
    <div><span id="pl-label-hp"></span> <strong id="pl-hp">-</strong></div>
    <div><span id="pl-label-feather"></span> <strong id="pl-feather">-</strong></div>
    <div><span id="pl-label-upside"></span> <strong id="pl-upside">-</strong></div>
    <div><span id="pl-label-room"></span> <strong id="pl-room">-</strong></div>
    <div id="pl-how" style="color: var(--dim); font-size: 11px; line-height: 1.4"></div>
  </div>
</details>`;

const potionBody = shell
  .replace('<!--DATA-SOURCE-->', potionSource)
  .replace('<!--EXTRA-PANEL-->', potionPanel)
  .replace('<title>Prince of Persia, Reconstructed</title>',
           '<title>Prince of Persia — the potion room</title>');
if (potionBody === shell) throw new Error('potion.html: nothing was replaced');
writeFileSync('potion.html', wrap(potionBody));

/**
 * `web/index.html`: the same page, for development and for the tests.
 *
 * It is **generated from the same shell** rather than written by hand,
 * which it used to be. Two pages drift: the hand-written one still had
 * the aspect menu and the two recording buttons months after the real
 * page had moved on, and every browser test in the suite was driving
 * that page and not the one the player opens. It loads the unminified
 * `main.js` beside it and reads the game's files from `../original`,
 * which is `main.ts`'s own default, so no data source is written in.
 */
writeFileSync('web/index.html', wrap(shell
  .replace('<!--DATA-SOURCE-->', '')
  .replace('<script type="module" src="./game.js"></script>',
           '<script type="module" src="./main.js"></script>')));

writeFileSync('.nojekyll', '');
console.log('wrote index.html, potion.html and game.js for GitHub Pages');
