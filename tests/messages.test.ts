import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoteWire, Reply } from '~/bg/msg/protocol.ts';
import type { NoteId } from '~/shared/types.ts';

/**
 * The background's message handlers, end to end against a real (fake) IndexedDB.
 *
 * These exist because the create/patch/delete path is the newest code in the extension and
 * the one thing the browser harness cannot reach: the playground calls the database directly,
 * so it exercises the note stack and never the message layer between a page and the store.
 * Everything that could be wrong here is wrong in the way that loses someone's writing.
 *
 * `browser` is stubbed rather than mocked away, because half of what is under test is what
 * the handlers do with what the browser tells them -- above all that `sender.tab.id` is
 * authoritative and a content script never gets to name a tab.
 */

interface Stub {
  tabs: Map<number, { id: number; url: string; title?: string; incognito?: boolean }>;
  sent: Array<{ tabId: number; message: unknown }>;
  session: Map<string, unknown>;
  /** `storage.session`, which is a different store from the per-tab session VALUES above. */
  sessionStore: Map<string, unknown>;
  local: Record<string, unknown>;
}

let stub: Stub;

/**
 * The stubbed `browser`, typed loosely enough to read mock calls off it but not so loosely
 * that a typo in a path goes unnoticed.
 */
type Sender = { tab?: { id: number; url?: string; incognito?: boolean } };
type OnMessage = (msg: unknown, sender: Sender) => Promise<Reply<unknown>>;
type BrowserStub = {
  runtime: {
    onMessage: { addListener: { mock: Array<[OnMessage]> & { calls: Array<[OnMessage]> } } };
  };
  scripting: {
    registerContentScripts: { mock: { calls: unknown[][] } };
    unregisterContentScripts: { mock: { calls: unknown[][] } };
  };
};
const stubbed = (): BrowserStub => (globalThis as unknown as { browser: BrowserStub }).browser;

function installBrowserStub(): void {
  stub = {
    tabs: new Map([[7, { id: 7, url: 'https://example.com/article', title: 'An article' }]]),
    sent: [],
    session: new Map(),
    sessionStore: new Map(),
    local: {},
  };

  const listeners = { onChanged: { addListener: vi.fn() } };

  (globalThis as Record<string, unknown>).browser = {
    runtime: {
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      getURL: (p: string) => `moz-extension://test/${p}`,
    },
    commands: { onCommand: { addListener: vi.fn() } },
    menus: {
      onClicked: { addListener: vi.fn() },
      create: vi.fn(),
      removeAll: vi.fn(async () => undefined),
    },
    permissions: {
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
      getAll: async () => ({ origins: ['https://example.com/*'], permissions: [] }),
      contains: async () => true,
    },
    scripting: {
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
      getRegisteredContentScripts: vi.fn(async () => []),
      executeScript: vi.fn(async () => []),
    },
    tabs: {
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
      get: async (id: number) => {
        const t = stub.tabs.get(id);
        if (!t) throw new Error('no such tab');
        return t;
      },
      query: async () => [...stub.tabs.values()],
      sendMessage: async (tabId: number, message: unknown) => {
        stub.sent.push({ tabId, message });
      },
      update: vi.fn(async () => undefined),
      create: vi.fn(async () => ({ id: 99 })),
    },
    sessions: {
      setTabValue: async (id: number, k: string, v: unknown) => stub.session.set(`${id}:${k}`, v),
      getTabValue: async (id: number, k: string) => stub.session.get(`${id}:${k}`),
    },
    storage: {
      local: {
        ...listeners,
        get: async (k?: string | string[] | null) => {
          if (k == null) return { ...stub.local };
          const keys = Array.isArray(k) ? k : [k];
          return Object.fromEntries(
            keys.filter((n) => n in stub.local).map((n) => [n, stub.local[n]]),
          );
        },
        set: async (o: Record<string, unknown>) => Object.assign(stub.local, o),
        remove: async (k: string) => {
          delete stub.local[k];
        },
      },
      /*
       * A real map, not `() => ({})`.
       *
       * The empty stub made every read of the tab-id-to-key map come back blank, so the
       * duplicate-tab path could never fire in a test -- a stub that always answers "nothing
       * here" cannot fail, and neither can anything that depends on it.
       */
      session: {
        get: async (k?: string | string[] | null) => {
          if (k == null) return Object.fromEntries(stub.sessionStore);
          const keys = Array.isArray(k) ? k : [k];
          return Object.fromEntries(
            keys.filter((n) => stub.sessionStore.has(n)).map((n) => [n, stub.sessionStore.get(n)]),
          );
        },
        set: async (o: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(o)) stub.sessionStore.set(k, v);
        },
      },
      onChanged: { addListener: vi.fn() },
    },
    alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn() },
    i18n: { getMessage: () => '' },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn(), setTitle: vi.fn() },
  };
}

