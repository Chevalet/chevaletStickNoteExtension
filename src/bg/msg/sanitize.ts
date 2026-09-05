/**
 * The trust boundary between a page's process and the database.
 *
 * A content script runs inside the page it annotates. It is the least trusted context in the
 * extension, so what it sends is treated as input rather than as fact: the background derives
 * the scope from the sender's own URL and never honours one the message names, and every
 * number is clamped before it is stored.
 *
 * The clamps are not paranoia about a hostile page -- a hostile page cannot speak this
 * protocol. They are about what is *recoverable*. A note at x = 1e308, or one carrying a
 * megabyte of text pasted by accident, is a note nobody can find or open again, and a store
 * that accepts it has quietly lost the user's data while reporting success.
 *
 * Pure on purpose: this is the one piece of the background worth testing exhaustively, and it
 * should be testable without a browser.
 */

import type { NoteWire } from './protocol.ts';

/** Bounds, in one place, so the tests and the UI can read the same numbers. */
export const LIMITS = {
  /** Document coordinates. Generous -- long pages are real -- but finite. */
  pos: { min: -1_000_000, max: 1_000_000 },
  w: { min: 120, max: 2000 },
  h: { min: 80, max: 2000 },
  z: { min: 0, max: 1_000_000 },
  opacity: { min: 0.2, max: 1 },
  /** Roughly a hundred pages of prose. Past this, it is not a sticky note. */
  textChars: 200_000,
  tags: 32,
  tagChars: 64,
} as const;

export const DEFAULT_UI: NoteWire['ui'] = {
  x: 24,
  y: 24,
  w: 240,
  h: 200,
  z: 10,
  collapsed: false,
  locked: false,
  opacity: 1,
};

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  // NaN and both infinities fail this, which is the point: they are the values that turn a
  // stored coordinate into a note that can never be shown again.
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Only the fields the renderer may set, each of them bounded. */
export function sanitizeUi(ui: unknown, base: NoteWire['ui'] = DEFAULT_UI): NoteWire['ui'] {
  const u = (ui ?? {}) as Record<string, unknown>;
  return {
    x: num(u.x, LIMITS.pos.min, LIMITS.pos.max, base.x),
    y: num(u.y, LIMITS.pos.min, LIMITS.pos.max, base.y),
    w: num(u.w, LIMITS.w.min, LIMITS.w.max, base.w),
    h: num(u.h, LIMITS.h.min, LIMITS.h.max, base.h),
    z: num(u.z, LIMITS.z.min, LIMITS.z.max, base.z),
    collapsed: u.collapsed === true,
    locked: u.locked === true,
    opacity: num(u.opacity, LIMITS.opacity.min, LIMITS.opacity.max, base.opacity),
  };
}

/** Note text: a string, capped, with no lone surrogates left at the cut. */
/**
 * A note's name, as typed by a person, on its way in from a content script.
 *
 * One line: newlines are stripped rather than rejected, because the obvious way to get one in
 * is to paste a line of text that happens to end with a return, and refusing the paste is a
 * worse answer than trimming it. Capped at 120 characters, which is the same cap `deriveTitle`
 * uses -- the cabinet lays the two out in the same column.
 *
 * Returns undefined for an empty name, so clearing the box removes the field.
 */
export function sanitizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const one = value
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 120);
  return one.length > 0 ? one : undefined;
}

export function sanitizeText(v: unknown): string {
  if (typeof v !== 'string') return '';
  if (v.length <= LIMITS.textChars) return v;
  const cut = v.slice(0, LIMITS.textChars);
  // Slicing by code unit can split a surrogate pair, and a lone surrogate is not valid
  // UTF-8 -- it survives IndexedDB but breaks JSON export.
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** Tags: strings only, trimmed, deduplicated, capped in both count and length. */
export function sanitizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, LIMITS.tagChars);
    if (tag) seen.add(tag);
    if (seen.size >= LIMITS.tags) break;
  }
  return [...seen];
}

/**
 * Style overrides: a flat, small, JSON-safe record.
 *
 * Stored as a sparse diff against the user's defaults, so changing a default updates old
 * notes. Anything nested or non-primitive is dropped rather than stored -- the style layer
 * only ever reads scalars, and accepting more would mean storing something no version of the
 * renderer knows how to use.
 */
export function sanitizeStyle(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    // `__proto__` arrives as a real own property out of JSON.parse, so it does reach this
    // loop. The nested-value check below already drops it, but skipping it by name is the
    // honest guard rather than a lucky one.
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (k.length > 40 || Object.keys(out).length >= 40) continue;
    if (typeof value === 'string') {
      if (value.length <= 200) out[k] = value;
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) out[k] = value;
    } else if (typeof value === 'boolean') {
      out[k] = value;
    }
  }
  return out;
}
