/**
 * The real note, in a real Firefox, with a real Backspace.
 *
 * `firefox-backspace.mjs` ruled out the structure: a closed shadow root, the `all: initial`
 * host, `pointer-events: none`, `plaintext-only`, containing keyboard events at the host, four
 * levels of nesting -- every one of those deletes correctly in Firefox 155. So the cause is in
 * NoteView itself, and the only way to find it is to drive the actual thing.
 *
 * This loads the playground, which mounts the shipped NoteView against the shipped IndexedDB
 * code, and reports the state around a real keypress: what has focus, where the selection is,
 * which events arrive, whether anything cancels them, and what the text does.
 *
 *   node spikes/firefox-note.mjs            (headless)
 *   CN_HEADED=1 node spikes/firefox-note.mjs
 */

import { Builder, By, Key, Origin } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const URL = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/playground/';

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1280', '-height', '900');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

const js = (code, ...args) => driver.executeScript(code, ...args);
// executeScript wraps the body in a plain function, so top-level await is a syntax error.
// Anything that has to await goes through here instead.
const jsAsync = (code, ...args) =>
  driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     (async () => { ${code} })().then(done, (e) => done('ERROR: ' + (e && e.message)));`,
    ...args,
  );

try {
  await driver.get(URL);
  await driver.sleep(1200);

  const ready = await js('return typeof window.cn === "object" && !!window.cn.addNote');
  if (!ready) throw new Error(`playground did not load at ${URL} -- is the dev server running?`);

  // A note with text in it, placed somewhere clickable.
  const setup = await jsAsync(`
    await window.cn.addNote(80, 120, 0);
    const v = [...window.cn.views.values()].at(-1);
    v.bringToFront();
    v.resize(360, 170);
    v.px.x = 80; v.py.x = 120; v.px.t = 80; v.py.t = 120;
    v.settle(); v.writeTransforms();
    v.bodyEl.textContent = 'abcdef';
    v.setEditing(false);
    v.renderPreview();
    window.scrollTo(0, 0);
    window.__v = v;

    // Watch everything that could matter, at every stage of the path.
    window.__log = [];
    const note = (where, e) => window.__log.push({
      where,
      type: e.type,
      key: e.key,
      code: e.code,
      inputType: e.inputType,
      prevented: e.defaultPrevented,
      target: (e.target && (e.target.className || e.target.nodeName)) || '?',
      phase: e.eventPhase,
    });
    for (const t of ['keydown','keypress','beforeinput','input','keyup']) {
      v.bodyEl.addEventListener(t, (e) => note('body-capture', e), true);
      v.bodyEl.addEventListener(t, (e) => note('body-bubble', e), false);
      document.addEventListener(t, (e) => note('document', e), false);
    }
    return true;
  `);
  if (typeof setup === 'string' && setup.startsWith('ERROR')) throw new Error(setup);

  const spot = await js(`
    const v = window.__v;
    const r = v.previewEl.getBoundingClientRect();
    return { x: Math.round(r.x + 30), y: Math.round(r.y + 10),
             pw: Math.round(r.width), ph: Math.round(r.height) };
  `);
  console.log(`\npreview box: ${spot.pw}x${spot.ph} — clicking at (${spot.x}, ${spot.y})`);

  // A real click, at a real place, from the browser's own input pipeline.
  const body = await driver.findElement(By.css('body'));
  await driver
    .actions({ async: false })
    .move({ origin: Origin.VIEWPORT, x: spot.x, y: spot.y })
    .click()
    .perform();
  await driver.sleep(250);

  const afterClick = await js(`
    const v = window.__v;
    const root = v.el.getRootNode();
    const sel = (root.getSelection && root.getSelection()) || document.getSelection();
    const a = sel && sel.anchorNode;
    return {
      editing: v.editing,
      activeInRoot: root.activeElement && (root.activeElement.className || root.activeElement.nodeName),
      isBody: root.activeElement === v.bodyEl,
      docActive: document.activeElement && document.activeElement.nodeName,
      editable: v.bodyEl.isContentEditable,
      ce: v.bodyEl.contentEditable,
      bodyDisplay: getComputedStyle(v.bodyEl).display,
      bodyUserSelect: getComputedStyle(v.bodyEl).userSelect,
      ranges: sel ? sel.rangeCount : -1,
      anchor: a ? (a.nodeName + '@' + sel.anchorOffset) : 'null',
      anchorInBody: a ? v.bodyEl.contains(a) : false,
      text: v.bodyEl.textContent,
      locked: v.locked,
      inking: !!(v.ink && v.ink.isEnabled),
    };
  `);
  console.log('\n=== after a real click ===');
  for (const [k, val] of Object.entries(afterClick)) console.log(`  ${k}: ${val}`);

  const caretProbe = `
    const v = window.__v;
    const sel = document.getSelection();
    const a = sel && sel.anchorNode;
    let offsetInBody = -1;
    if (a && v.bodyEl.contains(a)) {
      // Character offset from the start of the body, counting text nodes.
      const walk = document.createTreeWalker(v.bodyEl, NodeFilter.SHOW_TEXT);
      let n = walk.nextNode(); let acc = 0;
      while (n) { if (n === a) { acc += sel.anchorOffset; offsetInBody = acc; break; }
        acc += (n.nodeValue || '').length; n = walk.nextNode(); }
      if (offsetInBody < 0 && a === v.bodyEl) offsetInBody = sel.anchorOffset;
    }
    return {
      text: v.bodyEl.textContent,
      ranges: sel ? sel.rangeCount : -1,
      collapsed: sel ? sel.isCollapsed : null,
      anchorNode: a ? a.nodeName : 'null',
      anchorOffset: sel ? sel.anchorOffset : -1,
      anchorInBody: a ? v.bodyEl.contains(a) : false,
      offsetInBody,
      editing: v.editing,
      focused: v.el.getRootNode().activeElement === v.bodyEl,
    };
  `;
  const showCaret = async (label) => {
    const c = await js(`return (() => { ${caretProbe} })()`);
    console.log(
      `  ${label.padEnd(18)} text=${JSON.stringify(c.text)} caret=${c.offsetInBody} ` +
        `anchor=${c.anchorNode}@${c.anchorOffset} inBody=${c.anchorInBody} ` +
        `collapsed=${c.collapsed} focused=${c.focused} editing=${c.editing}`,
    );
    return c;
  };

  console.log('\n=== caret, step by step ===');
  await showCaret('after click');

  // Type first, so there is definitely something to delete and we know insertion works.
  await js('window.__log = []');
  await body.sendKeys('XY');
  await driver.sleep(150);
  await showCaret('after typing XY');
  const afterType = await js('return { text: window.__v.bodyEl.textContent, log: window.__log }');
  console.log(`\n=== typing "XY" ===\n  text: ${JSON.stringify(afterType.text)}`);
  for (const l of afterType.log.filter((l) => l.where !== 'body-capture')) {
    console.log(
      `  ${l.where.padEnd(12)} ${String(l.type).padEnd(11)} key=${l.key ?? '-'} ` +
        `code=${l.code ?? '-'} inputType=${l.inputType ?? '-'} prevented=${l.prevented}`,
    );
  }

  // The moment of truth.
  await js('window.__log = []');
  const before = await js('return window.__v.bodyEl.textContent');
  await showCaret('before Backspace');
  await body.sendKeys(Key.BACK_SPACE);
  await driver.sleep(200);
  const afterBs = await js('return { text: window.__v.bodyEl.textContent, log: window.__log }');
  await showCaret('after Backspace');

  console.log('\n=== real Backspace ===');
  console.log(`  ${JSON.stringify(before)} -> ${JSON.stringify(afterBs.text)}`);
  console.log(`  ${afterBs.text !== before ? 'DELETED' : '*** NOTHING HAPPENED ***'}`);
  for (const l of afterBs.log) {
    console.log(
      `  ${l.where.padEnd(12)} ${String(l.type).padEnd(11)} key=${l.key ?? '-'} ` +
        `code=${l.code ?? '-'} inputType=${l.inputType ?? '-'} prevented=${l.prevented} ` +
        `target=${l.target}`,
    );
  }

  // If the key produced no beforeinput at all, the editor never saw it. If it produced one
  // that was prevented, something cancelled it. Those are different bugs.
  const sawBeforeInput = afterBs.log.some((l) => l.type === 'beforeinput');
  const preventedKeydown = afterBs.log.some((l) => l.type === 'keydown' && l.prevented);
  console.log('\n=== reading ===');
  console.log(`  keydown was cancelled: ${preventedKeydown}`);
  console.log(`  beforeinput fired:     ${sawBeforeInput}`);
  if (afterBs.text !== before) {
    console.log('  => Backspace works here. Whatever breaks it is not in this path.');
  } else if (preventedKeydown) {
    console.log('  => Something called preventDefault on the keydown. Find it and stop it.');
  } else if (!sawBeforeInput) {
    console.log('  => The editor never acted: no beforeinput. Focus or selection is wrong.');
  } else {
    console.log('  => beforeinput fired and nothing changed: the edit itself is being blocked.');
  }
} finally {
  await driver.quit();
}
