/**
 * Can a content script give a note a bundled font, on a page whose CSP forbids fetching one?
 *
 * This is the last unanswered question in the way of shipping Persian faces, and it has three
 * parts, none of which can be reasoned out from a spec:
 *
 *   1. A `@font-face` inside a shadow root is IGNORED -- font faces are document-scoped, not
 *      tree-scoped. So the face has to be registered on the page's own document, from the
 *      content script, which means `document.fonts.add()` across the Xray boundary. Firefox
 *      may or may not allow a `FontFace` built in the content script's compartment to be
 *      added to the page's `FontFaceSet`.
 *   2. `url(moz-extension://...)` in a stylesheet is fetched with the PAGE's principal, so a
 *      site with `font-src 'self'` blocks it -- exactly the way a site's CSP blocks a content
 *      script's `<img src>`, which is why pasted images are painted to a canvas instead. The
 *      `FontFace` constructor also takes an ArrayBuffer, and no fetch happens at all for one,
 *      so CSP should have nothing to say. "Should" is the word this file exists to remove.
 *   3. Which SUBSETS a Persian note actually needs. Fontsource ships Vazirmatn split into
 *      `arabic` and `latin` files with no `unicode-range` in its CSS, so whether the arabic
 *      file alone can render "1. اول" -- Latin digits, Arabic letters -- is a question about
 *      the font's cmap, and the honest way to answer it is to render both and measure.
 *
 * The measurement is text width. A font that is not being used leaves the width at whatever
 * the fallback gives, and the fallback here is `monospace` -- deliberately, because a
 * proportional font's width is very different from a mono one and the difference cannot be
 * mistaken for noise.
 *
 * THE CONTROL is a family name that was never registered. Its width must not move. If it does,
 * the harness is measuring layout jitter rather than font selection, and every other line is
 * worthless.
 *
 *   pnpm serve
 *   node spikes/firefox-fonts.mjs
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builder } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const FONTS = 'node_modules/@fontsource/vazirmatn/files';
const SUBSETS = {
  arabic: `${FONTS}/vazirmatn-arabic-400-normal.woff2`,
  latin: `${FONTS}/vazirmatn-latin-400-normal.woff2`,
};

/**
 * Deliberately without spaces in the two single-script samples.
 *
 * The first version of this used "Handgloves 123" and "یادداشت فارسی", and reported that the
 * arabic-only subset changed the width of the LATIN sample and vice versa -- which would mean
 * both files carry both scripts, at 21kB and 16kB, which cannot be true. The space was doing
 * it: a face that supplies only the space glyph still changes the total advance, even when
 * every letter falls back. So the two diagnostic samples are single-script and unspaced, and
 * `mixed` is kept as the realistic case.
 */
const SAMPLES = {
  latinOnly: 'Handgloves',
  arabicOnly: 'یادداشت',
  mixed: '1. اول dowry',
};

const dir = mkdtempSync(join(tmpdir(), 'cn-fonts-'));

const encoded = Object.fromEntries(
  Object.entries(SUBSETS).map(([name, path]) => [name, readFileSync(path).toString('base64')]),
);

writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 2,
      name: 'font probe',
      version: '1.0',
      browser_specific_settings: { gecko: { id: 'font-probe@chevalet.test' } },
      permissions: ['<all_urls>'],
      content_scripts: [{ matches: ['<all_urls>'], js: ['cs.js'], run_at: 'document_idle' }],
    },
    null,
    2,
  ),
);

/*
 * The whole probe runs in the content script, because that is the compartment under test. The
 * bytes are inlined as base64 rather than fetched from the extension, so the only thing this
 * measures is the FontFace path -- a failure cannot be blamed on messaging or on a missing
 * web_accessible_resources entry.
 */
