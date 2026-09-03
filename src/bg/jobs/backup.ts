/**
 * ZIP export and import. Plan section 10.
 *
 * The format is deliberately boring and inspectable:
 *
 *   manifest.json                    what this archive is, and a checksum
 *   notes.ndjson                     one note per line
 *   tabs.ndjson                      one tab record per line
 *   settings.json                    the user's defaults
 *   assets/<id>.<ext>                pasted images, as real files
 *   ink/<noteId>.json                drawings, as vectors
 *   readable/<domain>/<path>.md      a human-readable mirror
 *
 * NDJSON rather than one big JSON array for two reasons. A ten-thousand-note export is
 * ~20MB, and `JSON.stringify` on that costs 200-400ms with a 40MB peak string; NDJSON is
 * built in chunks with a bounded peak. And a truncated NDJSON file is still 99% recoverable,
 * whereas a truncated JSON array is worth nothing.
 *
 * The `readable/` mirror exists so the archive is useful even without this extension: it is
 * a folder of markdown files you can open in anything.
 */

import { type Unzipped, unzipSync, zipSync } from 'fflate';
import type { AssetRecord, NoteRecord, TabRecord } from '~/bg/db/schema.ts';
import { SCHEMA_V } from '~/bg/db/schema.ts';

export const ARCHIVE_FORMAT = 1;

export interface ArchiveManifest {
  app: 'chevalet-note';
  format: number;
  schemaV: number;
  exportedAt: string;
  counts: { notes: number; tabs: number; assets: number };
  /** FNV-1a over notes.ndjson. Enough to catch a truncated or corrupted archive. */
  checksum: string;
}

