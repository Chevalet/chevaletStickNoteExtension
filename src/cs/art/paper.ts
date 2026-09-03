/**
 * The paper itself: torn edges, grain, tape.
 *
 * Everything here is computed ONCE per note (and again only on resize) and then left alone.
 * Nothing in this file may be called from the animation loop -- see plan section 6, rule 2:
 * an SVG filter or a canvas repaint per frame is 3-12 ms of main thread, which is the whole
 * frame budget gone.
 *
 * The one technique deliberately NOT used is `feTurbulence` + `feDisplacementMap` for the torn
 * edge. It looks great and costs a re-rasterisation every time the note's effective scale
 * changes -- which, during a drag, is every frame. Generating the jagged path in JS from a
 * seeded PRNG costs ~0.15 ms once and animates for free.
 */

import { Rng } from './prng.ts';

const r2 = (n: number): number => Math.round(n * 100) / 100;

export interface TornOptions {
  /** How far the edge wanders from straight, in px. 0 gives a clean rectangle. */
  amplitude?: number;
  /** Distance between perturbation points, in px. Smaller is rougher and costs more. */
  step?: number;
  /** Number of deeper bites taken out of the edge. */
  nicks?: number;
  /** Corner rounding before tearing, in px. */
  radius?: number;
}

/**
 * A closed path around a `w x h` rectangle whose edges have been torn.
 *
 * Walks the perimeter, pushing each point along the inward normal by seeded noise, then adds
 * a few deeper nicks so the tear has some rhythm instead of uniform fuzz.
 */
export function tornRectPath(
  w: number,
  h: number,
  seed: string | number,
  o: TornOptions = {},
): string {
  const amp = o.amplitude ?? 2.4;
  const stepPx = o.step ?? 7;
  const nicks = o.nicks ?? 4;
  const rng = new Rng(seed);

  if (amp <= 0) return `M0 0 H${r2(w)} V${r2(h)} H0 Z`;

  // Perimeter as a list of [point, inward normal] pairs, walked clockwise from the top-left.
  type P = [x: number, y: number, nx: number, ny: number];
  const pts: P[] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number): void => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(2, Math.round(len / stepPx));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, nx, ny]);
    }
  };
  edge(0, 0, w, 0, 0, 1); // top,    inward = down
  edge(w, 0, w, h, -1, 0); // right,  inward = left
  edge(w, h, 0, h, 0, -1); // bottom, inward = up
  edge(0, h, 0, 0, 1, 0); // left,   inward = right

  // Base displacement: smooth-ish noise so neighbouring points stay related.
  const disp = new Float32Array(pts.length);
  let prev = rng.gauss();
  for (let i = 0; i < pts.length; i++) {
    const target = rng.gauss();
    prev = prev * 0.55 + target * 0.45;
    disp[i] = prev * amp;
  }

  // Deeper bites, tapered so they read as tears rather than dents.
  for (let k = 0; k < nicks; k++) {
    const at = rng.int(0, pts.length - 1);
    const width = rng.int(2, 5);
    const depth = rng.range(amp * 1.6, amp * 3.4);
    for (let j = -width; j <= width; j++) {
      const i = (at + j + pts.length) % pts.length;
      const falloff = 1 - Math.abs(j) / (width + 1);
      disp[i] = (disp[i] as number) + depth * falloff * falloff;
    }
  }

  // Corners stay put, or the note stops reading as a rectangle.
  const cornerIdx = [
    0,
    Math.round(pts.length * 0.25),
    Math.round(pts.length * 0.5),
    Math.round(pts.length * 0.75),
  ];
  for (const c of cornerIdx) {
    for (let j = -2; j <= 2; j++) {
      const i = (c + j + pts.length) % pts.length;
      disp[i] = (disp[i] as number) * (Math.abs(j) / 3);
    }
  }

  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const [x, y, nx, ny] = pts[i] as P;
    const k = disp[i] as number;
    const px = r2(x + nx * k);
    const py = r2(y + ny * k);
    d += i === 0 ? `M${px} ${py}` : `L${px} ${py}`;
  }
  return `${d}Z`;
}

