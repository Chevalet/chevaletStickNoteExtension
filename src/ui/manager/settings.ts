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
 *
 * ## What was wrong with this pane, and the rule that comes out of it
 *
 * Four separate things in here did nothing, or the wrong thing:
 *
 *  - **Torn edges** and **Paper grain** were whole-number 0-3 boxes for fields whose real
 *    ranges are 0-6 and 0-0.6. So the grain box showed "1" when the actual default is 0.16,
 *    and typing 1 into it pushed grain six times past its maximum. Both are sliders on their
 *    real ranges now, matching the per-note panel exactly.
 *  - **Keep notes whose page vanished for N days** has been removed. Nothing in the codebase
 *    ever marks a note detached -- there is no `detachedAt` on a note record -- so the number
 *    was unreachable by any code path.
 *  - **Movement** was read by nothing at all. It now reaches every open tab; see
 *    `NoteView.physicsNow`.
 *  - **Keep trashed notes for N days** was likewise read by nothing; `bg/jobs/retention.ts`
 *    now makes it true.
 *
 * The rule that comes out of it: a control in here must be traceable to code that reads it. If
 * it cannot be, it does not belong on the page -- a switch that writes to storage and changes
 * nothing is worse than no switch, because it makes a promise on the app's behalf.
 */

import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from '~/bg/settings.ts';
import { DEFAULT_STYLE, FONTS, PALETTES } from '~/cs/note/theme.ts';
import { applyTheme, asThemeChoice, type ThemeChoice } from '../chrome-theme.ts';

type Patch = Partial<Settings>;

let current: Settings = DEFAULT_SETTINGS;
let active = 0;
let onChanged: (() => void) | null = null;

