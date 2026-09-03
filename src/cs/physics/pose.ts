/**
 * How fast the pointer is moving, and where on the sheet it was grabbed, turned into a pose.
 *
 * Extracted from NoteView because it is pure arithmetic and it is the part of the paper feel
 * most likely to be re-tuned: keeping it separate means it can be exercised in a unit test
 * without a DOM, and re-tuned without touching anything that writes to the page.
 */

export interface PoseTuning {
  /** Pointer-velocity smoothing time constant, seconds. */
  tau: number;
  /** velocity (px/s) -> degrees */
  kTilt: number;
  kSpin: number;
  kLever: number;
  kSkew: number;
  maxTilt: number;
  maxSpin: number;
  maxSkew: number;
  /** Pointer speed (px/s) at which the corner is fully curled. */
  curlSpeed: number;
}

/** Hand-tuned in spikes/paper. See docs/perf.md before changing any of these. */
export const TUNING: Readonly<PoseTuning> = Object.freeze({
  tau: 0.04,
  kTilt: 0.012,
  kSpin: 0.006,
  kLever: 0.01,
  kSkew: 0.004,
  maxTilt: 12,
  maxSpin: 14,
  maxSkew: 4,
  curlSpeed: 1800,
});

export interface Pose {
  /** Tilt away from the viewer along the horizontal axis, degrees. */
  rx: number;
  /** Tilt along the vertical axis, degrees. */
  ry: number;
  /** In-plane spin, degrees. This is where the grab point matters. */
  rz: number;
  /** Horizontal shear, degrees -- the "flag" flutter. */
  sk: number;
  /** Corner curl, 0..1. */
  curl: number;
}

export const REST: Readonly<Pose> = Object.freeze({ rx: 0, ry: 0, rz: 0, sk: 0, curl: 0 });

// `v === 0 ? 0 : v` folds negative zero away. Without it a stationary grab produces
// `rotateX(-0deg)` in the transform string -- harmless to render, but it makes poses
// compare unequal and reads as a bug in a debugger.
const clamp = (v: number, m: number): number => (v === 0 ? 0 : v < -m ? -m : v > m ? m : v);

/**
 * @param vx      smoothed pointer velocity, px/s
 * @param vy      smoothed pointer velocity, px/s
 * @param lever   where the sheet was grabbed, -1 (left edge) .. 0 (centre) .. 1 (right edge).
 *                This is what makes yanking a corner *swing* the note rather than slide it.
 * @param grabbed a released note has no pose; it springs back to rest.
 */
export function poseFromVelocity(
  vx: number,
  vy: number,
  lever: number,
  grabbed: boolean,
  t: PoseTuning = TUNING,
): Pose {
  if (!grabbed) return REST;
  return {
    ry: clamp(vx * t.kTilt, t.maxTilt),
    rx: clamp(-vy * t.kTilt, t.maxTilt),
    rz: clamp(vx * t.kSpin - vy * t.kLever * lever, t.maxSpin),
    sk: clamp(vx * t.kSkew, t.maxSkew),
    curl: Math.min(1, Math.hypot(vx, vy) / t.curlSpeed),
  };
}

/**
 * Exponential smoothing coefficient for a frame of `dt` seconds.
 * Frame-rate independent: the same physical smoothing at 30fps and 144fps.
 */
export function smoothing(dt: number, tau: number = TUNING.tau): number {
  return 1 - Math.exp(-dt / tau);
}

/** Where the pointer landed on the sheet, as a lever arm in -1..1. */
export function leverFrom(grabOffsetX: number, width: number): number {
  if (width <= 0) return 0;
  return clamp((grabOffsetX - width / 2) / (width / 2), 1);
}
