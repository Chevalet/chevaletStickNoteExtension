/**
 * One ordered undo history for every note on the page.
 *
 * Design decisions, and why:
 *
 * **One stack per page, not per note.** Ctrl+Z should undo the last thing you did, whatever
 * note you did it on. A stack per note means pressing undo does nothing until you first find
 * and click the right note, which is not what anyone means by undo.
 *
 * **We take over text undo instead of leaving it to the browser.** The native editor's undo is
 * better than anything written here -- it coalesces properly, it handles IME, it restores the
 * caret. But it only knows about text, so leaving it in charge means typing and everything
 * else live in two separate histories interleaved unpredictably. Taking it over is the only
 * way to get one ordered history, so the caret offset is stored with every text edit and
 * restored on undo, which is the part the native editor was doing for us.
 *
 * **Entries are data, not closures.** A closure captures the NoteView it was created from, and
 * a note can be destroyed and rebuilt (undoing a delete, a page re-render, a style change that
 * rebuilds the art). Every entry therefore names its note by id and is applied by the host,
 * which looks the note up at apply time. It also makes the whole thing testable without a DOM.
 *
 * **Deltas, not snapshots, wherever a delta is smaller.** Ink stores the strokes added or
 * removed, never the whole layer -- erasing one stroke from a busy drawing must not copy the
 * drawing. Text stores before/after for a coalesced run, which for a sticky note is small.
 *
 * The cost of recording is O(1) per action, and applying is one DOM write plus whatever the
 * existing spring does. Nothing here runs per frame.
 */

/**
 * A stroke, deliberately opaque.
 *
 * History never looks inside one -- it stores which strokes appeared and which disappeared and
 * hands them back to the ink layer. Keeping it structureless means this file does not depend on
 * the drawing code, and the drawing code can change its stroke shape without touching undo.
 */
export type InkStrokeLike = object;

export type Edit =
  /** A coalesced run of typing, or any other whole-text replacement. */
  | { kind: 'text'; before: string; after: string; caretBefore: number; caretAfter: number }
  /** A sparse style diff, before and after. */
  | { kind: 'style'; before: Record<string, unknown>; after: Record<string, unknown> }
  /** Position, size, collapsed, locked. Sparse: only the fields that changed. */
  | { kind: 'ui'; before: Record<string, unknown>; after: Record<string, unknown> }
  /** Strokes drawn or erased. Both directions are a small list. */
  | { kind: 'ink'; added: InkStrokeLike[]; removed: InkStrokeLike[] }
  /** The note was made. Undo trashes it; redo restores it. */
  | { kind: 'create' }
  /** The note was trashed. Undo restores it; redo trashes it again. */
  | { kind: 'delete' };

export interface Entry {
  noteId: string;
  edit: Edit;
  /**
   * Consecutive entries sharing a key, within the coalesce window, merge into one. `null`
   * never merges -- a deletion or a colour change is always its own step.
   */
  mergeKey: string | null;
  at: number;
}

/** What the page must be able to do for an entry to be applied. */
export interface HistoryHost {
  setText(noteId: string, text: string, caret: number): void;
  setStyle(noteId: string, style: Record<string, unknown>): void;
  setUi(noteId: string, ui: Record<string, unknown>): void;
  /** Put `add` back and take `remove` away, in that order. */
  patchInk(noteId: string, add: InkStrokeLike[], remove: InkStrokeLike[]): void;
  /** Undo of a delete, and redo of a create. The note is in the trash, not gone. */
  restoreNote(noteId: string): void;
  /** Undo of a create, and redo of a delete. Soft: it goes to the trash. */
  trashNote(noteId: string): void;
}

export const LIMITS = {
  /** Entries. Past this, the oldest is dropped. */
  entries: 200,
  /** Characters of stored text across the whole stack, so a huge note cannot grow it forever. */
  chars: 2_000_000,
  /** Consecutive same-key edits within this window become one step. */
  coalesceMs: 600,
} as const;

export class History {
  private past: Entry[] = [];
  private future: Entry[] = [];
  /** Set while an entry is being applied, so applying never records. */
  private applying = false;
  private chars = 0;

  constructor(
    private readonly host: HistoryHost,
    private readonly limits: typeof LIMITS = LIMITS,
  ) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** For tests and for the UI, without exposing the stacks themselves. */
  get depth(): { past: number; future: number } {
    return { past: this.past.length, future: this.future.length };
  }

  /** True while an undo or redo is being applied. Recorders must check this and bail. */
  get isApplying(): boolean {
    return this.applying;
  }

  /**
   * Add an entry.
   *
   * Doing anything new discards the redo branch -- the standard model, and the only one that
   * does not surprise people.
   */
  record(entry: Entry): void {
    if (this.applying) return;
    if (isNoop(entry.edit)) return;

    this.future = [];

