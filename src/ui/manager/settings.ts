/**
 * Every setting, inside the cabinet.
 *
 * The options page still exists, because Firefox puts a Preferences button next to the add-on
 * in `about:addons` and it has to lead somewhere. But nobody goes looking there. The cabinet is
 * the page people actually open, so this is where the settings belong — and being here they get
 * the cabinet's own idiom instead of a form.
 *
 * The idiom is the one the rest of the cabinet already uses: manila tabs down the side for the
 * sections, ruled index-card paper for the content, a hard offset shadow, and the accent used
 * once per row rather than everywhere. A switch is a paper tab that slides; a slider has a
 * hand-drawn track. No native controls survive contact with this palette.
 *
 * Each control writes straight through to storage on change. There is no Save button, because a
 * Save button is a way to lose someone's work when they close the tab.
 */

import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from '~/bg/settings.ts';
import { FONTS, PALETTES } from '~/cs/note/theme.ts';

type Patch = Partial<Settings>;

let current: Settings = DEFAULT_SETTINGS;
let active = 0;
let onChanged: (() => void) | null = null;

const SECTIONS = [
  { key: 'where', tab: 'Where', title: 'Where notes appear' },
  { key: 'closing', tab: 'Closing', title: 'Closing a tab' },
  { key: 'look', tab: 'Look', title: 'How a new note looks' },
  { key: 'keeping', tab: 'Keeping', title: 'Keeping and deleting' },
  { key: 'backup', tab: 'Backup', title: 'Backup' },
  { key: 'keys', tab: 'Keys', title: 'Keyboard' },
] as const;

// --------------------------------------------------------------------- atoms

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

async function write(patch: Patch): Promise<void> {
  current = { ...current, ...patch };
  await saveSettings(current);
  onChanged?.();
}

/** A labelled row. Everything in a section is one of these, so the rhythm never breaks. */
function row(label: string, control: Node, note?: string): HTMLElement {
  const text = h('div', { class: 'srow-text' }, h('span', { class: 'srow-label' }, label));
  if (note) text.append(h('span', { class: 'srow-note' }, note));
  return h('div', { class: 'srow' }, text, h('div', { class: 'srow-ctl' }, control));
}

/** A paper tab that slides across. Not a checkbox: a checkbox is somebody else's design. */
function toggle(on: boolean, onSet: (v: boolean) => void): HTMLElement {
  const b = h('button', {
    type: 'button',
    class: 'sw',
    role: 'switch',
    'aria-checked': String(on),
  });
  b.append(h('span', { class: 'sw-knob' }));
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(next));
    onSet(next);
  });
  return b;
}

/** Segmented choice, drawn as a strip of index-card tabs. */
function choice<T extends string>(
  value: T,
  options: ReadonlyArray<readonly [T, string]>,
  onSet: (v: T) => void,
): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h(
      'button',
      { type: 'button', role: 'radio', 'aria-checked': String(v === value) },
      label,
    );
    b.addEventListener('click', () => {
      for (const other of wrap.children) other.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-checked', 'true');
      onSet(v);
    });
    wrap.append(b);
  }
  return wrap;
}

function number(
  value: number,
  min: number,
  max: number,
  suffix: string,
  onSet: (v: number) => void,
): HTMLElement {
  const input = h('input', {
    class: 'num',
    type: 'number',
    min: String(min),
    max: String(max),
    inputmode: 'numeric',
  }) as HTMLInputElement;
  input.value = String(value);
  input.addEventListener('change', () => {
    const n = Math.min(max, Math.max(min, Number(input.value) || min));
    input.value = String(n);
    onSet(n);
  });
  return h('div', { class: 'numwrap' }, input, h('span', { class: 'unit' }, suffix));
}

