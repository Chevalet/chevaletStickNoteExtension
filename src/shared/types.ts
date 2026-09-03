/** Shared vocabulary. Imported by all four contexts (bg, cs, popup, manager). */

export type NoteId = `n_${string}`;
export type TabKey = `tk_${string}`;
export type AssetId = `a_${string}`;

/** A normalized URL key. Produced only by `normalizeUrl`. Never build one by hand. */
export type UrlKey = string & { readonly __brand: 'UrlKey' };

/** How much of a URL counts as "the same page" for a given note. */
export interface UrlMatch {
  /**
   * `ignore`       - drop the query entirely
   * `dropTracking` - remove known tracking params, sort the rest (default)
   * `exact`        - keep everything, sorted
   * `{keep}`       - whitelist, sorted. This is how youtube.com/watch?v=X works.
   */
  query: 'ignore' | 'exact' | 'dropTracking' | { keep: string[] };
  /** `exact` matters for `#/`-style hash routers. */
  hash: 'ignore' | 'exact';
  /** `any` treats http and https as the same page (the usual intent). */
  scheme: 'any' | 'exact';
  /** `strip` treats example.com and www.example.com as the same host. */
  www: 'strip' | 'exact';
}

export const DEFAULT_URL_MATCH: Readonly<UrlMatch> = Object.freeze({
  query: 'dropTracking',
  hash: 'ignore',
  scheme: 'any',
  www: 'strip',
});

export type Scope =
  | { kind: 'url'; urlKey: UrlKey; match: UrlMatch }
  | { kind: 'prefix'; origin: string; pathPrefix: string }
  | { kind: 'domain'; registrable: string; includeSubdomains: boolean }
  | { kind: 'tab'; tabKey: TabKey }
  | { kind: 'global' };

export type ScopeKind = Scope['kind'];
export type NoteState = 'active' | 'trashed' | 'quarantined';
