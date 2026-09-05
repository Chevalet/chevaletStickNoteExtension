/**
 * Content-script entry. Injected only into tabs that need it -- the background registers this
 * per origin-that-has-notes, so a site with no notes receives zero bytes.
 *
 * Plan sections 4-8. This file is the wiring: the host, the handshake, the note views, and
 * the two numbers the close guard needs. The interesting parts live in host.ts, anchor/,
 * physics/ and note/.
 */

import {
  type CsToBg,
  type HelloReply,
  type NoteWire,
  PROTOCOL_V,
  type Reply,
} from '~/bg/msg/protocol.ts';
import type { NoteId } from '~/shared/types.ts';
import {
  type Anchor,
  buildTextIndex,
  captureAt,
  captureSelection,
  GOOD_ENOUGH,
  ORPHAN_BELOW,
  resolveAnchor,
} from './anchor/index.ts';
import { createSharedDefs } from './art/defs.ts';
import { createHost, type Host } from './host.ts';
import { History } from './note/history.ts';
import { NoteView } from './note/NoteView.ts';
import { type NoteStyle, resolveStyle } from './note/theme.ts';
import { Loop } from './physics/spring.ts';
import { SHEET_CSS } from './styles.ts';

declare const __DEV__: boolean;

let host: Host | null = null;
const loop = new Loop();
const views = new Map<NoteId, NoteView>();
let topZ = 10;
let enabled = false;
/**
 * The user's own default style, sparse, as sent with the handshake.
 *
 * Every note resolves its own sparse overrides against this. Holding it here rather than in
 * each note is what lets "Save as my default" change how every existing note looks in the
 * fields it never touched itself.
 */
let noteDefaults: NoteStyle = resolveStyle({});
/**
 * The global movement cap, from the Movement setting, with `auto` already resolved by
 * the background.
 *
 * Held here rather than folded into `noteDefaults` because it is a CAP, not a default:
 * a note that chose reduced physics of its own accord must keep them when the global
 * setting says `full`.
 */
let motionCap: 'full' | 'reduced' | 'off' = 'full';

/**
 * The revision each mounted note was last known to be at.
 *
 * Sending it lets a genuine race with the manager page be reported rather than silently
 * clobbered. Without it every write says "rev 0 -- do not check", which is fine right up to
 * the moment two things edit the same note and one of them loses text.
 */
const revs = new Map<NoteId, number>();

/**
 * One undo history for the whole page.
 *
 * Ctrl+Z undoes the last thing you did, on whichever note you did it -- see note/history.ts
 * for why that is one stack rather than one per note. The applier lives here because undoing a
 * delete has to bring a note back onto the page, which only the renderer can do.
 */
const history = new History({
  setText: (id, text, caret) => views.get(id as NoteId)?.applyText(text, caret),
  setStyle: (id, style) => views.get(id as NoteId)?.applyStyleSet(style),
  setUi: (id, ui) => views.get(id as NoteId)?.applyUi(ui),
  patchInk: (id, add, remove) =>
    views.get(id as NoteId)?.applyInk(add as never[], remove as never[]),
  restoreNote: (id) => void restoreFromTrash(id as NoteId),
  trashNote: (id) => void trashAndUnmount(id as NoteId),
});

// ---------------------------------------------------------------- images

/**
 * Decoded images, by asset id.
 *
 * A note references an image as `att:<id>` in its markdown, and the renderer paints it into a
 * canvas rather than pointing an `<img>` at a URL. That is not fussiness: a content script's
 * `<img src>` is subject to the *page's* CSP, so on a site with a strict `img-src` the picture
 * would silently fail to appear. A canvas paint is not a fetch, so nothing can block it.
 */
const assetCanvases = new Map<string, HTMLCanvasElement>();
/** Ids already asked for, so a note with the same image twice does not fetch it twice. */
const assetsAsked = new Set<string>();

