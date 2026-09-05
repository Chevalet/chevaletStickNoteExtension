/**
 * The scheduled backup.
 *
 * A backup job has one job, and it is not "write a file": it is "never make things worse than
 * not having run". So most of these tests are about restraint -- not writing an empty archive
 * over a good one, not throwing inside the alarm handler that also runs the retention sweep,
 * not claiming success when the permission has been withdrawn behind its back.
 *
 * All fakes, no browser. What is worth checking is the arithmetic of the ring and the order of
 * the guards, and neither of those is about the downloads API.
 */

import { describe, expect, it } from 'vitest';
import type { AssetRecord, NoteRecord } from '~/bg/db/schema.ts';
import {
  type BackupDeps,
  type BackupState,
  backupFilename,
  hoursOf,
  MAX_HOURS,
  MIN_HOURS,
  nextSlot,
  RING,
  runBackup,
} from '~/bg/jobs/autobackup.ts';
import { DEFAULT_SETTINGS, type Settings } from '~/bg/settings.ts';

const NOTE = { id: 'n_1' } as unknown as NoteRecord;

function settings(over: Partial<Settings['backup']>): Settings {
  return { ...DEFAULT_SETTINGS, backup: { ...DEFAULT_SETTINGS.backup, ...over } };
}

/** Fake deps that record what happened. */
function harness(over: Partial<BackupDeps> = {}) {
  const downloads: Array<{ filename: string; bytes: number }> = [];
  let state: BackupState | undefined;
  const deps: BackupDeps = {
    notes: async () => [NOTE],
    assets: async () => [] as AssetRecord[],
    build: async () => new Uint8Array(1234),
    download: async (bytes, filename) => {
      downloads.push({ filename, bytes: bytes.byteLength });
      return 1;
    },
    hasPermission: async () => true,
    readState: async () => state,
    writeState: async (s) => {
      state = s;
    },
    now: () => 1_756_000_000_000,
    ...over,
  };
  return {
    deps,
    downloads,
    get state() {
      return state;
    },
  };
}

describe('the ring', () => {
  it('starts at the first slot when nothing has run', () => {
    expect(nextSlot(undefined)).toBe(0);
  });

  it('advances one slot at a time and wraps', () => {
    let slot = nextSlot(undefined);
    const seen = [slot];
    for (let i = 0; i < RING; i++) {
      slot = nextSlot({ at: 0, ok: true, slot, notes: 1, bytes: 1 });
      seen.push(slot);
    }
    // Deliberately not derived from the date: an eight-hour interval and a ring of three
    // would map two runs a day onto the same slot for ever, silently making it a ring of two.
    // One initial slot plus RING advances, so the wrap is the last entry.
    expect(seen).toEqual([0, 1, 2, 0]);
    expect(seen).toHaveLength(RING + 1);
  });

  it('starts over rather than trusting nonsense in storage', () => {
    expect(nextSlot({ at: 0, ok: true, slot: Number.NaN, notes: 1, bytes: 1 })).toBe(0);
    expect(nextSlot({ at: 0, ok: true, slot: -5, notes: 1, bytes: 1 })).toBe(1);
  });

  it('names a file after its slot, one-based for a person reading a folder', () => {
    expect(backupFilename(0)).toBe('chevalet-note-auto-1.zip');
    expect(backupFilename(2)).toBe('chevalet-note-auto-3.zip');
  });
});

describe('the interval', () => {
  it('takes the setting', () => {
    expect(hoursOf(settings({ everyHours: 6 }))).toBe(6);
  });

  it('clamps to what an alarm can honour', () => {
    expect(hoursOf(settings({ everyHours: 0 }))).toBe(MIN_HOURS);
    expect(hoursOf(settings({ everyHours: 99_999 }))).toBe(MAX_HOURS);
  });

  it('falls back rather than arming an alarm with NaN minutes', () => {
    expect(hoursOf(settings({ everyHours: Number.NaN }))).toBe(12);
  });
});

describe('runBackup', () => {
  it('writes an archive and records what it did', async () => {
    const h = harness();
    const out = await runBackup(h.deps);
    expect(out).toMatchObject({ ok: true, slot: 0, notes: 1, bytes: 1234 });
    expect(h.downloads).toEqual([{ filename: 'chevalet-note-auto-1.zip', bytes: 1234 }]);
    expect(h.state?.ok).toBe(true);
  });

  it('rotates through the ring across runs', async () => {
    const h = harness();
    await runBackup(h.deps);
    await runBackup(h.deps);
    await runBackup(h.deps);
    await runBackup(h.deps);
    expect(h.downloads.map((d) => d.filename)).toEqual([
      'chevalet-note-auto-1.zip',
      'chevalet-note-auto-2.zip',
      'chevalet-note-auto-3.zip',
      'chevalet-note-auto-1.zip',
    ]);
  });

  it('writes nothing at all when there are no notes', async () => {
    // The one way this feature could destroy something: an empty archive over a good one,
    // after a database failure that made everything look deleted.
    const h = harness({ notes: async () => [] });
    const out = await runBackup(h.deps);
    expect(h.downloads).toEqual([]);
    expect(out.ok).toBe(true);
    expect(out.notes).toBe(0);
  });

  it('does not advance the ring on an empty run', async () => {
    const h = harness();
    await runBackup(h.deps);
    const empty = harness({
      notes: async () => [],
      readState: async () => h.state,
      writeState: async () => {},
    });
    const out = await runBackup(empty.deps);
    // Slot 0 was the last good one, and it stays the last good one.
    expect(out.slot).toBe(0);
  });

  it('reports a withdrawn permission instead of throwing inside the alarm', async () => {
    // It can be revoked in about:addons at any time, without this extension being told.
    const h = harness({ hasPermission: async () => false });
    const out = await runBackup(h.deps);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('Permission');
    expect(h.downloads).toEqual([]);
  });

  it('survives a download that throws, and records why', async () => {
    const h = harness({
      download: async () => {
        throw new Error('disk full');
      },
    });
    const out = await runBackup(h.deps);
    expect(out.ok).toBe(false);
    expect(out.error).toContain('disk full');
    // Recorded, so the settings pane can say so rather than the failure being invisible.
    expect(h.state?.ok).toBe(false);
  });

  it('survives a build that throws', async () => {
    const h = harness({
      build: async () => {
        throw new Error('out of memory');
      },
    });
    expect((await runBackup(h.deps)).error).toContain('out of memory');
  });

  it('still backs up the notes when the assets cannot be read', async () => {
    // Losing the pictures is bad. Losing the text because of the pictures is worse.
    const h = harness({
      assets: async () => {
        throw new Error('asset store broken');
      },
    });
    const out = await runBackup(h.deps);
    expect(out.ok).toBe(true);
    expect(h.downloads).toHaveLength(1);
  });

  it('runs even when the previous state cannot be read', async () => {
    const h = harness({
      readState: async () => {
        throw new Error('meta store broken');
      },
    });
    const out = await runBackup(h.deps);
    expect(out.ok).toBe(true);
    expect(out.slot).toBe(0);
  });
});
