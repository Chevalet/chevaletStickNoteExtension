/**
 * The question nobody had actually asked a browser: if I write a note and reload, is it there?
 *
 * ## Why this exists
 *
 * A note you typed and reloaded came back EMPTY, in every shipped release up to 0.0.11.
 * `NoteView` told the host about a text change when a task box was ticked, when an image was
 * attached, on undo and from the formatting shortcuts -- and not from typing. So the create
 * call stored an empty body and nothing ever corrected it.
 *
 * It survived four releases because of how it was checked. `spikes/playground` reached into
 * the note's shadow root and added its own `input` listener that saved on every keystroke, so
 * the one tool used to answer this exact question answered it about behaviour the extension
 * did not have. Every manual check passed.
 *
 * That listener is gone, and this file is what replaced it: the same question, asked of the
 * product's own save path, in a real Firefox, with the answer printed.
 *
 * ## The control, which is the whole point
 *
 * Put the bug back -- delete the `onText` call from the `input` listener in `NoteView` -- and
 * this must print NO. It does; that is how the diagnosis was confirmed rather than assumed.
 * With the bug in place the note is stored with a body of `""`, which is exactly what was
 * reported: everything gone, the note back at its starting size and place.
 *
 *   pnpm serve
 *   node spikes/firefox-persist.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Builder } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const URL = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/playground/';

const o = new Options();
if (!process.env.CN_HEADED) o.addArguments('-headless');
o.addArguments('-width', '1280', '-height', '900');
// The playground asks before wiping, and that confirm is not what this measures.
o.setAlertBehavior('accept');

const d = await new Builder().forBrowser('firefox').setFirefoxOptions(o).build();
mkdirSync('spikes/shots', { recursive: true });

/** Straight out of IndexedDB, because what is on the screen is not the question. */
const stored = async () =>
  JSON.parse(
    await d.executeScript(`
      return new Promise((res) => {
        const r = indexedDB.open('chevaletNote');
        r.onsuccess = () => {
          const q = r.result.transaction('notes').objectStore('notes').getAll();
          q.onsuccess = () => res(JSON.stringify(q.result.map((n) => ({
            text: n.body.text, x: Math.round(n.ui.x), y: Math.round(n.ui.y), name: n.name ?? null,
          }))));
        };
      });
    `),
  );

const results = [];
const check = (what, ok) => {
  results.push([what, ok]);
  console.log(`  ${ok ? 'YES' : 'NO '}  ${what}`);
};

try {
  await d.get(URL);
  await d.sleep(1200);
  console.log(`\n${await d.executeScript('return navigator.userAgent')}\n`);

  // Start from nothing, so what comes back can only be what this wrote.
  await d.executeScript(
    "document.querySelectorAll('button').forEach((b) => { if (/wipe/i.test(b.textContent)) b.click(); });",
  );
  await d.sleep(400);
  try {
    await (await d.switchTo().alert()).accept();
  } catch {
    /* no confirm, nothing to accept */
  }
  await d.sleep(700);

  // A note, where a person would make one, with both scripts in it.
  await d.actions().move({ x: 700, y: 500 }).doubleClick().perform();
  await d.sleep(500);
  await d.actions().sendKeys('Persian: یادداشت. And ASCII.').perform();
  await d.sleep(400);

  const typed = await stored();
  if (typed.length !== 1) {
    console.log(`  the double-click made ${typed.length} notes, not 1 -- nothing measured`);
    process.exitCode = 3;
  } else {
    check('the text reaches the store at all', typed[0].text.includes('یادداشت'));

    // THE TEST, and the reported case: refresh without clicking away first.
    await d.navigate().refresh();
    await d.sleep(1600);
    const afterText = await stored();
    check('the text survives a reload', afterText.some((n) => n.text.includes('یادداشت')));
    check('and it is still the only note', afterText.length === 1);

    /*
     * Position. A drag rather than the keyboard, because dragging is what people do -- and it
     * is a different save path: `onChange` on pointer release rather than `onText`.
     *
     * The note was made at the double-click, so its header is a little below and right of it.
     * If the grab misses, the stored position does not move and this says so instead of
     * passing quietly.
     */
    const before = (await stored())[0];
    await d
      .actions()
      .move({ x: 700, y: 512 })
      .press()
      .move({ x: 500, y: 300 })
      .release()
      .perform();
    await d.sleep(600);
    const moved = (await stored())[0];
    if (moved.x === before.x && moved.y === before.y) {
      console.log('  --   the drag did not move the note; position not measured');
    } else {
      await d.navigate().refresh();
      await d.sleep(1600);
      const afterMove = (await stored())[0];
      check(
        'the position survives a reload',
        afterMove.x === moved.x && afterMove.y === moved.y,
      );
    }

    const png = await d.takeScreenshot();
    writeFileSync('spikes/shots/persist.png', Buffer.from(png, 'base64'));
    console.log('\n  spikes/shots/persist.png');
  }

  if (results.some(([, ok]) => !ok)) process.exitCode = 3;
} finally {
  await d.quit();
}
console.log('');
