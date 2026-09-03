import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildNote,
  createNote,
  getNote,
  listTrash,
  notesForContext,
  patchNote,
  purgeNote,
  restoreNote,
  shouldSnapshot,
  trashNote,
} from '~/bg/db/notes.ts';
import { openDb, resetDb } from '~/bg/db/open.ts';
import type { NoteUi } from '~/bg/db/schema.ts';
import { deriveTitle, stateKey } from '~/bg/db/schema.ts';
import { candidateKeys, defaultScopeFor, matchContext, scopeMatches } from '~/bg/scope/match.ts';
import type { Scope, UrlKey } from '~/shared/types.ts';

const UI: NoteUi = {
  x: 10,
  y: 20,
  w: 240,
  h: 170,
  z: 1,
  collapsed: false,
  locked: false,
  opacity: 1,
};

const ctxFor = (url: string, tabKey?: string) => {
  const c = matchContext(url, tabKey);
  if (!c) throw new Error(`unnoteable url in test: ${url}`);
  return c;
};

/** A fresh, empty database for every test -- IndexedDB state leaking between tests is misery. */
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetDb();
  await openDb();
});

async function noteOn(url: string, text = 'hello'): Promise<string> {
  const scope = defaultScopeFor(url);
  if (!scope) throw new Error(`no scope for ${url}`);
  const n = await createNote({ scope, text, ui: { ...UI } });
  return n.id;
}

describe('createNote / getNote', () => {
  it('round-trips a note', async () => {
    const id = await noteOn('https://example.com/docs/api', 'first line\nsecond');
    const got = await getNote(id as never);
    expect(got?.body.text).toBe('first line\nsecond');
    expect(got?.title).toBe('first line');
    expect(got?.rev).toBe(1);
    expect(got?.ix_state).toBe('active');
  });

  it('indexes a url-scoped note under its state-prefixed key', () => {
    const scope = defaultScopeFor('https://example.com/a') as Extract<Scope, { kind: 'url' }>;
    const n = buildNote({ scope, ui: { ...UI } });
    expect(n.ix_urlKeys).toEqual([stateKey('active', scope.urlKey)]);
    expect(n.ix_origin).toBe('');
    expect(n.ix_domain).toBe('');
  });
});

