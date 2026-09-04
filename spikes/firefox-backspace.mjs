/**
 * The experiment that could not be run any other way.
 *
 * Backspace not working inside a note survived three fixes, because every instrument available
 * was wrong for the job: the in-app browser is Blink, and injected key events carry no physical
 * `code`, so the browser delivers them as events and performs no editing at all. Under that
 * kind of test every contenteditable looks broken and every fix looks plausible.
 *
 * geckodriver drives the machine's real Firefox and `sendKeys` produces real key events through
 * Gecko's own pipeline. This builds a note's exact structure -- closed shadow root,
 * `all: initial` host, `pointer-events: none`, `contain: style`,
 * `contenteditable="plaintext-only"` -- and varies ONE thing at a time to find which one kills
 * Backspace.
 *
 * Playwright's own Firefox was tried first and will not start on this machine ("side-by-side
 * configuration is incorrect" -- it wants the MSVC redistributable). geckodriver needs no
 * system install and, better, tests the Firefox actually in use.
 *
 *   node spikes/firefox-backspace.mjs
 */

import { Builder, By, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const VARIANTS = [
  { id: 'A', shadow: 'closed', hostCss: true, ce: 'plaintext-only', containKeys: true },
  { id: 'B', shadow: 'closed', hostCss: true, ce: 'plaintext-only', containKeys: false },
  { id: 'C', shadow: 'closed', hostCss: false, ce: 'plaintext-only', containKeys: false },
  { id: 'D', shadow: 'closed', hostCss: true, ce: 'true', containKeys: false },
  { id: 'E', shadow: 'open', hostCss: true, ce: 'plaintext-only', containKeys: false },
  { id: 'F', shadow: 'none', hostCss: false, ce: 'plaintext-only', containKeys: false },
  {
    id: 'G',
    shadow: 'closed',
    hostCss: true,
    ce: 'plaintext-only',
    containKeys: false,
    deep: true,
  },
];

const LABELS = {
  A: 'closed root, host CSS, plaintext-only, KEYS CONTAINED  (0.0.2 and earlier)',
  B: 'closed root, host CSS, plaintext-only, keys free        (0.0.3)',
  C: 'closed root, NO host CSS, plaintext-only, keys free',
  D: 'closed root, host CSS, contenteditable=true, keys free',
  E: 'OPEN root, host CSS, plaintext-only, keys free          (the dev harness)',
  F: 'no shadow root at all, plaintext-only                   (baseline)',
  G: 'closed root, host CSS, plaintext-only, keys free, nested 4 deep like the real note',
};

const PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><title>gecko backspace probe</title>
<style>
  body { font: 13px/1.5 ui-monospace, monospace; margin: 12px; background: #f4efe2; color: #14110e; }
  .case { margin: 0 0 8px; }
  .ed { font: 14px/1.5 monospace; padding: 5px; min-height: 18px;
        border: 2px solid #14110e; background: #ffe94a; color: #14110e; }
</style>
<div id="cases"></div>
<script>
const VARIANTS = ${JSON.stringify(VARIANTS)};
const LABELS = ${JSON.stringify(LABELS)};
const CONTAINED = ['pointerdown','pointerup','mousedown','mouseup','click','dblclick',
  'keydown','keyup','keypress','input','beforeinput','compositionstart','compositionend'];
const POINTER_ONLY = CONTAINED.slice(0, 6);
const SEED = 'abcdef';
window.__eds = {};
window.__inputs = {};

for (const v of VARIANTS) {
  const wrap = document.createElement('div');
  wrap.className = 'case';
  const h = document.createElement('div');
  h.textContent = v.id + ' — ' + LABELS[v.id];
  wrap.append(h);

  let mount = wrap;
  let host = null;
  if (v.shadow !== 'none') {
    host = document.createElement('div');
    if (v.hostCss) host.style.cssText = 'all: initial; pointer-events: none; contain: style; display: block;';
    wrap.append(host);
    mount = host.attachShadow({ mode: v.shadow });
  }
  if (v.deep) {
    for (const cls of ['lyr','note','tilt','card','face']) {
      const d = document.createElement('div');
      d.className = cls;
      mount.append(d);
      mount = d;
    }
  }
  const ed = document.createElement('div');
  ed.className = 'ed';
  ed.setAttribute('contenteditable', v.ce);
  if (ed.contentEditable !== v.ce) ed.setAttribute('contenteditable', 'true');
  ed.style.pointerEvents = 'auto';
  ed.textContent = SEED;
  mount.append(ed);

  if (host) {
    const stop = (e) => e.stopPropagation();
    for (const t of (v.containKeys ? CONTAINED : POINTER_ONLY)) host.addEventListener(t, stop);
  }

  window.__inputs[v.id] = [];
  ed.addEventListener('input', (e) => window.__inputs[v.id].push(e.inputType || '?'));
  window.__eds[v.id] = ed;
  document.getElementById('cases').append(wrap);
}

// The page script owns every root, so closed ones are still reachable from here.
window.__spot = (id) => { const r = window.__eds[id].getBoundingClientRect();
  return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; };
window.__read = (id) => ({ text: window.__eds[id].textContent,
  inputs: window.__inputs[id], ce: window.__eds[id].contentEditable });
window.__focusEnd = (id) => {
  const ed = window.__eds[id];
  ed.focus();
  const root = ed.getRootNode();
  const sel = (root.getSelection && root.getSelection()) || document.getSelection();
  if (!sel) return 'no-selection-api';
  try {
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) { return 'threw:' + e.name; }
  const a = sel.anchorNode;
  return a ? (ed.contains(a) ? 'caret-in-body@' + sel.anchorOffset : 'caret-outside:' + a.nodeName) : 'no-anchor';
};
window.__reset = () => { for (const id of Object.keys(window.__eds)) {
  window.__eds[id].textContent = SEED; window.__inputs[id] = []; } };
window.__caps = () => ({
  ua: navigator.userAgent,
  shadowGetSelection: typeof document.createElement('div').attachShadow({mode:'closed'}).getSelection === 'function',
  caretPositionFromPoint: typeof document.caretPositionFromPoint === 'function',
  caretRangeFromPoint: typeof document.caretRangeFromPoint === 'function',
  plaintextOnly: (() => { const d = document.createElement('div');
    d.setAttribute('contenteditable','plaintext-only'); return d.contentEditable === 'plaintext-only'; })(),
});
</script>`)}`;

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

try {
  await driver.get(PAGE);
  const body = await driver.findElement(By.css('body'));

  const caps = await driver.executeScript('return window.__caps()');
  console.log('\n=== the Firefox actually being tested ===');
  for (const [k, v] of Object.entries(caps)) console.log(`  ${k}: ${v}`);

  console.log('\n=== real Backspace ===');
  const results = [];
  for (const v of VARIANTS) {
    // Focus and put the caret at the end from inside the page, then send a REAL key.
    const caret = await driver.executeScript('return window.__focusEnd(arguments[0])', v.id);
    const before = (await driver.executeScript('return window.__read(arguments[0])', v.id)).text;
    await body.sendKeys(Key.BACK_SPACE);
    await driver.sleep(120);
    const after = await driver.executeScript('return window.__read(arguments[0])', v.id);

    const worked = after.text !== before;
    results.push({ id: v.id, worked, caret, inputs: after.inputs });
    console.log(
      `  ${v.id}  ${worked ? 'DELETED ' : 'NOTHING '} ` +
        `${JSON.stringify(before)} -> ${JSON.stringify(after.text)}  ` +
        `input=[${after.inputs.join(',')}]  ce=${after.ce}  ${caret}`,
    );
  }

  console.log('\n=== typing, for comparison ===');
  await driver.executeScript('window.__reset()');
  for (const v of VARIANTS) {
    await driver.executeScript('return window.__focusEnd(arguments[0])', v.id);
    await body.sendKeys('XY');
    await driver.sleep(80);
    const after = await driver.executeScript('return window.__read(arguments[0])', v.id);
    console.log(
      `  ${v.id}  typed -> ${JSON.stringify(after.text)}  input=[${after.inputs.join(',')}]`,
    );
  }

  console.log('\n=== verdict ===');
  const dead = results.filter((r) => !r.worked).map((r) => r.id);
  const alive = results.filter((r) => r.worked).map((r) => r.id);
  console.log(`  works in: ${alive.join(', ') || 'NONE'}`);
  console.log(`  dead in:  ${dead.join(', ') || 'none'}`);
  if (dead.includes('A') && alive.includes('B')) {
    console.log('  => Containing keyboard events at the host was the cause; 0.0.3 fixes it.');
  } else if (dead.length === 0) {
    console.log('  => Nothing here reproduces it. The cause is elsewhere in the note.');
  } else if (dead.includes('A') && dead.includes('B')) {
    console.log('  => Not containment. Something common to both is at fault -- compare with C/D/E/F.');
  }
} finally {
  await driver.quit();
}
