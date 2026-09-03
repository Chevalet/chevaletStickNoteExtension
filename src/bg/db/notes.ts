/**
 * Note CRUD, and the one query that matters: "what should this page show?"
 *
 * That query runs on every page load in every tab, so it is four keyed index lookups plus a
 * cheap JavaScript filter -- never a scan, and never a full deserialize. Its cost is
 * independent of how many notes exist.
 *
 * Writes are serialized per note through a mutex chain, so two rapid autosaves cannot
 * interleave and lose a field.
 */

import { candidateKeys, indexColumns, type MatchContext, scopeMatches } from '~/bg/scope/match.ts';
import type { AssetId, NoteId, NoteState, Scope } from '~/shared/types.ts';
import { done, read, req, tx } from './open.ts';
import {
  deriveTitle,
  type NoteRecord,
  type NoteUi,
  type RevisionRecord,
  SCHEMA_V,
  stateKey,
} from './schema.ts';

// --------------------------------------------------------------------- ids

export function newNoteId(): NoteId {
  return `n_${crypto.randomUUID()}`;
}

// ------------------------------------------------------------------ create

export interface CreateNoteInput {
  scope: Scope;
  text?: string;
  ui: NoteUi;
  anchor?: unknown;
  style?: Record<string, unknown>;
  tags?: string[];
  context?: NoteRecord['context'];
}

export function buildNote(input: CreateNoteInput, now = Date.now()): NoteRecord {
  const text = input.text ?? '';
  return {
    id: newNoteId(),
    schemaV: SCHEMA_V,
    rev: 1,
    scope: input.scope,
    ix_state: 'active',
    ...indexColumns(input.scope, 'active'),
    body: { format: 'md', text },
    assets: [],
    title: deriveTitle(text),
    tags: input.tags ?? [],
    anchor: input.anchor ?? null,
    ui: input.ui,
    style: input.style ?? {},
    createdAt: now,
    updatedAt: now,
    fieldClock: { body: now, ui: now, style: now, scope: now },
    ...(input.context ? { context: input.context } : {}),
  };
}

export async function putNote(note: NoteRecord): Promise<NoteRecord> {
  const t = await tx('notes', 'readwrite');
  t.objectStore('notes').put(note);
  await done(t);
  return note;
}

export async function createNote(input: CreateNoteInput): Promise<NoteRecord> {
  return putNote(buildNote(input));
}

// -------------------------------------------------------------------- read

export function getNote(id: NoteId): Promise<NoteRecord | undefined> {
  return read('notes', (s) => s.get(id) as IDBRequest<NoteRecord | undefined>);
}

export function allNotes(): Promise<NoteRecord[]> {
  return read('notes', (s) => s.getAll() as IDBRequest<NoteRecord[]>);
}

/**
 * The hot path. Four index lookups, union, then an exact filter.
 *
 * `tab`-scoped notes are only fetched when a tab key is known, and `global` notes come from
 * the kind index rather than being held in memory -- there are typically a handful of them and
 * an index get is cheaper than keeping state alive in a non-persistent event page.
 */
export async function notesForContext(
  ctx: MatchContext,
  state: NoteState = 'active',
): Promise<NoteRecord[]> {
  const t = await tx('notes');
  const store = t.objectStore('notes');

  const lookups: Array<Promise<NoteRecord[]>> = [
    ...candidateKeys(ctx.url, state).map((k) =>
      req(store.index('by_state_url').getAll(k) as IDBRequest<NoteRecord[]>),
    ),
    req(store.index('by_state_origin').getAll([state, ctx.origin]) as IDBRequest<NoteRecord[]>),
    req(
      store.index('by_state_domain').getAll([state, ctx.registrable]) as IDBRequest<NoteRecord[]>,
    ),
    req(store.index('by_state_kind').getAll([state, 'global']) as IDBRequest<NoteRecord[]>),
  ];
  if (ctx.tabKey) {
    lookups.push(
      req(store.index('by_state_tab').getAll([state, ctx.tabKey]) as IDBRequest<NoteRecord[]>),
    );
  }

  const seen = new Map<NoteId, NoteRecord>();
  for (const batch of await Promise.all(lookups)) {
    for (const n of batch) {
      if (!seen.has(n.id) && scopeMatches(n.scope, ctx)) seen.set(n.id, n);
    }
  }

  // Stickies, not a config cascade: everything that matches is shown. Newest on top of the
  // pile only when nothing has been explicitly raised.
  return [...seen.values()].sort((a, b) => a.ui.z - b.ui.z || a.createdAt - b.createdAt);
}

