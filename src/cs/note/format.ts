/**
 * The formatting shortcuts, as pure text operations.
 *
 * A note's body is its markdown SOURCE in a `plaintext-only` contenteditable, so Ctrl+B cannot
 * be `execCommand('bold')` -- there is no rich text to embolden. It has to edit the source:
 * wrap the selection in `**`, and un-wrap it if it is already wrapped.
 *
 * Everything here takes `{ text, start, end }` and returns the same shape, so the caller reads
 * the selection once, applies one function, and writes the text and the new selection back.
 * No DOM, no NoteView, no history -- which is what makes the awkward cases (an empty
 * selection, a selection that already includes the markers, a partial list) cheap to pin down
 * in tests instead of by clicking.
 *
 * Only syntax the note's own lexer actually renders is offered. `src/cs/note/md-lex.ts`
 * supports `**strong**`, `*em*`, `~~del~~`, `` `code` ``, links, blockquotes, bullet, ordered
 * and task lists -- so those get shortcuts. **There is no underline in markdown**, so Ctrl+U
 * is deliberately not implemented rather than being wired to something that renders as
 * literal `<u>` text. The Keys reference in the settings says so.
 */

export interface Sel {
  text: string;
  /** Selection start, in characters from the beginning of `text`. */
  start: number;
  /** Selection end. Equal to `start` for a bare caret. */
  end: number;
}

/** Clamp a selection to the text, and put it the right way round. */
function norm(s: Sel): Sel {
  const len = s.text.length;
  const a = Math.max(0, Math.min(len, Math.min(s.start, s.end)));
  const b = Math.max(0, Math.min(len, Math.max(s.start, s.end)));
  return { text: s.text, start: a, end: b };
}

function splice(text: string, from: number, to: number, insert: string): string {
  return text.slice(0, from) + insert + text.slice(to);
}

// ------------------------------------------------------------------- inline

/**
 * Wrap the selection in a marker, or unwrap it if it is already wrapped.
 *
 * Two shapes count as already wrapped, because both are what a person ends up with:
 *
 *   - the markers sit OUTSIDE the selection: `**|bold|**`  (select the word, press Ctrl+B twice)
 *   - the markers are INSIDE it:             `|**bold**|`  (select the whole thing including them)
 *
 * With no selection it inserts an empty pair and puts the caret between them, so Ctrl+B and
 * then typing gives bold text -- the behaviour every editor has.
 */
export function wrapInline(sel: Sel, marker: string): Sel {
  const s = norm(sel);
  const m = marker.length;

  if (s.start === s.end) {
    return {
      text: splice(s.text, s.start, s.end, marker + marker),
      start: s.start + m,
      end: s.start + m,
    };
  }

  const inner = s.text.slice(s.start, s.end);

  // `|**bold**|` -- the selection contains its own markers.
  if (inner.length >= m * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(m, -m);
    return {
      text: splice(s.text, s.start, s.end, stripped),
      start: s.start,
      end: s.start + stripped.length,
    };
  }

  // `**|bold|**` -- the markers are just outside it.
  const before = s.text.slice(Math.max(0, s.start - m), s.start);
  const after = s.text.slice(s.end, s.end + m);
  if (before === marker && after === marker) {
    return {
      text: splice(s.text, s.start - m, s.end + m, inner),
      start: s.start - m,
      end: s.start - m + inner.length,
    };
  }

  return {
    text: splice(s.text, s.start, s.end, marker + inner + marker),
    start: s.start + m,
    end: s.end + m,
  };
}

/**
 * Turn the selection into a link.
 *
 * If it already looks like a URL the label is left empty and the caret goes there, because
 * pasting a URL and pressing Ctrl+K means "name this". Otherwise the text becomes the label
 * and the URL slot is selected, ready to be typed or pasted over.
 */
export function makeLink(sel: Sel): Sel {
  const s = norm(sel);
  const inner = s.text.slice(s.start, s.end);
  const looksLikeUrl = /^(https?:\/\/|www\.|mailto:)\S+$/i.test(inner.trim());

  if (looksLikeUrl) {
    const built = `[](${inner.trim()})`;
    return { text: splice(s.text, s.start, s.end, built), start: s.start + 1, end: s.start + 1 };
  }

  const built = `[${inner}](url)`;
  const urlAt = s.start + inner.length + 3;
  return { text: splice(s.text, s.start, s.end, built), start: urlAt, end: urlAt + 3 };
}

/** Drop text in at the caret, replacing any selection. Used by the "insert date" shortcut. */
export function insertText(sel: Sel, insert: string): Sel {
  const s = norm(sel);
  return {
    text: splice(s.text, s.start, s.end, insert),
    start: s.start + insert.length,
    end: s.start + insert.length,
  };
}

// -------------------------------------------------------------------- lines

/** The character range of every line the selection touches, including a bare caret's line. */
function lineSpan(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  return { from, to: nl === -1 ? text.length : nl };
}

/** What kind of list marker, if any, a line already carries. */
const MARKER = /^(\s*)(?:([-*+])\s+\[( |x|X)\]\s+|([-*+])\s+|(\d+)[.)]\s+|(>)\s?)/;

/**
 * Add a line prefix to every line the selection touches, or take it off all of them.
 *
 * "All or nothing" on purpose: with a mixed selection the first press makes them uniform,
 * which is what people expect from a list button, and the second press clears them.
 *
 * `kind`:
 *   - `'quote'`  -> `> `
 *   - `'bullet'` -> `- `
 *   - `'number'` -> `1. `, renumbered from 1 down the block
 *   - `'task'`   -> `- [ ] `
 *
 * An existing marker of a DIFFERENT kind is replaced rather than stacked, so turning a bullet
 * list into a task list does not produce `- - [ ] x`. A quote is the exception: it composes
 * with a list, because `> - item` is a real and useful thing to write.
 */
