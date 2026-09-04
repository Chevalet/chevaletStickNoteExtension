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
      session: {
        get: async () => ({}),
        set: async () => undefined,
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
