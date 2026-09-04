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

describe('event containment', () => {
  /**
   * The most expensive bug in this project's history, pinned so it cannot come back.
   *
   * Keyboard and input events used to be stopped at the shadow host. In Gecko the editor's
   * handling of command keys sits above the editing host in the propagation path, so that
   * stopped Backspace and Delete from ever reaching it -- while text insertion, which travels
   * a different path, kept working. A note you could write in and could not erase in, reported
   * three times before the mechanism was found, and invisible to every test available because
   * the harness is Chromium-based and Blink handles those keys at the editing host itself.
   */
  it('never contains keyboard, input or composition events at the host', async () => {
    const { CONTAINED_EVENTS } = await import('~/cs/host.ts');
    const forbidden = [
      'keydown',
      'keyup',
      'keypress',
      'input',
      'beforeinput',
      'compositionstart',
      'compositionend',
      'compositionupdate',
      'textInput',
    ];
    for (const type of forbidden) {
      expect(
        CONTAINED_EVENTS as readonly string[],
        `containing "${type}" at the host breaks editing in Firefox`,
      ).not.toContain(type);
    }
  });

  it('still contains the pointer and mouse events, which is what the page must not see', () => {
    // Those are safe: Blink and Gecko both handle pointer interaction at the target.
    return import('~/cs/host.ts').then(({ CONTAINED_EVENTS }) => {
      for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu']) {
        expect(CONTAINED_EVENTS as readonly string[]).toContain(type);
      }
    });
  });
});