/** Swatches. Clicking one sets the default palette for every new note. */
function palettePicker(value: string, onSet: (id: string) => void): HTMLElement {
  const wrap = h('div', { class: 'swatches', role: 'radiogroup' });
  for (const p of PALETTES) {
    const b = h('button', {
      type: 'button',
      role: 'radio',
      class: 'swatch',
      title: p.label,
      'aria-label': p.label,
      'aria-checked': String(p.id === value),
      style: `--sw-paper:${p.paper}; --sw-ink:${p.ink}; --sw-accent:${p.accent}`,
    });
    b.addEventListener('click', () => {
      for (const other of wrap.children) other.setAttribute('aria-checked', 'false');
      b.setAttribute('aria-checked', 'true');
      onSet(p.id);
    });
    wrap.append(b);
  }
  return wrap;
}

// ------------------------------------------------------------------ sections

function defaultsPatch(key: string, value: unknown): Patch {
  return { noteDefaults: { ...current.noteDefaults, [key]: value } };
}

function sectionWhere(): HTMLElement {
  const rules = Object.entries(current.siteRules);
  const body = h(
    'div',
    { class: 'ssec-body' },
    row(
      'Show notes on a site I have not decided about',
      toggle(current.defaultEnabled, (v) => void write({ defaultEnabled: v })),
      'Off means a site stays clean until you turn notes on for it from the toolbar button.',
    ),
    row(
      'Keep notes made in private windows',
      toggle(current.persistPrivateNotes, (v) => void write({ persistPrivateNotes: v })),
      current.persistPrivateNotes
        ? 'They are written to the database like any other note.'
        : 'They live in memory only and are gone when the last private window closes.',
    ),
  );

  if (rules.length === 0) {
    body.append(h('p', { class: 'ssec-empty' }, 'No per-site decisions yet.'));
    return body;
  }

  const list = h('div', { class: 'rules' });
  for (const [origin, rule] of rules) {
    const drop = h('button', { type: 'button', class: 'rule-drop' }, 'Forget');
    drop.addEventListener('click', () => {
      const next = { ...current.siteRules };
      delete next[origin];
      void write({ siteRules: next }).then(() => repaint());
    });
    list.append(
      h(
        'div',
        { class: 'rule' },
        h('span', { class: `rule-dot is-${rule}` }),
        h('span', { class: 'rule-origin' }, origin),
        h('span', { class: 'rule-state' }, rule === 'on' ? 'notes on' : 'notes off'),
        drop,
      ),
    );
  }
  body.append(
    h('h4', { class: 'ssec-sub' }, `Sites you have decided about (${rules.length})`),
    list,
  );
  return body;
}

function sectionClosing(): HTMLElement {
  return h(
    'div',
    { class: 'ssec-body' },
    row(
      'Warn before closing a tab',
      choice(
        current.guard.mode,
        [
          ['never', 'Never'],
          ['unsaved', 'Unsaved edits'],
          ['hasNotes', 'Any notes'],
        ] as const,
        (v) => void write({ guard: { ...current.guard, mode: v } }),
      ),
      'Firefox decides whether to actually show the dialog, and a page you have not interacted ' +
        'with may get none. Your notes are written to the database long before this could ' +
        'matter, so treat it as a courtesy rather than a safety net.',
    ),
    row(
      'Tabs watched at once',
      number(
        current.guard.maxArmedTabs,
        0,
        10,
        'tabs',
        (v) => void write({ guard: { ...current.guard, maxArmedTabs: v } }),
      ),
      'Closing a window full of annotated tabs must not ask you ten times over. The most ' +
        'recently edited tabs get the slots.',
    ),
  );
}

