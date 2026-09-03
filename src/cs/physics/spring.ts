/**
 * Spring integration and the shared animation loop. Plan section 6.
 *
 * Two decisions here are worth defending:
 *
 * 1. **Analytic, not Euler.** Semi-implicit Euler is three lines and blows up at the frame
 *    times you actually get on a heavy page (30-60 ms). These are the closed-form solutions
 *    to the damped harmonic oscillator: exact at any dt, unconditionally stable, ~12 flops.
 *    A 250 ms stall makes the note glide to where it should be, not teleport past it.
 *
 * 2. **One loop for every note, and it stops itself.** When the last spring settles the rAF
 *    is cancelled, so a tab with forty notes sitting still costs literally nothing.
 */

export interface Spring {
  /** current value */
  x: number;
  /** current velocity, units/second */
  v: number;
  /** target */
  t: number;
  /** natural frequency, rad/s -- higher is snappier */
  w: number;
  /** damping ratio -- 1 is critically damped, below 1 overshoots and wobbles */
  z: number;
  /** precomputed damped frequency, w*sqrt(1-z^2); 0 when critically damped */
  wd: number;
  /** settle threshold for |x - t| */
  eps: number;
}

export function spring(w: number, z: number, eps = 0.05, x = 0): Spring {
  return { x, v: 0, t: x, w, z, wd: z < 1 ? w * Math.sqrt(1 - z * z) : 0, eps };
}

/** Longest dt we will integrate in one go. Beyond this we substep. */
const MAX_DT = 0.032;
const SUBSTEP = 0.008;

function stepOnce(s: Spring, dt: number): void {
  const d = s.x - s.t;
  if (s.z >= 1) {
    // Critically damped: x(t) = target + (d + (v + w*d)*t) * e^(-w*t)
    const e = Math.exp(-s.w * dt);
    const b = s.v + s.w * d;
    s.x = s.t + (d + b * dt) * e;
    s.v = (s.v - b * s.w * dt) * e;
    return;
  }
  // Underdamped: the overshoot is the whole point -- this is where paper gets its wobble.
  const e = Math.exp(-s.z * s.w * dt);
  const c = Math.cos(s.wd * dt);
  const sn = Math.sin(s.wd * dt);
  const a = d;
  const b = (s.v + s.z * s.w * d) / s.wd;
  s.x = s.t + e * (a * c + b * sn);
  s.v = e * ((b * s.wd - a * s.z * s.w) * c - (a * s.wd + b * s.z * s.w) * sn);
}

/** Advance one spring. Returns false once it has settled and can be left alone. */
export function step(s: Spring, dt: number): boolean {
  let remaining = Math.min(dt, 0.25);
  while (remaining > MAX_DT) {
    stepOnce(s, SUBSTEP);
    remaining -= SUBSTEP;
  }
  if (remaining > 0) stepOnce(s, remaining);

  if (Math.abs(s.x - s.t) < s.eps && Math.abs(s.v) < s.eps * 10) {
    s.x = s.t;
    s.v = 0;
    return false;
  }
  return true;
}

/** Jump a spring to a value with no motion. */
export function snap(s: Spring, value: number): void {
  s.x = value;
  s.t = value;
  s.v = 0;
}

/** Retune in place, keeping current state. */
export function retune(s: Spring, w: number, z: number): void {
  s.w = w;
  s.z = z;
  s.wd = z < 1 ? w * Math.sqrt(1 - z * z) : 0;
}

// ---------------------------------------------------------------------------

export interface Animatable {
  /** Advance by dt seconds and write to the DOM. Return false when fully settled. */
  step(dt: number): boolean;
  /** Called once when the loop drops this member: snap, drop will-change, tidy up. */
  settle(): void;
}

/**
 * The single requestAnimationFrame loop shared by every note on the page.
 *
 * Nothing here reads layout. Members set spring targets from pointer events and write
 * transforms during `step`; the loop guarantees all of those writes happen in one batch with
 * no interleaved reads, which is what keeps the frame free of forced synchronous layout.
 */
export class Loop {
  private members = new Set<Animatable>();
  private raf = 0;
  private last = 0;
  private readonly now: () => number;
  private readonly schedule: (cb: (t: number) => void) => number;
  private readonly cancel: (h: number) => void;

  constructor(env?: {
    now?: () => number;
    requestFrame?: (cb: (t: number) => void) => number;
    cancelFrame?: (h: number) => void;
  }) {
    this.now = env?.now ?? (() => performance.now());
    this.schedule = env?.requestFrame ?? ((cb) => requestAnimationFrame(cb));
    this.cancel = env?.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  }

  get running(): boolean {
    return this.raf !== 0;
  }

  get size(): number {
    return this.members.size;
  }

  add(m: Animatable): void {
    this.members.add(m);
    this.wake();
  }

  remove(m: Animatable): void {
    this.members.delete(m);
  }

  wake(): void {
    if (this.raf !== 0 || this.members.size === 0) return;
    this.last = this.now();
    this.raf = this.schedule(this.tick);
  }

  /** Freeze without settling -- used on visibilitychange so state is not stepped by a 1s dt. */
  pause(): void {
    if (this.raf === 0) return;
    this.cancel(this.raf);
    this.raf = 0;
  }

  private tick = (t: number): void => {
    const dt = (t - this.last) / 1000;
    this.last = t;

    let live = false;
    // Snapshot: `settle()` may remove members, and mutating during iteration is a trap.
    for (const m of [...this.members]) {
      if (m.step(dt)) {
        live = true;
      } else {
        this.members.delete(m);
        m.settle();
      }
    }

    this.raf = live && this.members.size > 0 ? this.schedule(this.tick) : 0;
  };
}
