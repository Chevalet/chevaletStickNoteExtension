/**
 * Getting the content script onto the page.
 *
 * There are no `content_scripts` in the manifest, and that is the single most important
 * decision in this file's neighbourhood. A static declaration for every http and https origin means:
 *
 *   - Firefox MV3 shows "Access your data for all websites" at install time, which is the
 *     permission prompt most likely to make someone cancel;
 *   - and every page load on the web pays to parse the renderer, whether or not it has notes.
 *
 * Instead the renderer is registered at run time, for the origins the user has actually
 * granted, with `persistAcrossSessions` so the registration survives a browser restart
 * without the event page having to wake up to re-create it.
 *
 * `document_idle` is deliberate. The handshake needs no layout and the notes are positioned
 * from stored coordinates re-checked against the anchor, so nothing is gained by racing the
 * page's own scripts -- and a content script that runs at `document_start` on every granted
 * origin is a content script that shows up in someone's performance profile.
 */

const RENDERER_ID = 'cn-renderer';
const GUARD_ID = 'cn-guard';

/** Every origin pattern the user has granted us. */
async function grantedOrigins(): Promise<string[]> {
  const all = await browser.permissions.getAll().catch(() => null);
  return (all?.origins ?? []).filter((o) => typeof o === 'string' && o.length > 0);
}

/**
 * Register (or re-register) the content scripts for the granted origins.
 *
 * Idempotent: unregistering first is the only reliable way to change the match list, since
 * `updateContentScripts` throws when the id is not already registered and `register` throws
 * when it is.
 */
export async function syncRegistrations(): Promise<{ origins: string[]; registered: boolean }> {
  const origins = await grantedOrigins();

  // No `scripting` API means an older Firefox than we claim to support; fail quietly rather
  // than throwing out of a lifecycle handler and leaving the event page in a bad state.
  if (!browser.scripting?.registerContentScripts) return { origins, registered: false };

  await unregister([RENDERER_ID, GUARD_ID]);
  if (origins.length === 0) return { origins, registered: false };

  try {
    await browser.scripting.registerContentScripts([
      {
        id: GUARD_ID,
        matches: origins,
        js: ['cs/guard.js'],
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true,
      },
      {
        id: RENDERER_ID,
        matches: origins,
        js: ['cs/renderer.js'],
        runAt: 'document_idle',
        // Notes belong to a page, not to each of its iframes. Registering in every frame
        // would render a note once per frame on a page full of embeds.
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    return { origins, registered: true };
  } catch {
    return { origins, registered: false };
  }
}

async function unregister(ids: string[]): Promise<void> {
  // Only ask for ids that exist: `unregisterContentScripts` rejects the whole call for one
  // unknown id, which would leave a stale registration in place.
  const existing = await browser.scripting
    .getRegisteredContentScripts()
    .catch((): browser.scripting.RegisteredContentScript[] => []);
  const present = ids.filter((id) => existing.some((s) => s.id === id));
  if (present.length === 0) return;
  await browser.scripting.unregisterContentScripts({ ids: present }).catch(() => undefined);
}

/**
 * Inject into a tab that is already open.
 *
 * Registration only affects future navigations, so without this a permission granted from the
 * popup would appear to do nothing until the page was reloaded -- which reads as a bug, and
 * would have people reloading pages to find out whether the extension works.
 */
export async function injectNow(tabId: number): Promise<boolean> {
  if (!browser.scripting?.executeScript) return false;
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['cs/renderer.js'],
    });
    return true;
  } catch {
    // Not granted for this tab, a privileged page, or the tab went away. All ordinary.
    return false;
  }
}

/** True when we may act on this tab at all. */
export async function mayAccess(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return false;
    return await browser.permissions.contains({ origins: [`${u.origin}/*`] }).catch(() => false);
  } catch {
    return false;
  }
}
