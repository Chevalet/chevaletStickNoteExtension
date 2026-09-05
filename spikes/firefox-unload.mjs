/**
 * R1, answered as far as an automated harness can answer it: can a CONTENT SCRIPT arm
 * Firefox's unload prompt at all?
 *
 * ## Why there is a second spike
 *
 * `firefox-r1.mjs` asks the same question by closing the tab, and its control correctly
 * reports it useless: WebDriver's Close Window command closes the tab at the driver level
 * without running the "prompt to unload" steps, so nothing appears for either the content
 * script OR the page's own handler. When the control fails, the measurement means nothing, and
 * that file stays in the repo saying so.
 *
 * This one changed the trigger and kept everything else. Navigation runs prompt-to-unload,
 * where Close Window does not, so the control had a chance of passing.
 *
 * ## THE RESULT: WebDriver cannot answer R1 by any route, and now that is measured
 *
 * The control fails here too, and it goes on failing through every remedy worth trying. In
 * order, each one a separate run:
 *
 *   1. WebDriver's Navigate To, prompts left at their default    control: no dialog
 *   2. ... with `dom.disable_beforeunload` set back to false     control: no dialog
 *      (and the profile was read back afterwards to prove the capability landed:
 *       user.js really did carry `user_pref("dom.disable_beforeunload", false)`, so this
 *       was not a pref that failed to apply)
 *   3. A PAGE-initiated navigation instead -- `location.href = ...` from inside the
 *      document, which is as ordinary a navigation as exists                no dialog
 *   4. ... with `dom.require_user_interaction_for_beforeunload` false, removing the
 *      sticky-activation gate entirely, so no click was even needed         no dialog
 *
 * Four triggers, two prefs, and the positive control -- a page arming its own beforeunload,
 * which every site on the web does and which certainly prompts in an ordinary Firefox -- never
 * produced a dialog once. `unhandledPromptBehavior: ignore` makes no difference because there
 * is nothing to ignore: under Marionette the tab-modal unload prompt is not opened at all.
 *
 * So this is not a question the harness answers badly. It is a question the harness cannot
 * observe, in the same way a thermometer cannot measure a colour. Both spikes stay in the repo
 * with their controls intact so that the next person spends five minutes reading instead of an
 * afternoon rediscovering it.
 *
 * ## What still has to happen, and it is thirty seconds of a human
 *
 * Open a page where notes are granted, make a note, type in it, press Ctrl+W. Either Firefox
 * asks or it does not. Then repeat it on a page with a hand-armed `beforeunload` as the
 * control, because a "no" with no control is worth nothing -- which is the whole lesson of
 * these two files. `docs/spikes.md` has the procedure written out.
 *
 * The script is kept runnable, not deleted: if a future geckodriver stops suppressing the
 * prompt, the control starts passing and the answer falls out of the third line for free.
 *
 *     pnpm serve
 *     node spikes/firefox-unload.mjs           headed, which is the point
 *     CN_HEADLESS=1 node spikes/firefox-unload.mjs
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builder, By } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

// ------------------------------------------------------- the throwaway add-on

/*
 * The real extension is not used, and that is deliberate: it grants no host permissions at
 * install, and the grant prompt lives in browser chrome where WebDriver cannot reach. This
 * declares one static content script and nothing else, which is exactly the mechanism under
 * test.
 */
const dir = mkdtempSync(join(tmpdir(), 'cn-unload-'));

writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 2,
      name: 'unload probe',
      version: '1.0',
      browser_specific_settings: { gecko: { id: 'unload-probe@chevalet.test' } },
      permissions: ['<all_urls>'],
      content_scripts: [
        { matches: ['<all_urls>'], js: ['cs.js'], run_at: 'document_start', all_frames: false },
      ],
    },
    null,
    2,
  ),
);

writeFileSync(
  join(dir, 'cs.js'),
  `
// Armed only when told to -- a content script that always armed it would make the "nothing
// armed" control impossible.
//
// Told to via a DOM event, NOT by exposing a function on window. A Firefox content script has
// its own window behind an Xray wrapper, and a property it sets there is invisible to the
// page: the first run of this spike reported armed=NOT REACHABLE for exactly that reason. A
// DOM event is the one channel the two worlds genuinely share.
document.addEventListener('cn-arm', () => {
  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  document.documentElement.dataset.cnArmed = 'yes';
});
try { document.documentElement.dataset.cnR1 = 'loaded'; } catch {}
`,
);

// ---------------------------------------------------------------- the harness

const PAGE = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/_unload.html';
const AWAY = 'http://127.0.0.1:8731/spikes/playground/';