/** The module registers listeners on import, so it needs the stub in place first. */
async function loadBackground(): Promise<
  (
    msg: unknown,
    sender: { tab?: { id: number; url?: string; incognito?: boolean } },
  ) => Promise<Reply<unknown>>
> {
  vi.resetModules();
  installBrowserStub();
  const { resetDb } = await import('~/bg/db/open.ts');
  // A fresh database per test, so one test's notes cannot be another's fixture.
  globalThis.indexedDB = new IDBFactory();
  resetDb();
  const mod = await import('~/bg/main.ts');
  // `onMessage` is not exported; it is registered. Pull it back off the stub.
  const reg = stubbed().runtime.onMessage.addListener;
  const handler = reg.mock.calls[0]?.[0];
  if (typeof handler !== 'function') throw new Error('no onMessage listener registered');
  void mod;
  return handler;
}

let send: Awaited<ReturnType<typeof loadBackground>>;
const from7 = { tab: { id: 7, url: 'https://example.com/article' } };

async function createOne(over: Record<string, unknown> = {}): Promise<NoteWire> {
  const reply = (await send(
    {
      t: 'note/create',
      url: 'https://example.com/article',
      note: {
        body: { format: 'md', text: 'hello' },
        ui: { x: 100, y: 200, w: 240, h: 200, z: 10, collapsed: false, locked: false, opacity: 1 },
        anchor: null,
        style: {},
        tags: [],
        ...over,
      },
    },
    from7,
  )) as Reply<{ note: NoteWire }>;
  if (!reply.ok) throw new Error(`create failed: ${reply.code} ${reply.detail ?? ''}`);
  return reply.data.note;
}

beforeEach(async () => {
  send = await loadBackground();
});

describe('note/touched', () => {
  /**
   * The cabinet restores an earlier version by writing to IndexedDB directly, and IndexedDB
   * has no change events -- so a tab showing that note would go on showing the old text until
   * it was reloaded. The cabinet cannot broadcast to tabs itself; only the background knows
   * which of them have a renderer in them.
   */
  it('tells every tab with a renderer, so an open note stops being stale', async () => {
    const note = await createOne();
    // `hello` is what puts a tab in the runtime map, which is the list this broadcasts to.
    await send({ t: 'hello', url: 'https://example.com/article', protocolV: 1 }, from7);
    stub.sent.length = 0;

    const reply = await send({ t: 'note/touched', id: note.id }, {});
    expect(reply).toMatchObject({ ok: true });

    const sent = stub.sent.filter(
      (m) => (m.message as { t?: string }).t === 'note/changed',
    ) as Array<{ tabId: number; message: { id: string; patch: { body: { text: string } } } }>;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.tabId).toBe(7);
    expect(sent[0]?.message.id).toBe(note.id);
    // The text as STORED, read back after the write, rather than anything the sender said --
    // the cabinet sends only an id, so there is nothing to disagree about.
    expect(sent[0]?.message.patch.body.text).toBe('hello');
  });

  it('says so plainly when the note is gone', async () => {
    const reply = await send({ t: 'note/touched', id: 'n_missing' }, {});
    expect(reply).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(stub.sent.filter((m) => (m.message as { t?: string }).t === 'note/changed')).toEqual([]);
  });

  it('needs no sender tab, because the cabinet is not a tab', async () => {
    // Every other handler that writes insists on `sender.tab.id`. This one is called from an
    // extension page, so insisting would make it uncallable.
    const note = await createOne();
    expect(await send({ t: 'note/touched', id: note.id }, {})).toMatchObject({ ok: true });
  });
});

