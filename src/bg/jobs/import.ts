/**
 * Applying an import plan. The half of backup that was missing.
 *
 * `backup.ts` could read an archive, check its checksum and work out what an import WOULD do.
 * It could not do it. A backup you cannot restore is not a backup -- it is a file that makes
 * you feel safe -- so this is the part that writes.
 *
 * ## Everything here is either pure, or a one-line call on an injected dependency
 *
 * `normaliseForImport` is pure and does the thinking; `applyImport` does the writing and holds
 * no logic worth testing. That split is not stylistic. The interesting decisions below are all
 * about trust, and every one of them is a case that has to be written down and checked, which
 * needs a function you can call with a made-up note and no database at all.
 *
 * ## What an archive is NOT trusted about
 *
 * An archive is a file on disk. It may have been written by an older version of this
 * extension, hand-edited, or moved between machines, so each field is either recomputed or
 * defended:
 *
 *   ix_*        RECOMPUTED from `scope`. These are denormalised index columns, and the mapping
 *               from a scope to them has changed once already. Trusting a stale set is how a
 *               note ends up in the wrong drawer, or in no drawer -- present in the database,
 *               invisible in the interface, and impossible to explain.
 *   rev         Set past whatever is stored, never taken from the archive. It is the
 *               optimistic-concurrency token: a patch that was already in flight when the
 *               import landed has to lose, and it does that by finding a rev it did not expect.
 *   schemaV     Stamped to the current version, because the record written IS in the current
 *               shape -- everything the current shape needs is either in the archive or filled
 *               in here. An imported note claiming schemaV 1 would be migrated a second time
 *               on the next upgrade.
 *   title       Re-derived from the body. A hand-edited archive can carry a title that does
 *               not match its text, and the manager lists from `title` without parsing.
 *   assets      Filtered to the ids the archive actually carries. A reference to an image that
 *               is not in the file paints nothing, for ever; dropping it is the honest state,
 *               and the count comes back in the result so the user is told.
 *   ui.z        Left alone. Stacking order is cosmetic and preserving it keeps a page looking
 *               the way it looked.
 *
 *   createdAt / updatedAt  KEPT as the archive has them. This is the one place where trusting
 *               the file is right: `updatedAt` is what `merge` mode compares to decide whether
 *               the archive's copy is newer, and stamping it with the current time would make
 *               every re-import of the same archive look like a fresh edit -- and, worse, make
 *               the SECOND import of an old archive overwrite the newer note it had correctly
 *               skipped the first time.
 *
 * ## Before an overwrite, the old body is kept
 *
 * Every note that `update` touches gets a revision recorded first, with reason `import`. That
 * is the only reason an import is safe to run twice: whatever it overwrote is still there. It
 * is also what makes "revisions kept per note" a real setting again -- that control was
 * removed in 0.0.10 precisely because nothing called `addRevision`.
 *
 * ## Not a transaction, and it says so
 *
 * The notes go in one at a time. IndexedDB could hold one transaction over the lot, but a
 * ten-thousand-note archive in a single transaction is a several-second stall on the event
 * page with a real chance of the browser killing it half way -- which is the failure mode this
 * is meant to avoid. So each note is its own write, failures are collected rather than thrown,
 * and the result says exactly how far it got. A half-finished import of independent notes is a
 * recoverable state; a half-finished transaction that rolled back a thousand good notes
 * because the thousand-and-first was malformed is not.
 */

import { getMeta, setMeta } from '~/bg/db/notes.ts';
import type { NoteRecord, RevisionRecord } from '~/bg/db/schema.ts';
import { deriveTitle, SCHEMA_V } from '~/bg/db/schema.ts';
import { indexColumns } from '~/bg/scope/match.ts';
import type { AssetId } from '~/shared/types.ts';
import type { ArchiveReport, MergeMode, MergePlan } from './backup.ts';
import { planMerge } from './backup.ts';

export interface Normalised {
  note: NoteRecord;
  /** Asset ids the note referenced that the archive does not carry. */
  missingAssets: AssetId[];
}

/**
 * Turn a note as it appears in an archive into a note that can be written to this database.
 *
 * `existing` is whatever is already stored under that id, or undefined. `haveAssets` is the
 * set of asset ids the archive carries.
 */
export function normaliseForImport(
  incoming: NoteRecord,
  existing: NoteRecord | undefined,
  haveAssets: ReadonlySet<string>,
): Normalised {
  const state = incoming.ix_state === 'trashed' ? 'trashed' : 'active';
  const text = typeof incoming.body?.text === 'string' ? incoming.body.text : '';
  const kept: AssetId[] = [];
  const missingAssets: AssetId[] = [];
  for (const id of Array.isArray(incoming.assets) ? incoming.assets : []) {
    if (haveAssets.has(id)) kept.push(id);
    else missingAssets.push(id);
  }

  const note: NoteRecord = {
    ...incoming,
    schemaV: SCHEMA_V,
    rev: Math.max(existing?.rev ?? 0, incoming.rev ?? 0) + 1,
    ix_state: state,
    ...indexColumns(incoming.scope, state),
    body: { format: 'md', text },
    title: deriveTitle(text),
    tags: Array.isArray(incoming.tags) ? incoming.tags : [],
    assets: kept,
    fieldClock: incoming.fieldClock ?? {},
  };

  // A trashed note with no deletion date can never be swept, and the retention job refuses to
  // guess one -- so give it the moment it was archived rather than leaving it immortal.
  if (state === 'trashed' && !Number.isFinite(note.deletedAt)) {
    note.deletedAt = incoming.updatedAt;
  }
  if (state === 'active' && note.deletedAt !== undefined) delete note.deletedAt;

  return { note, missingAssets };
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  assets: number;
  /** Notes whose write threw. The import carries on past them. */
  failed: Array<{ id: string; reason: string }>;
  /** Asset references in the archive's notes that the archive itself does not contain. */
  missingAssets: number;
  settingsApplied: boolean;
}

