/**
 * One sticky note. Plan section 6.
 *
 * The hot path is deliberately imperative. `pointermove` sets spring *targets* and touches no
 * DOM at all; the shared loop reads those targets and writes exactly six values per frame --
 * four transforms and two opacities, every one of them a compositor property. Nothing in
 * `step()` reads layout, so a drag cannot trigger a forced synchronous reflow no matter what
 * the host page is doing.
 */

import type { InkStroke } from '~/bg/db/schema.ts';
import { tapeStrip, tornRectPath } from '~/cs/art/paper.ts';
import { leverFrom, TUNING as POSE, poseFromVelocity, smoothing } from '~/cs/physics/pose.ts';
import {
  type Animatable,
  type Loop,
  retune,
  type Spring,
  snap,
  spring,
  step,
} from '~/cs/physics/spring.ts';
import { caretOffset, type Edit, type History, offsetToPosition } from './history.ts';
import { InkLayer } from './ink.ts';
import { renderMarkdown, toggleTaskInSource } from './markdown.ts';
import { SettingsPanel } from './SettingsPanel.ts';
import {
  DEFAULT_STYLE,
  fontById,
  isDarkPaper,
  type NoteStyle,
  PALETTES,
  paletteById,
  resolveStyle,
  styleVars,
} from './theme.ts';

declare const __DEV__: boolean;

// Spring frequencies, hand-tuned in spikes/paper. The velocity -> pose mapping lives in
// physics/pose.ts, where it can be unit-tested without a DOM.
const TUNING = {
  pos: { w: 34, z: 1.0 },
  lift: { w: 28, z: 1.0 },
  rz: { w: 16, z: 0.58 },
  tilt: { w: 18, z: 0.55 },
  skew: { w: 20, z: 0.62 },
  curl: { w: 14, z: 0.7 },
} as const;

const CURL_LEVELS = 5;
const PALETTE_IDS = PALETTES.map((p) => p.id);

/**
 * Toolbar. 26px targets, full opacity on hover, real icons -- deliberately not the 18px
 * half-transparent glyphs the first version shipped, which nobody could hit.
 */
const TOOLBAR: ReadonlyArray<readonly [name: string, label: string, path: string]> = [
  [
    'pen',
    'Draw (D)',
    'M3 17.3V21h3.7L17.6 10.1l-3.7-3.7L3 17.3zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z',
  ],
  [
    'palette',
    'Colour (C)',
    'M12 3a9 9 0 1 0 0 18c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  ],
  [
    'lock',
    'Lock (L)',
    'M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zM9 7a3 3 0 0 1 6 0v2H9V7zm3 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z',
  ],
  ['collapse', 'Collapse (M)', 'M5 11h14v2H5z'],
  ['delete', 'Delete (Del)', 'M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2z'],
] as const;

const ICON_PEN =
  'M3 17.3V21h3.7L17.6 10.1l-3.7-3.7L3 17.3zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z';
const ICON_ERASER =
  'M16.2 3.3a1.8 1.8 0 0 1 2.5 0l2 2a1.8 1.8 0 0 1 0 2.5l-8 8H20v2h-9.5l-2-2-3.2-3.2a1.8 1.8 0 0 1 0-2.5l10.9-6.8zM7.7 13.4l2.9 2.9 4.2-4.2-2.9-2.9-4.2 4.2z';
const ICON_CLEAR =
  'M6 7h12l-1 14H7L6 7zm3-4h6l1 2h4v2H4V5h4l1-2zm1 7v8h1.5v-8H10zm3.5 0v8H15v-8h-1.5z';

function icon(path: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}
const COLLAPSED = 34;
const MIN_W = 140;
const MIN_H = 90;

/**
 * Upper bound on a note's size, from the viewport.
 *
 * `window.innerWidth` is legitimately 0 while a document is still loading and in some
 * background/hidden tabs. Clamping against a zero viewport silently squashes every note to
 * the minimum size -- which is exactly what happened the first time this ran in a preview
 * pane. So the cap only applies when the viewport reports a believable size.
 */
function viewportCap(): [number, number] {
  const w = window.innerWidth || document.documentElement.clientWidth || 0;
  const h = window.innerHeight || document.documentElement.clientHeight || 0;
  return [
    w > MIN_W ? w * 0.9 : Number.POSITIVE_INFINITY,
    h > MIN_H ? h * 0.9 : Number.POSITIVE_INFINITY,
  ];
}

export interface NoteInit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text: string;
  style?: Partial<NoteStyle>;
  collapsed?: boolean;
  locked?: boolean;
  ink?: { strokes: InkStroke[]; w: number; h: number };
}

export interface NoteHost {
  loop: Loop;
  layer: HTMLElement;
  defaults?: NoteStyle;
  /** Bring this note to the front; returns the new z. */
  raise(note: NoteView): number;
  onChange?(note: NoteView): void;
  onInk?(note: NoteView, ink: { strokes: InkStroke[]; w: number; h: number }): void;
  onDelete?(note: NoteView): void;
  /** The page's undo history. Notes record into it; the page applies from it. */
  history?: History;
  /** The note's markdown source changed by something other than typing. */
  onText?(note: NoteView, text: string): void;
  onStyle?(note: NoteView, overrides: Partial<NoteStyle>): void;
  onSaveDefault?(note: NoteView, style: NoteStyle): void;
  /** Store a pasted or dropped image and return the id to reference it by. */
  onAsset?(note: NoteView, file: Blob, name: string): Promise<string | null>;
  /** Turn a stored asset id into something renderable, without any network fetch. */
  resolveAsset?(id: string): HTMLElement | null;
}

const NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] =>
  document.createElementNS(NS, tag);

export class NoteView implements Animatable {
  readonly id: string;
  readonly el: HTMLDivElement;

  private readonly host: NoteHost;
  private readonly shadowEl: SVGSVGElement;
  private readonly shadowPath: SVGPathElement;
  private readonly cardEl: HTMLDivElement;
  private readonly faceEl: HTMLDivElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly previewEl: HTMLDivElement;
  private editing = false;
  private readonly grainEl: HTMLCanvasElement;
  private readonly paperPath: SVGPathElement;
  private readonly tapeG: SVGGElement;
  private readonly curlPaths: SVGPathElement[] = [];
  private actionsEl!: HTMLDivElement;
  private ink: InkLayer | null = null;
  private inkBar: HTMLDivElement | null = null;

  private style: NoteStyle;
  private overrides: Partial<NoteStyle>;
  private settings: SettingsPanel | null = null;
  private w: number;
  private h: number;
  private zIndex: number;
  private collapsed: boolean;
  private locked: boolean;

  // springs
  private readonly px: Spring;
  private readonly py: Spring;
  private readonly lz: Spring;
  private readonly rz: Spring;
  private readonly rx: Spring;
  private readonly ry: Spring;
  private readonly sk: Spring;
  private readonly curl: Spring;

