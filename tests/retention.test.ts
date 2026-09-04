import { describe, expect, it, vi } from 'vitest';
import type { NoteRecord } from '~/bg/db/schema.ts';
import { dueForPurge, type RetentionPolicy, runRetentionSweep } from '~/bg/jobs/retention.ts';
import type { NoteId } from '~/shared/types.ts';

/**
 * This is the code that destroys someone's notes, so the tests are weighted towards the ways
 * it could destroy the wrong ones: the setting off, the window nonsensical, a note with no
 * deletion timestamp, and the exact day boundary.
 *
 * It exists because the two Keeping settings were read by nothing at all -- the pane promised
 * "trashed notes are destroyed once their time is up" and nothing ever destroyed anything.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_760_000_000_000;

/**
 * `deletedAt` is spelled out as nullable because the interesting case is a trashed note that
 * has no timestamp, and `exactOptionalPropertyTypes` will not let a test pass `undefined` for
 * an optional field otherwise.
 */
function note(
  over: Omit<Partial<NoteRecord>, 'id' | 'deletedAt'> & {
    id: string;
    deletedAt?: number | undefined;
  },
): NoteRecord {
  return {
    ix_state: 'trashed',
    deletedAt: NOW - 40 * DAY,
    ...over,
    id: `n_${over.id}` as NoteId,
  } as unknown as NoteRecord;
}

/** Ids come back prefixed, so assertions read in the same shape they were written. */
const id = (short: string): NoteId => `n_${short}` as NoteId;

const ON: RetentionPolicy = { autoDelete: true, trashDays: 30 };

describe('dueForPurge', () => {
  it('destroys nothing at all when auto-delete is off', () => {
    const old = note({ id: 'a', deletedAt: NOW - 9999 * DAY });
    expect(dueForPurge([old], { autoDelete: false, trashDays: 30 }, NOW)).toEqual([]);
  });

  it('picks a trashed note that is past its window', () => {
    expect(dueForPurge([note({ id: 'a' })], ON, NOW)).toEqual([id('a')]);
  });

  it('never touches an active note, however old', () => {
    const active = note({ id: 'a', ix_state: 'active', deletedAt: NOW - 900 * DAY });
    expect(dueForPurge([active], ON, NOW)).toEqual([]);
  });

  it('keeps a note through the whole of its final day', () => {
    // Exactly 30 days: still inside "keep for 30 days".
    expect(dueForPurge([note({ id: 'a', deletedAt: NOW - 30 * DAY })], ON, NOW)).toEqual([]);
    // A minute past it: due.
    const past = note({ id: 'a', deletedAt: NOW - 30 * DAY - 60_000 });
    expect(dueForPurge([past], ON, NOW)).toEqual([id('a')]);
  });

  it('keeps a trashed note that carries no deletion timestamp', () => {
    // Undatable. Guessing from updatedAt would destroy old notes on the first sweep.
    const undated = note({ id: 'a', deletedAt: undefined, updatedAt: NOW - 900 * DAY });
    expect(dueForPurge([undated], ON, NOW)).toEqual([]);
  });

  it('ignores a corrupt timestamp rather than treating it as ancient', () => {
    expect(dueForPurge([note({ id: 'a', deletedAt: Number.NaN })], ON, NOW)).toEqual([]);
    expect(dueForPurge([note({ id: 'b', deletedAt: Number.POSITIVE_INFINITY })], ON, NOW)).toEqual(
      [],
    );
  });

  it('treats a nonsensical window as "keep everything", not "destroy everything"', () => {
    for (const trashDays of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dueForPurge([note({ id: 'a' })], { autoDelete: true, trashDays }, NOW)).toEqual([]);
    }
  });

  it('does not purge a note trashed in the future', () => {
    // Clock skew across a sync or a machine with a wrong date.
    expect(dueForPurge([note({ id: 'a', deletedAt: NOW + 5 * DAY })], ON, NOW)).toEqual([]);
  });

  it('picks out only the ones that are due from a mixed trash', () => {
    const trash = [
      note({ id: 'old', deletedAt: NOW - 60 * DAY }),
      note({ id: 'fresh', deletedAt: NOW - 2 * DAY }),
      note({ id: 'undated', deletedAt: undefined }),
      note({ id: 'alive', ix_state: 'active', deletedAt: NOW - 60 * DAY }),
    ];
    expect(dueForPurge(trash, ON, NOW)).toEqual([id('old')]);
  });

  it('honours a long window', () => {
    const policy = { autoDelete: true, trashDays: 3650 };
    expect(dueForPurge([note({ id: 'a', deletedAt: NOW - 100 * DAY })], policy, NOW)).toEqual([]);
  });
});

describe('runRetentionSweep', () => {
  const base = { trashDays: 30, detachedDays: 30, revisionsPerNote: 50 };

  it('does not even read the trash when auto-delete is off', async () => {
    const listTrash = vi.fn(async () => [note({ id: 'a' })]);
    const purgeNote = vi.fn(async () => undefined);
    const n = await runRetentionSweep(
      { retention: { ...base, autoDelete: false } },
      { listTrash, purgeNote },
      NOW,
    );
    expect(n).toBe(0);
    expect(listTrash).not.toHaveBeenCalled();
    expect(purgeNote).not.toHaveBeenCalled();
  });

  it('purges the due notes and reports how many', async () => {
    const purged: string[] = [];
    const n = await runRetentionSweep(
      { retention: { ...base, autoDelete: true } },
      {
        listTrash: async () => [
          note({ id: 'old' }),
          note({ id: 'older', deletedAt: NOW - 90 * DAY }),
          note({ id: 'fresh', deletedAt: NOW - 1 * DAY }),
        ],
        purgeNote: async (noteId) => {
          purged.push(noteId);
        },
      },
      NOW,
    );
    expect(purged).toEqual([id('old'), id('older')]);
    expect(n).toBe(2);
  });

  it('carries on past a note it cannot delete', async () => {
    const purged: string[] = [];
    const n = await runRetentionSweep(
      { retention: { ...base, autoDelete: true } },
      {
        listTrash: async () => [note({ id: 'bad' }), note({ id: 'good' })],
        purgeNote: async (noteId) => {
          if (noteId === id('bad')) throw new Error('locked');
          purged.push(noteId);
        },
      },
      NOW,
    );
    expect(purged).toEqual([id('good')]);
    expect(n).toBe(1);
  });

  it('survives a database that cannot be read', async () => {
    const n = await runRetentionSweep(
      { retention: { ...base, autoDelete: true } },
      {
        listTrash: async () => {
          throw new Error('no db');
        },
        purgeNote: async () => undefined,
      },
      NOW,
    );
    expect(n).toBe(0);
  });
});
