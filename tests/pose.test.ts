import { describe, expect, it } from 'vitest';
import { leverFrom, poseFromVelocity, REST, smoothing, TUNING } from '~/cs/physics/pose.ts';

const grab = (vx: number, vy: number, lever = 0) => poseFromVelocity(vx, vy, lever, true);

describe('poseFromVelocity', () => {
  it('a released note has no pose at all', () => {
    expect(poseFromVelocity(3000, -2000, 1, false)).toEqual(REST);
  });

  it('a stationary grab is flat', () => {
    expect(grab(0, 0)).toEqual(REST);
  });

  it('leans into horizontal motion, and the other way when reversed', () => {
    const right = grab(600, 0);
    const left = grab(-600, 0);
    expect(right.ry).toBeGreaterThan(0);
    expect(left.ry).toBe(-right.ry);
  });

  it('tilts back when dragged downward', () => {
    // Dragging down (+vy) should tip the top of the sheet toward the viewer, i.e. negative rx.
    expect(grab(0, 900).rx).toBeLessThan(0);
    expect(grab(0, -900).rx).toBeGreaterThan(0);
  });

  it('clamps every angle no matter how violent the flick', () => {
    for (const [vx, vy] of [
      [50_000, 50_000],
      [-50_000, 50_000],
      [1e9, -1e9],
    ] as const) {
      const p = grab(vx, vy, 1);
      expect(Math.abs(p.rx)).toBeLessThanOrEqual(TUNING.maxTilt);
      expect(Math.abs(p.ry)).toBeLessThanOrEqual(TUNING.maxTilt);
      expect(Math.abs(p.rz)).toBeLessThanOrEqual(TUNING.maxSpin);
      expect(Math.abs(p.sk)).toBeLessThanOrEqual(TUNING.maxSkew);
      expect(p.curl).toBeLessThanOrEqual(1);
      expect(p.curl).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * The lever term is the whole reason a note feels like paper rather than a rigid card:
   * pulling it down by a top corner has to swing it around that corner.
   */
  it('swings around the grab point -- opposite corners spin opposite ways', () => {
    const leftEdge = grab(0, 900, -1);
    const rightEdge = grab(0, 900, 1);
    const centre = grab(0, 900, 0);
    expect(centre.rz).toBe(0);
    expect(Math.sign(leftEdge.rz)).toBe(-Math.sign(rightEdge.rz));
    expect(Math.abs(leftEdge.rz)).toBeGreaterThan(1);
  });

  it('produces a believable pose for a realistic flick, not a clamped extreme', () => {
    // ~1500 px/s is a brisk but ordinary flick across a laptop screen.
    const p = grab(1500, 400, 0.5);
    expect(p.ry).toBeCloseTo(TUNING.maxTilt, 5); // saturates -- intended at this speed
    expect(Math.abs(p.rx)).toBeGreaterThan(2);
    expect(Math.abs(p.rx)).toBeLessThan(TUNING.maxTilt);
    expect(p.curl).toBeGreaterThan(0.5);
    expect(p.curl).toBeLessThan(1);
  });

  it('a slow, careful drag barely deforms the sheet', () => {
    const p = grab(150, 60, 0.3);
    expect(Math.abs(p.ry)).toBeLessThan(2.5);
    expect(Math.abs(p.rx)).toBeLessThan(1.5);
    expect(p.curl).toBeLessThan(0.15);
  });

  it('curl depends on speed, not direction', () => {
    const a = grab(900, 0).curl;
    const b = grab(0, -900).curl;
    const c = grab(-636, 636).curl;
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(c, 2);
  });
});

describe('smoothing', () => {
  it('is frame-rate independent: two 8ms frames smooth like one 16ms frame', () => {
    const one = smoothing(0.016);
    const twoSteps = 1 - (1 - smoothing(0.008)) ** 2;
    expect(twoSteps).toBeCloseTo(one, 12);
  });

  it('stays inside (0, 1) for any sane frame time', () => {
    for (const dt of [0.001, 0.016, 0.033, 0.25]) {
      const a = smoothing(dt);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });
});

describe('leverFrom', () => {
  it.each([
    [0, 200, -1],
    [100, 200, 0],
    [200, 200, 1],
    [50, 200, -0.5],
  ])('grab at %ipx on a %ipx sheet -> lever %f', (offset, width, want) => {
    expect(leverFrom(offset, width)).toBeCloseTo(want, 6);
  });

  it('clamps a grab that started outside the sheet', () => {
    expect(leverFrom(-80, 200)).toBe(-1);
    expect(leverFrom(400, 200)).toBe(1);
  });

  it('does not divide by zero on a degenerate sheet', () => {
    expect(leverFrom(10, 0)).toBe(0);
  });
});
