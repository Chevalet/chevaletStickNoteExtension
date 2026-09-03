/**
 * Deterministic randomness.
 *
 * Every torn edge, tape angle and grain offset is derived from the note's id, so a note looks
 * *identical* on every reload and on every machine. That matters more than it sounds: paper
 * whose tears rearrange themselves on refresh reads as a glitch, not as paper.
 */

/** mulberry32 -- 4 lines, good enough distribution, and fast. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold an arbitrary string (a note id) into a 32-bit seed. */
export function seedFrom(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded generator with the helpers the art code actually wants. */
export class Rng {
  private readonly next: () => number;

  constructor(seed: string | number) {
    this.next = mulberry32(typeof seed === 'string' ? seedFrom(seed) : seed);
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Roughly gaussian, via the mean of four draws. Keeps tears from looking like static. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.1;
  }

  bool(p = 0.5): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
}
