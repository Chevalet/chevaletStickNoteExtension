/**
 * The close guard. Registered at `document_start`, budgeted at 1 kB gzipped, and deliberately
 * separate from the renderer so it can exist before the page has finished loading.
 *
 * Plan section 8. What this file can and cannot do:
 *
 *   CAN     ask Firefox to show its own "Leave page?" dialog, by calling preventDefault()
 *           inside a `beforeunload` listener.
 *   CANNOT  cancel a close from the background, customise the dialog text, prompt without
 *           sticky activation, prompt on a discarded tab, or survive `tabs.remove()`.
 *
 * The listener is added and removed on demand rather than left attached: a permanently
 * registered `beforeunload` makes a page ineligible for the bfcache, which would slow
 * back/forward navigation on exactly the pages the user has bothered to annotate.
 */

declare const __DEV__: boolean;

let armed = false;

function onBeforeUnload(e: BeforeUnloadEvent): void {
  // Both forms: preventDefault() is the modern spec, returnValue is what older Gecko honours.
  e.preventDefault();
  e.returnValue = '';
}

function setArmed(next: boolean): void {
  if (next === armed) return;
  armed = next;
  if (armed) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
  if (__DEV__) console.warn(`[cn guard] ${armed ? 'armed' : 'disarmed'} on ${location.href}`);
}

browser.runtime.onMessage.addListener((msg: unknown) => {
  if (typeof msg === 'object' && msg !== null && (msg as { t?: string }).t === 'guard/set') {
    setArmed(Boolean((msg as { armed?: boolean }).armed));
    return Promise.resolve({ ok: true, armed });
  }
  return undefined;
});

// The guard is disarmed on entering the bfcache. If the page comes back, the background
// re-arms it as part of re-establishing context -- we deliberately do not remember state
// across a bfcache round trip, because the note may have been committed in the meantime.
window.addEventListener('pagehide', (e) => {
  if (e.persisted) setArmed(false);
});