/** Pull in any image a note's text references, then re-render the notes that use them. */
async function ensureAssets(text: string): Promise<void> {
  const ids = [...text.matchAll(/!\[[^\]]*\]\(att:([A-Za-z0-9_-]+)\)/g)].map((m) => m[1] as string);
  let gained = false;
  for (const id of ids) {
    if (assetsAsked.has(id)) continue;
    assetsAsked.add(id);
    const reply = await ask<{ type: string; bytes: ArrayBuffer }>({ t: 'asset/get', id });
    if (!reply.ok) continue;
    try {
      const bmp = await createImageBitmap(new Blob([reply.data.bytes], { type: reply.data.type }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')?.drawImage(bmp, 0, 0);
      bmp.close();
      assetCanvases.set(id, c);
      gained = true;
    } catch {
      // An image we cannot decode simply stays missing, and the note shows its source text.
    }
  }
  if (gained) for (const v of views.values()) v.refreshPreview();
}

/**
 * Hand the markdown renderer something to draw.
 *
 * A fresh canvas each time, copied from the cached one: the same image may appear in two notes,
 * and a DOM node can only be in one place.
 */
function assetCanvas(id: string): HTMLElement | null {
  const cached = assetCanvases.get(id);
  if (!cached) return null;
  const c = document.createElement('canvas');
  c.width = cached.width;
  c.height = cached.height;
  c.getContext('2d')?.drawImage(cached, 0, 0);
  return c;
}

/** Undo of a delete: the note is in the trash, so bring it back and re-mount it. */
async function restoreFromTrash(id: NoteId): Promise<void> {
  if (views.has(id)) return;
  const reply = await ask<{ note: NoteWire }>({ t: 'note/restore', id });
  if (!reply.ok) return;
  mountNote(reply.data.note);
  reportGuardState();
}

/** Undo of a create, and the ordinary delete path. Soft: it goes to the trash. */
async function trashAndUnmount(id: NoteId): Promise<void> {
  const view = views.get(id);
  view?.destroy();
  views.delete(id);
  revs.delete(id);
  pending.delete(id);
  await ask({ t: 'note/delete', id, soft: true });
  reportGuardState();
}

async function ask<T>(msg: CsToBg): Promise<Reply<T>> {
  try {
    return (await browser.runtime.sendMessage(msg)) as Reply<T>;
  } catch (e) {
    // "Extension context invalidated" means we are an orphan from a previous version.
    if (String(e).includes('context invalidated')) teardown('update');
    return { ok: false, code: 'INTERNAL', detail: String(e) };
  }
}

function teardown(reason: string): void {
  for (const v of views.values()) v.destroy();
  views.clear();
  host?.destroy();
  host = null;
  enabled = false;
  if (__DEV__) console.warn(`[cn] torn down: ${reason}`);
}

function mount(): Host {
  if (host) return host;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(SHEET_CSS);
  host = createHost(sheet);
  host.root.prepend(createSharedDefs());
  return host;
}

/**
 * Tell the background what the close guard needs to know.
 *
 * Two numbers. The background owns the policy and the budget, because a content script cannot
 * know what other tabs are doing -- and the whole point of the budget is that closing a
 * window with a dozen annotated tabs must not produce a dozen dialogs.
 */
function reportGuardState(): void {
  void ask({ t: 'guard/state', hasUnsaved: pending.size > 0, noteCount: views.size });
}

// ---------------------------------------------------------------------- saving

/**
 * Debounced write, with pending patches MERGED rather than replaced.
 *
 * Replacing loses data: typing and then recolouring inside the same window would throw the
 * text away. That bug showed up in the playground harness first, which is exactly what the
 * harness is for.
 */
const pending = new Map<NoteId, Record<string, unknown>>();
const timers = new Map<NoteId, number>();

function save(id: NoteId, patch: Record<string, unknown>): void {
  const previous = pending.get(id);
  const merged: Record<string, unknown> = { ...previous, ...patch };
  for (const key of ['ui', 'style'] as const) {
    if (patch[key]) {
      merged[key] = {
        ...((previous?.[key] as Record<string, unknown>) ?? {}),
        ...(patch[key] as Record<string, unknown>),
      };
    }
  }
  pending.set(id, merged);
  reportGuardState();

  clearTimeout(timers.get(id));
  timers.set(
    id,
    self.setTimeout(() => void flush(id), 250),
  );
}

async function flush(id: NoteId): Promise<void> {
  const patch = pending.get(id);
  if (!patch) return;
  pending.delete(id);
  timers.delete(id);

  const reply = await ask<{ rev: number }>({
    t: 'note/patch',
    id,
    rev: revs.get(id) ?? 0,
    patch: patch as never,
    clock: {},
  });

  if (reply.ok) {
    revs.set(id, reply.data.rev);
  } else if (reply.code === 'STALE_REV') {
    // Someone else -- the manager page, or another tab on the same URL -- wrote first. The
    // person typing here is the one whose intent we can actually see, so their text wins;
    // but we adopt the new revision so the NEXT write is not a conflict too.
    const current = Number(reply.detail);
    revs.set(id, Number.isFinite(current) ? current : 0);
    await ask({ t: 'note/patch', id, rev: 0, patch: patch as never, clock: {} });
  } else if (reply.code === 'NOT_FOUND') {
    // Deleted underneath us. Take the note off the page rather than leaving a ghost that
    // silently fails to save every few seconds.
    views.get(id)?.destroy();
    views.delete(id);
    revs.delete(id);
  }
  reportGuardState();
}

async function flushAll(): Promise<void> {
  for (const id of [...pending.keys()]) {
    clearTimeout(timers.get(id));
    await flush(id);
  }
}

// ---------------------------------------------------------------------- notes

function mountNote(wire: NoteWire): NoteView {
  const layer = mount().docLayer;
  revs.set(wire.id, wire.rev);
  const at = placeFor(wire);
  const view = new NoteView(
    {
      id: wire.id,
      x: at.x,
      y: at.y,
      w: wire.ui.w,
      h: wire.ui.h,
      z: wire.ui.z,
      text: wire.body.text,
      style: wire.style as never,
      collapsed: wire.ui.collapsed,
      locked: wire.ui.locked,
      // Without this line every drawing was lost on reload. The background has always sent
      // `ink` on the wire; the field was simply missing from `NoteWire` and from here, so it
      // arrived and was dropped. See the comment on NoteWire.ink.
      ...(wire.ink ? { ink: wire.ink } : {}),
    },
    {
      loop,
      layer,
      history,
      defaults: noteDefaults,
      motion: () => motionCap,
      /*
       * The background reads the packaged file; this side only asks.
       *
       * A content script cannot fetch a moz-extension URL unless the file is in
       * `web_accessible_resources`, and putting the fonts there would make them readable from
       * any page on the web. One round trip per face per page -- `ensureFont` will not ask
       * twice -- and the reply is an ArrayBuffer, which is what `FontFace` wants anyway.
       */
      fontBytes: async (file) => {
        const reply = await ask<{ bytes: ArrayBuffer }>({ t: 'font/bytes', file });
        if (!reply.ok) {
          if (__DEV__) console.warn('[cn] font refused:', file, reply.code);
          return null;
        }
        return reply.data.bytes;
      },
      raise: () => ++topZ,
      onChange: (n) =>
        save(wire.id, {
          ui: { ...n.position, ...n.size, collapsed: n.isCollapsed },
          style: n.styleOverrides,
        }),
      onText: (_n, text) => save(wire.id, { body: { text } }),
      onStyle: (_n, overrides) => save(wire.id, { style: overrides }),
      onAsset: async (_n, file, name) => {
        const bytes = await file.arrayBuffer();
        const reply = await ask<{ id: string }>({
          t: 'asset/put',
          noteId: wire.id,
          name,
          type: file.type || 'image/png',
          bytes,
        });
        if (!reply.ok) {
          if (__DEV__) console.warn('[cn] image refused:', reply.code, reply.detail);
          return null;
        }
        // Decode it now so the note can draw it without waiting for a round trip.
        assetsAsked.delete(reply.data.id);
        await ensureAssets(`![](att:${reply.data.id})`);
        return reply.data.id;
      },
      resolveAsset: (id) => assetCanvas(id),
      onSaveDefault: (_n, style) => {
        void ask({
          t: 'settings/saveDefaults',
          style: style as unknown as Record<string, unknown>,
        });
      },
      onInk: (_n, ink) => save(wire.id, { ink }),
      onDelete: (n) => {
        // Recorded before the note goes, so Ctrl+Z brings it back.
        history.record({
          noteId: wire.id,
          edit: { kind: 'delete' },
          mergeKey: null,
          at: Date.now(),
        });
        n.destroy();
        views.delete(wire.id);
        revs.delete(wire.id);
        pending.delete(wire.id);
        void ask({ t: 'note/delete', id: wire.id, soft: true });
        reportGuardState();
      },
    },
  );
  topZ = Math.max(topZ, wire.ui.z);
  views.set(wire.id, view);
  return view;
}

/**
 * Where a note actually goes.
 *
 * Stored coordinates are the truth when the page has not moved, but pages do move: a banner
 * appears, an ad loads, the layout reflows at a different width. So the anchor is re-resolved
 * and its answer preferred when it is confident enough, and the stored coordinates are the
 * fallback rather than the other way round. An anchor that has lost its target entirely is
 * reported, not silently trusted.
 */
function placeFor(wire: NoteWire): { x: number; y: number; orphan: boolean } {
  const anchor = wire.anchor as Anchor | null;
  if (!anchor || typeof anchor !== 'object' || !('mode' in anchor)) {
    return { x: wire.ui.x, y: wire.ui.y, orphan: false };
  }
  try {
    const r = resolveAnchor(anchor);
    if (r.confidence >= GOOD_ENOUGH) return { x: r.x, y: r.y, orphan: false };
    if (r.confidence < ORPHAN_BELOW) return { x: wire.ui.x, y: wire.ui.y, orphan: true };
    return { x: wire.ui.x, y: wire.ui.y, orphan: false };
  } catch {
    return { x: wire.ui.x, y: wire.ui.y, orphan: false };
  }
}

/**
 * Make a note.
 *
 * The background owns the id, the revision and the scope -- a content script gets to say
 * where and what, never which page's notes it is writing into. If the reply says no, nothing
 * appears; a note that looks created but was never stored is the worst outcome here.
 */
async function create(opts: {
  docX: number;
  docY: number;
  anchor?: Anchor | null;
  text?: string;
}): Promise<NoteView | null> {
  const anchor = opts.anchor ?? captureAt(opts.docX, opts.docY);
  const reply = await ask<{ note: NoteWire }>({
    t: 'note/create',
    url: location.href,
    note: {
      scope: { kind: 'global' },
      body: { format: 'md', text: opts.text ?? '' },
      ui: {
        x: Math.round(opts.docX),
        y: Math.round(opts.docY),
        w: 240,
        h: 200,
        z: ++topZ,
        collapsed: false,
        locked: false,
        opacity: 1,
      },
      anchor,
      style: {},
      tags: [],
    } as never,
  });

  if (!reply.ok) {
    if (__DEV__) console.warn('[cn] create refused:', reply.code, reply.detail);
    return null;
  }

  const view = mountNote(reply.data.note);
  history.record({
    noteId: reply.data.note.id,
    edit: { kind: 'create' },
    mergeKey: null,
    at: Date.now(),
  });
  reportGuardState();
  // Straight into editing: nobody makes an empty note on purpose.
  view.focusBody();
  return view;
}

/**
 * A new note where the user is looking: on their selection, on the element they
 * right-clicked, or failing both, in from the top-left of the viewport.
 */
async function createFromCommand(targetElementId?: number): Promise<void> {
  if (!enabled) return;

  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    // Only anchor to a selection that is actually in the page, not inside one of our notes.
    if (!mount().rootEl.contains(range.commonAncestorContainer)) {
      const anchor = captureSelection(range, buildTextIndex());
      if (anchor) {
        const rect = range.getBoundingClientRect();
        await create({
          docX: rect.right + window.scrollX + 12,
          docY: rect.top + window.scrollY,
          anchor,
        });
        return;
      }
    }
  }

  // A right-click carries the element that was under the pointer. Asking the browser for it
  // is exact, where reconstructing a position from the menu click is not.
  if (targetElementId !== undefined) {
    const el = browser.menus.getTargetElement?.(targetElementId) as Element | null;
    if (el && !mount().rootEl.contains(el)) {
      const rect = el.getBoundingClientRect();
      const docX = rect.left + window.scrollX;
      const docY = rect.top + window.scrollY;
      // An element the size of the page tells us nothing useful; fall through to the viewport
      // placement rather than pinning a note to the top of <body>.
      if (rect.width > 0 && rect.height > 0 && rect.height < window.innerHeight * 2) {
        await create({ docX: docX + Math.min(rect.width, 80), docY });
        return;
      }
    }
  }

  // Nothing to go on: a little in from the top-left of what is on screen, offset so a second
  // note does not land exactly on the first.
  const step = (views.size % 5) * 18;
  await create({
    docX: window.scrollX + 40 + step,
    docY: window.scrollY + 80 + step,
  });
}

