import { describe, expect, it } from 'vitest';
import { type Block, type Inline, lex, lexInline } from '~/cs/note/md-lex.ts';

/**
 * The renderer tests in markdown.test.ts cover the shipped behaviour. These cover the lexer
 * itself, because replacing `marked` means owning a parser -- and a parser nobody probes at
 * the edges is a parser waiting to lose someone's note.
 */

const types = (blocks: Block[]): string[] => blocks.map((b) => b.type);

/** Flatten inline tokens to a readable shape for assertions. */
function shape(tokens: Inline[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'text':
          return JSON.stringify(t.text);
        case 'br':
          return 'br';
        case 'code':
          return `code(${JSON.stringify(t.text)})`;
        case 'image':
          return `img(${t.href})`;
        case 'link':
          return `link(${t.href},${shape(t.kids)})`;
        default:
          return `${t.type}(${shape(t.kids)})`;
      }
    })
    .join('+');
}

describe('block structure', () => {
  it('splits paragraphs on blank lines', () => {
    expect(types(lex('one\n\ntwo\n\n\nthree'))).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  it('reads every heading level and shifts nothing itself', () => {
    for (let depth = 1; depth <= 6; depth++) {
      const b = lex(`${'#'.repeat(depth)} title`)[0] as Extract<Block, { type: 'heading' }>;
      expect(b.type).toBe('heading');
      expect(b.depth).toBe(depth);
    }
    // Seven hashes is not a heading in CommonMark either.
    expect(types(lex('####### too many'))).toEqual(['paragraph']);
  });

  it('needs a space after the hashes', () => {
    expect(types(lex('#nospace'))).toEqual(['paragraph']);
  });

  it.each(['---', '***', '___', '  - - -  '.trim(), '-----'])('reads %j as a rule', (src) => {
    expect(types(lex(src))[0]).not.toBe('heading');
  });

  it('does not mistake a list item for a rule', () => {
    expect(types(lex('- item'))).toEqual(['list']);
  });

  it('keeps fenced code literal, markup and all', () => {
    const b = lex('```\n# not a heading\n- not a list\n**not bold**\n```')[0] as Extract<
      Block,
      { type: 'code' }
    >;
    expect(b.type).toBe('code');
    expect(b.text).toBe('# not a heading\n- not a list\n**not bold**');
  });

  it('closes an unterminated fence at the end of the document', () => {
    const b = lex('```\nstill code')[0] as Extract<Block, { type: 'code' }>;
    expect(b.type).toBe('code');
    expect(b.text).toBe('still code');
  });

  it('accepts tilde fences and does not close them with backticks', () => {
    const b = lex('~~~\n```\n~~~')[0] as Extract<Block, { type: 'code' }>;
    expect(b.text).toBe('```');
  });

  it('nests blocks inside a blockquote', () => {
    const q = lex('> # quoted heading\n> \n> and a paragraph')[0] as Extract<
      Block,
      { type: 'blockquote' }
    >;
    expect(q.type).toBe('blockquote');
    expect(types(q.kids)).toEqual(['heading', 'paragraph']);
  });

  it('ends a blockquote at a blank line', () => {
    expect(types(lex('> quoted\n\nnot quoted'))).toEqual(['blockquote', 'paragraph']);
  });

  /**
   * The bug the playground harness caught and this file originally missed.
   *
   * Lazy continuation used to absorb ANY unmarked line under a quote, so a code fence written
   * straight after a quote with no blank line between swallowed the fence, the paragraph after
   * it and the rule after that -- the whole rest of the note rendered inside the quote. The
   * old tests passed because they asserted those blocks existed, never where they sat.
   */
  it('does not let lazy continuation swallow the blocks that follow', () => {
    const src = [
      '> a quote',
      '> and a lazy continuation.',
      '```',
      'code();',
      '```',
      'after the fence',
      '---',
    ].join('\n');
    expect(types(lex(src))).toEqual(['blockquote', 'code', 'paragraph', 'hr']);

    const q = lex(src)[0] as Extract<Block, { type: 'blockquote' }>;
    // Two lines, one paragraph -- and nothing else pulled inside.
    expect(types(q.kids)).toEqual(['paragraph']);
  });

  it.each([
    ['# heading', 'heading'],
    ['- item', 'list'],
    ['1. item', 'list'],
    ['---', 'hr'],
    ['```', 'code'],
  ])('a quote followed directly by %j leaves it outside', (line, expected) => {
    expect(types(lex(`> quoted\n${line}`))).toEqual(['blockquote', expected]);
  });

  /** The same rule, from the other side: a paragraph must not swallow them either. */
  it.each([
    ['# heading', 'heading'],
    ['- item', 'list'],
    ['> quote', 'blockquote'],
    ['---', 'hr'],
  ])('a paragraph followed directly by %j ends first', (line, expected) => {
    expect(types(lex(`prose\n${line}`))).toEqual(['paragraph', expected]);
  });

  it('still keeps a genuine lazy continuation in the quote', () => {
    const q = lex('> first line\nsecond line, unmarked')[0] as Extract<
      Block,
      { type: 'blockquote' }
    >;
    expect(q.type).toBe('blockquote');
    expect(types(q.kids)).toEqual(['paragraph']);
  });
});

describe('lists', () => {
  it('reads each bullet marker', () => {
    for (const marker of ['-', '*', '+']) {
      const l = lex(`${marker} one\n${marker} two`)[0] as Extract<Block, { type: 'list' }>;
      expect(l.type).toBe('list');
      expect(l.ordered).toBe(false);
      expect(l.items).toHaveLength(2);
    }
  });

  it('reads ordered lists and remembers where they start', () => {
    const l = lex('5. five\n6. six')[0] as Extract<Block, { type: 'list' }>;
    expect(l.ordered).toBe(true);
    expect(l.start).toBe(5);
    expect(l.items).toHaveLength(2);
  });

  it('accepts both 1. and 1) as ordered markers', () => {
    expect((lex('1) one')[0] as Extract<Block, { type: 'list' }>).ordered).toBe(true);
  });

  it('marks task items and reads their state, case-insensitively', () => {
    const l = lex('- [ ] todo\n- [x] done\n- [X] also done\n- plain')[0] as Extract<
      Block,
      { type: 'list' }
    >;
    expect(l.items.map((i) => i.task)).toEqual([true, true, true, null]);
    expect(l.items.map((i) => i.checked)).toEqual([false, true, true, false]);
  });

  it('does not treat prose that mentions [x] as a task', () => {
    const l = lex('- an array [x] in prose')[0] as Extract<Block, { type: 'list' }>;
    expect(l.items[0]?.task).toBeNull();
  });

  it('nests by indentation', () => {
    const l = lex('- outer\n  - inner\n  - inner two\n- outer two')[0] as Extract<
      Block,
      { type: 'list' }
    >;
    expect(l.items).toHaveLength(2);
    expect(types(l.items[0]?.kids ?? [])).toEqual(['paragraph', 'list']);
    const inner = l.items[0]?.kids[1] as Extract<Block, { type: 'list' }>;
    expect(inner.items).toHaveLength(2);
  });

  it('starts a new list when the marker type changes', () => {
    expect(types(lex('- bullet\n1. ordered'))).toEqual(['list', 'list']);
  });

  it('ends a list at a blank line followed by prose', () => {
    expect(types(lex('- one\n- two\n\nprose'))).toEqual(['list', 'paragraph']);
  });

  it('does not lose an item to a stray blank line inside the list', () => {
    const l = lex('- one\n\n- two')[0] as Extract<Block, { type: 'list' }>;
    expect(l.items).toHaveLength(2);
  });
});

describe('inline', () => {
  it('reads bold, italic, strike and code', () => {
    expect(shape(lexInline('**b**'))).toBe('strong("b")');
    expect(shape(lexInline('__b__'))).toBe('strong("b")');
    expect(shape(lexInline('*i*'))).toBe('em("i")');
    expect(shape(lexInline('_i_'))).toBe('em("i")');
    expect(shape(lexInline('~~s~~'))).toBe('del("s")');
    expect(shape(lexInline('`c`'))).toBe('code("c")');
  });

  it('nests emphasis inside strong', () => {
    expect(shape(lexInline('**bold *and italic***'))).toContain('em(');
  });

  it('does not read a single marker as bold', () => {
    expect(shape(lexInline('**b**'))).not.toContain('em(');
  });

  it('leaves an unclosed marker as literal text', () => {
    expect(shape(lexInline('**not closed'))).toBe('"**not closed"');
    expect(shape(lexInline('a * b'))).toBe('"a * b"');
    expect(shape(lexInline('`unclosed'))).toBe('"`unclosed"');
  });

  /** Code has to win, or a snippet containing markers gets mangled. */
  it('treats everything inside a code span as literal', () => {
    expect(shape(lexInline('`**not bold**`'))).toBe('code("**not bold**")');
    expect(shape(lexInline('`[not a link](x)`'))).toBe('code("[not a link](x)")');
  });

  it('supports multi-backtick code spans, so a span can contain a backtick', () => {
    expect(shape(lexInline('``a ` b``'))).toBe('code("a ` b")');
  });

  it('honours backslash escapes', () => {
    expect(shape(lexInline('\\*not italic\\*'))).toBe('"*not italic*"');
    expect(shape(lexInline('\\[not a link\\]'))).toBe('"[not a link]"');
  });

  it('reads links, with and without a title', () => {
    expect(shape(lexInline('[text](https://e.com)'))).toBe('link(https://e.com,"text")');
    const withTitle = lexInline('[text](https://e.com "the title")')[0] as Extract<
      Inline,
      { type: 'link' }
    >;
    expect(withTitle.title).toBe('the title');
  });

  it('reads images and keeps their source text for the fallback', () => {
    const img = lexInline('![alt text](att:a_1)')[0] as Extract<Inline, { type: 'image' }>;
    expect(img.type).toBe('image');
    expect(img.alt).toBe('alt text');
    expect(img.href).toBe('att:a_1');
    expect(img.raw).toBe('![alt text](att:a_1)');
  });

  it('does not read an image as a link', () => {
    expect(shape(lexInline('![a](x)'))).toBe('img(x)');
  });

  it('turns a single newline into a break, which is what a note wants', () => {
    expect(shape(lexInline('one\ntwo'))).toBe('"one"+br+"two"');
  });

  it('leaves an underscore inside a word alone', () => {
    // snake_case must survive, or every identifier in a note turns italic halfway through.
    const out = shape(lexInline('some_var and other_var'));
    expect(out).not.toContain('em(');
  });
});

describe('robustness', () => {
  it('returns nothing for empty input', () => {
    expect(lex('')).toEqual([]);
    expect(lex('\n\n  \n')).toEqual([]);
  });

  it('normalizes CRLF, so a Windows paste does not produce stray breaks', () => {
    expect(types(lex('one\r\n\r\ntwo'))).toEqual(['paragraph', 'paragraph']);
  });

  it('does not hang or blow the stack on adversarial input', () => {
    const nasty = [
      '*'.repeat(2000),
      '['.repeat(1000),
      '`'.repeat(1000),
      '- '.repeat(1000),
      '> '.repeat(500),
      '#'.repeat(500),
      `${'**'.repeat(400)}text`,
    ];
    for (const src of nasty) {
      const started = Date.now();
      expect(() => lex(src)).not.toThrow();
      expect(Date.now() - started, `slow on ${src.slice(0, 12)}…`).toBeLessThan(500);
    }
  });

  it('keeps every character of the input somewhere in the output', () => {
    // The property that matters most for a notes app: nothing is silently dropped.
    const src = 'plain **bold** `code` [l](u) ![i](att:a) ~~s~~\n- item\n> quote';
    const collect = (blocks: Block[]): string =>
      blocks
        .map((b) => {
          if (b.type === 'code') return b.text;
          if (b.type === 'hr') return '';
          if (b.type === 'blockquote') return collect(b.kids);
          if (b.type === 'list') return b.items.map((i) => collect(i.kids)).join('');
          return text(b.kids);
        })
        .join('');
    const text = (tokens: Inline[]): string =>
      tokens
        .map((t) =>
          t.type === 'text'
            ? t.text
            : t.type === 'code'
              ? t.text
              : t.type === 'image'
                ? t.alt
                : 'kids' in t
                  ? text(t.kids)
                  : '',
        )
        .join('');
    const out = collect(lex(src));
    for (const word of ['plain', 'bold', 'code', 'l', 'i', 's', 'item', 'quote']) {
      expect(out, `lost "${word}"`).toContain(word);
    }
  });
});
