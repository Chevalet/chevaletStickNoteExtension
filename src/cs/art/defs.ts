/**
 * The one shared <defs> block. Every note on the page references it, which is the whole reason
 * the renderer uses a single shadow root instead of one per note: the halftone tile is defined
 * once and the browser caches its rasterisation for all of them.
 *
 * Built with DOM calls rather than an HTML string on purpose. `innerHTML` on a shadow root
 * works, but AMO reviewers flag every assignment to it, and there is no reason to spend that
 * goodwill on a static fragment that is fifteen lines to construct properly.
 *
 * The halftone is a <pattern> used directly as a `fill`, NOT via a CSS mask. The mask version
 * was tried first and rendered nothing: the CSS `mask` shorthand resets `mask-clip`/
 * `mask-origin` to box values that produce an empty mask region on an SVG element. Filling
 * with the pattern has no such trap, and is one less indirection per note.
 */

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function halftone(id: string, dot: string): SVGPatternElement {
  const p = el('pattern', {
    id,
    patternUnits: 'userSpaceOnUse',
    width: '5',
    height: '5',
  });
  p.append(
    el('circle', { cx: '1.25', cy: '1.25', r: '1', fill: dot }),
    el('circle', { cx: '3.75', cy: '3.75', r: '1', fill: dot }),
  );
  return p;
}

export const HALFTONE_DARK = 'cn-halftone-dark';
export const HALFTONE_LIGHT = 'cn-halftone-light';

export function createSharedDefs(): SVGSVGElement {
  const root = el('svg', {
    class: 'defs',
    width: '0',
    height: '0',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const defs = el('defs', {});
  // Two tiles rather than one recoloured tile: a multiply blend of black dots is invisible on
  // a dark palette, so dark paper gets white dots and a screen blend instead.
  defs.append(halftone(HALFTONE_DARK, '#000'), halftone(HALFTONE_LIGHT, '#fff'));
  root.append(defs);
  return root;
}
