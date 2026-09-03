/**
 * A small markdown lexer, for the subset a sticky note needs.
 *
 * This replaced `marked`, which was 42kB of the renderer's 107kB minified -- nearly forty per
 * cent of a bundle that is parsed on every annotated page load. `marked` is a full
 * CommonMark + GFM implementation: tables, footnotes, reference links, HTML blocks, entity
 * handling. A note needs headings, emphasis, code, links, lists, task lists, quotes and a
 * rule, and paying 42kB on every page load for the rest is disproportionate.
 *
 * The grammar below is deliberately smaller than CommonMark, and it is honest about that:
 * anything it does not recognise stays as literal text, which is the right failure mode for a
 * note -- you see what you typed rather than losing it.
 *
 * The contract is `tests/markdown.test.ts`. Those tests were written against `marked` and
 * pass unchanged against this, which is the only reason replacing a battle-tested parser is a
 * reasonable thing to do.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; kids: Inline[] }
  | { type: 'em'; kids: Inline[] }
  | { type: 'del'; kids: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'br' }
  | { type: 'link'; href: string; title?: string; kids: Inline[] }
  | { type: 'image'; href: string; alt: string; raw: string };

export type Block =
  | { type: 'heading'; depth: number; kids: Inline[] }
  | { type: 'paragraph'; kids: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'hr' }
  | { type: 'blockquote'; kids: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] };

export interface ListItem {
  /** `null` when the item is not a task; otherwise its checked state. */
  task: boolean | null;
  checked: boolean;
  kids: Block[];
}