async function boot(): Promise<void> {
  const reply = await ask<HelloReply>({ t: 'hello', url: location.href, protocolV: PROTOCOL_V });
  if (!reply.ok) return;

  const hello = reply.data;
  if (hello.protocolV !== PROTOCOL_V) return teardown('protocol mismatch');
  enabled = hello.enabled;
  noteDefaults = resolveStyle(hello.noteDefaults ?? {});
  motionCap = hello.motion ?? 'full';

  if (!enabled) {
    // Stay resident but inert: no host element, no observers, no listeners on the page.
    reportGuardState();
    return;
  }

  for (const wire of hello.notes) mountNote(wire);
  // Images the notes already reference, fetched once and painted when they arrive.
  void Promise.all(hello.notes.map((w) => ensureAssets(w.body.text)));
  // The host is created lazily, so a page with no notes still costs nothing until the first
  // one is made -- but the keyboard shortcut has to work there, which is why this is no
  // longer an early return.
  armCreateGesture();
  reportGuardState();
}

/**
 * Double-click on empty page space makes a note there.
 *
 * Guarded hard, because this listener lives on someone else's page: it never fires for a
 * click inside a note (shadow events retarget to the host, so the path has to be checked),
 * never on a control or a link, and never where the page has its own double-click handling to
 * do -- editable regions and text selection are the page's, not ours.
 */
