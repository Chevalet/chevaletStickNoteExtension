/**
 * The ink layer: freehand drawing on a note.
 *
 * Strokes are stored as VECTORS, not as a raster canvas. A stroke is a few hundred bytes,
 * scales with the note, survives a resize, and can be undone one stroke at a time -- none of
 * which is true of a bitmap. `perfect-freehand` turns a pressure-varying point list into an
 * outline polygon, which is what gives the marker its thick-thin character.
 */

import getStroke from 'perfect-freehand';
import type { InkStroke } from '~/bg/db/schema.ts';

const NS = 'http://www.w3.org/2000/svg';

export interface InkOptions {
  color: string;
  size: number;
}

/** Turn a flat [x, y, pressure, ...] list into an SVG outline path. */
export function strokeToPath(stroke: InkStroke): string {
  const pts: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) {
    pts.push([
      stroke.points[i] as number,
      stroke.points[i + 1] as number,
      stroke.points[i + 2] as number,
    ]);
  }
  if (pts.length === 0) return '';

  const outline = getStroke(pts, {
    size: stroke.size,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: true,
    last: true,
  });
  if (outline.length < 2) return '';

  // Quadratic segments through the midpoints -- the standard way to render the outline
  // without visible polygon facets.
  let d = `M${round(outline[0]?.[0])} ${round(outline[0]?.[1])}`;
  for (let i = 1; i < outline.length; i++) {
    const a = outline[i] as number[];
    const b = outline[(i + 1) % outline.length] as number[];
    d += `Q${round(a[0])} ${round(a[1])} ${round(((a[0] as number) + (b[0] as number)) / 2)} ${round(((a[1] as number) + (b[1] as number)) / 2)}`;
  }
  return `${d}Z`;
}

const round = (n: number | undefined): number => Math.round((n ?? 0) * 10) / 10;

/**
 * A drawing surface layered over one note.
 *
 * Only active while the pen is enabled: the rest of the time it is `pointer-events: none` and
 * costs nothing but the already-rendered paths.
 */
export class InkLayer {
  readonly el: SVGSVGElement;
  private readonly committed: SVGGElement;
  private readonly live: SVGPathElement;
  private strokes: InkStroke[];
  private drawing: InkStroke | null = null;
  private raf = 0;
  private enabled = false;

  constructor(
    private w: number,
    private h: number,
    strokes: InkStroke[] = [],
    private options: InkOptions = { color: 'currentColor', size: 7 },
    private readonly onCommit?: (strokes: InkStroke[]) => void,
  ) {
    this.strokes = strokes.map((s) => ({ ...s, points: [...s.points] }));

    this.el = document.createElementNS(NS, 'svg');
    this.el.setAttribute('class', 'ink');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.setAttribute('preserveAspectRatio', 'none');
    this.committed = document.createElementNS(NS, 'g');
    this.live = document.createElementNS(NS, 'path');
    this.live.setAttribute('class', 'ink-live');
    this.el.append(this.committed, this.live);

    this.resize(w, h);
    this.redraw();

    this.el.addEventListener('pointerdown', this.onDown);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get strokeCount(): number {
    return this.strokes.length;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.el.classList.toggle('is-drawing', on);
  }

  setOptions(o: Partial<InkOptions>): void {
    this.options = { ...this.options, ...o };
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.el.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }

  /** Remove the most recent stroke. Cheap, and the only undo a drawing really needs. */
  undo(): boolean {
    if (this.strokes.length === 0) return false;
    this.strokes.pop();
    this.redraw();
    this.onCommit?.(this.strokes);
    return true;
  }

  clear(): void {
    if (this.strokes.length === 0) return;
    this.strokes = [];
    this.redraw();
    this.onCommit?.(this.strokes);
  }

  toJSON(): { strokes: InkStroke[]; w: number; h: number } {
    return { strokes: this.strokes, w: this.w, h: this.h };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.el.remove();
  }

  // ------------------------------------------------------------------ input

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // never start a drag of the note underneath

    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* capture is an optimisation */
    }
    this.drawing = { points: [], color: this.options.color, size: this.options.size };
    this.push(e);

    this.el.addEventListener('pointermove', this.onMove);
    this.el.addEventListener('pointerup', this.onUp);
    this.el.addEventListener('pointercancel', this.onUp);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.drawing) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) this.push(ev);
    // One repaint per frame, no matter how fast the pen reports.
    if (!this.raf) this.raf = requestAnimationFrame(this.drawLive);
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
    try {
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.live.removeAttribute('d');

    if (this.drawing && this.drawing.points.length >= 3) {
      this.strokes.push(this.drawing);
      this.redraw();
      this.onCommit?.(this.strokes);
    }
    this.drawing = null;
  };

  private push(e: PointerEvent): void {
    if (!this.drawing) return;
    const r = this.el.getBoundingClientRect();
    // Note-local coordinates, scaled into the viewBox so ink survives a resize.
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * this.w;
    const y = ((e.clientY - r.top) / Math.max(1, r.height)) * this.h;
    const pressure = e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.5;
    this.drawing.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, pressure);
  }

  private readonly drawLive = (): void => {
    this.raf = 0;
    if (!this.drawing) return;
    this.live.setAttribute('d', strokeToPath(this.drawing));
    this.live.setAttribute('fill', this.drawing.color);
  };

  private redraw(): void {
    this.committed.textContent = '';
    for (const s of this.strokes) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', strokeToPath(s));
      p.setAttribute('fill', s.color);
      this.committed.append(p);
    }
  }
}
