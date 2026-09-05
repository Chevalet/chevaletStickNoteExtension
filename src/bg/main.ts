/**
 * Background entry -- a Firefox MV3 *event page*, not a service worker.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (plan section 1.1):
 * every `addListener` call runs at module top level, synchronously, before any `await`. The
 * event page is spun up in order to deliver an event; a listener registered after an await is
 * registered too late and the event is dropped. That failure is intermittent and miserable to
 * debug, so all registration lives here and nowhere else.
 *
 * Handlers are async and start with `await ready()`, which lazily opens the database. The
 * background keeps deliberately little in memory: at ten thousand notes, rebuilding an index
 * would cost 60-150ms on every wake, and the event page wakes dozens of times a minute while
 * someone is browsing. An IndexedDB index lookup answers the same question in about 1ms.
 */

import { FONTS, faceFile } from '~/shared/fonts.ts';
import { t } from '~/shared/i18n.ts';
import type { NoteId } from '~/shared/types.ts';
import {
  allAssets,
  allNotes,
  countForContext,
  createNote,
  getAsset,
  getMeta,
  getNote,
  listTrash,
  type NotePatch,
  notesForContext,
  patchNote,
  purgeNote,
  putAsset,
  restoreNote,
  setMeta,
  setRevisionKeep,
  trashNote,
} from './db/notes.ts';
import { openDb } from './db/open.ts';
import type { NoteRecord } from './db/schema.ts';
import { allocate, DISARM_DELAY_MS, type TabGuardState } from './guard/budget.ts';
import { injectNow, mayAccess, syncRegistrations } from './inject.ts';
import { BACKUP_ALARM, type BackupState, hoursOf, runBackup } from './jobs/autobackup.ts';
import { buildArchive } from './jobs/backup.ts';
import { RETENTION_ALARM, RETENTION_PERIOD_MINUTES, runRetentionSweep } from './jobs/retention.ts';
import {
  checkForUpdate,
  UPDATE_ALARM,
  UPDATE_PERIOD_MINUTES,
  type UpdateInfo,
} from './jobs/update.ts';
import {
  errReply,
  type HelloReply,
  type NoteWire,
  okReply,
  PROTOCOL_V,
  type Reply,
} from './msg/protocol.ts';
import {
  DEFAULT_UI,
  sanitizeName,
  sanitizeStyle,
  sanitizeTags,
  sanitizeText,
  sanitizeUi,
} from './msg/sanitize.ts';
import { defaultScopeFor, matchContext } from './scope/match.ts';
import { isEnabledFor, loadSettings, type Settings, saveSettings } from './settings.ts';
import { forgetTab, getTabFlags, resolveTabKey, setTabEnabled } from './tabs/identity.ts';

/** Ten megabytes. Generous for a screenshot, far short of a video. */
const ASSET_MAX_BYTES = 10 * 1024 * 1024;
/** Raster images only, and only formats a canvas can decode without a codec of our own. */
const ASSET_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

declare const __DEV__: boolean;
declare const __VERSION__: string;

// --------------------------------------------------------------------- listeners

browser.runtime.onMessage.addListener(onMessage);
browser.runtime.onInstalled.addListener((d) => void onInstalled(d));
browser.runtime.onStartup.addListener(() => void onStartup());
browser.commands.onCommand.addListener((name) => void onCommand(name));
browser.menus.onClicked.addListener((info, tab) => void onMenuClicked(info, tab));
// A granted or revoked origin changes which pages we are registered on. These fire in the
// background even when the popup is what did the granting.
browser.alarms.onAlarm.addListener((a) => void onAlarm(a));
browser.permissions.onAdded.addListener(() => void onPermissionsChanged(true));
browser.permissions.onRemoved.addListener(() => void onPermissionsChanged(false));
browser.tabs.onRemoved.addListener((tabId, info) => void onTabRemoved(tabId, info));
browser.tabs.onUpdated.addListener((tabId, change, tab) => void onTabUpdated(tabId, change, tab));
browser.storage.onChanged.addListener((_changes, area) => {
  // Settings changed somewhere. Drop the cache; the next read picks it up.
  if (area === 'local') {
    settingsCache = null;
    void syncUpdateAlarm();
    void applyRevisionPolicy();
    // ...and tell every open tab, because the cabinet's settings pane writes straight to
    // storage rather than through a message. Without this the entire pane was inert in any
    // tab that was already open: a changed default, a changed direction, a changed movement
    // setting all sat in storage doing nothing until the page was reloaded.
    void broadcastSettings();
  }
});
// No action.onClicked listener: the manifest declares a default_popup, so it never fires.

