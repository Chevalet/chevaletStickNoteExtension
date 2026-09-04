import { describe, expect, it } from 'vitest';
import { digitOf, isPunct, keyName, letterOf } from '~/cs/note/keys.ts';

/**
 * The regression these tests exist for.
 *
 * Every letter shortcut in the extension was matched against `KeyboardEvent.key`, so on a
 * Persian keyboard layout -- which is what the person reporting the bug types on all day --
 * `S`, `C`, `D`, `L`, `M`, `Ctrl+Z` and `Ctrl+Y` all did nothing at all, while Backspace,
 * Delete, Escape and the arrows carried on working. Three simultaneous "the shortcuts do not
 * work" reports were that one line.
 *
 * The interesting part is that the fix is NOT "use `e.code`": that would break Dvorak, where
 * the key printing "z" reports `code: 'KeyY'` and the user rightly expects undo. So the rule
 * is layout character first, physical position only as a fallback -- and both halves are
 * pinned down here.
 */

const ev = (key: string, code?: string) => (code === undefined ? { key } : { key, code });

describe('letterOf', () => {
  it('takes an ASCII letter straight from key', () => {
    expect(letterOf(ev('s', 'KeyS'))).toBe('s');
    expect(letterOf(ev('z', 'KeyZ'))).toBe('z');
  });

  it('lower-cases a shifted letter', () => {
    expect(letterOf(ev('S', 'KeyS'))).toBe('s');
    expect(letterOf(ev('Z', 'KeyZ'))).toBe('z');
  });

  it('falls back to the physical key for a Persian layout', () => {
    // The exact characters the fa layout puts on those physical keys.
    expect(letterOf(ev('س', 'KeyS'))).toBe('s');
    expect(letterOf(ev('ز', 'KeyZ'))).toBe('z');
    expect(letterOf(ev('ذ', 'KeyB'))).toBe('b');
  });

  it('falls back to the physical key for Cyrillic and Arabic too', () => {
    expect(letterOf(ev('я', 'KeyZ'))).toBe('z');
    expect(letterOf(ev('ق', 'KeyC'))).toBe('c');
  });

  it('prefers the layout character over the position, so Dvorak still makes sense', () => {
    // On Dvorak the key that PRINTS "z" is physically where US-QWERTY has the semicolon,
    // reporting code 'Semicolon' -- and pressing it must still mean undo.
    expect(letterOf(ev('z', 'Semicolon'))).toBe('z');
    // And the physical Z position on Dvorak prints a slash, which must NOT mean undo.
    expect(letterOf(ev('/', 'KeyZ'))).toBe('z');
  });

  it('is null for keys that are not letters', () => {
    expect(letterOf(ev('Escape', 'Escape'))).toBeNull();
    expect(letterOf(ev('ArrowLeft', 'ArrowLeft'))).toBeNull();
    expect(letterOf(ev('Delete', 'Delete'))).toBeNull();
    expect(letterOf(ev('.', 'Period'))).toBeNull();
    expect(letterOf(ev('7', 'Digit7'))).toBeNull();
    expect(letterOf(ev(' ', 'Space'))).toBeNull();
  });

  it('survives an event with no code at all', () => {
    // Synthetic events, and some remote-desktop stacks, deliver no `code`.
    expect(letterOf(ev('s'))).toBe('s');
    expect(letterOf(ev('س'))).toBeNull();
  });

  it('does not mistake a multi-character key name for a letter', () => {
    expect(letterOf(ev('Shift', 'ShiftLeft'))).toBeNull();
    expect(letterOf(ev('Enter', 'Enter'))).toBeNull();
  });
});

describe('digitOf', () => {
  it('reads a digit from key', () => {
    expect(digitOf(ev('7', 'Digit7'))).toBe('7');
    expect(digitOf(ev('0', 'Digit0'))).toBe('0');
  });

  it('reads the digit through Shift, where key is punctuation', () => {
    // Ctrl+Shift+7 on a US layout reports key '&'.
    expect(digitOf(ev('&', 'Digit7'))).toBe('7');
    expect(digitOf(ev('*', 'Digit8'))).toBe('8');
    expect(digitOf(ev('(', 'Digit9'))).toBe('9');
    expect(digitOf(ev('!', 'Digit1'))).toBe('1');
  });

  it('reads the digit on a layout that prints something else entirely', () => {
    // fa prints its own digits; the code is the only stable thing.
    expect(digitOf(ev('۷', 'Digit7'))).toBe('7');
  });

  it('accepts the numpad', () => {
    expect(digitOf(ev('7', 'Numpad7'))).toBe('7');
    expect(digitOf(ev('End', 'Numpad1'))).toBe('1');
  });

  it('is null for anything else', () => {
    expect(digitOf(ev('s', 'KeyS'))).toBeNull();
    expect(digitOf(ev('+', 'NumpadAdd'))).toBeNull();
    expect(digitOf(ev('Escape', 'Escape'))).toBeNull();
  });
});

describe('keyName', () => {
  it('normalises letters and digits and passes everything else through', () => {
    expect(keyName(ev('س', 'KeyS'))).toBe('s');
    expect(keyName(ev('&', 'Digit7'))).toBe('7');
    expect(keyName(ev('ArrowUp', 'ArrowUp'))).toBe('ArrowUp');
    expect(keyName(ev('Escape', 'Escape'))).toBe('Escape');
  });
});

describe('isPunct', () => {
  it('matches on the printed character', () => {
    expect(isPunct(ev('.', 'Period'), '.', 'Period')).toBe(true);
  });

  it('matches on the physical key when the layout prints something else', () => {
    // The fa layout puts a Persian question mark where US-QWERTY has the period.
    expect(isPunct(ev('؟', 'Period'), '.', 'Period')).toBe(true);
    expect(isPunct(ev('>', 'Period'), '.', 'Period')).toBe(true);
  });

  it('does not match a different key', () => {
    expect(isPunct(ev(',', 'Comma'), '.', 'Period')).toBe(false);
  });
});
