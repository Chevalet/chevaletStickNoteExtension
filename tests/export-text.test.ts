// @vitest-environment happy-dom
/**
 * Markdown and HTML export: the two formats that leave.
 *
 * These outputs are the only artefacts of this project that will be opened by software nobody
 * here controls, possibly years from now, so the properties worth pinning are about what is
 * NOT in them: no script, no fetch, no reference to a file that is not inside the document,
 * and nothing from a note's text that can turn into markup.
 *
 * The self-containment checks are the important ones, and they are deliberately crude -- a
 * substring search for `http` in the wrong places, and a count of `<script`. A clever check
 * here would be a check that can be fooled.
 */

import { describe, expect, it } from 'vitest';
import type { NoteRecord } from '~/bg/db/schema.ts';
import { textExportName, toHtml, toMarkdown } from '~/bg/jobs/export-text.ts';
import type { NoteId } from '~/shared/types.ts';

function note(over: Partial<NoteRecord> & { id: string }): NoteRecord {
  const { id, ...rest } = over;
  return {
    id: id as NoteId,
    schemaV: 3,
    rev: 1,
    scope: { kind: 'url', urlKey: 'https://example.org/a' },
    ix_state: 'active',
    ix_urlKeys: [],
    ix_origin: '',
    ix_domain: '',
    ix_tabKey: '',
    ix_scopeKind: 'url',
    body: { format: 'md', text: 'hello' },
    assets: [],
    title: 'hello',
    tags: [],
    anchor: null,
    ui: { x: 0, y: 0, w: 240, h: 160, z: 1, collapsed: false, locked: false, opacity: 1 },
    style: {},
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_000_000_000,
    fieldClock: {},
    context: { url: 'https://example.org/an-article', title: 'An article' },
    ...rest,
  } as NoteRecord;
}

const NOW = new Date('2026-09-05T12:34:00Z');

describe('toMarkdown', () => {
  it('groups notes under the page they were made on, in the order they were made', () => {
    const out = toMarkdown({
      now: NOW,
      notes: [
        note({ id: 'n_2', body: { format: 'md', text: 'second' }, createdAt: 2 }),
        note({ id: 'n_1', body: { format: 'md', text: 'first' }, createdAt: 1 }),
        note({
          id: 'n_3',
          body: { format: 'md', text: 'elsewhere' },
          context: { url: 'https://other.test/x', title: 'Other' },
        }),
      ],
    });
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
    expect(out).toContain('## An article');
    expect(out).toContain('<https://example.org/an-article>');
    expect(out).toContain('## Other');
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('elsewhere'));
  });

  it('passes the note text through untouched', () => {
    // A note body IS markdown. Reformatting it would be this function inventing edits to
    // someone's writing -- and the one thing an export must never do is change the content.
    const text = '# Kept\n\n- [x] done\n- [ ] not\n\n```js\nconst a = 1;\n```\n\n**bold** *it*';
    const out = toMarkdown({ notes: [note({ id: 'n_1', body: { format: 'md', text } })] });
    expect(out).toContain(text.trim());
  });

  it('says when a note has a drawing, rather than dropping it in silence', () => {
    const out = toMarkdown({
      notes: [
        note({
          id: 'n_1',
          ink: { strokes: [{ points: [1, 2, 0.5], color: '#000', size: 2 }], w: 10, h: 10 },
        }),
      ],
    });
    expect(out).toContain('drawing');
    expect(out).toContain('ZIP');
  });

  it('counts the notes and dates the file', () => {
    const out = toMarkdown({ now: NOW, notes: [note({ id: 'n_1' }), note({ id: 'n_2' })] });
    expect(out).toContain('2 notes');
    expect(out).toContain('2026-09-05');
  });

  it('produces something reasonable for no notes at all', () => {
    const out = toMarkdown({ notes: [], now: NOW });
    expect(out).toContain('0 notes');
    expect(out.trim().split('\n')[0]).toBe('# My notes');
  });

  it('never leaves three blank lines in a row', () => {
    const out = toMarkdown({
      notes: [note({ id: 'n_1', body: { format: 'md', text: 'a\n\n\n\nb' }, tags: ['x'] })],
    });
    expect(out).not.toMatch(/\n\n\n/);
  });
});