/** Cheap enough to call on every navigation, and the answer is usually zero. */
export async function countForContext(ctx: MatchContext): Promise<number> {
  return (await notesForContext(ctx)).length;
}

// ------------------------------------------------------------------- patch

export interface NotePatch {
  body?: { text: string };
  ink?: NoteRecord['ink'];
  ui?: Partial<NoteUi>;
  anchor?: unknown;
  style?: Record<string, unknown>;
  tags?: string[];
  scope?: Scope;
}

export type PatchResult =
  | { ok: true; note: NoteRecord }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'STALE_REV'; current: NoteRecord };

/**
 * Per-note write serialization.
 *
 * Autosave fires every few hundred milliseconds while someone types; without this, two patches
 * that both read rev N would both write rev N+1 and one field would silently vanish.
 */
const chains = new Map<NoteId, Promise<unknown>>();

function serialize<T>(id: NoteId, work: () => Promise<T>): Promise<T> {
  const prev = chains.get(id) ?? Promise.resolve();
  const next = prev.then(work, work);
  chains.set(
    id,
    next.catch(() => undefined),
  );
  void next.finally(() => {
    if (chains.get(id) === next || chains.get(id)) {
      // Only clear when we are the tail, so a later write is not orphaned.
      queueMicrotask(() => {
        if (chains.size && !chains.get(id)) chains.delete(id);
      });
    }
  });
  return next;
}

/**
 * Apply a sparse patch.
 *
 * `baseRev` is the revision the caller was looking at. Passing it lets a genuine race be
 * reported instead of silently clobbered; passing `undefined` means "I do not care, this is a
 * local edit". Field clocks mean a patch that only moves a note never conflicts with one that
 * only edits its text.
 */
export function patchNote(
  id: NoteId,
  patch: NotePatch,
  baseRev?: number,
  now = Date.now(),
): Promise<PatchResult> {
  return serialize(id, async () => {
    const t = await tx('notes', 'readwrite');
    const store = t.objectStore('notes');
    const current = (await req(store.get(id) as IDBRequest<NoteRecord | undefined>)) ?? null;
    if (!current) {
      t.abort();
      return { ok: false, code: 'NOT_FOUND' } as const;
    }
    if (baseRev !== undefined && baseRev !== current.rev && patch.body !== undefined) {
      // Only a body edit can truly conflict; a stale move or restyle is harmless.
      t.abort();
      return { ok: false, code: 'STALE_REV', current } as const;
    }

    const next: NoteRecord = { ...current, rev: current.rev + 1, updatedAt: now };
    const clock = { ...current.fieldClock };

    if (patch.body) {
      next.body = { format: 'md', text: patch.body.text };
      next.title = deriveTitle(patch.body.text);
      clock.body = now;
    }
    if (patch.ui) {
      next.ui = { ...current.ui, ...patch.ui };
      clock.ui = now;
    }
    if (patch.ink !== undefined) {
      next.ink = patch.ink;
      clock.ink = now;
    }
    if (patch.anchor !== undefined) {
      next.anchor = patch.anchor;
      clock.anchor = now;
    }
    if (patch.style) {
      next.style = { ...current.style, ...patch.style };
      clock.style = now;
    }
    if (patch.tags) {
      next.tags = patch.tags;
      clock.tags = now;
    }
    if (patch.scope) {
      next.scope = patch.scope;
      Object.assign(next, indexColumns(patch.scope, next.ix_state));
      clock.scope = now;
    }
    next.fieldClock = clock;

    store.put(next);
    await done(t);
    return { ok: true, note: next } as const;
  });
}

// ------------------------------------------------------------- trash / purge

