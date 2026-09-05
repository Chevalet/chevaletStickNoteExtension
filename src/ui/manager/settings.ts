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
 *
 * ## And the honest way for a control to come back
 *
 * **Earlier versions kept per note** was removed by that rule in 0.0.10, because `addRevision`
 * had no callers. It is back in 0.0.11, and the order matters: the store snapshots the previous
 * text on an edit, `setRevisionKeep` carries this number down to it from both the background
 * and the cabinet, and the History button in the notes bar reads them. The control returned
 * after the code that reads it, not before -- which is the only way a setting should ever
 * reappear on a page.
 */

import { getMeta } from '~/bg/db/notes.ts';
import {
  type BackupState,
  backupFilename,
  MAX_HOURS,
  MIN_HOURS,
  RING,
} from '~/bg/jobs/autobackup.ts';
import { lastImport } from '~/bg/jobs/import.ts';
import { DEFAULT_SETTINGS, loadSettings, type Settings, saveSettings } from '~/bg/settings.ts';
import { DEFAULT_STYLE, PALETTES } from '~/cs/note/theme.ts';
import { FONTS, fontById, fontStack } from '~/shared/fonts.ts';
import { t } from '~/shared/i18n.ts';
import { applyTheme, asThemeChoice, type ThemeChoice } from '../chrome-theme.ts';

type Patch = Partial<Settings>;

let current: Settings = DEFAULT_SETTINGS;
let active = 0;
let onChanged: (() => void) | null = null;

/**
 * The panes, named when they are DRAWN.
 *
 * A function, not a constant. As a constant the six `t()` calls ran at module load -- before
 * the language had been read out of storage -- so the tabs said WHERE CLOSING LOOK for the
 * life of the page however Persian the rest of it was. Seen in a screenshot; the same shape
 * of mistake as the theme button's labels, two files over.
 */
const sections = () =>
  [
    { key: 'where', tab: t('setTabWhere'), title: t('setTitleWhere') },
    { key: 'closing', tab: t('setTabClosing'), title: t('setTitleClosing') },
    { key: 'look', tab: t('setTabLook'), title: t('setTitleLook') },
    { key: 'keeping', tab: t('setTabKeeping'), title: t('setTitleKeeping') },
    { key: 'backup', tab: t('setTabBackup'), title: t('setTitleBackup') },
    { key: 'keys', tab: t('setTabKeys'), title: t('setTitleKeys') },
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

/**
 * Segmented choice, drawn as a strip of index-card tabs.
 *
 * `styleFor` lets one option carry its own type -- used by the Type picker so each face is
 * shown in itself. Nothing else uses it, and nothing else should: a segmented control whose
 * options look different from each other for any reason other than being samples of what they
 * select is just a jumbled row of buttons.
 */
function choice<T extends string>(
  value: T,
  options: ReadonlyArray<readonly [T, string]>,
  onSet: (v: T) => void,
  styleFor?: (v: T) => string,
): HTMLElement {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, label] of options) {
    const b = h(
      'button',
      { type: 'button', role: 'radio', 'aria-checked': String(v === value) },
      label,
    );
    if (styleFor) b.style.fontFamily = styleFor(v);
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
  /*
   * A text input with a numeric keypad, not type="number".
   *
   * Firefox draws its own spin box for a number input even under appearance:none, in the
   * platform's light widget colours -- so on the dark theme there was a small grey box
   * floating in the corner of the field, the one native artefact left on the page. The clamp
   * below is what min and max were doing anyway, and it runs however the field was filled in.
   * `aria-valuemin`/`max` keep the range announced to a screen reader.
   */
  const input = h('input', {
    class: 'num',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    role: 'spinbutton',
    'aria-valuemin': String(min),
    'aria-valuemax': String(max),
  }) as HTMLInputElement;
  input.value = String(value);
  input.setAttribute('aria-valuenow', String(value));
  input.addEventListener('change', () => {
    const typed = Number.parseInt(input.value.replace(/[^0-9]/g, ''), 10);
    const n = Number.isFinite(typed) ? Math.min(max, Math.max(min, typed)) : value;
    input.value = String(n);
    input.setAttribute('aria-valuenow', String(n));
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
      t('setShowUndecided'),
      toggle(current.defaultEnabled, (v) => void write({ defaultEnabled: v })),
      t('setShowUndecidedNote'),
    ),
    row(
      t('setKeepPrivate'),
      toggle(current.persistPrivateNotes, (v) => void write({ persistPrivateNotes: v })),
      current.persistPrivateNotes ? t('setKeepPrivateOn') : t('setKeepPrivateOff'),
    ),
  );

  if (rules.length === 0) {
    body.append(h('p', { class: 'ssec-empty' }, t('setNoSiteRules')));
    return body;
  }

  const list = h('div', { class: 'rules' });
  for (const [origin, rule] of rules) {
    const drop = h('button', { type: 'button', class: 'rule-drop' }, t('setForget'));
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
        h('span', { class: 'rule-state' }, rule === 'on' ? t('setNotesOn') : t('setNotesOff')),
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
      t('setWarnClosing'),
      choice(
        current.guard.mode,
        [
          ['never', t('setNever')],
          ['unsaved', t('setUnsavedEdits')],
          ['hasNotes', t('setAnyNotes')],
        ] as const,
        (v) => void write({ guard: { ...current.guard, mode: v } }),
      ),
      t('setWarnClosingNote'),
    ),
    row(
      t('setTabsWatched'),
      number(
        current.guard.maxArmedTabs,
        0,
        10,
        t('setTabs'),
        (v) => void write({ guard: { ...current.guard, maxArmedTabs: v } }),
      ),
      t('setTabsWatchedNote'),
    ),
  );
}

