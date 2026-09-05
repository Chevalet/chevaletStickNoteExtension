/**
 * Settings.
 *
 * The only opinionated thing here is the close-warning section, which says plainly what the
 * feature can and cannot do. A setting that quietly over-promises is worse than one that is
 * missing: someone would rely on a warning that a browser will not always show.
 */

import { API_ORIGIN, RELEASES_PAGE, type UpdateInfo } from '~/bg/jobs/update.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from '~/bg/settings.ts';
import { isRtl, setLang, t } from '~/shared/i18n.ts';
import { applyTheme, asThemeChoice, THEME_CSS } from '../chrome-theme.ts';

declare const __VERSION__: string;
const VERSION = __VERSION__;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

const OPTIONS_CSS = /* css */ `${THEME_CSS}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0; padding: 0 0 60px;
  background: var(--paper); color: var(--ink);
  font: 14px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace;
}
header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 22px; background: var(--bar); color: var(--bar-fg);
  border-bottom: 3px solid var(--accent);
}
header img { width: 26px; height: 26px; }
header .v { margin-inline-start: auto; color: var(--cyan); font-size: 12px; }
main { max-width: 720px; margin: 0 auto; padding: 22px; display: grid; gap: 18px; }
section { background: var(--card); border: 3px solid var(--edge); box-shadow: 5px 5px 0 var(--shadow-c); }
.selwrap { position: relative; display: block; }
.selwrap::after {
  content: ''; position: absolute; inset-inline-end: 11px; top: 50%;
  width: 0; height: 0; transform: translateY(-30%); pointer-events: none;
  border-inline: 5px solid transparent; border-top: 6px solid currentColor;
}
section > h2 {
  margin: 0; padding: 8px 14px; background: var(--bar); color: var(--bar-fg);
  font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
}
section > .inner { padding: 14px; display: grid; gap: 12px; }
label.field { display: grid; gap: 4px; }
label.field > span { font-size: 12.5px; }
label.inline { display: flex; align-items: center; gap: 8px; }
p.note { margin: 0; font-size: 12px; color: var(--dim); line-height: 1.55; }
p.warn { margin: 0; font-size: 12px; color: var(--accent); line-height: 1.55; }
/* Selected on the class rather than on the type, which is what let the number field fall out
   of the design when its type changed from number to text: it kept the browser's own white
   box next to two styled dropdowns. A control is styled because of the job it does here. */
select, label.field input {
  all: unset; box-sizing: border-box; padding: 5px 8px; width: 100%;
  background: color-mix(in oklab, var(--hi) 22%, var(--card));
  border: 2px solid var(--edge); font: inherit; cursor: pointer;
}
label.field input { cursor: text; }
input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }
select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
table.facts { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.facts td { padding: 4px 6px; border-bottom: 1px solid color-mix(in oklab, var(--ink) 12%, transparent); }
table.facts td:last-child { text-align: end; white-space: nowrap; }
.btn {
  all: unset; box-sizing: border-box; padding: 5px 11px; cursor: pointer;
  font: 700 12px/1.5 inherit; background: var(--hi); color: var(--on-hi);
  border: 2px solid var(--on-hi); box-shadow: 3px 3px 0 var(--accent); white-space: nowrap;
}
.btn:hover { transform: translate(1px,1px); box-shadow: 2px 2px 0 var(--accent); }
.btn:active { transform: translate(3px,3px); box-shadow: none; }
.btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.yes { color: var(--ok); font-weight: 700; }
.no { color: var(--accent); font-weight: 700; }
a { color: inherit; text-decoration-color: var(--accent); }
@media (forced-colors: active) {
  section { border: 1px solid CanvasText; box-shadow: none; }
  select, input { border: 1px solid ButtonBorder; background: Field; color: FieldText; }
  .btn { border: 1px solid ButtonBorder; background: ButtonFace; color: ButtonText; box-shadow: none; }
}
`;

let current: Settings = { ...DEFAULT_SETTINGS };

