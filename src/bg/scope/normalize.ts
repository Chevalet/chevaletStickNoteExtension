/**
 * URL normalization. Pure, synchronous, dependency-free -- and the single most consequential
 * file in the codebase: every stored note is keyed by what this returns, so changing its
 * behaviour is a data migration, not a bug fix. Treat the test table in
 * tests/normalize.test.ts as the specification.
 *
 * See plan section 3.
 */
import { DEFAULT_URL_MATCH, type UrlKey, type UrlMatch } from '~/shared/types.ts';

/** Schemes we can never inject into, and therefore can never hold a note. */
const UNNOTEABLE_SCHEMES = new Set([
  'about:',
  'moz-extension:',
  'chrome:',
  'resource:',
  'view-source:',
  'data:',
  'blob:',
  'javascript:',
  'ws:',
  'wss:',
]);

/**
 * Tracking parameters stripped under the default `dropTracking` policy. Removing these is
 * what makes a link shared from Twitter and the same link typed by hand the same page.
 */
const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'ml_subscriber',
  'ml_subscriber_hash',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'hsCtaTracking',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'wickedid',
  's_kwcid',
  'ef_id',
  'campaign_id',
  'ref_src',
  'ref_url',
  'spm',
  'scm',
  'share_source',
  'share_medium',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'piwik_', 'matomo_', 'hsa_', 'at_'];

/** Per-site query whitelists, so the obvious cases work without the user configuring anything. */
const SITE_QUERY_PRESETS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/(^|\.)youtube\.com$/, ['v', 'list']],
  [/(^|\.)youtu\.be$/, []],
  [/(^|\.)google\.[a-z.]+$/, ['q', 'tbm']],
  [/(^|\.)bing\.com$/, ['q']],
  [/(^|\.)duckduckgo\.com$/, ['q']],
  [/(^|\.)amazon\.[a-z.]+$/, ['node']],
  [/(^|\.)stackoverflow\.com$/, []],
  [/(^|\.)reddit\.com$/, []],
  [/(^|\.)aparat\.com$/, []],
  [/(^|\.)digikala\.com$/, []],
];

const UNRESERVED = /%(2D|2E|5F|7E|3[0-9]|4[1-9A-F]|5[0-9A]|6[1-9A-F]|7[0-9A])/gi;

/** Decode only RFC 3986 unreserved characters, so `%7E` and `~` key the same page. */
function decodeUnreserved(s: string): string {
  return s.replace(UNRESERVED, (m) => String.fromCharCode(Number.parseInt(m.slice(1), 16)));
}

/**
 * 64-bit FNV-1a as hex. Used only to fold absurdly long URLs down to a bounded key, where a
 * non-cryptographic hash is entirely adequate and keeps this function synchronous.
 */
function fnv1a64(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h = BigInt.asUintN(64, (h ^ BigInt(s.charCodeAt(i))) * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

function isTracking(key: string): boolean {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/** The default query policy for a host, before any per-note override. */
export function presetQueryPolicy(hostname: string): UrlMatch['query'] {
  const host = hostname.toLowerCase();
  for (const [re, keep] of SITE_QUERY_PRESETS) {
    if (re.test(host)) return { keep: [...keep] };
  }
  return 'dropTracking';
}

/** A `#/`-style fragment is a route, not an in-page jump, so it belongs in the key. */
export function looksLikeHashRoute(hash: string): boolean {
  return /^#!?\//.test(hash);
}

const MAX_KEY_LEN = 2048;
const FOLD_AT = 1024;

export interface NormalizeResult {
  key: UrlKey;
  origin: string;
  hostname: string;
  pathname: string;
}

/**
 * Normalize a URL into a stable note key.
 * Returns `null` for anything that cannot hold a note (about:, data:, malformed input).
 */
export function normalizeUrlFull(
  raw: string,
  match: UrlMatch = DEFAULT_URL_MATCH,
): NormalizeResult | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  if (UNNOTEABLE_SCHEMES.has(u.protocol)) return null;

  // `file:` has no host and its path is the whole identity -- and it is case-sensitive on
  // every platform we care about, so it skips the host rules entirely.
  if (u.protocol === 'file:') {
    const path = decodeUnreserved(u.pathname).replace(/\/{2,}/g, '/');
    const hash = match.hash === 'exact' ? u.hash : '';
    return {
      key: fold(`file://${path}${hash}`),
      origin: 'file://',
      hostname: '',
      pathname: path,
    };
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  let host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (match.www === 'strip' && host.startsWith('www.')) host = host.slice(4);

  const isDefaultPort =
    !u.port ||
    (u.protocol === 'https:' && u.port === '443') ||
    (u.protocol === 'http:' && u.port === '80');
  const authority = isDefaultPort ? host : `${host}:${u.port}`;

  const schemePart = match.scheme === 'any' ? '//' : `${u.protocol}//`;

  let path = decodeUnreserved(u.pathname).replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const query = buildQuery(u, match.query);
  const hash = match.hash === 'exact' ? decodeUnreserved(u.hash) : '';

  return {
    key: fold(`${schemePart}${authority}${path}${query}${hash}`),
    origin: `${u.protocol}//${u.host}`,
    hostname: host,
    pathname: path,
  };
}

/** Convenience wrapper: just the key. */
export function normalizeUrl(raw: string, match: UrlMatch = DEFAULT_URL_MATCH): UrlKey | null {
  return normalizeUrlFull(raw, match)?.key ?? null;
}

function buildQuery(u: URL, policy: UrlMatch['query']): string {
  if (policy === 'ignore') return '';

  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (typeof policy === 'object') {
      if (policy.keep.includes(k)) kept.push([k, v]);
    } else if (policy === 'exact' || !isTracking(k)) {
      kept.push([k, v]);
    }
  }
  if (kept.length === 0) return '';

  // Sorting is what makes ?a=1&b=2 and ?b=2&a=1 the same page. Ties on key keep value order.
  kept.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  return `?${kept.map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&')}`;
}

function fold(key: string): UrlKey {
  if (key.length <= MAX_KEY_LEN) return key as UrlKey;
  return `${key.slice(0, FOLD_AT)}\u0001${fnv1a64(key)}` as UrlKey;
}
