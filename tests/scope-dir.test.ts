/**
 * A second look at the leak, prompted by a screenshot rather than a report.
 *
 * `spikes/firefox-extension.mjs` passed every check and its final screenshot showed TWO notes
 * on `/spikes/spa/blog`: the one made there, and the one made on `/spikes/spa/`. Every
 * assertion in that spike was about a single point on the page, and both notes were somewhere
 * else by then -- so nine YES lines were true and the picture still showed a leak.
 *
 * The difference from `tests/scope-leak.test.ts` is the trailing slash. That file used
 * `/blog` and `/blog/what-is-defi`. This one uses a directory URL, `/spikes/spa/`, which is
 * what a section index actually looks like -- and what someone typing a blog's address gets.
 */

import { describe, expect, it } from 'vitest';
import { candidateKeys, defaultScopeFor, matchContext, scopeMatches } from '~/bg/scope/match.ts';
import { normalizeUrl } from '~/bg/scope/normalize.ts';

const DIR = 'http://127.0.0.1:8731/spikes/spa/';
const UNDER = 'http://127.0.0.1:8731/spikes/spa/blog';
const DEEPER = 'http://127.0.0.1:8731/spikes/spa/blog/what-is-defi';

describe('a note made on a directory URL', () => {
  it('is scoped to that one page, not to everything under it', () => {
    expect(defaultScopeFor(DIR)?.kind).toBe('url');
  });

  it('has a different key from the pages under it', () => {
    expect(normalizeUrl(DIR)).not.toBe(normalizeUrl(UNDER));
    expect(normalizeUrl(DIR)).not.toBe(normalizeUrl(DEEPER));
  });

  it('does not match a page one level down', () => {
    const scope = defaultScopeFor(DIR);
    if (!scope) throw new Error('no scope');
    const ctx = matchContext(UNDER, 'tab-1');
    if (!ctx) throw new Error('no context');
    expect(scopeMatches(scope, ctx)).toBe(false);
  });

  it('is not among the keys looked up for a page one level down', () => {
    // The index lookup happens before `scopeMatches`, so a leak here leaks whatever the
    // matcher then says.
    const key = normalizeUrl(UNDER);
    const dir = normalizeUrl(DIR);
    if (!key || !dir) throw new Error('no keys');
    expect(candidateKeys(key, 'active')).not.toContain(`active ${dir}`);
  });

  it('still matches its own page, with or without the trailing slash', () => {
    const scope = defaultScopeFor(DIR);
    if (!scope) throw new Error('no scope');
    for (const spelling of [DIR, DIR.slice(0, -1)]) {
      const ctx = matchContext(spelling, 'tab-1');
      if (!ctx) throw new Error(`no context for ${spelling}`);
      expect(scopeMatches(scope, ctx), spelling).toBe(true);
    }
  });
});
