/**
 * Version history: the only undo that survives closing the tab.
 *
 * The in-page undo stack is per-page and dies with it. These are rows in the database, written
 * by `patchNote` when an edit is big enough or far enough apart to be worth keeping.
 *
 * Every test here goes through the real store on fake-indexeddb, because the interesting
 * behaviour IS the store's: which text gets kept, whether the snapshot and the edit can come
 * apart, and whether the setting can turn the whole thing off. A fake would only be testing
 * that I can call my own functions.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createNote,
  getNote,
  patchNote,
  purgeNote,
  restoreRevision,
  revisionsFor,
  setRevisionKeep,
  shouldSnapshot,
} from '~/bg/db/notes.ts';
import { openDb, resetDb } from '~/bg/db/open.ts';
import type { NoteRecord, NoteUi } from '~/bg/db/schema.ts';
import { defaultScopeFor } from '~/bg/scope/match.ts';

const UI: NoteUi = {
  x: 0,
  y: 0,
  w: 240,
  h: 160,
  z: 1,
  collapsed: false,
  locked: false,
  opacity: 1,
};
const PAGE = 'https://example.org/a';

/** A minute apart, so every edit clears the thirty-second gap unless a test says otherwise. */
let clock = 1_756_000_000_000;
const tick = (ms = 60_000): number => (clock += ms);

async function makeNote(text: string): Promise<NoteRecord> {
  const scope = defaultScopeFor(PAGE);
  if (!scope) throw new Error('no scope');
  return createNote({ scope, text, ui: UI });
}

describe('shouldSnapshot', () => {
  it('keeps one when enough time has passed', () => {
    expect(shouldSnapshot('a', 'ab', 0, 40_000)).toBe(true);
  });

  it('does not keep one for a keystroke a second after the last', () => {
    // The failure mode this prevents is not storage, it is readability: a history with one
    // entry per character is a history nobody can scan, which is the same as not having one.
    expect(shouldSnapshot('a', 'ab', 1_000, 2_000)).toBe(false);
  });

  it('keeps one immediately for a big change, however recent the last', () => {
    expect(shouldSnapshot('a'.repeat(10), 'a'.repeat(400), 1_000, 1_100)).toBe(true);
  });

  it('treats a big deletion the same as a big addition', () => {
    // Losing three paragraphs is exactly when you want the previous text back.
    expect(shouldSnapshot('a'.repeat(400), '', 1_000, 1_100)).toBe(true);
  });
});

describe('history through the store', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetDb();
    await openDb();
    setRevisionKeep(50);
    clock = 1_756_000_000_000;
  });

  it('keeps the text as it WAS, not as it became', async () => {
    const note = await makeNote('first');
    await patchNote(note.id, { body: { text: 'second' } }, undefined, tick());

    const revisions = await revisionsFor(note.id);
    expect(revisions).toHaveLength(1);
    // What you want back is what it was. A history of what a note became is no use at all.
    expect(revisions[0]?.body).toBe('first');
    expect(revisions[0]?.reason).toBe('edit');
    expect((await getNote(note.id))?.body.text).toBe('second');
  });

  it('keeps nothing when the text did not actually change', async () => {
    const note = await makeNote('same');
    await patchNote(note.id, { body: { text: 'same' } }, undefined, tick());
    expect(await revisionsFor(note.id)).toEqual([]);
  });

  it('keeps nothing for a move, a restyle or a drawing', async () => {
    const note = await makeNote('text');
    await patchNote(note.id, { ui: { x: 500 } }, undefined, tick());
    await patchNote(note.id, { style: { palette: 'mint' } }, undefined, tick());
    await patchNote(note.id, { ink: { strokes: [], w: 1, h: 1 } }, undefined, tick());
    expect(await revisionsFor(note.id)).toEqual([]);
  });

  it('does not keep one per keystroke', async () => {
    const note = await makeNote('a');
    // Five characters, a second apart. The first clears the gap because nothing has been kept
    // yet; the rest are too close together and too small.
    for (const text of ['ab', 'abc', 'abcd', 'abcde', 'abcdef']) {
      await patchNote(note.id, { body: { text } }, undefined, tick(1_000));
    }
    expect(await revisionsFor(note.id)).toHaveLength(1);
  });

  it('drops the oldest past the number the setting says', async () => {
    setRevisionKeep(3);
    const note = await makeNote('v0');
    for (let i = 1; i <= 6; i++) {
      await patchNote(note.id, { body: { text: `v${i}` } }, undefined, tick());
    }
    const revisions = (await revisionsFor(note.id)).sort((a, b) => a.at - b.at);
    expect(revisions).toHaveLength(3);
    // The three most recent, so the oldest went first.
    expect(revisions.map((r) => r.body)).toEqual(['v3', 'v4', 'v5']);
  });

  it('keeps nothing at all when the setting is zero', async () => {
    setRevisionKeep(0);
    const note = await makeNote('first');
    await patchNote(note.id, { body: { text: 'second' } }, undefined, tick());
    // A setting has to be able to turn its feature off, or it is not a setting.
    expect(await revisionsFor(note.id)).toEqual([]);
    expect((await getNote(note.id))?.body.text).toBe('second');
  });

  it('restores an old version, and keeps the one it replaced', async () => {
    const note = await makeNote('original');
    await patchNote(note.id, { body: { text: 'a mistake' } }, undefined, tick());
    const revisions = await revisionsFor(note.id);
    const target = revisions[0]?.at as number;

    expect(await restoreRevision(note.id, target)).toBe(true);
    expect((await getNote(note.id))?.body.text).toBe('original');

    // The property that makes this safe to use rather than something to be careful with:
    // picking the wrong version costs nothing, because the mistake is still in the list.
    const after = await revisionsFor(note.id);
    expect(after.map((r) => r.body)).toContain('a mistake');
  });

  it('says no when asked for a version that is not there', async () => {
    const note = await makeNote('only');
    expect(await restoreRevision(note.id, 12345)).toBe(false);
  });

  it('forgets a note history when the note is destroyed', async () => {
    const note = await makeNote('doomed');
    await patchNote(note.id, { body: { text: 'still doomed' } }, undefined, tick());
    expect(await revisionsFor(note.id)).toHaveLength(1);

    await purgeNote(note.id);
    expect(await revisionsFor(note.id)).toEqual([]);
  });

  it('keeps one note history out of another', async () => {
    const a = await makeNote('a1');
    const b = await makeNote('b1');
    await patchNote(a.id, { body: { text: 'a2' } }, undefined, tick());
    await patchNote(b.id, { body: { text: 'b2' } }, undefined, tick());
    await patchNote(b.id, { body: { text: 'b3' } }, undefined, tick());

    expect((await revisionsFor(a.id)).map((r) => r.body)).toEqual(['a1']);
    expect((await revisionsFor(b.id)).map((r) => r.body).sort()).toEqual(['b1', 'b2']);
  });

  it('does not lose the edit if it cannot keep the snapshot', async () => {
    // The transaction covers both stores, so the interesting question is the opposite one:
    // with history off, an edit still lands. Losing someone's typing to protect a feature
    // they turned off would be the worst possible trade.
    setRevisionKeep(0);
    const note = await makeNote('before');
    const out = await patchNote(note.id, { body: { text: 'after' } }, undefined, tick());
    expect(out.ok).toBe(true);
    expect((await getNote(note.id))?.body.text).toBe('after');
  });
});
