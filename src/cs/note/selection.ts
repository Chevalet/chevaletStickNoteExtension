/**
 * Reading and writing the caret inside a shadow root, in a browser that has no
 * `ShadowRoot.getSelection()`.
 *
 * ## The trap
 *
 * `ShadowRoot.getSelection()` is a Chromium extension to the spec and **does not exist in
 * Firefox** -- which is the only browser this extension ships to. The caret code called it with
 * an optional chain, so it did not throw; it returned `undefined` and every caller quietly
 * took its fallback path. `caretNow()` answered "the caret is at the end of the text" for every
 * edit, and `restoreCaret()` returned without doing anything at all.
 *
 * That was invisible while the only user was undo, because undoing a run of typing puts the
 * caret at the end anyway, and the harness that "verified" it had the caret at the end too --
 * a degenerate test that passed for the wrong reason. It stops being invisible the moment
 * Ctrl+B needs to know which four characters are selected.
 *
 * Firefox's `document.getSelection()` reports nodes INSIDE a shadow tree rather than
 * retargeting them to the host, which is the mirror image of Chromium's behaviour and exactly
 * what is needed here. Measured in `spikes/firefox-keys.mjs`:
 *
 *     root.getSelection            -> undefined
 *     document.getSelection()      -> anchorNode inside the note body, offset 10
 *
 * So: try the shadow root's own method for a browser that has it, fall back to the document's,
 * and in both cases verify the anchor really is inside the element before believing a word of
 * it -- a selection elsewhere on the page is not ours to read or to move.
 */

/** The Selection for a shadow-root-hosted element, or null if the caret is not in it. */
export function selectionIn(el: HTMLElement): Selection | null {
  const root = el.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const sel = root.getSelection?.() ?? el.ownerDocument.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const anchor = sel.anchorNode;
  if (!anchor || !el.contains(anchor)) return null;
  return sel;
}

/**
 * Character offset of a node/offset pair inside `root`, counting a `<br>` as one character.
 *
 * Shared with `history.ts`, which stores an offset with every text edit. A plain integer
 * rather than a node reference on purpose: an undo replaces the text wholesale, so the node
 * the caret was in no longer exists by the time it has to be put back.
 */
export function offsetOf(root: Node, container: Node, offset: number): number {
  let count = 0;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walk.currentNode;
  while (node) {
    if (node === container) {
      return count + (node.nodeType === Node.TEXT_NODE ? offset : 0);
    }
    if (node.nodeType === Node.TEXT_NODE) count += (node.nodeValue ?? '').length;
    else if ((node as Element).tagName === 'BR') count += 1;
    node = walk.nextNode();
  }
  return count;
}

/** Turn a character offset back into a node and offset, clamped to what exists. */
export function positionAt(root: Node, target: number): { node: Node; offset: number } {
  let remaining = Math.max(0, target);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walk.nextNode();
  let last: Node | null = null;
  while (node) {
    const len = (node.nodeValue ?? '').length;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    last = node;
    node = walk.nextNode();
  }
  if (last) return { node: last, offset: (last.nodeValue ?? '').length };
  return { node: root, offset: 0 };
}

/**
 * The selected range as character offsets, ordered, or null if the caret is elsewhere.
 *
 * `start`/`end` are in document order regardless of which way the selection was dragged --
 * a backwards selection would otherwise hand every formatting operation a negative span.
 */
export function offsetsIn(el: HTMLElement): { start: number; end: number } | null {
  const sel = selectionIn(el);
  if (!sel) return null;
  const range = sel.getRangeAt(0);
  const a = offsetOf(el, range.startContainer, range.startOffset);
  const b = offsetOf(el, range.endContainer, range.endOffset);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Put the selection back at the given offsets.
 *
 * Returns false when there is no selection object to write to, so a caller can fall back to
 * whatever the browser did rather than assume the caret is where it asked for.
 */
export function selectOffsets(el: HTMLElement, start: number, end = start): boolean {
  const root = el.getRootNode() as ShadowRoot & { getSelection?: () => Selection | null };
  const sel = root.getSelection?.() ?? el.ownerDocument.getSelection();
  if (!sel) return false;
  try {
    const from = positionAt(el, start);
    const to = end === start ? from : positionAt(el, end);
    const range = el.ownerDocument.createRange();
    range.setStart(from.node, Math.min(from.offset, (from.node.nodeValue ?? '').length));
    range.setEnd(to.node, Math.min(to.offset, (to.node.nodeValue ?? '').length));
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  } catch {
    // A range that cannot be built is not worth throwing over: the text is already correct,
    // and the caret being in the wrong place is a smaller problem than a dead handler.
    return false;
  }
}
