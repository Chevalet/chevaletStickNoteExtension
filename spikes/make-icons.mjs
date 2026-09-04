/**
 * Rasterise assets/logo.svg into every icon size the extension and the store need.
 *
 * Reproducible on purpose: the icons used to be produced by hand through a browser page and a
 * dev-server endpoint, which meant nobody could tell whether the PNGs in the repo still matched
 * the SVG. This reads the one logo file, draws it at each size in a real Firefox, and writes
 * the results. Run it whenever the logo changes; commit what it produces.
 *
 *   node spikes/make-icons.mjs
 *
 * Firefox rather than a node rasteriser because it is already a devDependency for the
 * real-browser spikes, it needs no native build, and it renders the SVG with the same engine
 * the extension is for.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { Builder } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

/** Toolbar and manifest sizes, then the two the store listing wants. */
const SIZES = [16, 24, 32, 48, 64, 96, 128, 256, 512];

const svg = readFileSync('assets/logo.svg', 'utf8');

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><title>rasterise</title>
<body style="margin:0;background:#fff">
<script>
const SVG = ${JSON.stringify(svg)};
window.__render = async (size) => {
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(SVG);
  const img = new Image(size, size);
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('svg did not load')); img.src = url; });
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  // Transparent ground: the icon sits on the browser's own chrome, whatever colour that is.
  g.clearRect(0, 0, size, size);
  g.drawImage(img, 0, 0, size, size);
  return c.toDataURL('image/png').split(',')[1];
};
</script>`)}`;

const options = new Options();
options.addArguments('-headless');
// Draw at 1x so the sizes mean what they say.
options.setPreference('layout.css.devPixelsPerPx', '1.0');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

try {
  await driver.get(PAGE);
  console.log(`\nrasterising assets/logo.svg (${svg.length} bytes of source)\n`);

  for (const size of SIZES) {
    const b64 = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
       window.__render(arguments[0]).then(done, (e) => done('ERROR: ' + e.message));`,
      size,
    );
    if (typeof b64 !== 'string' || b64.startsWith('ERROR')) {
      throw new Error(`size ${size}: ${b64}`);
    }
    const buf = Buffer.from(b64, 'base64');
    const file = `assets/icon-${size}.png`;
    writeFileSync(file, buf);
    console.log(`  ${String(size).padStart(3)}px  ${String(buf.length).padStart(7)} bytes  ${file}`);
  }

  console.log('\ndone. Commit the PNGs alongside the SVG so the two cannot drift apart.');
} finally {
  await driver.quit();
}
