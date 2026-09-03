/**
 * Per-note settings.
 *
 * Every note carries a SPARSE diff against the user's defaults, so changing a global default
 * still moves every note that never overrode that field. The panel makes that visible: a
 * field the note has overridden is marked, and can be reset back to following the default.
 *
 * Built with plain DOM inside the shadow root. It is a form, not a hot path, but it lives in
 * the content-script bundle, so it stays dependency-free.
 */

import { DEFAULT_STYLE, FONTS, type NoteStyle, PALETTES } from './theme.ts';

export interface SettingsPanelHost {
  /** Current resolved style (defaults + this note's overrides). */
  style(): NoteStyle;
  /** The note's own overrides, so the panel can show what is customised. */
  overrides(): Partial<NoteStyle>;
  /** The user's defaults, for the "follows default" markers. */
  defaults(): NoteStyle;
  change(patch: Partial<NoteStyle>): void;
  /** Clear one override so the field follows the default again. */
  reset(key: keyof NoteStyle): void;
  /** Promote this note's current style to the user's default for every new note. */
  saveAsDefault(): void;
  close(): void;
}

type Field = keyof NoteStyle;

export class SettingsPanel {
  readonly el: HTMLDivElement;
  private readonly host: SettingsPanelHost;
  private readonly marks = new Map<Field, HTMLButtonElement>();

