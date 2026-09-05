/**
 * Settings.
 *
 * The only opinionated thing here is the close-warning section, which says plainly what the
 * feature can and cannot do. A setting that quietly over-promises is worse than one that is
 * missing: someone would rely on a warning that a browser will not always show.
 */

import type { GuardMode } from '~/bg/guard/budget.ts';
import { RELEASES_PAGE, type UpdateInfo } from '~/bg/jobs/update.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from '~/bg/settings.ts';
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
.saved { position: fixed; inset: auto 0 0 0; padding: 6px 22px; background: var(--bar); color: var(--cyan); font-size: 12px; }
@media (forced-colors: active) {
  section { border: 1px solid CanvasText; box-shadow: none; }
  select, input { border: 1px solid ButtonBorder; background: Field; color: FieldText; }
  .btn { border: 1px solid ButtonBorder; background: ButtonFace; color: ButtonText; box-shadow: none; }
}
`;

let current: Settings = { ...DEFAULT_SETTINGS };

async function patch(next: Partial<Settings>): Promise<void> {
  current = await saveSettings(next);
  flash();
}

let flashTimer = 0;
function flash(): void {
  let bar = document.querySelector('.saved');
  if (!bar) {
    bar = el('div', { class: 'saved', role: 'status', 'aria-live': 'polite' });
    document.body.append(bar);
  }
  bar.textContent = t('optSaved');
  clearTimeout(flashTimer);
  flashTimer = self.setTimeout(() => bar?.remove(), 1600);
}

function selectField(
  label: string,
  value: string,
  options: ReadonlyArray<readonly [string, string]>,
  onChange: (v: string) => void,
): HTMLElement {
  const sel = el('select');
  for (const [v, text] of options) {
    const o = el('option', { value: v }, text);
    if (v === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  /*
   * The select is wrapped so a caret can be drawn over it. `all: unset` in the stylesheet
   * strips the native arrow along with everything else, which left a dropdown looking exactly
   * like a text field -- no affordance at all that it could be opened. Putting `appearance`
   * back would draw a native control in the middle of a hand-drawn interface, which is the
   * mistake the unstyled update button already made once.
   */
  return el(
    'label',
    { class: 'field' },
    el('span', {}, label),
    el('span', { class: 'selwrap' }, sel),
  );
}

function checkField(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const box = el('input', { type: 'checkbox' }) as HTMLInputElement;
  box.checked = value;
  box.addEventListener('change', () => onChange(box.checked));
  return el('label', { class: 'inline' }, box, el('span', {}, label));
}

function numberField(
  label: string,
  value: number,
  min: number,
  max: number,
  onChange: (v: number) => void,
): HTMLElement {
  /*
   * A text input with a numeric keypad, not `type="number"`.
   *
   * Firefox draws `-moz-number-spin-box` even under `appearance: none`, and it draws it in the
   * platform's own light widget colours -- so the dark options page had a small grey box
   * floating in the corner of the field, the one native artefact on the page. The clamp below
   * is what `min`/`max` were doing anyway, and it runs whatever the field is typed into.
   */
  const input = el('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    'aria-valuemin': String(min),
    'aria-valuemax': String(max),
  }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('change', () => {
    const typed = Number.parseInt(input.value.replace(/[^0-9]/g, ''), 10);
    const v = Number.isFinite(typed) ? Math.max(min, Math.min(max, typed)) : value;
    input.value = String(v);
    onChange(v);
  });
  return el('label', { class: 'field' }, el('span', {}, label), input);
}

/** Last answer from the update check, so opening the page does not trigger a request. */
let lastUpdate: UpdateInfo | null = null;
let checking = false;

function updateRow(): HTMLElement {
  const status = el('span', { class: 'note' });
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

  button.addEventListener('click', () => {
    if (checking) return;
    checking = true;
    paint();
    // fromClick: true is what lets the background request the host permission -- Firefox only
    // grants one from a user gesture, and the click is that gesture.
    void browser.runtime
      .sendMessage({ t: 'update/check', fromClick: true })
      .then((reply: unknown) => {
        const r = reply as { ok?: boolean; data?: UpdateInfo };
        lastUpdate = r?.ok ? (r.data ?? null) : null;
      })
      .catch(() => {
        lastUpdate = {
          current: VERSION,
          latest: null,
          newer: false,
          url: RELEASES_PAGE,
          checkedAt: Date.now(),
          error: 'failed',
        };
      })
      .finally(() => {
        checking = false;
        paint();
      });
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

  // -------------------------------------------------------------- general
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optWhereNotes')),
      el(
        'div',
        { class: 'inner' },
        checkField(
          'Show notes on sites I have not set a rule for',
          current.defaultEnabled,
          (v) => void patch({ defaultEnabled: v }),
        ),
        el(
          'p',
          { class: 'note' },
          `Per-site rules: ${Object.keys(current.siteRules).length || 'none'}. ` +
            'Set them from the popup on the site itself, where you can see what you are changing.',
        ),
        selectField(
          t('optLanguage'),
          current.locale,
          [
            ['', t('optFollowBrowser')],
            ['en', 'English'],
            ['fa', 'فارسی'],
          ],
          (v) => {
            void patch({ locale: v as Settings['locale'] }).then(() => {
              setLang(current.locale);
              void browser.storage.local
                .get('lastUpdateCheck')
                .then((got: Record<string, unknown>) => {
                  const cached = got.lastUpdateCheck as UpdateInfo | undefined;
                  if (cached) {
                    lastUpdate = cached;
                    render();
                  }
                })
                .catch(() => undefined);

              render();
            });
          },
        ),
        selectField(
          'Motion',
          current.motion,
          [
            ['auto', 'Follow my system setting'],
            ['full', 'Full paper physics'],
            ['reduced', 'Reduced'],
            ['off', 'None'],
          ],
          (v) => void patch({ motion: v as Settings['motion'] }),
        ),
      ),
    ),
  );

  // ---------------------------------------------------- the close warning
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optCloseWarning')),
      el(
        'div',
        { class: 'inner' },
        selectField(
          'When to warn',
          current.guard.mode,
          [
            ['unsaved', t('guardModeUnsaved')],
            ['hasNotes', t('guardModeHasNotes')],
            ['never', t('guardModeNever')],
          ],
          (v) => void patch({ guard: { ...current.guard, mode: v as GuardMode } }),
        ),
        numberField(
          'Watch at most this many tabs at once',
          current.guard.maxArmedTabs,
          0,
          12,
          (v) => void patch({ guard: { ...current.guard, maxArmedTabs: v } }),
        ),
        // The honest part. This is the whole reason this section has prose in it.
        el('p', { class: 'note' }, t('guardBestEffort')),
        el(
          'p',
          { class: 'note' },
          'Specifically: no browser lets an extension cancel a tab close. All this can do is ' +
            'ask Firefox to show its own "Leave page?" dialog, and Firefox only allows that on a ' +
            'page you have interacted with. It will not appear on a tab Firefox has unloaded, or ' +
            'when a tab is closed by another extension.',
        ),
        el(
          'p',
          { class: 'note' },
          'The limit above exists because closing a window with a dozen annotated tabs would ' +
            'otherwise ask you a dozen times, focusing each tab in turn.',
        ),
      ),
    ),
  );

  // ------------------------------------------------------------- keeping
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optKeeping')),
      el(
        'div',
        { class: 'inner' },
        numberField(
          'Days a deleted note stays in the trash',
          current.retention.trashDays,
          1,
          365,
          (v) => void patch({ retention: { ...current.retention, trashDays: v } }),
        ),
        /*
         * "Revisions kept per note" used to be here and has been taken out.
         *
         * `addRevision` and `shouldSnapshot` are written and tested in `bg/db/notes.ts`, and
         * **nothing calls either of them** -- no revision has ever been stored, so the number
         * governed nothing. The field stays in `Settings` so the day version history lands it
         * has somewhere to read from; the control goes, because a control that writes to
         * storage and changes nothing makes a promise the app does not keep.
         */
        checkField(
          'Let old notes be deleted automatically once their time is up',
          current.retention.autoDelete,
          (v) => void patch({ retention: { ...current.retention, autoDelete: v } }),
        ),
        el(
          'p',
          { class: 'note' },
          'Off by default. With it off, nothing is ever destroyed unless you empty the trash ' +
            'yourself — the trash simply grows, which is cheap.',
        ),
        checkField(
          'Keep notes made in private windows',
          current.persistPrivateNotes,
          (v) => void patch({ persistPrivateNotes: v }),
        ),
        el(
          'p',
          { class: 'note' },
          current.persistPrivateNotes
            ? 'Notes made in a private window are written to the database like any other.'
            : 'Notes made in a private window live in memory only and are gone when the last private window closes.',
        ),
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
        checkField(
          t('updatesDaily'),
          current.autoCheckUpdates,
          (v) => void patch({ autoCheckUpdates: v }),
        ),
        el(
          'p',
          { class: 'note' },
          'This is the only network request the extension can make, it is off unless you turn ' +
            'it on, and it asks for permission the first time. It sends no cookies, no ' +
            'referrer and nothing about you — it reads the release list and compares one ' +
            'version number. It cannot install anything: Firefox only updates an add-on that ' +
            'has been signed, so the button hands you the download page.',
        ),
      ),
    ),
  );

  // -------------------------------------------------------------- backup
  /*
   * Scheduled backup is NOT offered, and the two controls that used to be here are gone.
   *
   * They were a switch and an interval for something that does not exist: there is no alarm
   * that writes a backup, and the `downloads` permission an unattended write would need was
   * removed from the manifest precisely because nothing used it. The help text even promised
   * that "Firefox will ask the first time" -- it could not have, the permission is not
   * declared, not even optionally.
   *
   * So this section now says what is true. Manual export works, needs no permission at all,
   * and is one click away in the cabinet.
   */
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optBackup')),
      el(
        'div',
        { class: 'inner' },
        el(
          'p',
          { class: 'note' },
          'Export ZIP in the cabinet writes every note, its position, its style and its ' +
            'images to one archive, and needs no permission at all — the bytes are already ' +
            'here, so Firefox is simply handed a file to save.',
        ),
        el(
          'p',
          { class: 'note' },
          'There is no scheduled backup yet. Writing one unattended needs permission to your ' +
            'downloads folder, which this extension deliberately does not ask for while ' +
            'nothing uses it, so there is nothing to switch on here rather than a switch that ' +
            'does nothing.',
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
