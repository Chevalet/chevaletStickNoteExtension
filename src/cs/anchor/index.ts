/**
 * Capture and resolution. Plan section 5.
 *
 * Capture always records all three tiers. Resolution walks them in order of trust and stops as
 * soon as something clears the bar, so the common case -- an unchanged page -- costs one
 * `getElementById` and never builds a text index at all.
 */

import {
  captureElement,
  idConfidence,
  pickAnchorElement,
  pointFromElement,
  resolvePath,
  resolveTestId,
} from './element.ts';
import type { TextIndex } from './text.ts';
import {
  buildTextIndex,
  captureCaret,
  captureText,
  findQuote,
  overlapAt,
  rangeAt,
} from './text.ts';
import { type Anchor, GOOD_ENOUGH, type Resolution } from './types.ts';

export type { TextIndex } from './text.ts';
export { buildTextIndex } from './text.ts';
export * from './types.ts';

// --------------------------------------------------------------------- capture

function docMetrics() {
  const de = document.documentElement;
  return {
    docW: Math.max(de.scrollWidth, de.clientWidth, 1),
    docH: Math.max(de.scrollHeight, de.clientHeight, 1),
    dir: (getComputedStyle(de).direction === 'rtl' ? 'rtl' : 'ltr') as 'ltr' | 'rtl',
  };
}

/**
 * Capture an anchor at a point in DOCUMENT coordinates.
 *
 * `index` is optional: pass one when capturing several notes at once, otherwise a throwaway
 * index is built. Capturing is rare (once per note) so the cost is not on any hot path.
 */
export function captureAt(docX: number, docY: number, index?: TextIndex): Anchor {
  const { docW, docH, dir } = docMetrics();
  const anchor: Anchor = {
    mode: 'document',
    doc: { x: docX, y: docY, fx: docX / docW, fy: docY / docH, docW, docH, dir },
  };

  const vx = docX - window.scrollX;
  const vy = docY - window.scrollY;

  const el = pickAnchorElement(vx, vy);
  if (el) anchor.el = captureElement(el, docX, docY);

  const caret = caretAt(vx, vy);
  if (caret) {
    const idx = index ?? buildTextIndex();
    const text = captureCaret(idx, caret.node, caret.offset);
    if (text) anchor.text = text;
  }
  return anchor;
}

/** Capture an anchor for a selected range -- the "stick a note to this sentence" path. */
export function captureSelection(range: Range, index?: TextIndex): Anchor | null {
  const rects = range.getClientRects();
  const first = rects[0];
  if (!first) return null;

  const docX = first.left + window.scrollX;
  const docY = first.bottom + window.scrollY;
  const { docW, docH, dir } = docMetrics();

  const idx = index ?? buildTextIndex();
  const text = captureText(idx, range);
  if (!text) return null;

  const anchor: Anchor = {
    mode: 'text',
    doc: { x: docX, y: docY, fx: docX / docW, fy: docY / docH, docW, docH, dir },
    text,
  };
  const container =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentElement;
  if (container) anchor.el = captureElement(container, docX, docY);
  return anchor;
}

function caretAt(vx: number, vy: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  // Firefox has caretPositionFromPoint; Chromium had caretRangeFromPoint first. Try both.
  const pos = d.caretPositionFromPoint?.(vx, vy);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const r = d.caretRangeFromPoint?.(vx, vy);
  if (r) return { node: r.startContainer, offset: r.startOffset };
  return null;
}

// -------------------------------------------------------------------- resolve

export interface ResolveOptions {
  /** Reuse one index across a batch of notes. Built lazily if omitted. */
  index?: TextIndex;
  /** Called at most once per batch, so the index is only built if some note needs it. */
  getIndex?: () => TextIndex;
}

/**
 * Find where a note should be now.
 *
 * Candidates are scored rather than short-circuited on the first hit, because the cheap tiers
 * are also the least reliable: a structural path that still resolves may well be pointing at
 * a completely different paragraph after a list re-order.
 */
export function resolveAnchor(anchor: Anchor, opts: ResolveOptions = {}): Resolution {
  if (anchor.mode === 'pinned' && anchor.pin) {
    return { x: anchor.pin.vx, y: anchor.pin.vy, confidence: 1, via: 'raw' };
  }

  const candidates: Resolution[] = [];
  const push = (r: Resolution | null): boolean => {
    if (!r) return false;
    candidates.push(r);
    return r.confidence >= GOOD_ENOUGH;
  };

  const a = anchor.el;
  if (a) {
    if (a.stableId) {
      const el = document.getElementById(a.stableId);
      if (el && el.tagName.toLowerCase() === a.tag) {
        const confidence = idConfidence(a.stableId);
        if (push({ ...pointFromElement(el, a), confidence, via: 'stableId', target: el })) {
          return best(candidates);
        }
      }
    }
    if (a.testId) {
      const el = resolveTestId(a.testId);
      if (el) {
        if (push({ ...pointFromElement(el, a), confidence: 0.95, via: 'testId', target: el })) {
          return best(candidates);
        }
      }
    }
    const el = resolvePath(a.path);
    if (el) {
      // A path that resolves to a different tag is a path that resolved to the wrong thing.
      const conf = el.tagName.toLowerCase() === a.tag ? 0.9 : 0.5;
      push({ ...pointFromElement(el, a), confidence: conf, via: 'path', target: el });
    }
  }

  if (anchor.text) {
    const index = opts.index ?? opts.getIndex?.() ?? buildTextIndex();
    const hit = findQuote(index, anchor.text);
    if (hit) {
      const range = rangeAt(index, hit.start, hit.end);
      const point = range ? pointOfRange(range) : null;
      if (point) {
        // An exact quote outranks a structural path; a fuzzy one sits just below it.
        const confidence = hit.exact ? Math.min(0.92, hit.score * 0.92) : hit.score;
        push({
          ...point,
          confidence,
          via: hit.exact ? 'quote' : 'fuzzy',
          ...(range ? { range } : {}),
        });
      }
    } else {
      const overlap = overlapAt(index, anchor.text);
      if (overlap >= 0.6) {
        const range = rangeAt(index, anchor.text.position.start, anchor.text.position.end);
        const point = range ? pointOfRange(range) : null;
        if (point)
          push({ ...point, confidence: 0.5, via: 'position', ...(range ? { range } : {}) });
      }
    }
  }

  // Document fallbacks. Always available, never trusted.
  const { docW, docH } = docMetrics();
  const widthChanged = Math.abs(docW - anchor.doc.docW) / Math.max(1, anchor.doc.docW) > 0.05;
  const heightChanged = Math.abs(docH - anchor.doc.docH) / Math.max(1, anchor.doc.docH) > 0.05;
  push({
    x: widthChanged ? anchor.doc.fx * docW : anchor.doc.x,
    y: heightChanged ? anchor.doc.fy * docH : anchor.doc.y,
    confidence: widthChanged || heightChanged ? 0.35 : 0.6,
    via: widthChanged || heightChanged ? 'fraction' : 'raw',
  });

  return best(candidates);
}

function best(candidates: Resolution[]): Resolution {
  let top = candidates[0] as Resolution;
  for (const c of candidates) if (c.confidence > top.confidence) top = c;
  return top;
}

function pointOfRange(range: Range): { x: number; y: number } | null {
  const rects = range.getClientRects();
  const r = rects[0] ?? range.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { x: r.left + window.scrollX, y: r.bottom + window.scrollY };
}
