/**
 * Background entry -- a Firefox MV3 *event page*, not a service worker.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (plan section 1.1):
 * every `addListener` call must run at module top level, synchronously, before any `await`.
 * The event page is spun up to deliver an event; a listener registered after an await is
 * registered too late and the event is silently dropped. That failure mode is intermittent
 * and miserable to debug, so all registration lives here and nowhere else.
 *
 * Handlers themselves are async and start with `await ready()`, which lazily opens the
 * database and rehydrates the small amount of state the background keeps.
 */

import { DEFAULT_URL_MATCH } from '~/shared/types.ts';
import { errReply, type HelloReply, okReply, PROTOCOL_V, type Reply } from './msg/protocol.ts';
import { normalizeUrlFull, presetQueryPolicy } from './scope/normalize.ts';

declare const __DEV__: boolean;
declare const __VERSION__: string;

// --------------------------------------------------------------------------- listeners

browser.runtime.onMessage.addListener(onMessage);
browser.runtime.onInstalled.addListener(onInstalled);
browser.runtime.onStartup.addListener(() => void ready());
browser.commands.onCommand.addListener((name) => void onCommand(name));
// No action.onClicked listener: the manifest declares a default_popup, so it never fires.

// --------------------------------------------------------------------------- init

let readyPromise: Promise<void> | null = null;

/** Memoized rehydration. Cheap on purpose: the background holds no note index (plan §11). */
function ready(): Promise<void> {
  readyPromise ??= (async () => {
    // TODO(phase 1): open IndexedDB, load settings, rehydrate the tabId<->tabKey map.
    if (__DEV__) console.warn(`[cn bg] ready, v${__VERSION__}`);
  })();
  return readyPromise;
}

async function onInstalled(details: browser.runtime._OnInstalledDetails): Promise<void> {
  await ready();
  if (details.reason === 'update') {
    // Content scripts from the previous version are orphaned and will throw
    // "Extension context invalidated" on their next message. Tell them to tear down.
    // TODO(phase 2): re-inject fresh copies into matching loaded tabs.
  }
}

// --------------------------------------------------------------------------- messages

async function onMessage(
  msg: unknown,
  sender: browser.runtime.MessageSender,
): Promise<Reply<unknown>> {
  await ready();
  const t = (msg as { t?: string } | null)?.t;

  switch (t) {
    case 'hello': {
      const m = msg as { url: string; protocolV: number };
      if (m.protocolV !== PROTOCOL_V) return errReply('PROTOCOL', `expected v${PROTOCOL_V}`);

      // `sender.tab.id` is authoritative -- a content script never names its own tab.
      const tabId = sender.tab?.id;
      if (tabId === undefined) return errReply('INTERNAL', 'no sender tab');

      const parsed = normalizeUrlFull(m.url, {
        ...DEFAULT_URL_MATCH,
        query: presetQueryPolicy(safeHostname(m.url)),
      });

      const hello: HelloReply = {
        protocolV: PROTOCOL_V,
        version: __VERSION__,
        enabled: true,
        urlKey: parsed?.key ?? null,
        noteCount: 0, // TODO(phase 2): index lookup
        notes: [],
      };
      return okReply(hello);
    }

    default:
      return errReply('SCHEMA', `unknown message: ${String(t)}`);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// --------------------------------------------------------------------------- commands

async function onCommand(name: string): Promise<void> {
  await ready();
  if (name === 'open-manager') return openManager();
  // TODO(phase 3): new-note / toggle-tab / cycle-notes forward to the active tab.
}

async function openManager(): Promise<void> {
  const url = browser.runtime.getURL('ui/manager.html');
  const [open] = await browser.tabs.query({ url });
  if (open?.id !== undefined) await browser.tabs.update(open.id, { active: true });
  else await browser.tabs.create({ url });
}