const options = new Options();
if (process.env.CN_HEADLESS) options.addArguments('-headless');
else options.addArguments('-width', '1100', '-height', '800');
options.setPageLoadStrategy('normal');
// Without this, WebDriver dismisses a dialog on sight and reports a confident "no dialog" for
// a dialog that did appear.
options.setAlertBehavior('ignore');
/*
 * THE reason the first two runs of this spike had a failing control.
 *
 * geckodriver's own profile sets `dom.disable_beforeunload = true`, so Gecko skips
 * prompt-to-unload entirely for the whole session -- for the page's handler and a content
 * script's alike. Nothing in the harness or the probe was wrong; the browser had the feature
 * switched off, and every "no dialog" was a report about a disabled code path.
 *
 * Turning it back on is not stacking the deck: it restores the default an ordinary Firefox
 * ships with. The negative control below still has to come back clean, and it does.
 */
options.setPreference('dom.disable_beforeunload', false);

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
const addonId = await driver.installAddon(dir, true);

const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};

/**
 * One trial: load the page, arm whatever we are told to arm, interact, navigate away, and look
 * for a dialog.
 *
 * `arm` is 'none' | 'page' | 'content'.
 */
async function trial(label, arm) {
  await driver.get(PAGE);
  const loaded = await driver.executeScript(
    "return document.documentElement.dataset.cnR1 || 'MISSING'",
  );

  let armed = 'nothing';
  if (arm === 'page') armed = await driver.executeScript('return window.__addPageGuard()');
  // executeScript runs in the PAGE's world. The content script cannot be called from there --
  // separate window, Xray wrapper -- so it is poked with a DOM event and the handshake is read
  // back off the documentElement. If that dataset flag is missing, the listener was never
  // registered and the trial is about nothing.
  if (arm === 'content') {
    armed = await driver.executeScript(
      "document.dispatchEvent(new Event('cn-arm'));" +
        "return document.documentElement.dataset.cnArmed === 'yes' ? 'armed in the isolated world' : 'HANDSHAKE FAILED';",
    );
  }

  // Sticky activation: Firefox will not prompt on a page nobody has touched.
  await driver.findElement(By.id('poke')).click();

  let saw = false;
  let text = '';
  try {
    await driver.get(AWAY);
  } catch (e) {
    if (String(e).toLowerCase().includes('alert')) {
      saw = true;
      text = 'navigation threw UnexpectedAlertOpen';
    } else throw e;
  }
  if (!saw) {
    try {
      const alert = await driver.switchTo().alert();
      text = await alert.getText();
      saw = true;
    } catch {
      saw = false;
    }
  }
  if (saw) {
    try {
      await (await driver.switchTo().alert()).accept();
    } catch {}
  }

  say(
    `  ${saw ? 'DIALOG  ' : 'no dialog'}  ${label.padEnd(44)} ` +
      `cs=${loaded}  armed=${armed}${text ? `  "${String(text).slice(0, 60)}"` : ''}`,
  );
  return saw;
}

try {
  say(`\nFirefox: ${await driver.executeScript('return navigator.userAgent')}`);
  say(`probe add-on: ${addonId}\n`);
  say('=== navigating away, with a beforeunload armed in one world or the other ===');

  // Order matters: the negative control first, so a harness that prompts unconditionally is
  // caught before any result is believed.
  const none = await trial('nothing armed  (negative control)', 'none');
  const page = await trial('the page arms it  (positive control)', 'page');
  const content = await trial('a content script arms it  (the question)', 'content');
  const armedFailed = report.some((line) => line.includes('HANDSHAKE FAILED'));

  say('\n=== R1, as far as this can go ===');
  if (none) {
    say('  USELESS: a dialog appeared with nothing armed. The harness prompts on its own,');
    say('  so neither of the other two lines says anything about beforeunload.');
    process.exitCode = 3;
  } else if (!page) {
    say('  As expected, and it is still the honest answer: the positive control failed. A page');
    say('  arming its own beforeunload certainly prompts in an ordinary Firefox, so Marionette');
    say('  is not opening the prompt at all and the content-script line above is a measurement');
    say('  of nothing. See the header for the four triggers and two prefs already ruled out.');
    say('');
    say('  R1 needs thirty seconds of a human. docs/spikes.md, "R1 by hand".');
    process.exitCode = 3;
  } else if (armedFailed) {
    say('  USELESS: the content script never registered its listener -- the handshake failed,');
    say('  so the third line is a measurement of nothing. Fix the probe, not the product.');
    process.exitCode = 3;
  } else if (content) {
    say('  A content script CAN arm the unload prompt. Gecko does not care which world the');
    say('  listener was registered in, which is the load-bearing assumption of the close');
    say('  guard -- so the guard design holds.');
    say('');
    say('  Still not proven here: Ctrl+W in particular, because no WebDriver command reaches');
    say('  browser chrome. Prompt-to-unload is one algorithm and the registering world is not');
    say('  one of its inputs, so the close path should behave the same. Thirty seconds of a');
    say('  human settles it -- docs/spikes.md.');
  } else {
    say('  A content script CANNOT arm the unload prompt, and the control proves the harness');
    say('  works. The guard cannot do what it says: it needs a badge and a prompt in the');
    say('  cabinet instead, and the setting should be removed rather than reworded.');
  }
  say('');
} finally {
  await driver.quit();
}
