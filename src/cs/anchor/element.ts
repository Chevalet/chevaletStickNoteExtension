/**
 * Element anchoring: the cheap first guess.
 *
 * A structural path is fast and exact when the page has not changed, and wrong the moment a
 * list re-orders or an ad slot appears. So it is tried first (one `getElementById` beats a
 * text walk by orders of magnitude) but never trusted on its own -- the text tier is what
 * catches it when it is wrong.
 */

import type { ElementAnchor, PathSegment } from './types.ts';

/** Attributes a site author chose deliberately, in the order we trust them. */
const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-qa', 'data-cy', 'itemprop'] as const;

const MAX_DEPTH = 12;
/** Below this an element is too small to be a meaningful anchor for a note. */
const MIN_ANCHOR_W = 120;
const MIN_ANCHOR_H = 40;

/**
 * Does this id look like something a human wrote, or like framework output?
 *
 * React, Vue and friends emit ids like `:r3:`, `radix-42`, `mui-1734`, and raw uuids. Anchoring
 * to one of those is worse than not anchoring at all, because it looks certain and is not.
 */
export function looksStable(id: string): boolean {
  if (!id || id.length > 64) return false;
  if (/^[0-9]+$/.test(id)) return false;
  if (/^:.*:$/.test(id)) return false; // React useId
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return false; // uuid
  if (/^(radix|mui|headlessui|mantine|chakra|ember|ext-gen|yui)[-_]?\d+/i.test(id)) return false;
  if (/\d{4,}/.test(id)) return false; // long digit runs are almost always generated
  return true;
}

/**
 * How much to trust an id.
 *
 * `comment_42_body` is a perfectly stable id for comment 42 -- but `item_3` might be a
 * position rather than an identity, and after a re-order it would point confidently at the
 * wrong thing. There is no way to tell the two apart from the string, so any id containing
 * digits is worth a little less, which lets the text tier out-score it when they disagree.
 */
export function idConfidence(id: string): number {
  return /\d/.test(id) ? 0.88 : 0.98;
}

function nthOfType(el: Element): number {
  let n = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (s.tagName === el.tagName) n++;
  }
  return n;
}

/** A structural path from the document root, capped so a deep tree does not produce a novel. */
export function capturePath(el: Element): PathSegment[] {
  const path: PathSegment[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && path.length < MAX_DEPTH) {
    path.unshift({ tag: node.tagName.toLowerCase(), nth: nthOfType(node) });
    const parent: ParentNode | null = node.parentNode;
    if (parent instanceof ShadowRoot) {
      // Crossing a shadow boundary. Closed roots are unreachable, so such anchors will
      // degrade to the text tier -- which is exactly the right outcome.
      const host: Element = parent.host;
      path.unshift({ tag: host.tagName.toLowerCase(), nth: nthOfType(host), shadow: true });
      node = host;
    } else {
      node = node.parentElement;
    }
  }
  return path;
}

export function resolvePath(path: PathSegment[]): Element | null {
  let scope: ParentNode = document.documentElement;
  for (const seg of path) {
    const candidates = [...scope.children].filter((c) => c.tagName.toLowerCase() === seg.tag);
    const found = candidates[seg.nth - 1];
    if (!found) return null;
    if (seg.shadow) {
      if (!found.shadowRoot) return null; // closed root: give up, let the text tier answer
      scope = found.shadowRoot;
    } else {
      scope = found;
    }
  }
  return scope instanceof Element ? scope : null;
}

/**
 * Pick something worth anchoring to at a point.
 *
 * Walks up from the deepest element until it finds a block big enough to still be meaningful
 * after the page reflows -- anchoring to a two-word `<span>` is how notes end up in the wrong
 * place on a responsive layout.
 */
export function pickAnchorElement(x: number, y: number): Element | null {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  for (let el: Element | null = hit; el && el !== document.body; el = el.parentElement) {
    if (el.id && looksStable(el.id)) return el;
    for (const attr of TEST_ATTRS) if (el.hasAttribute(attr)) return el;
    const r = el.getBoundingClientRect();
    if (r.width >= MIN_ANCHOR_W && r.height >= MIN_ANCHOR_H) return el;
  }
  return document.body;
}

/** Record an element plus where in it the point fell, both absolutely and proportionally. */
export function captureElement(el: Element, docX: number, docY: number): ElementAnchor {
  const r = el.getBoundingClientRect();
  const left = r.left + window.scrollX;
  const top = r.top + window.scrollY;
  const dx = docX - left;
  const dy = docY - top;

  const anchor: ElementAnchor = {
    path: capturePath(el),
    tag: el.tagName.toLowerCase(),
    dx,
    dy,
    rx: r.width > 0 ? dx / r.width : 0,
    ry: r.height > 0 ? dy / r.height : 0,
    w: r.width,
    h: r.height,
  };
  if (el.id && looksStable(el.id)) anchor.stableId = el.id;
  for (const attr of TEST_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) {
      anchor.testId = `${attr}=${v}`;
      break;
    }
  }
  return anchor;
}

/** Find an element by test attribute, but only when the match is unambiguous. */
export function resolveTestId(testId: string): Element | null {
  const eq = testId.indexOf('=');
  if (eq < 0) return null;
  const attr = testId.slice(0, eq);
  const value = testId.slice(eq + 1);
  const found = document.querySelectorAll(`[${CSS.escape(attr)}="${CSS.escape(value)}"]`);
  return found.length === 1 ? (found[0] as Element) : null;
}

/**
 * Turn a resolved element back into a document point.
 *
 * When the element has changed size by more than a little, the FRACTIONAL offset is used
 * instead of the pixel one -- that is what carries a note through a responsive breakpoint
 * instead of leaving it hanging off the side.
 */
const RESIZE_TOLERANCE = 0.12;

export function pointFromElement(el: Element, a: ElementAnchor): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const left = r.left + window.scrollX;
  const top = r.top + window.scrollY;
  const widthChanged = a.w > 0 && Math.abs(r.width - a.w) / a.w > RESIZE_TOLERANCE;
  const heightChanged = a.h > 0 && Math.abs(r.height - a.h) / a.h > RESIZE_TOLERANCE;
  return {
    x: left + (widthChanged ? a.rx * r.width : a.dx),
    y: top + (heightChanged ? a.ry * r.height : a.dy),
  };
}