describe('notesForContext -- the hot path', () => {
  it('finds a note on the same URL and not on a different one', async () => {
    await noteOn('https://example.com/docs/api');
    expect(await notesForContext(ctxFor('https://example.com/docs/api'))).toHaveLength(1);
    expect(await notesForContext(ctxFor('https://example.com/docs/other'))).toHaveLength(0);
  });

  it('ignores tracking parameters and query order, as the normalizer promises', async () => {
    await noteOn('https://example.com/p?b=2&a=1');
    for (const url of [
      'https://example.com/p?a=1&b=2',
      'https://example.com/p?a=1&b=2&utm_source=twitter',
      'http://www.example.com/p?b=2&a=1',
    ]) {
      expect(await notesForContext(ctxFor(url)), url).toHaveLength(1);
    }
  });

  it('treats a hash route as a different page but a plain fragment as the same one', async () => {
    await noteOn('https://app.example.com/#/inbox');
    expect(await notesForContext(ctxFor('https://app.example.com/#/inbox'))).toHaveLength(1);
    expect(await notesForContext(ctxFor('https://app.example.com/#/settings'))).toHaveLength(0);

    await noteOn('https://example.com/article');
    expect(await notesForContext(ctxFor('https://example.com/article#section-3'))).toHaveLength(1);
  });

  it('keeps a YouTube note pinned to its video, not to /watch', async () => {
    await noteOn('https://www.youtube.com/watch?v=abc&t=30s');
    expect(await notesForContext(ctxFor('https://www.youtube.com/watch?v=abc&t=99s'))).toHaveLength(
      1,
    );
    expect(await notesForContext(ctxFor('https://www.youtube.com/watch?v=xyz'))).toHaveLength(0);
  });

  it('honours prefix, domain and global scopes', async () => {
    await createNote({
      scope: { kind: 'prefix', origin: 'https://example.com', pathPrefix: '/docs' },
      ui: { ...UI },
      text: 'prefix',
    });
    await createNote({
      scope: { kind: 'domain', registrable: 'example.com', includeSubdomains: true },
      ui: { ...UI },
      text: 'domain',
    });
    await createNote({ scope: { kind: 'global' }, ui: { ...UI }, text: 'global' });

    const onDocs = await notesForContext(ctxFor('https://example.com/docs/api'));
    expect(onDocs.map((n) => n.body.text).sort()).toEqual(['domain', 'global', 'prefix']);

    const onRoot = await notesForContext(ctxFor('https://example.com/pricing'));
    expect(onRoot.map((n) => n.body.text).sort()).toEqual(['domain', 'global']);

    const onSub = await notesForContext(ctxFor('https://shop.example.com/x'));
    expect(onSub.map((n) => n.body.text).sort()).toEqual(['domain', 'global']);

    const elsewhere = await notesForContext(ctxFor('https://other.org/'));
    expect(elsewhere.map((n) => n.body.text)).toEqual(['global']);
  });

  it('does not let /docs match /docsearch', () => {
    const scope: Scope = { kind: 'prefix', origin: 'https://e.com', pathPrefix: '/docs' };
    expect(scopeMatches(scope, ctxFor('https://e.com/docs'))).toBe(true);
    expect(scopeMatches(scope, ctxFor('https://e.com/docs/api'))).toBe(true);
    expect(scopeMatches(scope, ctxFor('https://e.com/docsearch'))).toBe(false);
  });

  it('only returns tab-scoped notes to the tab that owns them', async () => {
    await createNote({ scope: { kind: 'tab', tabKey: 'tk_a' }, ui: { ...UI }, text: 'mine' });
    expect(await notesForContext(ctxFor('https://any.example/', 'tk_a'))).toHaveLength(1);
    expect(await notesForContext(ctxFor('https://any.example/', 'tk_b'))).toHaveLength(0);
    expect(await notesForContext(ctxFor('https://any.example/'))).toHaveLength(0);
  });

  it('returns each note once even when several indexes find it', async () => {
    await createNote({ scope: { kind: 'global' }, ui: { ...UI }, text: 'g' });
    const found = await notesForContext(ctxFor('https://example.com/p?x=1'));
    expect(found).toHaveLength(1);
  });

  it('orders by z, then by age', async () => {
    const scope = defaultScopeFor('https://e.com/p') as Scope;
    await createNote({ scope, ui: { ...UI, z: 5 }, text: 'top' });
    await createNote({ scope, ui: { ...UI, z: 1 }, text: 'bottom' });
    const found = await notesForContext(ctxFor('https://e.com/p'));
    expect(found.map((n) => n.body.text)).toEqual(['bottom', 'top']);
  });
});

describe('candidateKeys', () => {
  it('covers the default, exact and query-free variants', () => {
    const keys = candidateKeys('https://e.com/p?a=1&utm_source=x');
    expect(keys).toContain(stateKey('active', '//e.com/p?a=1' as UrlKey));
    expect(keys).toContain(stateKey('active', '//e.com/p?a=1&utm_source=x' as UrlKey));
    expect(keys).toContain(stateKey('active', '//e.com/p' as UrlKey));
  });

  it('adds hash variants only for a route-looking fragment', () => {
    expect(candidateKeys('https://e.com/p#/route').some((k) => k.includes('#/route'))).toBe(true);
    expect(candidateKeys('https://e.com/p#intro').some((k) => k.includes('#intro'))).toBe(false);
  });

  it('returns nothing for a page that cannot hold a note', () => {
    expect(candidateKeys('about:blank')).toEqual([]);
  });
});