const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\n`]*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TASK = /^\[([ xX])\]\s+(.*)$/;

/**
 * Does this line begin a block of its own?
 *
 * Used in two places that both need the same answer: where a paragraph stops, and where a
 * blockquote's lazy continuation stops. Having one definition is the point -- when those two
 * disagree, text moves between blocks depending on which one asked.
 */
function startsBlock(line: string): boolean {
  return (
    HR.test(line) ||
    HEADING.test(line) ||
    FENCE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line)
  );
}

/** Split source into blocks. Line-based, single pass, no backtracking. */
export function lex(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return lexLines(lines);
}

function lexLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] as string;

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code. Everything inside is literal, including anything that looks like markup.
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const body: string[] = [];
      i++;
      while (
        i < lines.length &&
        !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[i] as string)
      ) {
        body.push(lines[i] as string);
        i++;
      }
      i++; // closing fence, or the end of the document
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        depth: (heading[1] as string).length,
        kids: lexInline(heading[2] as string),
      });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i] as string);
        if (q) {
          inner.push(q[1] as string);
          i++;
          continue;
        }
        // A blank line, or anything not quoted, ends the quote.
        const next = lines[i] as string;
        if (!next.trim()) break;
        // Lazy continuation: an unmarked line under a quote continues its PARAGRAPH. A line
        // that starts a block of its own does not -- without this check a code fence written
        // straight after a quote, with no blank line between, gets swallowed whole and the
        // rest of the note renders inside the quote. The harness caught that; the unit tests
        // did not, because they asserted that the blocks existed and not where they sat.
        if (startsBlock(next)) break;
        inner.push(next);
        i++;
      }
      blocks.push({ type: 'blockquote', kids: lexLines(inner) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const [list, next] = lexList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] as string;
      if (!l.trim()) break;
      // Only the first line is exempt: it is what got us here.
      if (para.length > 0 && startsBlock(l)) break;
      para.push(l);
      i++;
    }
    // `breaks: true` semantics -- a single newline inside a paragraph is a line break, which
    // is what people expect in a note rather than in a document.
    blocks.push({ type: 'paragraph', kids: lexInline(para.join('\n')) });
  }

  return blocks;
}

/** One list, including nested lists, by indentation. */
function lexList(lines: string[], start: number): [Block, number] {
  const first = (BULLET.exec(lines[start] as string) ??
    ORDERED.exec(lines[start] as string)) as RegExpExecArray;
  const isOrdered = ORDERED.test(lines[start] as string);
  const baseIndent = (first[1] as string).length;
  const startNumber = isOrdered ? Number(first[2]) : 1;

  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i] as string;
    const m = isOrdered ? ORDERED.exec(line) : BULLET.exec(line);
    const other = isOrdered ? BULLET.exec(line) : ORDERED.exec(line);

    if (!m) {
      // A blank line inside a list is allowed; two in a row end it.
      if (!line.trim() && i + 1 < lines.length && (lines[i + 1] as string).trim()) {
        const ahead = isOrdered
          ? ORDERED.exec(lines[i + 1] as string)
          : BULLET.exec(lines[i + 1] as string);
        if (ahead && (ahead[1] as string).length === baseIndent) {
          i++;
          continue;
        }
      }
      break;
    }
    // A different marker type at the same level starts a new list.
    if (other && (other[1] as string).length === baseIndent) break;

    const indent = (m[1] as string).length;
    if (indent < baseIndent) break;
    if (indent > baseIndent) {
      // Nested: hand the sub-block to the previous item.
      const [nested, next] = lexList(lines, i);
      const last = items.at(-1);
      if (last) last.kids.push(nested);
      else items.push({ task: null, checked: false, kids: [nested] });
      i = next;
      continue;
    }

    const content = (isOrdered ? m[3] : m[3]) as string;
    const task = TASK.exec(content);
    const body = task ? (task[2] as string) : content;

    items.push({
      task: task ? true : null,
      checked: task ? (task[1] as string).toLowerCase() === 'x' : false,
      kids: [{ type: 'paragraph', kids: lexInline(body) }],
    });
    i++;
  }

  return [{ type: 'list', ordered: isOrdered, start: startNumber, items }, i];
}

// ------------------------------------------------------------------- inline

const IMAGE = /^!\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+"([^"]*)")?\s*\)/;
const LINK = /^\[([^\]]*)\]\(\s*([^\s)]*)(?:\s+"([^"]*)")?\s*\)/;

/**
 * Inline parsing.
 *
 * Scans left to right, taking the longest recognised construct at each position and
 * accumulating anything else as text. No nesting of a construct inside itself, which keeps it
 * linear and is not a limitation anyone writing a sticky note will hit.
 */
export function lexInline(source: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer) {
      out.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  /** Would emphasis here be inside a word? `snake_case` must not turn italic halfway. */
  const wordChar = (ch: string | undefined): boolean =>
    Boolean(ch) && /[\w\u0600-\u06ff]/.test(ch as string);

  /**
   * Find the closing run for a delimiter, skipping any occurrence that is part of a LONGER
   * run. Without that, "**bold *and italic***" closes the strong on the first two stars of
   * the trailing three and leaves one behind -- which is exactly what it used to do.
   */
  const closingRun = (rest: string, marker: string): number => {
    let at = rest.indexOf(marker, marker.length);
    while (at >= 0) {
      const after = rest[at + marker.length];
      if (after !== marker[0]) return at;
      at = rest.indexOf(marker, at + 1);
    }
    return -1;
  };

  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i] as string;

    if (ch === '\\' && i + 1 < source.length) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }

    if (ch === '\n') {
      flush();
      out.push({ type: 'br' });
      i++;
      continue;
    }

    // Code first: nothing inside a code span is markup.
    if (ch === '`') {
      const run = /^(`+)/.exec(rest)?.[1] as string;
      const close = rest.indexOf(run, run.length);
      if (close > 0) {
        flush();
        out.push({ type: 'code', text: rest.slice(run.length, close).trim() });
        i += close + run.length;
        continue;
      }
    }

    if (ch === '!') {
      const img = IMAGE.exec(rest);
      if (img) {
        flush();
        out.push({
          type: 'image',
          alt: img[1] as string,
          href: img[2] as string,
          raw: img[0] as string,
        });
        i += (img[0] as string).length;
        continue;
      }
    }

    if (ch === '[') {
      const link = LINK.exec(rest);
      if (link) {
        flush();
        const entry: Inline = {
          type: 'link',
          href: link[2] as string,
          kids: lexInline(link[1] as string),
        };
        if (link[3]) (entry as { title?: string }).title = link[3];
        out.push(entry);
        i += (link[0] as string).length;
        continue;
      }
    }

    if (rest.startsWith('~~')) {
      const end = closingRun(rest, '~~');
      if (end > 2) {
        flush();
        out.push({ type: 'del', kids: lexInline(rest.slice(2, end)) });
        i += end + 2;
        continue;
      }
    }

    // Strong before emphasis, so "**" is never read as two "*".
    const strongMarker = rest.startsWith('**') ? '**' : rest.startsWith('__') ? '__' : null;
    if (strongMarker) {
      const intraword = strongMarker === '__' && wordChar(source[i - 1]);
      const end = intraword ? -1 : closingRun(rest, strongMarker);
      if (end > strongMarker.length) {
        flush();
        out.push({ type: 'strong', kids: lexInline(rest.slice(strongMarker.length, end)) });
        i += end + strongMarker.length;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      // An underscore cannot open emphasis inside a word, which is what keeps snake_case
      // intact. An asterisk can, because that is what CommonMark allows and what people mean.
      const intraword = ch === '_' && wordChar(source[i - 1]);
      const end = intraword ? -1 : rest.indexOf(ch, 1);
      const closesInsideWord = ch === '_' && wordChar(rest[end + 1]);
      if (end > 1 && rest[1] !== ch && !closesInsideWord) {
        flush();
        out.push({ type: 'em', kids: lexInline(rest.slice(1, end)) });
        i += end + 1;
        continue;
      }
    }

    buffer += ch;
    i++;
  }

  flush();
  return out;
}
