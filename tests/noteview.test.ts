// @vitest-environment happy-dom
/**
 * The note itself, mounted, with a host that records what it is asked to do.
 *
 * ## Why this file exists, four releases late
 *
 * A note you typed and then reloaded came back EMPTY. `NoteView` called `onText` when a task
 * box was ticked, when an image was attached, on undo, and from every formatting shortcut --
 * and never from typing. The create call stored an empty body and nothing ever told the store
 * otherwise, so the only way to save your words was to press Ctrl+B while writing them.
 *
 * It survived because of how it was checked. `spikes/playground` reached into the note's
 * shadow root and added its own `input` listener that saved on every keystroke, so the one
 * tool used to answer "do notes survive a reload?" answered about behaviour the extension did
 * not have. Every manual check passed. Every automated test passed too -- there were none for
 * this class at all, which is the other half of the same failure.
 *
 * So the tests below are almost entirely about ONE question: when something changes a note,
 * does the host get told? They are deliberately not about how it looks.
 *
 * happy-dom is enough for this. It has no layout, so the springs settle at nothing and the
 * paper art draws into a canvas that measures zero -- neither of which these assertions touch.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { History } from '~/cs/note/history.ts';
import { type NoteHost, NoteView } from '~/cs/note/NoteView.ts';
import { Loop } from '~/cs/physics/spring.ts';

interface Spy {
  host: NoteHost;
  layer: HTMLElement;
  text: string[];
  names: string[];
  scopes: string[];
  changes: number;
  styles: Array<Record<string, unknown>>;
}

function spyHost(): Spy {
  const layer = document.createElement('div');
  document.body.append(layer);
  const out: Spy = {
    layer,
    text: [],
    names: [],
    scopes: [],
    changes: 0,
    styles: [],
    host: {
      loop: new Loop(),
      layer,
      // A real History with a host that does nothing: the undo stack is not what these test,
      // and a null history would take the `input` listener down a different branch.
      history: new History({
        setText: () => {},
        setStyle: () => {},
        setUi: () => {},
        patchInk: () => {},
        restoreNote: () => {},
        trashNote: () => {},
      }),
      raise: () => 5,
      onText: (_n, text) => out.text.push(text),
      onName: (_n, name) => out.names.push(name),
      onScope: (_n, kind) => out.scopes.push(kind),
      onChange: () => {
        out.changes++;
      },
      onStyle: (_n, overrides) => out.styles.push(overrides),
    },
  };
  return out;
}

function mount(text = ''): { view: NoteView; spy: Spy; body: HTMLElement } {
  const spy = spyHost();
  const view = new NoteView({ id: 'n_test', x: 10, y: 20, w: 240, h: 180, z: 1, text }, spy.host);
  const body = view.el.querySelector('[contenteditable]') as HTMLElement;
  if (!body) throw new Error('the note has no editable body');
  return { view, spy, body };
}

/** What a keystroke is, as far as the DOM is concerned: the text changes, then `input`. */
function type(body: HTMLElement, next: string): void {
  body.dispatchEvent(new Event('beforeinput', { bubbles: true }));
  body.textContent = next;
  body.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('typing', () => {
  let m: ReturnType<typeof mount>;
  beforeEach(() => {
    document.body.textContent = '';
    m = mount();
  });

  it('tells the host, which is what saves the note', () => {
    // THE test. Its absence cost four releases of lost notes.
    type(m.body, 'hello');
    expect(m.spy.text).toEqual(['hello']);
  });

  it('tells the host every keystroke, not just the first', () => {
    type(m.body, 'a');
    type(m.body, 'ab');
    type(m.body, 'abc');
    expect(m.spy.text).toEqual(['a', 'ab', 'abc']);
  });

  it('reports the text as it now is, not as it was', () => {
    type(m.body, 'first');
    type(m.body, '');
    // Emptying a note is a change like any other. Reporting the old text here would make a
    // cleared note come back full.
    expect(m.spy.text.at(-1)).toBe('');
  });

  it('saves again when the note loses focus', () => {
    // The host debounces, so clicking away is when a person expects their words to be safe.
    type(m.body, 'written');
    m.body.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(m.spy.text.at(-1)).toBe('written');
  });

  it('keeps the accessible label in step with the text', () => {
    type(m.body, 'a label for this');
    expect(m.view.el.getAttribute('aria-label')).toContain('a label for this');
  });
});

describe('an external change', () => {
  it('replaces the text without saving it back', () => {
    // The cabinet restoring an earlier version. Saving it back would bounce a write to the
    // store for a change that came from the store.
    const m = mount('old');
    expect(m.view.applyExternalText('restored')).toBe(true);
    expect(m.view.text).toBe('restored');
    expect(m.spy.text).toEqual([]);
  });

  it('refuses while someone is typing in the note', () => {
    const m = mount('mine');
    m.body.dispatchEvent(new Event('focus', { bubbles: true }));
    expect(m.view.isEditing).toBe(true);
    // Replacing the words under a cursor is worse than being briefly out of date.
    expect(m.view.applyExternalText('theirs')).toBe(false);
    expect(m.view.text).toBe('mine');
  });
});

describe('undo and redo of a text edit', () => {
  it('puts the text back and tells the host', () => {
    const m = mount('before');
    m.view.applyText('after', 5);
    expect(m.view.text).toBe('after');
    // This path DOES save: an undo is a change the store has not seen.
    expect(m.spy.text).toEqual(['after']);
  });
});

describe('a name', () => {
  it('is empty until one is given, and then shows in the header', () => {
    const m = mount('the body text');
    expect(m.view.name).toBe('');
    const nameEl = m.view.el.querySelector('.note-name') as HTMLElement;
    expect(nameEl.hidden).toBe(true);

    m.view.setName('Groceries');
    expect(m.view.name).toBe('Groceries');
    expect(nameEl.hidden).toBe(false);
    expect(nameEl.textContent).toBe('Groceries');
  });

  it('becomes the accessible label, because it is what the note is called', () => {
    const m = mount('a long body that would otherwise be read out');
    m.view.setName('Groceries');
    expect(m.view.el.getAttribute('aria-label')).toBe('Sticky note: Groceries');
  });

  it('survives typing in the body', () => {
    // The separate-field design, from the view's side.
    const m = mount('');
    m.view.setName('Kept');
    type(m.body, 'new text entirely');
    expect(m.view.name).toBe('Kept');
    expect(m.view.el.getAttribute('aria-label')).toBe('Sticky note: Kept');
  });

  it('is flattened to one line and capped', () => {
    const m = mount('');
    m.view.setName(`  two
lines  `);
    expect(m.view.name).toBe('two lines');
    m.view.setName('z'.repeat(400));
    expect(m.view.name.length).toBe(120);
  });

  it('clears back to the body label when emptied', () => {
    const m = mount('body line');
    m.view.setName('Temporary');
    m.view.setName('');
    expect(m.view.name).toBe('');
    expect((m.view.el.querySelector('.note-name') as HTMLElement).hidden).toBe(true);
    expect(m.view.el.getAttribute('aria-label')).toContain('body line');
  });

  it('does not tell the host when the rename came FROM the host', () => {
    // The cabinet renamed it; saving it back would bounce a write to the store.
    const m = mount('');
    m.view.setName('From the cabinet', false);
    expect(m.view.name).toBe('From the cabinet');
    expect(m.spy.names).toEqual([]);
  });

  it('tells the host when someone renames it here', () => {
    const m = mount('');
    m.view.setName('From the note');
    expect(m.spy.names).toEqual(['From the note']);
  });

  it('says nothing when the name has not actually changed', () => {
    const m = mount('');
    m.view.setName('Same');
    m.view.setName('Same');
    m.view.setName('  Same  ');
    expect(m.spy.names).toEqual(['Same']);
  });
});

describe('the settings panel', () => {
  /**
   * Opened, and read. The panel is built once when the gear is pressed, which is why three
   * separate things in this project have been found saying the wrong words: they were decided
   * at module load, before the language or the page was known.
   */
  function openPanel(text = 'x'): { m: ReturnType<typeof mount>; panel: HTMLElement } {
    const m = mount(text);
    m.view.toggleSettings(true);
    const panel = m.view.el.querySelector('.settings') as HTMLElement;
    if (!panel) throw new Error('the panel did not open');
    return { m, panel };
  }

  const rowLabelled = (panel: HTMLElement, label: string): HTMLElement | null => {
    for (const row of panel.querySelectorAll('.set-row')) {
      if (row.querySelector('.set-label')?.textContent === label) return row as HTMLElement;
    }
    return null;
  };

  it('offers the four places a note can show', () => {
    const { panel } = openPanel();
    const row = rowLabelled(panel, 'Shows on');
    expect(row, 'no "Shows on" row').not.toBeNull();
    const options = [...(row?.querySelectorAll('option') ?? [])].map((o) => o.value);
    expect(options).toEqual(['url', 'prefix', 'domain', 'global']);
  });

  it('names the section it would actually use, from the page it is on', () => {
    /*
     * The label is computed, because the answer depends on where you are standing: "This
     * section" means `/blog/` on `/blog/what-is-defi` and the host itself at the top of a
     * site. happy-dom's location is `http://localhost:3000/`, so this is the top-of-site case
     * -- and the label has to be the host rather than a bare slash, which is not a section
     * anybody pictures.
     */
    const { panel } = openPanel();
    const row = rowLabelled(panel, 'Shows on');
    const section = [...(row?.querySelectorAll('option') ?? [])].find((o) => o.value === 'prefix');
    expect(section?.textContent).toBe(`This section (${location.host})`);
  });

  it('shows nothing selected for a scope the picker does not offer', () => {
    // A `tab`-scoped note arrives as `other`. Opening the panel must not silently rewrite it
    // to whichever option happens to be first.
    const spy = spyHost();
    const view = new NoteView(
      { id: 'n_other', x: 0, y: 0, w: 240, h: 180, z: 1, text: 'x', scope: 'other' },
      spy.host,
    );
    view.toggleSettings(true);
    const sel = view.el.querySelector('.settings select') as HTMLSelectElement;
    /*
     * Asserted on the OPTIONS, not on `selectedIndex`.
     *
     * happy-dom does not reflect `option.selected = true` into the select's `selectedIndex`:
     * it reports -1 while the option itself says it is selected. A real browser reports 0. So
     * the assertion is about the two things this code actually sets -- which option comes
     * first, and that it is the selected one -- rather than about the environment's
     * bookkeeping. Chasing `selectedIndex` through three attempts is how this test got here.
     */
    const first = sel.options[0];
    expect(first?.textContent).toBe('Somewhere else');
    expect(first?.selected).toBe(true);
    expect(first?.value).toBe('');
    // And choosing it again does nothing: it describes where the note is, it is not an order.
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spy.scopes).toEqual([]);
  });

  it('tells the host which kind was picked, and nothing else', () => {
    const { m, panel } = openPanel();
    const sel = panel.querySelector('select') as HTMLSelectElement;
    sel.value = 'domain';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(m.spy.scopes).toEqual(['domain']);
    // Not a style change: where a note shows is not how it looks.
    expect(m.spy.styles).toEqual([]);
  });

  it('has the name box above the colours, because a name is not an appearance', () => {
    const { panel } = openPanel();
    const labels = [...panel.querySelectorAll('.set-label')].map((e) => e.textContent);
    expect(labels.indexOf('Name')).toBeLessThan(labels.indexOf('Palette'));
    expect(labels.indexOf('Name')).toBeLessThan(labels.indexOf('Shows on'));
  });
});

describe('style changes', () => {
  it('report the overrides, not the whole resolved style', () => {
    // A note stores only what it changed, so that changing a default still reaches it.
    const m = mount('x');
    m.view.setStyle({ palette: 'mint' });
    expect(m.spy.styles.at(-1)).toMatchObject({ palette: 'mint' });
    expect(Object.keys(m.spy.styles.at(-1) ?? {})).not.toContain('fontSize');
  });

  it('cycling the palette is a style change like any other', () => {
    const m = mount('x');
    m.view.cyclePalette();
    expect(m.spy.styles.length).toBeGreaterThan(0);
  });
});

describe('collapsing and locking', () => {
  it('tell the host, so the state survives a reload', () => {
    const m = mount('x');
    const before = m.spy.changes;
    m.view.setCollapsed(true);
    expect(m.view.isCollapsed).toBe(true);
    expect(m.spy.changes).toBeGreaterThan(before);
  });

  it('a locked note still reports the lock', () => {
    const m = mount('x');
    const before = m.spy.changes;
    m.view.setLocked(true);
    expect(m.spy.changes).toBeGreaterThan(before);
  });
});