// ------------------------------------------------------------------------ state

interface TabRuntime {
  noteCount: number;
  hasUnsaved: boolean;
  lastEdit: number;
  /** Notes in a private window that will never be written really do vanish on close. */
  volatile: boolean;
}

const tabRuntime = new Map<number, TabRuntime>();
const armedTabs = new Set<number>();
/**
 * How much movement is allowed, with `auto` resolved.
 *
 * `auto` has to consult the browser's reduced-motion preference, and the background is the
 * only context that can answer for every tab at once -- a content script could read its own
 * `matchMedia`, but then the answer would differ per page for no reason. `matchMedia` is
 * unavailable in an event page on some builds, so a failure resolves to `full` rather than
 * quietly pinning every note still.
 */
function resolveMotion(s: Settings): 'full' | 'reduced' | 'off' {
  if (s.motion !== 'auto') return s.motion;
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  } catch {
    return 'full';
  }
}

/**
 * Tell the store how many versions of a note to keep.
 *
 * The store cannot read settings itself -- it is the layer underneath them -- so the number
 * lives in a module-level policy that this sets on boot and on every settings change. Without
 * this call the setting would be a number in storage that nothing consults, which is the exact
 * class of dead control 0.0.10 went through the settings to remove.
 */
async function applyRevisionPolicy(): Promise<void> {
  setRevisionKeep((await settings()).retention.revisionsPerNote);
}

/** Push the current settings to every tab that has a renderer in it. */
async function broadcastSettings(): Promise<void> {
  const s = await settings();
  const payload = { t: 'defaults/changed', style: s.noteDefaults, motion: resolveMotion(s) };
  for (const tabId of tabRuntime.keys()) void tell(tabId, payload as never);
}

let settingsCache: Settings | null = null;
let readyPromise: Promise<void> | null = null;
let allocationTimer: ReturnType<typeof setTimeout> | null = null;

function ready(): Promise<void> {
  readyPromise ??= (async () => {
    await openDb().catch(() => undefined);
    // Before any patch can run, so the very first edit after a wake-up honours the setting.
    await applyRevisionPolicy().catch(() => undefined);
    if (__DEV__) console.warn(`[cn bg] ready, v${__VERSION__}`);
  })();
  return readyPromise;
}

async function settings(): Promise<Settings> {
  settingsCache ??= await loadSettings();
  return settingsCache;
}

// ------------------------------------------------------------------- lifecycle

async function onInstalled(details: browser.runtime._OnInstalledDetails): Promise<void> {
  await ready();
  await buildMenus();
  await syncRegistrations();
  await syncUpdateAlarm();
  if (details.reason !== 'update') return;
  // Content scripts from the previous version are orphaned: their next message throws
  // "Extension context invalidated". Tell the ones still loaded to tear down cleanly.
  for (const tab of await browser.tabs.query({}).catch(() => [])) {
    if (tab.id === undefined) continue;
    void tell(tab.id, { t: 'teardown', reason: 'update' });
  }
}

async function onStartup(): Promise<void> {
  await ready();
  tabRuntime.clear();
  armedTabs.clear();
  await buildMenus();
  await syncUpdateAlarm();
  // `persistAcrossSessions` should have carried these across the restart, but re-syncing is
  // cheap and a registration that silently failed to persist would mean an extension that
  // does nothing until reinstalled.
  await syncRegistrations();
}

/**
 * A permission was granted or revoked.
 *
 * On a grant we also inject into the tab in front of the user, because registration only
 * affects future navigations -- see inject.ts. On a revoke the pages we can no longer touch
 * are told to tear themselves down, so no note is left on screen that we cannot save.
 */
async function onPermissionsChanged(granted: boolean): Promise<void> {
  await ready();
  await syncRegistrations();

  if (granted) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) await injectNow(tab.id);
    return;
  }

  for (const tabId of [...tabRuntime.keys()]) {
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (!tab?.url) continue;
    if (!(await mayAccess(tab.url))) {
      void tell(tabId, { t: 'teardown', reason: 'revoked' });
      tabRuntime.delete(tabId);
    }
  }
  scheduleAllocation();
}

