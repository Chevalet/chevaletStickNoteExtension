// @vitest-environment happy-dom
/**
 * Naming a note.
 *
 * The whole design is one decision: a name is a FIELD OF ITS OWN, not a value written into
 * `title`. `title` is re-derived from the body on every keystroke, so a name stored there
 * would survive exactly until the next character was typed -- and it would have looked like it
 * worked for as long as nobody edited the note afterwards, which is the worst kind of bug.
 *
 * The other decision, which most of these check: unnamed means the field is ABSENT, never an
 * empty string. One question, one answer, everywhere it is asked.
 *
 * happy-dom rather than node, because `toHtml` renders through the app's own markdown renderer
 * and so needs a document. fake-indexeddb is happy either way.
 */

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNote, getNote, patchNote, setRevisionKeep } from '~/bg/db/notes.ts';
import { openDb, resetDb } from '~/bg/db/open.ts';
import type { NoteRecord, NoteUi } from '~/bg/db/schema.ts';
import { toHtml, toMarkdown } from '~/bg/jobs/export-text.ts';
import { sanitizeName } from '~/bg/msg/sanitize.ts';
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

describe('sanitizeName', () => {
  it('takes an ordinary name', () => {
    expect(sanitizeName('Shopping list')).toBe('Shopping list');
  });

  it('flattens a pasted line rather than refusing it', () => {
    // The obvious way to get a newline into the box is to paste a line of text that ends with
    // one. Refusing the paste is a worse answer than trimming it.
    expect(sanitizeName('two\nlines\there')).toBe('two lines here');
  });

  it('trims, and treats whitespace-only as no name at all', () => {
    expect(sanitizeName('  spaced  ')).toBe('spaced');
    expect(sanitizeName('   ')).toBeUndefined();
    expect(sanitizeName('')).toBeUndefined();
  });

  it('caps the length, so a name cannot be a note', () => {
    expect(sanitizeName('x'.repeat(500))?.length).toBe(120);
  });

  it('refuses anything that is not a string', () => {
    expect(sanitizeName(42)).toBeUndefined();
    expect(sanitizeName(null)).toBeUndefined();
    expect(sanitizeName({ toString: () => 'sneaky' })).toBeUndefined();
  });

  it('keeps Persian exactly as it is', () => {
    expect(sanitizeName('فهرست خرید')).toBe('فهرست خرید');
  });
});

describe('a name in the store', () => {
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    resetDb();
    await openDb();
    setRevisionKeep(50);
  });

  async function make(text = 'first line\nsecond'): Promise<NoteRecord> {
    const scope = defaultScopeFor(PAGE);
    if (!scope) throw new Error('no scope');
    return createNote({ scope, text, ui: UI });
  }

  it('is absent on a new note', async () => {
    const note = await make();
    expect(note.name).toBeUndefined();
    // And the derived title is still there, because that is what the cabinet falls back to.
    expect(note.title).toBe('first line');
  });

  it('is stored, and does not disturb the derived title', async () => {
    const note = await make();
    await patchNote(note.id, { name: 'Groceries' });
    const back = await getNote(note.id);
    expect(back?.name).toBe('Groceries');
    expect(back?.title).toBe('first line');
  });

  it('SURVIVES an edit to the body', async () => {
    // The test that justifies the separate field. Writing the name into `title` would pass
    // every other test in this file and fail this one.
    const note = await make();
    await patchNote(note.id, { name: 'Groceries' });
    await patchNote(note.id, { body: { text: 'a completely different first line' } });
    const back = await getNote(note.id);
    expect(back?.name).toBe('Groceries');
    expect(back?.title).toBe('a completely different first line');
  });

  it('is cleared by an empty string, and removed rather than blanked', async () => {
    const note = await make();
    await patchNote(note.id, { name: 'Temporary' });
    await patchNote(note.id, { name: '' });
    const back = await getNote(note.id);
    expect(back?.name).toBeUndefined();
    expect('name' in (back ?? {})).toBe(false);
  });

  it('is left alone by a patch that does not mention it', async () => {
    const note = await make();
    await patchNote(note.id, { name: 'Kept' });
    await patchNote(note.id, { ui: { x: 400 } });
    expect((await getNote(note.id))?.name).toBe('Kept');
  });

  it('is trimmed and capped on the way in, wherever it came from', async () => {
    const note = await make();
    await patchNote(note.id, { name: `  ${'y'.repeat(400)}  ` });
    expect((await getNote(note.id))?.name?.length).toBe(120);
  });

  it('gets its own field clock, so renaming never conflicts with typing', async () => {
    const note = await make();
    const out = await patchNote(note.id, { name: 'Clocked' }, undefined, 12345);
    expect(out.ok && out.note.fieldClock.name).toBe(12345);
  });
});

describe('a name in an export', () => {
  const note = (over: Partial<NoteRecord>): NoteRecord =>
    ({
      id: 'n_1',
      schemaV: 3,
      rev: 1,
      scope: { kind: 'url', urlKey: PAGE },
      ix_state: 'active',
      ix_urlKeys: [],
      ix_origin: '',
      ix_domain: '',
      ix_tabKey: '',
      ix_scopeKind: 'url',
      body: { format: 'md', text: 'the body' },
      assets: [],
      title: 'the body',
      tags: [],
      anchor: null,
      ui: UI,
      style: {},
      createdAt: 1,
      updatedAt: 2,
      fieldClock: {},
      ...over,
    }) as NoteRecord;

  it('is a heading in the Markdown, above the text', () => {
    const out = toMarkdown({ notes: [note({ name: 'Groceries' })] });
    expect(out).toContain('### Groceries');
    expect(out.indexOf('### Groceries')).toBeLessThan(out.indexOf('the body'));
  });

  it('is absent from the Markdown when the note has no name', () => {
    // Nothing to invent: the first line of the note is already the first line of the note.
    expect(toMarkdown({ notes: [note({})] })).not.toContain('###');
  });

  it('is a heading in the HTML, and escaped', () => {
    const { html } = toHtml({ notes: [note({ name: '<script>x</script> & co' })] });
    expect(html).toContain('&lt;script&gt;');
    expect(html.toLowerCase()).not.toContain('<script>x');
    expect(html).toContain('class="named"');
  });
});