function sectionLook(): HTMLElement {
  const d = current.noteDefaults;
  const fontId = typeof d.fontFamily === 'string' ? d.fontFamily : 'system';
  return h(
    'div',
    { class: 'ssec-body' },
    h(
      'p',
      { class: 'ssec-note' },
      'This is what a new note starts as. Any note can still be changed on its own — press ' +
        'S on a note, or use its palette button — and a note keeps whatever it changed even ' +
        'when you alter the defaults here.',
    ),
    row(
      'Paper',
      palettePicker(
        typeof d.palette === 'string' ? d.palette : 'postit',
        (id) => void write(defaultsPatch('palette', id)),
      ),
    ),
    row(
      'Type',
      choice(
        fontId,
        FONTS.map((f) => [f.id, f.label] as const),
        (v) => void write(defaultsPatch('fontFamily', v)),
      ),
    ),
    row(
      'Text size',
      number(
        typeof d.fontSize === 'number' ? d.fontSize : 15,
        10,
        28,
        'px',
        (v) => void write(defaultsPatch('fontSize', v)),
      ),
    ),
    row(
      'Direction',
      choice(
        typeof d.dir === 'string' ? (d.dir as 'auto' | 'ltr' | 'rtl') : 'auto',
        [
          ['auto', 'Automatic'],
          ['rtl', 'Right to left'],
          ['ltr', 'Left to right'],
        ] as const,
        (v) => void write(defaultsPatch('dir', v)),
      ),
      'Automatic lets each paragraph decide for itself, so Persian and English can share a note.',
    ),
    row(
      'Torn edges',
      number(
        typeof d.tornEdges === 'number' ? d.tornEdges : 1,
        0,
        3,
        '',
        (v) => void write(defaultsPatch('tornEdges', v)),
      ),
      'Zero gives a clean rectangle.',
    ),
    row(
      'Paper grain',
      number(
        typeof d.grain === 'number' ? d.grain : 1,
        0,
        3,
        '',
        (v) => void write(defaultsPatch('grain', v)),
      ),
    ),
    row(
      'Tape',
      choice(
        typeof d.tape === 'string' ? (d.tape as 'none' | 'one' | 'two') : 'one',
        [
          ['none', 'None'],
          ['one', 'One strip'],
          ['two', 'Two strips'],
        ] as const,
        (v) => void write(defaultsPatch('tape', v)),
      ),
    ),
    row(
      'Movement',
      choice(
        current.motion,
        [
          ['auto', 'Follow the system'],
          ['full', 'Full'],
          ['reduced', 'Reduced'],
          ['off', 'Off'],
        ] as const,
        (v) => void write({ motion: v }),
      ),
      'Following the system respects "reduce motion" in your accessibility settings.',
    ),
  );
}

function sectionKeeping(): HTMLElement {
  return h(
    'div',
    { class: 'ssec-body' },
    row(
      'Let old notes be deleted automatically',
      toggle(
        current.retention.autoDelete,
        (v) => void write({ retention: { ...current.retention, autoDelete: v } }),
      ),
      current.retention.autoDelete
        ? 'Trashed notes are destroyed once their time is up.'
        : 'Off, so nothing is ever destroyed unless you empty the trash yourself. The trash ' +
            'simply grows, which costs almost nothing.',
    ),
    row(
      'Keep trashed notes for',
      number(
        current.retention.trashDays,
        1,
        3650,
        'days',
        (v) => void write({ retention: { ...current.retention, trashDays: v } }),
      ),
    ),
    row(
      'Keep notes whose page vanished for',
      number(
        current.retention.detachedDays,
        1,
        3650,
        'days',
        (v) => void write({ retention: { ...current.retention, detachedDays: v } }),
      ),
    ),
  );
}

function sectionBackup(): HTMLElement {
  return h(
    'div',
    { class: 'ssec-body' },
    h(
      'p',
      { class: 'ssec-note' },
      'Export ZIP in the bar above works now and needs no permission at all. It contains every ' +
        'note, its position, its style and its images, as one archive you can keep anywhere.',
    ),
    row(
      'Check for a new version once a day',
      toggle(current.autoCheckUpdates, (v) => void write({ autoCheckUpdates: v })),
      'The only network request this extension can make. Off unless you turn it on, and it ' +
        'asks permission the first time. No cookies, no referrer, nothing about you — it reads ' +
        'the release list and compares one version number.',
    ),
    row(
      'Language',
      choice(
        current.locale,
        [
          ['', 'Follow the browser'],
          ['en', 'English'],
          ['fa', 'فارسی'],
        ] as const,
        (v) => void write({ locale: v }).then(() => repaint()),
      ),
    ),
  );
}

