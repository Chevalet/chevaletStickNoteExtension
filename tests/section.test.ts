/**
 * "This section" — what it means, and the two ways it could have been wrong.
 *
 * A note can be scoped to a path prefix: every page under `/blog/`. The prefix is not stored
 * anywhere, it is worked out from the URL, and two different places work it out — the note's
 * own settings panel, to write the label in brackets, and the background, to build the scope.
 * If they disagreed the label would promise one thing and the click would do another, so
 * there is one function and this is its test.
 */

import { describe, expect, it } from 'vitest';
import { sectionLabel, sectionPrefix } from '~/shared/section.ts';

describe('sectionPrefix', () => {
  it('drops the last segment of the path', () => {
    expect(sectionPrefix('https://blog.example.dev/blog/what-is-defi')).toBe('/blog/');
    expect(sectionPrefix('https://blog.example.dev/blog/2026/january')).toBe('/blog/2026/');
  });

  it('treats a trailing slash as the same page, so the section is the same section', () => {
    /*
     * The one that needed thinking about. `/blog/` and `/blog` are the same page, so "this
     * section" has to mean the same thing on both. Without trimming the slash first, `/blog/`
     * would answer `/blog/` -- itself -- and a note scoped to "this section" from a section
     * index would have covered that one page only.
     */
    expect(sectionPrefix('https://x.test/blog/')).toBe(sectionPrefix('https://x.test/blog'));
    expect(sectionPrefix('https://x.test/blog/')).toBe('/');
    expect(sectionPrefix('https://x.test/a/b/')).toBe('/a/');
  });

  it('degrades to the whole origin at the top of a site', () => {
    expect(sectionPrefix('https://x.test/')).toBe('/');
    expect(sectionPrefix('https://x.test')).toBe('/');
    expect(sectionPrefix('https://x.test/only-one-segment')).toBe('/');
  });

  it('ignores the query and the fragment', () => {
    // They are not part of a path, and a section defined by a query string is not a section.
    expect(sectionPrefix('https://x.test/blog/post?utm_source=z#top')).toBe('/blog/');
  });

  it('always starts and ends with a slash', () => {
    for (const url of [
      'https://x.test/a/b/c',
      'https://x.test/a',
      'https://x.test/',
      'https://x.test/a/b/c/d/e',
    ]) {
      const out = sectionPrefix(url);
      expect(out.startsWith('/'), url).toBe(true);
      expect(out.endsWith('/'), url).toBe(true);
    }
  });

  it('answers something usable for a URL it cannot parse', () => {
    // Never throws: this runs while a settings panel is being built, and a broken label is a
    // smaller problem than a panel that does not open.
    expect(sectionPrefix('not a url at all')).toBe('/');
    expect(sectionPrefix('')).toBe('/');
  });
});

describe('sectionLabel', () => {
  it('is the prefix, where there is one', () => {
    expect(sectionLabel('https://blog.example.dev/blog/what-is-defi')).toBe('/blog/');
  });

  it('is the host at the top of a site, because "/" is not a section anyone pictures', () => {
    expect(sectionLabel('https://blog.example.dev/about')).toBe('blog.example.dev');
    expect(sectionLabel('https://blog.example.dev/')).toBe('blog.example.dev');
  });

  it('keeps the port, since a different port is a different origin', () => {
    expect(sectionLabel('http://127.0.0.1:8731/index.html')).toBe('127.0.0.1:8731');
  });
});
