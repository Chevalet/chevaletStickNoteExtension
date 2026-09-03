import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UI,
  LIMITS,
  sanitizeStyle,
  sanitizeTags,
  sanitizeText,
  sanitizeUi,
} from '~/bg/msg/sanitize.ts';

/**
 * This is the boundary between a page's process and the database. The tests are about what is
 * recoverable rather than about attack: a note stored at x = Infinity is a note the user can
 * never see again, and a store that accepted it reported success while losing their writing.
 */

describe('sanitizeUi', () => {
  it('passes ordinary values through untouched', () => {
    const ui = {
      x: 300,
      y: 1200,
      w: 260,
      h: 180,
      z: 42,
      collapsed: false,
      locked: false,
      opacity: 0.9,
    };
    expect(sanitizeUi(ui)).toEqual(ui);
  });

  it('replaces every non-finite number with the default rather than storing it', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = sanitizeUi({ x: bad, y: bad, w: bad, h: bad, z: bad, opacity: bad });
      expect(out).toEqual(DEFAULT_UI);
      // The important part: nothing non-finite survives to be written.
      for (const v of [out.x, out.y, out.w, out.h, out.z, out.opacity]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it('clamps rather than rejects, so a note that drifted out of range still opens', () => {
    const out = sanitizeUi({ x: 1e300, y: -1e300, w: 999_999, h: 1, z: -5, opacity: 40 });
    expect(out.x).toBe(LIMITS.pos.max);
    expect(out.y).toBe(LIMITS.pos.min);
    expect(out.w).toBe(LIMITS.w.max);
    expect(out.h).toBe(LIMITS.h.min);
    expect(out.z).toBe(LIMITS.z.min);
    expect(out.opacity).toBe(LIMITS.opacity.max);
  });

  it('never stores a fully transparent note, which would be unfindable', () => {
    expect(sanitizeUi({ opacity: 0 }).opacity).toBe(LIMITS.opacity.min);
    expect(sanitizeUi({ opacity: -3 }).opacity).toBeGreaterThan(0);
  });

  it('coerces numeric strings, because JSON round-trips are not always faithful', () => {
    expect(sanitizeUi({ x: '150' }).x).toBe(150);
    expect(sanitizeUi({ x: 'over there' }).x).toBe(DEFAULT_UI.x);
  });

  it('treats the flags as strictly boolean', () => {
    expect(sanitizeUi({ collapsed: 'yes', locked: 1 })).toMatchObject({
      collapsed: false,
      locked: false,
    });
    expect(sanitizeUi({ collapsed: true, locked: true })).toMatchObject({
      collapsed: true,
      locked: true,
    });
  });

  it('falls back to the stored value, not the global default, when patching', () => {
    const stored = { ...DEFAULT_UI, x: 900, w: 400 };
    const out = sanitizeUi({ y: 50 }, stored);
    expect(out.x).toBe(900);
    expect(out.w).toBe(400);
    expect(out.y).toBe(50);
  });

  it('survives junk in place of an object', () => {
    for (const junk of [null, undefined, 'nope', 42, []]) {
      expect(() => sanitizeUi(junk)).not.toThrow();
      expect(sanitizeUi(junk)).toEqual(DEFAULT_UI);
    }
  });

  it('drops unknown keys instead of storing them', () => {
    expect(Object.keys(sanitizeUi({ x: 1, evil: 'x' })).sort()).toEqual(
      Object.keys(DEFAULT_UI).sort(),
    );
  });
});

describe('sanitizeText', () => {
  it('keeps ordinary text exactly, including RTL and emoji', () => {
    for (const text of ['hello', 'یادداشت فارسی', '🎨 note', 'a\nb\n\nc', '']) {
      expect(sanitizeText(text)).toBe(text);
    }
  });

  it('returns empty for anything that is not a string', () => {
    for (const junk of [null, undefined, 42, {}, ['a']]) expect(sanitizeText(junk)).toBe('');
  });

  it('caps absurd input', () => {
    expect(sanitizeText('a'.repeat(LIMITS.textChars + 5000)).length).toBe(LIMITS.textChars);
  });

  /** A lone surrogate survives IndexedDB but breaks the JSON export, which is the backup. */
  it('does not leave half a character at the cut', () => {
    const padded = `${'a'.repeat(LIMITS.textChars - 1)}😀tail`;
    const out = sanitizeText(padded);
    expect(out).not.toMatch(/[\uD800-\uDBFF]$/);
    expect(() => JSON.parse(JSON.stringify({ out }))).not.toThrow();
    expect(encodeURIComponent(out)).toBeTypeOf('string');
  });
});

describe('sanitizeTags', () => {
  it('trims, drops empties and deduplicates', () => {
    expect(sanitizeTags(['  work ', 'work', '', '   ', 'todo'])).toEqual(['work', 'todo']);
  });

  it('ignores non-strings without discarding the good ones', () => {
    expect(sanitizeTags(['keep', 5, null, { a: 1 }, 'also'])).toEqual(['keep', 'also']);
  });

  it('caps the count and the length', () => {
    expect(sanitizeTags(Array.from({ length: 200 }, (_, i) => `t${i}`))).toHaveLength(LIMITS.tags);
    expect(sanitizeTags(['x'.repeat(500)])[0]?.length).toBe(LIMITS.tagChars);
  });

  it('returns empty for anything that is not an array', () => {
    for (const junk of [null, undefined, 'work', {}]) expect(sanitizeTags(junk)).toEqual([]);
  });
});

describe('sanitizeStyle', () => {
  it('keeps flat scalars', () => {
    const style = { paper: 'lemon', fontSize: 14, rtl: true };
    expect(sanitizeStyle(style)).toEqual(style);
  });

  it('drops nested values, which nothing reads', () => {
    expect(sanitizeStyle({ ok: 'x', nested: { a: 1 }, list: [1, 2], fn: null })).toEqual({
      ok: 'x',
    });
  });

  it('drops non-finite numbers', () => {
    expect(sanitizeStyle({ good: 1, bad: Number.NaN, worse: Number.POSITIVE_INFINITY })).toEqual({
      good: 1,
    });
  });

  it('bounds how much can be stored', () => {
    const wide = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(sanitizeStyle(wide)).length).toBeLessThanOrEqual(40);
    expect(sanitizeStyle({ ['k'.repeat(100)]: 'v' })).toEqual({});
    expect(sanitizeStyle({ k: 'v'.repeat(500) })).toEqual({});
  });

  it('never inherits from the prototype chain', () => {
    const out = sanitizeStyle(JSON.parse('{"__proto__":{"polluted":true},"safe":1}'));
    expect(out).toEqual({ safe: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('returns empty for anything that is not a plain object', () => {
    for (const junk of [null, undefined, 'x', 5, [1]]) expect(sanitizeStyle(junk)).toEqual({});
  });
});