async function onTabRemoved(tabId: number, info: browser.tabs._OnRemovedRemoveInfo): Promise<void> {
  const had = tabRuntime.get(tabId);
  tabRuntime.delete(tabId);
  armedTabs.delete(tabId);
  forgetTab(tabId);

  // The recovery affordance. Nothing was lost -- the note reached the database well before
  // `beforeunload` could run -- but a visible "that tab had notes" is what stops the worry.
  if (had && had.noteCount > 0) {
    await browser.action.setBadgeText({ text: '↩' }).catch(() => undefined);
    await browser.action.setBadgeBackgroundColor({ color: '#ff2e63' }).catch(() => undefined);
    setTimeout(() => void browser.action.setBadgeText({ text: '' }).catch(() => undefined), 15_000);
    if (__DEV__) {
      console.warn(
        `[cn bg] tab ${tabId} closed with ${had.noteCount} note(s)${info.isWindowClosing ? ' (window closing)' : ''}`,
      );
    }
  }
  scheduleAllocation();
}

async function onTabUpdated(
  tabId: number,
  change: browser.tabs._OnUpdatedChangeInfo,
  tab: browser.tabs.Tab,
): Promise<void> {
  if (change.discarded !== undefined) {
    // No content process means no listener, so the slot should go to a tab that can use it.
    scheduleAllocation();
    return;
  }
  /*
   * A URL change with no page load: a single-page app calling pushState.
   *
   * This used to be dropped on the floor, because the handler returned unless
   * `status === 'complete'` -- and an in-page route change usually reports no status at
   * all. So the tab's note count went stale AND, far worse, the content script was never
   * told, and went on showing the previous page's notes. That is the reported bug: a note
   * made on /blog appearing on /blog/what-is-defi.
   */
  const routed = typeof change.url === 'string' && change.url.length > 0;
  if (!routed && (change.status !== 'complete' || !tab.url)) return;
  await ready();
  const url = change.url ?? tab.url;
  if (!url) return;
  await refreshTab(tabId, url, Boolean(tab.incognito));
  if (routed) void tell(tabId, { t: 'scope/recheck', url });
}

/** Recount a tab's notes and re-run the guard allocation. */
async function refreshTab(tabId: number, url: string, incognito: boolean): Promise<void> {
  const s = await settings();
  const key = await resolveTabKey(tabId);
  const ctx = matchContext(url, key ?? undefined);
  if (!ctx) {
    tabRuntime.delete(tabId);
    scheduleAllocation();
    return;
  }
  const count = await countForContext(ctx).catch(() => 0);
  const previous = tabRuntime.get(tabId);
  tabRuntime.set(tabId, {
    noteCount: count,
    hasUnsaved: previous?.hasUnsaved ?? false,
    lastEdit: previous?.lastEdit ?? 0,
    volatile: incognito && !s.persistPrivateNotes && count > 0,
  });
  scheduleAllocation();
}

// ------------------------------------------------------------------- the guard

/**
 * Re-run the allocation, coalesced.
 *
 * A window closing produces a burst of `onRemoved`, and a page load produces several
 * `onUpdated`. Allocating once per burst rather than once per event keeps this cheap.
 */
function scheduleAllocation(): void {
  if (allocationTimer) clearTimeout(allocationTimer);
  allocationTimer = setTimeout(() => void applyAllocation(), 120);
}

async function applyAllocation(): Promise<void> {
  const s = await settings();
  const now = Date.now();

  const tabs: TabGuardState[] = [];
  for (const [tabId, st] of tabRuntime) {
    // An edit counts as unsaved until the write is confirmed AND a grace window has passed.
    // Dropping the listener the instant a write lands would leave the guard absent during
    // exactly the gap that matters -- see DISARM_DELAY_MS.
    const pending = st.hasUnsaved || now - st.lastEdit < DISARM_DELAY_MS;
    tabs.push({
      tabId,
      noteCount: st.noteCount,
      hasUnsaved: pending,
      discarded: false,
      /**
       * "Portable" means every note in this tab comes back on its own: written to storage,
       * and scoped to something a fresh tab on the same page can find.
       *
       * This used to read `!st.volatile`, which is true for every ordinary tab -- and since
       * the default policy arms only a tab whose notes are NOT portable, the close warning
       * was silently never shown to anyone outside a private window. The feature was present,
       * tested as a unit, wired up, and dead.
       *
       * A pending write is exactly what makes portability untrue: the note would come back,
       * but without the edit that has not landed yet. A volatile private-window note is never
       * written at all.
       */
      onlyPortableNotes: !st.volatile && !pending,
      volatile: st.volatile,
      msSinceEdit: now - st.lastEdit,
    });
  }

  const { armed, disarmed } = allocate(tabs, s.guard);

  for (const tabId of armed) {
    if (armedTabs.has(tabId)) continue;
    armedTabs.add(tabId);
    void tell(tabId, { t: 'guard/set', armed: true, reason: 'policy' });
  }
  for (const tabId of disarmed) {
    if (!armedTabs.has(tabId)) continue;
    armedTabs.delete(tabId);
    void tell(tabId, { t: 'guard/set', armed: false, reason: 'budget' });
  }
}

