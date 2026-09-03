import { describe, expect, it } from 'vitest';
import {
  looksLikeHashRoute,
  normalizeUrl,
  normalizeUrlFull,
  presetQueryPolicy,
} from '~/bg/scope/normalize.ts';
import { registrableDomain } from '~/bg/scope/psl.ts';
import { DEFAULT_URL_MATCH, type UrlMatch } from '~/shared/types.ts';

const n = (u: string, m?: Partial<UrlMatch>) => normalizeUrl(u, { ...DEFAULT_URL_MATCH, ...m });

/** Both URLs must produce the same key. */
const same = (a: string, b: string, m?: Partial<UrlMatch>) => {
  const ka = n(a, m);
  expect(ka, `${a} should be noteable`).not.toBeNull();
  expect(ka, `${a} != ${b}`).toBe(n(b, m));
};

/** The two URLs must produce different keys. */
const differ = (a: string, b: string, m?: Partial<UrlMatch>) => {
  expect(n(a, m)).not.toBe(n(b, m));
};

describe('normalizeUrl - scheme and host', () => {
  it('treats http and https as the same page by default', () => {
    same('http://example.com/a', 'https://example.com/a');
  });

  it('keeps them apart under scheme:exact', () => {
    differ('http://example.com/a', 'https://example.com/a', { scheme: 'exact' });
  });

  it('strips a leading www. but not other subdomains', () => {
    same('https://www.example.com/a', 'https://example.com/a');
    differ('https://shop.example.com/a', 'https://example.com/a');
  });

  it('keeps www. under www:exact', () => {
    differ('https://www.example.com/a', 'https://example.com/a', { www: 'exact' });
  });

  it('lowercases the host but never the path', () => {
    same('https://EXAMPLE.com/Path', 'https://example.com/Path');
    differ('https://example.com/Path', 'https://example.com/path');
  });

  it('drops the default port only', () => {
    same('https://example.com:443/a', 'https://example.com/a');
    same('http://example.com:80/a', 'http://example.com/a');
    differ('https://example.com:8443/a', 'https://example.com/a');
  });

  it('ignores a fully-qualified trailing dot', () => {
    same('https://example.com./a', 'https://example.com/a');
  });
});

describe('normalizeUrl - path', () => {
  it('drops a trailing slash except at the root', () => {
    same('https://example.com/docs/', 'https://example.com/docs');
    same('https://example.com/', 'https://example.com');
  });

  it('collapses duplicate slashes', () => {
    same('https://example.com//a///b', 'https://example.com/a/b');
  });

  it('decodes unreserved percent escapes', () => {
    same('https://example.com/a%7Eb', 'https://example.com/a~b');
    same('https://example.com/%41', 'https://example.com/A');
  });

  it('leaves reserved escapes alone - %2F is not a path separator', () => {
    differ('https://example.com/a%2Fb', 'https://example.com/a/b');
  });
});

describe('normalizeUrl - query', () => {
  it('is order-insensitive', () => {
    same('https://e.com/p?a=1&b=2', 'https://e.com/p?b=2&a=1');
  });

  it('drops tracking parameters by default', () => {
    same('https://e.com/p?utm_source=tw&id=7', 'https://e.com/p?id=7');
    same('https://e.com/p?fbclid=xyz', 'https://e.com/p');
    same('https://e.com/p?gclid=1&pk_campaign=2&id=9', 'https://e.com/p?id=9');
  });

  it('keeps tracking parameters under query:exact', () => {
    differ('https://e.com/p?utm_source=tw', 'https://e.com/p', { query: 'exact' });
  });

  it('drops the whole query under query:ignore', () => {
    same('https://e.com/p?id=7&x=1', 'https://e.com/p', { query: 'ignore' });
  });

  it('honours a keep whitelist', () => {
    const m: Partial<UrlMatch> = { query: { keep: ['v'] } };
    same('https://youtube.com/watch?v=abc&t=30s', 'https://youtube.com/watch?v=abc', m);
    differ('https://youtube.com/watch?v=abc', 'https://youtube.com/watch?v=def', m);
  });

  it('treats a valueless param and an empty one as the same', () => {
    same('https://e.com/p?flag', 'https://e.com/p?flag=');
  });

  it('keeps repeated keys and orders them by value', () => {
    same('https://e.com/p?t=b&t=a', 'https://e.com/p?t=a&t=b');
    differ('https://e.com/p?t=a&t=b', 'https://e.com/p?t=a');
  });
});