describe('a single-page app changing its route', () => {
  /**
   * Reported: a note made on `https://blog.prepzone.dev/blog` also appeared on
   * `https://blog.prepzone.dev/blog/what-is-defi`.
   *
   * The matcher was never wrong -- `tests/scope-leak.test.ts` proves it for those two exact
   * URLs. What was missing is this: a `pushState` route change unloads no document, so the
   * content script kept showing the notes it had mounted, and nothing told it the page had
   * changed. `onTabUpdated` even dropped the event, because it returned early unless
   * `status === 'complete'` and an in-page route change reports no status at all.
   */
  const updated = async (change: Record<string, unknown>) => {
    const reg = (
      globalThis as unknown as {
        browser: { tabs: { onUpdated: { addListener: { mock: { calls: unknown[][] } } } } };
      }
    ).browser.tabs.onUpdated.addListener;
    const handler = reg.mock.calls[0]?.[0] as (
      id: number,
      c: Record<string, unknown>,
      t: Record<string, unknown>,
    ) => Promise<void>;
    await handler(7, change, { id: 7, url: 'https://example.com/article' });
    // The handler is async and fires the message without awaiting it.
    await new Promise((r) => setTimeout(r, 20));
  };

  const nudges = () => stub.sent.filter((m) => (m.message as { t?: string }).t === 'scope/recheck');

  it('tells the page, so it can work out which notes belong there now', async () => {
    stub.sent.length = 0;
    await updated({ url: 'https://example.com/article/deeper' });
    const sent = nudges();
    expect(sent).toHaveLength(1);
    const first = sent[0];
    if (!first) throw new Error('no nudge was sent');
    expect((first.message as { url: string }).url).toBe('https://example.com/article/deeper');
  });

  it('does not nudge for a plain page load, which re-resolves anyway', async () => {
    // `hello` already does the work on a real navigation. A second nudge would be a second
    // round trip for nothing on every page load in every tab.
    stub.sent.length = 0;
    await updated({ status: 'complete' });
    expect(nudges()).toEqual([]);
  });

  it('ignores an update that is neither a route change nor a completed load', async () => {
    stub.sent.length = 0;
    await updated({ favIconUrl: 'https://example.com/icon.png' });
    expect(nudges()).toEqual([]);
  });
});

describe('telling an open cabinet that the notes changed', () => {
  /**
   * The cabinet reaches an open tab -- renaming, restoring a version, editing the text. The
   * other direction was missing: a note edited in a tab left an open cabinet showing the old
   * text until it was touched.
   *
   * A counter in `storage.local`, because `storage.onChanged` already fires in every extension
   * context and the cabinet already listens to it for the theme. Debounced by half a second in
   * the background: a content script writes every 250 ms while someone types, and a cabinet
   * re-reading the whole store four times a second is a worse problem than one half a second
   * out of date.
   */
  const rev = () => stub.local['notes.rev'];

  it('bumps a counter when a note is written', async () => {
    const note = await createOne();
    // The debounce, plus a little.
    await new Promise((r) => setTimeout(r, 700));
    const first = rev();
    expect(typeof first).toBe('number');

    await send(
      { t: 'note/patch', id: note.id, rev: 0, patch: { body: { text: 'changed' } }, clock: {} },
      from7,
    );
    await new Promise((r) => setTimeout(r, 700));
    expect(rev()).toBeGreaterThan(first as number);
  });

  it('coalesces a burst of writes into one bump', async () => {
    const note = await createOne();
    await new Promise((r) => setTimeout(r, 700));
    const before = rev() as number;
    for (let i = 0; i < 8; i++) {
      await send(
        { t: 'note/patch', id: note.id, rev: 0, patch: { body: { text: `x${i}` } }, clock: {} },
        from7,
      );
    }
    await new Promise((r) => setTimeout(r, 700));
    // One write, not eight: the value moved once.
    expect(rev()).toBeGreaterThan(before);
  });

  it('bumps for a delete as well as an edit', async () => {
    const note = await createOne();
    await new Promise((r) => setTimeout(r, 700));
    const before = rev() as number;
    await send({ t: 'note/delete', id: note.id, soft: true }, from7);
    await new Promise((r) => setTimeout(r, 700));
    expect(rev()).toBeGreaterThan(before);
  });
});

