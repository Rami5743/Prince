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
  .replace('<header>', '</head>\n<body>\n<header>')
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

const potionHeader = `<header>
  <h1>Prince of Persia — the potion room</h1>
  <p>The same engine, the same renderer and the same sound as the game next
     door. The only difference is one level record: a corridor with all six of
     the game's potions a step apart, because the real game has
     <strong>one</strong> feather potion, at the bottom of a shaft in level 7,
     and <strong>two</strong> upside-down ones, thirteen levels in.</p>
</header>`;

const potionPanel = `<div class="bar" id="potion-readout" style="font-variant-numeric: tabular-nums">
  <span>hit points <strong id="pl-hp">-</strong></span>
  <span>feather <strong id="pl-feather">no</strong></span>
  <span>upside down <strong id="pl-upside">no</strong></span>
  <span>room <strong id="pl-room">-</strong></span>
</div>

<footer>
  <p><strong>Walk up to a flask and press Shift to drink it.</strong> That is
     the original's own way in: <code>control_standing</code> is
     <code>if (control_shift2 == CONTROL_HELD &amp;&amp; control_shift ==
     CONTROL_HELD &amp;&amp; check_get_item()) return;</code>, and
     <code>control_shift2</code> is a latch, so the key has to go down again
     rather than be held. <strong>Ctrl+A</strong> lays them all out afresh.</p>
  <p>The corridor runs left to right, two rooms, a floor tile between each:</p>
  <ol>
    <li><strong>blue — hurt.</strong> One hit point, <code>sound_13</code>, no
        flash. It is first so that the one behind it has a flask to fill.</li>
    <li><strong>small red — heal.</strong> One hit point back,
        <code>sound_33</code>, and the screen blinks red <strong>twice</strong>.
        With a full flask it does nothing at all, which is the C and not a
        fault.</li>
    <li><strong>big red — life.</strong> <code>add_life</code>: a new flask,
        <code>sound_30</code>, red <strong>four</strong> times.</li>
    <li><strong>green — feather.</strong> <code>feather_fall()</code>: green
        <strong>three</strong> times, <code>sound_39</code>, and he falls at a
        pixel a tick instead of three for as long as that tune is in the one
        channel — eighteen and a half seconds, measured off a capture of
        <code>PRINCE.EXE</code>. Nothing else sounds while it lasts, which is
        the game: 39 is marked uninterruptible at priority nought.</li>
    <li><strong>upside-down.</strong> <code>toggle_upside()</code> and nothing
        else: no flash, no noise. Press it again to come back.</li>
    <li><strong>the one that opens the gates.</strong>
        <code>trigger_button(0, 0, -1)</code>, no flash and no noise. There are
        no gates in this corridor, so it is here to be heard not to be
        seen.</li>
  </ol>
  <p>Everything else the game does works here as well — the cheats, the clock,
     the pause. <strong>Shift+W</strong> is the feather without the flask, and
     <strong>Shift+I</strong> turns the screen over without one.</p>
</footer>

<script type="module">
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  setInterval(() => {
    const s = window.__princeState?.();
    if (!s) return;
    set('pl-hp', \`\${s.hitPoints} of \${s.maxHitPoints}\`);
    set('pl-feather', s.featherFall ? 'yes' : 'no');
    set('pl-upside', s.upsideDown ? 'yes' : 'no');
    set('pl-room', String(s.room));
  }, 100);
<\/script>`;

const potionBody = shell
  .replace('<!--DATA-SOURCE-->', potionSource)
  .replace(/<header>[\s\S]*?<\/header>/, potionHeader)
  .replace(/<footer>[\s\S]*?<\/footer>/, potionPanel)
  .replace('<title>Prince of Persia, Reconstructed</title>',
           '<title>Prince of Persia — the potion room</title>');
if (potionBody === shell) throw new Error('potion.html: nothing was replaced');
writeFileSync('potion.html', wrap(potionBody));

writeFileSync('.nojekyll', '');
console.log('wrote index.html, potion.html and game.js for GitHub Pages');