/** Send to a tab, tolerating the very common "no content script there" case. */
async function tell(tabId: number, message: unknown): Promise<void> {
  await browser.tabs.sendMessage(tabId, message).catch(() => undefined);
}

// -------------------------------------------------------------------- messages

async function onMessage(
  msg: unknown,
  sender: browser.runtime.MessageSender,
): Promise<Reply<unknown>> {
  await ready();
  const type = (msg as { t?: string } | null)?.t;

  switch (type) {
    case 'hello':
      return hello(msg as { url: string; protocolV: number }, sender);

    case 'guard/state': {
      // `sender.tab.id` is authoritative. A content script never gets to name a tab.
      const tabId = sender.tab?.id;
      if (tabId === undefined) return errReply('INTERNAL', 'no sender tab');
      const m = msg as { hasUnsaved: boolean; noteCount: number };
      const previous = tabRuntime.get(tabId);
      tabRuntime.set(tabId, {
        noteCount: m.noteCount,
        hasUnsaved: m.hasUnsaved,
        lastEdit: m.hasUnsaved ? Date.now() : (previous?.lastEdit ?? 0),
        volatile: previous?.volatile ?? false,
      });
      scheduleAllocation();
      return okReply({ armed: armedTabs.has(tabId) });
    }

    case 'popup/status': {
      const tabId = (msg as { tabId: number }).tabId;
      const st = tabRuntime.get(tabId);
      const flags = await getTabFlags(tabId);
      return okReply({
        noteCount: st?.noteCount ?? (await countFor(tabId)),
        guardArmed: armedTabs.has(tabId),
        ...(flags.enabled === undefined ? {} : { tabOverride: flags.enabled }),
      });
    }

    case 'tab/setEnabled': {
      const m = msg as { tabId: number; enabled: boolean };
      await setTabEnabled(m.tabId, m.enabled);
      await tell(m.tabId, { t: 'tab/enabled', enabled: m.enabled });
      if (!m.enabled) {
        tabRuntime.delete(m.tabId);
        scheduleAllocation();
      }
      return okReply({ enabled: m.enabled });
    }

    case 'notes/forContext': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return errReply('INTERNAL', 'no sender tab');
      const ctx = matchContext(
        (msg as { url: string }).url,
        (await resolveTabKey(tabId)) ?? undefined,
      );
      if (!ctx) return okReply({ notes: [] });
      const records = await notesForContext(ctx).catch(() => []);
      return okReply({ notes: records.map(toWire) });
    }

    case 'note/create': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return errReply('INTERNAL', 'no sender tab');
      return createFor(msg as CreateMsg, tabId, sender);
    }

    case 'note/patch': {
      const m = msg as { id: NoteId; rev: number; patch: NotePatch };
      // rev 0 means "I am the only writer, do not check" -- the content script's own autosave
      // of a note nobody else is touching. A real base rev IS checked, so a genuine race with
      // the manager page is reported rather than silently clobbered.
      const base = m.rev > 0 ? m.rev : undefined;
      const result = await patchNote(m.id, sanitizePatch(m.patch), base);
      if (!result.ok) {
        // Hand back what is actually stored, so the caller can reconcile rather than guess.
        if (result.code === 'STALE_REV') return errReply('STALE_REV', String(result.current.rev));
        return errReply('NOT_FOUND');
      }
      touch(sender.tab?.id);
      return okReply({ rev: result.note.rev, updatedAt: result.note.updatedAt });
    }

    case 'note/restore': {
      const m = msg as { id: NoteId };
      if (!(await restoreNote(m.id))) return errReply('NOT_FOUND');
      const record = await getNote(m.id);
      if (!record) return errReply('NOT_FOUND');
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        const st = tabRuntime.get(tabId);
        if (st) st.noteCount += 1;
        scheduleAllocation();
      }
      return okReply({ note: toWire(record) });
    }

    case 'note/delete': {
      const m = msg as { id: NoteId; soft: boolean };
      // Soft by default, always. A note is someone's writing, and an undo that lives for a few
      // seconds in one tab is not an undo -- the trash in the manager is.
      if (m.soft) {
        if (!(await trashNote(m.id))) return errReply('NOT_FOUND');
      } else {
        if (!(await getNote(m.id))) return errReply('NOT_FOUND');
        await purgeNote(m.id);
      }
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        const st = tabRuntime.get(tabId);
        if (st) st.noteCount = Math.max(0, st.noteCount - 1);
        scheduleAllocation();
      }
      return okReply({ trashed: m.soft });
    }

    case 'asset/put': {
      const m = msg as { noteId: NoteId; name: string; type: string; bytes: ArrayBuffer };
      if (!(m.bytes instanceof ArrayBuffer))
        return errReply('SCHEMA', 'bytes must be an ArrayBuffer');
      // A hard ceiling. A note is not a photo album, and an unbounded paste is the easiest way
      // to fill someone's profile directory without them noticing.
      if (m.bytes.byteLength > ASSET_MAX_BYTES) return errReply('QUOTA', 'image too large');
      if (!ASSET_TYPES.has(m.type)) return errReply('SCHEMA', `unsupported type: ${m.type}`);
      if (!(await getNote(m.noteId))) return errReply('NOT_FOUND');
      const id = await putAsset(
        m.noteId,
        new Blob([m.bytes], { type: m.type }),
        m.name.slice(0, 200),
      );
      touch(sender.tab?.id);
      return okReply({ id });
    }

    case 'asset/get': {
      const record = await getAsset((msg as { id: string }).id as never);
      if (!record) return errReply('NOT_FOUND');
      // Back out as bytes, for the same cloning reason they came in that way.
      return okReply({
        id: record.id,
        type: record.blob.type,
        bytes: await record.blob.arrayBuffer(),
      });
    }

    case 'font/bytes': {
      const asked = String((msg as { file?: unknown }).file ?? '');
      /*
       * Matched against the table, never used as a path.
       *
       * The set of legal names is small, known, and derived from the same function the build
       * uses to write the files -- so this is an equality test against a whitelist, not a
       * sanitiser trying to think of every way a string can escape a directory.
       */
      const known = FONTS.some((f) => f.bundle?.files.some((x) => faceFile(f, x) === asked));
      if (!known) return errReply('SCHEMA', 'not a bundled font file');
      try {
        const res = await fetch(browser.runtime.getURL(`assets/fonts/${asked}`));
        if (!res.ok) return errReply('NOT_FOUND');
        return okReply({ file: asked, bytes: await res.arrayBuffer() });
      } catch {
        return errReply('NOT_FOUND');
      }
    }

    case 'settings/saveDefaults': {
      const style = sanitizeStyle((msg as { style?: unknown }).style);
      const current = await settings();
      // Merged, not replaced: the panel sends the whole resolved style, and anything it does
      // not mention should keep following the built-in default rather than being frozen.
      const next = { ...current.noteDefaults, ...style };
      await saveSettings({ ...current, noteDefaults: next });
      settingsCache = null;
      // Every open tab, so a default set on one page reaches notes on another. The
      // storage.onChanged listener would do this too; doing it here as well makes the
      // round trip immediate rather than waiting on the storage event.
      await broadcastSettings();
      return okReply({ noteDefaults: next });
    }

    case 'update/check': {
      const info = await runUpdateCheck((msg as { fromClick?: boolean }).fromClick === true);
      return okReply(info);
    }

    case 'backup/run': {
      const state = await runBackup(backupDeps());
      return okReply(state);
    }

    case 'note/rename': {
      const m = msg as { id: NoteId; name?: unknown };
      const result = await patchNote(m.id, { name: sanitizeName(m.name) ?? '' });
      if (!result.ok) return errReply('NOT_FOUND');
      for (const tabId of tabRuntime.keys()) {
        void tell(tabId, {
          t: 'note/renamed',
          id: m.id,
          name: result.note.name ?? '',
        } as never);
      }
      return okReply({ name: result.note.name ?? '' });
    }

    case 'note/touched': {
      const id = (msg as { id: NoteId }).id;
      const record = await getNote(id);
      if (!record) return errReply('NOT_FOUND');
      /*
       * To every tab with a renderer in it. Most of them will not have this note mounted and
       * will ignore it; the one that does replaces its text, unless someone is typing in it,
       * in which case their own words win.
       */
      for (const tabId of tabRuntime.keys()) {
        void tell(tabId, {
          t: 'note/changed',
          id,
          rev: record.rev,
          patch: { body: { text: record.body.text } },
          origin: 'other',
        });
      }
      return okReply({ rev: record.rev });
    }

    case 'command':
      await onCommand((msg as { name: string }).name);
      return okReply(null);

    default:
      return errReply('SCHEMA', `unknown message: ${String(type)}`);
  }
}

