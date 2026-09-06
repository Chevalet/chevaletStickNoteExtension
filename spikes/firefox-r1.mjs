/**
 * Spike R1, at last: does a CONTENT SCRIPT's `beforeunload` prompt when a tab is closed?
 *
 * This has been the one open question since the plan was written. The whole close-tab guard --
 * the per-tab budget, the arming policy, the three-second grace window -- assumes the answer
 * is yes, and the setting is described in the UI as best-effort because nobody had checked.
 *
 * It could not be checked before because it needs three things at once: a real Gecko, a real
 * extension with a real content script, and a real tab close. geckodriver gives all three.
 *
 * The distinction that matters is between two worlds:
 *
 *   - the PAGE's own `beforeunload`, which every site uses and which certainly works
 *   - a CONTENT SCRIPT's `beforeunload`, which runs in an isolated world
 *
 * Firefox may honour one and ignore the other, and the guard depends entirely on the second.
 * So both are installed side by side and closed the same way, which is the only comparison
 * that means anything.
 *
 * A throwaway extension is built here rather than using the real one, because the real one
 * deliberately grants no host permissions at install and the grant prompt lives in browser
 * chrome where WebDriver cannot reach. The throwaway declares a static content script on all
 * URLs, which is exactly the mechanism under test and nothing else.
 *
 *   node spikes/firefox-r1.mjs
 *
 * ## R1 IS ANSWERED, and not by this file
 *
 * YES. A content script's `beforeunload` does prompt: Firefox 155 on Windows, a note with
 * unsaved typing in it, Ctrl+W, and the "Leave page?" dialog appears. Confirmed by hand in
 * September 2026, because no harness in this repository could do it -- see below for why.
 *
 * So the guard is real, `src/cs/guard.ts` now has its own tests, and the arming policy in
 * `bg/guard/budget.ts` is deciding something that matters rather than something hypothetical.
 *
 * ## THE RESULT OF THIS HARNESS: it cannot answer R1, and that is worth knowing
 *
 * Both trials report no dialog -- INCLUDING the control, where the page arms its own
 * `beforeunload`, which certainly does prompt in a real browser. When the control fails, the
 * instrument is wrong and the measurement means nothing.
 *
 * The reason is `driver.close()`. WebDriver's Close Window command does not run unload
 * prompts; it closes the tab at the driver level and the dialog never gets a chance to appear.
 * `unhandledPromptBehavior: ignore` does not help, because there is no prompt to ignore.
 *
 * This file stays in the repo as a documented dead end, with its control intact, so nobody
 * spends another afternoon on the same approach. R1 needs a human pressing Ctrl+W --
 * `docs/spikes.md` has the thirty-second procedure, control included.
 *
 * The control is the whole lesson here. An earlier bug hunt burned three releases on a
 * synthetic Backspace that could never have worked, because there was no control to say so.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builder } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

// ------------------------------------------------------- the throwaway add-on

const dir = mkdtempSync(join(tmpdir(), 'cn-r1-'));

writeFileSync(
  join(dir, 'manifest.json'),
  JSON.stringify(
    {
      manifest_version: 2,
      name: 'R1 probe',
      version: '1.0',
      // MV2 so a plain `content_scripts` declaration needs no run-time registration and no
      // permission prompt. The question is about beforeunload in an isolated world, and that
      // world is the same in both manifest versions.
      browser_specific_settings: { gecko: { id: 'r1-probe@chevalet.test' } },
      permissions: ['<all_urls>'],
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['cs.js'],
          run_at: 'document_start',
          all_frames: false,
        },
      ],
    },
    null,
    2,
  ),
);

writeFileSync(
  join(dir, 'cs.js'),
  `
// An isolated-world beforeunload, armed exactly the way the real guard arms one.
window.addEventListener('beforeunload', (e) => {
  e.preventDefault();
  e.returnValue = '';
  // Leave a trace in the page so the test can prove the listener really ran.
  try { sessionStorage.setItem('cn-r1-cs-fired', String(Date.now())); } catch {}
  return '';
});
// And a marker the test can look for, to be sure the content script loaded at all.
try { document.documentElement.dataset.cnR1 = 'loaded'; } catch {}
`,
);

// ---------------------------------------------------------------- the harness

/**
 * A real http page, not a data: URL.
 *
 * The first run of this spike reported `contentScriptLoaded=MISSING` for both trials, because
 * an `<all_urls>` content script does not match `data:`. The probe was never running, so the
 * "no dialog" result meant nothing at all.
 */
