/**
 * A backup that happens without being asked.
 *
 * Export ZIP has always worked, and it needs no permission at all -- an extension page may
 * click its own anchor. The trouble with it is that it is a thing you have to remember to do,
 * and the people who need a backup most are exactly the people who will not remember. This is
 * an alarm, a file in Downloads, and a small ring of them so one bad archive cannot be the
 * only one you have.
 *
 * ## Why the permission is optional, and asked for at the switch
 *
 * `downloads` is declared in `optional_permissions`, not `permissions`. Declaring it outright
 * would put "Download files" on the install prompt of a notes extension for a feature most
 * people will never switch on, and an install prompt asking for more than the thing obviously
 * needs is how an extension gets refused before it is even tried. So it is requested from the
 * click that turns the switch on, and if the request is declined the switch does not move --
 * a switch that is on while the thing it names cannot run is the dead-control problem again,
 * one layer down.
 *
 * ## The ring, and why not one file or a hundred
 *
 * One fixed filename is bounded and gives one restore point, which is worthless in the case
 * that matters: a database that has been quietly corrupting itself for a week overwrites the
 * good copy with a bad one. A date-stamped file per run gives every restore point and fills
 * Downloads with hundreds of megabytes of near-identical zips, which is how someone ends up
 * deleting the lot.
 *
 * So: three files, written in turn, `conflictAction: 'overwrite'`. Bounded, three restore
 * points, and the newest is never the only one. The number is `RING`, and the settings pane
 * says out loud that these are the only three kept.
 *
 * ## What this cannot do
 *
 * It cannot choose where the file goes -- the downloads API writes into the browser's download
 * folder and nowhere else, and there is no API for "pick a folder once and keep using it". It
 * cannot run while Firefox is closed. And a file in Downloads is not off-site: it survives
 * Refresh Firefox and uninstalling the extension, and it does not survive the disk. The
 * settings text says all three, because a backup someone misunderstands is worse than none.
 */

import type { AssetRecord, NoteRecord } from '~/bg/db/schema.ts';
import type { Settings } from '~/bg/settings.ts';

export const BACKUP_ALARM = 'cn-backup';

/** Three, written in turn. See the note above. */
export const RING = 3;

/** Clamped to something a browser alarm can actually honour. */
export const MIN_HOURS = 1;
export const MAX_HOURS = 24 * 14;

export interface BackupState {
  /** When the last attempt ran, successful or not. */
  at: number;
  ok: boolean;
  /** Which slot of the ring was written. */
  slot: number;
  notes: number;
  bytes: number;
  error?: string;
}

export interface BackupDeps {
  notes(): Promise<NoteRecord[]>;
  /*
   * `AssetRecord`, not a narrower shape of my own. The job never looks inside an asset -- it
   * hands them straight to `build` -- and a hand-written subset was only a second definition
   * of the same record that the compiler then refused to reconcile with the real one.
   */
  assets(): Promise<AssetRecord[]>;
  build(input: {
    notes: NoteRecord[];
    assets: AssetRecord[];
    settings?: unknown;
  }): Promise<Uint8Array>;
  /** Resolves with the download id once the browser has accepted the file. */
  download(bytes: Uint8Array, filename: string): Promise<number>;
  hasPermission(): Promise<boolean>;
  readState(): Promise<BackupState | undefined>;
  writeState(state: BackupState): Promise<void>;
  now?(): number;
}

/** `chevalet-note-auto-2.zip` -- the slot, not the date, because the slot is what rotates. */
export function backupFilename(slot: number): string {
  return `chevalet-note-auto-${slot + 1}.zip`;
}

/**
 * Which slot to write next.
 *
 * One past the last one used, wrapping. Deliberately NOT derived from the date: an interval of
 * eight hours and a ring of three would then map two runs a day onto the same slot for ever,
 * and the ring would silently become a ring of two.
 */
export function nextSlot(previous: BackupState | undefined): number {
  if (!previous || !Number.isFinite(previous.slot)) return 0;
  return (Math.max(0, Math.floor(previous.slot)) + 1) % RING;
}

export function hoursOf(settings: Settings): number {
  const raw = settings.backup.everyHours;
  if (!Number.isFinite(raw)) return 12;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.floor(raw)));
}

/**
 * Run a backup now.
 *
 * Never throws. A backup that crashes the alarm handler takes the retention sweep and the
 * update check down with it, and the whole point of this is to be the thing that quietly works
 * -- so every failure is recorded in the state and reported in the settings pane instead.
 */
export async function runBackup(deps: BackupDeps): Promise<BackupState> {
  const now = deps.now?.() ?? Date.now();
  const previous = await deps.readState().catch(() => undefined);
  const slot = nextSlot(previous);

  const fail = async (error: string): Promise<BackupState> => {
    const state: BackupState = { at: now, ok: false, slot, notes: 0, bytes: 0, error };
    await deps.writeState(state).catch(() => undefined);
    return state;
  };

  // Checked rather than assumed: the permission can be revoked in about:addons at any time,
  // without this extension being told, and the failure would otherwise be a rejected promise
  // inside an alarm nobody is watching.
  if (!(await deps.hasPermission().catch(() => false))) {
    return fail('Permission to save files has been withdrawn.');
  }

  try {
    const notes = await deps.notes();
    if (notes.length === 0) {
      // Writing an empty archive over a good one is the one way this feature could actually
      // destroy something. Doing nothing is the correct behaviour for an empty database.
      const state: BackupState = {
        at: now,
        ok: true,
        slot: previous?.slot ?? 0,
        notes: 0,
        bytes: 0,
      };
      await deps.writeState(state);
      return state;
    }
    const assets = await deps.assets().catch(() => []);
    const bytes = await deps.build({ notes, assets });
    await deps.download(bytes, backupFilename(slot));
    const state: BackupState = {
      at: now,
      ok: true,
      slot,
      notes: notes.length,
      bytes: bytes.byteLength,
    };
    await deps.writeState(state);
    return state;
  } catch (e) {
    return fail(String(e));
  }
}
