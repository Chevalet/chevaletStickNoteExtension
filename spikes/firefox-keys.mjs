/**
 * Every shortcut, in a real Firefox, with controls.
 *
 * Three shortcut families were reported broken at once -- `S` for a note's settings, Ctrl+Z/Y
 * for undo, and the Ctrl+B family inside the text. Three separate reports at once usually
 * means one cause, and guessing which is how the Backspace bug ate three releases. So this
 * measures all of them in one pass, from the browser's own input pipeline, against controls
 * that must pass or the run means nothing.
 *
 * ## What it found, and the two instruments it uses
 *
 * The cause was one line: every letter shortcut was matched against `e.key`, which is the
 * character the ACTIVE LAYOUT produces. On the Persian layout the reporter uses all day, the
 * physical S key reports a Persian letter, so `S`, `C`, `D`, `L`, `M` and `Ctrl+Z`/`Ctrl+Y`
 * all did nothing -- while Backspace, Delete, Escape and the arrows carried on working,
 * because their `key` values do not depend on the layout.
 *
 * That needs two different instruments, and knowing which is which is the whole lesson of this
 * repo:
 *
 *  - **Real keys**, through `driver.actions()`, for anything that has to produce an EDIT.
 *    A synthetic key event carries no physical `code` and browsers perform no editing action
 *    for one, so a synthetic Backspace can never delete a character. Three releases were lost
 *    to not knowing that.
 *  - **Synthetic keys**, dispatched with an explicit `key`+`code` pair, ONLY for the
 *    layout matrix -- which measures our own `if` statements, plain JavaScript that does not
 *    care where the event came from. WebDriver cannot switch the OS keyboard layout, so this
 *    is the only way to cover a Persian keyboard from an automated run.
 *
 * THE CONTROL: a plain `contenteditable` in the top-level document, driven by the same real
 * key calls. If Backspace does not delete there, the harness is broken and nothing below it
 * may be believed, so the run stops.
 *
 *   pnpm serve                      (in another shell)
 *   node spikes/firefox-keys.mjs
 *   CN_HEADED=1 node spikes/firefox-keys.mjs
 */

