/**
 * The real extension, in a real Firefox, doing what a person does.
 *
 * ## Why this had to exist
 *
 * Two bugs reached a user in 0.0.10, and neither could have been caught by anything that
 * existed here:
 *
 *   - **A note you typed and reloaded came back empty.** `NoteView` never told its host that
 *     typing had changed the text. `spikes/playground` hid it by adding its own `input`
 *     listener inside the note's shadow root, so the tool used to check "do notes survive a
 *     reload?" was checking behaviour the extension did not have.
 *   - **A note made on /blog appeared on /blog/what-is-defi.** A single-page app routes with
 *     `pushState`; no document unloads, so the content script kept showing the notes it had
 *     mounted for the old URL. Nothing told it. The playground fakes URLs with a query
 *     parameter and has no background, so it could not have found this either.
 *
 * Both live in the seam this file covers: the CONTENT SCRIPT talking to the BACKGROUND about a
 * REAL page. The playground has the note stack but no background. `tests/messages.test.ts` has
 * the background but no page. Between them was the hole both bugs fell into.
 *
 * ## How it gets host permission, and why that is honest
 *
 * The shipped extension deliberately declares no host permissions -- they are requested from a
 * click in the popup, and browser chrome is where WebDriver cannot go. So `pnpm build:test`
 * writes `dist-test/`, identical except that the manifest declares `<all_urls>` in
 * `permissions`. Nothing else changes: the extension's own `syncRegistrations` then registers
 * the content script for the granted origin, so this exercises the REAL registration path
 * rather than a static `content_scripts` shortcut that would bypass it.
 *
 *     pnpm serve
 *     pnpm build:test
 *     node spikes/firefox-extension.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { Builder, By, Key } from 'selenium-webdriver';
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
const check = (what, ok) => {
  results.push([what, ok]);
  console.log(`  ${ok ? 'YES' : 'NO '}  ${what}`);
};

/**
 * Is one of our notes occupying this point on the page?
 *
 * `elementFromPoint` retargets through a shadow boundary, so a point covered by a note comes
 * back as the extension's host element and a point that is not comes back as whatever the page
 * has there. That makes it the one honest way to ask "is a note SHOWING" from page script.
 *
 * It has to be this way round. The note lives in a CLOSED shadow root: `host.shadowRoot` is
 * null, and `openOrClosedShadowRoot` is chrome-privileged, so nothing running in the page can
 * read the text inside a note. The first version of this file tried and got null.
 *
 * Which is why this spike does not check what a note SAYS -- that is
 * `spikes/firefox-persist.mjs`, which runs the same note stack over the playground where the
 * database is on the page's own origin and can be read directly. Here the extension's
 * IndexedDB is on a moz-extension origin, invisible from the page. Two spikes, two questions,
 * each asking what it can actually observe.
 */
const noteAt = async (x, y) =>
  d.executeScript(`
    const el = document.elementFromPoint(${x}, ${y});
    return el ? el.tagName.toLowerCase().startsWith('chevalet-note-root-') : false;
  `);

/**
 * Both points at once, at every step.
 *
 * The first version of this file asserted one point at a time, and every line said YES while
 * the final screenshot showed a note that should not have been there -- because by then it was
 * somewhere the assertions were not looking. A trace of both points after every action is what
 * found it.
 */
const where = async (label) => {
  const at = await noteAt(700, 480);
  const on = await noteAt(500, 620);
  console.log(`       trace  ${label.padEnd(34)} at(700,480)=${at}  at(500,620)=${on}`);
};

const hostPresent = async () =>
  d.executeScript(`
    return [...document.querySelectorAll('*')].some(
      (e) => e.tagName.toLowerCase().startsWith('chevalet-note-root-'),
    );
  `);

try {
  const id = await d.installAddon(DIST, true);
  console.log(`\n${await d.executeScript('return navigator.userAgent')}`);
  console.log(`installed: ${id}\n`);
  await d.sleep(1500);

  // ------------------------------------------------------------- a note, made

  await d.get(BASE);
  await d.sleep(1800);
  /*
   * Not "did the content script inject": the host element is created LAZILY, so a page with no
   * notes correctly has none, and the first draft of this check failed for the right reason.
   * The proof of injection is that Alt+double-click makes a note, which is asserted below.
   */
  check('no host element on a page with no notes yet', (await hostPresent()) === false);

  const AT = { x: 700, y: 480 };
  check('nothing is there to begin with', (await noteAt(AT.x, AT.y)) === false);

  // Alt + double-click is how a note is made.
  await d
    .actions()
    .keyDown(Key.ALT)
    .move(AT)
    .doubleClick()
    .keyUp(Key.ALT)
    .perform();
  await d.sleep(1000);
  await d.actions().sendKeys('note on the section page').perform();
  await d.sleep(700);

  check('a note appears where it was made', await noteAt(AT.x, AT.y));
  await where('made on the index');

  // ----------------------------------------------------- it survives a reload

  await d.navigate().refresh();
  await d.sleep(2200);
  check('and it is still there after a reload', await noteAt(AT.x, AT.y));
  await where('after a reload');

  // ------------------------------------------------- the reported scope leak

  /*
   * The note above belongs to the page it was made on, which is the served index. Routing to
   * /blog is routing AWAY from it, so it has to go -- and the first draft of this file then
   * expected it back when the route returned to /blog, which is a different page from the one
   * the note was made on. The expectation was wrong, not the code; the fix is to make a second
   * note ON /blog and watch that one.
   */
  await d.findElement(By.id('to-section')).click();
  await d.sleep(1600);
  check(
    'a note does not follow a pushState route change away from its page',
    (await noteAt(AT.x, AT.y)) === false,
  );
  await where('routed to /blog');

  const ON_BLOG = { x: 500, y: 620 };
  await d
    .actions()
    .keyDown(Key.ALT)
    .move(ON_BLOG)
    .doubleClick()
    .keyUp(Key.ALT)
    .perform();
  await d.sleep(1000);
  await d.actions().sendKeys('note on /blog itself').perform();
  await d.sleep(700);
  check('a note can be made on a route that was never loaded', await noteAt(ON_BLOG.x, ON_BLOG.y));
  await where('made a note on /blog');

  // THE REPORT: /blog/what-is-defi must not show the note from /blog.
  await d.findElement(By.id('to-article')).click();
  await d.sleep(1600);
  check(
    'and it does NOT appear on an article under it',
    (await noteAt(ON_BLOG.x, ON_BLOG.y)) === false,
  );
  await where('routed to /blog/what-is-defi');

  await d.findElement(By.id('to-other')).click();
  await d.sleep(1600);
  check(
    'nor on a sibling article',
    (await noteAt(ON_BLOG.x, ON_BLOG.y)) === false,
  );
  await where('routed to a sibling');

  await d.findElement(By.id('to-section')).click();
  await d.sleep(1600);
  check('and it comes back on the route it belongs to', await noteAt(ON_BLOG.x, ON_BLOG.y));
  await where('routed back to /blog');

  writeFileSync(
    'spikes/shots/extension.png',
    Buffer.from(await d.takeScreenshot(), 'base64'),
  );
  console.log('\n  spikes/shots/extension.png');
  if (results.some(([, ok]) => !ok)) process.exitCode = 3;
} finally {
  await d.quit();
}
console.log('');
