/**
 * The extension's OWN pages, in a real Firefox: the options page, the cabinet, the popup.
 *
 * ## Why this needed inventing
 *
 * Every "Seen" in `docs/STATUS.md` came from `spikes/cabinet/` -- the real bundle in an
 * ordinary page with four browser APIs stubbed. That is a good instrument, and it cannot
 * answer anything about the parts that are not stubbable: whether a message to the background
 * comes back, whether a permission is really held, whether `browser.commands.getAll()` returns
 * what the Keys pane prints.
 *
 * That gap hid a reported bug: **Check for update stuck on "Checking..." forever.** The
 * options page asked the BACKGROUND to request the host permission, on the belief that a
 * `fromClick: true` flag carried the user gesture across the message. It does not: user
 * activation does not travel with a message, so that request could never be granted -- the
 * popup and the Backup switch both ask in their own click handlers and say so.
 *
 * What made it hang FOREVER is not established, and this file will not pretend otherwise. The
 * control -- the bug put back, with the api.github.com origin taken out of the test manifest
 * so the request really had to happen -- did not reproduce it here: under geckodriver the
 * background's request rejects promptly and the button comes back saying it was denied. So
 * either an ordinary Firefox differs from a driven one, or the cause is something else again.
 *
 * That is why the fix is two things and not one: the page asks for the permission itself, AND
 * the button now has a fifteen-second deadline. The first makes the flow correct; the second
 * makes the reported symptom impossible whatever the cause. In the stubbed harness
 * `permissions.request` is a function that returns true, so none of this could have surfaced.
 *
 * ## Getting to a moz-extension page, which took three attempts
 *
 * 1. `driver.get('moz-extension://<uuid>/ui/options.html')` — *"Navigation to ... is not
 *    allowed in this context"*. Marionette will not navigate the content context to a
 *    privileged URL.
 * 2. `driver.setContext(CHROME)` and open a tab with `gBrowser.addTab` — *"System access is
 *    required. Start Firefox with -remote-allow-system-access"*.
 * 3. That argument cannot be passed through capabilities: *"Argument
 *    --remote-allow-system-access can't be set via capabilities"*. It belongs to the DRIVER,
 *    so this file starts its own `geckodriver --allow-system-access` and connects to it.
 *
 * The UUID cannot be hardcoded either -- it is random per profile, and `installAddon` returns
 * the add-on ID, not the UUID. Firefox writes the mapping into the profile as
 * `extensions.webextensions.uuids`, and geckodriver says where the profile is through the
 * `moz:profile` capability. Read prefs.js, take the UUID, build the URL. The same technique
 * `firefox-unload.mjs` uses to prove a pref landed.
 *
 * ## What "it works" means here
 *
 * NOT "it found a new version" -- that depends on GitHub, and on rate limits. The property
 * being asserted is the one that broke: **the button always comes back.** Whatever the answer
 * -- up to date, newer, no permission, an HTTP error -- the pending state ends and the page
 * says something.
 *
 *     pnpm build:test
 *     node spikes/firefox-pages.mjs
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Builder, By, Key } from 'selenium-webdriver';
import { Context, Options } from 'selenium-webdriver/firefox.js';

const DIST = 'dist-test';
const ADDON_ID = 'chevalet-note-test@chevalet.dev';
const PORT = Number(process.env.CN_PORT ?? 4577);

if (!existsSync(`${DIST}/manifest.json`)) {
  console.error(`\n${DIST}/ is not built. Run: pnpm build:test\n`);
  process.exit(2);
}

/** The add-on's internal UUID, out of the profile Firefox wrote it to. */
function uuidFromProfile(profileDir) {
  for (const name of ['prefs.js', 'user.js']) {
    const file = join(profileDir, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.includes('extensions.webextensions.uuids')) continue;
      // A JSON object, inside a quoted pref string, with its quotes escaped.
      const raw = line
        .slice(line.indexOf(',') + 1)
        .trim()
        .replace(/^"/, '')
        .replace(/"\);?$/, '');
      try {
        const map = JSON.parse(raw.replace(/\\"/g, '"'));
        if (map[ADDON_ID]) return map[ADDON_ID];
      } catch {
        /* try the next line */
      }
    }
  }
  return null;
}

const driverProc = spawn(
  process.platform === 'win32' ? 'node_modules\\.bin\\geckodriver.cmd' : 'node_modules/.bin/geckodriver',
  ['--allow-system-access', '--port', String(PORT)],
  { stdio: 'ignore', shell: process.platform === 'win32' },
);
await new Promise((r) => setTimeout(r, 2500));

const o = new Options();
if (!process.env.CN_HEADED) o.addArguments('-headless');
o.addArguments('-width', '1280', '-height', '900');
o.setAlertBehavior('accept');

const d = await new Builder()
  .usingServer(`http://127.0.0.1:${PORT}`)
  .forBrowser('firefox')
  .setFirefoxOptions(o)
  .build();
mkdirSync('spikes/shots', { recursive: true });

const results = [];
const check = (what, ok, note = '') => {
  results.push([what, ok]);
  console.log(`  ${ok ? 'YES' : 'NO '}  ${what}${note ? `   ${note}` : ''}`);
};

/** Open a privileged URL the only way that works, and switch to it. */
async function openPage(url) {
  await d.setContext(Context.CHROME);
  await d.executeScript(
    `
    const win = Services.wm.getMostRecentWindow('navigator:browser');
    const tab = win.gBrowser.addTab(arguments[0], {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    win.gBrowser.selectedTab = tab;
  `,
    url,
  );
  await d.setContext(Context.CONTENT);
  await d.sleep(1400);
  for (const h of await d.getAllWindowHandles()) {
    await d.switchTo().window(h);
    if ((await d.getCurrentUrl()) === url) return true;
  }
  return false;
}

try {
  await d.installAddon(DIST, true);
  await d.sleep(1500);
  console.log(`\n${await d.executeScript('return navigator.userAgent')}`);

  const profile = (await d.getCapabilities()).get('moz:profile');
  const uuid = profile ? uuidFromProfile(profile) : null;
  if (!uuid) {
    console.log('\n  Could not read the add-on UUID from the profile. Nothing measured.\n');
    process.exit(3);
  }
  const base = `moz-extension://${uuid}`;
  console.log(`pages at: ${base}\n`);

  // ------------------------------------------------------------ the options page

  check('the options page opens', await openPage(`${base}/ui/options.html`));
  check('and it is ours', (await d.getTitle()).includes('Chevalet Note'));

  const button = await d
    .findElements(By.xpath("//button[contains(., 'Check')]"))
    .then((els) => els[0] ?? null);
  if (!button) {
    check('there is a Check for update button', false);
  } else {
    await button.click();
    /*
     * Poll for 20 seconds -- longer than the page's own 15s deadline, so a hung message shows
     * up as the deadline firing rather than as this loop giving up.
     */
    let text = await button.getText();
    for (let i = 0; i < 40 && /checking/i.test(text); i++) {
      await d.sleep(500);
      text = await button.getText();
    }
    check(
      'Check for update comes back instead of sticking on Checking',
      !/checking/i.test(text),
      `button: "${text}"`,
    );

    /*
     * `.upd-status` exactly. The first version of this check swept every paragraph in the
     * section for the word "version" and matched the PRIVACY NOTE -- so it passed while
     * pointing at static text that would be there whether the button worked or not. A
     * selector that can match the wrong element is not an assertion.
     */
    const statusEl = await d.findElements(By.css('.upd-status')).then((els) => els[0] ?? null);
    const said = statusEl ? (await statusEl.getText()).trim() : '';
    check('and it says what it found', said.length > 0, said ? `"${said}"` : 'no status text');
  }
  writeFileSync('spikes/shots/real-options.png', Buffer.from(await d.takeScreenshot(), 'base64'));

  // ---------------------------------------------------------------- the cabinet

  check('the cabinet opens', await openPage(`${base}/ui/manager.html`));
  const drawers = await d.findElements(By.css('.drawer'));
  check('with its drawers', drawers.length > 0, `${drawers.length} drawers`);

  const settingsBtn = await d
    .findElements(By.css('.drawer.is-settings'))
    .then((els) => els[0] ?? null);
  if (settingsBtn) {
    await settingsBtn.click();
    await d.sleep(700);
    const tabs = await d.findElements(By.css('.stab'));
    const keys = tabs.at(-1);
    if (keys) {
      await keys.click();
      await d.sleep(1000);
      const body = await d.findElement(By.css('body')).getText();
      /*
       * `commands.getAll()` reports what the BROWSER has bound, which is the whole point of
       * that pane. In the stubbed harness it came from a fake returning one made-up chord.
       */
      check(
        'the Keys pane prints a real binding from the browser',
        /Alt\+Shift\+A/i.test(body),
        'Alt+Shift+A',
      );
    }
  }
  writeFileSync('spikes/shots/real-cabinet.png', Buffer.from(await d.takeScreenshot(), 'base64'));

  // -------------------------------------------------- editing a note from here

  /*
   * The last thing the cabinet could not do. Fixing a typo meant finding the tab the note is
   * on, or opening its URL again -- a lot of ceremony for one character.
   *
   * A note has to exist first, so this makes one the way a person does, on an ordinary page,
   * and then goes looking for it in the cabinet. That also means this check exercises the
   * whole chain: content script -> background -> store -> cabinet.
   */
  await d.get(process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/spa/');
  await d.sleep(1600);
  await d
    .actions()
    .keyDown(Key.ALT)
    .move({ x: 640, y: 430 })
    .doubleClick()
    .keyUp(Key.ALT)
    .perform();
  await d.sleep(900);
  await d.actions().sendKeys('before editing').perform();
  await d.sleep(800);

  await openPage(`${base}/ui/manager.html`);
  await d.sleep(900);
  const cards = await d.findElements(By.css('.card'));
  check('the note the page made is in the cabinet', cards.length > 0, `${cards.length} cards`);
  if (cards[0]) {
    await cards[0].click();
    await d.sleep(600);
    const buttons = await d.findElements(By.css('.btn'));
    const labels = await Promise.all(buttons.map((b) => b.getText()));
    const editBtn = buttons[labels.findIndex((l) => /Edit/i.test(l))];
    if (!editBtn) {
      check('selecting one note offers Edit', false, labels.filter(Boolean).join(' | '));
    } else {
      await editBtn.click();
      await d.sleep(800);
      const box = await d.findElements(By.css('.edit-body')).then((e) => e[0] ?? null);
      check('the editor opens with the note text in it', Boolean(box));
      if (box) {
        check(
          'and it is the text the page typed',
          (await box.getAttribute('value')).includes('before editing'),
        );
        await box.clear();
        await box.sendKeys('after editing');
        const dialogBtns = await d.findElements(By.css('dialog .btn'));
        const dialogLabels = await Promise.all(dialogBtns.map((b) => b.getText()));
        const save = dialogBtns[dialogLabels.findIndex((l) => /Save/i.test(l))];
        if (save) {
          await save.click();
          await d.sleep(1300);
          const body = await d.findElement(By.css('body')).getText();
          check('saving changes the note', /after editing/.test(body));
        }
      }
      writeFileSync(
        'spikes/shots/real-cabinet-edit.png',
        Buffer.from(await d.takeScreenshot(), 'base64'),
      );
    }
  }

  // ------------------------------------------------------------------ the popup

  check('the popup opens', await openPage(`${base}/ui/popup.html`));
  const popupText = await d.findElement(By.css('body')).getText();
  check('and knows what it is for', /note/i.test(popupText));
  writeFileSync('spikes/shots/real-popup.png', Buffer.from(await d.takeScreenshot(), 'base64'));

  console.log('\n  spikes/shots/real-options.png, real-cabinet.png, real-popup.png');
  if (results.some(([, ok]) => !ok)) process.exitCode = 3;
} finally {
  await d.quit().catch(() => undefined);
  driverProc.kill();
}
console.log('');
