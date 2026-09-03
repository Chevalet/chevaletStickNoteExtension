import { describe, expect, it } from 'vitest';
import { SHEET_CSS } from '~/cs/styles.ts';

describe('shadow-root stylesheet', () => {
  /**
   * The CSS ships inside a JS template literal, so a stray backtick -- most easily written
   * inside a CSS comment while explaining something -- silently terminates the string and
   * turns the rest of the stylesheet into a syntax error. It has happened twice. This is the
   * guard.
   */
  it('contains no backtick, which would close its own template literal', () => {
    expect(SHEET_CSS).not.toContain('`');
  });

  it('contains no ${, which would be interpolated instead of emitted', () => {
    expect(SHEET_CSS).not.toContain('${');
  });

  it('has balanced braces', () => {
    const open = (SHEET_CSS.match(/\{/g) ?? []).length;
    const close = (SHEET_CSS.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });

  it('keeps every colour behind a token so a note can be re-themed by custom properties', () => {
    // Any literal hex outside the :root-style token block is a themeing bug waiting to happen.
    const declarations = SHEET_CSS.split('\n').filter(
      (l) => /#[0-9a-f]{3,8}\b/i.test(l) && !l.includes('--cn-'),
    );
    // The only allowed literals: the pure-black shadow, and the tape's paper-white.
    for (const line of declarations) {
      expect(line, `unexpected literal colour: ${line.trim()}`).toMatch(/#000|#f7f4ea|#fff/i);
    }
  });
});