let gestureArmed = false;
function armCreateGesture(): void {
  if (gestureArmed) return;
  gestureArmed = true;

  document.addEventListener(
    'dblclick',
    (e) => {
      if (!enabled || !e.isTrusted || e.button !== 0 || !e.altKey) return;
      if (host && e.composedPath().includes(host.rootEl)) return;

      const target = e.target as Element | null;
      if (target?.closest?.('a,button,input,textarea,select,[contenteditable],[role=button]')) {
        return;
      }

      e.preventDefault();
      void create({ docX: e.pageX, docY: e.pageY });
    },
    // Not capture: the page sees the event first and can do its own thing with it. Ours is
    // the alt-modified gesture, which nothing on the web uses for double-click.
    { passive: false },
  );
}

// --------------------------------------------------------------------- inbound

browser.runtime.onMessage.addListener((msg: unknown) => {
  const type = (msg as { t?: string } | null)?.t;

  if (type === 'teardown') {
    teardown((msg as { reason: string }).reason);
    return Promise.resolve({ ok: true });
  }

  if (type === 'tab/enabled') {
    if ((msg as { enabled: boolean }).enabled) void boot();
    else teardown('disabled');
    return Promise.resolve({ ok: true });
  }

  if (type === 'defaults/changed') {
    // Re-resolve every mounted note. A note keeps its own overrides and only the fields it
    // never set follow the new default, which is the whole point of storing both sparsely.
    const m = msg as { style: Record<string, unknown>; motion?: typeof motionCap };
    noteDefaults = resolveStyle(m.style);
    motionCap = m.motion ?? motionCap;
    for (const view of views.values()) view.setDefaults(noteDefaults);
    return Promise.resolve({ ok: true });
  }

  if (type === 'command') {
    const m = msg as { name: string; targetElementId?: number };
    if (m.name === 'cycle-notes') cycleFocus();
    if (m.name === 'new-note' || m.name === 'note-on-selection') {
      void createFromCommand(m.targetElementId);
    }
    return Promise.resolve({ ok: true });
  }

  // guard/set is handled by cs/guard.ts, which is a separate, tiny bundle.
  return undefined;
});

/**
 * Move focus to the next note.
 *
 * Notes stay outside the page's tab order on purpose (plan section 6) -- putting focusable
 * elements into someone else's page is a measurable change to that page's behaviour. So the
 * keyboard route in is a `browser.commands` shortcut, handled by the browser chrome at zero
 * cost to the page.
 */
let focusIndex = -1;
function cycleFocus(): void {
  const all = [...views.values()];
  if (all.length === 0) return;
  focusIndex = (focusIndex + 1) % all.length;
  all[focusIndex]?.el.focus({ preventScroll: false });
}

// A bfcache restore fires no navigation event the background can see, so the content script
// has to notice it and re-establish context itself.
window.addEventListener('pageshow', (e) => {
  if ((e as PageTransitionEvent).persisted) void boot();
});

// Whatever is queued when the page goes away is written first. This is why the close warning
// is a courtesy: by the time it could appear, the note is already saved.
window.addEventListener('pagehide', () => void flushAll());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushAll();
});

void boot();
