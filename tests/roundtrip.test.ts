/**
 * Export a real database, wipe it, import the archive back, and check what came home.
 *
 * ## Why this is a separate file from `import.test.ts`
 *
 * That file checks the decisions -- what is recomputed, what is trusted, what order things
 * happen in -- with fake dependencies, because that is what makes those cases readable. This
 * one checks the thing a person actually cares about, which is not a decision at all: **if I
 * export and my machine dies, do I get my notes back?**
 *
 * The two failure modes it exists for are both ones this project has already had:
 *
 *   - a field that is written but never read back. `ink` was sent over the wire by the
 *     background and dropped one line short of the screen, so every drawing was lost on
 *     reload. An archive is exactly the same shape of pipe, and a drawing that survives the
 *     zip but not the import would be invisible in every unit test written against a fake.
 *   - an index column that is stored but no longer means what it meant. Notes come back, and
 *     are in no drawer.
 *
 * So this goes through the REAL store functions and the REAL scope matcher on fake-indexeddb,
 * and asserts on what the interface would show: `notesForContext` for the page the note was
 * made on, and the trash for the one that was in the trash.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addRevision,
  allAssets,
  allNotes,
  createNote,
  getNote,
  listTrash,
  notesForContext,
  putAssetBytes,
  putNote,
  trashNote,
} from '~/bg/db/notes.ts';
import { openDb, resetDb } from '~/bg/db/open.ts';
import type { NoteRecord, NoteUi } from '~/bg/db/schema.ts';
import { buildArchive, readArchive } from '~/bg/jobs/backup.ts';
import { applyImport } from '~/bg/jobs/import.ts';
import { defaultScopeFor, matchContext } from '~/bg/scope/match.ts';

const UI: NoteUi = {
  x: 40,
  y: 60,
  w: 260,
  h: 180,
  z: 7,
  collapsed: false,
  locked: false,
  opacity: 1,
};

const PAGE = 'https://example.org/an-article';

/** The deps the manager passes in, which is the point: this is the shipped wiring. */
const DEPS = {
  existing: allNotes,
  putNote,
  putAssetBytes,
  addRevision,
};

async function seed(): Promise<void> {
  const scope = defaultScopeFor(PAGE);
  if (!scope) throw new Error('no scope for the test page');

  const withInk = await createNote({
    scope,
    text: 'a note with a drawing on it',
    ui: UI,
    style: { palette: 'postit' },
    context: { url: PAGE, title: 'An article' },
  });
  // Drawings live on the note record, so they ride in notes.ndjson. The separate ink/*.json in
  // the archive is a human-readable duplicate and is NOT the import path -- if someone
  // "fixes" that by reading the folder instead, this test is what should fail.
  await putNote({
    ...withInk,
    ink: {
      strokes: [{ points: [10, 20, 0.5, 30, 40, 0.5], color: '#ff2e63', size: 3 }],
      w: 260,
      h: 180,
    },
  } as NoteRecord);

  await createNote({
    scope: { kind: 'domain', registrable: 'example.org', includeSubdomains: true },
    text: 'a domain-wide note',
    ui: UI,
    context: { url: PAGE, title: 'An article' },
  });

  const doomed = await createNote({
    scope,
    text: 'this one was in the trash when the archive was made',
    ui: UI,
    context: { url: PAGE, title: 'An article' },
  });
  await trashNote(doomed.id);
}