async function hello(
  m: { url: string; protocolV: number },
  sender: browser.runtime.MessageSender,
): Promise<Reply<HelloReply>> {
  if (m.protocolV !== PROTOCOL_V) return errReply('PROTOCOL', `expected v${PROTOCOL_V}`);

  const tabId = sender.tab?.id;
  if (tabId === undefined) return errReply('INTERNAL', 'no sender tab');

  const s = await settings();
  const key = await resolveTabKey(tabId);
  const ctx = matchContext(m.url, key ?? undefined);

  const quiet: HelloReply = {
    protocolV: PROTOCOL_V,
    version: __VERSION__,
    enabled: false,
    urlKey: null,
    noteCount: 0,
    notes: [],
    noteDefaults: {},
    motion: 'full',
  };
  if (!ctx) return okReply(quiet);

  const flags = await getTabFlags(tabId);
  const enabled = isEnabledFor(s, ctx.origin, flags.enabled);
  if (!enabled) return okReply(quiet);

  const records = await notesForContext(ctx).catch(() => []);

  tabRuntime.set(tabId, {
    noteCount: records.length,
    hasUnsaved: false,
    lastEdit: 0,
    volatile: Boolean(sender.tab?.incognito) && !s.persistPrivateNotes && records.length > 0,
  });
  scheduleAllocation();

  return okReply({
    protocolV: PROTOCOL_V,
    version: __VERSION__,
    enabled: true,
    urlKey: null,
    noteCount: records.length,
    notes: records.map(toWire),
    noteDefaults: s.noteDefaults,
    motion: resolveMotion(s),
  });
}