  constructor(host: SettingsPanelHost) {
    this.host = host;
    this.el = document.createElement('div');
    this.el.className = 'settings';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Note settings');
    this.build();
    // Escape closes, and the panel never lets a key escape into the page.
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') host.close();
    });
  }

  refresh(): void {
    const overrides = this.host.overrides();
    for (const [key, mark] of this.marks) {
      const custom = overrides[key] !== undefined;
      mark.hidden = !custom;
      mark.title = custom ? `Custom. Click to follow the default again.` : '';
    }
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    const s = this.host.style();

    this.el.append(
      this.section('Paper', [
        this.swatches(),
        this.color('paper', 'Paper', s.paper ?? '#ffe94a'),
        this.color('ink', 'Ink', s.ink ?? '#14110e'),
        this.color('accent', 'Accent', s.accent ?? '#ff2e63'),
      ]),

      this.section('Type', [
        this.select(
          'fontFamily',
          'Font',
          FONTS.map((f) => [f.id, f.label] as const),
          s.fontFamily,
        ),
        this.range('fontSize', 'Size', 11, 28, 1, s.fontSize, (v) => `${v}px`),
        this.range('lineHeight', 'Line height', 1.1, 2.2, 0.05, s.lineHeight, (v) => v.toFixed(2)),
        this.select(
          'dir',
          'Direction',
          [
            ['auto', 'Auto (per paragraph)'],
            ['ltr', 'Left to right'],
            ['rtl', 'Right to left'],
          ],
          s.dir,
        ),
        this.select(
          'align',
          'Align',
          [
            ['start', 'Start'],
            ['center', 'Centre'],
            ['end', 'End'],
          ],
          s.align,
        ),
      ]),

      this.section('Material', [
        this.range(
          'opacity',
          'Opacity',
          0.25,
          1,
          0.05,
          s.opacity,
          (v) => `${Math.round(v * 100)}%`,
        ),
        this.range('tornEdges', 'Torn edge', 0, 6, 0.2, s.tornEdges, (v) => v.toFixed(1)),
        this.range('grain', 'Grain', 0, 0.6, 0.02, s.grain, (v) => v.toFixed(2)),
        this.select(
          'tape',
          'Tape',
          [
            ['none', 'None'],
            ['one', 'One corner'],
            ['two', 'Two corners'],
          ],
          s.tape,
        ),
        this.select(
          'shadow',
          'Shadow',
          [
            ['hard', 'Hard'],
            ['soft', 'Soft'],
            ['none', 'None'],
          ],
          s.shadow,
        ),
        this.select(
          'physics',
          'Motion',
          [
            ['full', 'Full paper physics'],
            ['reduced', 'Reduced'],
            ['off', 'Off'],
          ],
          s.physics,
        ),
      ]),

      this.footer(),
    );
    this.refresh();
  }

  private section(title: string, rows: HTMLElement[]): HTMLElement {
    const el = document.createElement('section');
    const h = document.createElement('h4');
    h.textContent = title;
    el.append(h, ...rows);
    return el;
  }

  /** A row: label, the control, and the "this is customised" marker. */
  private row(key: Field, label: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'set-row';
    const name = document.createElement('span');
    name.className = 'set-label';
    name.textContent = label;

    const mark = document.createElement('button');
    mark.type = 'button';
    mark.className = 'set-mark';
    mark.textContent = '·';
    mark.tabIndex = -1;
    mark.hidden = true;
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      this.host.reset(key);
      this.syncControls();
    });
    this.marks.set(key, mark);

    wrap.append(name, control, mark);
    return wrap;
  }

  private swatches(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'swatches';
    for (const p of PALETTES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.title = p.label;
      b.setAttribute('aria-label', p.label);
      b.style.background = p.paper;
      b.style.borderColor = p.ink;
      b.dataset.palette = p.id;
      b.addEventListener('click', () => {
        // Picking a palette clears any hand-picked colours, or the palette would not show.
        this.host.change({ palette: p.id });
        for (const k of ['paper', 'ink', 'accent'] as const) this.host.reset(k);
        this.syncControls();
      });
      wrap.append(b);
    }
    return this.row('palette', 'Palette', wrap);
  }

  private color(key: 'paper' | 'ink' | 'accent', label: string, value: string): HTMLElement {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = normalizeHex(value);
    input.addEventListener('input', () => this.host.change({ [key]: input.value }));
    input.dataset.field = key;
    return this.row(key, label, input);
  }

  private range(
    key: Field,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    format: (v: number) => string,
  ): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'set-range';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.dataset.field = key;
    const out = document.createElement('output');
    out.textContent = format(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = format(v);
      this.host.change({ [key]: v });
      this.refresh();
    });
    wrap.append(input, out);
    return this.row(key, label, wrap);
  }

  private select(
    key: Field,
    label: string,
    options: ReadonlyArray<readonly [string, string]>,
    value: string,
  ): HTMLElement {
    const sel = document.createElement('select');
    sel.dataset.field = key;
    for (const [v, text] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      o.selected = v === value;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      this.host.change({ [key]: sel.value });
      this.refresh();
    });
    return this.row(key, label, sel);
  }

  private footer(): HTMLElement {
    const f = document.createElement('div');
    f.className = 'set-footer';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'set-btn primary';
    save.textContent = 'Save as my default';
    save.title = 'Every new note starts like this one';
    save.addEventListener('click', () => {
      this.host.saveAsDefault();
      this.syncControls();
    });

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'set-btn';
    reset.textContent = 'Reset this note';
    reset.addEventListener('click', () => {
      for (const key of Object.keys(DEFAULT_STYLE) as Field[]) this.host.reset(key);
      this.syncControls();
    });

    f.append(save, reset);
    return f;
  }

  /** Re-read every control from the current resolved style. */
  private syncControls(): void {
    const s = this.host.style();
    for (const input of this.el.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-field]',
    )) {
      const key = input.dataset.field as Field;
      const value = s[key];
      if (value === undefined) continue;
      if (input instanceof HTMLInputElement && input.type === 'color') {
        input.value = normalizeHex(String(value));
      } else {
        input.value = String(value);
        const out = input.parentElement?.querySelector('output');
        if (out && input instanceof HTMLInputElement) {
          out.textContent = input.step.includes('.') ? Number(input.value).toFixed(2) : input.value;
        }
      }
    }
    for (const b of this.el.querySelectorAll<HTMLElement>('.swatch')) {
      b.classList.toggle('is-on', b.dataset.palette === s.palette);
    }
    this.refresh();
  }
}

/** `<input type="color">` only accepts `#rrggbb`. */
function normalizeHex(value: string): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return '#ffe94a';
  const hex = m[1] as string;
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`.toLowerCase();
}