describe('patchNote', () => {
  it('bumps the revision and re-derives the title', async () => {
    const id = await noteOn('https://e.com/p', 'old');
    const r = await patchNote(id as never, { body: { text: '# New heading\nbody' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.note.rev).toBe(2);
    expect(r.note.title).toBe('New heading');
  });

  it('merges ui fields instead of replacing the object', async () => {
    const id = await noteOn('https://e.com/p');
    await patchNote(id as never, { ui: { x: 999 } });
    const got = await getNote(id as never);
    expect(got?.ui.x).toBe(999);
    expect(got?.ui.w).toBe(240);
  });

  it('reports a stale body edit rather than clobbering it', async () => {
    const id = await noteOn('https://e.com/p', 'base');
    await patchNote(id as never, { body: { text: 'theirs' } });
    const stale = await patchNote(id as never, { body: { text: 'mine' } }, 1);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.code).toBe('STALE_REV');
    expect((await getNote(id as never))?.body.text).toBe('theirs');
  });

  it('lets a stale MOVE through -- dragging in one tab never conflicts with typing in another', async () => {
    const id = await noteOn('https://e.com/p');
    await patchNote(id as never, { body: { text: 'edited elsewhere' } });
    const moved = await patchNote(id as never, { ui: { x: 42 } }, 1);
    expect(moved.ok).toBe(true);
    const got = await getNote(id as never);
    expect(got?.ui.x).toBe(42);
    expect(got?.body.text).toBe('edited elsewhere');
  });

  it('serializes concurrent patches so no field is lost', async () => {
    const id = await noteOn('https://e.com/p', 'start');
    await Promise.all([
      patchNote(id as never, { ui: { x: 1 } }),
      patchNote(id as never, { ui: { y: 2 } }),
      patchNote(id as never, { body: { text: 'final' } }),
      patchNote(id as never, { tags: ['a'] }),
    ]);
    const got = await getNote(id as never);
    expect(got?.ui.x).toBe(1);
    expect(got?.ui.y).toBe(2);
    expect(got?.body.text).toBe('final');
    expect(got?.tags).toEqual(['a']);
    expect(got?.rev).toBe(5);
  });

  it('re-indexes when the scope changes', async () => {
    const id = await noteOn('https://e.com/one');
    await patchNote(id as never, {
      scope: { kind: 'domain', registrable: 'e.com', includeSubdomains: false },
    });
    expect(await notesForContext(ctxFor('https://e.com/one'))).toHaveLength(1);
    expect(await notesForContext(ctxFor('https://e.com/two'))).toHaveLength(1);
  });

  it('reports a missing note instead of throwing', async () => {
    const r = await patchNote('n_nope' as never, { ui: { x: 1 } });
    expect(r).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('trash', () => {
  it('takes a trashed note off the hot path but keeps it recoverable', async () => {
    const id = await noteOn('https://e.com/p', 'keep me');
    await trashNote(id as never);
    expect(await notesForContext(ctxFor('https://e.com/p'))).toHaveLength(0);

    const trashed = await listTrash();
    expect(trashed.map((n) => n.body.text)).toEqual(['keep me']);
    expect(trashed[0]?.deletedAt).toBeTypeOf('number');

    await restoreNote(id as never);
    expect(await notesForContext(ctxFor('https://e.com/p'))).toHaveLength(1);
    expect(await listTrash()).toHaveLength(0);
  });

  it('purge is the only thing that actually destroys a note', async () => {
    const id = await noteOn('https://e.com/p');
    await trashNote(id as never);
    await purgeNote(id as never);
    expect(await getNote(id as never)).toBeUndefined();
  });
});

describe('helpers', () => {
  it.each([
    ['# Heading\nbody', 'Heading'],
    ['\n\n  spaced  \nmore', 'spaced'],
    ['', ''],
    ['\n\n', ''],
    ['###### deep heading', 'deep heading'],
  ])('deriveTitle(%j) -> %j', (input, want) => {
    expect(deriveTitle(input)).toBe(want);
  });

  it('caps a very long title', () => {
    expect(deriveTitle('x'.repeat(500))).toHaveLength(120);
  });

  it('snapshots a revision on a long gap or a big change, not on every keystroke', () => {
    const now = 1_000_000;
    expect(shouldSnapshot('a', 'ab', now - 1000, now)).toBe(false);
    expect(shouldSnapshot('a', 'ab', now - 40_000, now)).toBe(true);
    expect(shouldSnapshot('a', 'a'.repeat(300), now - 1000, now)).toBe(true);
  });
});
