/**
 * The catalogue, and the two things that can quietly go wrong with a translation.
 *
 * ## An empty translation
 *
 * `t()` falls back to English when a key has no Persian, which is the right behaviour and also
 * the reason a missing translation is invisible: the interface simply reads English in one
 * place and Persian everywhere else. So every entry is checked for both.
 *
 * ## A string that never got wired up
 *
 * The note's settings panel had 24 keys sitting in the catalogue, translated, and unused --
 * written when the catalogue was and never called, so the panel was English while the
 * catalogue insisted it was not. The Language setting was ignored entirely for a while too,
 * because `t()` asked `browser.i18n` first and that answers in FIREFOX'S locale.
 *
 * Neither of those is directly testable from here, so this checks the shape they broke: that
 * the language really is what `setLang` was told, and that the split between the note's table
 * and the rest has not lost anything.
 */

import { describe, expect, it } from 'vitest';
import {
  CATALOGUE,
  type Entry,
  type Lang,
  type MessageKey,
  setLang,
  t,
  toMessagesJson,
} from '~/shared/i18n.ts';
import { NOTE_CATALOGUE } from '~/shared/i18n-note.ts';

const KEYS = Object.keys(CATALOGUE) as MessageKey[];

describe('every entry', () => {
  it('has a non-empty string in both languages', () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(CATALOGUE)) {
      if (!entry.en?.trim()) bad.push(`${key}: no English`);
      if (!entry.fa?.trim()) bad.push(`${key}: no Persian`);
    }
    expect(bad).toEqual([]);
  });

  it('is actually translated, not the English copied across', () => {
    /*
     * A handful of strings legitimately read the same in both: a brand name, a key cap, a
     * chord. Everything else being identical means someone pasted the English in to make the
     * type checker happy.
     */
    const allowed = new Set(['English']);
    const copied = Object.entries(CATALOGUE)
      .filter(([, e]) => e.en === e.fa && !allowed.has(e.en))
      .map(([k]) => k);
    expect(copied).toEqual([]);
  });

  it('uses the same substitution placeholders in both languages', () => {
    // `$1` missing from the Persian means a number silently vanishes from a sentence.
    const mismatched: string[] = [];
    for (const [key, entry] of Object.entries(CATALOGUE)) {
      const en = (entry.en.match(/\$\d/g) ?? []).sort().join('');
      const fa = (entry.fa.match(/\$\d/g) ?? []).sort().join('');
      if (en !== fa) mismatched.push(`${key}: en has ${en || 'none'}, fa has ${fa || 'none'}`);
    }
    expect(mismatched).toEqual([]);
  });
});

describe('the language chosen is the language shown', () => {
  it('answers in Persian when asked for Persian', () => {
    setLang('fa');
    expect(t('cabAllNotes')).toBe(CATALOGUE.cabAllNotes.fa);
    setLang('en');
    expect(t('cabAllNotes')).toBe(CATALOGUE.cabAllNotes.en);
  });

  it('substitutes into the Persian, not into the English', () => {
    setLang('fa');
    const out = t('cabCountNotes', '7');
    expect(out).toContain('7');
    expect(out).toBe(CATALOGUE.cabCountNotes.fa.replace('$1', '7'));
    setLang('en');
  });

  it('returns the key itself for something not in the catalogue', () => {
    // Ugly on purpose: an untranslated string should be obvious in development.
    expect(t('notAKey' as MessageKey)).toBe('notAKey');
  });
});

describe('the note table', () => {
  it('is part of the big catalogue, so the two cannot disagree', () => {
    for (const [key, entry] of Object.entries(NOTE_CATALOGUE)) {
      expect(CATALOGUE[key as MessageKey], `${key} is only in the note table`).toEqual(entry);
    }
  });

  it('is small, because it ships in every annotated page', () => {
    /*
     * The reason the split exists. With the whole catalogue in the content script the bundle
     * went from 33.7 to 46.2 kB gz against a 36 kB budget. If this number creeps up, the
     * question to ask is whether a NOTE really needs the string -- not whether to raise it.
     */
    expect(Object.keys(NOTE_CATALOGUE).length).toBeLessThan(70);
    expect(Object.keys(NOTE_CATALOGUE).length).toBeLessThan(KEYS.length / 3);
  });
});

describe('what the build writes into _locales', () => {
  it.each(['en', 'fa'] as Lang[])('%s has a message for every key', (lang) => {
    const json = toMessagesJson(lang);
    expect(Object.keys(json).length).toBe(KEYS.length);
    for (const key of KEYS) {
      expect(json[key]?.message, key).toBeTruthy();
    }
  });

  it('keeps the translator notes where there are any', () => {
    // `as Entry` because the catalogue is `as const`: TypeScript narrows each entry to its own
    // literal type, and only some of them have a `note` at all.
    const json = toMessagesJson('en');
    for (const key of KEYS) {
      const entry = CATALOGUE[key] as Entry;
      if (entry.note) expect(json[key]?.description).toBe(entry.note);
    }
  });
});