function sectionLook(): HTMLElement {
  return h(
    'div',
    { class: 'ssec-body' },

    h('h4', { class: 'ssec-sub' }, t('setThisApp')),
    row(
      t('setColours'),
      choice(
        asThemeChoice(current.theme),
        [
          ['auto', t('setFollowBrowser')],
          ['dark', t('setDark')],
          ['light', t('setLight')],
        ] as const,
        (v) => {
          // Applied here as well as written, so the page changes under the click rather than
          // on the next load. The button at the foot of the cabinet does the same.
          applyTheme(v as ThemeChoice);
          void write({ theme: v as ThemeChoice });
        },
      ),
      t('setColoursNote'),
    ),
    row(
      t('setMovement'),
      choice(
        current.motion,
        [
          ['auto', t('setFollowSystem')],
          ['full', t('setFull')],
          ['reduced', t('setReduced')],
          ['off', t('setOff')],
        ] as const,
        (v) => void write({ motion: v }),
      ),
      t('setMovementNote'),
    ),

    h('h4', { class: 'ssec-sub' }, t('setNewNoteLooks')),
    h('p', { class: 'ssec-note' }, t('setNewNoteLooksNote')),
    row(
      t('setPaper'),
      palettePicker(def('palette'), (id) => void write(defaultsPatch('palette', id))),
    ),
    row(
      t('setType'),
      choice(
        def('fontFamily'),
        FONTS.map((f) => [f.id, f.label] as const),
        (v) => void write(defaultsPatch('fontFamily', v)),
        // Each name written in its own face. The faces are bundled, and this is an extension
        // page, so a plain url() in `fontFaceCss` is all it takes.
        (v) => fontStack(fontById(v)),
      ),
      t('setTypeNote'),
    ),
    row(
      t('setTextSize'),
      slider(
        def('fontSize'),
        11,
        28,
        1,
        (v) => `${v}px`,
        (v) => void write(defaultsPatch('fontSize', v)),
      ),
      t('setTextSizeNote'),
    ),
    row(
      t('setLineHeight'),
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
      t('setDirection'),
      choice(
        def('dir'),
        [
          ['auto', t('setAutomatic')],
          ['rtl', t('setRtl')],
          ['ltr', t('setLtr')],
        ] as const,
        (v) => void write(defaultsPatch('dir', v)),
      ),
      t('setDirectionNote'),
    ),
    row(
      t('setTornEdge'),
      slider(
        def('tornEdges'),
        0,
        6,
        0.2,
        (v) => (v === 0 ? 'clean cut' : v.toFixed(1)),
        (v) => void write(defaultsPatch('tornEdges', v)),
      ),
      t('setTornEdgesNote'),
    ),
    row(
      t('setGrain'),
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
      t('setTape'),
      choice(
        def('tape'),
        [
          ['none', t('setNone')],
          ['one', t('setOneStrip')],
          ['two', t('setTwoStrips')],
        ] as const,
        (v) => void write(defaultsPatch('tape', v)),
      ),
    ),
    row(
      t('setShadow'),
      choice(
        def('shadow'),
        [
          ['hard', t('setHard')],
          ['soft', t('setSoft')],
          ['none', t('setNone')],
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
      t('setAutoDelete'),
      toggle(
        current.retention.autoDelete,
        (v) => void write({ retention: { ...current.retention, autoDelete: v } }).then(repaint),
      ),
      current.retention.autoDelete ? t('setAutoDeleteOn') : t('setAutoDeleteOff'),
    ),
    row(
      t('setKeepTrashedFor'),
      number(
        current.retention.trashDays,
        1,
        3650,
        t('setDays'),
        (v) => void write({ retention: { ...current.retention, trashDays: v } }),
      ),
      t('setKeepTrashedNote'),
    ),
    h('p', { class: 'ssec-sub' }, t('setVersionHistory')),
    row(
      t('setVersionsPerNote'),
      number(
        current.retention.revisionsPerNote,
        0,
        200,
        t('setVersions'),
        (v) =>
          void write({ retention: { ...current.retention, revisionsPerNote: v } }).then(repaint),
      ),
      current.retention.revisionsPerNote === 0 ? t('setVersionsZero') : t('setVersionsSome'),
    ),
  );
}

/**
 * The scheduled-backup rows.
 *
 * Async because the state of this section is not in `Settings` alone: whether the browser has
 * actually granted `downloads`, and what the last run did, both live outside it. Rendering
 * "On, every 12 hours" while the permission has been revoked in about:addons would be a lie
 * the settings pane tells confidently, so it asks.
 */
async function backupRows(): Promise<HTMLElement> {
  const box = h('div');
  const granted = await browser.permissions
    .contains({ permissions: ['downloads'] })
    .catch(() => false);
  const last = await getMeta<BackupState>('backup.last').catch(() => undefined);

  box.append(
    row(
      t('setSaveAuto'),
      toggle(current.backup.enabled && granted, (v) => {
        void (async () => {
          if (v) {
            /*
             * The permission is requested from THIS click, and the switch only moves if it is
             * granted. `permissions.request` needs a user gesture, so it has to happen here
             * rather than in the background -- and a switch left on while the browser has
             * refused the permission would be a control that promises something it cannot do.
             */
            const ok = await browser.permissions
              .request({ permissions: ['downloads'] })
              .catch(() => false);
            if (!ok) {
              repaint();
              return;
            }
          }
          await write({ backup: { ...current.backup, enabled: v } });
          repaint();
        })();
      }),
      granted || !current.backup.enabled
        ? 'A ZIP into your Downloads folder, on a timer. It asks Firefox for permission to ' +
            'save files the first time you switch it on, and nothing else in the extension ' +
            'uses that permission.'
        : t('setDownloadsGone'),
    ),
    row(
      t('setHowOften'),
      number(
        current.backup.everyHours,
        MIN_HOURS,
        MAX_HOURS,
        'hours',
        (v) => void write({ backup: { ...current.backup, everyHours: v } }).then(repaint),
      ),
      `Three files are kept, written in turn — chevalet-note-auto-1.zip to -${RING}.zip — so ` +
        'the newest is never the only one you have. Older runs overwrite the oldest of the ' +
        'three; nothing else is deleted. Does nothing while the switch above is off.',
    ),
  );

  const now = h('button', { type: 'button', class: 'btn' }, t('setBackupNow'));
  const said = h('span', { class: 'srow-note' });
  // Hidden until there is something to say. An always-present empty row draws a dashed rule
  // across the sheet for nothing, which is how a settings page starts to look unfinished.
  const saidRow = h('div', { class: 'srow is-quiet' }, h('div', { class: 'srow-text' }, said));
  saidRow.hidden = true;
  const say = (text: string): void => {
    said.textContent = text;
    saidRow.hidden = false;
  };
  now.addEventListener('click', () => {
    void (async () => {
      now.disabled = true;
      say(t('setWorking'));
      const reply = (await browser.runtime.sendMessage({ t: 'backup/run' }).catch(() => null)) as {
        ok?: boolean;
        data?: BackupState;
      } | null;
      now.disabled = false;
      const state = reply?.data;
      if (!state) say(t('setNoAnswer'));
      else if (!state.ok) say(state.error ?? t('setItFailed'));
      else if (state.notes === 0) say(t('setNothingToBackUp'));
      else {
        say(
          `Saved ${state.notes} note${state.notes === 1 ? '' : 's'} to ${backupFilename(state.slot)}.`,
        );
      }
    })();
  });

  box.append(
    row(
      t('setRunOneNow'),
      h('div', { class: 'sbtn-row' }, now),
      // Deliberately the same code path as the alarm: a manual backup that works while the
      // scheduled one is broken is the most misleading state this feature could be in.
      last
        ? `Last run ${new Date(last.at).toLocaleString()} — ${
            last.ok
              ? `${last.notes} note${last.notes === 1 ? '' : 's'}, ${Math.round(last.bytes / 1024)} kB, into ${backupFilename(last.slot)}`
              : (last.error ?? 'failed')
          }.`
        : t('setNeverRun'),
    ),
  );
  box.append(saidRow);

  box.append(h('p', { class: 'ssec-note' }, t('setBackupNotNote')));

  return box;
}

function sectionBackup(): HTMLElement {
  const box = h('div', { class: 'ssec-body' }, h('p', { class: 'ssec-note' }, t('setExportNote')));
  /*
   * What the last import did, if there has been one.
   *
   * An import is the most consequential thing this extension can be asked to do, and the only
   * record of it was a dialog that closed. `rememberImport` has been writing this down since
   * the import path landed and nothing read it back -- which is the same fault as a setting
   * nothing consults, one layer along.
   */
  const importedRow = h('div');
  box.append(importedRow);
  void lastImport()
    .then((last) => {
      if (!last) return;
      const when = new Date(last.at).toLocaleString();
      const bits = [
        `${last.created} created`,
        `${last.updated} overwritten`,
        `${last.skipped} left alone`,
      ];
      if (last.assets) bits.push(`${last.assets} image${last.assets === 1 ? '' : 's'}`);
      if (last.failed.length) bits.push(`${last.failed.length} failed`);
      importedRow.append(
        h(
          'p',
          { class: 'ssec-note' },
          `Last import: ${when} — ${bits.join(', ')}.` +
            (last.exportedAt ? ` The archive was made on ${last.exportedAt.slice(0, 10)}.` : ''),
        ),
      );
    })
    .catch(() => undefined);
  box.append(h('p', { class: 'ssec-sub' }, t('setAutomatically')));
  // The permission check and the last-run line are async; the section itself is not, so the
  // rows are appended when they arrive rather than making every section async for one of them.
  const slot = h('div');
  box.append(slot);
  void backupRows().then((rows) => slot.replaceWith(rows));
  box.append(h('p', { class: 'ssec-sub' }, t('keyOther')));
  box.append(
    row(
      t('setCheckDaily'),
      toggle(current.autoCheckUpdates, (v) => void write({ autoCheckUpdates: v })),
      t('setCheckDailyNote'),
    ),
    row(
      t('setLanguage'),
      choice(
        current.locale,
        [
          ['', t('setFollowBrowser')],
          ['en', 'English'],
          ['fa', 'فارسی'],
        ] as const,
        (v) => void write({ locale: v }).then(() => repaint()),
      ),
      t('setLanguageNote'),
    ),
  );
  return box;
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
    h('p', { class: 'ssec-note' }, t('keySelectedExplain')),
  );

  // What Firefox has actually bound, not what the manifest asked for.
  const described: Record<string, string> = {
    'new-note': t('keyNewNoteMiddle'),
    'toggle-tab': t('keyToggleTab'),
    'cycle-notes': t('keyFocusNext'),
    'open-manager': t('keyOpenCabinet'),
  };
  const browserRows: Array<[string, string]> = [];
  try {
    for (const c of await browser.commands.getAll()) {
      const what = described[c.name ?? ''] ?? c.description ?? c.name ?? '';
      browserRows.push([c.shortcut ? c.shortcut : t('keyUnbound'), what]);
    }
  } catch {
    // Falling back to the manifest's own suggestions is better than an empty section.
    browserRows.push(
      ['Alt+Shift+A', described['new-note'] as string],
      ['Alt+Shift+S', described['toggle-tab'] as string],
      ['Alt+Shift+K', described['cycle-notes'] as string],
      [t('keyUnbound'), described['open-manager'] as string],
    );
  }
  body.append(table(t('keyInFirefox'), browserRows));

  const hint = h('p', { class: 'ssec-note' }, t('keyFirefoxOwns'));
  const open = h('button', { type: 'button', class: 'btn' }, t('keyOpenFirefoxShortcuts'));
  open.addEventListener('click', () => {
    void (async () => {
      try {
        // Firefox restricts which about: pages an extension may open, and which ones are
        // allowed has moved between versions. So this tries, and says what to do by hand if
        // the browser refuses, rather than failing silently.
        await browser.tabs.create({ url: 'about:addons' });
      } catch {
        hint.classList.add('warn');
        hint.textContent = t('keyCannotOpen');
      }
    })();
  });
  body.append(h('div', { class: 'keyact' }, open), hint);

  body.append(
    table(t('keyOnSelected'), [
      ['S', t('keyNoteSettings')],
      ['C', t('keyNextColour')],
      ['D', t('keyDraw')],
      ['P / E', t('keyPenEraser')],
      ['Z', t('keyUndoStroke')],
      ['L', t('keyLock')],
      ['M', t('keyCollapse')],
      ['Enter / F2', t('keyStartWriting')],
      ['Delete', t('keySendToTrash')],
      [t('keyArrows'), t('keyNudge')],
      [t('keyAltArrows'), t('keyResize')],
      ['Escape', t('keyLeaveDrawing')],
    ]),

    table(t('keyWhileWriting'), [
      ['Ctrl + B', t('keyBold')],
      ['Ctrl + I', t('keyItalic')],
      ['Ctrl + Shift + X', t('keyStrike')],
      ['Ctrl + E', t('keyCode')],
      ['Ctrl + K', t('keyLink')],
      ['Ctrl + Shift + .', t('keyQuote')],
      ['Ctrl + Shift + 8', t('keyBullets')],
      ['Ctrl + Shift + 7', t('keyNumbers')],
      ['Ctrl + Shift + 9', t('keyTasks')],
      ['Ctrl + Shift + Enter', t('keyTickTask')],
      ['Ctrl + Shift + 1', t('keyHeading')],
      ['Ctrl + Shift + D', t('keyInsertDate')],
      ['Ctrl + Space', t('keyClearFormat')],
      ['Ctrl + V', t('keyPaste')],
      ['Ctrl + Enter', t('keyFinishWriting')],
    ]),

    table(t('keyAnywhereNote'), [
      ['Ctrl + Z', t('keyUndoAll')],
      ['Ctrl + Y', t('keyRedo')],
    ]),

    table(t('keyOnAnyPage'), [
      [t('keyAltDoubleClick'), t('keyAltDouble')],
      [t('keyRightClickCap'), t('keyRightClick')],
    ]),

    h('p', { class: 'ssec-note' }, t('keyNoCtrlU')),
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
  const all = sections();
  const section = all[active] ?? all[0];
  if (!section) throw new Error('no sections');

  const tabs = h('div', { class: 'stabs', role: 'tablist' });
  all.forEach((s, i) => {
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
