/**
 * Content-script entry. Injected only into tabs that actually need it -- the background
 * registers this per origin-that-has-notes, so a site with no notes receives zero bytes.
 *
 * Plan sections 4-6. Current state: phase 2 (host + handshake). The note view, anchoring and
 * physics land on top of this without changing its shape.
 */

import { type CsToBg, type HelloReply, PROTOCOL_V, type Reply } from '~/bg/msg/protocol.ts';
import { createHost, type Host } from './host.ts';
import { SHEET_CSS } from './styles.ts';

declare const __DEV__: boolean;

let host: Host | null = null;

async function ask<T>(msg: CsToBg): Promise<Reply<T>> {
  try {
    return (await browser.runtime.sendMessage(msg)) as Reply<T>;
  } catch (e) {
    // "Extension context invalidated" means we are an orphan from a previous version.
    if (String(e).includes('context invalidated')) teardown('update');
    return { ok: false, code: 'INTERNAL', detail: String(e) };
  }
}

function teardown(reason: string): void {
  host?.destroy();
  host = null;
  if (__DEV__) console.warn(`[cn] torn down: ${reason}`);
}

function mount(): Host {
  if (host) return host;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET_CSS);
  host = createHost(sheet);
  return host;
}

async function boot(): Promise<void> {
  const reply = await ask<HelloReply>({ t: 'hello', url: location.href, protocolV: PROTOCOL_V });
  if (!reply.ok) return;

  const hello = reply.data;
  if (hello.protocolV !== PROTOCOL_V) return teardown('protocol mismatch');
  if (!hello.enabled) return;
  if (hello.noteCount === 0) return; // nothing to draw; stay resident but inert

  mount();
  // TODO(phase 3): resolve anchors and mount a NoteView per note.
}

browser.runtime.onMessage.addListener((msg: unknown) => {
  const t = (msg as { t?: string } | null)?.t;
  if (t === 'teardown') {
    teardown((msg as { reason: string }).reason);
    return Promise.resolve({ ok: true });
  }
  return undefined;
});

// A bfcache restore does not fire a navigation event the background can see, so the content
// script has to notice it and re-establish context itself.
window.addEventListener('pageshow', (e) => {
  if ((e as PageTransitionEvent).persisted) void boot();
});

void boot();
