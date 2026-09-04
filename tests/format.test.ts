import { describe, expect, it } from 'vitest';
import {
  clearFormatting,
  cycleHeading,
  insertText,
  makeLink,
  type Sel,
  toggleLinePrefix,
  toggleTaskHere,
  wrapInline,
} from '~/cs/note/format.ts';

/**
 * The formatting shortcuts operate on markdown SOURCE, because a note's body is a
 * `plaintext-only` contenteditable holding markdown rather than rich text. So Ctrl+B is a
 * string edit, and every awkward case is a string case: an empty selection, a selection that
 * already contains its own markers, a half-marked list, a backwards drag.
 *
 * Written as `|` markers in the fixtures below and converted by `sel()`, because reading
 * character offsets in a test is how off-by-one bugs get waved through.
 */

/** `sel('a|bc|d')` -> text 'abcd' selected from 1 to 3. A single `|` is a bare caret. */
function sel(marked: string): Sel {
  const first = marked.indexOf('|');
  const rest = marked.slice(first + 1);
  const second = rest.indexOf('|');
  if (second === -1) {
    return { text: marked.replace('|', ''), start: first, end: first };
  }
  return { text: marked.split('|').join(''), start: first, end: first + second };
}

/** The inverse, so a failure message shows where the selection ended up. */
function show(s: Sel): string {
  if (s.start === s.end) return `${s.text.slice(0, s.start)}|${s.text.slice(s.start)}`;
  return `${s.text.slice(0, s.start)}|${s.text.slice(s.start, s.end)}|${s.text.slice(s.end)}`;
}

describe('wrapInline', () => {
  it('wraps a selection', () => {
    expect(show(wrapInline(sel('make me |bold|'), '**'))).toBe('make me **|bold|**');
  });

  it('inserts an empty pair at a bare caret and puts the caret inside', () => {
    expect(show(wrapInline(sel('a |b'), '**'))).toBe('a **|**b');
  });

  it('unwraps when the markers sit just outside the selection', () => {
    // Pressing Ctrl+B twice on the same word.
    expect(show(wrapInline(sel('make me **|bold|**'), '**'))).toBe('make me |bold|');
  });

  it('unwraps when the selection contains its own markers', () => {
    expect(show(wrapInline(sel('make me |**bold**|'), '**'))).toBe('make me |bold|');
  });

  it('handles a single-character marker', () => {
    expect(show(wrapInline(sel('|x|'), '*'))).toBe('*|x|*');
    expect(show(wrapInline(sel('*|x|*'), '*'))).toBe('|x|');
    expect(show(wrapInline(sel('|`x`|'), '`'))).toBe('|x|');
  });

  it('does not read a bold pair as two italics when unwrapping italics', () => {
    // `**x**` selected inner: the italic marker is present at both ends, so italics unwraps
    // one layer and leaves the bold behind. That is the honest answer for a source editor.
    expect(show(wrapInline(sel('*|*x*|*'), '*'))).toBe('*|x|*');
  });

  it('normalises a backwards selection', () => {
    const backwards: Sel = { text: 'abcd', start: 3, end: 1 };
    expect(show(wrapInline(backwards, '**'))).toBe('a**|bc|**d');
  });

  it('does not eat a selection that is nothing but a marker pair', () => {
    // '**' selected, wrapped with '**': it starts AND ends with the marker, so an unwrap
    // check that only looked at the ends would delete both characters and lose the
    // selection. The length guard sends it down the wrap path instead, which is the
    // conservative outcome -- nothing is destroyed, and one more Ctrl+B undoes it.
    expect(show(wrapInline(sel('|**|'), '**'))).toBe('**|**|**');
  });
});

