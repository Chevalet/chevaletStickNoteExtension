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
  type AssetRecord,
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
    // Both stores in one transaction, so a snapshot and the edit it protects cannot come
    // apart: either the old text is safe and the new text is written, or neither happened.
    const t = await tx(['notes', 'revisions'], 'readwrite');
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
      /*
       * The PREVIOUS text is what gets kept, before it is replaced. A history of what a note
       * became is no use; what you want back is what it was.
       */
      if (
        patch.body.text !== current.body.text &&
        shouldSnapshot(current.body.text, patch.body.text, lastRevAt.get(id) ?? 0, now)
      ) {
        await writeRevision(t.objectStore('revisions'), {
          noteId: id,
          rev: current.rev,
          at: now,
          body: current.body.text,
          title: current.title,
          reason: 'edit',
        });
        lastRevAt.set(id, now);
      }
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
  // The snapshot clock is keyed by note id and the note is gone. A leftover entry could only
  // ever affect an id that cannot come back, but a map that is only added to is a leak.
  lastRevAt.delete(id);
}

// -------------------------------------------------------------- revisions

const REVISION_GAP_MS = 30_000;
const REVISION_DELTA_CHARS = 200;

/**
 * How many versions of each note to keep.
 *
 * A module-level policy rather than an argument, because `patchNote` is called from a dozen
 * places and threading a setting through all of them would put the same number in a dozen
 * call sites. The background sets this on boot and whenever the setting changes; the default
 * matches what the constant used to be, so a context that never sets it behaves as before.
 *
 * `keep: 0` means keep none, and it is honoured everywhere -- the setting has to be able to
 * turn the feature off, or it is not a setting.
 */
let revisionKeep = 50;

export function setRevisionKeep(keep: number): void {
  revisionKeep = Number.isFinite(keep) && keep >= 0 ? Math.floor(keep) : 50;
}

export function revisionKeepNow(): number {
  return revisionKeep;
}

/**
 * Should this edit be worth remembering?
 *
 * Two ways to earn a snapshot: time since the last one, or a big change in length. Typing a
 * word at a time earns one every thirty seconds; pasting or deleting a paragraph earns one
 * immediately. Every keystroke would fill the store with noise and make the history useless
 * to read, which is the failure mode that matters -- a history nobody can scan is not one.
 */
export function shouldSnapshot(
  previousText: string,
  nextText: string,
  lastRevisionAt: number,
  now = Date.now(),
): boolean {
  if (now - lastRevisionAt > REVISION_GAP_MS) return true;
  return Math.abs(nextText.length - previousText.length) >= REVISION_DELTA_CHARS;
}

/** Put a revision and prune the note's oldest, inside a transaction the caller owns. */
async function writeRevision(store: IDBObjectStore, rev: RevisionRecord): Promise<void> {
  if (revisionKeep <= 0) return;
  store.put(rev);
  const all = await req(store.index('by_note').getAllKeys(rev.noteId));
  const excess = all.length - revisionKeep;
  for (let i = 0; i < excess; i++) store.delete(all[i] as IDBValidKey);
}

export async function addRevision(rev: RevisionRecord): Promise<void> {
  const t = await tx('revisions', 'readwrite');
  await writeRevision(t.objectStore('revisions'), rev);
  await done(t);
}

/**
 * When this note last earned a revision, in memory only.
 *
 * `shouldSnapshot` needs it on every body edit, and reading the revisions index on every
 * keystroke to find out would be a second index lookup per character typed. The cost of
 * losing it -- the event page being killed, which happens constantly -- is that the next edit
 * takes a snapshot it might not have needed. That is the harmless direction to be wrong in.
 */
const lastRevAt = new Map<NoteId, number>();

export function revisionsFor(noteId: NoteId): Promise<RevisionRecord[]> {
  return read(
    'revisions',
    (s) => s.index('by_note').getAll(noteId) as IDBRequest<RevisionRecord[]>,
  );
}

/**
 * Put an old version back as the note's current text.
 *
 * Routed through `patchNote`, which means the text being replaced is itself snapshotted first
 * -- so restoring is undoable, and picking the wrong version costs nothing. Doing this with a
 * direct write would have been three lines shorter and a trap.
 */
export async function restoreRevision(noteId: NoteId, at: number): Promise<boolean> {
  const revisions = await revisionsFor(noteId);
  const wanted = revisions.find((r) => r.at === at);
  if (!wanted) return false;
  const out = await patchNote(noteId, { body: { text: wanted.body } });
  return out.ok;
}

// ------------------------------------------------------------------ assets

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

// ------------------------------------------------------------------ assets

export function newAssetId(): AssetId {
  return `a_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * Store a pasted image.
 *
 * The blob goes in its own store and the note only keeps its id, so reading a note never
 * drags a megabyte of picture along with it -- and the markdown stays short enough to stay
 * readable in the exported .md mirror.
 */
export async function putAsset(noteId: NoteId, blob: Blob, name: string): Promise<AssetId> {
  const id = newAssetId();
  const t = await tx(['assets', 'notes'], 'readwrite');
  t.objectStore('assets').put({
    id,
    noteId,
    name,
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    blob,
    createdAt: Date.now(),
  });
  const store = t.objectStore('notes');
  const note = await req(store.get(noteId) as IDBRequest<NoteRecord | undefined>);
  if (note) store.put({ ...note, assets: [...note.assets, id] });
  await done(t);
  return id;
}

/**
 * Store an asset under the id it ALREADY has. Import only.
 *
 * `putAsset` mints a fresh id, which is right when an image is pasted and wrong when one is
 * restored from an archive: a note keeps its images as a list of ids, so a new id would leave
 * every imported drawing and screenshot pointing at nothing. The note is not touched here --
 * the import writes the note itself, with its own asset list already checked against what the
 * archive actually contains.
 */
export async function putAssetBytes(a: {
  id: string;
  noteId: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<void> {
  const t = await tx('assets', 'readwrite');
  t.objectStore('assets').put({
    id: a.id as AssetId,
    noteId: a.noteId as NoteId,
    name: a.id,
    mime: a.mime,
    size: a.bytes.byteLength,
    blob: new Blob([a.bytes as unknown as BlobPart], { type: a.mime }),
    createdAt: Date.now(),
  } satisfies AssetRecord);
  await done(t);
}

export function getAsset(id: AssetId): Promise<AssetRecord | undefined> {
  return read('assets', (s) => s.get(id) as IDBRequest<AssetRecord | undefined>);
}

export function assetsForNote(noteId: NoteId): Promise<AssetRecord[]> {
  return read('assets', (s) => s.index('by_note').getAll(noteId) as IDBRequest<AssetRecord[]>);
}

export function allAssets(): Promise<AssetRecord[]> {
  return read('assets', (s) => s.getAll() as IDBRequest<AssetRecord[]>);
}