import { Builder, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const URL = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/playground/';

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1400', '-height', '1000');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const js = (code, ...args) => driver.executeScript(code, ...args);
const jsAsync = (code, ...args) =>
  driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     (async () => { ${code} })().then(done, (e) => done('ERROR: ' + (e && e.message)));`,
    ...args,
  );

const rows = [];
const record = (name, pass, detail) => {
  rows.push({ name, pass, detail });
  const tag = pass === null ? '  ??  ' : pass ? '  ok  ' : ' FAIL ';
  console.log(`${tag} ${name.padEnd(54)} ${detail ?? ''}`);
};

/** Click at a viewport point through the browser's own input pipeline. */
async function clickAt(x, y) {
  const body = await driver.findElement({ css: 'body' });
  const size = await js('return [window.innerWidth, window.innerHeight]');
  await driver
    .actions({ bridge: true })
    .move({ origin: body, x: Math.round(x - size[0] / 2), y: Math.round(y - size[1] / 2) })
    .click()
    .perform();
}

/** A real chord, e.g. chord([Key.CONTROL, Key.SHIFT], '8'). */
async function chord(mods, key) {
  let act = driver.actions();
  for (const m of mods) act = act.keyDown(m);
  act = act.sendKeys(key);
  for (const m of [...mods].reverse()) act = act.keyUp(m);
  await act.perform();
  await driver.sleep(140);
}

const boxOf = (what) =>
  js(
    `const v = window.__v; const r = v.${what}.getBoundingClientRect();
     return { x: r.x + r.width / 2, y: r.y + r.height / 2,
              left: r.x, top: r.y, w: r.width, h: r.height };`,
  );

/** Put text in the note and select a character range, without going through the keyboard. */
const setText = (text, start, end) =>
  js(
    `const v = window.__v;
     v.bodyEl.textContent = arguments[0];
     v.setEditing(true);
     v.bodyEl.focus();
     const d = document.getSelection();
     const r = document.createRange();
     const t = v.bodyEl.firstChild;
     r.setStart(t, arguments[1]); r.setEnd(t, arguments[2]);
     d.removeAllRanges(); d.addRange(r);
     return v.text;`,
    text,
    start,
    end,
  );

try {
  await driver.get(URL);
  await driver.sleep(1500);
  console.log(`\n${await js('return navigator.userAgent')}\n`);

  // ================================================================= control

  await js(`
    const c = document.createElement('div');
    c.id = 'control';
    c.contentEditable = 'plaintext-only';
    c.style.cssText = 'position:fixed;left:20px;bottom:80px;width:300px;height:60px;' +
      'background:#fff;color:#000;z-index:9999;border:2px solid red;font:16px monospace';
    document.body.append(c);
    return true;
  `);
  const cbox = await js(
    "const r = document.getElementById('control').getBoundingClientRect();" +
      'return { x: r.x + 20, y: r.y + 20 };',
  );
  await clickAt(cbox.x, cbox.y);
  await driver.actions().sendKeys('abcdef').perform();
  await driver.actions().sendKeys(Key.BACK_SPACE).perform();
  const control = await js("return document.getElementById('control').textContent");
  record('CONTROL: plain contenteditable, type + backspace', control === 'abcde', `"${control}"`);
  if (control !== 'abcde') {
    console.log('\nThe control failed. Nothing below this line means anything. Stopping.\n');
    await driver.quit();
    process.exit(2);
  }

  // =================================================================== setup

  const setup = await jsAsync(`
    await window.cn.addNote(60, 300, 0);
    const v = [...window.cn.views.values()].at(-1);
    v.bringToFront();
    v.resize(460, 240);
    v.px.t = 60; v.py.t = 300; v.px.x = 60; v.py.x = 300;
    v.settle(); v.writeTransforms();
    v.bodyEl.textContent = '';
    v.setEditing(false);
    v.renderPreview();
    window.scrollTo(0, 0);
    window.__v = v;
    window.__h = window.cn.history;
    return true;
  `);
  if (typeof setup === 'string') throw new Error(setup);

  // ======================================================= selection plumbing

  const selApi = await js(`
    const root = window.__v.bodyEl.getRootNode();
    return { shadow: typeof root.getSelection, doc: typeof document.getSelection };
  `);
  record(
    'Firefox has no ShadowRoot.getSelection (so we use the document)',
    selApi.shadow === 'undefined' && selApi.doc === 'function',
    `root.getSelection=${selApi.shadow}`,
  );

  // ============================================================ typing basics

  let box = await boxOf('previewEl');
  await clickAt(box.left + 30, box.top + 14);
  await driver.actions().sendKeys('hello world').perform();
  let text = await js('return window.__v.text');
  record('typing into a note', text === 'hello world', `"${text}"`);

  await driver.actions().sendKeys(Key.BACK_SPACE).perform();
  text = await js('return window.__v.text');
  record('Backspace in a note (the 0.0.5 regression)', text === 'hello worl', `"${text}"`);

  /*
   * The caret, read at a NON-degenerate position.
   *
   * The first version of this check put the caret at the end of the text and compared
   * `caretNow()` to it -- which passed while `caretNow()` was hard-coded to return
   * `text.length`, because at the end of the text those two are the same number. A test that
   * passes for the wrong reason is worse than no test. So the caret is moved into the middle
   * first, where a "just return the length" implementation cannot survive.
   */
  await driver.actions().sendKeys(Key.ARROW_LEFT, Key.ARROW_LEFT, Key.ARROW_LEFT).perform();
  const caret = await js(`
    const v = window.__v;
    const d = document.getSelection();
    return { real: d.anchorOffset, ours: v.caretNow(), len: v.text.length };
  `);
  record(
    'caretNow() reads the real caret, mid-text',
    caret.ours === caret.real && caret.real !== caret.len,
    `ours=${caret.ours} real=${caret.real} len=${caret.len}`,
  );

  // =============================================================== undo/redo

  await driver.actions().sendKeys(Key.END).perform();
  const depth0 = await js('return window.__h.depth');
  record('history recorded the typing', depth0.past > 0, JSON.stringify(depth0));

  await chord([Key.CONTROL], 'z');
  const undone = await js('return { text: window.__v.text, d: window.__h.depth }');
  record('Ctrl+Z in the text undoes', undone.text !== 'hello worl', `"${undone.text}"`);

  await chord([Key.CONTROL], 'y');
  const redone = await js('return { text: window.__v.text, d: window.__h.depth }');
  record('Ctrl+Y redoes', redone.text === 'hello worl', `"${redone.text}"`);

  await driver.actions().sendKeys('X').perform();
  const more = await js('return window.__v.text');
  record('typing still works after an undo', more !== redone.text, `"${more}"`);

  // ======================================================= formatting chords

  const fmt = [
    ['Ctrl+B wraps in **', [Key.CONTROL], 'b', 'make me |bold|', 'make me **bold**'],
    ['Ctrl+B again unwraps', [Key.CONTROL], 'b', 'make me **|bold|**', 'make me bold'],
    ['Ctrl+I wraps in *', [Key.CONTROL], 'i', 'make me |soft|', 'make me *soft*'],
    ['Ctrl+E wraps in backticks', [Key.CONTROL], 'e', 'run |ls|', 'run `ls`'],
    ['Ctrl+Shift+X strikes through', [Key.CONTROL, Key.SHIFT], 'x', 'a |b| c', 'a ~~b~~ c'],
    ['Ctrl+K makes a link', [Key.CONTROL], 'k', 'see |docs|', 'see [docs](url)'],
    ['Ctrl+Shift+. quotes the line', [Key.CONTROL, Key.SHIFT], '.', 'quo|te', '> quote'],
    ['Ctrl+Shift+8 makes a bullet', [Key.CONTROL, Key.SHIFT], '8', 'mil|k', '- milk'],
    ['Ctrl+Shift+7 numbers a list', [Key.CONTROL, Key.SHIFT], '7', '|a\nb|', '1. a\n2. b'],
    ['Ctrl+Shift+9 makes a task', [Key.CONTROL, Key.SHIFT], '9', 'mil|k', '- [ ] milk'],
    ['Ctrl+Shift+1 makes a heading', [Key.CONTROL, Key.SHIFT], '1', 'tit|le', '# title'],
    ['Ctrl+Space clears formatting', [Key.CONTROL], ' ', '|**bold** and *em*|', 'bold and em'],
  ];

  for (const [label, mods, key, marked, want] of fmt) {
    const first = marked.indexOf('|');
    const rest = marked.slice(first + 1);
    const second = rest.indexOf('|');
    const plain = marked.split('|').join('');
    const start = first;
    const end = second === -1 ? first : first + second;
    await setText(plain, start, end);
    await chord(mods, key);
    const got = await js('return window.__v.text');
    record(label, got === want, got === want ? '' : `got ${JSON.stringify(got)}`);
  }

  // One undo step per formatting press, not one per character.
  await setText('make me bold', 8, 12);
  const beforeFmt = await js('return window.__h.depth.past');
  await chord([Key.CONTROL], 'b');
  const afterFmt = await js('return window.__h.depth.past');
  record(
    'a formatting press is exactly one undo step',
    afterFmt === beforeFmt + 1,
    `${beforeFmt} -> ${afterFmt}`,
  );
  await chord([Key.CONTROL], 'z');
  const fmtUndone = await js('return window.__v.text');
  record('Ctrl+Z undoes a formatting press', fmtUndone === 'make me bold', `"${fmtUndone}"`);

  // ================================================= the note-level single keys

  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await driver.sleep(120);
  let focus = await js(`
    const v = window.__v;
    const a = v.el.getRootNode().activeElement;
    return { isNote: a === v.el, what: a ? (a.className || a.nodeName) : 'none' };
  `);
  record('Escape moves focus from the text to the note', focus.isNote, `focus=${focus.what}`);

  await driver.actions().sendKeys('s').perform();
  await driver.sleep(180);
  record('S opens the note settings', await js('return !!window.__v.settings'), '');
  await driver.actions().sendKeys('s').perform();
  await driver.sleep(150);

  // The gear in the header: the route that needs no keyboard at all, and which was missing
  // from the toolbar entirely until 0.0.10.
  const gear = await js(`
    const b = window.__v.el.querySelector('.act-settings');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  `);
  record('the header has a settings button at all', gear !== null, gear ? '' : 'no .act-settings');
  if (gear) {
    await clickAt(gear.x, gear.y);
    await driver.sleep(200);
    record('clicking it opens the settings', await js('return !!window.__v.settings'), '');
    await clickAt(gear.x, gear.y);
    await driver.sleep(150);
  }

  // Click the header, then the single keys, which is what was reported as broken.
  box = await boxOf('el.querySelector(".handle")');
  await clickAt(box.left + 14, box.y);
  await driver.sleep(150);
  focus = await js(`
    const v = window.__v;
    const a = v.el.getRootNode().activeElement;
    return { isNote: a === v.el, what: a ? (a.className || a.nodeName) : 'none' };
  `);
  record('clicking a note header focuses the note', focus.isNote, `focus=${focus.what}`);

  const singles = [
    ['s', 'return !!window.__v.settings', 'S — settings'],
    ['c', 'return window.__v.styleOverrides.palette || null', 'C — next colour'],
    ['m', 'return window.__v.isCollapsed', 'M — collapse'],
    ['l', 'return window.__v.locked', 'L — lock'],
    ['d', 'return !!(window.__v.ink && window.__v.ink.isEnabled)', 'D — draw'],
  ];
  for (const [key, probe, label] of singles) {
    const was = await js(probe);
    await driver.actions().sendKeys(key).perform();
    await driver.sleep(160);
    const now = await js(probe);
    const changed = JSON.stringify(was) !== JSON.stringify(now);
    record(label, changed, `${JSON.stringify(was)} -> ${JSON.stringify(now)}`);
    if (changed) {
      // Put it back, so the next probe starts from a known state.
      if (key === 'd') await driver.actions().sendKeys(Key.ESCAPE).perform();
      else await driver.actions().sendKeys(key).perform();
      await driver.sleep(140);
    }
  }

  // ============================================== THE LAYOUT MATRIX (synthetic)

  /*
   * Synthetic events, deliberately, and only here.
   *
   * These measure our own key matching -- `letterOf`, and the `switch` it feeds -- which is
   * plain JavaScript and cannot tell a synthetic event from a real one. WebDriver cannot
   * change the OS keyboard layout, so this is the only way an automated run can cover a
   * Persian keyboard at all.
   *
   * The control is built in: each row is fired twice, once with the Latin `key` and once with
   * the layout's own character, and BOTH must produce the same result. If the Latin row failed
   * the harness would be wrong, not the code.
   */
  console.log('\n  -- layout matrix: same physical key, different e.key --');
  const layoutProbe = await js(`
    const v = window.__v;
    v.el.focus();
    if (v.settings) v.toggleSettings(false);

    const fire = (key, code, mods) => v.el.dispatchEvent(new KeyboardEvent('keydown', {
      key, code, bubbles: true, cancelable: true, ...(mods || {}),
    }));
    const out = [];

    // S -> the settings panel, from a Latin layout and from four non-Latin ones.
    for (const [layout, key] of [
      ['en', 's'], ['fa', '\\u0633'], ['ru', '\\u044b'], ['ar', '\\u0633'], ['el', '\\u03c3'],
    ]) {
      if (v.settings) v.toggleSettings(false);
      fire(key, 'KeyS', {});
      out.push(['S opens settings  (' + layout + ' layout)', !!v.settings]);
    }
    if (v.settings) v.toggleSettings(false);

    // Ctrl+Z -> undo. Measured by whether the history moved, with something on the stack.
    v.bodyEl.textContent = '';
    window.cn.history.clear();
    for (const [layout, key] of [['en', 'z'], ['fa', '\\u0632'], ['ru', '\\u044f']]) {
      window.cn.history.record({
        noteId: v.id, edit: { kind: 'ui', before: { x: 1 }, after: { x: 2 } },
        mergeKey: null, at: Date.now(),
      });
      const before = window.cn.history.depth.past;
      fire(key, 'KeyZ', { ctrlKey: true });
      out.push(['Ctrl+Z undoes      (' + layout + ' layout)',
                window.cn.history.depth.past === before - 1]);
    }

    // Ctrl+B in the text -> bold, from each layout.
    for (const [layout, key] of [['en', 'b'], ['fa', '\\u0630'], ['ru', '\\u0438']]) {
      v.bodyEl.textContent = 'bold';
      v.setEditing(true);
      v.bodyEl.focus();
      const d = document.getSelection();
      const r = document.createRange();
      r.setStart(v.bodyEl.firstChild, 0); r.setEnd(v.bodyEl.firstChild, 4);
      d.removeAllRanges(); d.addRange(r);
      v.bodyEl.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: 'KeyB', bubbles: true, cancelable: true, ctrlKey: true,
      }));
      out.push(['Ctrl+B bolds       (' + layout + ' layout)', v.text === '**bold**']);
    }

    // And the counter-case: a Dvorak user pressing the key that PRINTS z must get undo, even
    // though its code is KeyY. Physical-position-only matching would break this.
    window.cn.history.record({
      noteId: v.id, edit: { kind: 'ui', before: { x: 1 }, after: { x: 2 } },
      mergeKey: null, at: Date.now(),
    });
    const dvBefore = window.cn.history.depth.past;
    fire('z', 'Semicolon', { ctrlKey: true });
    out.push(['Ctrl+Z undoes      (Dvorak: key z, code Semicolon)',
              window.cn.history.depth.past === dvBefore - 1]);

    return out;
  `);
  for (const [label, pass] of layoutProbe) record(label, pass, '');
} finally {
  console.log('');
  const bad = rows.filter((r) => r.pass === false);
  console.log(`${rows.length - bad.length}/${rows.length} passed`);
  for (const r of bad) console.log(`  FAIL  ${r.name}  ${r.detail ?? ''}`);
  await driver.quit();
  if (bad.length > 0) process.exitCode = 1;
}