describe('normalizeUrl - hash', () => {
  it('drops the fragment by default', () => {
    same('https://e.com/p#section-3', 'https://e.com/p');
  });

  it('keeps it under hash:exact, which is what hash routers need', () => {
    differ('https://app.e.com/#/inbox', 'https://app.e.com/#/settings', { hash: 'exact' });
  });

  it('detects hash routes so the UI can default them to hash:exact', () => {
    expect(looksLikeHashRoute('#/inbox')).toBe(true);
    expect(looksLikeHashRoute('#!/inbox')).toBe(true);
    expect(looksLikeHashRoute('#section-3')).toBe(false);
    expect(looksLikeHashRoute('')).toBe(false);
  });
});

describe('normalizeUrl - unnoteable inputs', () => {
  it.each([
    'about:blank',
    'about:config',
    'moz-extension://abc/page.html',
    'view-source:https://e.com',
    'data:text/html,x',
    'blob:https://e.com/uuid',
    'javascript:void(0)',
    'chrome://browser/content/browser.xhtml',
    'ftp://files.example.com/x',
    'not a url',
    '',
  ])('returns null for %s', (u) => {
    expect(n(u)).toBeNull();
  });
});

describe('normalizeUrl - file URLs', () => {
  it('keeps the full path and is case-sensitive', () => {
    expect(n('file:///C:/notes/a.html')).toBe('file:///C:/notes/a.html');
    differ('file:///c:/a.html', 'file:///C:/a.html');
  });

  it('drops the fragment by default like any other page', () => {
    same('file:///tmp/a.html#x', 'file:///tmp/a.html');
  });
});

describe('normalizeUrl - very long URLs', () => {
  it('folds beyond 2048 chars but stays injective for different inputs', () => {
    const long = (tail: string) => `https://e.com/${'x'.repeat(2100)}${tail}`;
    const a = n(long('a'));
    expect(a).not.toBeNull();
    expect(a?.length).toBeLessThanOrEqual(1024 + 1 + 16);
    expect(a).not.toBe(n(long('b')));
  });
});

describe('normalizeUrlFull - structural output', () => {
  it('reports origin, hostname and pathname alongside the key', () => {
    expect(normalizeUrlFull('https://www.Example.com:443/Docs/api/?utm_source=x#frag')).toEqual({
      key: '//example.com/Docs/api',
      origin: 'https://www.example.com',
      hostname: 'example.com',
      pathname: '/Docs/api',
    });
  });
});

describe('presetQueryPolicy', () => {
  it('keeps v on youtube so each video is its own page', () => {
    expect(presetQueryPolicy('www.youtube.com')).toEqual({ keep: ['v', 'list'] });
  });
  it('keeps q on search engines', () => {
    expect(presetQueryPolicy('www.google.com')).toEqual({ keep: ['q', 'tbm'] });
    expect(presetQueryPolicy('google.co.uk')).toEqual({ keep: ['q', 'tbm'] });
  });
  it('falls back to dropTracking elsewhere', () => {
    expect(presetQueryPolicy('news.ycombinator.com')).toBe('dropTracking');
  });
});

describe('registrableDomain', () => {
  it.each([
    ['example.com', 'example.com'],
    ['www.example.com', 'example.com'],
    ['a.b.example.com', 'example.com'],
    ['example.co.uk', 'example.co.uk'],
    ['www.example.co.uk', 'example.co.uk'],
    ['shop.example.co.uk', 'example.co.uk'],
    ['example.ac.ir', 'example.ac.ir'],
    ['news.example.com.au', 'example.com.au'],
    ['user.github.io', 'user.github.io'],
    ['blog.user.github.io', 'user.github.io'],
    ['localhost', 'localhost'],
    ['192.168.1.10', '192.168.1.10'],
    ['example.ir', 'example.ir'],
  ])('%s -> %s', (host, want) => {
    expect(registrableDomain(host)).toBe(want);
  });
});