export interface ImportDeps {
  existing(): Promise<NoteRecord[]>;
  putNote(note: NoteRecord): Promise<unknown>;
  /** Writes an asset under the id it already has, so a note's references keep working. */
  putAssetBytes(a: { id: string; noteId: string; mime: string; bytes: Uint8Array }): Promise<void>;
  addRevision(rev: RevisionRecord): Promise<void>;
  applySettings?(settings: unknown): Promise<void>;
  now?(): number;
}

export interface ImportOptions {
  mode: MergeMode;
  /** Off by default: importing someone else's preferences is a surprise, not a restore. */
  withSettings?: boolean;
  newId?: () => string;
}

/**
 * Write an archive into the database.
 *
 * Returns what it did, including what it could not do. Nothing here throws for a bad note --
 * a single malformed record must not be able to abandon the other nine thousand.
 */
export async function applyImport(
  report: ArchiveReport,
  deps: ImportDeps,
  options: ImportOptions,
): Promise<ImportResult> {
  const now = deps.now?.() ?? Date.now();
  const result: ImportResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    assets: 0,
    failed: [],
    missingAssets: 0,
    settingsApplied: false,
  };

  const existing = new Map((await deps.existing()).map((n) => [n.id as string, n]));
  const plan: MergePlan = planMerge(
    report.notes,
    existing as Map<string, NoteRecord>,
    options.mode,
    options.newId,
  );
  result.skipped = plan.skip.length;

  const haveAssets = new Set(report.assets.map((a) => a.id));

  for (const [group, notes] of [
    ['create', plan.create],
    ['update', plan.update],
  ] as const) {
    for (const raw of notes) {
      const before = existing.get(raw.id as string);
      const { note, missingAssets } = normaliseForImport(raw, before, haveAssets);
      result.missingAssets += missingAssets.length;
      try {
        // The old body first, so an overwrite is recoverable. If this fails the note is still
        // written: losing the safety net is better than losing the import.
        if (group === 'update' && before) {
          await deps
            .addRevision({
              noteId: before.id,
              rev: before.rev,
              at: now,
              body: before.body.text,
              title: before.title,
              reason: 'import',
            })
            .catch(() => {});
        }
        await deps.putNote(note);
        if (group === 'create') result.created++;
        else result.updated++;
      } catch (e) {
        result.failed.push({ id: String(raw.id), reason: String(e) });
      }
    }
  }

  // Assets last: a note without its image is a note; an image with no note is litter. Only
  // the ones some imported note actually points at get written.
  const wanted = new Map<string, string>();
  for (const note of [...plan.create, ...plan.update]) {
    for (const id of Array.isArray(note.assets) ? note.assets : []) wanted.set(id, note.id);
  }
  for (const asset of report.assets) {
    const noteId = wanted.get(asset.id);
    if (!noteId) continue;
    try {
      await deps.putAssetBytes({
        id: asset.id,
        noteId,
        mime: asset.mime,
        bytes: asset.bytes,
      });
      result.assets++;
    } catch (e) {
      result.failed.push({ id: asset.id, reason: String(e) });
    }
  }

  if (options.withSettings && report.settings !== undefined && deps.applySettings) {
    try {
      await deps.applySettings(report.settings);
      result.settingsApplied = true;
    } catch (e) {
      result.failed.push({ id: 'settings.json', reason: String(e) });
    }
  }

  return result;
}

// ------------------------------------------------------------------ the record of it

const LAST_IMPORT = 'import.last';

export interface LastImport extends ImportResult {
  at: number;
  mode: MergeMode;
  /** What the archive said about itself, for the line the cabinet shows afterwards. */
  exportedAt: string | null;
}

/**
 * Remember the last import, because the alternative is a toast that disappears.
 *
 * An import is the single most consequential thing this extension can be asked to do, and the
 * only feedback was a line of text that vanished on the next render. This is what lets the
 * cabinet say "1,204 notes imported on 5 September, 3 skipped" the next time it is opened.
 */
export async function rememberImport(
  result: ImportResult,
  mode: MergeMode,
  exportedAt: string | null,
  now = Date.now(),
): Promise<void> {
  await setMeta(LAST_IMPORT, { ...result, at: now, mode, exportedAt } satisfies LastImport);
}

export function lastImport(): Promise<LastImport | undefined> {
  return getMeta<LastImport>(LAST_IMPORT);
}
