/**
 * The one element we add to the page, and the rules that keep it invisible to the page.
 * Plan section 4.
 *
 * Everything here is load-bearing for the "zero impact on the host page" requirement.
 * Before changing any of it, read the reasoning in the comments -- most of these lines exist
 * because the obvious alternative breaks a real site.
 */

declare const __DEV__: boolean;
declare const __HOST_TAG__: string;

/**
 * Events that must not escape our shadow root into the page's own document listeners.
 *
 * KEYBOARD AND INPUT EVENTS ARE DELIBERATELY ABSENT, and this is the most expensive thing
 * learned building this extension. They used to be here, and the consequence was that
 * **Backspace did nothing inside a note, in Firefox, while typing worked perfectly.**
 *
 * In Gecko the editor's handling of command keys -- Backspace, Delete, Enter, caret movement
 * -- is driven from a listener above the editing host in the propagation path. Our host is a
 * direct child of `<html>`, so stopping propagation there meant those events never reached
 * the editor at all. Text *insertion* travels a different path in Gecko and still landed, which
 * is why the symptom was so lopsided and so confusing: a note you could write in and could not
 * erase in.
 *
 * In Blink the same events are handled at the editing host itself, inside the shadow tree, so
 * the identical code is harmless there -- which is why every test run in a Chromium-based
 * harness passed while the real thing was broken. A structural difference between engines,
 * invisible to the tests that were available.
 *
 * The containment those events were providing is not lost, just moved: `NoteView.onKeyDown`
 * stops propagation itself for the keys it handles as note-level shortcuts, which is precisely
 * the case where the page must not also react. While someone is typing in a note, the
 * keystrokes do reach the page's document listeners with `event.target` retargeted to our
 * host element. That is a real if minor cost -- a page with a bare "/" shortcut could react --
 * and it is unambiguously the better side of the trade against not being able to delete text.
 */
export const CONTAINED_EVENTS = [
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'dblclick',
  'contextmenu',
  'wheel',
  'focusin',
  'focusout',
  'dragstart',
  'touchstart',
  'touchmove',
  'touchend',
] as const;

const HOST_CSS = [
  // The single most important line: neutralises the page's universal resets, inherited
  // font/direction/line-height, `transition: all`, and `!important` blanket rules.
  'all: initial',
  'position: absolute',
  'top: 0',
  'left: 0',
  'width: 0',
  'height: 0',
  'overflow: visible',
  'z-index: 2147483647',
  // Nothing outside a note is clickable, so every uncovered pixel hit-tests to the page.
  'pointer-events: none',
  'isolation: isolate',
  // `style` only. `contain: layout` would make the host a containing block for
  // position:fixed descendants, which silently breaks viewport-pinned notes.
  'contain: style',
  // Stops a page-level dark `color-scheme` from recolouring our form controls.
  'color-scheme: light',
].join(';');

export interface Host {
  /** The host element itself. Needed to tell our own events apart from the page's. */
  readonly rootEl: HTMLElement;
  readonly root: ShadowRoot;
  /** Layer for document-anchored notes: scrolls with the page for free. */
  readonly docLayer: HTMLDivElement;
  /** Layer for viewport-pinned notes. */
  readonly pinLayer: HTMLDivElement;
  /** Is `position: fixed` inside us actually viewport-relative on this page? */
  fixedIsSafe(): boolean;
  destroy(): void;
}

/**
 * `position: fixed` resolves against the nearest ancestor with a transform, filter,
 * perspective, containment or container-type. Attaching to <html> means there is exactly one
 * ancestor to check -- and a transform on <html> is close to nonexistent in the wild, whereas
 * a transform on <body> is routine (page transitions, drawers, translateZ(0) hacks).
 */
export function fixedIsSafe(): boolean {
  const cs = getComputedStyle(document.documentElement);
  return (
    cs.transform === 'none' &&
    cs.perspective === 'none' &&
    cs.filter === 'none' &&
    (cs.backdropFilter === 'none' || cs.backdropFilter === '') &&
    !/paint|layout|strict|content/.test(cs.contain) &&
    !/transform|filter|perspective|contain/.test(cs.willChange) &&
    (cs.containerType === 'normal' || cs.containerType === '')
  );
}

export function createHost(sheet: CSSStyleSheet): Host {
  const el = document.createElement(__HOST_TAG__);
  el.style.cssText = HOST_CSS;

  // Closed: page scripts get `host.shadowRoot === null` and cannot read note text, restyle
  // notes with ::part, or query into our tree. Firefox DevTools still inspects it fine.
  const root = el.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
  root.adoptedStyleSheets = [sheet];

  const docLayer = document.createElement('div');
  docLayer.className = 'lyr lyr-doc';
  const pinLayer = document.createElement('div');
  pinLayer.className = 'lyr lyr-pin';
  root.append(docLayer, pinLayer);

  // Events from a shadow root retarget to the host, so a page's own
  // `document.addEventListener('click', closeMenus)` would fire when the user clicks a note.
  // Stopping propagation ON THE HOST can only ever affect our own events -- never the page's.
  // Never stopImmediatePropagation (we have host-level listeners of our own) and never
  // preventDefault here.
  const stop = (e: Event) => e.stopPropagation();
  for (const type of CONTAINED_EVENTS) el.addEventListener(type, stop);

  document.documentElement.append(el);

  // The only MutationObserver in the renderer. Direct children of <html> change perhaps a
  // handful of times in a page's life, so this is unmeasurable -- and it is what keeps us
  // alive on the rare page that rewrites documentElement's children.
  let reAppends = 0;
  const mo = new MutationObserver(() => {
    if (el.isConnected && document.documentElement.lastElementChild === el) return;
    // Cap it: an aggressive framework that keeps removing us must not become an infinite loop.
    if (reAppends++ >= 5) {
      mo.disconnect();
      if (__DEV__) console.warn('[cn] gave up re-appending the host; the page keeps removing it');
      return;
    }
    document.documentElement.append(el);
  });
  mo.observe(document.documentElement, { childList: true, subtree: false });

  return {
    rootEl: el,
    root,
    docLayer,
    pinLayer,
    fixedIsSafe,
    destroy() {
      mo.disconnect();
      for (const type of CONTAINED_EVENTS) el.removeEventListener(type, stop);
      el.remove();
    },
  };
}