/**
 * A strip of masking tape straddling one corner, as an SVG path plus the transform that places
 * it. Corner index: 0 = top-left, 1 = top-right, 2 = bottom-right, 3 = bottom-left.
 *
 * The strip is drawn centred on the origin and rotated about its own centre, so it lands
 * ACROSS the corner at roughly 45 degrees -- the way tape is actually applied. Positioning by
 * the strip's top-left and rotating about that instead swings it off into space, which is
 * exactly what the first version did.
 */
export function tapeStrip(
  w: number,
  h: number,
  corner: 0 | 1 | 2 | 3,
  seed: string | number,
): { d: string; transform: string } {
  const rng = new Rng(`${seed}:tape${corner}`);
  const len = rng.range(52, 74);
  const wide = rng.range(16, 21);

  // Torn-off ends: the short edges are ragged, the long edges are straight.
  const jag = (x: number, dir: 1 | -1): string => {
    const n = 5;
    let s = '';
    for (let i = 1; i <= n; i++) {
      s += `L${r2(x + rng.range(-2.4, 2.4))} ${r2(-wide / 2 + (wide / n) * i * (dir > 0 ? 1 : 1))}`;
    }
    return s;
  };
  const hx = len / 2;
  const hy = wide / 2;
  const d = `M${r2(-hx)} ${r2(-hy)} L${r2(hx)} ${r2(-hy)} ${jag(hx, 1)} L${r2(-hx)} ${r2(hy)} ${jag(-hx, -1)} Z`;

  // Sit the centre just outside the corner so equal amounts of tape land on the paper and on
  // whatever is behind it.
  const out = rng.range(2, 7);
  const left = corner === 0 || corner === 3;
  const top = corner === 0 || corner === 1;
  const cx = left ? out : w - out;
  const cy = top ? out : h - out;
  // 45 degrees across the corner, with a little human error.
  const base = left === top ? -45 : 45;
  const angle = base + rng.range(-9, 9);

  return { d, transform: `translate(${r2(cx)} ${r2(cy)}) rotate(${r2(angle)})` };
}

/**
 * One tileable grain tile, generated once for the whole page and shared by every note.
 * Multiply-blended, so it is colour-agnostic and never needs regenerating when a note is
 * re-themed.
 */
let grainTile: Promise<ImageBitmap | HTMLCanvasElement> | null = null;

export function paperGrain(size = 128): Promise<ImageBitmap | HTMLCanvasElement> {
  grainTile ??= (async () => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return c;

    const img = ctx.createImageData(size, size);
    const rng = new Rng('chevalet-grain');
    const px = img.data;
    for (let i = 0; i < size * size; i++) {
      // Mostly-transparent speckle. Two scales so it reads as fibre, not TV static.
      const fine = rng.range(0, 1);
      const coarse = rng.range(0, 1) ** 3;
      const a = fine > 0.86 ? 26 + coarse * 46 : coarse * 14;
      const v = rng.bool(0.72) ? 0 : 255; // dark specks with occasional light flecks
      px[i * 4] = v;
      px[i * 4 + 1] = v;
      px[i * 4 + 2] = v;
      px[i * 4 + 3] = a;
    }
    ctx.putImageData(img, 0, 0);

    // createImageBitmap keeps it off the main thread on repaint; canvas is the fallback.
    try {
      return await createImageBitmap(c);
    } catch {
      return c;
    }
  })();
  return grainTile;
}

/** Paint the shared grain tile across a note-sized canvas. Called on create and on resize. */
export async function paintGrain(
  canvas: HTMLCanvasElement,
  w: number,
  h: number,
  dpr = 1,
): Promise<void> {
  const tile = await paperGrain();
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const pattern = ctx.createPattern(tile as CanvasImageSource, 'repeat');
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
}
