/**
 * The retention sweep: what makes "keep trashed notes for N days" true.
 *
 * ## Why this file exists
 *
 * The Keeping section of the settings has always offered "let old notes be deleted
 * automatically" and "keep trashed notes for N days", and told the reader that "trashed notes
 * are destroyed once their time is up". **Nothing read either value.** There was no sweep, no
 * alarm, and no caller of `purgeNote` outside the manager's own "delete forever" button, so
 * the trash simply grew forever whatever the settings said. A control that writes to storage
 * and changes nothing is worse than no control, because it makes a promise on the app's behalf.
 *
 * ## The rules, and the ones deliberately not implemented
 *
 * - Nothing is destroyed unless `retention.autoDelete` is on, which it is not by default.
 * - A note is due only when it is trashed AND carries a `deletedAt` older than the window.
 *   A trashed note with no timestamp is never purged: it cannot be dated, and guessing from
 *   `updatedAt` would mean a note trashed long ago but written to recently gets a stay of
 *   execution while an old note trashed today gets destroyed on the first sweep. Where the
 *   choice is between "keeps something too long" and "destroys something too early", it is not
 *   a close call.
 * - `retention.detachedDays` is NOT swept, because nothing in the codebase ever marks a note
 *   detached -- there is no `detachedAt` on a note record, only on a tab. That row has been
 *   taken out of the settings rather than left sitting there doing nothing.
 *
 * The pure half is `dueForPurge`, so the arithmetic and every off-by-one around the boundary
 * are tested without a database.
 */

import type { NoteRecord } from '~/bg/db/schema.ts';
import type { Settings } from '~/bg/settings.ts';
import type { NoteId } from '~/shared/types.ts';

export const RETENTION_ALARM = 'cn-retention-sweep';

/**
 * Six hours. The window is measured in days, so checking four times a day is precise enough
 * and cheap enough that it never needs thinking about again -- and the event page is woken by
 * plenty of other things anyway.
 */
export const RETENTION_PERIOD_MINUTES = 6 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  autoDelete: boolean;
  trashDays: number;
}

/**
 * Which notes have run out their time in the trash.
 *
 * The boundary is inclusive of the whole final day: a note trashed exactly `trashDays` ago is
 * kept, and becomes due once it is past that. "Keep for 30 days" that destroyed something on
 * the thirtieth day would be a lie by one day.
 */
export function dueForPurge(
  notes: readonly NoteRecord[],
  policy: RetentionPolicy,
  now: number = Date.now(),
): NoteId[] {
  if (!policy.autoDelete) return [];
  // A nonsensical window is treated as "keep everything" rather than "destroy everything".
  if (!Number.isFinite(policy.trashDays) || policy.trashDays < 1) return [];

  const cutoff = now - policy.trashDays * DAY_MS;
  const due: NoteId[] = [];
  for (const n of notes) {
    if (n.ix_state !== 'trashed') continue;
    const at = n.deletedAt;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (at < cutoff) due.push(n.id);
  }
  return due;
}

export interface SweepDeps {
  listTrash(): Promise<NoteRecord[]>;
  purgeNote(id: NoteId): Promise<void>;
}

/**
 * Run the sweep. Returns how many notes were destroyed, for the log and for tests.
 *
 * Failures are per-note and swallowed: one undeletable record must not stop the rest of the
 * sweep, and a sweep is not something a user is waiting on.
 */
export async function runRetentionSweep(
  settings: Pick<Settings, 'retention'>,
  deps: SweepDeps,
  now: number = Date.now(),
): Promise<number> {
  const policy: RetentionPolicy = {
    autoDelete: settings.retention.autoDelete,
    trashDays: settings.retention.trashDays,
  };
  if (!policy.autoDelete) return 0;

  const trash = await deps.listTrash().catch(() => [] as NoteRecord[]);
  const due = dueForPurge(trash, policy, now);
  let purged = 0;
  for (const id of due) {
    try {
      await deps.purgeNote(id);
      purged += 1;
    } catch {
      /* leave it for the next sweep */
    }
  }
  return purged;
}
