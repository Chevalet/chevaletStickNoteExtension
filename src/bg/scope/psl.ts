/**
 * Registrable-domain extraction.
 *
 * We deliberately do NOT bundle the full Public Suffix List. It is ~35kB even minified, and
 * the background event page parses its whole bundle on every wake (dozens of times a minute),
 * so the plan's 80kB background budget cannot absorb it.
 *
 * Instead: a curated list of multi-label public suffixes covering the cases a browsing human
 * actually hits. The failure mode is benign and visible -- a `domain`-scoped note on an
 * unusual suffix ends up slightly wider or narrower than intended, and the note's own scope
 * badge shows exactly what it matched, so the user can correct it.
 *
 * Only the `domain` scope depends on this. `url` (the default) and `prefix` do not.
 */

/** Second-level suffixes: a host of `x.<sld>.<tld>` is registrable at `x.<sld>.<tld>`. */
const MULTI_LABEL_SUFFIXES = new Set([
  // generic second levels, used under many ccTLDs
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'mil',
  'net',
  'org',
  'or',
  'ne',
  'go',
  'in',
  'gen',
  'ltd',
  'plc',
  'sch',
  'nom',
  'info',
  'biz',
  'name',
  'web',
  'firm',
  'store',
  'pro',
  'int',
  'gob',
  'gouv',
  'priv',
  'idv',
  'lg',
  'me',
]);

/** ccTLDs that actually use the second level above. Guards against eating `foo.co` etc. */
const CC_TLDS_WITH_SLD = new Set([
  'ae',
  'ar',
  'at',
  'au',
  'az',
  'bd',
  'bh',
  'bn',
  'br',
  'bt',
  'cn',
  'co',
  'cr',
  'cy',
  'do',
  'ec',
  'eg',
  'es',
  'et',
  'fj',
  'ge',
  'gh',
  'gt',
  'hk',
  'id',
  'il',
  'im',
  'in',
  'iq',
  'ir',
  'jo',
  'jp',
  'ke',
  'kh',
  'kr',
  'kw',
  'lb',
  'lk',
  'ls',
  'ly',
  'ma',
  'mk',
  'mt',
  'mx',
  'my',
  'mz',
  'na',
  'ng',
  'ni',
  'np',
  'nz',
  'om',
  'pa',
  'pe',
  'ph',
  'pk',
  'pl',
  'pr',
  'ps',
  'py',
  'qa',
  'sa',
  'sb',
  'sg',
  'sv',
  'sy',
  'th',
  'tn',
  'tr',
  'tt',
  'tw',
  'tz',
  'ua',
  'ug',
  'uk',
  'uy',
  've',
  'vn',
  'za',
  'zm',
  'zw',
]);

/** Fixed multi-label suffixes that don't follow the generic pattern above. */
const EXPLICIT_SUFFIXES = new Set([
  'github.io',
  'gitlab.io',
  'netlify.app',
  'vercel.app',
  'pages.dev',
  'workers.dev',
  'herokuapp.com',
  'firebaseapp.com',
  'web.app',
  'appspot.com',
  'blogspot.com',
  's3.amazonaws.com',
  'cloudfront.net',
  'azurewebsites.net',
  'sharepoint.com',
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Best-effort registrable domain ("example.co.uk" from "www.shop.example.co.uk").
 * Returns the host unchanged for IPs, single-label hosts, and anything it cannot classify.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || IPV4.test(host) || host.includes(':')) return host;

  const labels = host.split('.');
  if (labels.length <= 2) return host;

  for (let take = 3; take <= Math.min(4, labels.length); take++) {
    if (EXPLICIT_SUFFIXES.has(labels.slice(-(take - 1)).join('.'))) {
      return labels.slice(-take).join('.');
    }
  }

  const tld = labels.at(-1) as string;
  const sld = labels.at(-2) as string;
  if (CC_TLDS_WITH_SLD.has(tld) && MULTI_LABEL_SUFFIXES.has(sld)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}
