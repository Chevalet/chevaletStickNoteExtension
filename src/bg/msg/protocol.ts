/**
 * The message contract between the four contexts (bg, cs, popup, manager).
 * Plan section 11.
 *
 * Rules this file exists to enforce:
 *  - Every message is versioned. A content script left over from a previous extension version
 *    must be able to detect the mismatch and tear itself down rather than misbehave.
 *  - `sender.tab.id` is authoritative. A content script never gets to name a tab id.
 *  - Replies are a discriminated union, never a thrown exception across the boundary.
 */

import type { InkStroke } from '~/bg/db/schema.ts';
import type { NoteId, Scope, UrlKey } from '~/shared/types.ts';

export const PROTOCOL_V = 1;

// --------------------------------------------------------------------------- note payloads

/** The subset of a note the renderer needs. Deliberately not the whole stored record. */
export interface NoteWire {
  id: NoteId;
  rev: number;
  scope: Scope;
  body: { format: 'md'; text: string };
  ui: {
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
    collapsed: boolean;
    locked: boolean;
    opacity: number;
  };
  anchor: unknown; // shaped by ~/cs/anchor; the background stores it opaquely
  /**
   * The note's drawing, if it has one.
   *
   * This field was missing from the interface while the background was already sending
   * it, so `mountNote` had nothing to pass to the NoteView and **every drawing was lost
   * on reload** -- transmitted, then dropped on the floor one line short of the screen.
   * The playground never showed it because it reads the record directly.
   */
  ink?: { strokes: InkStroke[]; w: number; h: number };
  style: Record<string, unknown>; // sparse diff against the user's defaults
  tags: string[];
  updatedAt: number;
}

/** A sparse change to a note. Field-level so a move never conflicts with an edit. */
export interface NotePatch {
  body?: { text: string };
  ui?: Partial<NoteWire['ui']>;
  anchor?: unknown;
  style?: Record<string, unknown>;
  tags?: string[];
  scope?: Scope;
}

// --------------------------------------------------------------------------- cs -> bg

export type CsToBg =
  /** First contact. Wakes the event page; the reply decides whether we render at all. */
  | { t: 'hello'; url: string; protocolV: number }
  | { t: 'notes/forContext'; url: string }
  | { t: 'note/create'; url: string; note: Omit<NoteWire, 'id' | 'rev' | 'updatedAt'> }
  | { t: 'note/patch'; id: NoteId; rev: number; patch: NotePatch; clock: Record<string, number> }
  | { t: 'note/delete'; id: NoteId; soft: boolean }
  /** Undo of a delete. The note is in the trash, not gone, so this is a restore. */
  | { t: 'note/restore'; id: NoteId }
  | { t: 'guard/state'; hasUnsaved: boolean; noteCount: number }
  | { t: 'tab/setEnabled'; enabled: boolean }
  | { t: 'editing/begin' }
  | { t: 'editing/end' }
  /** "Save as my default" in a note's settings panel. Sparse, and merged over what is stored. */
  | { t: 'settings/saveDefaults'; style: Record<string, unknown> }
  /**
   * A pasted or dropped image.
   *
   * Bytes rather than a Blob: `ArrayBuffer` is structured-cloneable across every extension
   * message boundary, and a content script cannot reach the extension's IndexedDB itself
   * because it runs in the page's origin.
   */
  | { t: 'asset/put'; noteId: NoteId; name: string; type: string; bytes: ArrayBuffer }
  /** Read one back, to paint into a canvas. No network is involved at any point. */
  | { t: 'asset/get'; id: string };

/** Sent by the options page, not by a content script. */
export type UiToBg = { t: 'update/check'; fromClick: boolean };

// --------------------------------------------------------------------------- bg -> cs

export type BgToCs =
  | {
      t: 'scope/apply';
      add: NoteWire[];
      remove: NoteId[];
      patch: Array<{ id: NoteId; rev: number; patch: NotePatch }>;
    }
  | { t: 'note/changed'; id: NoteId; rev: number; patch: NotePatch; origin: 'self' | 'other' }
  | { t: 'guard/set'; armed: boolean; reason: 'budget' | 'policy' | 'clean' }
  | { t: 'tab/enabled'; enabled: boolean }
  | { t: 'command'; name: 'new-note' | 'cycle-notes' | 'toggle-ghost' }
  | { t: 'teardown'; reason: 'disabled' | 'update' | 'revoked' }
  /**
   * Settings changed -- in the cabinet, in the options page, or in another tab. Notes
   * re-resolve against them.
   *
   * Broadcast from `storage.onChanged` rather than only from the note panel's "save as my
   * default", because the cabinet writes settings straight to storage. Without that,
   * every change made in the cabinet's settings pane -- the whole pane -- did nothing at
   * all in any tab that was already open.
   */
  | {
      t: 'defaults/changed';
      style: Record<string, unknown>;
      motion: 'full' | 'reduced' | 'off';
    };

// --------------------------------------------------------------------------- replies

export type ErrorCode =
  | 'STALE_REV'
  | 'NOT_FOUND'
  | 'QUOTA'
  | 'READONLY'
  | 'SCHEMA'
  | 'PROTOCOL'
  | 'NO_HOST_PERMISSION'
  | 'INTERNAL';

export type Reply<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; detail?: string };

export const okReply = <T>(data: T): Reply<T> => ({ ok: true, data });
export const errReply = (code: ErrorCode, detail?: string): Reply<never> =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };

/** What `hello` answers with. A protocol mismatch means the CS must tear down. */
export interface HelloReply {
  protocolV: number;
  version: string;
  enabled: boolean;
  urlKey: UrlKey | null;
  /** Zero means "do nothing at all" -- the common case, and the reason startup is free. */
  noteCount: number;
  notes: NoteWire[];
  /**
   * The user's own default note style, sparse. Sent with the handshake rather than fetched
   * separately, because every note on the page needs it before it can resolve its own
   * overrides, and a second round trip would mean notes rendering once in the built-in style
   * and again in the user's.
   */
  noteDefaults: Record<string, unknown>;
  /**
   * How much the paper is allowed to move, already resolved from the `auto` setting
   * against the browser's own reduced-motion preference. A cap, not an override: a note
   * that asked for less movement keeps it.
   */
  motion: 'full' | 'reduced' | 'off';
}
