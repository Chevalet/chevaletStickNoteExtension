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
 * Keyboard and input events belong here and are safe here. 0.0.3 removed them, on a theory
 * that they were what stopped Backspace working in Firefox. They were not, and the theory was
 * only ever a theory -- `spikes/firefox-backspace.mjs` drives a real Firefox through a host
 * that contains every one of these events and Backspace deletes correctly. The actual cause
 * was where the host was attached; see the long note further down.
 *
 * Keeping them contained is worth something real: without it a page's own
 * `document.addEventListener('keydown', ...)` fires while someone types in a note, so a site
 * with a bare "/" or "j/k" shortcut would react to note text. Events from a shadow root
 * retarget to the host, so stopping propagation here can only ever affect our own events and
 * never the page's.
 *
 * Never `stopImmediatePropagation` (we have host-level listeners of our own) and never
 * `preventDefault`.
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
  'keydown',
  'keyup',
  'keypress',
  'wheel',
  'input',
  'beforeinput',
  'compositionstart',
  'compositionend',
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

  /**
   * THE HOST MUST LIVE INSIDE `<body>`.
   *
   * This used to append to `document.documentElement` -- a sibling of `<body>`, outside it --
   * on the reasoning that a child of `<html>` is the hardest place for a page to disturb.
   * That one line is why **Backspace did nothing inside a note in Firefox** through three
   * releases.
   *
   * Gecko will not perform an editing command for an editing host that sits outside `<body>`.
   * It dispatches `beforeinput` with `deleteContentBackward`, does not cancel it, and then
   * simply declines to edit -- no `input` event, no change, no error. Text *insertion* takes a
   * different path and kept working, which is what made the symptom so lopsided: a note you
   * could write in and could not erase in.
   *
   * Measured, not deduced. `spikes/firefox-where.mjs` drives a real Firefox through four
   * hosts that differ only in position and tag name:
   *
   *     host = <div> inside <body>              DELETES
   *     host = custom tag inside <body>         DELETES
   *     host = <div> on <html>                  NOTHING
   *     host = custom tag on <html>             NOTHING
   *
   * The tag name is irrelevant. The position is everything. Every other suspect was eliminated
   * the same way first: the closed root, `all: initial`, `pointer-events: none`,
   * `contain: style`, `plaintext-only`, ancestor transforms, the adopted stylesheet, four
   * levels of nesting, and stopping keyboard events at the host -- all innocent
   * (`spikes/firefox-backspace.mjs`, `spikes/firefox-bisect.mjs`).
   *
   * Do not move this back to `documentElement`.
   */
  const parent = (): HTMLElement => document.body ?? document.documentElement;
  parent().append(el);

  /**
   * The only MutationObserver in the renderer.
   *
   * It watches `<body>`'s children so we survive a framework that clears them, and
   * `<html>`'s children so we survive the rarer page that replaces `document.body` outright.
   * Both change a handful of times in a page's life, so the cost is unmeasurable.
   */
  let reAppends = 0;
  const mo = new MutationObserver(() => {
    const want = parent();
    if (el.isConnected && el.parentElement === want) return;
    // Cap it: an aggressive framework that keeps removing us must not become an infinite loop.
    if (reAppends++ >= 5) {
      mo.disconnect();
      if (__DEV__) console.warn('[cn] gave up re-appending the host; the page keeps removing it');
      return;
    }
    want.append(el);
  });
  mo.observe(document.documentElement, { childList: true, subtree: false });
  if (document.body) mo.observe(document.body, { childList: true, subtree: false });

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
