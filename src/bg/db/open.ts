/**
 * Opening the database, and the promise wrappers everything else uses.
 *
 * IndexedDB rather than `storage.local`: at ten thousand notes a flat key-value store forces a
 * full deserialize for the query that runs on EVERY page load in EVERY tab. Indexes make that
 * a few keyed lookups instead. Both live in the same profile directory and both survive
 * "clear cookies and site data"; only one of them is fast.
 */

import { DB_NAME, DB_VERSION, type StoreName } from './schema.ts';

export type DB = IDBDatabase;

/** Promisify a request. */
export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolve when a transaction commits, reject if it aborts. */
export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error ?? new Error('transaction failed'));
    tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'));
  });
}

export class DatabaseUnavailable extends Error {
  constructor(override readonly cause: unknown) {
    super(`chevaletNote database could not be opened: ${String(cause)}`);
    this.name = 'DatabaseUnavailable';
  }
}

/**
 * Create the stores and indexes. Runs once per `DB_VERSION`.
 *
 * Note the shape of `by_state_url`: a plain multiEntry index over strings that already carry
 * their state as a prefix. IndexedDB rejects a compound index with a multiEntry component, so
 * folding the state into the key is the only way to keep trashed notes off the hot path
 * without filtering in JavaScript afterwards.
 */
function upgrade(db: IDBDatabase, from: number): void {
  if (from < 1) {
    const notes = db.createObjectStore('notes', { keyPath: 'id' });
    notes.createIndex('by_state_url', 'ix_urlKeys', { multiEntry: true });
    notes.createIndex('by_state_origin', ['ix_state', 'ix_origin']);
    notes.createIndex('by_state_domain', ['ix_state', 'ix_domain']);
    notes.createIndex('by_state_tab', ['ix_state', 'ix_tabKey']);
    notes.createIndex('by_state_kind', ['ix_state', 'ix_scopeKind']);
    notes.createIndex('by_updated', 'updatedAt');
    notes.createIndex('by_tag', 'tags', { multiEntry: true });
    notes.createIndex('by_deleted', ['ix_state', 'deletedAt']);

    const tabs = db.createObjectStore('tabs', { keyPath: 'tabKey' });
    tabs.createIndex('by_state', 'state');
    tabs.createIndex('by_state_seen', ['state', 'lastSeenAt']);

    const revisions = db.createObjectStore('revisions', { keyPath: ['noteId', 'rev'] });
    revisions.createIndex('by_note', 'noteId');

    const assets = db.createObjectStore('assets', { keyPath: 'id' });
    assets.createIndex('by_note', 'noteId');

    db.createObjectStore('meta', { keyPath: 'k' });
    db.createObjectStore('quarantine', { keyPath: 'id' });
  }
  // Future structural changes append `if (from < 2) { ... }` here. Record migrations, which
  // are far more common, live in migrate.ts and run lazily on read instead.
}

let handle: Promise<DB> | null = null;

export function openDb(name = DB_NAME, version = DB_VERSION): Promise<DB> {
  handle ??= new Promise<DB>((res, rej) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (e) {
      rej(new DatabaseUnavailable(e));
      return;
    }
    request.onupgradeneeded = (e) => upgrade(request.result, e.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      // Another context (a manager tab, usually) is upgrading. Close so it can proceed
      // rather than blocking it forever.
      db.onversionchange = () => {
        db.close();
        handle = null;
      };
      res(db);
    };
    request.onerror = () => rej(new DatabaseUnavailable(request.error));
    request.onblocked = () =>
      rej(new DatabaseUnavailable('another tab is holding an older version open'));
  }).catch((e) => {
    handle = null;
    throw e;
  });
  return handle;
}

/** Drop the cached handle. Used by tests and after a version change. */
export function resetDb(): void {
  handle = null;
}

export async function tx(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode = 'readonly',
): Promise<IDBTransaction> {
  const db = await openDb();
  return db.transaction(stores, mode);
}

/** Read helper: one store, one transaction, one result. */
export async function read<T>(
  store: StoreName,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const t = await tx(store);
  return req(fn(t.objectStore(store)));
}
