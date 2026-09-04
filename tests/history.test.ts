import { beforeEach, describe, expect, it } from 'vitest';
import { type Edit, type Entry, History, type HistoryHost, LIMITS } from '~/cs/note/history.ts';

/**
 * Undo is the feature people trust with work they cannot get back, so these tests are about
 * the properties that make it trustworthy: an undo followed by a redo lands exactly where it
 * started, nothing an undo does is itself recorded, and a run of typing is one step rather
 * than one step per keystroke.
 */

interface Call {
  op: string;
  noteId: string;
  arg?: unknown;
}

let calls: Call[];
let host: HistoryHost;
let h: History;

beforeEach(() => {
  calls = [];
  host = {
    setText: (noteId, text, caret) => calls.push({ op: 'text', noteId, arg: { text, caret } }),
    setStyle: (noteId, style) => calls.push({ op: 'style', noteId, arg: style }),
    setUi: (noteId, ui) => calls.push({ op: 'ui', noteId, arg: ui }),
    patchInk: (noteId, add, remove) => calls.push({ op: 'ink', noteId, arg: { add, remove } }),
    restoreNote: (noteId) => calls.push({ op: 'restore', noteId }),
    trashNote: (noteId) => calls.push({ op: 'trash', noteId }),
  };
  h = new History(host);
});

let clock = 1000;
/** Well outside the coalesce window, so two entries never merge by accident. */
function tick(): number {
  clock += 10_000;
  return clock;
}
const entry = (edit: Edit, over: Partial<Entry> = {}): Entry => ({
  noteId: 'n_1',
  edit,
  mergeKey: null,
  at: tick(),
  ...over,
});

const typing = (before: string, after: string, at: number, noteId = 'n_1'): Entry => ({
  noteId,
  edit: { kind: 'text', before, after, caretBefore: before.length, caretAfter: after.length },
  mergeKey: `text:${noteId}`,
  at,
});

describe('the basics', () => {
  it('starts with nothing to undo or redo', () => {
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
    expect(calls).toEqual([]);
  });

  it('undoes to the before state and redoes to the after state', () => {
    h.record(entry({ kind: 'text', before: 'a', after: 'ab', caretBefore: 1, caretAfter: 2 }));
    h.undo();
    expect(calls).toEqual([{ op: 'text', noteId: 'n_1', arg: { text: 'a', caret: 1 } }]);
    h.redo();
    expect(calls[1]).toEqual({ op: 'text', noteId: 'n_1', arg: { text: 'ab', caret: 2 } });
  });

  it('moves entries between the stacks rather than losing them', () => {
    h.record(typing('', 'a', 1));
    h.record(entry({ kind: 'style', before: { paper: 'x' }, after: { paper: 'y' } }));
    expect(h.depth).toEqual({ past: 2, future: 0 });
    h.undo();
    h.undo();
    expect(h.depth).toEqual({ past: 0, future: 2 });
    h.redo();
    expect(h.depth).toEqual({ past: 1, future: 1 });
  });

  /** The property that matters most: history must not drift. */
  it('returns to the starting state after any number of undo/redo cycles', () => {
    const edits: Edit[] = [
      { kind: 'text', before: '', after: 'hello', caretBefore: 0, caretAfter: 5 },
      { kind: 'style', before: {}, after: { palette: 'acid' } },
      { kind: 'ui', before: { x: 10 }, after: { x: 400 } },
      { kind: 'ink', added: [{ id: 's1' }], removed: [] },
    ];
    for (const e of edits) h.record(entry(e));

    for (let i = 0; i < 4; i++) {
      while (h.canUndo) h.undo();
      while (h.canRedo) h.redo();
    }
    expect(h.depth).toEqual({ past: 4, future: 0 });

    // The last four applications must be the redo direction of all four edits, in order.
    expect(calls.slice(-4).map((c) => c.op)).toEqual(['text', 'style', 'ui', 'ink']);
  });

  it('is one ordered history across different notes', () => {
    h.record(typing('', 'a', 1, 'n_1'));
    h.record(typing('', 'b', 2, 'n_2'));
    h.undo();
    expect(calls.at(-1)?.noteId).toBe('n_2');
    h.undo();
    expect(calls.at(-1)?.noteId).toBe('n_1');
  });

  it('discards the redo branch as soon as something new is done', () => {
    h.record(typing('', 'a', 1));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.record(typing('', 'z', 99_999));
    expect(h.canRedo).toBe(false);
  });
});

