/**
 * Text anchoring: W3C Web Annotation quote and position selectors.
 *
 * A CSS path breaks on every list re-order, ad insertion and hydration diff -- which is most
 * of the web. A quote of the surrounding text survives all of that, because it describes what
 * the user was looking at rather than where it happened to sit in the tree. This is the tier
 * that makes anchoring actually work, and it is why Hypothes.is is built the same way.
 *
 * The index is built once per resolution batch by a single TreeWalker, never once per note.
 * On a 300kB page that is a few milliseconds; doing it forty times would not be.
 */

import search from 'approx-string-match';
import type { TextAnchor } from './types.ts';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'SVG', 'CANVAS']);

/** Context captured on each side of the quote. Enough to disambiguate, cheap to store. */
export const CONTEXT_LEN = 32;

export interface TextIndex {
  /** The document's visible text, whitespace-normalized. */
  text: string;
  nodes: Text[];
  /** `starts[i]` is where `nodes[i]` begins in `text`. */
  starts: Int32Array;
  /** Bumped when the page changes enough that the index must be rebuilt. */
  epoch: number;
}

/**
 * Walk the document once, collecting visible text.
 *
 * `getComputedStyle` is called per ELEMENT, not per text node, and the result is cached for
 * the duration of the walk -- calling it per node on a long article is the difference between
 * 4ms and 400ms.
 */
export function buildTextIndex(root: Node = document.body, epoch = 0): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const hidden = new WeakMap<Element, boolean>();

  const isHidden = (el: Element): boolean => {
    const cached = hidden.get(el);
    if (cached !== undefined) return cached;
    let result = SKIP_TAGS.has(el.tagName);
    if (!result) {
      const cs = getComputedStyle(el);
      result = cs.display === 'none' || cs.visibility === 'hidden';
    }
    hidden.set(el, result);
    return result;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      for (let el: Element | null = parent; el; el = el.parentElement) {
        if (isHidden(el)) return NodeFilter.FILTER_REJECT;
      }
      return node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const value = (t.nodeValue ?? '').replace(/\s+/g, ' ');
    if (!value) continue;
    starts.push(text.length);
    nodes.push(t);
    text += value;
  }

  return { text, nodes, starts: Int32Array.from(starts), epoch };
}

/** Capture a quote selector for a range. */
export function captureText(index: TextIndex, range: Range): TextAnchor | undefined {
  const start = offsetOf(index, range.startContainer, range.startOffset);
  const end = offsetOf(index, range.endContainer, range.endOffset);
  if (start < 0 || end < 0 || end < start) return undefined;

  return {
    quote: {
      exact: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CONTEXT_LEN), start),
      suffix: index.text.slice(end, end + CONTEXT_LEN),
    },
    position: { start, end },
  };
}

/** Capture a zero-width anchor at a caret position -- what a click on empty prose gives us. */
export function captureCaret(index: TextIndex, node: Node, offset: number): TextAnchor | undefined {
  const at = offsetOf(index, node, offset);
  if (at < 0) return undefined;
  // A point is not memorable; take a window of words around it so it can be found again.
  const start = Math.max(0, at - CONTEXT_LEN / 2);
  const end = Math.min(index.text.length, at + CONTEXT_LEN);
  if (end <= start) return undefined;
  return {
    quote: {
      exact: index.text.slice(start, end),
      prefix: index.text.slice(Math.max(0, start - CONTEXT_LEN), start),
      suffix: index.text.slice(end, end + CONTEXT_LEN),
    },
    position: { start, end },
  };
}

/** Where a (node, offset) pair falls in the index's flattened text. -1 if it is not indexed. */
export function offsetOf(index: TextIndex, node: Node, offset: number): number {
  if (node.nodeType === Node.TEXT_NODE) {
    const i = index.nodes.indexOf(node as Text);
    return i < 0
      ? -1
      : (index.starts[i] as number) + Math.min(offset, (node.nodeValue ?? '').length);
  }
  // An element container: take the first indexed text node at or after the child offset.
  const child = node.childNodes[offset] ?? node.lastChild;
  if (!child) return -1;
  for (let i = 0; i < index.nodes.length; i++) {
    const t = index.nodes[i] as Text;
    if (child.contains?.(t) || child === t) return index.starts[i] as number;
  }
  return -1;
}

