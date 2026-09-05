/**
 * Settings live in `storage.local`, not IndexedDB.
 *
 * Two reasons. They are small and read on nearly every wake, so a flat key-value store is
 * exactly right. And `storage.onChanged` fires in every context, so the popup, the options
 * page and every content script see a change without a single message being sent.
 *
 * Like extension IndexedDB, `storage.local` survives "clear cookies and site data" -- the
 * sanitizer excludes `moz-extension://` principals.
 *
 * ## Every field here is read by something
 *
 * 0.0.10 went through the settings PANE and removed the controls that nothing read. 0.0.11
 * went through this TYPE and removed four fields that no control offered and no code consumed:
 *
 *   urlMatchDefault        A per-user default for URL normalisation. `scope/match.ts` derives
 *                          its variants from `DEFAULT_URL_MATCH` directly and never consulted
 *                          this, so it was a knob wired to nothing. Per-site matching rules
 *                          are a real idea; they will need a different shape than one global
 *                          default, and inventing that shape in advance is how you get a field
 *                          that is wrong when the feature finally arrives.
 *   retention.detachedDays "Keep notes whose page vanished for N days". Nothing marks a note
 *                          detached -- there is no such state on a note record -- so the sweep
 *                          could never have used it.
 *   backup.keepDaily       Grandfather-father-son rotation for the scheduled backup, which
 *   backup.keepWeekly      turned out to be a ring of three fixed filenames. Two numbers
 *                          describing a policy that does not exist.
 *   ghostModifier          "Hold this key to make notes click-through." No key handler ever
 *                          looked at it, no page offered it, and the `toggle-ghost` command it
 *                          pairs with was declared in the protocol and never sent. Reading a
 *                          page under a note is a real want; it needs a design, not a
 *                          leftover field.
 *
 * Removing a field is safe: `mergeSettings` reads what it knows and ignores the rest, so a
 * profile that still has these keys in storage is unaffected.
 */

import { DEFAULT_GUARD, type GuardSettings } from './guard/budget.ts';

export const SETTINGS_KEY = 'settings.v1';

export interface Settings {
  schemaV: number;
  /** Whether notes are shown on a site with no explicit rule. */
  defaultEnabled: boolean;
  /** Per-origin overrides, keyed by origin. */
  siteRules: Record<string, 'on' | 'off'>;
  guard: GuardSettings;
  retention: {
    trashDays: number;
    revisionsPerNote: number;
    /** Off by default: nothing is ever destroyed unless the user asks for it. */
    autoDelete: boolean;
  };
  backup: {
    enabled: boolean;
    everyHours: number;
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
  /**
   * The language of the extension's own interface.
   *
   * `'en'` by DEFAULT, not `''`. Following the browser is a choice someone makes, not the
   * starting state: an extension that comes up in a language you did not ask for is
   * startling, even when it guesses right, and English is the language this is written in.
   */
  locale: '' | 'en' | 'fa';
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schemaV: 1,
  defaultEnabled: true,
  siteRules: {},
  guard: { ...DEFAULT_GUARD },
  retention: { trashDays: 30, revisionsPerNote: 50, autoDelete: false },
  backup: { enabled: false, everyHours: 12 },
  noteDefaults: {},
  autoCheckUpdates: false,
  persistPrivateNotes: false,
  motion: 'auto',
  theme: 'auto',
  locale: 'en',
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