describe('applying must not record', () => {
  /**
   * The bug this prevents: an undo writes the old text, the text-change recorder fires on that
   * write, and a new entry is pushed. Undo then toggles between two states forever and the real
   * history is unreachable.
   */
  it('ignores anything recorded while an undo is being applied', () => {
    const reentrant = new History({
      ...host,
      setText: (noteId, text, caret) => {
        calls.push({ op: 'text', noteId, arg: { text, caret } });
        // Exactly what a naive recorder would do.
        reentrant.record(typing(text, 'something else', Date.now()));
      },
    });
    reentrant.record(typing('', 'abc', 1));
    reentrant.undo();
    expect(reentrant.depth).toEqual({ past: 0, future: 1 });
    expect(reentrant.canRedo).toBe(true);
  });

  it('exposes the applying flag so recorders can bail', () => {
    let sawFlag: boolean | null = null;
    const probe = new History({
      ...host,
      setText: () => {
        sawFlag = probe.isApplying;
      },
    });
    probe.record(typing('', 'a', 1));
    probe.undo();
    expect(sawFlag).toBe(true);
    expect(probe.isApplying).toBe(false);
  });

  it('clears the flag even when the host throws', () => {
    const broken = new History({
      ...host,
      setText: () => {
        throw new Error('boom');
      },
    });
    broken.record(typing('', 'a', 1));
    expect(() => broken.undo()).toThrow('boom');
    expect(broken.isApplying, 'a stuck flag stops all future recording').toBe(false);
    broken.record(typing('a', 'ab', 2));
    expect(broken.canUndo).toBe(true);
  });
});

describe('coalescing', () => {
  it('makes a run of typing one undo step', () => {
    const word = 'hello';
    for (let i = 0; i < word.length; i++) {
      // 80ms apart: a fast typist, comfortably inside the coalesce window.
      h.record(typing(word.slice(0, i), word.slice(0, i + 1), 5000 + i * 80));
    }
    expect(h.depth.past).toBe(1);
    h.undo();
    // All the way back to empty, not one letter.
    expect(calls.at(-1)?.arg).toEqual({ text: '', caret: 0 });
  });

  it('starts a new step after a pause', () => {
    h.record(typing('', 'a', 1000));
    h.record(typing('a', 'ab', 1000 + LIMITS.coalesceMs + 1));
    expect(h.depth.past).toBe(2);
  });

  it('never merges across notes', () => {
    h.record(typing('', 'a', 1000, 'n_1'));
    h.record(typing('', 'b', 1050, 'n_2'));
    expect(h.depth.past).toBe(2);
  });

  it('never merges an entry with no merge key', () => {
    h.record(entry({ kind: 'style', before: {}, after: { a: 1 } }, { at: 1000 }));
    h.record(entry({ kind: 'style', before: { a: 1 }, after: { a: 2 } }, { at: 1010 }));
    expect(h.depth.past).toBe(2);
  });

  it('drops a run that cancels itself out', () => {
    // Type a letter and delete it: nothing happened, so there is nothing to undo.
    h.record(typing('abc', 'abcd', 1000));
    h.record(typing('abcd', 'abc', 1050));
    expect(h.canUndo).toBe(false);
  });

  it('breakRun stops the next edit merging into the last', () => {
    h.record(typing('', 'a', 1000));
    h.breakRun();
    h.record(typing('a', 'ab', 1010));
    expect(h.depth.past).toBe(2);
  });

  it('merges sparse style runs without losing the starting point', () => {
    h.record(
      entry(
        { kind: 'style', before: { paper: 'red' }, after: { paper: 'blue' } },
        { mergeKey: 's', at: 1000 },
      ),
    );
    h.record(
      entry(
        { kind: 'style', before: { ink: 'black' }, after: { ink: 'white' } },
        { mergeKey: 's', at: 1050 },
      ),
    );
    h.undo();
    // Both fields have to go back, or half the change survives an undo.
    expect(calls.at(-1)?.arg).toEqual({ paper: 'red', ink: 'black' });
  });
});

