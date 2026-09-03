import { describe, expect, it } from 'vitest';
import {
  allocate,
  DEFAULT_GUARD,
  explain,
  type GuardSettings,
  qualifies,
  type TabGuardState,
} from '~/bg/guard/budget.ts';

function tab(over: Partial<TabGuardState> = {}): TabGuardState {
  return {
    tabId: 1,
    noteCount: 2,
    hasUnsaved: true,
    discarded: false,
    onlyPortableNotes: false,
    volatile: false,
    msSinceEdit: 1000,
    ...over,
  };
}

const settings = (over: Partial<GuardSettings> = {}): GuardSettings => ({
  ...DEFAULT_GUARD,
  ...over,
});

describe('qualifies', () => {
  it('arms a tab with unsaved edits under the default policy', () => {
    expect(qualifies(tab(), settings())).toBe(true);
  });

  it('never arms anything when warnings are off', () => {
    expect(qualifies(tab({ volatile: true }), settings({ mode: 'never' }))).toBe(false);
  });

  it('never arms a tab with no notes', () => {
    expect(qualifies(tab({ noteCount: 0 }), settings({ mode: 'hasNotes' }))).toBe(false);
  });

  /** A discarded tab has no content process, so a slot spent on it would be wasted. */
  it('never arms a discarded tab', () => {
    expect(qualifies(tab({ discarded: true }), settings({ mode: 'hasNotes' }))).toBe(false);
  });

  it('under "unsaved", stays quiet once everything is written', () => {
    expect(qualifies(tab({ hasUnsaved: false }), settings())).toBe(false);
    expect(qualifies(tab({ hasUnsaved: false }), settings({ mode: 'hasNotes' }))).toBe(true);
  });

  /** Nothing is at risk if the notes reappear on any tab showing the same page. */
  it('under "unsaved", stays quiet when every note is portable', () => {
    expect(qualifies(tab({ onlyPortableNotes: true }), settings())).toBe(false);
  });

  /**
   * The one case worth interrupting for even under the quietest policy: a private-window note
   * that is never written to disk really does vanish when the tab closes.
   */
  it('always arms a volatile tab, whatever the policy says', () => {
    for (const mode of ['unsaved', 'hasNotes'] as const) {
      expect(
        qualifies(
          tab({ volatile: true, hasUnsaved: false, onlyPortableNotes: true }),
          settings({ mode }),
        ),
      ).toBe(true);
    }
  });
});

describe('allocate', () => {
  it('arms nothing when there is nothing to arm', () => {
    expect(allocate([], settings())).toEqual({ armed: [], disarmed: [] });
  });

  /**
   * The disaster this budget exists to prevent: closing a window with a dozen annotated tabs
   * and being asked twelve times, with Firefox focusing each tab in turn.
   */
  it('never arms more than the budget allows', () => {
    const many = Array.from({ length: 12 }, (_, i) => tab({ tabId: i, msSinceEdit: i * 100 }));
    const { armed, disarmed } = allocate(many, settings());
    expect(armed).toHaveLength(3);
    expect(disarmed).toHaveLength(9);
    expect(new Set([...armed, ...disarmed]).size).toBe(12);
  });

  it('keeps the tabs edited most recently', () => {
    const tabs = [
      tab({ tabId: 1, msSinceEdit: 60_000 }),
      tab({ tabId: 2, msSinceEdit: 500 }),
      tab({ tabId: 3, msSinceEdit: 9000 }),
      tab({ tabId: 4, msSinceEdit: 200 }),
    ];
    expect(allocate(tabs, settings({ maxArmedTabs: 2 })).armed).toEqual([4, 2]);
  });

  it('puts a volatile tab ahead of a more recently edited durable one', () => {
    const tabs = [
      tab({ tabId: 1, msSinceEdit: 10, volatile: false }),
      tab({ tabId: 2, msSinceEdit: 90_000, volatile: true }),
    ];
    expect(allocate(tabs, settings({ maxArmedTabs: 1 })).armed).toEqual([2]);
  });

  it('prefers a tab with unsaved edits over a merely-recent one', () => {
    const tabs = [
      tab({ tabId: 1, hasUnsaved: false, msSinceEdit: 10 }),
      tab({ tabId: 2, hasUnsaved: true, msSinceEdit: 5000 }),
    ];
    expect(allocate(tabs, settings({ mode: 'hasNotes', maxArmedTabs: 1 })).armed).toEqual([2]);
  });

  it('disarms every tab that does not qualify, so no listener is left behind', () => {
    const tabs = [
      tab({ tabId: 1, noteCount: 0 }),
      tab({ tabId: 2, discarded: true }),
      tab({ tabId: 3 }),
    ];
    const { armed, disarmed } = allocate(tabs, settings());
    expect(armed).toEqual([3]);
    expect(disarmed.sort()).toEqual([1, 2]);
  });

  it('arms nothing at all when the budget is zero', () => {
    const { armed, disarmed } = allocate([tab({ tabId: 7 })], settings({ maxArmedTabs: 0 }));
    expect(armed).toEqual([]);
    expect(disarmed).toEqual([7]);
  });

  it('treats a negative budget as zero rather than as slice(-1)', () => {
    expect(allocate([tab({ tabId: 7 })], settings({ maxArmedTabs: -3 })).armed).toEqual([]);
  });
});

describe('explain', () => {
  it('never leaves a missing warning unexplained', () => {
    const cases: Array<[TabGuardState, GuardSettings, boolean]> = [
      [tab(), settings(), true],
      [tab({ noteCount: 0 }), settings(), false],
      [tab({ discarded: true }), settings(), false],
      [tab({ hasUnsaved: false }), settings(), false],
      [tab({ onlyPortableNotes: true }), settings(), false],
      [tab(), settings({ mode: 'never' }), false],
      [tab(), settings(), false],
    ];
    for (const [t, s, armed] of cases) {
      const text = explain(t, s, armed);
      expect(text.length, JSON.stringify(t)).toBeGreaterThan(10);
      expect(text.endsWith('.'), text).toBe(true);
    }
  });

  it('says which setting is responsible when warnings are off', () => {
    expect(explain(tab(), settings({ mode: 'never' }), false)).toContain('settings');
  });

  it('says how many tabs are watched when a tab lost the budget', () => {
    expect(explain(tab(), settings({ maxArmedTabs: 3 }), false)).toContain('3 tabs');
  });
});