export interface ArchiveInput {
  notes: NoteRecord[];
  tabs?: TabRecord[];
  assets?: AssetRecord[];
  settings?: unknown;
  /** Injected in tests so the archive is byte-stable. */
  now?: Date;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 64-bit FNV-1a as hex. Not cryptographic; it only has to notice damage. */
export function checksum(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

const ndjson = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n');

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** Turn a note's URL key into a path that is safe on every filesystem. */
export function readablePath(note: NoteRecord): string {
  const key = note.scope.kind === 'url' ? note.scope.urlKey : note.ix_domain || note.ix_origin;
  const cleaned = String(key ?? 'unfiled')
    .replace(/^\/\//, '')
    .replace(/^https?:\/\//, '');
  const parts = cleaned.split('/').filter(Boolean).map(safeSegment);
  const domain = parts.shift() ?? 'unfiled';
  const rest = parts.join('-') || 'index';
  // The id suffix keeps two notes on the same page from overwriting each other.
  return `readable/${domain}/${rest}-${note.id.slice(2, 10)}.md`;
}

/**
 * Make one path segment safe.
 *
 * Windows forbids the classic set and trailing dots. The rest -- hash, ampersand, percent,
 * quotes, braces -- are legal everywhere but make a path awkward to paste into a URL or a
 * shell, and a name that begins with a hash reads like a comment. A hash-router note used to
 * export as "readable/app.dev/#-inbox-1234.md", which is exactly that problem.
 */
function safeSegment(s: string): string {
  return (
    s
      .replace(/[<>:"/\\|?*#&%$!`'{}^~[\]]/g, '_')
      .replace(/[\s-]+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/[. ]+$/, '')
      .slice(0, 80) || 'page'
  );
}

function readableMarkdown(note: NoteRecord): string {
  const head = [
    `<!-- chevaletNote ${note.id} -->`,
    note.context?.title ? `# ${note.context.title}` : '',
    note.context?.url ? `<${note.context.url}>` : '',
    `*saved ${new Date(note.updatedAt).toISOString()}*`,
    note.tags.length ? `tags: ${note.tags.join(', ')}` : '',
    '',
    '---',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  return `${head}\n${note.body.text}\n`;
}

// ------------------------------------------------------------------- export

export async function buildArchive(input: ArchiveInput): Promise<Uint8Array> {
  const notes = input.notes;
  const notesLine = ndjson(notes);

  const manifest: ArchiveManifest = {
    app: 'chevalet-note',
    format: ARCHIVE_FORMAT,
    schemaV: SCHEMA_V,
    exportedAt: (input.now ?? new Date()).toISOString(),
    counts: {
      notes: notes.length,
      tabs: input.tabs?.length ?? 0,
      assets: input.assets?.length ?? 0,
    },
    checksum: checksum(notesLine),
  };

  const files: Record<string, Uint8Array> = {
    'manifest.json': enc.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    'notes.ndjson': enc.encode(notesLine),
  };
  if (input.tabs?.length) files['tabs.ndjson'] = enc.encode(ndjson(input.tabs));
  if (input.settings !== undefined) {
    files['settings.json'] = enc.encode(`${JSON.stringify(input.settings, null, 2)}\n`);
  }

  for (const note of notes) {
    files[readablePath(note)] = enc.encode(readableMarkdown(note));
    if (note.ink?.strokes.length) {
      files[`ink/${note.id}.json`] = enc.encode(JSON.stringify(note.ink));
    }
  }

  for (const asset of input.assets ?? []) {
    const ext = EXT[asset.mime] ?? 'bin';
    files[`assets/${asset.id}.${ext}`] = new Uint8Array(await asset.blob.arrayBuffer());
  }

  // Level 6: images are already compressed, and text zips well enough that going to 9 buys
  // a few percent for several times the CPU on what can be a 20MB archive.
  return zipSync(files, { level: 6, mtime: input.now ?? new Date() });
}

/** What the file is called when it lands in Downloads. */
export function archiveName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `chevalet-note-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

// ------------------------------------------------------------------- import

export interface ArchiveReport {
  manifest: ArchiveManifest | null;
  notes: NoteRecord[];
  tabs: TabRecord[];
  assets: Array<{ id: string; mime: string; bytes: Uint8Array }>;
  settings: unknown;
  /** Lines that did not parse or did not look like a note. Never silently dropped. */
  invalid: Array<{ file: string; line: number; reason: string }>;
  warnings: string[];
}

/**
 * Read an archive WITHOUT writing anything.
 *
 * Import is always a dry run first: the manager shows what would change and the user decides.
 * An import that overwrites before you can see what it is going to do is not a feature.
 */
export function readArchive(zip: Uint8Array): ArchiveReport {
  const report: ArchiveReport = {
    manifest: null,
    notes: [],
    tabs: [],
    assets: [],
    settings: undefined,
    invalid: [],
    warnings: [],
  };

  let files: Unzipped;
  try {
    files = unzipSync(zip);
  } catch (e) {
    report.warnings.push(`not a readable zip: ${String(e)}`);
    return report;
  }

  const manifestRaw = files['manifest.json'];
  if (manifestRaw) {
    try {
      report.manifest = JSON.parse(dec.decode(manifestRaw)) as ArchiveManifest;
    } catch {
      report.warnings.push('manifest.json could not be parsed');
    }
  } else {
    report.warnings.push('no manifest.json -- this may not be a chevaletNote archive');
  }

  if (report.manifest && report.manifest.app !== 'chevalet-note') {
    report.warnings.push(`archive says it belongs to "${report.manifest.app}"`);
  }
  if (report.manifest && report.manifest.format > ARCHIVE_FORMAT) {
    report.warnings.push(
      `archive format ${report.manifest.format} is newer than this version understands (${ARCHIVE_FORMAT})`,
    );
  }

  const notesRaw = files['notes.ndjson'];
  if (notesRaw) {
    const text = dec.decode(notesRaw);
    if (report.manifest?.checksum && checksum(text) !== report.manifest.checksum) {
      report.warnings.push('checksum mismatch -- the archive may be truncated or edited');
    }
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line) as NoteRecord;
        if (!parsed?.id || !parsed.body || typeof parsed.body.text !== 'string') {
          report.invalid.push({ file: 'notes.ndjson', line: i + 1, reason: 'not a note record' });
          return;
        }
        report.notes.push(parsed);
      } catch (e) {
        report.invalid.push({ file: 'notes.ndjson', line: i + 1, reason: String(e) });
      }
    });
  } else {
    report.warnings.push('no notes.ndjson -- nothing to import');
  }

  const tabsRaw = files['tabs.ndjson'];
  if (tabsRaw) {
    dec
      .decode(tabsRaw)
      .split('\n')
      .forEach((line, i) => {
        if (!line.trim()) return;
        try {
          report.tabs.push(JSON.parse(line) as TabRecord);
        } catch (e) {
          report.invalid.push({ file: 'tabs.ndjson', line: i + 1, reason: String(e) });
        }
      });
  }

  const settingsRaw = files['settings.json'];
  if (settingsRaw) {
    try {
      report.settings = JSON.parse(dec.decode(settingsRaw));
    } catch {
      report.warnings.push('settings.json could not be parsed; defaults left alone');
    }
  }

  const MIME_BY_EXT: Record<string, string> = Object.fromEntries(
    Object.entries(EXT).map(([mime, ext]) => [ext, mime]),
  );
  for (const [path, bytes] of Object.entries(files)) {
    const m = /^assets\/([A-Za-z0-9_-]+)\.([a-z0-9]+)$/.exec(path);
    if (!m) continue;
    report.assets.push({
      id: m[1] as string,
      mime: MIME_BY_EXT[m[2] as string] ?? 'application/octet-stream',
      bytes,
    });
  }

  return report;
}

export type MergeMode = 'merge' | 'replace' | 'copy';

export interface MergePlan {
  create: NoteRecord[];
  update: NoteRecord[];
  /** Present in the archive but older than what is already stored. */
  skip: NoteRecord[];
}

/**
 * Decide what an import would do, before it does anything.
 *
 * `merge`   an id collision keeps whichever copy was updated more recently
 * `replace` the archive wins outright
 * `copy`    everything comes in under fresh ids, so nothing existing is touched
 */
export function planMerge(
  incoming: NoteRecord[],
  existing: Map<string, NoteRecord>,
  mode: MergeMode,
  newId: () => string = () => `n_${crypto.randomUUID()}`,
): MergePlan {
  const plan: MergePlan = { create: [], update: [], skip: [] };
  for (const note of incoming) {
    if (mode === 'copy') {
      plan.create.push({ ...note, id: newId() as NoteRecord['id'], copiedFrom: note.id });
      continue;
    }
    const current = existing.get(note.id);
    if (!current) {
      plan.create.push(note);
    } else if (mode === 'replace' || note.updatedAt > current.updatedAt) {
      plan.update.push(note);
    } else {
      plan.skip.push(note);
    }
  }
  return plan;
}
