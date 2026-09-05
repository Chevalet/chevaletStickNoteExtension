/**
 * The popup: what is happening on this tab, and the two or three things you want from here.
 *
 * Deliberately small. It answers "are notes on here?", "will I be warned before this closes?"
 * and "let me at the cabinet" -- and it is where host access is granted, because Firefox MV3
 * does not grant it at install, so this is the only place a person can actually say yes.
 */

import { explain } from '~/bg/guard/budget.ts';
import { isEnabledFor, loadSettings, type Settings, setSiteRule } from '~/bg/settings.ts';
import { isRtl, setLang, t } from '~/shared/i18n.ts';
import { applyTheme, asThemeChoice, THEME_CSS } from '../chrome-theme.ts';

declare const __VERSION__: string;

interface TabInfo {
  tabId: number;
  url: string;
  origin: string;
  enabled: boolean;
  noteCount: number;
  hasAccess: boolean;
  discarded: boolean;
  guardArmed: boolean;
  guardReason: string;
}

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

function btn(label: string, onClick: () => void, kind = ''): HTMLButtonElement {
  const b = el('button', { class: `btn ${kind}`.trim(), type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

const POPUP_CSS = /* css */ `${THEME_CSS}
* { box-sizing: border-box; }
body {
  margin: 0; width: 320px; background: var(--paper); color: var(--ink);
  font: 13px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace;
}
header {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 12px; background: var(--bar); color: var(--bar-fg);
  border-bottom: 3px solid var(--accent);
}
header img { width: 22px; height: 22px; display: block; }
header b { font-size: 13px; }
header .v { margin-inline-start: auto; color: var(--cyan); font-size: 11px; }
.body { padding: 12px; display: grid; gap: 10px; }
.row { display: flex; align-items: center; gap: 8px; }
.site { font-size: 12px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { font-weight: 700; font-size: 15px; }
.note { margin: 0; font-size: 11.5px; color: var(--dim); line-height: 1.45; }
.btn {
  all: unset; box-sizing: border-box; padding: 5px 10px; cursor: pointer;
  font: 700 12px/1.5 inherit; background: var(--hi); color: var(--on-hi);
  border: 2px solid var(--on-hi); box-shadow: 3px 3px 0 var(--accent); text-align: center;
}
.btn:hover { transform: translate(1px,1px); box-shadow: 2px 2px 0 var(--accent); }
.btn:active { transform: translate(3px,3px); box-shadow: none; }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn.ghost { background: transparent; color: var(--ink); box-shadow: none; border-color: color-mix(in oklab, var(--ink) 35%, transparent); }
.btn.wide { width: 100%; }
.toggle { display: flex; align-items: center; gap: 8px; }
.toggle .lamp { width: 11px; height: 11px; border: 2px solid var(--edge); background: var(--dim); }
.toggle.on .lamp { background: var(--accent); }
.guard { padding: 8px 10px; border: 2px solid color-mix(in oklab, var(--ink) 20%, transparent); }
.guard b { display: block; font-size: 11.5px; margin-bottom: 3px; }
.grants { display: grid; gap: 6px; }
hr { border: 0; border-top: 2px solid color-mix(in oklab, var(--ink) 15%, transparent); margin: 2px 0; }
@media (forced-colors: active) {
  .btn { border: 1px solid ButtonBorder; background: ButtonFace; color: ButtonText; box-shadow: none; }
  .toggle .lamp { border: 1px solid ButtonBorder; }
}
`;

/** `https://a.b.example.com` becomes `*://*.example.com/*`, so subdomains come along. */
function wildcardFor(origin: string): string {
  try {
    const host = new URL(origin).hostname;
    const parts = host.split('.');
    const base = parts.length > 2 ? parts.slice(-2).join('.') : host;
    return `*://*.${base}/*`;
  } catch {
    return '*://*/*';
  }
}

async function readTab(settings: Settings): Promise<TabInfo | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url) return null;

  let origin = '';
  try {
    const u = new URL(tab.url);
    if (u.protocol === 'http:' || u.protocol === 'https:') origin = u.origin;
  } catch {
    /* about:, view-source: and friends have no origin we can ask for */
  }

  const hasAccess = origin
    ? await browser.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)
    : false;

  // Only the background knows the note count and who currently holds a guard slot.
  const reply = (await browser.runtime
    .sendMessage({ t: 'popup/status', tabId: tab.id })
    .catch(() => null)) as {
    ok?: boolean;
    data?: { noteCount: number; guardArmed: boolean; tabOverride?: boolean };
  } | null;

  const noteCount = reply?.data?.noteCount ?? 0;
  const guardArmed = reply?.data?.guardArmed ?? false;
  const discarded = Boolean(tab.discarded);

  return {
    tabId: tab.id,
    url: tab.url,
    origin,
    enabled: isEnabledFor(settings, origin, reply?.data?.tabOverride),
    noteCount,
    hasAccess,
    discarded,
    guardArmed,
    guardReason: explain(
      {
        tabId: tab.id,
        noteCount,
        // The popup does not know about in-flight edits; the background's own allocation
        // already accounts for them, so this only has to explain the visible outcome.
        hasUnsaved: false,
        discarded,
        onlyPortableNotes: true,
        volatile: false,
        msSinceEdit: Number.POSITIVE_INFINITY,
      },
      settings.guard,
      guardArmed,
    ),
  };
}

