import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isEnabledFor, mergeSettings } from '~/bg/settings.ts';
import { resolveDuplicate } from '~/bg/tabs/identity.ts';
import type { TabKey } from '~/shared/types.ts';

describe('mergeSettings', () => {
  it('returns the defaults for anything unusable', () => {
    for (const input of [null, undefined, 42, 'nope', []]) {
      expect(mergeSettings(input)).toEqual(DEFAULT_SETTINGS);
    }
  });

  /**
   * The bug a shallow spread would cause: a user who once changed one nested field silently
   * loses every sibling that a later release adds.
   */
  it('keeps sibling fields when a nested object was partially stored', () => {
    const merged = mergeSettings({ guard: { mode: 'hasNotes' } });
    expect(merged.guard.mode).toBe('hasNotes');
    expect(merged.guard.maxArmedTabs).toBe(DEFAULT_SETTINGS.guard.maxArmedTabs);

    const retention = mergeSettings({ retention: { trashDays: 7 } }).retention;
    expect(retention.trashDays).toBe(7);
    expect(retention.revisionsPerNote).toBe(DEFAULT_SETTINGS.retention.revisionsPerNote);
    expect(retention.autoDelete).toBe(false);
  });

  it('never lets stored data claim a different schema version', () => {
    expect(mergeSettings({ schemaV: 99 }).schemaV).toBe(DEFAULT_SETTINGS.schemaV);
  });

  it('does not share nested objects with the frozen defaults', () => {
    const a = mergeSettings(null);
    a.guard.maxArmedTabs = 99;
    a.siteRules['https://x.test'] = 'off';
    expect(mergeSettings(null).guard.maxArmedTabs).toBe(3);
    expect(mergeSettings(null).siteRules).toEqual({});
  });

  it('nothing is deleted automatically unless the user asks', () => {
    expect(DEFAULT_SETTINGS.retention.autoDelete).toBe(false);
  });

  it('private-window notes are not persisted by default', () => {
    expect(DEFAULT_SETTINGS.persistPrivateNotes).toBe(false);
  });
});

describe('isEnabledFor', () => {
  const s = mergeSettings({
    defaultEnabled: true,
    siteRules: { 'https://off.test': 'off', 'https://on.test': 'on' },
  });

  it('follows the global default when nothing more specific applies', () => {
    expect(isEnabledFor(s, 'https://unknown.test')).toBe(true);
    expect(isEnabledFor(mergeSettings({ defaultEnabled: false }), 'https://unknown.test')).toBe(
      false,
    );
  });

  it('a site rule beats the global default', () => {
    expect(isEnabledFor(s, 'https://off.test')).toBe(false);
    expect(
      isEnabledFor(
        mergeSettings({ defaultEnabled: false, siteRules: { 'https://on.test': 'on' } }),
        'https://on.test',
      ),
    ).toBe(true);
  });

  /** The tab override is the most specific thing the user said, and the most recent. */
  it('a tab override beats everything', () => {
    expect(isEnabledFor(s, 'https://off.test', true)).toBe(true);
    expect(isEnabledFor(s, 'https://on.test', false)).toBe(false);
  });
});

describe('resolveDuplicate', () => {
  const live = (keys: string[]) => (k: TabKey) => keys.includes(k);

  it('mints a key for a genuinely fresh tab', () => {
    const r = resolveDuplicate(null, live([]));
    expect(r.key.startsWith('tk_')).toBe(true);
    expect(r.wasDuplicate).toBe(false);
    expect(r.cloneNotes).toBe(false);
  });

  /** Undo-close and session restore: the key is real and its old tab is gone. */
  it('gives a restored tab its own key back', () => {
    const r = resolveDuplicate('tk_old' as TabKey, live([]));
    expect(r.key).toBe('tk_old');
    expect(r.wasDuplicate).toBe(false);
    expect(r.cloneNotes).toBe(false);
  });

  /**
   * Firefox's Duplicate Tab clones extension tab values, so the new tab arrives holding a key
   * a live tab is still using. Both tabs would otherwise share per-tab state.
   */
  it('detects a duplicate by the key still being live, and copies the notes', () => {
    const r = resolveDuplicate('tk_live' as TabKey, live(['tk_live']));
    expect(r.wasDuplicate).toBe(true);
    expect(r.key).not.toBe('tk_live');
    expect(r.cloneNotes).toBe(true);
  });

  it('respects a preference not to copy', () => {
    const r = resolveDuplicate('tk_live' as TabKey, live(['tk_live']), 'none');
    expect(r.wasDuplicate).toBe(true);
    expect(r.cloneNotes).toBe(false);
  });
});