describe('toHtml', () => {
  it('is one self-contained document: no script, and nothing fetched', () => {
    const { html } = toHtml({ now: NOW, notes: [note({ id: 'n_1' })] });
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('@import');
    // The only http in the file should be the source links, which are content, not resources.
    const resourceish = html.match(/(?:src|href)="([^"]*)"/g) ?? [];
    for (const attr of resourceish) {
      const ok = attr.startsWith('href="https://example.org') || attr.startsWith('src="data:');
      expect(ok, `${attr} would make the page fetch something`).toBe(true);
    }
  });

  it('renders the markdown with the app own renderer, so it looks like the app', () => {
    const { html } = toHtml({
      notes: [
        note({
          id: 'n_1',
          body: { format: 'md', text: '# Head\n\n- [x] done\n\n> quoted\n\n`code`' },
        }),
      ],
    });
    expect(html).toContain('<h3 class="md-h">Head</h3>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<code>code</code>');
    // A ticked box has to survive serialisation. renderMarkdown sets `.checked` as a
    // PROPERTY, which innerHTML does not see, so every task list came out unticked until the
    // export started reflecting it onto the attribute.
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
    expect(html).toContain('is-done');
    // And nothing in a static page should be clickable.
    expect(html).toContain('disabled');
  });

  it('cannot be made to inject markup from a note body', () => {
    const nasty = '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[a](javascript:x)';
    const { html } = toHtml({ notes: [note({ id: 'n_1', body: { format: 'md', text: nasty } })] });
    expect(html.toLowerCase()).not.toContain('<script');
    // `onerror` and `javascript:` DO appear -- as escaped text, which is the correct failure
    // mode for a note: you see what you typed. What must not appear is either of them inside
    // a tag, so the check is on the markup and not on the characters.
    expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);
    expect(html).not.toMatch(/(?:href|src)="javascript:/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('escapes a hostile page title and url', () => {
    const { html } = toHtml({
      notes: [
        note({
          id: 'n_1',
          context: { url: 'https://x.test/"><b>', title: '</h2><script>bad()</script>' },
        }),
      ],
    });
    expect(html.toLowerCase()).not.toContain('<script');
    expect(html).not.toContain('"><b>');
  });

  it('embeds images as data URIs and counts them', () => {
    const out = toHtml({
      notes: [
        note({
          id: 'n_1',
          body: { format: 'md', text: '![](att:a_one)' },
          assets: ['a_one'] as NoteRecord['assets'],
        }),
      ],
      assets: [{ id: 'a_one', mime: 'image/png', base64: 'iVBORw0KGgo=' }],
    });
    expect(out.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out.images).toEqual({ embedded: 1, missing: 0 });
  });

  it('counts an image the note points at but the caller did not supply', () => {
    const out = toHtml({
      notes: [note({ id: 'n_1', assets: ['a_gone'] as NoteRecord['assets'] })],
      assets: [],
    });
    expect(out.images).toEqual({ embedded: 0, missing: 1 });
  });

  it('reports its own size, so a caller can warn before handing over 40MB', () => {
    const out = toHtml({ notes: [note({ id: 'n_1' })] });
    expect(out.bytes).toBe(new TextEncoder().encode(out.html).length);
    expect(out.bytes).toBeGreaterThan(500);
  });

  it('marks a right-to-left note so it reads correctly', () => {
    const { html } = toHtml({
      notes: [note({ id: 'n_1', body: { format: 'md', text: 'یادداشت فارسی' } })],
    });
    expect(html).toContain('dir="auto"');
  });

  it('carries a dark palette, because a reader may not want a white page', () => {
    const { html } = toHtml({ notes: [note({ id: 'n_1' })] });
    expect(html).toContain('prefers-color-scheme: dark');
  });
});

describe('textExportName', () => {
  it('dates the file and uses the right extension', () => {
    expect(textExportName('md', new Date('2026-09-05T00:00:00'))).toBe(
      'chevalet-notes-2026-09-05.md',
    );
    expect(textExportName('html', new Date('2026-01-02T00:00:00'))).toBe(
      'chevalet-notes-2026-01-02.html',
    );
  });
});
