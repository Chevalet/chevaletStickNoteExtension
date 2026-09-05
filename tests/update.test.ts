import { describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  isNewer,
  RELEASES_API,
  RELEASES_PAGE,
  versionFromRelease,
} from '~/bg/jobs/update.ts';

/**
 * An update checker that gets a comparison wrong either nags forever about a version you
 * already have, or stays silent about one you need. Both are worse than no checker, so the
 * comparison is tested exhaustively and the network path is tested for never throwing.
 */

describe('isNewer', () => {
  it.each([
    ['0.0.2', '0.0.1', true],
    ['0.1.0', '0.0.9', true],
    ['1.0.0', '0.9.9', true],
    ['0.0.10', '0.0.9', true],
    ['0.10.0', '0.9.0', true],
  ])('%s is newer than %s', (a, b, expected) => {
    expect(isNewer(a, b)).toBe(expected);
  });

  it.each([
    ['0.0.1', '0.0.1'],
    ['0.0.1', '0.0.2'],
    ['0.9.9', '1.0.0'],
    ['0.0.9', '0.0.10'],
  ])('%s is not newer than %s', (a, b) => {
    expect(isNewer(a, b)).toBe(false);
  });

  /** String comparison would say "0.0.10" < "0.0.9". This is the whole reason for the parse. */
  it('compares numerically, not lexically', () => {
    expect(isNewer('0.0.10', '0.0.9')).toBe(true);
    expect('0.0.10' < '0.0.9').toBe(true);
  });

  it('treats a missing segment as zero', () => {
    expect(isNewer('0.1', '0.1.0')).toBe(false);
    expect(isNewer('0.1.1', '0.1')).toBe(true);
  });

  it('accepts a leading v, because tags carry one', () => {
    expect(isNewer('v0.0.2', '0.0.1')).toBe(true);
    expect(isNewer('V0.0.2', 'v0.0.1')).toBe(true);
  });

  /** Conservative on junk: never nag about a version we cannot read. */
  it.each([
    ['nightly', '0.0.1'],
    ['0.0.2-beta', '0.0.1'],
    ['', '0.0.1'],
    ['0.0.2', 'unknown'],
    ['../../etc', '0.0.1'],
  ])('says no for unreadable input (%j vs %j)', (a, b) => {
    expect(isNewer(a, b)).toBe(false);
  });
});

describe('versionFromRelease', () => {
  it('prefers the tag', () => {
    expect(versionFromRelease({ tag_name: 'v0.0.2', name: 'something else' })).toBe('0.0.2');
  });

  it('falls back to the name', () => {
    expect(versionFromRelease({ name: '0.0.3' })).toBe('0.0.3');
  });

  it('returns null for anything it cannot read', () => {
    for (const junk of [null, undefined, 'string', 42, [], {}, { tag_name: 'nightly' }]) {
      expect(versionFromRelease(junk)).toBeNull();
    }
  });

  /** The payload is remote content; nothing in it may become a version we act on blindly. */
  it('refuses a tag that is not purely numeric', () => {
    expect(versionFromRelease({ tag_name: '9999.0.0; rm -rf /' })).toBeNull();
    expect(versionFromRelease({ tag_name: '<script>' })).toBeNull();
  });
});

describe('checkForUpdate', () => {
  type PermissionStub = {
    permissions: {
      contains: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
    };
  };
  const withPermission = (granted: boolean, request = granted): PermissionStub => {
    const stub: PermissionStub = {
      permissions: {
        contains: vi.fn(async () => granted),
        request: vi.fn(async () => request),
      },
    };
    (globalThis as unknown as { browser: PermissionStub }).browser = stub;
    return stub;
  };

  it('NEVER asks for the permission itself, however it was called', async () => {
    /*
     * The bug that made the button stick on "Checking...". This function used to call
     * `permissions.request()` when the caller passed a flag saying the check came from a
     * click -- on the belief that the flag carried the user gesture across the message from
     * the options page. It does not: activation does not travel with a message, and Firefox
     * answers a request without it by never settling the promise. So the background never
     * replied.
     *
     * There is no flag any more. The page asks, in its own click handler, before sending.
     */
    const stub = withPermission(false);
    const out = await checkForUpdate({ current: '0.0.1' });
    expect(out.error).toBe('no-permission');
    expect(out.newer).toBe(false);
    expect(stub.permissions.request).not.toHaveBeenCalled();
  });

  it('checks once the page has been granted the permission', async () => {
    withPermission(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.0.5' }),
    })) as unknown as typeof fetch;
    const out = await checkForUpdate({ current: '0.0.1', fetchImpl });
    expect(out.latest).toBe('0.0.5');
    expect(out.newer).toBe(true);
  });

  it('does not touch the network when it has not been granted', async () => {
    // A grantable-but-ungranted permission is still ungranted here: the answer is to report
    // it and let the page ask, not to reach for the network and fail.
    withPermission(false, true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.0.5' }),
    })) as unknown as typeof fetch;
    const out = await checkForUpdate({ current: '0.0.1', fetchImpl });
    expect(out.error).toBe('no-permission');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('finds a newer version and always points at the releases page', async () => {
    withPermission(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      // A hostile payload cannot redirect the download anywhere.
      json: async () => ({ tag_name: '0.9.0', html_url: 'https://evil.test/malware.xpi' }),
    })) as unknown as typeof fetch;
    const out = await checkForUpdate({ current: '0.0.1', fetchImpl });
    expect(out.newer).toBe(true);
    expect(out.url).toBe(RELEASES_PAGE);
    expect(out.url).not.toContain('evil');
  });

  it('says nothing is newer when we are current', async () => {
    withPermission(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: 'v0.0.2' }),
    })) as unknown as typeof fetch;
    const out = await checkForUpdate({ current: '0.0.2', fetchImpl });
    expect(out.newer).toBe(false);
    expect(out.error).toBeUndefined();
  });

  it('sends no credentials and no referrer', async () => {
    withPermission(true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: '0.0.1' }),
    })) as unknown as typeof fetch;
    await checkForUpdate({ current: '0.0.1', fetchImpl });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(RELEASES_API);
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  /** Being offline must never break the page that hosts the button. */
  it.each([
    ['a rejected fetch', () => Promise.reject(new TypeError('offline'))],
    ['an http error', async () => ({ ok: false, status: 503, json: async () => ({}) })],
    ['unreadable json', async () => ({ ok: true, status: 200, json: async () => ({}) })],
    [
      'json that throws',
      async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad');
        },
      }),
    ],
  ])('never throws on %s', async (_label, impl) => {
    withPermission(true);
    const out = await checkForUpdate({
      current: '0.0.1',
      fetchImpl: impl as unknown as typeof fetch,
    });
    expect(out.error).toBeTruthy();
    expect(out.newer).toBe(false);
    expect(out.current).toBe('0.0.1');
  });
});