/*
 * This page no longer WRITES anything.
 *
 * It had a `patch()` that saved a setting and flashed a "Saved." bar, for the four sections
 * that were copies of cabinet panes. Those are gone -- one home per setting -- so the page is
 * a way in, a version number, an update check and two pieces of prose. Nothing to save means
 * nothing to confirm, and the flash bar went with it.
 */

/** Last answer from the update check, so opening the page does not trigger a request. */
let lastUpdate: UpdateInfo | null = null;
let checking = false;

function updateRow(): HTMLElement {
  // `upd-status` so a harness can find exactly this line rather than guessing at a
  // paragraph that happens to contain the word "version" -- which is what the first version of
  // spikes/firefox-pages.mjs did, and it passed while pointing at the privacy note.
  const status = el('span', { class: 'note upd-status' });
  // Given the house button class: as a bare <button> it rendered as the operating system's own
  // grey box in the middle of the page, which was merely out of place in the light theme and
  // plainly broken once there was a dark one.
  const button = el(
    'button',
    { type: 'button', class: 'btn' },
    t('updatesCheck'),
  ) as HTMLButtonElement;
  const link = el('a', {
    href: RELEASES_PAGE,
    target: '_blank',
    rel: 'noopener noreferrer',
  }) as HTMLAnchorElement;
  link.textContent = t('updatesOpen');
  link.hidden = true;

  const paint = (): void => {
    button.disabled = checking;
    button.textContent = checking ? t('updatesChecking') : t('updatesCheck');
    link.hidden = !lastUpdate?.newer;
    if (!lastUpdate) {
      status.textContent = '';
      return;
    }
    if (lastUpdate.error === 'no-permission') status.textContent = t('updatesDenied');
    else if (lastUpdate.error) status.textContent = t('updatesFailed');
    else if (lastUpdate.newer && lastUpdate.latest) {
      status.textContent = t('updatesAvailable', lastUpdate.latest);
    } else status.textContent = t('updatesCurrent');
  };

  const failed = (error: string): UpdateInfo => ({
    current: VERSION,
    latest: null,
    newer: false,
    url: RELEASES_PAGE,
    checkedAt: Date.now(),
    error,
  });

  button.addEventListener('click', () => {
    if (checking) return;
    checking = true;
    paint();
    void (async () => {
      try {
        /*
         * The permission is asked for HERE, in the click handler.
         *
         * It used to be asked for in the background, one message later, with a `fromClick`
         * flag that was believed to carry the gesture across. It does not: user activation
         * does not travel with a message, and Firefox's response to a request without it is
         * a promise that never settles -- so the background never answered and this button
         * sat on "Checking..." for good. That was the reported bug.
         */
        const granted = await browser.permissions
          .request({ origins: [API_ORIGIN] })
          .catch(() => false);
        if (!granted) {
          lastUpdate = failed('no-permission');
          return;
        }
        /*
         * And a deadline, because a button that can wait forever is the wrong shape whatever
         * is on the other end. Fifteen seconds is far longer than one API call and far
         * shorter than a person's patience.
         */
        const reply = (await Promise.race([
          browser.runtime.sendMessage({ t: 'update/check' }),
          new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 15_000)),
        ])) as { ok?: boolean; data?: UpdateInfo };
        lastUpdate = reply?.ok ? (reply.data ?? null) : failed('failed');
      } catch {
        lastUpdate = failed('failed');
      } finally {
        checking = false;
        paint();
      }
    })();
  });

  paint();
  return el('div', { class: 'row' }, button, status, link);
}

