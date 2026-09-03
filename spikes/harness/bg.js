/**
 * chevaletNote spike harness -- background.
 *
 * Throwaway code. Its only job is to answer the phase-0 questions with evidence:
 *
 *   R5a  Does `sessions.setTabValue` survive restart / undo-close / duplicate / detach?
 *   R5b  How does IndexedDB behave at 10k notes? (measured in panel.js, same origin)
 *   R1   Does a content-script `beforeunload` actually prompt on tab close?
 *   R2   Which CSP-immune asset techniques really work?
 *   R6   Does the shadow host survive real sites?
 *
 * Everything is appended to a durable event log in storage.local so it can be read back
 * AFTER a browser restart -- which is exactly the case R5a cares about.
 */

const TAB_KEY = 'cn.spike.tabKey.v1';
const LOG_KEY = 'cn.spike.log';
const RESULTS_KEY = 'cn.spike.results';
const LOG_CAP = 800;

// ---------------------------------------------------------------------------
// Listener registration MUST be top-level and synchronous on a Firefox event page.
// Anything registered after an await is silently dropped. This file is also a live
// demonstration of that constraint.
// ---------------------------------------------------------------------------

browser.runtime.onInstalled.addListener((d) => log('runtime.onInstalled', { reason: d.reason }));
browser.runtime.onStartup.addListener(() => log('runtime.onStartup', { note: 'browser started' }));

browser.tabs.onCreated.addListener(onCreated);
browser.tabs.onUpdated.addListener(onUpdated);
browser.tabs.onRemoved.addListener(onRemoved);
browser.tabs.onAttached.addListener((id, i) => log('tabs.onAttached', { id, win: i.newWindowId }));
browser.tabs.onDetached.addListener((id, i) => log('tabs.onDetached', { id, win: i.oldWindowId }));
browser.tabs.onReplaced.addListener((n, o) => log('tabs.onReplaced', { newId: n, oldId: o }));

browser.action.onClicked.addListener(openPanel);
browser.runtime.onMessage.addListener(onMessage);

// ---------------------------------------------------------------------------

async function log(event, data) {
  const entry = { t: Date.now(), event, ...data };
  const store = await browser.storage.local.get(LOG_KEY);
  const list = store[LOG_KEY] ?? [];
  list.push(entry);
  if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP);
  await browser.storage.local.set({ [LOG_KEY]: list });
}

/** Read the durable key attached to a tab by the session store. */
async function readKey(tabId) {
  try {
    return (await browser.sessions.getTabValue(tabId, TAB_KEY)) ?? null;
  } catch (e) {
    return { error: String(e) };
  }
}

async function mint(tabId, why) {
  const value = { k: `tk_${crypto.randomUUID()}`, v: 1, born: Date.now() };
  await browser.sessions.setTabValue(tabId, TAB_KEY, value);
  await log('mint', { tabId, key: value.k, why });
  return value;
}

async function onCreated(tab) {
  const existing = await readKey(tab.id);
  if (existing?.k) {
    // R5a's most interesting question: Firefox's Duplicate Tab clones session tab values,
    // so a brand-new tab can arrive already holding a key that another LIVE tab still uses.
    const all = await browser.tabs.query({});
    const collision = [];
    for (const t of all) {
      if (t.id === tab.id) continue;
      const k = await readKey(t.id);
      if (k?.k === existing.k) collision.push(t.id);
    }
    await log('onCreated.hadKey', {
      tabId: tab.id,
      key: existing.k,
      openerTabId: tab.openerTabId ?? null,
      liveCollisionWith: collision,
      verdict: collision.length ? 'DUPLICATE (value was cloned)' : 'restore / undo-close',
    });
  } else {
    await log('onCreated.fresh', { tabId: tab.id, url: tab.url });
  }
}

async function onUpdated(tabId, change, tab) {
  if (change.discarded !== undefined) {
    const k = await readKey(tabId);
    await log('onUpdated.discarded', {
      tabId,
      discarded: change.discarded,
      keyStillReadable: Boolean(k?.k),
      key: k?.k ?? null,
    });
  }
  if (change.status === 'complete' && tab.url && /^https?:|^file:/.test(tab.url)) {
    let key = await readKey(tabId);
    if (!key?.k) key = await mint(tabId, 'first load');
    await log('onUpdated.complete', { tabId, url: tab.url, key: key.k });
  }
  if (change.url) await log('onUpdated.url', { tabId, url: change.url });
}

async function onRemoved(tabId, info) {
  await log('tabs.onRemoved', { tabId, isWindowClosing: info.isWindowClosing });
}

