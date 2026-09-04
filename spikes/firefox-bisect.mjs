/**
 * Bisecting the real note in real Firefox, one intervention at a time.
 *
 * What is already established, all of it measured rather than guessed:
 *   - the structure is innocent: a closed shadow root, `all: initial` host,
 *     `pointer-events: none`, `plaintext-only`, keyboard containment and four levels of
 *     nesting all delete correctly in Firefox 155 (firefox-backspace.mjs)
 *   - in the real note the caret is collapsed at offset 2 with text behind it, the body has
 *     focus, edit mode is on, and `beforeinput` fires with `deleteContentBackward` and is NOT
 *     cancelled -- and then nothing happens and no `input` follows (firefox-note.mjs)
 *
 * So Gecko announces the delete and declines to perform it. That leaves the note's own CSS and
 * DOM as the only suspects. This applies one change at a time to a live note and re-tests with
 * a real Backspace, so the answer is a fact rather than a theory.
 *
 *   node spikes/firefox-bisect.mjs
 */

import { Builder, By, Key, Origin } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const URL = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/playground/';

/** Each step is applied on top of the previous ones, then Backspace is tried again. */
const STEPS = [
  ['baseline', 'return "as shipped"'],
  [
    'clear every ancestor transform',
    `let n = v.bodyEl;
     while (n && n !== root) { n.style.transform = 'none'; n.style.perspective = 'none';
       n.style.willChange = 'auto'; n = n.parentElement; }
     return 'transforms cleared';`,
  ],
  [
    'contenteditable=true instead of plaintext-only',
    `v.bodyEl.setAttribute('contenteditable', 'true'); return v.bodyEl.contentEditable;`,
  ],
  [
    'drop the adopted stylesheet',
    `root.adoptedStyleSheets = []; return 'sheet dropped';`,
  ],
  [
    'strip every inline style from the body',
    `v.bodyEl.removeAttribute('style'); return 'inline styles gone';`,
  ],
  [
    'move the body to the top of the shadow root',
    `root.append(v.bodyEl); return 'reparented to root';`,
  ],
  [
    'move the body into the page document',
    `document.body.append(v.bodyEl); return 'reparented to document';`,
  ],
];

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1280', '-height', '900');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const js = (code, ...a) => driver.executeScript(code, ...a);
const jsAsync = (code, ...a) =>
  driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     (async () => { ${code} })().then(done, (e) => done('ERROR: ' + (e && e.message)));`,
    ...a,
  );

try {
  await driver.get(URL);
  await driver.sleep(1200);

  await jsAsync(`
    await window.cn.addNote(80, 120, 0);
    const v = [...window.cn.views.values()].at(-1);
    v.bringToFront(); v.resize(380, 180);
    v.px.x = 80; v.py.x = 120; v.px.t = 80; v.py.t = 120;
    v.settle(); v.writeTransforms();
    window.__v = v; window.scrollTo(0, 0);
    return true;
  `);

  const body = await driver.findElement(By.css('body'));

  /** Reset the text, focus the body, put the caret at the end, send a real Backspace. */
  const tryBackspace = async () => {
    await js(`
      const v = window.__v;
      v.setEditing(true);
      v.bodyEl.textContent = 'abcdef';
      v.bodyEl.focus();
      const sel = document.getSelection();
      const r = document.createRange();
      const t = v.bodyEl.firstChild;
      r.setStart(t, 6); r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
      window.__inputs = [];
      if (!window.__wired) {
        window.__wired = true;
        v.bodyEl.addEventListener('input', (e) => window.__inputs.push(e.inputType));
      }
      return true;
    `);
    const before = await js('return window.__v.bodyEl.textContent');
    await body.sendKeys(Key.BACK_SPACE);
    await driver.sleep(140);
    const after = await js(
      'return { text: window.__v.bodyEl.textContent, inputs: window.__inputs || [] }',
    );
    return { worked: after.text !== before, before, after: after.text, inputs: after.inputs };
  };

  console.log(`\nFirefox: ${await js('return navigator.userAgent')}`);
  console.log('\n=== applying one change at a time ===');
  let found = null;
  for (const [label, code] of STEPS) {
    if (code !== 'return "as shipped"') {
      const note = await js(
        `const v = window.__v; const root = v.el.getRootNode(); ${code}`,
      );
      void note;
    }
    const r = await tryBackspace();
    console.log(
      `  ${r.worked ? 'DELETES ' : 'nothing  '} ${label.padEnd(42)} ` +
        `${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)} input=[${r.inputs.join(',')}]`,
    );
    if (r.worked && !found) found = label;
  }

  console.log('\n=== verdict ===');
  if (!found) {
    console.log('  Nothing restored it, including moving the body into the page document.');
    console.log('  That points at the element itself rather than at its surroundings.');
  } else if (found === 'baseline') {
    console.log('  It deletes as shipped here, so this path is not the broken one.');
  } else {
    console.log(`  Backspace came back at: "${found}" -- that is the cause.`);
  }
} finally {
  await driver.quit();
}
