/**
 * Settings.
 *
 * The only opinionated thing here is the close-warning section, which says plainly what the
 * feature can and cannot do. A setting that quietly over-promises is worse than one that is
 * missing: someone would rely on a warning that a browser will not always show.
 */

import type { GuardMode } from '~/bg/guard/budget.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from '~/bg/settings.ts';
import { isRtl, setLang, t } from '~/shared/i18n.ts';

declare const __VERSION__: string;

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

const OPTIONS_CSS = /* css */ `
:root { --ink:#14110e; --paper:#f2ece0; --card:#fffdf6; --hi:#ffe94a; --accent:#ff2e63; --cyan:#7ef0ff; --dim:#6f665a; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 60px;
  background: var(--paper); color: var(--ink);
  font: 14px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace;
}
header {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 22px; background: var(--ink); color: var(--hi);
  border-bottom: 3px solid var(--accent);
}
header img { width: 26px; height: 26px; }
header .v { margin-inline-start: auto; color: var(--cyan); font-size: 12px; }
main { max-width: 720px; margin: 0 auto; padding: 22px; display: grid; gap: 18px; }
section { background: var(--card); border: 3px solid var(--ink); box-shadow: 5px 5px 0 var(--ink); }
section > h2 {
  margin: 0; padding: 8px 14px; background: var(--ink); color: var(--hi);
  font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
}
section > .inner { padding: 14px; display: grid; gap: 12px; }
label.field { display: grid; gap: 4px; }
label.field > span { font-size: 12.5px; }
label.inline { display: flex; align-items: center; gap: 8px; }
p.note { margin: 0; font-size: 12px; color: var(--dim); line-height: 1.55; }
p.warn { margin: 0; font-size: 12px; color: var(--accent); line-height: 1.55; }
select, input[type="number"] {
  all: unset; box-sizing: border-box; padding: 5px 8px; width: 100%;
  background: color-mix(in oklab, var(--hi) 22%, #fff);
  border: 2px solid var(--ink); font: inherit; cursor: pointer;
}
input[type="checkbox"] { accent-color: var(--accent); width: 16px; height: 16px; cursor: pointer; }
select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
table.facts { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.facts td { padding: 4px 6px; border-bottom: 1px solid color-mix(in oklab, var(--ink) 12%, transparent); }
table.facts td:last-child { text-align: end; white-space: nowrap; }
.yes { color: #0d7a3d; font-weight: 700; }
.no { color: var(--accent); font-weight: 700; }
a { color: inherit; text-decoration-color: var(--accent); }
.saved { position: fixed; inset: auto 0 0 0; padding: 6px 22px; background: var(--ink); color: var(--cyan); font-size: 12px; }
@media (forced-colors: active) {
  section { border: 1px solid CanvasText; box-shadow: none; }
  select, input { border: 1px solid ButtonBorder; background: Field; color: FieldText; }
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
  return el('label', { class: 'field' }, el('span', {}, label), sel);
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
  const input = el('input', {
    type: 'number',
    min: String(min),
    max: String(max),
  }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('change', () => {
    const v = Math.max(min, Math.min(max, Number(input.value)));
    input.value = String(v);
    onChange(v);
  });
  return el('label', { class: 'field' }, el('span', {}, label), input);
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
        numberField(
          'Revisions kept per note',
          current.retention.revisionsPerNote,
          1,
          200,
          (v) => void patch({ retention: { ...current.retention, revisionsPerNote: v } }),
        ),
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

  // -------------------------------------------------------------- backup
  main.append(
    el(
      'section',
      {},
      el('h2', {}, t('optBackup')),
      el(
        'div',
        { class: 'inner' },
        checkField(
          'Write a ZIP backup automatically',
          current.backup.enabled,
          (v) => void patch({ backup: { ...current.backup, enabled: v } }),
        ),
        numberField(
          'Hours between backups',
          current.backup.everyHours,
          1,
          168,
          (v) => void patch({ backup: { ...current.backup, everyHours: v } }),
        ),
        el(
          'p',
          { class: 'note' },
          'Unattended backups need permission to write to your downloads folder; Firefox will ' +
            'ask the first time. Exporting by hand from the cabinet needs no permission at all.',
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
  icon.href = '../assets/logo-mark.svg';
  document.head.append(icon);

  current = await loadSettings();
  setLang(current.locale);
  render();
}

void boot().catch((e: unknown) => {
  document.body.append(el('pre', {}, String(e)));
});