async function countFor(tabId: number): Promise<number> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.url) return 0;
  const ctx = matchContext(tab.url, (await resolveTabKey(tabId)) ?? undefined);
  return ctx ? await countForContext(ctx).catch(() => 0) : 0;
}

// ---------------------------------------------------------------------- writes

type CreateMsg = {
  url: string;
  note?: Partial<Omit<NoteWire, 'id' | 'rev' | 'updatedAt'>> & { body?: { text?: string } };
};

async function createFor(
  m: CreateMsg,
  tabId: number,
  sender: browser.runtime.MessageSender,
): Promise<Reply<{ note: NoteWire }>> {
  const s = await settings();
  const flags = await getTabFlags(tabId);
  const ctx = matchContext(m.url, (await resolveTabKey(tabId)) ?? undefined);
  if (!ctx) return errReply('READONLY', 'notes are not available on this page');
  if (!isEnabledFor(s, ctx.origin, flags.enabled)) {
    return errReply('READONLY', 'notes are turned off for this tab');
  }

  // The scope comes from the sender's own URL, never from the message body.
  const scope = defaultScopeFor(m.url);
  if (!scope) return errReply('READONLY', 'this page cannot be annotated');

  const incoming = m.note ?? {};
  const record = await createNote({
    scope,
    text: sanitizeText(incoming.body?.text),
    ui: sanitizeUi(incoming.ui),
    anchor: incoming.anchor ?? null,
    style: sanitizeStyle(incoming.style),
    tags: sanitizeTags(incoming.tags),
    context: {
      url: m.url,
      title: sender.tab?.title ?? '',
      ...(sender.tab?.favIconUrl ? { favIconUrl: sender.tab.favIconUrl } : {}),
    },
  });

  const st = tabRuntime.get(tabId);
  const privateAndUnwritten = Boolean(sender.tab?.incognito) && !s.persistPrivateNotes;
  tabRuntime.set(tabId, {
    noteCount: (st?.noteCount ?? 0) + 1,
    hasUnsaved: false,
    lastEdit: Date.now(),
    volatile: privateAndUnwritten || (st?.volatile ?? false),
  });
  scheduleAllocation();

  return okReply({ note: toWire(record) });
}

/**
 * A patch is a write too.
 *
 * Creation was clamped and patching was not, which meant every bound could be walked straight
 * past by editing a note instead of making one. `ui` is merged over the stored value rather
 * than replaced, so a patch that only moves a note keeps its size.
 */
