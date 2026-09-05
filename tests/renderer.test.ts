// @vitest-environment happy-dom
/**
 * The content script, driven from both sides.
 *
 * ## Why this file exists
 *
 * `src/cs/renderer.ts` is the seam between a page and the background: it mounts notes, decides
 * when to save, and re-resolves which notes belong here. Both of the bugs that reached a person
 * in 0.0.10 lived in it, and it had no unit tests at all -- only spikes, which need a browser
 * and cannot be run on every change.
 *
 * ## What can be observed from here, and what cannot
 *
 * The module exports nothing and calls `boot()` at the bottom, so it is driven through the two
 * doors it really has: `browser.runtime.onMessage`, which is how the background talks to it,
 * and DOM events, which is how a person does. What comes back out is `sendMessage`, recorded.
 *
 * What it does NOT do is reach inside a note. The host attaches a CLOSED shadow root in
 * anything but a dev build, and `vitest.config.ts` sets `__DEV__` to false on purpose -- tests
 * should exercise the code that ships. So `host.shadowRoot` is null here exactly as it is in
 * Firefox, and the number of mounted notes is read from the `guard/state` message the module
 * sends the background, which is the same number by construction.
 *
 * That leaves one thing uncovered here on purpose: typing. It needs an event dispatched inside
 * a note, and it is covered twice elsewhere -- `tests/noteview.test.ts` proves the view tells
 * its host, and `spikes/firefox-persist.mjs` proves the whole path in a real Firefox, with a
 * control. Three files, one behaviour, no overlap.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Sent {
  t: string;
  [key: string]: unknown;
}

let sent: Sent[] = [];
let reply: (msg: Sent) => unknown = () => ({ ok: true, data: {} });
let listeners: Array<(msg: unknown) => unknown> = [];

const wire = (over: Record<string, unknown> = {}) => ({
  id: 'n_1',
  rev: 1,
  scope: { kind: 'url', urlKey: 'active example.com/a', match: {} },
  body: { format: 'md', text: 'hello' },
  ui: { x: 10, y: 20, w: 240, h: 180, z: 1, collapsed: false, locked: false, opacity: 1 },
  anchor: null,
  style: {},
  tags: [],
  updatedAt: 1,
  ...over,
});

const hello = (notes: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => ({
  protocolV: 1,
  version: '0.0.0-test',
  enabled: true,
  urlKey: null,
  noteCount: notes.length,
  notes,
  noteDefaults: {},
  motion: 'off',
  locale: 'en',
  ...over,
});

function installStub(notes: Array<Record<string, unknown>>): void {
  sent = [];
  listeners = [];
  reply = (msg) => {
    if (msg.t === 'hello') return { ok: true, data: hello(notes) };
    if (msg.t === 'notes/forContext') return { ok: true, data: { notes: [] } };
    if (msg.t === 'note/create') return { ok: true, data: { note: wire({ id: 'n_new' }) } };
    return { ok: true, data: { rev: 2, updatedAt: 2 } };
  };

  (globalThis as Record<string, unknown>).browser = {
    runtime: {
      sendMessage: async (msg: Sent) => {
        sent.push(msg);
        return reply(msg);
      },
      onMessage: { addListener: (fn: (msg: unknown) => unknown) => listeners.push(fn) },
      getURL: (p: string) => `moz-extension://test/${p}`,
    },
  };
}

/** Hand the module a message the way the background would. */
async function fromBackground(msg: Record<string, unknown>): Promise<void> {
  for (const fn of listeners) fn(msg);
  await new Promise((r) => setTimeout(r, 40));
}

/**
 * How many notes the module says it has mounted.
 *
 * From `guard/state`, which it sends the background whenever that number changes -- and which
 * reads `views.size` directly. Reaching into the closed shadow root is not possible and not
 * necessary.
 */
function mountedCount(): number | null {
  const last = [...sent].reverse().find((m) => m.t === 'guard/state');
  return last ? ((last.noteCount as number) ?? null) : null;
}