  // drag state
  private grabbed = false;
  private pointerId: number | null = null;
  private grabDx = 0;
  private grabDy = 0;
  private lever = 0;
  private vx = 0;
  private vy = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private promoted = false;
  private uncaptured = false;

  constructor(init: NoteInit, host: NoteHost) {
    this.id = init.id;
    this.host = host;
    this.overrides = { ...init.style };
    this.style = resolveStyle(this.overrides, host.defaults);
    this.w = init.w;
    this.h = init.h;
    this.zIndex = init.z;
    this.collapsed = init.collapsed ?? false;
    this.locked = init.locked ?? false;

    const eps = 0.05;
    this.px = spring(TUNING.pos.w, TUNING.pos.z, eps, init.x);
    this.py = spring(TUNING.pos.w, TUNING.pos.z, eps, init.y);
    this.lz = spring(TUNING.lift.w, TUNING.lift.z, 0.002, 0);
    this.rz = spring(TUNING.rz.w, TUNING.rz.z, 0.01, 0);
    this.rx = spring(TUNING.tilt.w, TUNING.tilt.z, 0.01, 0);
    this.ry = spring(TUNING.tilt.w, TUNING.tilt.z, 0.01, 0);
    this.sk = spring(TUNING.skew.w, TUNING.skew.z, 0.01, 0);
    this.curl = spring(TUNING.curl.w, TUNING.curl.z, 0.002, 0);

    // ---- structure -------------------------------------------------------
    const note = document.createElement('div');
    note.className = 'note';
    note.dataset.id = init.id;
    note.tabIndex = -1;
    note.setAttribute('role', 'group');

    // The drop shadow is the SAME torn path, not a rectangle behind it -- a rectangular
    // shadow peeks out past every tear and instantly reads as a bug.
    this.shadowEl = svg('svg');
    this.shadowEl.setAttribute('class', 'shadow');
    this.shadowEl.setAttribute('aria-hidden', 'true');
    this.shadowEl.setAttribute('preserveAspectRatio', 'none');
    this.shadowPath = svg('path');
    this.shadowEl.append(this.shadowPath);

    const tilt = div('tilt');
    this.cardEl = div('card');
    this.faceEl = div('face');

    this.grainEl = document.createElement('canvas');
    this.grainEl.className = 'grain';
    this.grainEl.setAttribute('aria-hidden', 'true');

    const art = svg('svg');
    art.setAttribute('class', 'paper');
    art.setAttribute('aria-hidden', 'true');
    art.setAttribute('preserveAspectRatio', 'none');
    this.paperPath = svg('path');
    this.paperPath.setAttribute('class', 'paper-fill');
    const halftone = svg('path');
    halftone.setAttribute('class', 'paper-halftone');
    this.tapeG = svg('g');
    this.tapeG.setAttribute('class', 'tape');
    art.append(this.paperPath, halftone, this.tapeG);
    this.halftonePath = halftone;

    const curlWrap = svg('svg');
    curlWrap.setAttribute('class', 'curl');
    curlWrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < CURL_LEVELS; i++) {
      const p = svg('path');
      p.setAttribute('class', 'curl-level');
      p.style.opacity = '0';
      curlWrap.append(p);
      this.curlPaths.push(p);
    }
    this.curlEl = curlWrap;