function sanitizePatch(patch: NotePatch): NotePatch {
  const out: NotePatch = {};
  if (patch.body !== undefined) out.body = { text: sanitizeText(patch.body.text) };
  if (patch.name !== undefined) {
    // `?? ''` on purpose: an empty name is how the box is cleared, and `sanitizeName` returns
    // undefined for one. Dropping it here instead would make the name unclearable.
    out.name = sanitizeName(patch.name) ?? '';
  }
  if (patch.ui !== undefined) {
    // Sparse: only the keys actually sent are clamped and written.
    const full = sanitizeUi({ ...DEFAULT_UI, ...patch.ui });
    const partial: Partial<NoteWire['ui']> = {};
    for (const k of Object.keys(patch.ui) as Array<keyof NoteWire['ui']>) {
      if (k in full) (partial as Record<string, unknown>)[k] = full[k];
    }
    out.ui = partial;
  }
  if (patch.style !== undefined) out.style = sanitizeStyle(patch.style);
  if (patch.tags !== undefined) out.tags = sanitizeTags(patch.tags);
  if (patch.anchor !== undefined) out.anchor = patch.anchor;
  if (patch.ink !== undefined) out.ink = patch.ink;
  // `scope` is deliberately NOT copied. A content script does not get to move a note to
  // another page's notes; that is the manager's job, and it runs in our own context.
  return out;
}

/** Note the moment of a write, so the guard's "most recently edited" ordering is real. */
function touch(tabId: number | undefined): void {
  if (tabId === undefined) return;
  const st = tabRuntime.get(tabId);
  if (st) st.lastEdit = Date.now();
}

/**
 * Stored record -> wire shape.
 *
 * The index columns and field clocks stay in the background: they are an implementation detail
 * of how notes are found, and a content script that cannot see them cannot come to depend on
 * them.
 */
function toWire(r: NoteRecord): NoteWire {
  return {
    id: r.id,
    rev: r.rev,
    scope: r.scope,
    body: { format: 'md', text: r.body.text },
    ui: r.ui,
    anchor: r.anchor,
    style: r.style,
    tags: r.tags,
    updatedAt: r.updatedAt,
    ...(r.ink ? { ink: r.ink } : {}),
    ...(r.name ? { name: r.name } : {}),
  };
}

// --------------------------------------------------------------------- updates

/**
 * Look for a newer release, and remember the answer.
 *
 * The result is cached in settings storage rather than kept in memory, because the event page
 * is torn down between wakes and the options page needs to be able to show the last answer
 * without triggering a fresh network call every time it opens.
 */
async function runUpdateCheck(fromClick: boolean): Promise<UpdateInfo> {
  const info = await checkForUpdate({
    current: __VERSION__,
    mayRequestPermission: fromClick,
  });
  await browser.storage.local.set({ lastUpdateCheck: info }).catch(() => undefined);

  // A badge, not a dialog. An extension that interrupts you to talk about itself is a bad
  // houseguest, and this one's whole premise is staying out of the way.
  if (info.newer) {
    await browser.action.setBadgeText({ text: '↑' }).catch(() => undefined);
    await browser.action.setBadgeBackgroundColor({ color: '#0d7d78' }).catch(() => undefined);
    await browser.action
      .setTitle({ title: `Chevalet Note ${info.latest} is available` })
      .catch(() => undefined);
  }
  return info;
}

/**
 * Arm or disarm the two periodic jobs to match the settings.
 *
 * Both are cleared when their setting is off rather than left armed and short-circuited in the
 * handler, so an extension with everything turned off wakes for nothing at all.
 */
async function syncUpdateAlarm(): Promise<void> {
  const s = await settings();

  if (s.autoCheckUpdates) {
    // create() replaces an existing alarm of the same name, so this is idempotent.
    browser.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_PERIOD_MINUTES });
  } else {
    await browser.alarms.clear(UPDATE_ALARM).catch(() => undefined);
  }

  if (s.retention.autoDelete) {
    browser.alarms.create(RETENTION_ALARM, { periodInMinutes: RETENTION_PERIOD_MINUTES });
  } else {
    await browser.alarms.clear(RETENTION_ALARM).catch(() => undefined);
  }

  if (s.backup.enabled) {
    browser.alarms.create(BACKUP_ALARM, { periodInMinutes: hoursOf(s) * 60 });
  } else {
    await browser.alarms.clear(BACKUP_ALARM).catch(() => undefined);
  }
}

const BACKUP_STATE = 'backup.last';

/**
 * Everything the backup job needs, wired to the real browser.
 *
 * The download deliberately waits for the browser to accept the file before resolving. This is
 * an event page: it can be shut down the moment the handler returns, and a revoked blob URL
 * mid-download would produce a truncated zip -- which is worse than no backup, because it
 * looks like one.
 */
