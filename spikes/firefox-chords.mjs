/**
 * Which Ctrl chords actually reach page JavaScript in Firefox, and which does the browser eat?
 *
 * The formatting shortcuts have to live on chords Firefox does not own. Ctrl+B is the
 * bookmarks sidebar, Ctrl+K is the search bar, Ctrl+I is page info, Ctrl+Shift+M is responsive
 * design mode, Ctrl+Shift+K is the console -- and yet every rich text editor on the web uses
 * Ctrl+B and Ctrl+I successfully, so "Firefox has a default for it" plainly does not settle
 * the question. Guessing from a list of Firefox keybindings would produce a shortcut set that
 * is half dead on arrival.
 *
 * THE CONTROL, and the reason this file is careful: WebDriver dispatches keys into the content
 * process, so it may never involve browser chrome at all -- in which case every chord would
 * look available and the measurement would be worthless. So the run starts by sending Ctrl+T,
 * which certainly opens a tab if chrome is being reached, and counts the window handles. If
 * the tab count does not move, this harness cannot answer the question and says so instead of
 * printing a confident table. (An earlier spike in this repo, `firefox-r1.mjs`, is exactly the
 * same shape of dead end, kept for the same reason.)
 *
 *   pnpm serve
 *   node spikes/firefox-chords.mjs
 *
 * ## THE RESULT: this harness cannot answer the question, and the control proves it
 *
 * `Ctrl+T` does not open a tab. WebDriver dispatches into the content process without going
 * near browser chrome, so every chord below would report "arrived" whether Firefox owned it or
 * not -- including the two deliberately hostile rows at the end of the table, which are there
 * precisely so a broken instrument is obvious. The run therefore prints the refusal rather than
 * a table that means nothing.
 *
 * The shortcut set was chosen instead from what rich text editors on the web demonstrably
 * override in Firefox every day: Ctrl+B, Ctrl+I and Ctrl+K are overridden by every editor
 * there is, and Ctrl+Shift+7 / Ctrl+Shift+8 are Google Docs' own list shortcuts. Chords
 * Firefox certainly owns are avoided outright -- Ctrl+Shift+M, Ctrl+Shift+K, Ctrl+Shift+N,
 * Ctrl+Shift+P.
 *
 * This file stays in the repo, with its control intact, next to `firefox-r1.mjs` -- the other
 * spike whose control correctly reported it useless -- so nobody spends an afternoon on the
 * same approach.
 */

import { Builder, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const URL = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/playground/';

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1200', '-height', '900');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const js = (code) => driver.executeScript(code);

/** [label, keys to hold, key to press] */
const CHORDS = [
  ['Ctrl+B          bold', [Key.CONTROL], 'b'],
  ['Ctrl+I          italic', [Key.CONTROL], 'i'],
  ['Ctrl+K          link', [Key.CONTROL], 'k'],
  ['Ctrl+E          inline code', [Key.CONTROL], 'e'],
  ['Ctrl+Space      clear formatting', [Key.CONTROL], ' '],
  ['Ctrl+Shift+X    strikethrough', [Key.CONTROL, Key.SHIFT], 'x'],
  ['Ctrl+Shift+.    quote', [Key.CONTROL, Key.SHIFT], '.'],
  ['Ctrl+Shift+7    numbered list', [Key.CONTROL, Key.SHIFT], '7'],
  ['Ctrl+Shift+8    bullet list', [Key.CONTROL, Key.SHIFT], '8'],
  ['Ctrl+Shift+9    task list', [Key.CONTROL, Key.SHIFT], '9'],
  ['Ctrl+Shift+1    heading cycle', [Key.CONTROL, Key.SHIFT], '1'],
  ['Ctrl+Shift+D    insert date', [Key.CONTROL, Key.SHIFT], 'd'],
  // Known-hostile chords, listed so the output shows what a swallowed one looks like. If
  // these come back "arrived" too, the harness is not reaching chrome -- see the control.
  ['Ctrl+Shift+K    (devtools console)', [Key.CONTROL, Key.SHIFT], 'k'],
  ['Ctrl+Shift+M    (responsive mode)', [Key.CONTROL, Key.SHIFT], 'm'],
];

try {
  await driver.get(URL);
  await driver.sleep(1200);
  console.log(`\n${await js('return navigator.userAgent')}\n`);

  // ------------------------------------------------------------------ control

  const before = (await driver.getAllWindowHandles()).length;
  await driver.actions().keyDown(Key.CONTROL).sendKeys('t').keyUp(Key.CONTROL).perform();
  await driver.sleep(700);
  const after = (await driver.getAllWindowHandles()).length;
  const reachesChrome = after > before;
  console.log(
    `CONTROL  Ctrl+T opened a tab: ${reachesChrome ? 'YES' : 'NO'}  (${before} -> ${after} handles)`,
  );
  if (!reachesChrome) {
    console.log(
      '\nWebDriver is not reaching browser chrome, so this harness CANNOT tell an available\n' +
        'chord from one Firefox swallows. Every line below would read "arrived" regardless.\n' +
        'Not a result. Stopping rather than printing a table that means nothing.\n',
    );
    await driver.quit();
    process.exit(3);
  }
  // Back to the playground tab.
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[0]);
  for (const h of handles.slice(1)) {
    await driver.switchTo().window(h);
    await driver.close();
  }
  await driver.switchTo().window(handles[0]);

  // -------------------------------------------------------------------- probe

  await js(`
    window.__seen = [];
    document.addEventListener('keydown', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      window.__seen.push({ key: e.key, code: e.code, shift: e.shiftKey });
      // Exactly what the note will do: claim the chord.
      e.preventDefault();
    }, true);
    const t = document.createElement('div');
    t.contentEditable = 'plaintext-only';
    t.id = 'probe';
    t.style.cssText = 'position:fixed;left:10px;bottom:10px;width:200px;height:40px;background:#fff;z-index:99999';
    document.body.append(t);
    t.focus();
    return true;
  `);

  console.log('');
  for (const [label, mods, key] of CHORDS) {
    await js('window.__seen = []; return true');
    let act = driver.actions();
    for (const m of mods) act = act.keyDown(m);
    act = act.sendKeys(key);
    for (const m of [...mods].reverse()) act = act.keyUp(m);
    await act.perform();
    await driver.sleep(220);

    const seen = await js('return window.__seen');
    const tabs = (await driver.getAllWindowHandles()).length;
    const arrived = seen.length > 0;
    console.log(
      `  ${arrived ? 'arrived ' : 'SWALLOWED'}  ${label.padEnd(38)} ` +
        `${arrived ? `code=${seen[0].code}` : ''}${tabs > 1 ? '  (+tab!)' : ''}`,
    );
    // A chord that spawned a window would poison every later probe.
    const now = await driver.getAllWindowHandles();
    if (now.length > 1) {
      for (const h of now.slice(1)) {
        await driver.switchTo().window(h);
        await driver.close();
      }
      await driver.switchTo().window(now[0]);
      await js("document.getElementById('probe')?.focus()");
    }
  }
} finally {
  await driver.quit();
}