/** Soft delete. Nothing is ever destroyed by a user action alone. */
export async function trashNote(id: NoteId, now = Date.now()): Promise<boolean> {
  const t = await tx('notes', 'readwrite');
  const store = t.objectStore('notes');
  const current = await req(store.get(id) as IDBRequest<NoteRecord | undefined>);
  if (!current) {
    t.abort();
    return false;
  }
  const next: NoteRecord = {
    ...current,
    ix_state: 'trashed',
    // Re-derive the index columns so a trashed note drops off the hot path entirely.
    ix_urlKeys: current.ix_urlKeys.map((k) => k.replace(/^active/, 'trashed')),
    deletedAt: now,
    updatedAt: now,
    rev: current.rev + 1,
  };
  store.put(next);
  await done(t);
  return true;
}

export async function restoreNote(id: NoteId, now = Date.now()): Promise<boolean> {
  const t = await tx('notes', 'readwrite');
  const store = t.objectStore('notes');
  const current = await req(store.get(id) as IDBRequest<NoteRecord | undefined>);
  if (!current) {
    t.abort();
    return false;
  }
  // `deletedAt` is dropped by omission rather than with `delete`, which keeps the record's
  // hidden class stable and the intent explicit.
  const { deletedAt: _gone, ...rest } = current;
  const next: NoteRecord = {
    ...rest,
    ix_state: 'active',
    ...indexColumns(current.scope, 'active'),
    updatedAt: now,
    rev: current.rev + 1,
  };
  store.put(next);
  await done(t);
  return true;
}

export async function listTrash(): Promise<NoteRecord[]> {
  const t = await tx('notes');
  return req(
    t
      .objectStore('notes')
      .index('by_state_kind')
      .getAll(IDBKeyRange.bound(['trashed', ''], ['trashed', '￿'])) as IDBRequest<NoteRecord[]>,
  );
}

/** Permanent. Only ever called by the retention sweep or an explicit "empty trash". */
export async function purgeNote(id: NoteId): Promise<void> {
  const t = await tx(['notes', 'revisions', 'assets'], 'readwrite');
  t.objectStore('notes').delete(id);
  const revs = t.objectStore('revisions').index('by_note');
  const cursor = revs.openKeyCursor(IDBKeyRange.only(id));
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c) return;
    t.objectStore('revisions').delete(c.primaryKey);
    c.continue();
  };
  await done(t);
}

// -------------------------------------------------------------- revisions

const REVISION_GAP_MS = 30_000;
const REVISION_DELTA_CHARS = 200;
const REVISION_KEEP = 50;

/** Should this edit be worth remembering? */
export function shouldSnapshot(
  previousText: string,
  nextText: string,
  lastRevisionAt: number,
  now = Date.now(),
): boolean {
  if (now - lastRevisionAt > REVISION_GAP_MS) return true;
  return Math.abs(nextText.length - previousText.length) >= REVISION_DELTA_CHARS;
}

export async function addRevision(rev: RevisionRecord): Promise<void> {
  const t = await tx('revisions', 'readwrite');
  const store = t.objectStore('revisions');
  store.put(rev);
  // Prune in the same transaction: a cursor over this note's revisions, oldest first.
  const all = await req(store.index('by_note').getAllKeys(rev.noteId));
  const excess = all.length - REVISION_KEEP;
  for (let i = 0; i < excess; i++) store.delete(all[i] as IDBValidKey);
  await done(t);
}

export function revisionsFor(noteId: NoteId): Promise<RevisionRecord[]> {
  return read(
    'revisions',
    (s) => s.index('by_note').getAll(noteId) as IDBRequest<RevisionRecord[]>,
  );
}

// ------------------------------------------------------------------ assets

export async function assetIdsFor(noteId: NoteId): Promise<AssetId[]> {
  const note = await getNote(noteId);
  return note?.assets ?? [];
}

// -------------------------------------------------------------------- meta

export async function getMeta<T>(k: string): Promise<T | undefined> {
  const row = await read('meta', (s) => s.get(k) as IDBRequest<{ k: string; v: T } | undefined>);
  return row?.v;
}

export async function setMeta(k: string, v: unknown): Promise<void> {
  const t = await tx('meta', 'readwrite');
  t.objectStore('meta').put({ k, v });
  await done(t);
}

export { stateKey };