    const header = document.createElement('header');
    header.className = 'handle';
    header.append(div('grip-dots'));
    const actions = div('actions');
    // 18px glyphs at 55% opacity were unhittable in practice -- the first person to try the
    // build could not delete a note at all. These are 26px targets with real icons.
    for (const [name, label, path] of TOOLBAR) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `act act-${name}`;
      b.tabIndex = -1;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.append(icon(path));
      actions.append(b);
    }
    header.append(actions);
    this.actionsEl = actions;

    this.bodyEl = div('body');
    this.bodyEl.setAttribute('role', 'textbox');
    this.bodyEl.setAttribute('aria-multiline', 'true');
    this.bodyEl.tabIndex = -1;
    this.bodyEl.textContent = init.text;
    this.bodyEl.dataset.placeholder = 'Type. Markdown works.';
    this.applyEditable();

    // Rendered markdown lives in its own element. The source stays the single truth; the
    // preview is always a pure function of it, so there is never a "which one is right"
    // question when the two could disagree.
    this.previewEl = div('preview');
    this.previewEl.dataset.placeholder = 'Click to write. Markdown works.';

    const grips = div('grips');
    for (const g of ['se', 's', 'e'] as const) {
      const el = div(`grip grip-${g}`);
      el.dataset.grip = g;
      grips.append(el);
    }

    this.inkInit = init.ink ?? null;
    this.faceEl.append(this.grainEl, art, header, this.bodyEl, this.previewEl, curlWrap, grips);
    this.cardEl.append(this.faceEl);
    tilt.append(this.cardEl);
    note.append(this.shadowEl, tilt);
    this.el = note;

    this.applyStyle();
    this.resizeArt();
    this.writeTransforms();
    this.el.style.zIndex = String(this.zIndex);
    if (this.collapsed) this.el.classList.add('is-collapsed');

    // Source while you are in it, rendered the moment you leave.
    this.bodyEl.addEventListener('focus', () => this.setEditing(true));
    this.bodyEl.addEventListener('blur', () => {
      this.flushTextRun();
      this.setEditing(false);
    });
    // beforeinput knows what the text WAS; input knows what it became. Recording needs both,
    // and a keydown-based snapshot would miss paste, drag-drop and IME.
    this.bodyEl.addEventListener('beforeinput', () => {
      if (this.host.history?.isApplying) return;
      this.pendingText = { text: this.text, caret: this.caretNow() };
    });
    this.bodyEl.addEventListener('input', () => {
      this.el.setAttribute('aria-label', `Sticky note: ${this.text.slice(0, 40)}`);
      const was = this.pendingText;
      this.pendingText = null;
      if (!was) return;
      this.note(
        {
          kind: 'text',
          before: was.text,
          after: this.text,
          caretBefore: was.caret,
          caretAfter: this.caretNow(),
        },
        // Consecutive typing coalesces into one step; anything else breaks the run.
        `text:${this.id}`,
      );
    });
    this.bodyEl.addEventListener('paste', this.onPaste);
    this.previewEl.addEventListener('pointerdown', this.onPreviewPointerDown);

    header.addEventListener('pointerdown', this.onGrab);
    for (const el of grips.children)
      el.addEventListener('pointerdown', this.onResizeGrab as EventListener);
    note.addEventListener('pointerdown', (e) => {
      this.bringToFront();
      // However the buttons end up unreachable, a click on a collapsed note always opens it.
      if (this.collapsed && !(e.target as HTMLElement).closest('.act')) {
        e.preventDefault();
        this.setCollapsed(false);
      }
    });
    note.addEventListener('keydown', this.onKeyDown);
    this.actionsEl.addEventListener('click', this.onAction);

    host.layer.append(note);
    this.setEditing(false);
    if (this.inkInit && this.inkInit.strokes.length > 0) this.enableInk(false);
  }

  private readonly halftonePath: SVGPathElement;
  private readonly inkInit: { strokes: InkStroke[]; w: number; h: number } | null;
  private readonly curlEl: SVGSVGElement;

  // ------------------------------------------------------------------ state

  get position(): { x: number; y: number } {
    return { x: this.px.t, y: this.py.t };
  }

  get size(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  get text(): string {
    return this.bodyEl.textContent ?? '';
  }

  moveTo(x: number, y: number, animate = true): void {
    this.px.t = x;
    this.py.t = y;
    if (!animate) {
      snap(this.px, x);
      snap(this.py, y);
      this.writeTransforms();
    } else {
      this.host.loop.add(this);
    }
  }

  resize(w: number, h: number): void {
    const [maxW, maxH] = viewportCap();
    this.w = Math.max(MIN_W, Math.min(w, maxW));
    this.h = Math.max(MIN_H, Math.min(h, maxH));
    this.sizeBoxes();
    this.scheduleArt();
  }

  /**
   * The only place that writes width/height.
   *
   * Collapse is handled HERE rather than in CSS. These are inline styles, so a stylesheet rule
   * cannot override them: the CSS-only version left a collapsed note at full size with its
   * content hidden -- a blank sheet with no visible controls and no way back.
   */
  private sizeBoxes(): void {
    const w = this.collapsed ? COLLAPSED : this.w;
    const h = this.collapsed ? COLLAPSED : this.h;
    for (const el of [this.faceEl, this.shadowEl]) {
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }
  }

  /** Apply an override. The note keeps only what it actually changed, so a later change to
   *  the user's defaults still moves every field this note never touched. */
  setStyle(patch: Partial<NoteStyle>): void {
    const was = { ...this.overrides };
    this.overrides = { ...this.overrides, ...patch };
    this.style = resolveStyle(this.overrides, this.host.defaults);
    this.applyStyle();
    this.resizeArt();
    this.settings?.refresh();
    this.note({ kind: 'style', before: was, after: { ...this.overrides } }, `style:${this.id}`);
    this.host.onStyle?.(this, this.overrides);
  }

  /** Drop one override so the field follows the user's default again. */
  resetStyle(key: keyof NoteStyle): void {
    if (this.overrides[key] === undefined) return;
    const was = { ...this.overrides };
    const { [key]: _dropped, ...rest } = this.overrides;
    this.overrides = rest;
    this.style = resolveStyle(this.overrides, this.host.defaults);
    this.applyStyle();
    this.resizeArt();
    this.settings?.refresh();
    this.note({ kind: 'style', before: was, after: { ...this.overrides } });
    this.host.onStyle?.(this, this.overrides);
  }

  get styleOverrides(): Partial<NoteStyle> {
    return { ...this.overrides };
  }

  toggleSettings(force?: boolean): void {
    const open = force ?? this.settings === null;
    if (!open) {
      this.settings?.el.remove();
      this.settings = null;
      this.actionsEl.querySelector('.act-settings')?.classList.remove('is-on');
      return;
    }
    if (this.settings) return;
    this.settings = new SettingsPanel({
      style: () => this.style,
      overrides: () => this.overrides,
      defaults: () => this.host.defaults ?? (DEFAULT_STYLE as NoteStyle),
      change: (patch) => this.setStyle(patch),
      reset: (key) => this.resetStyle(key),
      saveAsDefault: () => this.host.onSaveDefault?.(this, this.style),
      close: () => this.toggleSettings(false),
    });
    this.faceEl.append(this.settings.el);
    this.actionsEl.querySelector('.act-settings')?.classList.add('is-on');
    this.bringToFront();
  }

  // ---------------------------------------------------------------- markdown

  /**
   * Swap between the markdown source and its rendering.
   *
   * Only one of the two is in the layout at a time, so there is no chance of the caret landing
   * in a rendered node -- an editor that lets you type into your own output is how markdown
   * editors end up with unexplainable state.
   */
  private setEditing(on: boolean): void {
    if (this.locked && on) return;
    this.editing = on;
    this.el.classList.toggle('is-editing', on);
    if (on) {
      this.previewEl.textContent = '';
      return;
    }
    this.renderPreview();
  }

  /**
   * Text direction, written in ONE place.
   *
   * The source and the rendered preview are two elements showing the same text, and the bug
   * this method exists to stop is them disagreeing. `dir` used to be set on the source only,
   * so a Persian note was right-aligned while you typed and jumped to the left the moment you
   * clicked away -- then "fixed itself" when you clicked back in, which is exactly how it was
   * reported.
   *
   * With `auto`, each TOP-LEVEL block gets its own `dir` as well: a container's `dir="auto"`
   * resolves once, from the first strong character in the whole note, and per block is what a
   * note mixing Persian and English actually needs.
   *
   * Top-level and no deeper, deliberately. `dir="auto"` skips any descendant that carries its
   * own `dir`, so marking every `<li>` left the `<ul>` with no text of its own to judge and it
   * fell back to LTR -- right-aligned items with their bullets stranded on the left. A list
   * therefore takes one direction from its own content, which is the right granularity for a
   * sticky note.
   *
   * Code is the exception at any depth: a fenced block stays LTR even when it opens with a
   * Persian comment, because code is not prose.
   */
  private applyDirection(): void {
    const dir = this.style.dir;
    this.bodyEl.dir = dir;
    this.previewEl.dir = dir;

    if (dir === 'auto') {
      for (const el of this.previewEl.children) (el as HTMLElement).dir = 'auto';
    }
    for (const pre of this.previewEl.querySelectorAll('pre')) pre.dir = 'ltr';
  }

  private renderPreview(): void {
    const source = this.text;
    this.previewEl.textContent = '';
    if (!source.trim()) return;
    this.previewEl.append(
      renderMarkdown(source, {
        readOnly: this.locked,
        resolveAsset: (id) => this.host.resolveAsset?.(id) ?? null,
        onToggleTask: (index, checked) => {
          // The click edits the SOURCE and re-renders, rather than mutating the rendering.
          const next = toggleTaskInSource(this.text, index, checked);
          this.bodyEl.textContent = next;
          this.renderPreview();
          this.host.onChange?.(this);
          this.host.onText?.(this, next);
        },
      }),
    );
    // The children are new, so their direction is too.
    this.applyDirection();
  }

  /**
   * A click on the preview normally means "let me edit this" -- except on the things that are
   * interactive in their own right, where hijacking the click would be maddening.
   */
  private readonly onPreviewPointerDown = (e: PointerEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest('input, a, canvas, img')) return;
    // preventDefault stops the browser placing its own caret, so the click point is passed on
    // and honoured instead -- clicking into the middle of a sentence should not jump to the
    // end. If the platform cannot resolve the point, focusBody falls back to the browser's
    // caret rather than to none at all.
    e.preventDefault();
    this.focusBody({ clientX: e.clientX, clientY: e.clientY });
  };

  /**
   * Paste. Text falls through to the browser (contenteditable=plaintext-only already flattens
   * it); an image is stored as a blob and referenced from the markdown, because a note that
   * embedded base64 in its own text would bloat every read of that note forever.
   */
  private readonly onPaste = (e: ClipboardEvent): void => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      e.preventDefault();
      void this.attachImage(file, file.name || 'pasted image');
      return;
    }
  };

  /** Store an image and drop a reference to it at the end of the note. */
  async attachImage(file: Blob, name: string): Promise<void> {
    const id = await this.host.onAsset?.(this, file, name);
    if (!id) return;
    const ref = `![${name.replace(/[[\]]/g, '')}](att:${id})`;
    const current = this.text;
    const next = current.trim() ? `${current}\n\n${ref}` : ref;
    this.bodyEl.textContent = next;
    this.renderPreview();
    this.host.onText?.(this, next);
    this.host.onChange?.(this);
  }

  /** Re-render the preview, e.g. after an asset finishes loading. */
  refreshPreview(): void {
    if (!this.editing) this.renderPreview();
  }
  // ----------------------------------------------------------------- actions

  private readonly onAction = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest('.act');
    if (!btn) return;
    e.stopPropagation();
    const name = [...btn.classList].find((c) => c.startsWith('act-'))?.slice(4);
    switch (name) {
      case 'pen':
        this.enableInk(!this.ink?.isEnabled);
        break;
      case 'palette':
        this.cyclePalette();
        break;
      case 'settings':
        this.toggleSettings();
        break;
      case 'lock':
        this.setLocked(!this.locked);
        break;
      case 'collapse':
        this.setCollapsed(!this.collapsed);
        break;
      case 'delete':
        this.host.onDelete?.(this);
        break;
    }
  };

  /**
   * Keyboard, once a note has focus. Notes stay out of the page's tab order (plan section 6),
   * so this only fires for a note the user deliberately focused -- it can never shadow a
   * shortcut belonging to the host page.
   */
  /** The ui as it was when the current gesture started. */
  private uiFrom: Record<string, unknown> | null = null;
  /** Snapshot taken on beforeinput, so the recorder knows what the text WAS. */
  private pendingText: { text: string; caret: number } | null = null;
  /** The strokes as of the last commit, for diffing an ink change into a delta. */
  private lastStrokes: InkStroke[] = [];

  // ------------------------------------------------------------------- history

  /** Record an edit, unless we are inside an undo already. */
  private note(edit: Edit, mergeKey: string | null = null): void {
    const history = this.host.history;
    if (!history || history.isApplying) return;
    history.record({ noteId: this.id, edit, mergeKey, at: Date.now() });
  }

  /**
   * End the current run of typing, so the next edit is its own undo step.
   *
   * Called on blur and before an undo. Without it, typing, undoing, and typing again would
   * merge across the undo and produce a step that never existed.
   */
  private flushTextRun(): void {
    this.pendingText = null;
    this.host.history?.breakRun();
  }

  /**
   * Where the caret is, as a character offset.
   *
   * Falls back to the end of the text when the platform gives no shadow-aware selection --
   * Firefox has no `ShadowRoot.getSelection()`, so an undo there restores the text exactly and
   * the caret approximately. Better than refusing to record the edit.
   */
  private caretNow(): number {
    const root = this.bodyEl.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const sel = root.getSelection?.();
    const anchor = sel?.anchorNode;
    if (!sel || !anchor || !this.bodyEl.contains(anchor)) return this.text.length;
    try {
      return caretOffset(this.bodyEl, anchor, sel.anchorOffset);
    } catch {
      return this.text.length;
    }
  }

  /** Undo/redo of a text edit. Replaces the text and puts the caret back. */
  applyText(text: string, caret: number): void {
    this.bodyEl.textContent = text;
    if (!this.editing) this.renderPreview();
    else this.restoreCaret(caret);
    this.el.setAttribute('aria-label', `Sticky note: ${text.slice(0, 40)}`);
    this.host.onText?.(this, text);
    this.host.onChange?.(this);
  }

  private restoreCaret(caret: number): void {
    const root = this.bodyEl.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const sel = root.getSelection?.();
    if (!sel) return;
    try {
      const pos = offsetToPosition(this.bodyEl, caret);
      const range = document.createRange();
      range.setStart(pos.node, Math.min(pos.offset, (pos.node.nodeValue ?? '').length));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      /* the text is restored, which is the part that matters */
    }
  }

  /** Undo/redo of a style change. Replaces the whole override set. */
  applyStyleSet(overrides: Record<string, unknown>): void {
    this.overrides = { ...overrides } as Partial<NoteStyle>;
    this.style = resolveStyle(this.overrides, this.host.defaults);
    this.applyStyle();
    this.resizeArt();
    this.settings?.refresh();
    this.host.onStyle?.(this, this.overrides);
    this.host.onChange?.(this);
  }

  /** Undo/redo of a move, resize, collapse or lock. Sparse: only what is named. */
  applyUi(ui: Record<string, unknown>): void {
    if (typeof ui.x === 'number' && typeof ui.y === 'number') this.moveTo(ui.x, ui.y);
    if (typeof ui.w === 'number' && typeof ui.h === 'number') this.resize(ui.w, ui.h);
    if (typeof ui.collapsed === 'boolean' && ui.collapsed !== this.collapsed) {
      this.setCollapsed(ui.collapsed);
    }
    if (typeof ui.locked === 'boolean' && ui.locked !== this.locked) this.setLocked(ui.locked);
    this.host.onChange?.(this);
  }

  /**
   * Undo/redo of an ink change.
   *
   * Creates the ink layer if the note does not have one yet -- undoing an erase on a note
   * whose drawing has not been opened this session still has to put the strokes back -- but
   * deliberately does NOT turn drawing mode on. An undo must not change which tool you are
   * holding.
   */
  applyInk(add: InkStroke[], remove: InkStroke[]): void {
    const ink = this.ensureInk();
    if (!ink) return;
    ink.patch(add, remove);
    this.lastStrokes = [...ink.toJSON().strokes];
    this.host.onInk?.(this, ink.toJSON());
    this.host.onChange?.(this);
  }

  /**
   * One undo step per gesture.
   *
   * Recorded on release rather than on move: a drag fires pointermove sixty times a second and
   * an undo stack with sixty entries for one drag is not an undo stack. `mergeKey` is null for
   * the same reason -- the gesture is already the unit.
   */
  private commitUi(): void {
    const from = this.uiFrom;
    this.uiFrom = null;
    if (!from) return;
    const to = this.uiNow();
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of Object.keys(to)) {
      if (from[k] !== to[k]) {
        before[k] = from[k];
        after[k] = to[k];
      }
    }
    // Position and size travel as pairs, so an undo cannot restore half of a move.
    if ('x' in after || 'y' in after) {
      before.x = from.x;
      before.y = from.y;
      after.x = to.x;
      after.y = to.y;
    }
    if ('w' in after || 'h' in after) {
      before.w = from.w;
      before.h = from.h;
      after.w = to.w;
      after.h = to.h;
    }
    this.note({ kind: 'ui', before, after });
  }

  /** The current ui, for recording the "before" side of a change. */
  private uiNow(): Record<string, unknown> {
    return {
      x: this.px.t,
      y: this.py.t,
      w: this.w,
      h: this.h,
      collapsed: this.collapsed,
      locked: this.locked,
    };
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Never interfere with typing, and never with an IME composition.
    if (e.isComposing || e.keyCode === 229) return;
    const root = this.el.getRootNode();
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;

    // Undo and redo come first, and work wherever focus is inside the note -- in the text as
    // much as on the note. preventDefault is essential in the text: without it the native
    // editor undoes as well and the two histories fight.
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && /^[zyZY]$/.test(e.key)) {
      const redo = e.key.toLowerCase() === 'y' || e.shiftKey;
      e.preventDefault();
      e.stopPropagation();
      this.flushTextRun();
      if (redo) this.host.history?.redo();
      else this.host.history?.undo();
      return;
    }

    // Escape always means "get me out of whatever mode I am in", wherever focus happens to be.
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (this.ink?.isEnabled) {
        this.enableInk(false);
        return;
      }
      if (active === this.bodyEl) {
        this.bodyEl.blur();
        this.el.focus({ preventScroll: true });
      }
      return;
    }

    if (active === this.bodyEl) {
      // Ctrl+Enter is the usual "I am done writing" chord, and it is the quickest route from
      // typing to the note-level shortcuts.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.bodyEl.blur();
        this.el.focus({ preventScroll: true });
      }
      // Everything else belongs to the text. A plain "d" is a letter, not a drawing toggle.
      return;
    }

    // The host no longer stops keyboard events -- see CONTAINED_EVENTS in host.ts, and the
    // Backspace bug that comment exists to prevent returning. Containment for the keys we
    // actually consume happens here instead, which is exactly the set where a page must not
    // also react: a note-level shortcut is ours, and nobody else's.
    const CONSUMED = new Set([
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'Enter',
      'F2',
      'Delete',
      'Backspace',
      'd',
      'D',
      'c',
      'C',
      's',
      'S',
      'l',
      'L',
      'm',
      'M',
      'p',
      'P',
      'e',
      'E',
      'z',
      'Z',
    ]);
    if (CONSUMED.has(e.key)) e.stopPropagation();

    const step = e.ctrlKey ? 25 : e.shiftKey ? 10 : 1;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (e.altKey) this.resize(this.w + dx * 10, this.h + dy * 10);
        else this.moveTo(this.px.t + dx, this.py.t + dy);
        this.host.onChange?.(this);
        break;
      }
      case 'Enter':
      case 'F2':
        e.preventDefault();
        this.focusBody();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.host.onDelete?.(this);
        break;
      case 'd':
      case 'D':
        this.enableInk(!this.ink?.isEnabled);
        break;
      case 'c':
      case 'C':
        this.cyclePalette();
        break;
      case 's':
      case 'S':
        this.toggleSettings();
        break;
      case 'l':
      case 'L':
        this.setLocked(!this.locked);
        break;
      case 'm':
      case 'M':
        this.setCollapsed(!this.collapsed);
        break;
      case 'p':
      case 'P':
        this.setInkTool('pen');
        break;
      case 'e':
      case 'E':
        this.setInkTool('eraser');
        break;
      case 'z':
      case 'Z':
        if (this.ink?.undo()) this.host.onInk?.(this, this.ink.toJSON());
        break;
    }
  };

  // --------------------------------------------------------------------- ink

  /** Turn the drawing layer on or off, creating it lazily the first time it is needed. */
  /** Make sure the ink layer exists, without changing whether drawing is active. */
  private ensureInk(): InkLayer | null {
    this.enableInk(this.ink?.isEnabled ?? false);
    return this.ink;
  }

  enableInk(on: boolean): void {
    if (!this.ink) {
      this.ink = new InkLayer(
        this.w,
        this.h,
        this.inkInit?.strokes ?? [],
        { color: 'var(--cn-ink)', size: 7, tool: 'pen' },
        (strokes) => {
          // A delta, not a snapshot: erasing one stroke out of a busy drawing must not copy
          // the drawing into the undo stack.
          const prev = this.lastStrokes;
          const added = strokes.filter((k) => !prev.includes(k));
          const removed = prev.filter((k) => !strokes.includes(k));
          this.lastStrokes = [...strokes];
          this.note({ kind: 'ink', added, removed });
          this.host.onInk?.(this, { strokes, w: this.w, h: this.h });
        },
      );
      // Above the text so a drawing can annotate what is written, below the corner curl.
      this.faceEl.insertBefore(this.ink.el, this.curlEl);
      this.lastStrokes = [...this.ink.toJSON().strokes];
    }
    this.ink.setEnabled(on);
    this.el.classList.toggle('is-inking', on);
    if (on) this.buildInkBar();
    else this.inkBar?.remove();
    // Without focus the note hears no keys, so Esc could not get you back out.
    if (on) this.el.focus({ preventScroll: true });
    this.actionsEl.querySelector('.act-pen')?.classList.toggle('is-on', on);
    // Drawing and editing are mutually exclusive; a caret under a pen is only confusing.
    this.bodyEl.setAttribute('contenteditable', on || this.locked ? 'false' : 'plaintext-only');
  }

  /** Pen / eraser / thickness / clear. Only exists while drawing is on. */
  private buildInkBar(): void {
    if (this.inkBar?.isConnected) return;
    const bar = div('inkbar');
    this.inkBar = bar;

    const tool = (name: 'pen' | 'eraser', label: string, path: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ink-tool ink-${name}`;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.append(icon(path));
      b.classList.toggle('is-on', (this.ink?.tool ?? 'pen') === name);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.ink?.setOptions({ tool: name });
        for (const other of bar.querySelectorAll('.ink-tool')) {
          other.classList.toggle('is-on', other === b);
        }
      });
      return b;
    };

    const size = document.createElement('input');
    size.type = 'range';
    size.min = '2';
    size.max = '22';
    size.step = '1';
    size.value = '7';
    size.className = 'ink-size';
    size.title = 'Thickness';
    size.setAttribute('aria-label', 'Stroke thickness');
    size.addEventListener('input', (e) => {
      e.stopPropagation();
      this.ink?.setOptions({ size: Number(size.value) });
    });
    size.addEventListener('pointerdown', (e) => e.stopPropagation());

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'ink-tool ink-clear';
    clear.title = 'Erase everything';
    clear.setAttribute('aria-label', 'Erase everything');
    clear.append(icon(ICON_CLEAR));
    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      this.ink?.clear();
      if (this.ink) this.host.onInk?.(this, this.ink.toJSON());
    });

    bar.append(
      tool('pen', 'Pen (P)', ICON_PEN),
      tool('eraser', 'Eraser (E)', ICON_ERASER),
      size,
      clear,
    );
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.faceEl.append(bar);
  }

  /** Switch between pen and eraser without leaving drawing mode. */
  setInkTool(tool: 'pen' | 'eraser'): void {
    if (!this.ink?.isEnabled) this.enableInk(true);
    this.ink?.setOptions({ tool });
    for (const b of this.inkBar?.querySelectorAll('.ink-tool') ?? []) {
      b.classList.toggle('is-on', b.classList.contains(`ink-${tool}`));
    }
  }

  get inkJSON(): { strokes: InkStroke[]; w: number; h: number } | null {
    return this.ink && this.ink.strokeCount > 0 ? this.ink.toJSON() : null;
  }

  clearInk(): void {
    this.ink?.clear();
  }

  /** Step to the next palette. The fastest possible recolour, and it needs no popup. */
  cyclePalette(): void {
    const i = PALETTE_IDS.indexOf(this.style.palette);
    this.setStyle({ palette: PALETTE_IDS[(i + 1) % PALETTE_IDS.length] as string });
    this.host.onChange?.(this);
  }
  /**
   * Slow every spring down by `scale` (1 = normal, 6 = six times slower).
   *
   * This is how the constants in TUNING were chosen: at 1x a settle is 380 ms and the eye
   * cannot separate the tilt from the spin from the curl. At 6x each degree of freedom is
   * legible on its own. Kept in the shipped class rather than the harness because it is also
   * how any future retune will be done.
   */
  setTimeScale(scale: number): void {
    const k = 1 / Math.max(0.05, scale);
    const t = TUNING;
    retune(this.px, t.pos.w * k, t.pos.z);
    retune(this.py, t.pos.w * k, t.pos.z);
    retune(this.lz, t.lift.w * k, t.lift.z);
    retune(this.rz, t.rz.w * k, t.rz.z);
    retune(this.rx, t.tilt.w * k, t.tilt.z);
    retune(this.ry, t.tilt.w * k, t.tilt.z);
    retune(this.sk, t.skew.w * k, t.skew.z);
    retune(this.curl, t.curl.w * k, t.curl.z);
    this.timeScale = scale;
  }

  private timeScale = 1;

  setCollapsed(next: boolean): void {
    if (next !== this.collapsed) {
      this.note({ kind: 'ui', before: { collapsed: this.collapsed }, after: { collapsed: next } });
    }
    this.collapsed = next;
    this.el.classList.toggle('is-collapsed', next);
    if (next) this.setEditing(false);
    this.resizeArt();
    this.host.onChange?.(this);
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  get styleNow(): NoteStyle {
    return this.style;
  }

  setLocked(next: boolean): void {
    if (next !== this.locked) {
      this.note({ kind: 'ui', before: { locked: this.locked }, after: { locked: next } });
    }
    this.locked = next;
    this.applyEditable();
    if (next) this.setEditing(false);
    else this.renderPreview();
    this.el.classList.toggle('is-locked', next);
    this.actionsEl.querySelector('.act-lock')?.classList.toggle('is-on', next);
    this.host.onChange?.(this);
  }

  /**
   * Put the caret in the body. Used after creating a note and after clicking the rendering.
   *
   * THE BUG THIS SHAPE EXISTS TO PREVENT RETURNING: this used to call
   * `selection.removeAllRanges()` and then `addRange()` with a range inside the note's shadow
   * root, without checking that the second call took effect.
   *
   * `ShadowRoot.getSelection()` is a Chromium extension to the spec. Firefox does not have it,
   * so the code fell through to `document.getSelection()`, whose `addRange()` cannot reliably
   * address a node inside a shadow tree. The `removeAllRanges()` destroyed the caret the
   * browser had just placed on focus, and nothing put one back. The result was a note you
   * could TYPE into -- the editor infers a position when text is inserted -- but could not
   * BACKSPACE in, because a delete needs a selection to delete backwards from and there was
   * none. Reported twice as "backspace doesn't work at all", and my first attempt to
   * reproduce it was invalid: injected key events carry no physical `code`, so the browser
   * delivers them as events and performs no editing, which makes every contenteditable look
   * broken under a synthetic test.
   *
   * So: focus first, and only ever move the caret when the move can be verified. When it
   * cannot, the caret the browser placed on focus is the correct one -- leave it alone.
   */
  focusBody(at?: { clientX: number; clientY: number }): void {
    if (this.locked) return;
    this.bringToFront();
    // Edit mode FIRST. The source element is display:none while the rendering is showing, and
    // a display:none element cannot take focus -- calling focus() before this silently did
    // nothing, which meant a note could not be typed into at all.
    this.setEditing(true);
    this.bodyEl.focus({ preventScroll: true });
    this.placeCaret(at);
  }

  /**
   * Move the caret, if and only if we can confirm the move worked.
   *
   * Returns without touching anything when the platform gives us no shadow-aware selection,
   * which is the safe answer: the browser's own caret is better than no caret.
   */
  private placeCaret(at?: { clientX: number; clientY: number }): void {
    const root = this.bodyEl.getRootNode() as ShadowRoot & {
      getSelection?: () => Selection | null;
    };
    const selection = root.getSelection?.();
    if (!selection) return;

    const range = at ? this.rangeAtPoint(at) : null;
    if (range) {
      this.applyRange(selection, range);
      return;
    }
    // No click to honour, or the point was not over text: end of the note, which is where
    // someone who just made a note wants to be.
    const end = document.createRange();
    end.selectNodeContents(this.bodyEl);
    end.collapse(false);
    this.applyRange(selection, end);
  }

  /** Set a range and undo the attempt if it did not land inside the body. */
  private applyRange(selection: Selection, range: Range): void {
    const had = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    try {
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Some engines throw for a cross-tree range rather than ignoring it.
    }
    const anchor = selection.anchorNode;
    if (anchor && this.bodyEl.contains(anchor)) return;

    // It did not take. Put back whatever was there and let the browser own the caret.
    try {
      selection.removeAllRanges();
      if (had) selection.addRange(had);
    } catch {
      /* nothing more to try */
    }
    this.bodyEl.blur();
    this.bodyEl.focus({ preventScroll: true });
  }

  /** Where the user actually clicked, when the platform can tell us. */
  private rangeAtPoint(at: { clientX: number; clientY: number }): Range | null {
    const d = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
        options?: { shadowRoots: ShadowRoot[] },
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const root = this.bodyEl.getRootNode();
    try {
      // The `shadowRoots` option is what makes this see inside our own tree; without it the
      // answer is the host element, which is useless here.
      const pos = d.caretPositionFromPoint?.(at.clientX, at.clientY, {
        shadowRoots: root instanceof ShadowRoot ? [root] : [],
      });
      if (pos && this.bodyEl.contains(pos.offsetNode)) {
        const r = document.createRange();
        r.setStart(pos.offsetNode, pos.offset);
        r.collapse(true);
        return r;
      }
      const legacy = d.caretRangeFromPoint?.(at.clientX, at.clientY);
      if (legacy && this.bodyEl.contains(legacy.startContainer)) return legacy;
    } catch {
      /* fall through to the end of the note */
    }
    return null;
  }

  /** Placeholder text shown while the body is empty. */
  setPlaceholder(text: string): void {
    this.bodyEl.dataset.placeholder = text;
  }

  bringToFront(): void {
    this.zIndex = this.host.raise(this);
    this.el.style.zIndex = String(this.zIndex);
  }

  destroy(): void {
    this.host.loop.remove(this);
    this.ink?.destroy();
    this.inkBar?.remove();
    this.settings?.el.remove();
    clearTimeout(this.artTimer);
    this.el.remove();
  }

  // ------------------------------------------------------------------ style

  private applyEditable(): void {
    const mode = this.locked ? 'false' : 'plaintext-only';
    this.bodyEl.setAttribute('contenteditable', mode);
    // Firefox before 136 has no plaintext-only; `true` plus paste flattening is the fallback.
    if (this.bodyEl.contentEditable !== 'plaintext-only' && !this.locked) {
      this.bodyEl.setAttribute('contenteditable', 'true');
      this.el.classList.add('no-plaintext-only');
    }
    this.bodyEl.setAttribute('aria-readonly', String(this.locked));
  }

  private applyStyle(): void {
    const font = fontById(this.style.fontFamily);
    for (const [k, v] of Object.entries(styleVars(this.style, font.stack))) {
      this.el.style.setProperty(k, v);
    }
    this.applyDirection();
    this.el.dataset.align = this.style.align;
    this.el.dataset.shadow = this.style.shadow;
    this.el.dataset.dark = isDarkPaper(this.style.paper ?? paletteById(this.style.palette).paper)
      ? '1'
      : '0';
    this.el.dataset.tape = this.style.tape;
    this.el.setAttribute('aria-label', `Sticky note: ${this.text.slice(0, 40)}`);
    if (this.style.physics !== 'full') {
      const inert = { w: 1e6, z: 1 };
      for (const s of [this.rz, this.rx, this.ry, this.sk, this.curl]) retune(s, inert.w, inert.z);
    } else {
      retune(this.rz, TUNING.rz.w, TUNING.rz.z);
      retune(this.rx, TUNING.tilt.w, TUNING.tilt.z);
      retune(this.ry, TUNING.tilt.w, TUNING.tilt.z);
      retune(this.sk, TUNING.skew.w, TUNING.skew.z);
      retune(this.curl, TUNING.curl.w, TUNING.curl.z);
    }
  }

  // -------------------------------------------------------------------- art

  private artTimer = 0;

  private scheduleArt(): void {
    // Regenerating the tear and repainting the grain is ~0.5 ms. Cheap, but not per frame.
    clearTimeout(this.artTimer);
    this.artTimer = self.setTimeout(() => this.resizeArt(), 120);
  }

  private resizeArt(): void {
    const w = this.collapsed ? COLLAPSED : this.w;
    const h = this.collapsed ? COLLAPSED : this.h;
    this.sizeBoxes();

    const box = `0 0 ${w} ${h}`;
    this.paperPath.ownerSVGElement?.setAttribute('viewBox', box);
    this.curlEl.setAttribute('viewBox', box);
    this.shadowEl.setAttribute('viewBox', box);

    this.ink?.resize(w, h);

    const d = tornRectPath(w, h, this.id, { amplitude: this.style.tornEdges });
    this.paperPath.setAttribute('d', d);
    this.halftonePath.setAttribute('d', d);
    this.shadowPath.setAttribute('d', d);

    this.tapeG.textContent = '';
    const corners: Array<0 | 1 | 2 | 3> =
      this.style.tape === 'none' ? [] : this.style.tape === 'one' ? [0] : [0, 2];
    for (const c of corners) {
      const t = tapeStrip(w, h, c, this.id);
      const p = svg('path');
      p.setAttribute('d', t.d);
      p.setAttribute('class', 'tape-strip');
      p.setAttribute('transform', t.transform);
      this.tapeG.append(p);
    }

    for (let i = 0; i < CURL_LEVELS; i++) {
      (this.curlPaths[i] as SVGPathElement).setAttribute(
        'd',
        curlPath(w, h, i / (CURL_LEVELS - 1)),
      );
    }

    void import('~/cs/art/paper.ts').then(({ paintGrain }) =>
      paintGrain(this.grainEl, w, h, Math.min(2, window.devicePixelRatio || 1)),
    );
  }

  // ------------------------------------------------------------------- drag

  private readonly onGrab = (e: PointerEvent): void => {
    if (this.locked || e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    if ((e.target as HTMLElement).closest('.act')) return;

    e.preventDefault();
    this.grabbed = true;
    this.pointerId = e.pointerId;
    // Pointer capture keeps every subsequent event on this element -- no document listeners,
    // and the drag survives the pointer leaving the window. It throws for a pointer id that
    // is not currently active (synthetic events, a pointer released between dispatch and
    // handling), and a failed capture must not abort the drag -- it just means the drag ends
    // if the pointer leaves the element.
    let captured = false;
    try {
      target.setPointerCapture(e.pointerId);
      captured = true;
    } catch {
      /* see the fallback below */
    }
    // Without capture, a pointer that leaves the handle never delivers pointerup here -- so
    // `grabbed` stayed true forever, the shared loop never went idle, and the note burned a
    // frame's work every 16ms for the rest of the session. A window-level release listener,
    // for the duration of this drag only, closes that hole.
    if (!captured) {
      window.addEventListener('pointerup', this.onRelease, { once: true });
      window.addEventListener('pointercancel', this.onRelease, { once: true });
      this.uncaptured = true;
    }
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onRelease);
    target.addEventListener('pointercancel', this.onRelease);
    target.addEventListener('lostpointercapture', this.onRelease);

    this.uiFrom = this.uiNow();
    this.grabDx = e.clientX + window.scrollX - this.px.t;
    this.grabDy = e.clientY + window.scrollY - this.py.t;
    // Where on the note it was grabbed, -1..1 from the centre. This is what makes yanking a
    // corner swing the note instead of sliding it flat.
    this.lever = leverFrom(this.grabDx, this.w);

    this.vx = 0;
    this.vy = 0;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.lastT = e.timeStamp;

    // Focus the note itself.
    //
    // Every keyboard shortcut below the text -- draw, palette, lock, collapse, delete -- only
    // fires when the note WRAPPER has focus, and notes are deliberately kept out of the page's
    // tab order (putting focusable elements into someone else's page changes that page's
    // behaviour). So without this line there was no way to reach that state with a mouse:
    // clicking the text focuses the body, and every plain-letter shortcut was unreachable.
    // Grabbing the note's header is the natural "I mean the note, not the text" gesture.
    this.el.focus({ preventScroll: true });

    this.lz.t = 1;
    this.promote(true);
    this.bringToFront();
    this.el.classList.add('is-dragging');
    this.host.loop.add(this);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.grabbed || e.pointerId !== this.pointerId) return;

    // Coalesced events give the true pointer path on a high-rate mouse without forcing us to
    // render at 1000 Hz -- we integrate them into velocity and render once per frame.
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const dt = Math.max(0.004, (ev.timeStamp - this.lastT) / 1000);
      const a = smoothing(dt);
      this.vx += ((ev.clientX - this.lastX) / dt - this.vx) * a;
      this.vy += ((ev.clientY - this.lastY) / dt - this.vy) * a;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.lastT = ev.timeStamp;
    }

    // Targets only. No DOM writes here -- that is the loop's job.
    this.px.t = e.clientX + window.scrollX - this.grabDx;
    this.py.t = e.clientY + window.scrollY - this.grabDy;
    this.host.loop.wake();
  };

  private readonly onRelease = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    if (this.uncaptured) {
      window.removeEventListener('pointerup', this.onRelease);
      window.removeEventListener('pointercancel', this.onRelease);
      this.uncaptured = false;
    }
    const target = (e.currentTarget ?? this.el.querySelector('.handle')) as HTMLElement;
    target.removeEventListener('pointermove', this.onMove);
    target.removeEventListener('pointerup', this.onRelease);
    target.removeEventListener('pointercancel', this.onRelease);
    target.removeEventListener('lostpointercapture', this.onRelease);
    try {
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }

    this.grabbed = false;
    this.pointerId = null;
    this.lz.t = 0;
    this.el.classList.remove('is-dragging');
    this.host.loop.add(this);
    this.commitUi();
    this.host.onChange?.(this);
  };

  // ----------------------------------------------------------------- resize

  private readonly onResizeGrab = (e: PointerEvent): void => {
    if (this.locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = (e.currentTarget as HTMLElement).dataset.grip ?? 'se';
    const target = e.currentTarget as HTMLElement;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* see onGrab */
    }

    const startW = this.w;
    const startH = this.h;
    const startX = e.clientX;
    const startY = e.clientY;
    // Resizing writes width/height, which IS layout. So it never runs alongside the 3D
    // physics: tilt and curl are pinned to zero for the duration.
    this.el.classList.add('is-resizing');
    let pending = 0;

    const move = (ev: PointerEvent): void => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        const dx = grip === 's' ? 0 : ev.clientX - startX;
        const dy = grip === 'e' ? 0 : ev.clientY - startY;
        this.resize(startW + dx, startH + dy);
      });
    };
    const up = (ev: PointerEvent): void => {
      cancelAnimationFrame(pending);
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      try {
        if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
      this.el.classList.remove('is-resizing');
      this.resizeArt();
      this.host.onChange?.(this);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  // ------------------------------------------------------------------ frame

  step(dt: number): boolean {
    if (this.style.physics === 'full') {
      const pose = poseFromVelocity(this.vx, this.vy, this.lever, this.grabbed);
      this.rx.t = pose.rx;
      this.ry.t = pose.ry;
      this.rz.t = pose.rz;
      this.sk.t = pose.sk;
      this.curl.t = pose.curl;
      // Velocity decays on its own once the pointer stops moving.
      const decay = Math.exp(-dt / (POSE.tau * this.timeScale));
      this.vx *= decay;
      this.vy *= decay;
    }

    let live = false;
    for (const s of [this.px, this.py, this.lz, this.rz, this.rx, this.ry, this.sk, this.curl]) {
      if (step(s, dt)) live = true;
    }
    this.writeTransforms();

    // Last-resort guard on the shared loop: a grab still open two seconds after the last
    // pointer event is a pointer we lost, not a slow user. Without this the loop can be held
    // running forever by a single dropped pointerup.
    if (this.grabbed && performance.now() - this.lastT > 2000) {
      this.grabbed = false;
      this.pointerId = null;
      this.lz.t = 0;
      this.el.classList.remove('is-dragging');
      if (__DEV__) console.warn('[cn] released a stuck drag');
    }
    return live || this.grabbed;
  }

  settle(): void {
    this.promote(false);
    this.writeTransforms();
  }

  private promote(on: boolean): void {
    if (on === this.promoted) return;
    this.promoted = on;
    // Firefox has a will-change budget; permanently promoting every note silently disables
    // promotion for all of them. So it goes on for the drag and comes straight back off.
    this.el.style.willChange = on ? 'transform' : '';
    this.faceEl.style.willChange = on ? 'transform' : '';
  }

  private writeTransforms(): void {
    const lift = this.lz.x;
    this.el.style.transform = `translate3d(${this.px.x.toFixed(2)}px, ${this.py.x.toFixed(2)}px, 0)`;
    this.cardEl.style.transform =
      `rotateX(${this.rx.x.toFixed(2)}deg) rotateY(${this.ry.x.toFixed(2)}deg) ` +
      `translateZ(${(lift * 26).toFixed(2)}px)`;
    this.faceEl.style.transform =
      `rotate(${this.rz.x.toFixed(2)}deg) skewX(${this.sk.x.toFixed(2)}deg) ` +
      `scale(${(1 + lift * 0.035).toFixed(4)})`;
    this.shadowEl.style.transform =
      `translate3d(${(4 + lift * 10).toFixed(2)}px, ${(5 + lift * 14).toFixed(2)}px, 0) ` +
      `scale(${(1 + lift * 0.06).toFixed(4)})`;
    this.shadowEl.style.opacity = (0.18 + lift * 0.18).toFixed(3);

    // Cross-fade between the two nearest pre-baked curl paths. Opacity only.
    const t = this.curl.x * (CURL_LEVELS - 1);
    const i = Math.min(CURL_LEVELS - 2, Math.floor(t));
    const f = t - i;
    for (let k = 0; k < CURL_LEVELS; k++) {
      const p = this.curlPaths[k] as SVGPathElement;
      p.style.opacity = k === i ? String(1 - f) : k === i + 1 ? String(f) : '0';
    }
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

/**
 * One of five pre-baked corner folds, `t` from 0 (flat) to 1 (fully curled).
 * Baked because morphing a path per frame is a main-thread repaint; cross-fading five static
 * ones by opacity is free.
 *
 * Level 0 must be genuinely empty. An earlier version drew a 14px wedge there, which meant
 * every note sat with a hard dark triangle stapled to its corner at rest -- it read as a
 * rendering bug, not as paper.
 */
function curlPath(w: number, h: number, t: number): string {
  if (t <= 0) return '';
  const s = 6 + t * 54; // how far up the corner has lifted
  const lift = t * 0.55;
  const x0 = w - s;
  const y0 = h;
  const x1 = w;
  const y1 = h - s;
  const cx = w - s * (0.45 - lift * 0.2);
  const cy = h - s * (0.45 - lift * 0.2);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)} L${x1.toFixed(1)} ${y0.toFixed(1)} Z`;
}

export const __TUNING__ = __DEV__ ? TUNING : undefined;