    const top = this.past.at(-1);
    if (
      top &&
      entry.mergeKey !== null &&
      top.mergeKey === entry.mergeKey &&
      entry.at - top.at <= this.limits.coalesceMs &&
      canMerge(top.edit, entry.edit)
    ) {
      // Keep the older "before" and the newer "after": the run becomes one step.
      this.chars -= weigh(top.edit);
      top.edit = merge(top.edit, entry.edit);
      top.at = entry.at;
      this.chars += weigh(top.edit);
      // Merging can cancel an edit out entirely -- type a letter, delete it.
      if (isNoop(top.edit)) {
        this.chars -= weigh(top.edit);
        this.past.pop();
      }
      return;
    }

    this.past.push(entry);
    this.chars += weigh(entry.edit);
    this.trim();
  }

  undo(): Entry | null {
    const entry = this.past.pop();
    if (!entry) return null;
    this.chars -= weigh(entry.edit);
    this.apply(entry, 'undo');
    this.future.push(entry);
    return entry;
  }

  redo(): Entry | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.apply(entry, 'redo');
    this.past.push(entry);
    this.chars += weigh(entry.edit);
    return entry;
  }

  /** Forget a note's history, e.g. when it is purged for good. */
  forget(noteId: string): void {
    const keep = (e: Entry): boolean => e.noteId !== noteId;
    this.past = this.past.filter(keep);
    this.future = this.future.filter(keep);
    this.chars = [...this.past, ...this.future].reduce((n, e) => n + weigh(e.edit), 0);
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.chars = 0;
  }

  /** Stop the next edit merging into the last one -- on blur, or before a different action. */
  breakRun(): void {
    const top = this.past.at(-1);
    if (top) top.mergeKey = null;
  }

  private apply(entry: Entry, dir: 'undo' | 'redo'): void {
    this.applying = true;
    try {
      const { noteId, edit } = entry;
      switch (edit.kind) {
        case 'text':
          if (dir === 'undo') this.host.setText(noteId, edit.before, edit.caretBefore);
          else this.host.setText(noteId, edit.after, edit.caretAfter);
          break;
        case 'style':
          this.host.setStyle(noteId, dir === 'undo' ? edit.before : edit.after);
          break;
        case 'ui':
          this.host.setUi(noteId, dir === 'undo' ? edit.before : edit.after);
          break;
        case 'ink':
          if (dir === 'undo') this.host.patchInk(noteId, edit.removed, edit.added);
          else this.host.patchInk(noteId, edit.added, edit.removed);
          break;
        case 'create':
          if (dir === 'undo') this.host.trashNote(noteId);
          else this.host.restoreNote(noteId);
          break;
        case 'delete':
          if (dir === 'undo') this.host.restoreNote(noteId);
          else this.host.trashNote(noteId);
          break;
      }
    } finally {
      // Always clears, even if the host threw -- a stuck flag would silently stop recording
      // for the rest of the session.
      this.applying = false;
    }
  }

  private trim(): void {
    while (
      this.past.length > this.limits.entries ||
      (this.chars > this.limits.chars && this.past.length > 1)
    ) {
      const dropped = this.past.shift();
      if (!dropped) break;
      this.chars -= weigh(dropped.edit);
    }
  }
}

// ------------------------------------------------------------------- helpers

/** How much text an entry holds, for the memory cap. */
function weigh(edit: Edit): number {
  return edit.kind === 'text' ? edit.before.length + edit.after.length : 0;
}

/** An edit that changes nothing must not become an undo step. */
function isNoop(edit: Edit): boolean {
  switch (edit.kind) {
    case 'text':
      return edit.before === edit.after;
    case 'style':
    case 'ui':
      return JSON.stringify(edit.before) === JSON.stringify(edit.after);
    case 'ink':
      return edit.added.length === 0 && edit.removed.length === 0;
    default:
      return false;
  }
}

function canMerge(a: Edit, b: Edit): boolean {
  return a.kind === b.kind && (a.kind === 'text' || a.kind === 'style' || a.kind === 'ui');
}

function merge(a: Edit, b: Edit): Edit {
  if (a.kind === 'text' && b.kind === 'text') {
    return {
      kind: 'text',
      before: a.before,
      after: b.after,
      caretBefore: a.caretBefore,
      caretAfter: b.caretAfter,
    };
  }
  if ((a.kind === 'style' && b.kind === 'style') || (a.kind === 'ui' && b.kind === 'ui')) {
    return {
      kind: a.kind,
      // The run's starting point is a's, with b's keys filled in for anything a did not touch.
      before: { ...b.before, ...a.before },
      after: { ...a.after, ...b.after },
    } as Edit;
  }
  return b;
}

/**
 * Character offset of the caret inside an element, counting a line break as one character.
 *
 * Stored with every text edit so undo puts the caret back where it was. A plain offset rather
 * than a node/offset pair on purpose: undo replaces the text wholesale, so the old nodes are
 * gone by the time the caret has to be restored.
 */
export function caretOffset(root: Node, container: Node, offset: number): number {
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
export function offsetToPosition(root: Node, target: number): { node: Node; offset: number } {
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
