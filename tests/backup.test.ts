import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildNote } from '~/bg/db/notes.ts';
import type { NoteRecord, NoteUi } from '~/bg/db/schema.ts';
import {
  ARCHIVE_FORMAT,
  type ArchiveManifest,
  archiveName,
  buildArchive,
  checksum,
  planMerge,
  readArchive,
  readablePath,
} from '~/bg/jobs/backup.ts';
import { DEFAULT_URL_MATCH, type UrlKey } from '~/shared/types.ts';

const UI: NoteUi = {
  x: 12,
  y: 34,
  w: 240,
  h: 170,
  z: 1,
  collapsed: false,
  locked: false,
  opacity: 1,
};

const NOW = new Date('2026-09-03T12:00:00.000Z');

function note(text: string, urlKey: string, extra: Partial<NoteRecord> = {}): NoteRecord {
  return {
    ...buildNote(
      {
        scope: { kind: 'url', urlKey: urlKey as UrlKey, match: { ...DEFAULT_URL_MATCH } },
        text,
        ui: { ...UI },
        context: { url: `https:${urlKey}`, title: 'A page' },
      },
      NOW.getTime(),
    ),
    ...extra,
  };
}

const dec = new TextDecoder();

describe('buildArchive', () => {
  it('writes the files the format promises', async () => {
    const zip = await buildArchive({ notes: [note('hello', '//example.com/a')], now: NOW });
    const files = Object.keys(unzipSync(zip));
    expect(files).toContain('manifest.json');
    expect(files).toContain('notes.ndjson');
    expect(files.some((f) => f.startsWith('readable/example.com/'))).toBe(true);
  });

  it('records honest counts and a checksum over the notes', async () => {
    const notes = [note('a', '//e.com/1'), note('b', '//e.com/2')];
    const zip = await buildArchive({ notes, now: NOW });
    const files = unzipSync(zip);
    const manifest = JSON.parse(
      dec.decode(files['manifest.json'] as Uint8Array),
    ) as ArchiveManifest;
    expect(manifest.app).toBe('chevalet-note');
    expect(manifest.format).toBe(ARCHIVE_FORMAT);
    expect(manifest.counts.notes).toBe(2);
    expect(manifest.checksum).toBe(checksum(dec.decode(files['notes.ndjson'] as Uint8Array)));
  });

  it('is one line per note, so a truncated archive still yields most of it', async () => {
    const notes = Array.from({ length: 25 }, (_, i) => note(`note ${i}`, `//e.com/${i}`));
    const zip = await buildArchive({ notes, now: NOW });
    const body = dec.decode(unzipSync(zip)['notes.ndjson'] as Uint8Array);
    expect(body.split('\n')).toHaveLength(25);
    for (const line of body.split('\n')) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('mirrors each note as readable markdown that carries its own provenance', async () => {
    const zip = await buildArchive({
      notes: [note('# Milk\n\n- bread', '//shop.test/list')],
      now: NOW,
    });
    const files = unzipSync(zip);
    const path = Object.keys(files).find((f) => f.startsWith('readable/')) as string;
    const md = dec.decode(files[path] as Uint8Array);
    expect(md).toContain('# A page');
    expect(md).toContain('https://shop.test/list');
    expect(md).toContain('- bread');
  });

  it('stores ink as vectors in its own file', async () => {
    const withInk = note('drawn', '//e.com/d', {
      ink: { strokes: [{ points: [1, 2, 0.5], color: '#000', size: 7 }], w: 240, h: 170 },
    });
    const files = unzipSync(await buildArchive({ notes: [withInk], now: NOW }));
    const inkFile = Object.keys(files).find((f) => f.startsWith('ink/')) as string;
    expect(inkFile).toBeDefined();
    expect(JSON.parse(dec.decode(files[inkFile] as Uint8Array)).strokes).toHaveLength(1);
  });

  it('stores images as real files with the right extension', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const zip = await buildArchive({
      notes: [note('with a picture', '//e.com/p')],
      assets: [
        {
          id: 'a_abc123',
          noteId: 'n_1',
          name: 'shot.png',
          mime: 'image/png',
          size: 4,
          blob: new Blob([bytes], { type: 'image/png' }),
          createdAt: NOW.getTime(),
        },
      ],
      now: NOW,
    });
    const files = unzipSync(zip);
    expect(files['assets/a_abc123.png']).toEqual(bytes);
  });

  it('produces byte-identical output for identical input', async () => {
    const notes = [note('same', '//e.com/x')];
    const a = await buildArchive({ notes, now: NOW });
    const b = await buildArchive({ notes, now: NOW });
    expect(a).toEqual(b);
  });
});

describe('readablePath', () => {
  it('groups by domain and never emits a character Windows rejects', () => {
    const p = readablePath(note('x', '//example.com/docs/api?q=a:b'));
    expect(p.startsWith('readable/example.com/')).toBe(true);
    // Assert the real requirement -- none of the characters Windows forbids in a filename --
    // rather than a whitelist, which would reject perfectly legal ones like "=".
    const segments = p.split('/').slice(1);
    for (const seg of segments) {
      expect(seg, `illegal character in "${seg}"`).not.toMatch(/[<>:"\\|?*]/);
      const control = [...seg].some((ch) => {
        const code = ch.codePointAt(0) ?? 0;
        return code < 0x20 || code === 0x7f;
      });
      expect(control, `control character in "${seg}"`).toBe(false);
      expect(seg, `trailing dot or space in "${seg}"`).not.toMatch(/[. ]$/);
    }
    expect(p.endsWith('.md')).toBe(true);
  });

  it('does not produce a name that starts with # or carries shell characters', () => {
    // A hash-router note used to export as "readable/app.dev/#-inbox-1234.md".
    const p = readablePath(note('x', '//app.dev/#/inbox'));
    const file = p.split('/').pop() as string;
    expect(file.startsWith('#')).toBe(false);
    expect(file).not.toMatch(/[#&%$!`'{}^~[\]]/);
    expect(file.endsWith('.md')).toBe(true);
  });

  it('gives two notes on the same page different files', () => {
    const a = readablePath(note('one', '//e.com/same'));
    const b = readablePath(note('two', '//e.com/same'));
    expect(a).not.toBe(b);
  });

  it('does not fall over on a note with no url scope', () => {
    const domainNote: NoteRecord = {
      ...note('x', '//e.com/a'),
      scope: { kind: 'domain', registrable: 'e.com', includeSubdomains: false },
      ix_domain: 'e.com',
    };
    expect(readablePath(domainNote)).toContain('readable/e.com/');
  });
});

describe('readArchive', () => {
  it('round-trips notes exactly', async () => {
    const notes = [note('first', '//e.com/1'), note('second', '//e.com/2')];
    const report = readArchive(await buildArchive({ notes, tabs: [], now: NOW }));
    expect(report.warnings).toEqual([]);
    expect(report.invalid).toEqual([]);
    expect(report.notes).toEqual(notes);
  });

  it('round-trips settings and images', async () => {
    const zip = await buildArchive({
      notes: [note('x', '//e.com/a')],
      settings: { palette: 'acid', fontSize: 17 },
      assets: [
        {
          id: 'a_pic',
          noteId: 'n_1',
          name: 'p.png',
          mime: 'image/png',
          size: 2,
          blob: new Blob([new Uint8Array([9, 9])], { type: 'image/png' }),
          createdAt: NOW.getTime(),
        },
      ],
      now: NOW,
    });
    const report = readArchive(zip);
    expect(report.settings).toEqual({ palette: 'acid', fontSize: 17 });
    expect(report.assets).toHaveLength(1);
    expect(report.assets[0]?.mime).toBe('image/png');
    expect(report.assets[0]?.bytes).toEqual(new Uint8Array([9, 9]));
  });

  /** An import must never destroy data because one line was damaged. */
  it('reports a bad line and keeps every good one', async () => {
    const zip = await buildArchive({ notes: [note('good', '//e.com/g')], now: NOW });
    const files = unzipSync(zip);
    const body = dec.decode(files['notes.ndjson'] as Uint8Array);
    const damaged = new TextEncoder().encode(`${body}\n{ this is not json`);
    const { zipSync } = await import('fflate');
    const report = readArchive(zipSync({ ...files, 'notes.ndjson': damaged }));
    expect(report.notes).toHaveLength(1);
    expect(report.invalid).toHaveLength(1);
    expect(report.invalid[0]?.line).toBe(2);
  });

  it('rejects a line that parses but is not a note', async () => {
    const { zipSync } = await import('fflate');
    const report = readArchive(
      zipSync({ 'notes.ndjson': new TextEncoder().encode('{"id":"n_1"}') }),
    );
    expect(report.notes).toEqual([]);
    expect(report.invalid[0]?.reason).toBe('not a note record');
  });

  it('notices a tampered archive through the checksum', async () => {
    const zip = await buildArchive({ notes: [note('original', '//e.com/o')], now: NOW });
    const files = unzipSync(zip);
    const tampered = JSON.parse(dec.decode(files['notes.ndjson'] as Uint8Array)) as NoteRecord;
    tampered.body.text = 'edited by hand';
    const { zipSync } = await import('fflate');
    const report = readArchive(
      zipSync({ ...files, 'notes.ndjson': new TextEncoder().encode(JSON.stringify(tampered)) }),
    );
    expect(report.warnings.join(' ')).toContain('checksum mismatch');
    // ...and still hands the notes over, because a warning is not a refusal.
    expect(report.notes).toHaveLength(1);
  });

  it('says so plainly when handed something that is not an archive', () => {
    const report = readArchive(new Uint8Array([1, 2, 3, 4, 5]));
    expect(report.notes).toEqual([]);
    expect(report.warnings.join(' ')).toContain('not a readable zip');
  });

  it('warns about an archive from a newer version instead of guessing', async () => {
    const zip = await buildArchive({ notes: [note('x', '//e.com/a')], now: NOW });
    const files = unzipSync(zip);
    const manifest = JSON.parse(dec.decode(files['manifest.json'] as Uint8Array));
    manifest.format = ARCHIVE_FORMAT + 5;
    const { zipSync } = await import('fflate');
    const report = readArchive(
      zipSync({ ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) }),
    );
    expect(report.warnings.join(' ')).toContain('newer than this version understands');
  });
});

describe('planMerge', () => {
  const older = {
    ...note('old text', '//e.com/a'),
    id: 'n_same' as NoteRecord['id'],
    updatedAt: 1000,
  };
  const newer = {
    ...note('new text', '//e.com/a'),
    id: 'n_same' as NoteRecord['id'],
    updatedAt: 2000,
  };

  it('merge keeps whichever copy is newer', () => {
    expect(planMerge([newer], new Map([['n_same', older]]), 'merge').update).toEqual([newer]);
    expect(planMerge([older], new Map([['n_same', newer]]), 'merge').skip).toEqual([older]);
  });

  it('replace lets the archive win even when it is older', () => {
    expect(planMerge([older], new Map([['n_same', newer]]), 'replace').update).toEqual([older]);
  });

  it('copy touches nothing that already exists', () => {
    const plan = planMerge([older], new Map([['n_same', newer]]), 'copy', () => 'n_fresh');
    expect(plan.update).toEqual([]);
    expect(plan.skip).toEqual([]);
    expect(plan.create[0]?.id).toBe('n_fresh');
    expect(plan.create[0]?.copiedFrom).toBe('n_same');
  });

  it('an unseen note is always a create', () => {
    expect(planMerge([newer], new Map(), 'merge').create).toEqual([newer]);
  });
});

describe('archiveName', () => {
  it('sorts chronologically as a filename', () => {
    const a = archiveName(new Date(2026, 0, 5, 9, 4));
    const b = archiveName(new Date(2026, 10, 5, 9, 4));
    expect(a).toBe('chevalet-note-2026-01-05-0904.zip');
    expect([b, a].sort()).toEqual([a, b]);
  });
});