export function toggleLinePrefix(sel: Sel, kind: 'quote' | 'bullet' | 'number' | 'task'): Sel {
  const s = norm(sel);
  const span = lineSpan(s.text, s.start, s.end);
  const block = s.text.slice(span.from, span.to);
  const lines = block.split('\n');

  const has = (line: string): boolean => {
    const m = MARKER.exec(line);
    if (!m) return false;
    if (kind === 'quote') return m[6] !== undefined;
    if (kind === 'task') return m[3] !== undefined;
    // A bullet marker followed by a checkbox is a task, not a bullet.
    if (kind === 'bullet') return m[2] === undefined && m[4] !== undefined;
    return m[5] !== undefined;
  };

  // A blank line in the middle of a block gets the same treatment as its neighbours, but an
  // all-blank selection should still produce a marker to type after.
  const meaningful = lines.filter((l) => l.trim() !== '');
  const removing = meaningful.length > 0 && meaningful.every(has);

  let n = 0;
  const out = lines.map((line) => {
    if (line.trim() === '' && lines.length > 1) return line;
    const m = MARKER.exec(line);
    const indent = m?.[1] ?? /^(\s*)/.exec(line)?.[1] ?? '';

    if (removing) {
      if (kind === 'quote') {
        // Take off only the `>` and leave any list marker under it intact.
        return line.replace(/^(\s*)>\s?/, '$1');
      }
      return indent + line.slice((m?.[0] ?? '').length);
    }

    if (kind === 'quote') return `${indent}> ${line.slice(indent.length)}`;

    // Strip a competing list marker, keeping a leading quote if there is one.
    let rest = line.slice(indent.length);
    const quoted = /^>\s?/.exec(rest);
    const quote = quoted?.[0] ?? '';
    rest = rest.slice(quote.length);
    const existing = MARKER.exec(rest);
    if (existing && existing[6] === undefined) rest = rest.slice(existing[0].length);

    n += 1;
    const prefix = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `;
    return indent + quote + prefix + rest;
  });

  const replaced = out.join('\n');
  const text = splice(s.text, span.from, span.to, replaced);
  // Keep the whole affected block selected. Trying to preserve the exact character offsets
  // across a renumbering is guesswork, and selecting the block is both predictable and useful.
  return { text, start: span.from, end: span.from + replaced.length };
}

/**
 * Toggle a task's checkbox on the caret's line, adding one if the line has no checkbox.
 *
 * The click-to-tick in the rendered preview goes through `toggleTaskInSource` instead, which
 * addresses a task by its index. This one is the keyboard route and works on position.
 */
export function toggleTaskHere(sel: Sel): Sel {
  const s = norm(sel);
  const span = lineSpan(s.text, s.start, s.end);
  const line = s.text.slice(span.from, span.to);
  const box = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)/.exec(line);
  if (box) {
    const next = box[2] === ' ' ? 'x' : ' ';
    const replaced = box[1] + next + box[3] + line.slice(box[0].length);
    return {
      text: splice(s.text, span.from, span.to, replaced),
      start: s.start,
      end: s.end,
    };
  }
  return toggleLinePrefix(s, 'task');
}

// -------------------------------------------------------------------- clear

const INLINE_MARKERS = ['***', '___', '**', '__', '~~', '*', '_', '`'];

/**
 * Strip formatting from the selection: inline markers, list markers, blockquotes and headings.
 *
 * Deliberately blunt. It removes markers wherever it finds them rather than parsing, because
 * "clear formatting" on a half-open construct should leave plain text, not a repair puzzle.
 * Link *labels* survive and their URLs go, which is what people mean by clearing a link.
 */
export function clearFormatting(sel: Sel): Sel {
  const s = norm(sel);
  const span = s.start === s.end ? lineSpan(s.text, s.start, s.end) : { from: s.start, to: s.end };
  let inner = s.text.slice(span.from, span.to);

  // Links and images first: their brackets would survive marker stripping otherwise.
  inner = inner.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  inner = inner.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  for (const m of INLINE_MARKERS) {
    inner = inner.split(m).join('');
  }

  inner = inner
    .split('\n')
    .map((line) =>
      line
        .replace(/^(\s*)>\s?/, '$1')
        .replace(/^(\s*)#{1,6}\s+/, '$1')
        .replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1')
        .replace(/^(\s*)[-*+]\s+/, '$1')
        .replace(/^(\s*)\d+[.)]\s+/, '$1'),
    )
    .join('\n');

  return {
    text: splice(s.text, span.from, span.to, inner),
    start: span.from,
    end: span.from + inner.length,
  };
}

// ------------------------------------------------------------------ heading

/**
 * Cycle the caret's line through heading levels: none -> H1 -> H2 -> H3 -> none.
 *
 * One key for all of them rather than three, because a sticky note is not a document and
 * nobody needs H4.
 */
export function cycleHeading(sel: Sel): Sel {
  const s = norm(sel);
  const span = lineSpan(s.text, s.start, s.end);
  const line = s.text.slice(span.from, span.to);
  const m = /^(\s*)(#{1,6})\s+/.exec(line);
  const indent = m?.[1] ?? /^(\s*)/.exec(line)?.[1] ?? '';
  const level = m ? (m[2] as string).length : 0;
  const next = level >= 3 ? 0 : level + 1;
  const rest = line.slice((m?.[0] ?? indent).length);
  const replaced = next === 0 ? indent + rest : `${indent}${'#'.repeat(next)} ${rest}`;
  const shift = replaced.length - line.length;
  return {
    text: splice(s.text, span.from, span.to, replaced),
    start: Math.max(span.from, s.start + shift),
    end: Math.max(span.from, s.end + shift),
  };
}