describe('no-ops', () => {
  it.each([
    ['identical text', { kind: 'text', before: 'a', after: 'a', caretBefore: 0, caretAfter: 0 }],
    ['identical style', { kind: 'style', before: { a: 1 }, after: { a: 1 } }],
    ['identical ui', { kind: 'ui', before: { x: 1 }, after: { x: 1 } }],
    ['empty ink', { kind: 'ink', added: [], removed: [] }],
  ] as Array<[string, Edit]>)('does not record %s', (_label, edit) => {
    h.record(entry(edit));
    expect(h.canUndo).toBe(false);
  });

  it('still records a create or a delete, which are never no-ops', () => {
    h.record(entry({ kind: 'create' }));
    h.record(entry({ kind: 'delete' }));
    expect(h.depth.past).toBe(2);
  });
});

describe('create and delete', () => {
  /** A soft delete puts the note in the trash, so undo is a restore, not a re-create. */
  it('undoes a delete by restoring, and redoes it by trashing', () => {
    h.record(entry({ kind: 'delete' }));
    h.undo();
    expect(calls.at(-1)).toEqual({ op: 'restore', noteId: 'n_1' });
    h.redo();
    expect(calls.at(-1)).toEqual({ op: 'trash', noteId: 'n_1' });
  });

  it('undoes a create by trashing, and redoes it by restoring', () => {
    h.record(entry({ kind: 'create' }));
    h.undo();
    expect(calls.at(-1)).toEqual({ op: 'trash', noteId: 'n_1' });
    h.redo();
    expect(calls.at(-1)).toEqual({ op: 'restore', noteId: 'n_1' });
  });
});

describe('ink', () => {
  it('undoes a stroke by removing exactly what was added', () => {
    h.record(entry({ kind: 'ink', added: [{ id: 's1' }], removed: [] }));
    h.undo();
    expect(calls.at(-1)?.arg).toEqual({ add: [], remove: [{ id: 's1' }] });
  });

  it('undoes an erase by putting the erased strokes back', () => {
    h.record(entry({ kind: 'ink', added: [], removed: [{ id: 's1' }, { id: 's2' }] }));
    h.undo();
    expect(calls.at(-1)?.arg).toEqual({ add: [{ id: 's1' }, { id: 's2' }], remove: [] });
  });
});

describe('bounds', () => {
  it('drops the oldest entries past the limit rather than growing forever', () => {
    for (let i = 0; i < LIMITS.entries + 50; i++) {
      h.record(entry({ kind: 'ui', before: { x: i }, after: { x: i + 1 } }));
    }
    expect(h.depth.past).toBe(LIMITS.entries);
  });

  it('caps stored text, so one enormous note cannot eat memory', () => {
    const big = 'x'.repeat(300_000);
    for (let i = 0; i < 20; i++) {
      h.record(
        entry({
          kind: 'text',
          before: big,
          after: `${big}${i}`,
          caretBefore: 0,
          caretAfter: 1,
        }),
      );
    }
    // Well under the entry limit, so the character cap is what stopped it.
    expect(h.depth.past).toBeLessThan(20);
    expect(h.canUndo).toBe(true);
  });

  it('always keeps at least one entry, so undo is never silently empty', () => {
    const huge = 'x'.repeat(LIMITS.chars * 2);
    h.record(entry({ kind: 'text', before: '', after: huge, caretBefore: 0, caretAfter: 1 }));
    expect(h.canUndo).toBe(true);
  });
});

describe('forget and clear', () => {
  it('forgets one note without disturbing the others', () => {
    h.record(typing('', 'a', 1000, 'n_1'));
    h.record(typing('', 'b', 20_000, 'n_2'));
    h.forget('n_1');
    expect(h.depth.past).toBe(1);
    h.undo();
    expect(calls.at(-1)?.noteId).toBe('n_2');
  });

  it('forgets a note that is sitting in the redo branch too', () => {
    h.record(typing('', 'a', 1000, 'n_1'));
    h.undo();
    h.forget('n_1');
    expect(h.canRedo).toBe(false);
  });

  it('clears everything', () => {
    h.record(typing('', 'a', 1000));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('lets the stack refill correctly after the character cap has been exercised', () => {
    const big = 'x'.repeat(500_000);
    for (let i = 0; i < 10; i++) {
      h.record(entry({ kind: 'text', before: big, after: big + i, caretBefore: 0, caretAfter: 1 }));
    }
    h.clear();
    for (let i = 0; i < 5; i++) {
      h.record(entry({ kind: 'ui', before: { x: i }, after: { x: i + 1 } }));
    }
    expect(h.depth.past).toBe(5);
  });
});