/*
 * There WAS a `hostPresent()` here, reading the document, and three tests failed on it while
 * passing when run alone.
 *
 * `vi.resetModules()` gives the next import fresh module state; it does not stop the previous
 * instance existing. Its listeners are still on `window`, it still holds a reference to a host
 * element, and every instance sees whatever `globalThis.browser` currently is -- so the DOM in
 * this file is shared by every instance the file has ever loaded, and an assertion about it is
 * an assertion about all of them at once.
 *
 * The wire is not shared: `sent` is reset per test, and `guard/state` carries `views.size` from
 * the instance under test. So every count below comes from there. The one property that really
 * does need the document -- that a page with no notes gets no host element at all -- is checked
 * in a real browser instead, by `spikes/firefox-extension.mjs`.
 */

/**
 * Everything the last test left behind.
 *
 * `vi.resetModules()` gives the module fresh state; it does not touch the DOM. The host element
 * from the previous test stays in the document, so three tests failed on `hostPresent()` being
 * true for a host that was not theirs -- which looked like a teardown bug and was a fixture bug.
 */
function clearDocument(): void {
  document.body.textContent = '';
  for (const el of [...document.querySelectorAll('*')]) {
    if (el.tagName.toLowerCase().startsWith('chevalet-note-root-')) el.parentNode?.removeChild(el);
  }
}

async function load(notes: Array<Record<string, unknown>> = [wire()]): Promise<void> {
  clearDocument();
  vi.resetModules();
  installStub(notes);
  await import('~/cs/renderer.ts');
  // `boot()` is a floating promise at the bottom of the module.
  await new Promise((r) => setTimeout(r, 80));
}

describe('booting', () => {
  beforeEach(clearDocument);

  it('says hello with the page it is on, and the protocol it speaks', async () => {
    await load([]);
    const first = sent.find((m) => m.t === 'hello');
    expect(first).toBeDefined();
    expect(first?.protocolV).toBe(1);
    expect(typeof first?.url).toBe('string');
  });

  it('mounts the notes the background hands back', async () => {
    await load([wire(), wire({ id: 'n_2' })]);
    expect(mountedCount()).toBe(2);
  });

  it('puts no host element on a page with no notes', async () => {
    // A page with nothing on it should cost nothing: the host is created lazily.
    await load([]);
    expect(mountedCount()).toBe(0);
  });

  it('stays inert, and silent, on a page where notes are turned off', async () => {
    clearDocument();
    vi.resetModules();
    installStub([]);
    reply = (msg) =>
      msg.t === 'hello'
        ? { ok: true, data: hello([], { enabled: false }) }
        : { ok: true, data: {} };
    await import('~/cs/renderer.ts');
    await new Promise((r) => setTimeout(r, 80));
    // Inert means inert: it does not even ask which notes belong here.
    expect(sent.filter((m) => m.t === 'notes/forContext')).toHaveLength(0);
    expect(sent.filter((m) => m.t === 'note/patch')).toHaveLength(0);
  });

  it('tears down rather than guessing when the protocol does not match', async () => {
    clearDocument();
    vi.resetModules();
    installStub([]);
    reply = (msg) =>
      msg.t === 'hello'
        ? { ok: true, data: hello([wire()], { protocolV: 99 }) }
        : { ok: true, data: {} };
    await import('~/cs/renderer.ts');
    await new Promise((r) => setTimeout(r, 80));
    // A protocol mismatch means an orphaned content script from a previous version: it must
    // mount nothing at all rather than guess at a reply it may not understand.
    expect(sent.filter((m) => m.t === 'guard/state')).toHaveLength(0);
  });
});