const PAGE = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/_r1.html';

const options = new Options();
// Headed, because a modal dialog in a headless Firefox is a different code path and this is
// precisely a question about whether the dialog appears.
if (!process.env.CN_HEADLESS) options.addArguments('-width', '1100', '-height', '800');
else options.addArguments('-headless');
// The default is to dismiss dialogs automatically, which would hide the very thing under test.
options.setPageLoadStrategy('normal');
// Without this WebDriver dismisses dialogs on sight, which would hide the very thing under
// test and report a confident "no dialog" for a dialog that did appear.
options.setAlertBehavior('ignore');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

// Temporary install, which is the only kind available for an unsigned add-on.
const addonId = await driver.installAddon(dir, true);
console.log(`installed the probe add-on: ${addonId}`);
await new Promise((r) => setTimeout(r, 800));

const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};

/** Open a tab, arm what we are told to arm, interact, then close it and look for a dialog. */
async function trial(label, armPageGuard) {
  await driver.switchTo().newWindow('tab');
  await driver.get(PAGE);

  const loaded = await driver.executeScript(
    "return document.documentElement.dataset.cnR1 || 'MISSING'",
  );
  if (armPageGuard) await driver.executeScript('return window.__addPageGuard()');

  // Firefox only honours beforeunload after a real user interaction with the page.
  await driver.findElement({ id: 'poke' }).click();

  let sawDialog = false;
  let dialogText = '';
  try {
    await driver.close();
    // If a dialog appeared, close() leaves it up and the handle is still there.
    await new Promise((r) => setTimeout(r, 400));
    try {
      const alert = await driver.switchTo().alert();
      dialogText = await alert.getText();
      sawDialog = true;
      await alert.accept();
    } catch {
      sawDialog = false;
    }
  } catch (e) {
    // Some drivers throw UnexpectedAlertOpen instead, which is itself the answer.
    if (String(e).includes('lert')) {
      sawDialog = true;
      dialogText = String(e).slice(0, 120);
      try {
        await (await driver.switchTo().alert()).accept();
      } catch {}
    } else {
      throw e;
    }
  }

  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[0]);

  say(
    `  ${sawDialog ? 'DIALOG  ' : 'no dialog'}  ${label.padEnd(46)} ` +
      `contentScriptLoaded=${loaded}${dialogText ? `  text="${dialogText}"` : ''}`,
  );
  return sawDialog;
}

try {
  say(`\nFirefox: ${await driver.executeScript('return navigator.userAgent')}`);
  say('\n=== closing a tab, with a beforeunload armed ===');

  const csOnly = await trial('content script only  (what the guard relies on)', false);
  const both = await trial('content script + the page arming one too', true);

  say('\n=== R1 ===');
  if (csOnly) {
    say('  A content script beforeunload DOES prompt on tab close.');
    say('  The guard design holds. The wording in the settings can be firmed up.');
  } else if (both) {
    say('  A content script beforeunload is IGNORED; the page’s own is honoured.');
    say('  The guard cannot work as designed. It needs the page world, or a different');
    say('  affordance entirely -- a badge plus the cabinet, which is what the fallback says.');
  } else {
    say('  INCONCLUSIVE, and provably so: the control failed too.');
    say('');
    say('  The second trial arms the PAGE’s own beforeunload, which certainly prompts in a');
    say('  real browser. It did not prompt here either, so WebDriver -- not the extension --');
    say('  is what suppressed it: Close Window does not run unload prompts.');
    say('');
    say('  R1 needs a human pressing Ctrl+W. docs/spikes.md has the procedure, and it takes');
    say('  half a minute. Do not read anything into the first line above.');
  }
} finally {
  await driver.quit();
}
