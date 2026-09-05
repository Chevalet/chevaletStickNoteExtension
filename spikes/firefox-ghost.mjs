/**
 * Hold Alt: can you read, and click, the page under a note?
 *
 * ## Why this is a spike and not a unit test
 *
 * The question is a hit-testing question -- who owns a point on the screen -- and it is
 * decided by the cascade across a shadow boundary. Nothing short of a real browser can answer
 * it, and the two ways to get it wrong both look completely fine in the source:
 *
 *   1. `pointer-events: none` on the LAYER. Looks obviously right, does nothing: the layer is
 *      already `none` (that is how a click between notes reaches the page) and `.note` sets
 *      `auto` on itself. Importance does not cascade to a descendant with its own value.
 *   2. A second mechanism. The stylesheet already had `:host([data-ghost]) .note` from the
 *      half-built `ghostModifier` setting, and nothing had ever set that attribute. Adding a
 *      class on each layer next to it would have been two ways to do one thing.
 *
 * Both were caught here, by asking the page `document.elementFromPoint` with the key held.
 *
 * ## The control
 *
 * Put the layer-only rule back in `src/cs/styles.ts` and this prints NO: with Alt held, the
 * note still owns the point. That is how the fix was confirmed rather than assumed -- the
 * first two runs of this file failed for a THIRD reason (the note was still focused, and the
 * gesture is deliberately suppressed while someone is typing), so without isolating it the
 * conclusion would have been wrong.
 *
 *     pnpm serve
 *     pnpm build:test
 *     node spikes/firefox-ghost.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Builder, Key } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const DIST = 'dist-test';
const BASE = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/spa/';

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error(`\n${DIST}/ is not built. Run: pnpm build:test\n`);
  process.exit(2);
}

const o = new Options();
if (!process.env.CN_HEADED) o.addArguments('-headless');
o.addArguments('-width', '1280', '-height', '900');
o.setAlertBehavior('accept');

const d = await new Builder().forBrowser('firefox').setFirefoxOptions(o).build();
mkdirSync('spikes/shots', { recursive: true });

const results = [];
const check = (what, ok, note = '') => {
  results.push([what, ok]);
  console.log(`  ${ok ? 'YES' : 'NO '}  ${what}${note ? `   ${note}` : ''}`);
};

/** Who owns this point, as far as the page is concerned? */
const owner = (x, y) =>
  d.executeScript(`
    const el = document.elementFromPoint(${x}, ${y});
    return el ? el.tagName.toLowerCase() : 'none';
  `);

const NOTE = { x: 640, y: 430 };
const INSIDE = { x: 640, y: 470 };

try {
  await d.installAddon(DIST, true);
  await d.sleep(1400);
  console.log(`\n${await d.executeScript('return navigator.userAgent')}\n`);

  await d.get(BASE);
  await d.sleep(1600);

  await d
    .actions()
    .keyDown(Key.ALT)
    .move(NOTE)
    .doubleClick()
    .keyUp(Key.ALT)
    .perform();
  await d.sleep(900);
  await d.actions().sendKeys('a note over the page text').perform();
  await d.sleep(400);

  /*
   * Away from the note, so nothing in it is focused. Escape is NOT enough -- it leaves the
   * text but not the focus -- and the gesture is suppressed while a note is being typed in,
   * which is what made the first two runs of this file report a failure that was not there.
   */
  await d.actions().move({ x: 120, y: 200 }).click().perform();
  await d.sleep(400);

  check('the note owns its own area to begin with', (await owner(INSIDE.x, INSIDE.y)).startsWith('chevalet'));
  writeFileSync('spikes/shots/ghost-off.png', Buffer.from(await d.takeScreenshot(), 'base64'));

  await d.executeScript(
    "window.__alt = 0; window.addEventListener('keydown', (e) => { if (e.key === 'Alt') window.__alt++; }, true);",
  );
  await d.actions().keyDown(Key.ALT).perform();
  await d.sleep(400);
  check('the page sees the Alt keydown at all', (await d.executeScript('return window.__alt')) > 0);

  const held = await owner(INSIDE.x, INSIDE.y);
  check('with Alt held, the page under the note is reachable', !held.startsWith('chevalet'), held);
  writeFileSync('spikes/shots/ghost-on.png', Buffer.from(await d.takeScreenshot(), 'base64'));

  await d.actions().keyUp(Key.ALT).perform();
  await d.sleep(400);
  const back = await owner(INSIDE.x, INSIDE.y);
  check('and the note takes it back on release', back.startsWith('chevalet'), back);

  /*
   * The stuck-modifier case. Alt+Tab away with the key down and no keyup ever arrives, so a
   * `blur` handler has to clear it -- otherwise the notes stay ghosted until the next Alt.
   */
  await d.actions().keyDown(Key.ALT).perform();
  await d.sleep(300);
  await d.executeScript('window.dispatchEvent(new Event("blur"))');
  await d.sleep(400);
  check(
    'a lost keyup does not leave the notes ghosted',
    (await owner(INSIDE.x, INSIDE.y)).startsWith('chevalet'),
  );
  await d.actions().keyUp(Key.ALT).perform();

  console.log('\n  spikes/shots/ghost-off.png, ghost-on.png');
  if (results.some(([, ok]) => !ok)) process.exitCode = 3;
} finally {
  await d.quit();
}
console.log('');