/** Turn a text offset range back into a live DOM Range. */
export function rangeAt(index: TextIndex, start: number, end: number): Range | null {
  const s = locate(index, start);
  const e = locate(index, end);
  if (!s || !e) return null;
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
  } catch {
    return null;
  }
  return range;
}

function locate(index: TextIndex, offset: number): { node: Text; offset: number } | null {
  // Binary search over the node start offsets.
  let lo = 0;
  let hi = index.nodes.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((index.starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  const node = index.nodes[lo] as Text;
  const local = offset - (index.starts[lo] as number);
  return { node, offset: Math.max(0, Math.min(local, (node.nodeValue ?? '').length)) };
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** 1 for an exact match, lower for a fuzzy one. */
  score: number;
  exact: boolean;
}

/**
 * Find the quote again.
 *
 * First an exact search for prefix+exact+suffix, then for the exact text alone, then a bitap
 * fuzzy search that tolerates roughly 15% edit distance. Ties are broken by proximity to the
 * original offset, which is what stops a note about the third "Read more" on the page from
 * jumping to the first.
 */
export function findQuote(index: TextIndex, anchor: TextAnchor): QuoteMatch | null {
  const { exact, prefix, suffix } = anchor.quote;
  if (!exact) return null;
  const hay = index.text;

  // 1. the whole context block, which is close to unambiguous
  const whole = prefix + exact + suffix;
  const wholeAt = nearestIndexOf(hay, whole, anchor.position.start - prefix.length);
  if (wholeAt >= 0) {
    const start = wholeAt + prefix.length;
    return { start, end: start + exact.length, score: 1, exact: true };
  }

  // 2. the quote alone, preferring the occurrence closest to where it used to be
  const soloAt = nearestIndexOf(hay, exact, anchor.position.start);
  if (soloAt >= 0) {
    const drift = Math.abs(soloAt - anchor.position.start);
    // A long drift is still a match, just a slightly less certain one.
    const score = 0.98 - Math.min(0.1, drift / Math.max(1, hay.length));
    return { start: soloAt, end: soloAt + exact.length, score, exact: true };
  }

  // 3. fuzzy. Bitap is O(n * ceil(m/w)); on a 300kB page with a 60-char needle that is ~1ms.
  const maxErrors = Math.max(1, Math.ceil(exact.length * 0.15));
  const matches = search(hay, exact, maxErrors);
  if (matches.length === 0) return null;

  let best = matches[0] as { start: number; end: number; errors: number };
  for (const m of matches) {
    const better =
      m.errors < best.errors ||
      (m.errors === best.errors &&
        Math.abs(m.start - anchor.position.start) < Math.abs(best.start - anchor.position.start));
    if (better) best = m;
  }
  const quality = 1 - best.errors / (maxErrors + 1);
  return { start: best.start, end: best.end, score: 0.55 + quality * 0.3, exact: false };
}

/** `indexOf`, but returning the occurrence closest to `near` rather than the first. */
function nearestIndexOf(hay: string, needle: string, near: number): number {
  if (!needle) return -1;
  let bestAt = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const dist = Math.abs(at - near);
    if (dist < bestDist) {
      bestDist = dist;
      bestAt = at;
    }
    // Occurrences are found in increasing order, so once we start moving away we are done.
    if (at > near && bestAt >= 0) break;
  }
  return bestAt;
}

/**
 * The fallback when the quote cannot be found at all: take the stored offsets literally and
 * check whether what is there still resembles what was quoted.
 */
export function overlapAt(index: TextIndex, anchor: TextAnchor): number {
  const { start, end } = anchor.position;
  if (start >= index.text.length) return 0;
  const now = index.text.slice(start, Math.min(end, index.text.length));
  const want = anchor.quote.exact;
  if (!now || !want) return 0;
  let same = 0;
  const n = Math.min(now.length, want.length);
  for (let i = 0; i < n; i++) if (now[i] === want[i]) same++;
  return same / Math.max(now.length, want.length);
}