const SECTIONS = [
  { key: 'where', tab: 'Where', title: 'Where notes appear' },
  { key: 'closing', tab: 'Closing', title: 'Closing a tab' },
  { key: 'look', tab: 'Look', title: 'Appearance' },
  { key: 'keeping', tab: 'Keeping', title: 'Keeping and deleting' },
  { key: 'backup', tab: 'Backup', title: 'Backup and language' },
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

/**
 * A slider with a live readout, for the fields that are fractional.
 *
 * Torn edges and grain are 0-6 and 0-0.6 with fractional defaults, and both used to be
 * whole-number boxes here -- which meant the pane displayed a number the note had never had
 * and wrote back a value outside the range the note art expects. A slider cannot express an
 * out-of-range value at all, which is the right shape of control for a continuous quantity.
 *
 * Writes on `input` rather than `change`, so dragging shows the result immediately the way the
 * per-note panel does.
 */
function slider(
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onSet: (v: number) => void,
): HTMLElement {
  const input = h('input', {
    class: 'rng',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
  }) as HTMLInputElement;
  input.value = String(value);
  const out = h('span', { class: 'rngout' }, format(value));
  input.addEventListener('input', () => {
    const n = Number(input.value);
    out.textContent = format(n);
    onSet(n);
  });
  return h('div', { class: 'rngwrap' }, input, out);
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

/**
 * A stored note default, or the real built-in.
 *
 * Every one of these used to be written as `typeof d.x === 'number' ? d.x : 15` with the
 * fallback typed out by hand -- which is how the pane came to show 1 for a torn edge whose
 * actual default is 2.4, and 1 for a grain whose actual default is 0.16. Reading the fallback
 * from `DEFAULT_STYLE` means the pane cannot disagree with the note.
 */
function def<K extends keyof typeof DEFAULT_STYLE>(key: K): NonNullable<(typeof DEFAULT_STYLE)[K]> {
  const stored = current.noteDefaults[key as string];
  const fallback = DEFAULT_STYLE[key];
  return (typeof stored === typeof fallback ? stored : fallback) as never;
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
  return h(
    'div',
    { class: 'ssec-body' },

    h('h4', { class: 'ssec-sub' }, 'This app'),
    row(
      'Colours',
      choice(
        asThemeChoice(current.theme),
        [
          ['auto', 'Follow the browser'],
          ['dark', 'Dark'],
          ['light', 'Light'],
        ] as const,
        (v) => {
          // Applied here as well as written, so the page changes under the click rather than
          // on the next load. The button at the foot of the cabinet does the same.
          applyTheme(v as ThemeChoice);
          void write({ theme: v as ThemeChoice });
        },
      ),
      'The cabinet, the popup and this page. Notes keep their own paper colour — a sticky ' +
        'note that went dark because your system did would be a different note. There is a ' +
        'shortcut for this at the bottom of the cabinet.',
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
      'How much the paper tilts, swings and lags as you drag it. Following the system respects ' +
        '"reduce motion" in your accessibility settings. This is a ceiling: a note set to less ' +
        'movement of its own accord keeps it.',
    ),

    h('h4', { class: 'ssec-sub' }, 'How a new note looks'),
    h(
      'p',
      { class: 'ssec-note' },
      'Any note can still be changed on its own — press S on a note, or use the sliders button ' +
        'in its header — and a note keeps whatever it changed even when you alter the defaults ' +
        'here.',
    ),
    row(
      'Paper',
      palettePicker(def('palette'), (id) => void write(defaultsPatch('palette', id))),
    ),
    row(
      'Type',
      choice(
        def('fontFamily'),
        FONTS.map((f) => [f.id, f.label] as const),
        (v) => void write(defaultsPatch('fontFamily', v)),
      ),
    ),
    row(
      'Text size',
      slider(
        def('fontSize'),
        11,
        28,
        1,
        (v) => `${v}px`,
        (v) => void write(defaultsPatch('fontSize', v)),
      ),
      'The same range a single note offers, so a default can never be a size a note could not be.',
    ),
    row(
      'Line height',
      slider(
        def('lineHeight'),
        1.1,
        2.2,
        0.05,
        (v) => v.toFixed(2),
        (v) => void write(defaultsPatch('lineHeight', v)),
      ),
    ),
    row(
      'Direction',
      choice(
        def('dir'),
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
      slider(
        def('tornEdges'),
        0,
        6,
        0.2,
        (v) => (v === 0 ? 'clean cut' : v.toFixed(1)),
        (v) => void write(defaultsPatch('tornEdges', v)),
      ),
      'Zero gives a clean rectangle.',
    ),
    row(
      'Paper grain',
      slider(
        def('grain'),
        0,
        0.6,
        0.02,
        (v) => (v === 0 ? 'smooth' : v.toFixed(2)),
        (v) => void write(defaultsPatch('grain', v)),
      ),
    ),
    row(
      'Tape',
      choice(
        def('tape'),
        [
          ['none', 'None'],
          ['one', 'One strip'],
          ['two', 'Two strips'],
        ] as const,
        (v) => void write(defaultsPatch('tape', v)),
      ),
    ),
    row(
      'Shadow',
      choice(
        def('shadow'),
        [
          ['hard', 'Hard'],
          ['soft', 'Soft'],
          ['none', 'None'],
        ] as const,
        (v) => void write(defaultsPatch('shadow', v)),
      ),
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
        (v) => void write({ retention: { ...current.retention, autoDelete: v } }).then(repaint),
      ),
      current.retention.autoDelete
        ? 'Trashed notes are destroyed once their time is up. The sweep runs four times a day, ' +
            'and a trashed note carrying no deletion date is never destroyed.'
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
      'Counted from the day a note went into the trash, and it keeps the whole of its last ' +
        'day. Does nothing while the switch above is off.',
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
      'Covers the popup and the options page. This page and the notes themselves are English ' +
        'only for now — the translation exists, the cabinet has not been wired to it yet.',
    ),
  );
}

// --------------------------------------------------------------------- keys

/**
 * The complete keyboard reference, and the route to changing what can be changed.
 *
 * Two kinds of shortcut live here, and the difference is not cosmetic:
 *
 *  - **Browser commands** -- new note, next note, the cabinet. Firefox owns these, they work
 *    with no page focused, and they are rebindable. The list below reads the CURRENT binding
 *    from `browser.commands.getAll()` rather than repeating what the manifest suggested, so a
 *    shortcut rebound in Firefox is reflected here rather than quietly disagreeing with it.
 *  - **Note keys** -- S, C, D, and the Ctrl chords in the text. These are ours, handled in the
 *    page, and Firefox cannot bind them: `commands` requires a modifier, so a bare `S` can
 *    never be a browser command however much one might want it to be. They are fixed, and they
 *    now work on **any keyboard layout** -- matched on the physical key when the layout gives
 *    no Latin letter, which is exactly what was broken before 0.0.10.
 */
async function keyRows(): Promise<HTMLElement> {
  const table = (title: string, rows: Array<[string, string]>): HTMLElement => {
    const wrap = h('div', { class: 'keys' }, h('h4', { class: 'ssec-sub' }, title));
    for (const [key, what] of rows) {
      wrap.append(h('div', { class: 'keyrow' }, h('kbd', {}, key), h('span', {}, what)));
    }
    return wrap;
  };

  const body = h(
    'div',
    { class: 'ssec-body' },
    h(
      'p',
      { class: 'ssec-note' },
      'Grabbing a note’s header selects the note, which is the state the single-key shortcuts ' +
        'work in. Clicking its text puts you in the editor, where the Ctrl chords apply and ' +
        'every plain key is just a letter. Escape takes you from the text back to the note.',
    ),
  );

  // What Firefox has actually bound, not what the manifest asked for.
  const described: Record<string, string> = {
    'new-note': 'Stick a note in the middle of the page',
    'toggle-tab': 'Turn notes off, or back on, for this tab',
    'cycle-notes': 'Move focus to the next note on the page',
    'open-manager': 'Open the cabinet',
  };
  const browserRows: Array<[string, string]> = [];
  try {
    for (const c of await browser.commands.getAll()) {
      const what = described[c.name ?? ''] ?? c.description ?? c.name ?? '';
      browserRows.push([c.shortcut ? c.shortcut : 'not set', what]);
    }
  } catch {
    // Falling back to the manifest's own suggestions is better than an empty section.
    browserRows.push(
      ['Alt+Shift+A', described['new-note'] as string],
      ['Alt+Shift+S', described['toggle-tab'] as string],
      ['Alt+Shift+K', described['cycle-notes'] as string],
      ['not set', described['open-manager'] as string],
    );
  }
  body.append(table('Anywhere in Firefox — rebindable', browserRows));

  const hint = h(
    'p',
    { class: 'ssec-note' },
    'Firefox keeps these bindings itself, and only Firefox can change them: about:addons → the ' +
      'gear at the top right → Manage Extension Shortcuts. Whatever you set there is what this ' +
      'list shows.',
  );
  const open = h('button', { type: 'button', class: 'btn' }, 'Open Firefox’s shortcut settings');
  open.addEventListener('click', () => {
    void (async () => {
      try {
        // Firefox restricts which about: pages an extension may open, and which ones are
        // allowed has moved between versions. So this tries, and says what to do by hand if
        // the browser refuses, rather than failing silently.
        await browser.tabs.create({ url: 'about:addons' });
      } catch {
        hint.classList.add('warn');
        hint.textContent =
          'Firefox will not let an extension open that page. Copy about:addons into the ' +
          'address bar yourself, then use the gear at the top right → Manage Extension ' +
          'Shortcuts.';
      }
    })();
  });
  body.append(h('div', { class: 'keyact' }, open), hint);

  body.append(
    table('On a selected note', [
      ['S', 'This note’s settings — colour, type, size, direction, paper'],
      ['C', 'Next colour'],
      ['D', 'Draw'],
      ['P / E', 'Pen / eraser'],
      ['Z', 'Undo the last brush stroke'],
      ['L', 'Lock the note'],
      ['M', 'Collapse it'],
      ['Enter / F2', 'Start writing'],
      ['Delete', 'Send it to the trash'],
      ['Arrows', 'Nudge it — Shift ×10, Ctrl ×25'],
      ['Alt + arrows', 'Resize it'],
      ['Escape', 'Leave drawing'],
    ]),

    table('While writing', [
      ['Ctrl + B', 'Bold'],
      ['Ctrl + I', 'Italic'],
      ['Ctrl + Shift + X', 'Strikethrough'],
      ['Ctrl + E', 'Code'],
      ['Ctrl + K', 'Make a link'],
      ['Ctrl + Shift + .', 'Quote'],
      ['Ctrl + Shift + 8', 'Bullet list'],
      ['Ctrl + Shift + 7', 'Numbered list'],
      ['Ctrl + Shift + 9', 'Task list'],
      ['Ctrl + Shift + Enter', 'Tick or untick the task on this line'],
      ['Ctrl + Shift + 1', 'Heading — again for a smaller one, again for none'],
      ['Ctrl + Shift + D', 'Insert today’s date'],
      ['Ctrl + Space', 'Clear formatting'],
      ['Ctrl + V', 'Paste text, or an image'],
      ['Ctrl + Enter', 'Finish writing and select the note itself'],
    ]),

    table('Anywhere in a note', [
      ['Ctrl + Z', 'Undo — typing, colour, moving, resizing, drawing, deleting, in order'],
      ['Ctrl + Y', 'Redo — Ctrl + Shift + Z as well'],
    ]),

    table('On any page', [
      ['Alt + double-click', 'Make a note where you clicked'],
      ['Right-click', 'Add a note here, or on the selected text'],
    ]),

    h(
      'p',
      { class: 'ssec-note' },
      'There is no Ctrl+U: markdown has no underline, so there is nothing for it to produce ' +
        'that a note could render. Ctrl+Shift+M and Ctrl+Shift+K are left alone as well — ' +
        'those are Firefox’s own, for responsive design mode and the console.',
    ),
  );

  return body;
}

/**
 * The Keys section is the only one that has to await anything, so it renders an empty shell and
 * replaces it when the bindings come back. Everything else is synchronous and stays that way.
 */
function sectionKeys(): HTMLElement {
  const shell = h('div', { class: 'ssec-body' });
  void keyRows().then((built) => shell.replaceWith(built));
  return shell;
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