describe('export and import, through the real store', () => {
  beforeEach(async () => {
    // A brand-new IndexedDB per test, or the second test imports into the first one's leftovers.
    globalThis.indexedDB = new IDBFactory();
    resetDb();
    await openDb();
  });

  it('brings back every note, its drawing, its scope and its trash state', async () => {
    await seed();
    const before = await allNotes();
    const zip = await buildArchive({
      notes: before,
      settings: { theme: 'dark' },
      now: new Date('2026-09-05T10:00:00Z'),
    });

    // The disaster: a new machine, an empty database, one zip file.
    globalThis.indexedDB = new IDBFactory();
    resetDb();
    await openDb();
    expect(await allNotes()).toEqual([]);

    const report = readArchive(zip);
    expect(report.warnings).toEqual([]);
    expect(report.invalid).toEqual([]);

    const out = await applyImport(report, DEPS, { mode: 'merge' });
    expect(out.created).toBe(before.length);
    expect(out.failed).toEqual([]);

    // What the interface would show, not what the table contains.
    const ctx = matchContext(PAGE, 'tab-1');
    if (!ctx) throw new Error('no match context for the test page');
    const onPage = await notesForContext(ctx);
    expect(onPage.map((n) => n.body.text).sort()).toEqual(
      ['a domain-wide note', 'a note with a drawing on it'].sort(),
    );

    const drawing = onPage.find((n) => n.body.text.includes('drawing'));
    expect(drawing?.ink?.strokes).toHaveLength(1);
    expect(drawing?.ink?.strokes[0]?.color).toBe('#ff2e63');
    expect(drawing?.ink?.strokes[0]?.points).toEqual([10, 20, 0.5, 30, 40, 0.5]);
    expect(drawing?.ui.z).toBe(7);
    expect(drawing?.style).toEqual({ palette: 'postit' });

    const trash = await listTrash();
    expect(trash).toHaveLength(1);
    expect(trash[0]?.body.text).toContain('in the trash');
    // And it can be swept, which needs a date the archive did not have to carry.
    expect(Number.isFinite(trash[0]?.deletedAt)).toBe(true);
  });

  it('brings back a pasted image, under the id the note points at', async () => {
    const scope = defaultScopeFor(PAGE);
    if (!scope) throw new Error('no scope');
    const note = await createNote({ scope, text: 'has a picture', ui: UI });
    await putAssetBytes({
      id: 'a_deadbeef',
      noteId: note.id,
      mime: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
    });
    await putNote({ ...note, assets: ['a_deadbeef'] } as NoteRecord);

    const zip = await buildArchive({ notes: await allNotes(), assets: await allAssets() });

    globalThis.indexedDB = new IDBFactory();
    resetDb();
    await openDb();

    const out = await applyImport(readArchive(zip), DEPS, { mode: 'merge' });
    expect(out.assets).toBe(1);
    expect(out.missingAssets).toBe(0);

    const back = (await allNotes())[0];
    expect(back?.assets).toEqual(['a_deadbeef']);
    const assets = await allAssets();
    // The id has to survive, or the note points at nothing and the image is unreachable
    // rather than merely missing.
    expect(assets[0]?.id).toBe('a_deadbeef');
    expect(assets[0]?.blob.size).toBe(4);
    expect(assets[0]?.noteId).toBe(back?.id);
  });

  it('keeps the note that is already here when the archive is older', async () => {
    await seed();
    const zip = await buildArchive({ notes: await allNotes() });

    // Edit one of them after the archive was made, the way a person would.
    const first = (await allNotes())[0] as NoteRecord;
    await putNote({
      ...first,
      body: { format: 'md', text: 'edited since' },
      updatedAt: Date.now() + 5000,
    });

    const out = await applyImport(readArchive(zip), DEPS, { mode: 'merge' });
    // All three are skipped, and that is right: one because the stored copy is newer, and the
    // other two because the archive's copy is the SAME age. "Newer than" is a strict
    // comparison on purpose -- re-importing an untouched archive should write nothing at all,
    // and an equal timestamp means there is nothing to do.
    expect(out.updated).toBe(0);
    expect(out.skipped).toBe(3);
    expect((await getNote(first.id))?.body.text).toBe('edited since');
  });

  it('warns when notes.ndjson does not match the checksum in the manifest', async () => {
    await seed();
    const zip = await buildArchive({ notes: await allNotes() });

    /*
     * Surgery, not a random byte flip.
     *
     * The first version of this test xor-ed one byte in the middle of the file and expected a
     * warning. It got none, and the test was wrong rather than the code: an archive holds a
     * manifest, the notes, a settings file and one markdown mirror per note, so a byte in the
     * middle lands in a file nobody validates. Damaging what the checksum is FOR is the only
     * way to find out whether the checksum works.
     */
    const files = unzipSync(zip);
    const notes = new TextDecoder().decode(files['notes.ndjson'] as Uint8Array);
    files['notes.ndjson'] = new TextEncoder().encode(notes.slice(0, Math.floor(notes.length / 2)));
    const damaged = zipSync(files);

    const report = readArchive(damaged);
    expect(report.warnings.join(' ')).toContain('checksum');
    // And the notes that DID survive the truncation are still offered, because half a restore
    // beats none -- the last line is simply dropped as unparseable.
    expect(report.notes.length + report.invalid.length).toBeGreaterThan(0);
  });
});
