/**
 * Durable tab identity. Plan section 9.
 *
 * A `tabId` is not stable across a browser restart, so anything remembered per tab has to be
 * keyed by something that is. Firefox has exactly the right primitive for this and Chrome has
 * no equivalent: `browser.sessions.setTabValue` attaches data to the tab itself, and it comes
 * back through session restore, through undo-close, and through a tab being dragged to
 * another window.
 *
 * Notes are URL-scoped, so most of the product does not need this. What does need it is
 * per-tab state -- the on/off toggle, and knowing which closed tab had notes on it -- and
 * `tab`-scoped notes for people who want a scratchpad that follows one tab.
 */

import type { TabKey } from '~/shared/types.ts';

export const TAB_KEY = 'cn.tabKey.v1';
export const TAB_FLAGS = 'cn.flags.v1';

export interface TabValue {
  k: TabKey;
  v: 1;
  born: number;
}

export interface TabFlags {
  enabled?: boolean;
}

/** In-memory, hot. Rebuilt from `storage.session` on the first wake after a restart. */
const idToKey = new Map<number, TabKey>();
const keyToId = new Map<TabKey, number>();

const SESSION_MAP = 'map.tabIdToKey';

export function newTabKey(): TabKey {
  return `tk_${crypto.randomUUID()}`;
}

/** Drop the in-memory maps. Tests and `runtime.onStartup` use this. */
export function resetIdentity(): void {
  idToKey.clear();
  keyToId.clear();
}

async function readValue(tabId: number): Promise<TabValue | null> {
  try {
    return ((await browser.sessions.getTabValue(tabId, TAB_KEY)) as TabValue | undefined) ?? null;
  } catch {
    // A tab that has just gone away throws here. Not an error worth surfacing.
    return null;
  }
}

/**
 * Look up a tab's durable key, minting one only if asked.
 *
 * Four levels, cheapest first: memory, then `storage.session`, then the session store itself,
 * then mint. `create: false` is the default because minting for every tab a person opens
 * would fill the session store with keys for tabs that never get a note.
 */
export async function resolveTabKey(
  tabId: number,
  { create = false }: { create?: boolean } = {},
): Promise<TabKey | null> {
  const cached = idToKey.get(tabId);
  if (cached) return cached;

  const session = await sessionMap();
  const fromSession = session[String(tabId)];
  if (fromSession) {
    remember(tabId, fromSession);
    return fromSession;
  }

  const stored = await readValue(tabId);
  if (stored?.k) {
    remember(tabId, stored.k);
    await writeSessionMap();
    return stored.k;
  }

  if (!create) return null;

  const key = newTabKey();
  try {
    await browser.sessions.setTabValue(tabId, TAB_KEY, { k: key, v: 1, born: Date.now() });
  } catch {
    // Without the session store the key still works for this session; it just will not
    // survive a restart. Better than refusing to create the note.
  }
  remember(tabId, key);
  await writeSessionMap();
  return key;
}

function remember(tabId: number, key: TabKey): void {
  idToKey.set(tabId, key);
  keyToId.set(key, tabId);
}

export function forgetTab(tabId: number): void {
  const key = idToKey.get(tabId);
  idToKey.delete(tabId);
  if (key && keyToId.get(key) === tabId) keyToId.delete(key);
}

export function liveTabFor(key: TabKey): number | undefined {
  return keyToId.get(key);
}

// --------------------------------------------------------------- session map

/**
 * `storage.session` is exactly the right lifetime for this: cleared automatically on browser
 * restart, but it survives the event page being suspended. No epoch bookkeeping, and no
 * stale-map bugs after a restart.
 */
async function sessionMap(): Promise<Record<string, TabKey>> {
  try {
    const got = await browser.storage.session.get(SESSION_MAP);
    return (got[SESSION_MAP] as Record<string, TabKey> | undefined) ?? {};
  } catch {
    return {};
  }
}

async function writeSessionMap(): Promise<void> {
  const out: Record<string, TabKey> = {};
  for (const [id, key] of idToKey) out[String(id)] = key;
  try {
    await browser.storage.session.set({ [SESSION_MAP]: out });
  } catch {
    /* memory still has it; this is only a cache across suspensions */
  }
}

// ------------------------------------------------------------------- flags

export async function getTabFlags(tabId: number): Promise<TabFlags> {
  try {
    return ((await browser.sessions.getTabValue(tabId, TAB_FLAGS)) as TabFlags | undefined) ?? {};
  } catch {
    return {};
  }
}

/**
 * Per-tab on/off. Stored in the session store so "notes off for this tab" survives a browser
 * restart -- a small thing people notice immediately when it does not.
 */
export async function setTabEnabled(tabId: number, enabled: boolean | undefined): Promise<void> {
  try {
    if (enabled === undefined) await browser.sessions.removeTabValue(tabId, TAB_FLAGS);
    else await browser.sessions.setTabValue(tabId, TAB_FLAGS, { enabled });
  } catch {
    /* nothing to do: the resolved value simply falls back to the site rule */
  }
}

// ------------------------------------------------------------ duplicate tabs

/**
 * Firefox's Duplicate Tab clones extension tab values, so a brand-new tab can arrive already
 * holding a key that another LIVE tab is still using. Left alone, both tabs would show the
 * same `tab`-scoped notes and each would overwrite the other's per-tab state.
 *
 * Returns the key the new tab should end up with, and whether its tab-scoped notes should be
 * cloned along with it.
 */
export function resolveDuplicate(
  incoming: TabKey | null,
  isKeyLive: (key: TabKey) => boolean,
  behaviour: 'copy' | 'none' = 'copy',
): { key: TabKey; cloneNotes: boolean; wasDuplicate: boolean } {
  if (!incoming) return { key: newTabKey(), cloneNotes: false, wasDuplicate: false };
  if (!isKeyLive(incoming)) {
    // The key is real but its old tab is gone: this is a restore or an undo-close, and the
    // note should simply come back.
    return { key: incoming, cloneNotes: false, wasDuplicate: false };
  }
  // The key is in use by a live tab, so this is a duplicate. The page was duplicated, so the
  // stickies on it were too -- that is what people expect from Duplicate Tab.
  return { key: newTabKey(), cloneNotes: behaviour === 'copy', wasDuplicate: true };
}
