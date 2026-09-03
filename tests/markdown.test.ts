// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderMarkdown, safeHref, toggleTaskInSource } from '~/cs/note/markdown.ts';

const html = (src: string, opts?: Parameters<typeof renderMarkdown>[1]): string => {
  const host = document.createElement('div');
  host.append(renderMarkdown(src, opts));
  return host.innerHTML;
};

const text = (src: string): string => {
  const host = document.createElement('div');
  host.append(renderMarkdown(src));
  return host.textContent ?? '';
};

describe('renderMarkdown', () => {
  it('renders the everyday marks', () => {
    expect(html('**bold** and *italic* and `code`')).toContain('<strong>bold</strong>');
    expect(html('**bold** and *italic* and `code`')).toContain('<em>italic</em>');
    expect(html('**bold** and *italic* and `code`')).toContain('<code>code</code>');
    expect(html('~~gone~~')).toContain('<del>gone</del>');
  });

  it('shifts headings down so an h1 does not shout inside a 240px card', () => {
    expect(html('# Title')).toContain('<h3');
    expect(html('## Sub')).toContain('<h4');
    expect(html('###### Deep')).toContain('<h6');
  });

  it('renders lists, ordered lists and blockquotes', () => {
    expect(html('- one\n- two')).toContain('<ul');
    expect(html('1. one\n2. two')).toContain('<ol');
    expect(html('> quoted')).toContain('<blockquote>');
  });

  it('keeps an ordered list starting where the source says', () => {
    expect(html('5. five\n6. six')).toContain('start="5"');
  });

  it('renders fenced code as literal text', () => {
    const out = html('```\nconst a = 1 < 2;\n```');
    expect(out).toContain('<pre><code>');
    expect(out).toContain('&lt;');
  });
});

/**
 * The point of building DOM from tokens rather than parsing HTML: note text can arrive from an
 * imported ZIP, so it is untrusted, and a renderer that never parses HTML cannot execute any.
 */
describe('renderMarkdown -- nothing is ever parsed as HTML', () => {
  it.each([
    '<img src=x onerror="alert(1)">',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.test"></iframe>',
    '<svg onload="alert(1)"></svg>',
    '<a href="javascript:alert(1)">click</a>',
  ])('leaves %s as literal text', (src) => {
    const host = document.createElement('div');
    host.append(renderMarkdown(src));
    // Assert on the TREE, not on the serialized string: escaped text legitimately contains
    // the characters "onerror=", and checking the string would fail on its own escaping.
    expect(host.querySelector('script, iframe, img, svg, object, embed')).toBeNull();
    for (const el of host.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        expect(attr.name.startsWith('on'), `${el.tagName} has ${attr.name}`).toBe(false);
      }
    }
    // ...and the user still sees exactly what they typed.
    expect(host.textContent).toContain(src.slice(0, 12));
  });

  it('refuses a javascript: link but keeps its text', () => {
    const out = html('[click](javascript:alert(1))');
    expect(out).not.toContain('javascript:');
    expect(text('[click](javascript:alert(1))')).toContain('click');
  });

  it('gives external links noopener', () => {
    const out = html('[docs](https://example.com)');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });
});

describe('safeHref', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://example.com', true],
    ['mailto:a@b.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<b>x</b>', false],
    ['vbscript:msgbox', false],
    ['not a url at all', true], // resolves against the page, which is fine
  ])('%s -> %s', (href, ok) => {
    expect(safeHref(href) !== null).toBe(ok);
  });
});

describe('task lists', () => {
  it('renders checkboxes and reflects their state', () => {
    const out = html('- [ ] todo\n- [x] done');
    expect(out).toContain('type="checkbox"');
    expect((out.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(out).toContain('is-done');
  });

  it('reports the index of the box that was toggled', () => {
    const onToggleTask = vi.fn();
    const host = document.createElement('div');
    host.append(renderMarkdown('- [ ] a\n- [ ] b\n- [ ] c', { onToggleTask }));
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
    const box = boxes[1] as HTMLInputElement;
    // Not `.click()`: happy-dom does not run a checkbox's activation behaviour, so it toggles
    // `checked` without firing `change`. Dispatching it directly tests the same handler a real
    // browser would reach, without weakening the listener to `click`.
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onToggleTask).toHaveBeenCalledWith(1, true);
  });

  it('does not also print the raw [x] marker next to the box', () => {
    // marked emits the marker as its own inline token; forwarding it as unknown text put a
    // literal "[x]" beside every checkbox.
    const out = text('- [x] bread\n- [ ] coffee');
    expect(out).not.toContain('[x]');
    expect(out).not.toContain('[ ]');
    expect(out).toContain('bread');
    expect(out).toContain('coffee');
  });

  it('disables the boxes on a read-only note', () => {
    expect(html('- [ ] todo', { readOnly: true })).toContain('disabled');
  });
});

describe('toggleTaskInSource', () => {
  const src = '- [ ] first\nsome prose\n- [x] second\n* [ ] third';

  it('flips only the box that was clicked', () => {
    expect(toggleTaskInSource(src, 0, true)).toBe(
      '- [x] first\nsome prose\n- [x] second\n* [ ] third',
    );
    expect(toggleTaskInSource(src, 1, false)).toBe(
      '- [ ] first\nsome prose\n- [ ] second\n* [ ] third',
    );
    expect(toggleTaskInSource(src, 2, true)).toBe(
      '- [ ] first\nsome prose\n- [x] second\n* [x] third',
    );
  });

  it('handles ordered and indented task lists', () => {
    expect(toggleTaskInSource('1. [ ] a', 0, true)).toBe('1. [x] a');
    expect(toggleTaskInSource('   - [ ] nested', 0, true)).toBe('   - [x] nested');
  });

  it('leaves the source alone when the index does not exist', () => {
    expect(toggleTaskInSource(src, 99, true)).toBe(src);
  });

  it('never touches text that merely looks like a checkbox', () => {
    const tricky = 'an array [x] in prose\n- [ ] real one';
    expect(toggleTaskInSource(tricky, 0, true)).toBe('an array [x] in prose\n- [x] real one');
  });
});

describe('images', () => {
  it('renders a stored attachment through the host, never a network fetch', () => {
    const canvas = document.createElement('canvas');
    const out = html('![a photo](att:a_123)', { resolveAsset: () => canvas });
    expect(out).toContain('<canvas');
    expect(out).toContain('aria-label="a photo"');
  });

  it('never emits an <img> pointing at the network', () => {
    const out = html('![remote](https://evil.test/tracker.gif)');
    expect(out).not.toContain('<img');
    expect(out).toContain('md-missing');
  });

  it('shows the source text when the attachment is gone', () => {
    expect(text('![gone](att:a_missing)')).toContain('att:a_missing');
  });
});

describe('robustness', () => {
  it('renders an empty document without throwing', () => {
    expect(html('')).toBe('');
  });

  it('keeps unusual input as text rather than losing it', () => {
    const weird = '||| not a table |||\n\n$$$';
    expect(text(weird)).toContain('not a table');
  });
});
