/**
 * chevaletNote spike harness -- in-page probe (R1, R2, R6).
 *
 * Injected on demand into whatever page is being swept. Reports a structured result to the
 * background, which the panel renders as a matrix.
 *
 * Throwaway code: it is allowed to be noisy and to leave a visible marker on the page.
 */
(() => {
  if (window.__cnSpikeProbe) {
    window.__cnSpikeProbe.rerun();
    return;
  }

  const HOST_TAG = 'chevalet-note-spike-root';
  const result = { r2: {}, r6: {}, env: {} };
  let shadow = null;
  let host = null;
  let selectionChangeLeaks = 0;

  const ok = (v) => ({ pass: true, detail: v ?? '' });
  const bad = (e) => ({
    pass: false,
    detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
  });

  // -------------------------------------------------------------------------
  // R6 -- host survival and pass-through
  // -------------------------------------------------------------------------

  function buildHost() {
    document.querySelector(HOST_TAG)?.remove();
    host = document.createElement(HOST_TAG);
    host.style.cssText = [
      'all: initial',
      'position: absolute',
      'top: 0',
      'left: 0',
      'width: 0',
      'height: 0',
      'overflow: visible',
      'z-index: 2147483647',
      'pointer-events: none',
      'isolation: isolate',
      'contain: style',
      'color-scheme: light',
    ].join(';');

    shadow = host.attachShadow({ mode: 'closed' });

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'SPIKE';
    // Deliberately NOT via a stylesheet -- we test stylesheet delivery separately below.
    note.style.cssText = [
      'position: absolute',
      'left: 12px',
      'top: 12px',
      'width: 140px',
      'height: 64px',
      'pointer-events: auto',
      'background: #ffe94a',
      'color: #14110e',
      'font: 700 13px/64px monospace',
      'text-align: center',
      'border: 3px solid #14110e',
      'box-shadow: 6px 6px 0 rgba(0,0,0,.35)',
    ].join(';');
    shadow.append(note);

    document.documentElement.append(host);
  }

  function checkR6() {
    const de = document.documentElement;

    result.r6.hostPresent = de.contains(host) ? ok() : bad('host detached');
    result.r6.hostIsLastChild =
      de.lastElementChild === host ? ok() : bad(`last child is <${de.lastElementChild?.tagName}>`);

    // The single most important non-interference check: a pixel NOT covered by a note must
    // hit-test straight through to the page.
    const uncovered = document.elementFromPoint(
      Math.floor(window.innerWidth * 0.75),
      Math.floor(window.innerHeight * 0.75),
    );
    result.r6.passThrough =
      uncovered && uncovered.tagName.toLowerCase() !== HOST_TAG
        ? ok(`<${uncovered.tagName.toLowerCase()}>`)
        : bad(`got ${uncovered ? uncovered.tagName : 'null'} -- page would be unusable`);

    // ...and a pixel that IS covered must reach us (retargeted to the host).
    // The note sits at document (12,12); elementFromPoint takes VIEWPORT coordinates.
    const covered = document.elementFromPoint(80 - window.scrollX, 44 - window.scrollY);
    result.r6.noteHittable =
      covered && covered.tagName.toLowerCase() === HOST_TAG
        ? ok()
        : bad(`got <${covered ? covered.tagName.toLowerCase() : 'null'}> instead of the host`);

    // Would `position: fixed` inside our host actually be viewport-relative?
    const cs = getComputedStyle(de);
    const blockers = [];
    if (cs.transform !== 'none') blockers.push(`transform:${cs.transform}`);
    if (cs.perspective !== 'none') blockers.push('perspective');
    if (cs.filter !== 'none') blockers.push('filter');
    if (cs.backdropFilter && cs.backdropFilter !== 'none') blockers.push('backdrop-filter');
    if (/paint|layout|strict|content/.test(cs.contain)) blockers.push(`contain:${cs.contain}`);
    if (cs.containerType && cs.containerType !== 'normal') blockers.push('container-type');
    result.r6.fixedIsSafe = blockers.length ? bad(blockers.join(', ')) : ok();

    // Page CSS must not reach inside the shadow root.
    const noteEl = shadow.querySelector('.note');
    const noteCs = getComputedStyle(noteEl);
    result.r6.styleIsolated =
      noteCs.width === '140px' && noteCs.textAlign === 'center'
        ? ok()
        : bad(`width=${noteCs.width} textAlign=${noteCs.textAlign} -- page CSS bled in`);

    result.env.docDir = document.dir || getComputedStyle(document.body || de).direction;
    result.env.csp =
      document.querySelector('meta[http-equiv="Content-Security-Policy" i]')?.content ??
      '(none in a meta tag; may still be set by header)';
    result.env.selectionChangeLeaks = selectionChangeLeaks;
    result.env.plaintextOnly = (() => {
      const d = document.createElement('div');
      d.setAttribute('contenteditable', 'plaintext-only');
      return d.contentEditable === 'plaintext-only' ? 'supported' : `NOT supported (${d.contentEditable})`;
    })();
  }

  // -------------------------------------------------------------------------
  // R2 -- CSP-immune asset delivery
  // -------------------------------------------------------------------------

  async function checkR2() {
    // (a) constructable stylesheet adopted into a closed shadow root
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.probe-adopted { color: rgb(1, 2, 3) }');
      shadow.adoptedStyleSheets = [sheet];
      const el = document.createElement('span');
      el.className = 'probe-adopted';
      shadow.append(el);
      const applied = getComputedStyle(el).color === 'rgb(1, 2, 3)';
      el.remove();
      result.r2.adoptedStyleSheets = applied ? ok() : bad('adopted but rule did not apply');
    } catch (e) {
      result.r2.adoptedStyleSheets = bad(e);
    }

    // (d) plain <style> inside the shadow root -- the fallback if adoption fails
    try {
      const st = document.createElement('style');
      st.textContent = '.probe-inline { color: rgb(4, 5, 6) }';
      shadow.append(st);
      const el = document.createElement('span');
      el.className = 'probe-inline';
      shadow.append(el);
      const applied = getComputedStyle(el).color === 'rgb(4, 5, 6)';
      el.remove();
      st.remove();
      result.r2.shadowStyleTag = applied ? ok() : bad('style tag present but rule did not apply');
    } catch (e) {
      result.r2.shadowStyleTag = bad(e);
    }

    // Fetch our own asset bytes with extension privilege. This must always work; if it does
    // not, nothing else in the "bytes not URLs" strategy can.
    let fontBytes = null;
    let pngBytes = null;
    try {
      const u = browser.runtime.getURL('asset-probe.woff2');
      fontBytes = await (await fetch(u)).arrayBuffer();
      result.r2.fetchExtensionBytes = ok(`${fontBytes.byteLength} B`);
    } catch (e) {
      result.r2.fetchExtensionBytes = bad(e);
    }
    try {
      pngBytes = await (await fetch(browser.runtime.getURL('asset-probe.png'))).arrayBuffer();
    } catch {
      /* reported above */
    }

    // (a) FontFace from bytes, added to the page's FontFaceSet.
    //
    // Three separable outcomes, and the distinction is the whole point of this probe:
    //   constructor throws  -> the API is not reachable from the sandbox
    //   add() throws        -> cross-compartment failure; this is the design-killing one
    //   load() rejects      -> read the error name: SecurityError/CSP vs a parse error.
    //                          A parse error means the PIPELINE WORKS and only the bytes
    //                          were rejected, which is the expected result here because
    //                          asset-probe.woff2 is deliberately not a real font.
    if (fontBytes) {
      let face = null;
      try {
        face = new FontFace('cnSpikeProbe', fontBytes);
        result.r2.fontFaceConstruct = ok();
      } catch (e) {
        result.r2.fontFaceConstruct = bad(e);
      }
      if (face) {
        try {
          document.fonts.add(face);
          result.r2.fontFaceAdd = ok('added to document.fonts across compartments');
          document.fonts.delete(face);
        } catch (e) {
          result.r2.fontFaceAdd = bad(e);
        }
        try {
          await face.load();
          result.r2.fontFaceLoad = ok('loaded (bytes were a real font)');
        } catch (e) {
          const name = e instanceof Error ? e.name : '';
          result.r2.fontFaceLoad =
            name === 'SecurityError'
              ? bad(`CSP blocked the load: ${e.message}`)
              : ok(`rejected as ${name} -- a parse error, NOT a CSP block (expected: the probe bytes are not a font)`);
        }
      }

      // (b) the documented fallback: build the face with the PAGE's own constructor, reached
      // through wrappedJSObject, with the buffer cloned into the page compartment. Only
      // meaningful if (a) failed, but we always measure it so the fallback is known-good.
      try {
        const pageWin = window.wrappedJSObject;
        if (!pageWin) throw new Error('no wrappedJSObject (not a Firefox content script?)');
        const cloned =
          typeof cloneInto === 'function'
            ? cloneInto(fontBytes, pageWin, { cloneFunctions: false })
            : fontBytes;
        const f2 = new pageWin.FontFace('cnSpikeProbeXray', cloned);
        pageWin.document.fonts.add(f2);
        pageWin.document.fonts.delete(f2);
        result.r2.fontFaceViaWindow = ok('page-compartment ctor + cloneInto works');
      } catch (e) {
        result.r2.fontFaceViaWindow = bad(e);
      }
    }

    // (e) the naive approach we are trying to avoid: an <img> pointing at moz-extension://
    result.r2.imgMozExtension = await new Promise((resolve) => {
      const img = new Image();
      const done = (r) => resolve(r);
      img.onload = () => done(ok(`${img.naturalWidth}x${img.naturalHeight}`));
      img.onerror = () => done(bad('blocked or failed -- exactly why we avoid URL-based assets'));
      img.src = browser.runtime.getURL('asset-probe.png');
      setTimeout(() => done(bad('timed out')), 3000);
    });

    // (f) the CSP-immune raster path: bytes -> ImageBitmap -> canvas
    if (pngBytes) {
      try {
        const bmp = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        result.r2.imageBitmapToCanvas = ok(`${bmp.width}x${bmp.height} painted`);
      } catch (e) {
        result.r2.imageBitmapToCanvas = bad(e);
      }
    }
  }

  // -------------------------------------------------------------------------
  // R1 -- the close guard
  // -------------------------------------------------------------------------

  let armed = false;
  const onBeforeUnload = (e) => {
    e.preventDefault();
    e.returnValue = '';
    browser.runtime.sendMessage({
      t: 'log',
      event: 'beforeunload.fired',
      data: { url: location.href, armedFromContentScript: true },
    });
  };

  function setGuard(next) {
    if (next === armed) return;
    armed = next;
    if (armed) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
    const badge = shadow?.querySelector('.note');
    if (badge) {
      badge.textContent = armed ? 'GUARD ON' : 'SPIKE';
      badge.style.background = armed ? '#ff3d7f' : '#ffe94a';
    }
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.t === 'guard') {
      setGuard(Boolean(msg.armed));
      return Promise.resolve({ ok: true, armed });
    }
    return undefined;
  });

  // Count how much our shadow-DOM editing would leak to a page listening on `document`.
  document.addEventListener('selectionchange', () => {
    selectionChangeLeaks++;
  });

  // -------------------------------------------------------------------------

  async function run() {
    buildHost();
    checkR6();
    await checkR2();
    // Re-check survival after the page has had a moment to react to our node.
    await new Promise((r) => setTimeout(r, 1500));
    const de = document.documentElement;
    result.r6.hostSurvives1500ms = de.contains(host) ? ok() : bad('page removed the host');
    result.env.selectionChangeLeaks = selectionChangeLeaks;

    await browser.runtime.sendMessage({
      t: 'probe-result',
      origin: location.origin === 'null' ? location.href : location.origin,
      result: { ...result, url: location.href },
    });
  }

  window.__cnSpikeProbe = { rerun: run, setGuard };
  run();
})();