describe('makeLink', () => {
  it('makes the selection a label and selects the url slot', () => {
    expect(show(makeLink(sel('see |the docs|')))).toBe('see [the docs](|url|)');
  });

  it('recognises a url and leaves the caret in the empty label', () => {
    expect(show(makeLink(sel('|https://example.com|')))).toBe('[|](https://example.com)');
    expect(show(makeLink(sel('|www.example.com|')))).toBe('[|](www.example.com)');
  });

  it('is not fooled by a sentence that happens to contain a url', () => {
    const out = makeLink(sel('|go to https://x.dev now|'));
    expect(out.text).toBe('[go to https://x.dev now](url)');
  });

  it('makes an empty link at a bare caret', () => {
    expect(show(makeLink(sel('a|')))).toBe('a[](|url|)');
  });
});

describe('insertText', () => {
  it('drops text in at the caret', () => {
    expect(show(insertText(sel('a|b'), 'XY'))).toBe('aXY|b');
  });

  it('replaces a selection', () => {
    expect(show(insertText(sel('a|bc|d'), 'X'))).toBe('aX|d');
  });
});

describe('toggleLinePrefix', () => {
  it('adds a bullet to one line', () => {
    expect(toggleLinePrefix(sel('mil|k'), 'bullet').text).toBe('- milk');
  });

  it('adds bullets to every line the selection touches', () => {
    expect(toggleLinePrefix(sel('|milk\neggs\nsalt|'), 'bullet').text).toBe(
      '- milk\n- eggs\n- salt',
    );
  });

  it('removes them when every line already has one', () => {
    expect(toggleLinePrefix(sel('|- milk\n- eggs|'), 'bullet').text).toBe('milk\neggs');
  });

  it('makes a mixed selection uniform before it removes anything', () => {
    expect(toggleLinePrefix(sel('|- milk\neggs|'), 'bullet').text).toBe('- milk\n- eggs');
  });

  it('numbers an ordered list from one, in order', () => {
    expect(toggleLinePrefix(sel('|a\nb\nc|'), 'number').text).toBe('1. a\n2. b\n3. c');
  });

  it('toggles an already-numbered list off, however it was numbered', () => {
    // Consistent with bullets: if every line already carries the marker, the key removes it.
    // Pressing it again renumbers from one, which is how a badly numbered list gets fixed.
    const off = toggleLinePrefix(sel('|3. a\n9. b|'), 'number');
    expect(off.text).toBe('a\nb');
    expect(toggleLinePrefix(off, 'number').text).toBe('1. a\n2. b');
  });

  it('renumbers from one when converting a mixed block', () => {
    expect(toggleLinePrefix(sel('|- a\n7. b\nc|'), 'number').text).toBe('1. a\n2. b\n3. c');
  });

  it('replaces a competing marker instead of stacking it', () => {
    expect(toggleLinePrefix(sel('|- milk|'), 'task').text).toBe('- [ ] milk');
    expect(toggleLinePrefix(sel('|- [ ] milk|'), 'bullet').text).toBe('- milk');
    expect(toggleLinePrefix(sel('|1. a|'), 'bullet').text).toBe('- a');
  });

  it('does not read a task as a plain bullet when toggling bullets off', () => {
    // `- [ ] x` starts with `- `, so a naive check would call it a bullet and strip only the
    // dash, leaving `[ ] x` behind.
    expect(toggleLinePrefix(sel('|- [ ] x|'), 'bullet').text).toBe('- x');
  });

  it('composes a quote with a list rather than replacing it', () => {
    expect(toggleLinePrefix(sel('|- milk|'), 'quote').text).toBe('> - milk');
    expect(toggleLinePrefix(sel('|> - milk|'), 'quote').text).toBe('- milk');
  });

  it('keeps a quote when the list marker under it changes', () => {
    expect(toggleLinePrefix(sel('|> - milk|'), 'number').text).toBe('> 1. milk');
  });

  it('preserves indentation', () => {
    expect(toggleLinePrefix(sel('  |deep|'), 'bullet').text).toBe('  - deep');
    expect(toggleLinePrefix(sel('|  - deep|'), 'bullet').text).toBe('  deep');
  });

  it('leaves blank lines inside a block alone', () => {
    expect(toggleLinePrefix(sel('|a\n\nb|'), 'bullet').text).toBe('- a\n\n- b');
  });

  it('still produces a marker for an empty line on its own', () => {
    expect(toggleLinePrefix(sel('|'), 'bullet').text).toBe('- ');
  });

  it('selects the block it rewrote, so a second press toggles the same lines', () => {
    const once = toggleLinePrefix(sel('|a\nb|'), 'bullet');
    expect(once.text).toBe('- a\n- b');
    expect(toggleLinePrefix(once, 'bullet').text).toBe('a\nb');
  });

  it('only touches the lines the selection reaches', () => {
    expect(toggleLinePrefix(sel('keep\n|mid|\nkeep'), 'bullet').text).toBe('keep\n- mid\nkeep');
  });
});

