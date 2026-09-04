/**
 * Telling you when there is a newer version.
 *
 * What Firefox will and will not do for us, plainly:
 *
 *   - **Listed on AMO** — Firefox updates the extension itself, silently, on its own schedule.
 *     Nothing in this file is needed. That is the destination.
 *   - **Self-hosted** — `browser_specific_settings.gecko.update_url` can point at an update
 *     manifest and Firefox will poll it, but only for an XPI that AMO has *signed* (unlisted
 *     signing counts). An unsigned build cannot self-update by any route; that is Firefox's
 *     rule and no amount of code here changes it.
 *   - **Neither yet** — which is where this build is. So the honest thing an extension can do
 *     is *look*, and tell you, and hand you the link.
 *
 * That is what this does: it asks the releases API what the newest tag is and compares it with
 * the running version. It is off unless asked for, because a background network call is a
 * change to the privacy story of an extension whose whole point is that it never talks to
 * anything. The host permission is optional and requested at the moment of the first check,
 * so someone who never presses the button never grants it.
 */

/** Where releases are published. Not configurable: a settable update endpoint is a backdoor. */
export const RELEASES_API =
  'https://api.github.com/repos/Chevalet/chevaletStickNoteExtension/releases/latest';
export const RELEASES_PAGE =
  'https://github.com/Chevalet/chevaletStickNoteExtension/releases/latest';
export const API_ORIGIN = 'https://api.github.com/*';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  /** Where to get it. Always the releases page, never a URL the response chose. */
  url: string;
  checkedAt: number;
  /** Present when the check could not complete. */
  error?: string;
}

/**
 * Compare two dotted versions.
 *
 * Deliberately not a full semver implementation: these are our own tags, they are numeric, and
 * a dependency to compare `0.0.2` with `0.0.1` would be absurd. A missing segment counts as 0,
 * so `0.1` and `0.1.0` are the same version. Anything non-numeric makes the comparison
 * conservative -- it reports "not newer" rather than nagging about a version it cannot read.
 */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string): number[] | null => {
    const cleaned = v.trim().replace(/^v/i, '');
    if (!/^\d+(\.\d+)*$/.test(cleaned)) return null;
    return cleaned.split('.').map(Number);
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Pull the version out of a releases payload, tolerating whatever else it contains. */
export function versionFromRelease(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const raw = typeof p.tag_name === 'string' ? p.tag_name : p.name;
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/^v/i, '');
  return /^\d+(\.\d+)*$/.test(cleaned) ? cleaned : null;
}

/** True when we already hold the permission the check needs. */
export function hasApiPermission(): Promise<boolean> {
  return browser.permissions.contains({ origins: [API_ORIGIN] }).catch(() => false);
}

export interface CheckOptions {
  current: string;
  /** Only a click can request a permission, so an alarm-driven check passes false. */
  mayRequestPermission: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * Ask what the latest release is.
 *
 * Never throws: a failed check reports itself in `error` and is otherwise a no-op. An update
 * checker that can break the options page by being offline is worse than no update checker.
 */
export async function checkForUpdate(opts: CheckOptions): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    current: opts.current,
    latest: null,
    newer: false,
    url: RELEASES_PAGE,
    checkedAt: Date.now(),
  };

  let granted = await hasApiPermission();
  if (!granted && opts.mayRequestPermission) {
    granted = await browser.permissions.request({ origins: [API_ORIGIN] }).catch(() => false);
  }
  if (!granted) return { ...base, error: 'no-permission' };

  try {
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(RELEASES_API, {
      // No credentials, no cookies, no referrer: this call says nothing about who is asking.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { ...base, error: `http-${res.status}` };
    const latest = versionFromRelease(await res.json());
    if (!latest) return { ...base, error: 'unreadable' };
    return { ...base, latest, newer: isNewer(latest, opts.current) };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.name : 'failed' };
  }
}

export const UPDATE_ALARM = 'cn-update-check';
/** Daily. Anything more often is nagging, and this is a sticky-note extension. */
export const UPDATE_PERIOD_MINUTES = 60 * 24;