function render(): void {
  document.body.textContent = '';
  document.body.dir = isRtl() ? 'rtl' : 'ltr';

  const logo = el('img');
  logo.src = '../assets/logo.svg';
  logo.alt = '';
  document.body.append(
    el(
      'header',
      {},
      logo,
      el('b', {}, `${t('extName')} — ${t('optTitle')}`),
      el('span', { class: 'v' }, `v${__VERSION__}`),
    ),
  );

  const main = el('main');
  document.body.append(main);

  /*
   * A SIGNPOST, not a second settings screen.
   *
   * This page used to carry its own copies of Where notes appear, Closing a tab, Keeping and
   * deleting, Backup and Language -- every one of them also in the cabinet, and not laid out
   * the same way, so the two disagreed about what the settings even were. Reported as
   * "those items in the settings do not work well", which is exactly what two screens for one
   * set of switches feels like from the outside.
   *
   * So: one home per setting, and it is the cabinet. What stays here is what belongs to a page
   * Firefox opens from about:addons -- a way in, the version, an update check, and the two
   * pieces of prose that are documentation rather than settings.
   */
  const openCabinet = el('button', { class: 'btn primary' }, t('optOpenCabinet'));
  openCabinet.addEventListener('click', () => {
    void browser.tabs.create({ url: browser.runtime.getURL('ui/manager.html') });
  });
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optSettingsLive')),
      el(
        'div',
        { class: 'inner' },
        el('p', { class: 'note' }, t('optSettingsLiveNote')),
        el('div', { class: 'row' }, openCabinet),
      ),
    ),
  );

  // -------------------------------------------------------------- updates
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('updatesTitle')),
      el(
        'div',
        { class: 'inner' },
        el('p', { class: 'note' }, `Installed: ${VERSION}`),
        updateRow(),
        el(
          'p',
          { class: 'note' },
          'The daily check is switched on in the cabinet, under Backup. ' +
            'This is the only network request the extension can make, it is off unless you turn ' +
            'it on, and it asks for permission the first time. It sends no cookies, no ' +
            'referrer and nothing about you — it reads the release list and compares one ' +
            'version number. It cannot install anything: Firefox only updates an add-on that ' +
            'has been signed, so the button hands you the download page.',
        ),
      ),
    ),
  );

  // ------------------------------------------------------- durability facts
  const facts: Array<[string, boolean]> = [
    ['Clear cache, cookies or site data', true],
    ['Forget About This Site', true],
    ['Running low on disk space', true],
    ['"Refresh Firefox"', false],
    ['Uninstalling this extension', false],
  ];
  const table = el('table', { class: 'facts' });
  for (const [what, survives] of facts) {
    table.append(
      el(
        'tr',
        {},
        el('td', {}, what),
        el('td', { class: survives ? 'yes' : 'no' }, survives ? 'notes survive' : 'notes are lost'),
      ),
    );
  }
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optSurvives')),
      el(
        'div',
        { class: 'inner' },
        table,
        el('p', { class: 'note' }, t('durabilitySurvives')),
        el('p', { class: 'warn' }, t('durabilityLost')),
      ),
    ),
  );

  // ------------------------------------------------------------- privacy
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optPrivacy')),
      el(
        'div',
        { class: 'inner' },
        el(
          'p',
          { class: 'note' },
          'Chevalet Note makes no network requests. There is no account, no identifier, no ' +
            'telemetry and no analytics. Everything lives in your own Firefox profile.',
        ),
        el(
          'p',
          { class: 'note' },
          'Host access is not granted at install. You grant it per site, per domain, or for all ' +
            'sites, from the popup — and you can revoke it at any time without losing a note.',
        ),
      ),
    ),
  );
}

async function boot(): Promise<void> {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(OPTIONS_CSS);
  document.adoptedStyleSheets = [sheet];

  const icon = el('link');
  icon.rel = 'icon';
  icon.type = 'image/svg+xml';
  icon.href = '../assets/logo.svg';
  document.head.append(icon);

  // Fall back to the defaults rather than dying: the diagnostics section below is the reason
  // someone may be opening this page at all, and a storage error must not hide it.
  current = await loadSettings().catch(() => DEFAULT_SETTINGS);
  // The theme is chosen in the cabinet, and this page has to obey it -- the setting says "the
  // cabinet, the popup and this page", and a page that ignored it would make that a lie.
  applyTheme(asThemeChoice(current.theme));
  setLang(current.locale);
  render();
}

void boot().catch((e: unknown) => {
  document.body.append(el('pre', {}, String(e)));
});