function backupDeps() {
  return {
    notes: allNotes,
    assets: allAssets,
    build: (input: Parameters<typeof buildArchive>[0]) => buildArchive(input),
    hasPermission: () => browser.permissions.contains({ permissions: ['downloads'] }),
    readState: () => getMeta<BackupState>(BACKUP_STATE),
    writeState: (state: BackupState) => setMeta(BACKUP_STATE, state),
    download: async (bytes: Uint8Array, filename: string): Promise<number> => {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      try {
        return await browser.downloads.download({
          url,
          filename,
          // The ring rotates by slot, so overwriting is the point: three files, in turn.
          conflictAction: 'overwrite',
          saveAs: false,
        });
      } finally {
        // Revoked only after the browser has taken the URL, and late enough that it has
        // finished reading it.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
  };
}

async function onAlarm(alarm: browser.alarms.Alarm): Promise<void> {
  await ready();
  if (alarm.name === UPDATE_ALARM) {
    // No click behind this, so it can only use a permission already granted.
    await runUpdateCheck(false);
    return;
  }
  if (alarm.name === BACKUP_ALARM) {
    const state = await runBackup(backupDeps());
    if (__DEV__) console.warn(`[cn] backup ${state.ok ? 'ok' : 'failed'}`, state);
    return;
  }
  if (alarm.name === RETENTION_ALARM) {
    // The only thing in the extension that destroys a note without being asked to, which is
    // why it is off by default and why `jobs/retention.ts` refuses to date a note it cannot.
    const s = await settings();
    const purged = await runRetentionSweep(s, { listTrash, purgeNote });
    if (__DEV__ && purged > 0) console.warn(`[cn] retention sweep purged ${purged} note(s)`);
  }
}

// ----------------------------------------------------------------------- menu

const MENU_NEW = 'cn-new-note';
const MENU_SELECTION = 'cn-note-on-selection';
const MENU_MANAGER = 'cn-open-manager';

/**
 * Build the context menu.
 *
 * Idempotent, because it runs on install and on every browser start, and `create` throws on a
 * duplicate id. `removeAll` first is cheaper than tracking what already exists.
 */
async function buildMenus(): Promise<void> {
  await browser.menus.removeAll().catch(() => undefined);
  const contexts: browser.menus.ContextType[] = ['page', 'image', 'link'];
  try {
    browser.menus.create({
      id: MENU_NEW,
      title: t('menuNewNote'),
      contexts,
    });
    browser.menus.create({
      id: MENU_SELECTION,
      title: t('menuNoteOnSelection'),
      contexts: ['selection'],
    });
    browser.menus.create({
      id: MENU_MANAGER,
      title: t('menuOpenManager'),
      contexts: ['page', 'selection', 'browser_action'],
    });
  } catch (e) {
    if (__DEV__) console.warn('[cn bg] menu build failed', e);
  }
}

async function onMenuClicked(
  info: browser.menus.OnClickData,
  tab: browser.tabs.Tab | undefined,
): Promise<void> {
  await ready();
  if (info.menuItemId === MENU_MANAGER) return openManager();
  if (tab?.id === undefined) return;

  // targetElementId is the whole point of using menus rather than a shortcut here: it lets the
  // content script ask the browser which element was right-clicked, so the note lands where
  // the person actually pointed instead of in a corner.
  await tell(tab.id, {
    t: 'command',
    name: info.menuItemId === MENU_SELECTION ? 'note-on-selection' : 'new-note',
    ...(info.targetElementId === undefined ? {} : { targetElementId: info.targetElementId }),
  });
}

// -------------------------------------------------------------------- commands

async function onCommand(name: string): Promise<void> {
  await ready();
  if (name === 'open-manager') return openManager();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;

  if (name === 'toggle-tab') {
    const flags = await getTabFlags(tab.id);
    const next = !(flags.enabled ?? true);
    await setTabEnabled(tab.id, next);
    await tell(tab.id, { t: 'tab/enabled', enabled: next });
    return;
  }

  // new-note and cycle-notes belong to the renderer, which may not be loaded there yet.
  await tell(tab.id, { t: 'command', name });
}

async function openManager(): Promise<void> {
  const url = browser.runtime.getURL('ui/manager.html');
  const [open] = await browser.tabs.query({ url });
  if (open?.id !== undefined) await browser.tabs.update(open.id, { active: true });
  else await browser.tabs.create({ url });
}