describe('toggleTaskHere', () => {
  it('ticks an unticked box', () => {
    expect(toggleTaskHere(sel('- [ ] mil|k')).text).toBe('- [x] milk');
  });

  it('unticks a ticked one, upper or lower case', () => {
    expect(toggleTaskHere(sel('- [x] mil|k')).text).toBe('- [ ] milk');
    expect(toggleTaskHere(sel('- [X] mil|k')).text).toBe('- [ ] milk');
  });

  it('makes a task out of a line that is not one yet', () => {
    expect(toggleTaskHere(sel('mil|k')).text).toBe('- [ ] milk');
  });

  it('leaves the caret where it was when only the box changed', () => {
    const out = toggleTaskHere(sel('- [ ] mil|k'));
    expect(out.start).toBe(9);
  });
});

describe('cycleHeading', () => {
  it('goes none -> h1 -> h2 -> h3 -> none', () => {
    let s = sel('titl|e');
    s = cycleHeading(s);
    expect(s.text).toBe('# title');
    s = cycleHeading(s);
    expect(s.text).toBe('## title');
    s = cycleHeading(s);
    expect(s.text).toBe('### title');
    s = cycleHeading(s);
    expect(s.text).toBe('title');
  });

  it('keeps the caret over the same word as the prefix grows', () => {
    const out = cycleHeading(sel('titl|e'));
    expect(show(out)).toBe('# titl|e');
  });

  it('drops out of a deep heading rather than growing forever', () => {
    expect(cycleHeading(sel('##### |x')).text).toBe('x');
  });

  it('only touches the caret line', () => {
    expect(cycleHeading(sel('a\nti|tle\nb')).text).toBe('a\n# title\nb');
  });
});

describe('clearFormatting', () => {
  it('strips inline markers', () => {
    expect(clearFormatting(sel('|**bold** and *em* and `code`|')).text).toBe(
      'bold and em and code',
    );
  });

  it('keeps a link label and drops its url', () => {
    expect(clearFormatting(sel('|see [the docs](https://x.dev)|')).text).toBe('see the docs');
  });

  it('keeps an image alt and drops its reference', () => {
    expect(clearFormatting(sel('|![a cat](att:abc)|')).text).toBe('a cat');
  });

  it('strips line markers: quotes, headings, bullets, numbers and tasks', () => {
    expect(clearFormatting(sel('|> quoted|')).text).toBe('quoted');
    expect(clearFormatting(sel('|### head|')).text).toBe('head');
    expect(clearFormatting(sel('|- item|')).text).toBe('item');
    expect(clearFormatting(sel('|2. item|')).text).toBe('item');
    expect(clearFormatting(sel('|- [x] done|')).text).toBe('done');
  });

  it('works across several lines at once', () => {
    expect(clearFormatting(sel('|# h\n- **a**\n> b|')).text).toBe('h\na\nb');
  });

  it('clears the caret line when nothing is selected', () => {
    expect(clearFormatting(sel('keep **this**\n- ite|m\nkeep')).text).toBe(
      'keep **this**\nitem\nkeep',
    );
  });

  it('removes a stray half-open marker rather than leaving a puzzle', () => {
    expect(clearFormatting(sel('|**half|')).text).toBe('half');
  });
});
