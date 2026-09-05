/**
 * Reported: a note made on `https://blog.prepzone.dev/blog` also appeared on
 * `https://blog.prepzone.dev/blog/what-is-defi`.
 *
 * A url-scoped note is supposed to belong to ONE page. This file is the reproduction, written
 * before the fix, so that whatever the cause turns out to be, the case that found it stays
 * in the suite.
 */

import { describe, expect, it } from 'vitest';
import { candidateKeys, defaultScopeFor, matchContext, scopeMatches } from '~/bg/scope/match.ts';
import { normalizeUrl } from '~/bg/scope/normalize.ts';

const SECTION = 'https://blog.prepzone.dev/blog';
const ARTICLE = 'https://blog.prepzone.dev/blog/what-is-defi';

describe('the reported leak', () => {
  it('gives the two pages different keys', () => {
    expect(normalizeUrl(SECTION)).not.toBe(normalizeUrl(ARTICLE));
  });

  it('scopes a new note to the page it was made on', () => {
    const scope = defaultScopeFor(SECTION);
    expect(scope?.kind).toBe('url');
  });

  it('does NOT show a note from the section page on an article under it', () => {
    const scope = defaultScopeFor(SECTION);
    if (!scope) throw new Error('no scope for the section page');
    const onArticle = matchContext(ARTICLE, 'tab-1');
    if (!onArticle) throw new Error('no context for the article');
    expect(scopeMatches(scope, onArticle)).toBe(false);
  });

  it('does show it on the page it was made on', () => {
    const scope = defaultScopeFor(SECTION);
    if (!scope) throw new Error('no scope');
    const onSection = matchContext(SECTION, 'tab-1');
    if (!onSection) throw new Error('no context');
    expect(scopeMatches(scope, onSection)).toBe(true);
  });

  it('does not look the section note up when loading the article', () => {
    // The index lookup happens before `scopeMatches`, so a leak here would be a leak even if
    // the matcher were right.
    const key = normalizeUrl(ARTICLE);
    if (!key) throw new Error('no key for the article');
    const keys = candidateKeys(key, 'active');
    const section = normalizeUrl(SECTION);
    if (!section) throw new Error('no key for the section');
    expect(keys.some((k) => k.includes(section))).toBe(false);
  });

  it('is symmetrical: an article note does not appear on the section page', () => {
    const scope = defaultScopeFor(ARTICLE);
    if (!scope) throw new Error('no scope');
    const onSection = matchContext(SECTION, 'tab-1');
    if (!onSection) throw new Error('no context');
    expect(scopeMatches(scope, onSection)).toBe(false);
  });
});