async function render(): Promise<void> {
  const settings = await loadSettings().catch(() => null);
  // The theme is chosen in the cabinet, and the popup obeys it. Applied before anything is
  // drawn, so the panel never opens light and then turns dark under the cursor.
  applyTheme(asThemeChoice(settings?.theme));
  setLang(settings?.locale ?? '');
  document.body.dir = isRtl() ? 'rtl' : 'ltr';

  const info = settings ? await readTab(settings) : null;

  document.body.textContent = '';

  const logo = el('img');
  logo.src = '../assets/logo.svg';
  logo.alt = '';
  document.body.append(
    el(
      'header',
      {},
      logo,
      el('b', {}, t('extName')),
      el('span', { class: 'v' }, `v${__VERSION__}`),
    ),
  );

  const body = el('div', { class: 'body' });
  document.body.append(body);

  if (!info) {
    body.append(
      el('p', { class: 'note' }, t('popNoAccess')),
      btn(t('popOpenCabinet'), () => void openManager(), 'wide ghost'),
    );
    return;
  }

  body.append(el('div', { class: 'site' }, info.origin || info.url));

  // Access first: nothing else here works without it.
  if (!info.hasAccess && info.origin) {
    body.append(
      el('p', { class: 'note' }, t('popNoAccess')),
      el(
        'div',
        { class: 'grants' },
        btn(t('popGrantSite'), () => void grant([`${info.origin}/*`]), 'wide'),
        btn(t('popGrantDomain'), () => void grant([wildcardFor(info.origin)]), 'wide ghost'),
        btn(t('popGrantAll'), () => void grant(['*://*/*']), 'wide ghost'),
      ),
      el('hr'),
    );
  }

  body.append(
    el(
      'div',
      { class: `toggle ${info.enabled ? 'on' : ''}`.trim() },
      el('span', { class: 'lamp' }),
      el('span', {}, info.enabled ? t('popEnabled') : t('popDisabled')),
    ),
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'count' }, String(info.noteCount)),
      el('span', {}, t('mgrNotes')),
    ),
    btn(
      info.enabled ? t('popDisabled') : t('popEnabled'),
      () => void setEnabled(info, !info.enabled),
      'wide ghost',
    ),
  );

  /*
   * The heading is the state; the line under it is why.
   *
   * When the guard IS armed those are the same sentence -- `guardWillWarn` and what `explain()`
   * returns for an armed tab are word for word identical -- so the popup printed "Will warn
   * before this tab closes." twice, once bold and once not. There is nothing to add in that
   * case, so nothing is added.
   *
   * (`explain()` is English-only, so a reason under a Persian heading is still English. That is
   * a wider gap than this release closes -- the strings inside a note are untranslated too --
   * but it is at least no longer showing the same sentence twice.)
   */
  const guardBox = el(
    'div',
    { class: 'guard' },
    el('b', {}, info.guardArmed ? t('guardWillWarn') : t('guardModeUnsaved')),
  );
  if (!info.guardArmed && info.guardReason) {
    guardBox.append(el('span', { class: 'note' }, info.guardReason));
  }

  body.append(
    el('hr'),
    guardBox,
    // Said here, plainly, once -- rather than being implied by whether a warning appears.
    el('p', { class: 'note' }, t('guardBestEffort')),
  );

  body.append(
    el('hr'),
    btn(t('popNewNote'), () => void command('new-note'), 'wide'),
    btn(t('popOpenCabinet'), () => void openManager(), 'wide ghost'),
  );
}

async function grant(origins: string[]): Promise<void> {
  // `permissions.request` needs a user gesture, which a click handler is.
  await browser.permissions.request({ origins }).catch(() => false);
  await render();
}

async function setEnabled(info: TabInfo, enabled: boolean): Promise<void> {
  await browser.runtime
    .sendMessage({ t: 'tab/setEnabled', tabId: info.tabId, enabled })
    .catch(() => null);
  if (info.origin) await setSiteRule(info.origin, enabled ? 'on' : 'off').catch(() => null);
  await render();
}

async function command(name: string): Promise<void> {
  await browser.runtime.sendMessage({ t: 'command', name }).catch(() => null);
  window.close();
}

async function openManager(): Promise<void> {
  await browser.tabs.create({ url: browser.runtime.getURL('ui/manager.html') });
  window.close();
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(POPUP_CSS);
document.adoptedStyleSheets = [sheet];

void render().catch((e: unknown) => {
  document.body.append(el('pre', { class: 'note' }, String(e)));
});