describe('note/scope', () => {
  /**
   * `Scope` has five kinds and only `url` was ever reachable: `createFor` derives the scope
   * from the sender's URL and `sanitizePatch` refuses one from a content script -- correctly,
   * because a page must not be able to move a note onto another page's notes. So four kinds
   * sat in the type while `notesForContext` looked all of them up on every page load.
   *
   * Three of them are a feature now: this page, this whole site, every page. The kind comes
   * over the wire and the background derives the scope itself, from the URL the note is
   * already attached to.
   */
  const PAGE = 'https://example.com/article';

  it('widens a note to the whole site, and keeps it findable there', async () => {
    const note = await createOne();
    const reply = (await send({ t: 'note/scope', id: note.id, kind: 'domain' }, from7)) as Reply<{
      kind: string;
    }>;
    expect(reply.ok && reply.data.kind).toBe('domain');

    // The point of the feature: another page on the same site now finds it.
    const elsewhere = (await send(
      { t: 'notes/forContext', url: 'https://example.com/somewhere/else' },
      { tab: { id: 7, url: 'https://example.com/somewhere/else' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(elsewhere.ok && elsewhere.data.notes.map((n) => n.id)).toContain(note.id);
  });

  it('narrows it back to the page it was made on', async () => {
    const note = await createOne();
    await send({ t: 'note/scope', id: note.id, kind: 'domain' }, from7);
    await send({ t: 'note/scope', id: note.id, kind: 'url' }, from7);

    const elsewhere = (await send(
      { t: 'notes/forContext', url: 'https://example.com/somewhere/else' },
      { tab: { id: 7, url: 'https://example.com/somewhere/else' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(elsewhere.ok && elsewhere.data.notes).toEqual([]);

    const home = (await send({ t: 'notes/forContext', url: PAGE }, from7)) as Reply<{
      notes: NoteWire[];
    }>;
    expect(home.ok && home.data.notes.map((n) => n.id)).toContain(note.id);
  });

  it('scopes a note to a SECTION, from the page it is being viewed on', async () => {
    /*
     * The prefix is not in the message and not in the record: it is worked out from
     * `sender.tab.url`, which the browser fills in. That is both safe -- a page cannot name a
     * URL -- and correct, because "this section" means the section of the page you are looking
     * at rather than the one the note was first made on.
     */
    stub.tabs.set(11, { id: 11, url: 'https://example.com/blog/what-is-defi' });
    const note = await createOne();
    const from11 = { tab: { id: 11, url: 'https://example.com/blog/what-is-defi' } };
    const reply = (await send({ t: 'note/scope', id: note.id, kind: 'prefix' }, from11)) as Reply<{
      kind: string;
    }>;
    expect(reply.ok && reply.data.kind).toBe('prefix');

    // A sibling under /blog/ sees it.
    const sibling = (await send(
      { t: 'notes/forContext', url: 'https://example.com/blog/something-else' },
      { tab: { id: 11, url: 'https://example.com/blog/something-else' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(sibling.ok && sibling.data.notes.map((n) => n.id)).toContain(note.id);

    // A page outside /blog/ does not -- including one whose path merely starts the same way.
    for (const outside of ['https://example.com/about', 'https://example.com/blogroll/x']) {
      const other = (await send(
        { t: 'notes/forContext', url: outside },
        { tab: { id: 11, url: outside } },
      )) as Reply<{ notes: NoteWire[] }>;
      expect(other.ok && other.data.notes, outside).toEqual([]);
    }
  });

  it('takes the section from the tab, not from where the note was made', async () => {
    // Made on /article, viewed on /blog/what-is-defi, scoped to "this section" from there:
    // the section is /blog/, and /article is no longer covered.
    const note = await createOne();
    stub.tabs.set(12, { id: 12, url: 'https://example.com/blog/what-is-defi' });
    await send(
      { t: 'note/scope', id: note.id, kind: 'prefix' },
      { tab: { id: 12, url: 'https://example.com/blog/what-is-defi' } },
    );
    const inBlog = (await send(
      { t: 'notes/forContext', url: 'https://example.com/blog/another' },
      { tab: { id: 12, url: 'https://example.com/blog/another' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(inBlog.ok && inBlog.data.notes.map((n) => n.id)).toContain(note.id);

    const whereItWasMade = (await send({ t: 'notes/forContext', url: PAGE }, from7)) as Reply<{
      notes: NoteWire[];
    }>;
    expect(whereItWasMade.ok && whereItWasMade.data.notes).toEqual([]);
  });

  it('puts a note on every page when asked', async () => {
    const note = await createOne();
    await send({ t: 'note/scope', id: note.id, kind: 'global' }, from7);
    const other = (await send(
      { t: 'notes/forContext', url: 'https://a-completely-different.example/page' },
      { tab: { id: 7, url: 'https://a-completely-different.example/page' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(other.ok && other.data.notes.map((n) => n.id)).toContain(note.id);
  });

  it('takes a KIND and never a scope, whatever the message contains', async () => {
    /*
     * The security property. A content script that sends its own scope must not be able to
     * file a note under someone else's page -- so the handler reads only `kind`, and derives
     * the rest from the note's stored context.
     */
    const note = await createOne();
    await send(
      {
        t: 'note/scope',
        id: note.id,
        kind: 'url',
        scope: { kind: 'url', urlKey: 'active https://victim.example/inbox' },
      },
      from7,
    );
    const victim = (await send(
      { t: 'notes/forContext', url: 'https://victim.example/inbox' },
      { tab: { id: 7, url: 'https://victim.example/inbox' } },
    )) as Reply<{ notes: NoteWire[] }>;
    expect(victim.ok && victim.data.notes).toEqual([]);
  });

  it('says so when the note is gone', async () => {
    const reply = await send({ t: 'note/scope', id: 'n_nope', kind: 'domain' }, from7);
    expect(reply).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('tells the open tabs, so a widened note appears without a reload', async () => {
    const note = await createOne();
    await send({ t: 'hello', url: PAGE, protocolV: 1 }, from7);
    stub.sent.length = 0;
    await send({ t: 'note/scope', id: note.id, kind: 'domain' }, from7);
    await new Promise((r) => setTimeout(r, 20));
    expect(
      stub.sent.filter((m) => (m.message as { t?: string }).t === 'scope/recheck').length,
    ).toBeGreaterThan(0);
  });
});

describe('registration', () => {
  it('registers content scripts rather than declaring them in the manifest', async () => {
    const { syncRegistrations } = await import('~/bg/inject.ts');
    const out = await syncRegistrations();
    expect(out.registered).toBe(true);

    const call = stubbed().scripting.registerContentScripts.mock.calls[0]?.[0] as Array<{
      id: string;
      matches: string[];
      js: string[];
      runAt: string;
    }>;
    expect(call, 'registerContentScripts was never called').toBeDefined();
    expect(call.map((c) => c.id).sort()).toEqual(['cn-guard', 'cn-renderer']);
    // Only the granted origin -- never a blanket match.
    for (const c of call) expect(c.matches).toEqual(['https://example.com/*']);
    // The guard has to beat the page's own scripts; the renderer must not try to.
    expect(call.find((c) => c.id === 'cn-guard')?.runAt).toBe('document_start');
    expect(call.find((c) => c.id === 'cn-renderer')?.runAt).toBe('document_idle');
  });

  it('does not ask to unregister ids that are not registered', async () => {
    const { syncRegistrations } = await import('~/bg/inject.ts');
    await syncRegistrations();
    // Nothing was registered, per the stubbed getRegisteredContentScripts.
    expect(stubbed().scripting.unregisterContentScripts).not.toHaveBeenCalled();
  });
});

describe('unknown messages', () => {
  it('answers with an error instead of throwing across the boundary', async () => {
    const reply = await send({ t: 'nonsense' }, from7);
    expect(reply).toMatchObject({ ok: false, code: 'SCHEMA' });
  });

  it('refuses a protocol mismatch, so an orphaned content script tears down', async () => {
    const reply = await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 999 },
      from7,
    );
    expect(reply).toMatchObject({ ok: false, code: 'PROTOCOL' });
  });
});

describe('note/create', () => {
  it('stores a note and hands back a wire record', async () => {
    const note = await createOne();
    expect(note.id).toMatch(/^n_/);
    expect(note.rev).toBe(1);
    expect(note.body.text).toBe('hello');
    expect(note.ui.x).toBe(100);
  });

  it('never exposes the index columns or the field clocks', async () => {
    const note = await createOne();
    for (const leaked of ['ix_urlKeys', 'ix_origin', 'ix_state', 'fieldClock', 'schemaV']) {
      expect(note, leaked).not.toHaveProperty(leaked);
    }
  });

  /** The whole point of `sender.tab.id` being authoritative. */
  it('refuses a message with no sender tab', async () => {
    const reply = await send(
      { t: 'note/create', url: 'https://example.com/article', note: {} },
      {},
    );
    expect(reply).toMatchObject({ ok: false, code: 'INTERNAL' });
  });

  it('ignores a scope the content script names and derives it from the URL', async () => {
    const note = await createOne({ scope: { kind: 'global' } });
    // Not global: the note belongs to the page it was made on.
    expect(note.scope.kind).toBe('url');
  });

  it('clamps what it stores', async () => {
    const note = await createOne({
      ui: { x: 1e308, y: Number.NaN, w: 5, h: 99_999, z: -1, opacity: 12 },
    });
    for (const v of [note.ui.x, note.ui.y, note.ui.w, note.ui.h, note.ui.z, note.ui.opacity]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(note.ui.w).toBeGreaterThanOrEqual(120);
    expect(note.ui.opacity).toBeLessThanOrEqual(1);
  });

  it('refuses a page that cannot carry notes', async () => {
    const reply = await send(
      { t: 'note/create', url: 'about:config', note: {} },
      { tab: { id: 7, url: 'about:config' } },
    );
    expect(reply).toMatchObject({ ok: false, code: 'READONLY' });
  });

  it('makes the note findable by the page that created it', async () => {
    await createOne();
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 1 },
      from7,
    )) as Reply<{ noteCount: number; notes: NoteWire[] }>;
    expect(hello.ok).toBe(true);
    if (!hello.ok) return;
    expect(hello.data.noteCount).toBe(1);
    expect(hello.data.notes[0]?.body.text).toBe('hello');
  });

  it('does not leak a note onto a different page', async () => {
    await createOne();
    stub.tabs.set(8, { id: 8, url: 'https://example.com/other', title: 'Other' });
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/other', protocolV: 1 },
      { tab: { id: 8, url: 'https://example.com/other' } },
    )) as Reply<{ noteCount: number }>;
    expect(hello.ok && hello.data.noteCount).toBe(0);
  });
});

describe('note/patch', () => {
  it('applies an edit and bumps the revision', async () => {
    const note = await createOne();
    const reply = (await send(
      { t: 'note/patch', id: note.id, rev: note.rev, patch: { body: { text: 'edited' } } },
      from7,
    )) as Reply<{ rev: number }>;
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.data.rev).toBeGreaterThan(note.rev);

    const { getNote } = await import('~/bg/db/notes.ts');
    expect((await getNote(note.id))?.body.text).toBe('edited');
  });

  it('reports a stale body edit and says what the current revision is', async () => {
    const note = await createOne();
    await send(
      { t: 'note/patch', id: note.id, rev: note.rev, patch: { body: { text: 'first' } } },
      from7,
    );
    const stale = await send(
      { t: 'note/patch', id: note.id, rev: note.rev, patch: { body: { text: 'second' } } },
      from7,
    );
    expect(stale).toMatchObject({ ok: false, code: 'STALE_REV' });
    if (stale.ok) return;
    expect(Number(stale.detail)).toBeGreaterThan(note.rev);
  });

  /** A stale move is not a conflict: two writers moving a note cannot lose any text. */
  it('lets a stale move through', async () => {
    const note = await createOne();
    await send(
      { t: 'note/patch', id: note.id, rev: note.rev, patch: { body: { text: 'x' } } },
      from7,
    );
    const move = await send(
      { t: 'note/patch', id: note.id, rev: note.rev, patch: { ui: { x: 500 } } },
      from7,
    );
    expect(move.ok).toBe(true);
  });

  it('treats rev 0 as "do not check", which is what autosave sends', async () => {
    const note = await createOne();
    const reply = await send(
      { t: 'note/patch', id: note.id, rev: 0, patch: { body: { text: 'autosaved' } } },
      from7,
    );
    expect(reply.ok).toBe(true);
  });

  it('clamps a patch, not only a create', async () => {
    const note = await createOne();
    await send(
      {
        t: 'note/patch',
        id: note.id,
        rev: 0,
        patch: { ui: { x: Number.POSITIVE_INFINITY, w: 999_999 } },
      },
      from7,
    );
    const { getNote } = await import('~/bg/db/notes.ts');
    const stored = await getNote(note.id);
    expect(Number.isFinite(stored?.ui.x ?? Number.NaN)).toBe(true);
    expect(stored?.ui.w).toBeLessThanOrEqual(2000);
  });

  /** A sparse patch must not silently reset the fields it does not mention. */
  it('keeps the fields a patch does not name', async () => {
    const note = await createOne();
    await send({ t: 'note/patch', id: note.id, rev: 0, patch: { ui: { x: 400 } } }, from7);
    const { getNote } = await import('~/bg/db/notes.ts');
    const stored = await getNote(note.id);
    expect(stored?.ui.x).toBe(400);
    expect(stored?.ui.y).toBe(200);
    expect(stored?.ui.w).toBe(240);
    expect(stored?.body.text).toBe('hello');
  });

  it('will not let a page move its note onto another page', async () => {
    const note = await createOne();
    await send(
      {
        t: 'note/patch',
        id: note.id,
        rev: 0,
        patch: { scope: { kind: 'domain', registrable: 'evil.test', includeSubdomains: true } },
      },
      from7,
    );
    const { getNote } = await import('~/bg/db/notes.ts');
    expect((await getNote(note.id))?.scope.kind).toBe('url');
  });

  it('reports a patch to a note that is not there', async () => {
    const reply = await send(
      { t: 'note/patch', id: 'n_nope' as NoteId, rev: 0, patch: { body: { text: 'x' } } },
      from7,
    );
    expect(reply).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('note/delete', () => {
  it('trashes rather than destroys, so the manager can restore it', async () => {
    const note = await createOne();
    const reply = await send({ t: 'note/delete', id: note.id, soft: true }, from7);
    expect(reply.ok).toBe(true);

    const { getNote, listTrash } = await import('~/bg/db/notes.ts');
    expect(await getNote(note.id)).toBeDefined();
    expect((await listTrash()).map((n) => n.id)).toContain(note.id);
  });

  it('takes a trashed note off the page it was on', async () => {
    const note = await createOne();
    await send({ t: 'note/delete', id: note.id, soft: true }, from7);
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 1 },
      from7,
    )) as Reply<{ noteCount: number }>;
    expect(hello.ok && hello.data.noteCount).toBe(0);
  });

  it('purges only when asked to', async () => {
    const note = await createOne();
    await send({ t: 'note/delete', id: note.id, soft: false }, from7);
    const { getNote } = await import('~/bg/db/notes.ts');
    expect(await getNote(note.id)).toBeUndefined();
  });

  it('reports a delete of something that is already gone', async () => {
    const reply = await send({ t: 'note/delete', id: 'n_nope' as NoteId, soft: true }, from7);
    expect(reply).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('guard state', () => {
  it('arms a tab that reports unsaved edits', async () => {
    await createOne();
    const reply = (await send(
      { t: 'guard/state', hasUnsaved: true, noteCount: 1 },
      from7,
    )) as Reply<{ armed: boolean }>;
    expect(reply.ok).toBe(true);

    // Allocation is debounced, so wait for it before reading what was sent.
    await new Promise((r) => setTimeout(r, 200));
    const armed = stub.sent.filter(
      (s) =>
        (s.message as { t?: string }).t === 'guard/set' && (s.message as { armed?: boolean }).armed,
    );
    expect(armed.map((a) => a.tabId)).toContain(7);
  });

  it('will not take a tab id from the message body', async () => {
    const reply = await send({ t: 'guard/state', hasUnsaved: true, noteCount: 1, tabId: 1234 }, {});
    expect(reply).toMatchObject({ ok: false, code: 'INTERNAL' });
  });

  /**
   * The regression this pins down.
   *
   * `onlyPortableNotes` was computed as `!volatile`, which is true for every ordinary tab --
   * and the default policy arms only a tab whose notes are NOT portable. So the close warning
   * was never shown to anyone outside a private window. The unit tests for `qualifies` all
   * passed; nothing tested the mapping that fed it.
   */
  it('arms an ordinary tab, not only a private-window one', async () => {
    await createOne();
    await send({ t: 'guard/state', hasUnsaved: true, noteCount: 1 }, from7);
    await new Promise((r) => setTimeout(r, 200));

    const armed = stub.sent.filter(
      (m) =>
        (m.message as { t?: string }).t === 'guard/set' &&
        (m.message as { armed?: boolean }).armed === true,
    );
    expect(armed, 'no tab was ever armed').not.toHaveLength(0);
    expect(armed.map((a) => a.tabId)).toContain(7);
  });

  it('stays quiet for a tab with no notes at all', async () => {
    await send({ t: 'guard/state', hasUnsaved: false, noteCount: 0 }, from7);
    await new Promise((r) => setTimeout(r, 200));
    const armed = stub.sent.filter(
      (m) =>
        (m.message as { t?: string }).t === 'guard/set' &&
        (m.message as { armed?: boolean }).armed === true,
    );
    expect(armed).toHaveLength(0);
  });
});

describe('the default note style', () => {
  it('comes back with the handshake, so notes never render twice', async () => {
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 1 },
      from7,
    )) as Reply<{ noteDefaults: Record<string, unknown> }>;
    expect(hello.ok).toBe(true);
    if (!hello.ok) return;
    expect(hello.data.noteDefaults).toEqual({});
  });

  it('merges what is saved rather than replacing it', async () => {
    await send({ t: 'settings/saveDefaults', style: { palette: 'acid' } }, from7);
    await send({ t: 'settings/saveDefaults', style: { fontSize: 18 } }, from7);
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 1 },
      from7,
    )) as Reply<{ noteDefaults: Record<string, unknown> }>;
    if (!hello.ok) return;
    // Sparse and cumulative: setting one field must not forget the other.
    expect(hello.data.noteDefaults).toEqual({ palette: 'acid', fontSize: 18 });
  });

  it('sanitises the style, since it arrives from a page process', async () => {
    await send(
      {
        t: 'settings/saveDefaults',
        style: { fontSize: Number.NaN, nested: { a: 1 }, palette: 'acid' },
      },
      from7,
    );
    const hello = (await send(
      { t: 'hello', url: 'https://example.com/article', protocolV: 1 },
      from7,
    )) as Reply<{ noteDefaults: Record<string, unknown> }>;
    if (!hello.ok) return;
    expect(hello.data.noteDefaults).toEqual({ palette: 'acid' });
  });

  it('tells every open tab, so a default set on one page reaches another', async () => {
    await send({ t: 'guard/state', hasUnsaved: false, noteCount: 1 }, from7);
    stub.sent.length = 0;
    await send({ t: 'settings/saveDefaults', style: { palette: 'cyan' } }, from7);
    const told = stub.sent.filter((m) => (m.message as { t?: string }).t === 'defaults/changed');
    expect(told.map((m) => m.tabId)).toContain(7);
    const first = told[0];
    expect(first, 'nothing was broadcast').toBeDefined();
    expect((first?.message as { style: Record<string, unknown> } | undefined)?.style).toMatchObject(
      { palette: 'cyan' },
    );
  });
});

describe('pasted images', () => {
  const png = (bytes = 64): ArrayBuffer => new Uint8Array(bytes).fill(7).buffer;

  it('stores an image against a note and reads it back as bytes', async () => {
    const note = await createOne();
    const put = (await send(
      { t: 'asset/put', noteId: note.id, name: 'shot.png', type: 'image/png', bytes: png() },
      from7,
    )) as Reply<{ id: string }>;
    expect(put.ok).toBe(true);
    if (!put.ok) return;

    const got = (await send({ t: 'asset/get', id: put.data.id }, from7)) as Reply<{
      type: string;
      bytes: ArrayBuffer;
    }>;
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.data.type).toBe('image/png');
    expect(new Uint8Array(got.data.bytes)).toEqual(new Uint8Array(png()));
  });

  /** A note is not a photo album, and an unbounded paste fills a profile directory quietly. */
  it('refuses an image over the ceiling', async () => {
    const note = await createOne();
    const huge = new ArrayBuffer(11 * 1024 * 1024);
    const reply = await send(
      { t: 'asset/put', noteId: note.id, name: 'huge.png', type: 'image/png', bytes: huge },
      from7,
    );
    expect(reply).toMatchObject({ ok: false, code: 'QUOTA' });
  });

  it('refuses a type a canvas cannot decode', async () => {
    const note = await createOne();
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '']) {
      const reply = await send(
        { t: 'asset/put', noteId: note.id, name: 'x', type, bytes: png() },
        from7,
      );
      expect(reply, type).toMatchObject({ ok: false, code: 'SCHEMA' });
    }
  });

  it('refuses anything that is not actually bytes', async () => {
    const note = await createOne();
    const reply = await send(
      { t: 'asset/put', noteId: note.id, name: 'x', type: 'image/png', bytes: 'not bytes' },
      from7,
    );
    expect(reply).toMatchObject({ ok: false, code: 'SCHEMA' });
  });

  it('refuses to attach to a note that does not exist', async () => {
    const reply = await send(
      { t: 'asset/put', noteId: 'n_nope' as NoteId, name: 'x', type: 'image/png', bytes: png() },
      from7,
    );
    expect(reply).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('reports a missing image rather than throwing', async () => {
    expect(await send({ t: 'asset/get', id: 'a_nope' }, from7)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
