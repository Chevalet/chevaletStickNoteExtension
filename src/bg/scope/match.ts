/**
 * Turning a scope into index columns, and a URL into the lookups that find it.
 * Plan section 3.
 *
 * The shape of the problem: a note may carry its own `UrlMatch` (keep only `?v=`, or treat the
 * hash as part of the page), so the key it was stored under is not necessarily the key the
 * default normalizer would produce for an incoming URL. Rather than scan, a note is indexed
 * under EVERY key it could be found by, and an incoming URL generates the small set of
 * candidate keys to look up. Both sides are pure and unit-tested.
 */

import { stateKey } from '~/bg/db/schema.ts';
import {
  DEFAULT_URL_MATCH,
  type NoteState,
  type Scope,
  type TabKey,
  type UrlMatch,
} from '~/shared/types.ts';
import {
  looksLikeHashRoute,
  normalizeUrl,
  normalizeUrlFull,
  presetQueryPolicy,
} from './normalize.ts';
import { registrableDomain } from './psl.ts';

export interface IndexColumns {
  ix_urlKeys: string[];
  ix_origin: string;
  ix_domain: string;
  ix_tabKey: TabKey | '';
  ix_scopeKind: Scope['kind'];
}

/**
 * The url keys a note should be findable under.
 *
 * A `url`-scoped note is indexed under its own key. A note scoped to something broader is
 * found through `by_state_origin` / `by_state_domain` / `by_state_kind` instead, so it
 * contributes no url keys at all.
 */
export function indexColumns(scope: Scope, state: NoteState): IndexColumns {
  const base: IndexColumns = {
    ix_urlKeys: [],
    ix_origin: '',
    ix_domain: '',
    ix_tabKey: '',
    ix_scopeKind: scope.kind,
  };

  switch (scope.kind) {
    case 'url':
      base.ix_urlKeys = [stateKey(state, scope.urlKey)];
      break;
    case 'prefix':
      base.ix_origin = scope.origin;
      break;
    case 'domain':
      base.ix_domain = scope.registrable;
      break;
    case 'tab':
      base.ix_tabKey = scope.tabKey;
      break;
    case 'global':
      break;
  }
  return base;
}

/**
 * Every key an incoming URL might have been stored under.
 *
 * Four variants, because a note's own matcher can differ from the default:
 *   - the site's default policy (tracking params dropped, hash dropped)
 *   - the same, but keeping the hash, for hash-router SPAs
 *   - query kept exactly, for a note the user pinned to one specific query
 *   - query dropped entirely, for a note pinned to the bare path
 *
 * Four keyed index lookups is O(log n) each and independent of how many notes exist.
 */
export function candidateKeys(url: string, state: NoteState = 'active'): string[] {
  const parsed = normalizeUrlFull(url);
  if (!parsed) return [];

  const preset = presetQueryPolicy(parsed.hostname);
  const hash = hashOf(url);
  const variants: UrlMatch[] = [
    { ...DEFAULT_URL_MATCH, query: preset },
    { ...DEFAULT_URL_MATCH, query: 'exact' },
    { ...DEFAULT_URL_MATCH, query: 'ignore' },
  ];
  // Only worth looking up hash variants when the URL actually has a route-looking fragment.
  if (looksLikeHashRoute(hash)) {
    variants.push(
      { ...DEFAULT_URL_MATCH, query: preset, hash: 'exact' },
      { ...DEFAULT_URL_MATCH, query: 'ignore', hash: 'exact' },
    );
  }

  const seen = new Set<string>();
  for (const m of variants) {
    const key = normalizeUrl(url, m);
    if (key) seen.add(stateKey(state, key));
  }
  return [...seen];
}

function hashOf(url: string): string {
  try {
    return new URL(url).hash;
  } catch {
    return '';
  }
}

/** Everything about the page a note is being matched against. */
export interface MatchContext {
  url: string;
  origin: string;
  hostname: string;
  pathname: string;
  registrable: string;
  tabKey?: string;
}

export function matchContext(url: string, tabKey?: string): MatchContext | null {
  const p = normalizeUrlFull(url);
  if (!p) return null;
  return {
    url,
    origin: p.origin,
    hostname: p.hostname,
    pathname: p.pathname,
    registrable: registrableDomain(p.hostname),
    ...(tabKey === undefined ? {} : { tabKey }),
  };
}

/**
 * The final filter, applied to the small candidate set the indexes returned.
 *
 * The index lookups are deliberately a little generous -- an origin-indexed note might be a
 * `prefix` scope whose path does not actually match -- so this is where the exact answer is
 * decided.
 */
export function scopeMatches(scope: Scope, ctx: MatchContext): boolean {
  switch (scope.kind) {
    case 'url': {
      const key = normalizeUrl(ctx.url, scope.match);
      return key !== null && key === scope.urlKey;
    }
    case 'prefix':
      return (
        scope.origin === ctx.origin &&
        (ctx.pathname === scope.pathPrefix ||
          ctx.pathname.startsWith(ensureSlash(scope.pathPrefix)))
      );
    case 'domain':
      return scope.includeSubdomains
        ? ctx.hostname === scope.registrable || ctx.hostname.endsWith(`.${scope.registrable}`)
        : ctx.hostname === scope.registrable;
    case 'tab':
      return ctx.tabKey !== undefined && ctx.tabKey === scope.tabKey;
    case 'global':
      return true;
  }
}

/** `/docs` must match `/docs/api` but not `/docsearch`. */
function ensureSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

/** Build a default `url` scope for a page, honouring the site's query preset. */
export function defaultScopeFor(url: string): Scope | null {
  const parsed = normalizeUrlFull(url);
  if (!parsed) return null;
  const hash = hashOf(url);
  const match: UrlMatch = {
    ...DEFAULT_URL_MATCH,
    query: presetQueryPolicy(parsed.hostname),
    // A `#/route` fragment is a page, not an in-page jump, so it belongs in the key.
    hash: looksLikeHashRoute(hash) ? 'exact' : 'ignore',
  };
  const urlKey = normalizeUrl(url, match);
  return urlKey === null ? null : { kind: 'url', urlKey, match };
}