async function openPanel() {
  const url = browser.runtime.getURL('panel.html');
  const [open] = await browser.tabs.query({ url });
  if (open) await browser.tabs.update(open.id, { active: true });
  else await browser.tabs.create({ url });
}

async function onMessage(msg, sender) {
  switch (msg?.t) {
    case 'log':
      await log(msg.event, msg.data ?? {});
      return { ok: true };

    case 'probe-result': {
      // Results from the in-page probe (R2 + R6), keyed by origin so repeat visits overwrite.
      const store = await browser.storage.local.get(RESULTS_KEY);
      const all = store[RESULTS_KEY] ?? {};
      all[msg.origin] = { at: Date.now(), ...msg.result };
      await browser.storage.local.set({ [RESULTS_KEY]: all });
      return { ok: true };
    }

    case 'tab-map': {
      const tabs = await browser.tabs.query({});
      const rows = [];
      for (const t of tabs) {
        rows.push({
          id: t.id,
          windowId: t.windowId,
          index: t.index,
          discarded: Boolean(t.discarded),
          incognito: t.incognito,
          cookieStoreId: t.cookieStoreId,
          title: (t.title ?? '').slice(0, 60),
          url: (t.url ?? '').slice(0, 90),
          key: (await readKey(t.id))?.k ?? null,
        });
      }
      return { ok: true, rows };
    }

    case 'time-getTabValue': {
      // R5a(i): how expensive is reading the key for every tab on a cold start?
      const tabs = await browser.tabs.query({});
      const t0 = performance.now();
      await Promise.all(tabs.map((t) => browser.sessions.getTabValue(t.id, TAB_KEY)));
      return { ok: true, tabs: tabs.length, ms: +(performance.now() - t0).toFixed(1) };
    }

    case 'inject-probe': {
      // R6: inject into whatever tab the panel names, so hostile sites can be swept quickly.
      try {
        await browser.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['probe.js'] });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    case 'set-guard': {
      // R1: arm or disarm the beforeunload guard in a specific tab.
      try {
        await browser.tabs.sendMessage(msg.tabId, { t: 'guard', armed: msg.armed });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }

    case 'close-tab-via-api': {
      // R1(5): confirm tabs.remove() bypasses beforeunload entirely.
      await log('close-tab-via-api', { tabId: msg.tabId });
      await browser.tabs.remove(msg.tabId);
      return { ok: true };
    }

    case 'recently-closed': {
      const list = await browser.sessions.getRecentlyClosed({ maxResults: 25 });
      return {
        ok: true,
        rows: list.map((e) => ({
          kind: e.tab ? 'tab' : 'window',
          sessionId: e.tab?.sessionId ?? e.window?.sessionId,
          title: (e.tab?.title ?? `window (${e.window?.tabs?.length ?? 0} tabs)`).slice(0, 70),
          url: (e.tab?.url ?? '').slice(0, 90),
        })),
      };
    }

    case 'restore-session': {
      const restored = await browser.sessions.restore(msg.sessionId);
      const tabId = restored.tab?.id;
      const key = tabId ? await readKey(tabId) : null;
      await log('sessions.restore', { sessionId: msg.sessionId, tabId, keyBack: key?.k ?? null });
      return { ok: true, tabId, key: key?.k ?? null };
    }

    case 'reopen-and-reattach': {
      // The recovery path the plan promises: recreate a tab and hand it back its old key.
      const tab = await browser.tabs.create({ url: msg.url, active: false });
      await browser.sessions.setTabValue(tab.id, TAB_KEY, { k: msg.key, v: 1, born: Date.now() });
      const back = await readKey(tab.id);
      await log('reopen-and-reattach', { tabId: tab.id, wanted: msg.key, got: back?.k ?? null });
      return { ok: true, tabId: tab.id, key: back?.k ?? null };
    }

    case 'request-hosts': {
      const granted = await browser.permissions.request({ origins: msg.origins });
      await log('permissions.request', { origins: msg.origins, granted });
      return { ok: true, granted };
    }

    case 'get-store': {
      const s = await browser.storage.local.get([LOG_KEY, RESULTS_KEY]);
      return { ok: true, log: s[LOG_KEY] ?? [], results: s[RESULTS_KEY] ?? {} };
    }

    case 'clear-store':
      await browser.storage.local.remove([LOG_KEY, RESULTS_KEY]);
      return { ok: true };

    default:
      return { ok: false, error: `unknown message ${msg?.t} from ${sender?.id}` };
  }
}
