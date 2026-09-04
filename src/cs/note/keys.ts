/**
 * Which key was actually pressed, on any keyboard layout.
 *
 * ## Why this file exists
 *
 * Every shortcut in the note used to be matched against `KeyboardEvent.key`, which is the
 * character the *active layout* produces. With a Persian layout the physical S key reports
 * `key === 'س'`, the Z key reports `'ز'`, and so every letter shortcut in the extension --
 * `S` for settings, `C` for colour, `D` for draw, `L`, `M`, `P`, `E`, and `Ctrl+Z` / `Ctrl+Y`
 * for undo -- silently did nothing. Backspace, Delete, Escape and the arrows kept working,
 * because their `key` values do not depend on the layout at all. That lopsided pattern is
 * exactly what got reported, from a machine that types Persian all day.
 *
 * Measured, not deduced: `spikes/firefox-keys.mjs` drives a real Firefox and shows `س` with
 * `code: 'KeyS'` reaching the handler and being ignored, next to `s` with the same code being
 * honoured.
 *
 * ## The rule, and why it is not simply "use `code`"
 *
 * `e.key` wins whenever it is an ASCII letter; `e.code` is the fallback. Reaching for `code`
 * first would be wrong for Dvorak and Colemak: those are Latin layouts, and someone on Dvorak
 * pressing the key that PRINTS "z" expects undo, even though its `code` is `KeyY`. Browsers
 * resolve their own accelerators the same way -- layout character first, physical position
 * only when the layout gives no Latin letter -- which is why Ctrl+Z works in a Cyrillic layout
 * in every browser.
 *
 * So:
 *
 *   layout    physical key    e.key   e.code    letterOf()   why
 *   ------------------------------------------------------------------------------
 *   en-US     Z               'z'     'KeyZ'    'z'          key is a Latin letter
 *   Dvorak    ;               'z'     'KeyY'    'z'          key wins: the user sees "z"
 *   fa        Z               'ز'     'KeyZ'    'z'          key is not Latin; code decides
 *   ru        Z               'я'     'KeyZ'    'z'          same
 *
 * Nothing here touches the DOM, so it is unit-tested without a browser.
 */

/** The subset of a KeyboardEvent this module needs. Keeps it testable and cheap. */
export interface KeyLike {
  key: string;
  code?: string;
}

/**
 * The ASCII letter a keypress means, lower-cased, or `null` if it is not a letter at all.
 *
 * `null` for Enter, Escape, arrows, digits, punctuation -- match those on `key`, which is
 * already layout-independent for them.
 */
export function letterOf(e: KeyLike): string | null {
  const k = e.key;
  if (k.length === 1 && k >= 'a' && k <= 'z') return k;
  if (k.length === 1 && k >= 'A' && k <= 'Z') return k.toLowerCase();

  const code = e.code ?? '';
  // `KeyA`..`KeyZ` is the physical position of the US-layout letter, whatever the layout says.
  if (code.length === 4 && code.startsWith('Key')) {
    const ch = code.charCodeAt(3);
    if (ch >= 65 && ch <= 90) return String.fromCharCode(ch + 32);
  }
  return null;
}

/**
 * The digit a keypress means, or `null`.
 *
 * Needed for the list shortcuts (Ctrl+Shift+7/8/9). On a French layout the top-row digits
 * need Shift to print at all, so `key` there is `'&'` for the 1 key -- and with Shift held for
 * a shortcut it is the digit again. `code` settles both cases, and the numpad too.
 */
export function digitOf(e: KeyLike): string | null {
  const k = e.key;
  if (k.length === 1 && k >= '0' && k <= '9') return k;

  const code = e.code ?? '';
  if (code.length === 6 && code.startsWith('Digit')) return code.slice(5);
  if (code.length === 7 && code.startsWith('Numpad')) {
    const d = code.slice(6);
    if (d >= '0' && d <= '9') return d;
  }
  return null;
}

/**
 * A stable name for any keypress, for one `switch` to dispatch on.
 *
 * Letters come back as `'s'`, digits as `'7'`, and everything else as its `key` verbatim
 * (`'Escape'`, `'ArrowLeft'`, `'Delete'`, `'.'`). Punctuation stays on `key` deliberately: the
 * only punctuation shortcut is `Ctrl+Shift+.`, and its `code` (`Period`) is resolved by
 * `isPunct` below where it is needed, rather than inventing names for sixty dead keys here.
 */
export function keyName(e: KeyLike): string {
  return letterOf(e) ?? digitOf(e) ?? e.key;
}

/**
 * Did this press land on a given punctuation key, whatever the layout prints there?
 *
 * `Ctrl+Shift+.` for a blockquote is the one shortcut on a punctuation key. On a Persian
 * layout that key prints `'؟'` or `'>'` depending on the variant, so `key` alone would miss
 * it; `code` is `'Period'` on every layout.
 */
export function isPunct(e: KeyLike, char: string, code: string): boolean {
  return e.key === char || e.code === code;
}
