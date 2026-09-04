/**
 * Where does the host have to live?
 *
 * The bisect narrowed it to the shadow root's surroundings, and the one thing the real note
 * does that the isolated test did not is attach its host to `document.documentElement` -- a
 * sibling of `<body>`, outside it -- under a custom element tag name. This tests those two
 * differences directly.
 */
import { Builder, By, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const CASES = [
  { id: '1', parent: 'body', tag: 'div' },
  { id: '2', parent: 'body', tag: 'chevalet-note-root-test' },
  { id: '3', parent: 'documentElement', tag: 'div' },
  { id: '4', parent: 'documentElement', tag: 'chevalet-note-root-test' },
];
const LABELS = {
  '1': 'host = <div> inside <body>',
  '2': 'host = custom tag inside <body>',
  '3': 'host = <div> on <html> (outside body)',
  '4': 'host = custom tag on <html> (outside body)  <-- what the note does',
};

const PAGE = 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
<meta charset="utf-8"><title>where</title><body><p>page</p></body>
<script>
const CASES = ${JSON.stringify(CASES)};
window.__eds = {}; window.__inputs = {};
for (const c of CASES) {
  const host = document.createElement(c.tag);
  host.style.cssText = 'all: initial; pointer-events: none; contain: style; display: block;';
  (c.parent === 'body' ? document.body : document.documentElement).append(host);
  const root = host.attachShadow({ mode: 'closed' });
  const ed = document.createElement('div');
  ed.setAttribute('contenteditable', 'plaintext-only');
  if (ed.contentEditable !== 'plaintext-only') ed.setAttribute('contenteditable', 'true');
  ed.style.cssText = 'pointer-events:auto; font:14px monospace; padding:4px; background:#ffe94a; color:#111; border:2px solid #111;';
  ed.textContent = 'abcdef';
  root.append(ed);
  window.__inputs[c.id] = [];
  ed.addEventListener('input', (e) => window.__inputs[c.id].push(e.inputType));
  window.__eds[c.id] = ed;
}
window.__prep = (id) => {
  const ed = window.__eds[id];
  ed.focus();
  const sel = document.getSelection();
  const r = document.createRange();
  r.setStart(ed.firstChild, 6); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
  window.__inputs[id] = [];
  return { text: ed.textContent, focused: ed.getRootNode().activeElement === ed,
           caret: sel.anchorOffset, inBody: document.body.contains(ed.getRootNode().host) };
};
window.__read = (id) => ({ text: window.__eds[id].textContent, inputs: window.__inputs[id] });
</script>`);

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
try {
  await driver.get(PAGE);
  const body = await driver.findElement(By.css('body'));
  console.log('\nFirefox: ' + (await driver.executeScript('return navigator.userAgent')));
  console.log('\n=== real Backspace, by where the host lives ===');
  for (const c of CASES) {
    const prep = await driver.executeScript('return window.__prep(arguments[0])', c.id);
    await body.sendKeys(Key.BACK_SPACE);
    await driver.sleep(120);
    const after = await driver.executeScript('return window.__read(arguments[0])', c.id);
    const worked = after.text !== prep.text;
    console.log(
      `  ${c.id}  ${worked ? 'DELETES ' : 'NOTHING '} ${LABELS[c.id].padEnd(50)} ` +
        `${JSON.stringify(prep.text)} -> ${JSON.stringify(after.text)} ` +
        `focused=${prep.focused} caret=${prep.caret} hostInBody=${prep.inBody} input=[${after.inputs.join(',')}]`,
    );
  }
} finally {
  await driver.quit();
}
