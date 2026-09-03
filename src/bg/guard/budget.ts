/**
 * Who gets to warn before closing. Plan section 8.
 *
 * What is actually possible, stated once so nothing downstream promises more:
 *
 *   You CANNOT cancel a tab close from the background. `tabs.onRemoved` is a notification
 *   fired after the fact; there is no `onBeforeRemoved` and no cancellable variant in any
 *   browser. The only mechanism that exists is a `beforeunload` listener inside the page,
 *   calling preventDefault(), which asks Firefox to show ITS dialog with ITS wording.
 *
 *   That dialog does not appear at all without sticky activation, on a discarded tab, on
 *   about:/pdf.js/AMO/quarantined origins, when `dom.disable_beforeunload` is set, or when
 *   the tab is closed by `tabs.remove()` -- including by another extension.
 *
 * So the guard is a courtesy, and the guarantee is elsewhere: the note is already in the
 * database before `beforeunload` can even run.
 *
 * This module answers one question: given what the tabs are doing, which of them should
 * currently have a listener attached? Two constraints make that non-trivial.
 *
 *   1. Closing a window with twelve annotated tabs must not produce twelve dialogs, with
 *      Firefox focusing each tab in turn. Hence a budget.
 *   2. A `beforeunload` listener makes a page ineligible for the bfcache, so leaving one
 *      attached permanently would slow back/forward navigation on exactly the pages the user
 *      cares about most. Hence arm-and-disarm rather than always-on.
 */

export type GuardMode = 'never' | 'unsaved' | 'hasNotes';

export interface GuardSettings {
  mode: GuardMode;
  /** How many tabs may hold a listener at once. */
  maxArmedTabs: number;
}

export const DEFAULT_GUARD: Readonly<GuardSettings> = Object.freeze({
  mode: 'unsaved',
  maxArmedTabs: 3,
});

/** What the background knows about one tab, as far as the guard is concerned. */
export interface TabGuardState {
  tabId: number;
  /** Notes currently mounted in that tab. */
  noteCount: number;
  /** Edits the content script has not yet had confirmed as written. */
  hasUnsaved: boolean;
  /** A discarded tab has no content process, so it cannot prompt at all. */
  discarded: boolean;
  /** Notes that reappear anywhere (url/domain/global scope) have nothing to lose. */
  onlyPortableNotes: boolean;
  /** Private-window notes that are never written really are about to vanish. */
  volatile: boolean;
  /** Milliseconds since the last edit in that tab. Used to rank for the budget. */
  msSinceEdit: number;
}

/**
 * Is this tab even a candidate?
 *
 * Kept separate from the ranking so the two reasons a tab is not armed -- "it does not
 * qualify" and "it lost the budget" -- stay distinguishable in the UI.
 */
export function qualifies(tab: TabGuardState, settings: GuardSettings): boolean {
  if (settings.mode === 'never') return false;
  if (tab.noteCount === 0) return false;
  // No content process means no listener, so claiming a slot would waste it.
  if (tab.discarded) return false;

  // A private-window note that will never be written is the one case worth interrupting for
  // even under the quietest policy: this really is the last chance to keep it.
  if (tab.volatile) return true;

  if (settings.mode === 'hasNotes') return true;
  if (!tab.hasUnsaved) return false;
  // Nothing is at risk if every note here would reappear on any tab showing this page.
  return !tab.onlyPortableNotes;
}

/**
 * Choose which tabs hold a listener.
 *
 * Ranked by recency of editing, because the tab you were just typing in is the one whose
 * warning you would actually want. Volatile tabs outrank everything: they are the only ones
 * where closing genuinely destroys something.
 */
export function allocate(
  tabs: readonly TabGuardState[],
  settings: GuardSettings = DEFAULT_GUARD,
): { armed: number[]; disarmed: number[] } {
  const candidates = tabs.filter((t) => qualifies(t, settings));
  const ranked = [...candidates].sort((a, b) => {
    if (a.volatile !== b.volatile) return a.volatile ? -1 : 1;
    if (a.hasUnsaved !== b.hasUnsaved) return a.hasUnsaved ? -1 : 1;
    return a.msSinceEdit - b.msSinceEdit;
  });

  const limit = Math.max(0, settings.maxArmedTabs);
  const armed = ranked.slice(0, limit).map((t) => t.tabId);
  const armedSet = new Set(armed);
  const disarmed = tabs.filter((t) => !armedSet.has(t.tabId)).map((t) => t.tabId);
  return { armed, disarmed };
}

/**
 * Why a tab is not armed, in words a person can act on.
 *
 * The popup shows this instead of leaving someone to wonder why they were not warned -- an
 * unexplained missing warning is worse than a documented one.
 */
export function explain(tab: TabGuardState, settings: GuardSettings, armed: boolean): string {
  if (armed) return 'Will warn before this tab closes.';
  if (settings.mode === 'never') return 'Close warnings are turned off in settings.';
  if (tab.noteCount === 0) return 'No notes on this page.';
  if (tab.discarded) return 'Firefox has unloaded this tab, so it cannot be warned about.';
  if (settings.mode === 'unsaved' && !tab.hasUnsaved) return 'Everything here is already saved.';
  if (settings.mode === 'unsaved' && tab.onlyPortableNotes) {
    return 'These notes reappear on any tab showing this page, so nothing is at risk.';
  }
  return `Another tab is being edited more recently (at most ${settings.maxArmedTabs} tabs are watched at a time).`;
}

/**
 * How long after the last confirmed write to keep the listener attached.
 *
 * Not zero: an autosave confirms, then the user types one more character. Dropping the
 * listener the instant a write lands would mean the guard is absent exactly during the gap
 * that matters. Not long either, because of the bfcache cost.
 */
export const DISARM_DELAY_MS = 3000;
