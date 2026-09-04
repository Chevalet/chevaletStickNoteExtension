/**
 * Settings live in `storage.local`, not IndexedDB.
 *
 * Two reasons. They are small and read on nearly every wake, so a flat key-value store is
 * exactly right. And `storage.onChanged` fires in every context, so the popup, the options
 * page and every content script see a change without a single message being sent.
 *
 * Like extension IndexedDB, `storage.local` survives "clear cookies and site data" -- the
 * sanitizer excludes `moz-extension://` principals.
 */

import { DEFAULT_URL_MATCH, type UrlMatch } from '~/shared/types.ts';
import { DEFAULT_GUARD, type GuardSettings } from './guard/budget.ts';

export const SETTINGS_KEY = 'settings.v1';

export interface Settings {
  schemaV: number;
  /** Whether notes are shown on a site with no explicit rule. */
  defaultEnabled: boolean;
  /** Per-origin overrides, keyed by origin. */
  siteRules: Record<string, 'on' | 'off'>;
  guard: GuardSettings;
  urlMatchDefault: UrlMatch;
  retention: {
    trashDays: number;
    detachedDays: number;
    revisionsPerNote: number;
    /** Off by default: nothing is ever destroyed unless the user asks for it. */
    autoDelete: boolean;
  };
  backup: {
    enabled: boolean;
    everyHours: number;
    keepDaily: number;
    keepWeekly: number;
  };
  /**
   * How a new note looks, as a SPARSE diff against the built-in style.
   *
   * Sparse on purpose, and the same shape a note's own overrides take. A note stores only what
   * it changed, and resolves against this; this stores only what the user changed, and resolves
   * against `DEFAULT_STYLE`. So adding a style field in a later version reaches every existing
   * note and every existing default, instead of being frozen out by a snapshot taken before it
   * existed.
   *
   * Written by "Save as my default" in a note's settings panel, which is what the S key opens.
   */
  noteDefaults: Record<string, unknown>;
  /** Look for a new release once a day. Off by default: it is the only network call. */
  autoCheckUpdates: boolean;
  /** Notes in private windows are in-memory only unless this is turned on. */
  persistPrivateNotes: boolean;
  /** Hold this to make notes click-through so the page underneath can be read. */
  ghostModifier: 'Alt' | 'Control' | 'Shift' | 'none';
  /** `auto` follows prefers-reduced-motion. */
  motion: 'auto' | 'full' | 'reduced' | 'off';
  /**
   * The colours of the extension's own pages -- the cabinet, the options page, the popup.
   *
   * `auto` follows the browser's `prefers-color-scheme`. Notes themselves are NOT affected:
   * a note's colour is its paper, chosen per note or per default, and a sticky note that
   * changed colour because the operating system went dark would be a different note.
   */
  theme: 'auto' | 'light' | 'dark';
  /** Empty means "follow the browser". */
  locale: '' | 'en' | 'fa';
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schemaV: 1,
  defaultEnabled: true,
  siteRules: {},
  guard: { ...DEFAULT_GUARD },
  urlMatchDefault: { ...DEFAULT_URL_MATCH },
  retention: { trashDays: 30, detachedDays: 30, revisionsPerNote: 50, autoDelete: false },
  backup: { enabled: false, everyHours: 12, keepDaily: 7, keepWeekly: 4 },
  noteDefaults: {},
  autoCheckUpdates: false,
  persistPrivateNotes: false,
  ghostModifier: 'Alt',
  motion: 'auto',
  theme: 'auto',
  locale: '',
});

/**
 * Merge stored settings over the defaults, one level into each object.
 *
 * A shallow spread would drop every sibling of any nested field that has ever been written,
 * so a user who once changed `guard.mode` would silently lose `guard.maxArmedTabs` on the
 * next release that adds a field.
 */
export function mergeSettings(stored: unknown): Settings {
  const base = structuredCloneish(DEFAULT_SETTINGS);
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<Settings>;

  return {
    ...base,
    ...s,
    guard: { ...base.guard, ...(s.guard ?? {}) },
    urlMatchDefault: { ...base.urlMatchDefault, ...(s.urlMatchDefault ?? {}) },
    retention: { ...base.retention, ...(s.retention ?? {}) },
    backup: { ...base.backup, ...(s.backup ?? {}) },
    siteRules: { ...(s.siteRules ?? {}) },
    schemaV: base.schemaV,
  };
}

/** `structuredClone` is not available in every test environment; this only has to be enough. */
function structuredCloneish(s: Readonly<Settings>): Settings {
  return {
    ...s,
    guard: { ...s.guard },
    urlMatchDefault: { ...s.urlMatchDefault },
    retention: { ...s.retention },
    backup: { ...s.backup },
    siteRules: { ...s.siteRules },
  };
}

/**
 * Is the extension on for this page?
 *
 * Precedence: an explicit per-tab override beats a per-site rule, which beats the global
 * default. The tab override is deliberately the strongest -- it is the most specific thing
 * the user can have said, and it is the one they said most recently.
 */
export function isEnabledFor(settings: Settings, origin: string, tabOverride?: boolean): boolean {
  if (tabOverride !== undefined) return tabOverride;
  const rule = settings.siteRules[origin];
  if (rule) return rule === 'on';
  return settings.defaultEnabled;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const got = await browser.storage.local.get(SETTINGS_KEY);
    return mergeSettings(got[SETTINGS_KEY]);
  } catch {
    // A settings read must never be the thing that stops the extension working.
    return mergeSettings(null);
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = mergeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/** Set or clear one site's rule. Passing `undefined` removes it, back to the global default. */
export async function setSiteRule(
  origin: string,
  rule: 'on' | 'off' | undefined,
): Promise<Settings> {
  const current = await loadSettings();
  const siteRules = { ...current.siteRules };
  if (rule === undefined) {
    // Delete rather than store a redundant value, so the object does not grow forever.
    const { [origin]: _dropped, ...rest } = siteRules;
    return saveSettings({ siteRules: rest });
  }
  siteRules[origin] = rule;
  return saveSettings({ siteRules });
}