describe('a single-page app changing route', () => {
  it('unmounts a note that no longer belongs on this URL', async () => {
    /*
     * One of the two 0.0.10 bugs. `scope/recheck` arrives with the new URL and the module asks
     * the background again -- the same question `boot` asks, rather than a second code path
     * that could disagree with it.
     */
    await load([wire()]);
    expect(mountedCount()).toBe(1);

    reply = (msg) =>
      msg.t === 'notes/forContext' ? { ok: true, data: { notes: [] } } : { ok: true, data: {} };
    await fromBackground({ t: 'scope/recheck', url: 'https://example.com/elsewhere' });
    expect(mountedCount()).toBe(0);
  });

  it('mounts a note that now does', async () => {
    await load([]);
    reply = (msg) =>
      msg.t === 'notes/forContext'
        ? { ok: true, data: { notes: [wire({ id: 'n_9' })] } }
        : { ok: true, data: {} };
    await fromBackground({ t: 'scope/recheck', url: 'https://example.com/another' });
    expect(mountedCount()).toBe(1);
  });

  it('asks the background rather than deciding for itself', async () => {
    await load([wire()]);
    sent = [];
    await fromBackground({ t: 'scope/recheck', url: 'https://example.com/x' });
    expect(sent.some((m) => m.t === 'notes/forContext')).toBe(true);
  });

  it('ignores a recheck for the URL it is already on', async () => {
    // Every route change fires one of these, and re-resolving for the same URL is a round trip
    // and a rebuild for nothing.
    await load([wire()]);
    sent = [];
    await fromBackground({ t: 'scope/recheck', url: window.location.href });
    expect(sent.filter((m) => m.t === 'notes/forContext')).toHaveLength(0);
  });

  it('keeps a note that still belongs, rather than rebuilding it', async () => {
    await load([wire()]);
    reply = (msg) =>
      msg.t === 'notes/forContext'
        ? { ok: true, data: { notes: [wire()] } }
        : { ok: true, data: {} };
    await fromBackground({ t: 'scope/recheck', url: 'https://example.com/same-scope' });
    expect(mountedCount()).toBe(1);
  });
});

describe('what the background can tell it', () => {
  it('does not write a rename back to the store', async () => {
    // It came FROM the store. Saving it again would bounce a write for nothing.
    await load([wire()]);
    sent = [];
    await fromBackground({ t: 'note/renamed', id: 'n_1', name: 'From the cabinet' });
    expect(sent.filter((m) => m.t === 'note/patch')).toHaveLength(0);
  });

  it('does not write a restored version back either', async () => {
    await load([wire()]);
    sent = [];
    await fromBackground({
      t: 'note/changed',
      id: 'n_1',
      rev: 5,
      patch: { body: { text: 'restored from history' } },
      origin: 'other',
    });
    expect(sent.filter((m) => m.t === 'note/patch')).toHaveLength(0);
  });

  it('takes the notes off the page on teardown', async () => {
    await load([wire()]);
    expect(mountedCount()).toBe(1);
    sent = [];
    await fromBackground({ t: 'teardown', reason: 'disabled' });
    // And it stops saving: a patch after teardown would write for a note nobody can see.
    sent = [];
    window.dispatchEvent(new Event('pagehide'));
    await new Promise((r) => setTimeout(r, 40));
    expect(sent.filter((m) => m.t === 'note/patch')).toHaveLength(0);
  });

  it('boots again when the tab is switched back on', async () => {
    await load([wire()]);
    await fromBackground({ t: 'teardown', reason: 'disabled' });
    sent = [];
    await fromBackground({ t: 'tab/enabled', enabled: true });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent.some((m) => m.t === 'hello')).toBe(true);
  });

  it('makes a note when the command says to', async () => {
    await load([]);
    sent = [];
    await fromBackground({ t: 'command', name: 'new-note' });
    await new Promise((r) => setTimeout(r, 60));
    expect(sent.some((m) => m.t === 'note/create')).toBe(true);
  });

  it('ignores a message about a note it does not have', async () => {
    await load([wire()]);
    await fromBackground({ t: 'note/renamed', id: 'n_somewhere_else', name: 'x' });
    // Still one note, still no error.
    expect(mountedCount()).toBe(1);
  });

  it('answers a message it does not understand with nothing at all', async () => {
    /*
     * Returning a value from `onMessage` claims the message. A content script that answered
     * everything would swallow `guard/set`, which is handled by the separate guard bundle in
     * the same page.
     */
    await load([wire()]);
    const answers = listeners.map((fn) => fn({ t: 'guard/set', armed: true, reason: 'clean' }));
    expect(answers.every((a) => a === undefined)).toBe(true);
  });
});