/** What the keys do. Read-only: Firefox owns the bindings, in about:addons > Manage shortcuts. */
function sectionKeys(): HTMLElement {
  const ON_A_NOTE: Array<[string, string]> = [
    ['S', 'Open this note’s settings — colour, type, direction, paper'],
    ['C', 'Next colour'],
    ['D', 'Draw'],
    ['P / E', 'Pen / eraser'],
    ['L', 'Lock the note'],
    ['M', 'Collapse it'],
    ['Delete', 'Send it to the trash'],
    ['Arrows', 'Nudge it — Shift ×10, Ctrl ×25'],
    ['Alt + arrows', 'Resize it'],
    ['Ctrl + Z / Y', 'Undo / redo, across everything you did on this page'],
    ['Escape', 'Leave drawing, or leave the text'],
  ];
  const IN_THE_TEXT: Array<[string, string]> = [
    ['Ctrl + Enter', 'Finish writing and select the note itself'],
    ['Ctrl + Z / Y', 'Undo / redo'],
    ['Ctrl + V', 'Paste text, or an image'],
  ];
  const ANYWHERE: Array<[string, string]> = [
    ['Alt + double-click', 'Make a note where you clicked'],
    ['Right-click', 'Add a note here, or on the selected text'],
  ];

  const table = (title: string, rows: Array<[string, string]>): HTMLElement => {
    const wrap = h('div', { class: 'keys' }, h('h4', { class: 'ssec-sub' }, title));
    for (const [key, what] of rows) {
      wrap.append(h('div', { class: 'keyrow' }, h('kbd', {}, key), h('span', {}, what)));
    }
    return wrap;
  };

  return h(
    'div',
    { class: 'ssec-body' },
    h(
      'p',
      { class: 'ssec-note' },
      'Grabbing a note’s header selects the note, which is the state the single-key shortcuts ' +
        'work in. Clicking the text puts you in the editor, where every key is just a key.',
    ),
    table('On a selected note', ON_A_NOTE),
    table('While writing', IN_THE_TEXT),
    table('On any page', ANYWHERE),
    h(
      'p',
      { class: 'ssec-note' },
      'The browser-wide shortcuts — new note, next note, the cabinet — are Firefox’s to bind: ' +
        'about:addons → the gear → Manage Extension Shortcuts.',
    ),
  );
}

const BUILDERS: Record<string, () => HTMLElement> = {
  where: sectionWhere,
  closing: sectionClosing,
  look: sectionLook,
  keeping: sectionKeeping,
  backup: sectionBackup,
  keys: sectionKeys,
};

// -------------------------------------------------------------------- shell

let mounted: HTMLElement | null = null;

/**
 * Swap the pane for a freshly built one.
 *
 * The old node has to be captured BEFORE building, because `build()` reassigns `mounted` to
 * the node it makes. Reading `mounted` afterwards gave the new node, so this was
 * `fresh.replaceWith(fresh)` on a node with no parent -- a silent no-op, and clicking a tab
 * did nothing at all. Found by clicking a tab and watching nothing happen.
 */
function repaint(): void {
  const old = mounted;
  if (!old) return;
  const fresh = build();
  old.replaceWith(fresh);
}

function build(): HTMLElement {
  const section = SECTIONS[active] ?? SECTIONS[0];
  if (!section) throw new Error('no sections');

  const tabs = h('div', { class: 'stabs', role: 'tablist' });
  SECTIONS.forEach((s, i) => {
    const b = h(
      'button',
      { type: 'button', role: 'tab', class: 'stab', 'aria-selected': String(i === active) },
      s.tab,
    );
    b.addEventListener('click', () => {
      active = i;
      repaint();
    });
    tabs.append(b);
  });

  const card = h(
    'div',
    { class: 'scard' },
    h('h3', { class: 'ssec-title' }, section.title),
    (BUILDERS[section.key] ?? sectionWhere)(),
  );

  const wrap = h('div', { class: 'settings' }, tabs, card);
  mounted = wrap;
  return wrap;
}

/** Load the settings and build the pane. `notify` runs whenever anything is written. */
export async function settingsPane(notify?: () => void): Promise<HTMLElement> {
  onChanged = notify ?? null;
  current = await loadSettings().catch(() => DEFAULT_SETTINGS);
  return build();
}
