/**
 * Photograph every surface of the interface, in both themes, in one command.
 *
 * ## Why this exists
 *
 * Three bugs in this project were found only by LOOKING at the rendered page, and could not
 * have been found any other way: a ghost button at 1.3:1 on cream, an unstyled native button,
 * and a dark theme whose two biggest surfaces were darker than the page behind them. Tests
 * cannot see any of that. `tests/theme.test.ts` now guards the contrast of the palette, which
 * is the part that reduces to numbers -- but nothing reduces "this looks like a cage" to a
 * number, and the only instrument for it is a picture.
 *
 * Taking those pictures by hand is the problem. There are six settings sections, three pages,
 * two view modes and a trash, times two themes: about thirty shots. Nobody re-takes thirty
 * shots by hand after a palette edit, so the palette edit ships unlooked-at. This makes it one
 * command and about forty seconds.
 *
 *     pnpm serve                 (in another terminal)
 *     node spikes/shots.mjs      -> writes spikes/shots/<name>.png
 *
 *     CN_ONLY=settings-keys node spikes/shots.mjs    just the ones whose name contains that
 *     CN_THEME=dark node spikes/shots.mjs            just one theme
 *     CN_HEADED=1 node spikes/shots.mjs              watch it work
 *
 * ## Crops, and why they are not optional
 *
 * A full-page shot at 1280 arrives downscaled wherever it is being looked at, and downscaling
 * a 1px keyline at 42% alpha smears it across the card -- which reads as a colour that is not
 * on the page at all. That cost an afternoon once: a card was diagnosed as "steel blue, off
 * palette" from a downscaled full-page shot, when the rule was a 1px line every 22px and the
 * card was the graphite it was supposed to be. So the shots with a `crop` use WebDriver's
 * element screenshot, which returns that element at NATIVE resolution. Judge colour from
 * those; judge layout from the full pages.
 *
 * ## What it is not
 *
 * Not a screenshot-diffing test, deliberately. Pixel baselines on an interface that is still
 * changing shape every release fail on every intended change, and the failures teach you to
 * run the update command without looking -- which is worse than having no test, because it
 * feels like coverage. These are photographs for a person to look at, and the output folder is
 * gitignored.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Builder, By, until } from 'selenium-webdriver';
import { Options } from 'selenium-webdriver/firefox.js';

const BASE = process.env.CN_URL ?? 'http://127.0.0.1:8731/spikes/cabinet/';
const OUT = 'spikes/shots';
const ONLY = process.env.CN_ONLY ?? '';
const THEMES = process.env.CN_THEME ? [process.env.CN_THEME] : ['light', 'dark'];

/**
 * Each shot: a page to open, and optionally a few clicks to get somewhere.
 *
 * `settle` exists because the cabinet reads IndexedDB and paints in a microtask, and a
 * screenshot of a half-painted page is a bug report about a bug that does not exist.
 */
const SHOTS = [
  { name: 'cabinet', page: 'manager' },
  { name: 'cabinet-empty', page: 'manager', seed: '0' },
  { name: 'list', page: 'manager', click: ['.bar .btn:nth-child(2)'] },
  { name: 'trash', page: 'manager', click: ['.btn.is-trash'] },
  { name: 'settings-where', page: 'manager', click: ['.drawer.is-settings'] },
  { name: 'settings-closing', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(2)'] },
  { name: 'settings-look', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(3)'] },
  { name: 'settings-keeping', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(4)'] },
  { name: 'settings-backup', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(5)'] },
  { name: 'settings-keys', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(6)'] },
  { name: 'popup', page: 'popup', size: [420, 640] },
  { name: 'options', page: 'options' },

  // Native-resolution crops of the surfaces where a colour decision actually lives.
  { name: 'crop-top', page: 'manager', crop: '.top' },
  { name: 'crop-card', page: 'manager', crop: '.card' },
  { name: 'crop-cabinet', page: 'manager', crop: '.cabinet' },
  { name: 'crop-folder', page: 'manager', crop: '.folder' },
  { name: 'crop-settings', page: 'manager', click: ['.drawer.is-settings'], crop: '.scard' },
  { name: 'crop-look', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(3)'], crop: '.scard' },
  { name: 'crop-keys', page: 'manager', click: ['.drawer.is-settings', '.stab:nth-child(6)'], crop: '.scard' },
];

mkdirSync(OUT, { recursive: true });

const options = new Options();
if (!process.env.CN_HEADED) options.addArguments('-headless');
options.addArguments('-width', '1280', '-height', '900');

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();

let taken = 0;
try {
  for (const theme of THEMES) {
    for (const shot of SHOTS) {
      const name = `${shot.name}-${theme}`;
      if (ONLY && !name.includes(ONLY)) continue;

      const url = new URL(BASE);
      url.searchParams.set('theme', theme);
      url.searchParams.set('page', shot.page);
      if (shot.seed) url.searchParams.set('seed', shot.seed);

      if (shot.size) await driver.manage().window().setRect({ width: shot.size[0], height: shot.size[1] });
      else await driver.manage().window().setRect({ width: 1280, height: 900 });

      await driver.get(url.href);
      // The cabinet paints from IndexedDB, so wait for something real rather than a timer.
      await driver.wait(until.elementLocated(By.css('.top, .wrap, main, body > *')), 5000);
      await driver.sleep(700);

      let reached = true;
      for (const selector of shot.click ?? []) {
        const found = await driver.findElements(By.css(selector));
        if (found.length === 0) {
          // Writing the file anyway would put a photograph of the cabinet in a file called
          // `trash-dark.png`, which is worse than having no photograph: the next person
          // reviews the wrong screen and signs it off.
          console.log(`  ${name}: no ${selector} -- no shot, rather than the wrong shot`);
          reached = false;
          break;
        }
        await found[0].click();
        await driver.sleep(450);
      }
      if (!reached) continue;

      let png;
      if (shot.crop) {
        const els = await driver.findElements(By.css(shot.crop));
        if (els.length === 0) {
          console.log(`  ${name}: no ${shot.crop} -- no shot, rather than the wrong shot`);
          continue;
        }
        png = await els[0].takeScreenshot();
      } else {
        png = await driver.takeScreenshot();
      }
      writeFileSync(`${OUT}/${name}.png`, Buffer.from(png, 'base64'));
      console.log(`  ${OUT}/${name}.png`);
      taken++;
    }
  }
} finally {
  await driver.quit();
}

console.log(`\n${taken} shots. Look at them.\n`);