writeFileSync(
  join(dir, 'cs.js'),
  `
const B64 = ${JSON.stringify(encoded)};
const SAMPLES = ${JSON.stringify(SAMPLES)};

function bytes(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/** Width of one sample in one family, measured inside a CLOSED shadow root. */
function measure(root, family, text) {
  const span = root.querySelector('span.m');
  span.style.fontFamily = family ? family + ', monospace' : 'monospace';
  span.textContent = text;
  return span.getBoundingClientRect().width;
}

window.__fontProbe = async () => {
  const out = { added: {}, errors: [], widths: {} };

  // The same shape the real note uses: a closed shadow root on a custom element.
  const host = document.createElement('cn-font-probe');
  host.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:32px';
  const root = host.attachShadow({ mode: 'closed' });
  root.append(document.createElement('span'));
  root.querySelector('span').className = 'm';
  document.documentElement.append(host);

  // Baseline: monospace only, before anything is registered.
  for (const [name, text] of Object.entries(SAMPLES)) {
    out.widths['base-' + name] = measure(root, null, text);
  }

  // THE CONTROL: a family nobody has registered. Must not move the width.
  for (const [name, text] of Object.entries(SAMPLES)) {
    out.widths['control-' + name] = measure(root, 'cnNeverRegistered', text);
  }

  for (const [subset, b64] of Object.entries(B64)) {
    const family = 'cnProbe-' + subset;
    try {
      const face = new FontFace(family, bytes(b64));
      await face.load();
      document.fonts.add(face);
      out.added[subset] = true;
    } catch (e) {
      out.added[subset] = false;
      out.errors.push(subset + ': ' + String(e));
      continue;
    }
    for (const [name, text] of Object.entries(SAMPLES)) {
      out.widths[subset + '-' + name] = measure(root, family, text);
    }
  }

  // And both together, arabic first, which is the stack a real note would use.
  if (out.added.arabic && out.added.latin) {
    for (const [name, text] of Object.entries(SAMPLES)) {
      out.widths['both-' + name] = measure(root, 'cnProbe-arabic, cnProbe-latin', text);
    }
  }

  host.remove();
  return JSON.stringify(out);
};

document.addEventListener('cn-run-font-probe', () => {
  window.__fontProbe().then((json) => {
    document.documentElement.dataset.cnFontProbe = json;
  }, (e) => {
    document.documentElement.dataset.cnFontProbe = JSON.stringify({ fatal: String(e) });
  });
});
document.documentElement.dataset.cnFontsReady = '1';
`,
);

// --------------------------------------------------------------------- run it

/**
 * Two pages: an ordinary one, and one served with a CSP that forbids fonts outright.
 *
 * The second is the case that decides the design. If `font-src 'none'` stops the note getting
 * its font, then bundling is only half a feature -- it would work everywhere except the strict
 * sites where someone is most likely to be taking notes.
 */
const PAGES = {
  ordinary: 'http://127.0.0.1:8731/spikes/playground/',
  'font-src-none': 'http://127.0.0.1:8731/__dev/csp-fonts',
};

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1200', '-height', '900');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
try {
  await driver.installAddon(dir, true);
  console.log(`\n${await driver.executeScript('return navigator.userAgent')}`);
  console.log(
    `arabic subset ${readFileSync(SUBSETS.arabic).length} bytes, ` +
      `latin ${readFileSync(SUBSETS.latin).length} bytes\n`,
  );

  for (const [label, url] of Object.entries(PAGES)) {
    await driver.get(url);
    await driver.sleep(600);
    const ready = await driver.executeScript(
      "return document.documentElement.dataset.cnFontsReady || 'MISSING'",
    );
    if (ready !== '1') {
      console.log(`${label}: the probe never loaded (${ready}) -- nothing measured`);
      continue;
    }

    await driver.executeScript("document.dispatchEvent(new Event('cn-run-font-probe'))");
    let json = null;
    for (let i = 0; i < 40 && !json; i++) {
      await driver.sleep(150);
      json = await driver.executeScript(
        'return document.documentElement.dataset.cnFontProbe || null',
      );
    }
    if (!json) {
      console.log(`${label}: the probe never answered`);
      continue;
    }

    const r = JSON.parse(json);
    console.log(`--- ${label}`);
    if (r.fatal) {
      console.log(`    FATAL ${r.fatal}`);
      continue;
    }
    console.log(
      `    document.fonts.add: arabic=${r.added.arabic} latin=${r.added.latin}` +
        (r.errors.length ? `  errors: ${r.errors.join(' | ')}` : ''),
    );

    const w = r.widths;
    // The numbers, not a verdict. A boolean hid the reason the first run was wrong.
    const px = (k) => (w[k] === undefined ? '   --  ' : w[k].toFixed(1).padStart(7));
    console.log('              fallback   arabic    latin     both');
    for (const sample of Object.keys(SAMPLES)) {
      console.log(
        `    ${sample.padEnd(10)}${px(`base-${sample}`)}  ${px(`arabic-${sample}`)}  ` +
          `${px(`latin-${sample}`)}  ${px(`both-${sample}`)}` +
          (Math.abs(w[`control-${sample}`] - w[`base-${sample}`]) > 0.5 ? '   CONTROL MOVED' : ''),
      );
    }
    const controlMoved = Object.keys(SAMPLES).some(
      (s) => Math.abs(w[`control-${s}`] - w[`base-${s}`]) > 0.5,
    );
    if (controlMoved) {
      console.log('    USELESS: the control moved. This is measuring jitter, not font choice.');
    }
  }
  console.log('');
} finally {
  await driver.quit();
}
