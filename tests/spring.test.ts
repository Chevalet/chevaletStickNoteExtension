import { describe, expect, it } from 'vitest';
import { type Animatable, Loop, retune, snap, spring, step } from '~/cs/physics/spring.ts';

/**
 * Reference integrator: semi-implicit Euler, independent of the closed-form maths under test.
 * If the analytic solution ever drifts from this, one of them is wrong.
 *
 * The step size matters. At h=1e-4 this reference is itself off by ~1.5% in velocity for a
 * bouncy spring (w=20, z=0.25) -- Euler's error is O(h) and accumulates over 5000 steps. A
 * convergence check settles who is at fault: shrinking h walks the reference *towards* the
 * analytic answer (dv 3.35 -> 0.63 -> 0.033 -> 0.0003 at h = 1e-3 .. 1e-7), so the closed
 * form is right and the reference was the imprecise one. Hence 1e-5, not 1e-4.
 */
function reference(w: number, z: number, x0: number, v0: number, target: number, seconds: number) {
  const h = 1e-5;
  let x = x0;
  let v = v0;
  for (let t = 0; t < seconds; t += h) {
    v += (-w * w * (x - target) - 2 * z * w * v) * h;
    x += v * h;
  }
  return { x, v };
}

describe('spring integration', () => {
  it.each([
    ['critically damped', 34, 1.0],
    ['underdamped, note wobble', 16, 0.58],
    ['underdamped, corner curl', 14, 0.7],
    ['very bouncy', 20, 0.25],
  ])('matches a 10 kHz reference: %s', (_label, w, z) => {
    const s = spring(w, z, 0, 100);
    s.t = 0;
    s.v = 40;

    const seconds = 0.5;
    for (let i = 0; i < 30; i++) step(s, seconds / 30); // 60fps-ish

    const ref = reference(w, z, 100, 40, 0, seconds);
    expect(s.x).toBeCloseTo(ref.x, 1);
    expect(s.v).toBeCloseTo(ref.v, 0);
  });

  it('is stable at absurd frame times, where Euler explodes', () => {
    const s = spring(34, 1, 0.05, 0);
    s.t = 500;
    // One 250 ms stall, then normal frames.
    step(s, 0.25);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeGreaterThan(0);
    expect(s.x).toBeLessThanOrEqual(500.001); // critically damped never overshoots
    for (let i = 0; i < 200; i++) step(s, 1 / 60);
    expect(s.x).toBeCloseTo(500, 3);
  });

  it('clamps a pathological dt rather than teleporting', () => {
    const s = spring(34, 1, 0.05, 0);
    s.t = 1000;
    step(s, 60); // tab was backgrounded for a minute
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeLessThan(1000);
  });

  it('critically damped never overshoots its target', () => {
    const s = spring(28, 1, 0.001, 0);
    s.t = 100;
    let max = 0;
    for (let i = 0; i < 300; i++) {
      step(s, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(max).toBeLessThanOrEqual(100.0001);
  });

  it('underdamped does overshoot -- that is the paper feel', () => {
    const s = spring(16, 0.58, 0.001, 0);
    s.t = 100;
    let max = 0;
    for (let i = 0; i < 300; i++) {
      step(s, 1 / 60);
      max = Math.max(max, s.x);
    }
    expect(max).toBeGreaterThan(100.5);
    expect(max).toBeLessThan(120); // but not comically
  });

  it('reports settled and snaps exactly onto the target', () => {
    const s = spring(34, 1, 0.05, 0);
    s.t = 42;
    let frames = 0;
    while (step(s, 1 / 60)) {
      if (++frames > 600) throw new Error('never settled');
    }
    expect(s.x).toBe(42);
    expect(s.v).toBe(0);
  });

  it('settles a position spring in roughly 120 ms at w=34', () => {
    const s = spring(34, 1, 0.05, 0);
    s.t = 100;
    let frames = 0;
    while (step(s, 1 / 60)) frames++;
    const ms = (frames / 60) * 1000;
    expect(ms).toBeGreaterThan(80);
    expect(ms).toBeLessThan(320);
  });

  it('snap and retune do what they say', () => {
    const s = spring(10, 1);
    s.t = 5;
    step(s, 0.1);
    snap(s, 99);
    expect([s.x, s.t, s.v]).toEqual([99, 99, 0]);
    retune(s, 20, 0.5);
    expect(s.w).toBe(20);
    expect(s.wd).toBeCloseTo(20 * Math.sqrt(0.75), 6);
  });
});

// ---------------------------------------------------------------------------

/** Drives a Loop by hand so the test controls time exactly. */
function fakeClock() {
  let t = 0;
  const queue: Array<(t: number) => void> = [];
  const loop = new Loop({
    now: () => t,
    requestFrame: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    cancelFrame: () => queue.splice(0, queue.length),
  });
  return {
    loop,
    /** Run n frames of 16ms. Returns how many actually ran before the loop stopped. */
    frames(n: number): number {
      let ran = 0;
      for (let i = 0; i < n; i++) {
        const cb = queue.shift();
        if (!cb) break;
        t += 16;
        cb(t);
        ran++;
      }
      return ran;
    },
  };
}

function member(steps: number): Animatable & { settled: number; stepped: number } {
  let left = steps;
  const m = {
    settled: 0,
    stepped: 0,
    step() {
      m.stepped++;
      return --left > 0;
    },
    settle() {
      m.settled++;
    },
  };
  return m;
}

describe('Loop', () => {
  it('stops itself once every member has settled -- 0% CPU when idle', () => {
    const { loop, frames } = fakeClock();
    const a = member(3);
    loop.add(a);
    expect(loop.running).toBe(true);

    frames(20);
    expect(a.settled).toBe(1);
    expect(loop.running).toBe(false);
    expect(loop.size).toBe(0);
    // No further frames are scheduled at all.
    expect(frames(5)).toBe(0);
  });

  it('keeps running while any one member is still moving', () => {
    const { loop, frames } = fakeClock();
    const quick = member(2);
    const slow = member(10);
    loop.add(quick);
    loop.add(slow);

    frames(4);
    expect(quick.settled).toBe(1);
    expect(loop.running).toBe(true);

    frames(20);
    expect(slow.settled).toBe(1);
    expect(loop.running).toBe(false);
  });

  it('wake() is idempotent and never double-schedules', () => {
    const { loop, frames } = fakeClock();
    const m = member(5);
    loop.add(m);
    loop.wake();
    loop.wake();
    frames(1);
    expect(m.stepped).toBe(1); // one step per frame, not three
  });

  it('wake() on an empty loop does nothing', () => {
    const { loop } = fakeClock();
    loop.wake();
    expect(loop.running).toBe(false);
  });

  it('pause() freezes without settling anyone', () => {
    const { loop, frames } = fakeClock();
    const m = member(100);
    loop.add(m);
    frames(2);
    loop.pause();
    expect(loop.running).toBe(false);
    expect(m.settled).toBe(0);
    expect(loop.size).toBe(1);

    loop.wake();
    frames(1);
    expect(m.stepped).toBe(3);
  });

  it('survives a member removing itself during settle', () => {
    const { loop, frames } = fakeClock();
    const other = member(50);
    const suicidal: Animatable = {
      step: () => false,
      settle: () => loop.remove(other),
    };
    loop.add(suicidal);
    loop.add(other);
    expect(() => frames(3)).not.toThrow();
    expect(loop.size).toBe(0);
  });
});
