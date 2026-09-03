/**
 * The playground: the whole note stack running in an ordinary page.
 *
 * Same host, same shadow root, same NoteView, same physics, same IndexedDB schema and the same
 * URL scoping the extension uses. The only thing faked is the page URL itself -- a `?page=`
 * parameter stands in for "which site you are on", so URL scoping can be exercised by clicking
 * rather than by opening real websites.
 *
 * That makes this the fastest way to check whether a change actually works, for a person or
 * for an agent, without loading anything into Firefox.
 *
 * Dev-only. Never shipped.
 */

import {
  createNote,
  notesForContext,
  patchNote,
  restoreNote,
  listTrash,
  trashNote,
} from '~/bg/db/notes.ts';
import { openDb } from '~/bg/db/open.ts';
import type { NoteRecord } from '~/bg/db/schema.ts';
import { defaultScopeFor, matchContext } from '~/bg/scope/match.ts';
import { createSharedDefs } from '~/cs/art/defs.ts';
import { createHost } from '~/cs/host.ts';
import { NoteView } from '~/cs/note/NoteView.ts';
import { PALETTES } from '~/cs/note/theme.ts';
import { Loop } from '~/cs/physics/spring.ts';
import { SHEET_CSS } from '~/cs/styles.ts';
import type { NoteId } from '~/shared/types.ts';

declare const __VERSION__: string;

// --------------------------------------------------------------- fake pages

const PAGES: Array<{ id: string; url: string; label: string }> = [
  { id: 'article', url: 'https://demo.chevalet.dev/blog/xerox-and-the-zine', label: 'An article' },
  { id: 'article-utm', url: 'https://demo.chevalet.dev/blog/xerox-and-the-zine?utm_source=twitter', label: 'Same article, shared link (?utm_source)' },
  { id: 'article-www', url: 'http://www.demo.chevalet.dev/blog/xerox-and-the-zine/', label: 'Same article, http + www + trailing slash' },
  { id: 'other', url: 'https://demo.chevalet.dev/blog/something-else', label: 'A different article' },
  { id: 'video-a', url: 'https://www.youtube.com/watch?v=aaa111&t=30s', label: 'YouTube video A' },
  { id: 'video-a2', url: 'https://www.youtube.com/watch?v=aaa111&t=902s', label: 'Same video, later timestamp' },
  { id: 'video-b', url: 'https://www.youtube.com/watch?v=bbb222', label: 'YouTube video B' },
  { id: 'spa-inbox', url: 'https://app.demo.dev/#/inbox', label: 'Hash-router SPA: /#/inbox' },
  { id: 'spa-settings', url: 'https://app.demo.dev/#/settings', label: 'Hash-router SPA: /#/settings' },
];

function currentPage(): (typeof PAGES)[number] {
  const want = new URL(location.href).searchParams.get('page');
  return PAGES.find((p) => p.id === want) ?? (PAGES[0] as (typeof PAGES)[number]);
}

// ------------------------------------------------------------------- mount

const sheet = new CSSStyleSheet();
sheet.replaceSync(SHEET_CSS);
const host = createHost(sheet);
host.root.prepend(createSharedDefs());

const loop = new Loop();
const views = new Map<NoteId, NoteView>();
let topZ = 10;

const el = (id: string) => document.getElementById(id);
const page = currentPage();

/** Debounced autosave, one timer per note. Mirrors the extension's 250ms quiet window. */
const saveTimers = new Map<NoteId, number>();
function queueSave(id: NoteId, patch: Parameters<typeof patchNote>[1]): void {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    self.setTimeout(async () => {
      saveTimers.delete(id);
      await patchNote(id, patch);
      void refreshStatus();
    }, 250),
  );
}

function mount(rec: NoteRecord): NoteView {
  const view = new NoteView(
    {
      id: rec.id,
      x: rec.ui.x,
      y: rec.ui.y,
      w: rec.ui.w,
      h: rec.ui.h,
      z: rec.ui.z,
      text: rec.body.text,
      style: rec.style as never,
      collapsed: rec.ui.collapsed,
      locked: rec.ui.locked,
      ...(rec.ink ? { ink: rec.ink } : {}),
    },
    {
      loop,
      layer: host.docLayer,
      raise: () => ++topZ,
      onChange: (n) => {
        const { x, y } = n.position;
        const { w, h } = n.size;
        queueSave(rec.id, {
          ui: { x, y, w, h, collapsed: n.isCollapsed },
          style: { palette: n.styleNow.palette },
        });
      },
      onInk: (_n, ink) => queueSave(rec.id, { ink }),
      onDelete: (n) => void remove(rec.id, n),
    },
  );
  topZ = Math.max(topZ, rec.ui.z);

  // Text edits: the note body is a contenteditable in the shadow root.
  const body = view.el.querySelector('.body');
  body?.addEventListener('input', () => queueSave(rec.id, { body: { text: view.text } }));

  views.set(rec.id, view);
  return view;
}

/** Delete with an undo window, because a sticky note is exactly the thing you delete by accident. */
async function remove(id: NoteId, view: NoteView): Promise<void> {
  await trashNote(id);
  view.destroy();
  views.delete(id);
  await refreshStatus();
  toast('Note deleted', 'Undo', async () => {
    await restoreNote(id);
    await load();
  });
}

let toastTimer = 0;
function toast(message: string, actionLabel?: string, action?: () => void): void {
  const host = el('toast');
  if (!host) return;
  host.textContent = message;
  if (actionLabel && action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sm';
    b.textContent = actionLabel;
    b.addEventListener('click', () => {
      host.hidden = true;
      action();
    });
    host.append(' ', b);
  }
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = self.setTimeout(() => {
    host.hidden = true;
  }, 6000);
}

async function load(): Promise<void> {
  for (const v of views.values()) v.destroy();
  views.clear();

  const ctx = matchContext(page.url);
  if (!ctx) return;
  for (const rec of await notesForContext(ctx)) mount(rec);
  await refreshStatus();
}

async function addNote(x: number, y: number, paletteIndex?: number): Promise<void> {
  const scope = defaultScopeFor(page.url);
  if (!scope) return;
  const palette = PALETTES[(paletteIndex ?? views.size) % PALETTES.length];
  const rec = await createNote({
    scope,
    text: '',
    ui: { x, y, w: 240, h: 170, z: ++topZ, collapsed: false, locked: false, opacity: 1 },
    style: { palette: palette?.id ?? 'postit' },
    context: { url: page.url, title: page.label },
  });
  const view = mount(rec);
  view.focusBody();
  await refreshStatus();
}

// ------------------------------------------------------------------ status

async function refreshStatus(): Promise<void> {
  const ctx = matchContext(page.url);
  const scope = defaultScopeFor(page.url);
  const key = scope && scope.kind === 'url' ? scope.urlKey : '(none)';
  const trash = await listTrash();

  const bar = el('status');
  if (bar) {
    bar.textContent =
      `v${__VERSION__}  ·  notes here: ${views.size}  ·  in trash: ${trash.length}` +
      `  ·  loop ${loop.running ? 'running' : 'idle'}`;
  }
  const keyEl = el('urlkey');
  if (keyEl) keyEl.textContent = key;
  const ctxEl = el('ctx');
  if (ctxEl && ctx) ctxEl.textContent = `origin ${ctx.origin} · domain ${ctx.registrable}`;

  const trashEl = el('trash');
  if (trashEl) {
    trashEl.textContent = '';
    for (const t of trash.slice(0, 8)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm';
      b.textContent = `restore: ${t.title || '(empty)'}`;
      b.addEventListener('click', async () => {
        await restoreNote(t.id);
        await load();
      });
      trashEl.append(b);
    }
  }
}

// ------------------------------------------------------------------ wiring

function buildPageSwitcher(): void {
  const sel = el('page') as HTMLSelectElement | null;
  if (!sel) return;
  for (const p of PAGES) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    o.selected = p.id === page.id;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    const u = new URL(location.href);
    u.searchParams.set('page', sel.value);
    location.href = u.toString();
  });
  const urlEl = el('pageurl');
  if (urlEl) urlEl.textContent = page.url;
}

// Double-click anywhere on the page body to stick a note there, in DOCUMENT coordinates --
// which is why it scrolls with the content rather than floating over the viewport.
document.addEventListener('dblclick', (e) => {
  if ((e.target as HTMLElement).closest('#panel')) return;
  // Events from inside a note retarget to the shadow host, so a double-click to select a word
  // in a note used to spawn a second note on top of it.
  if (e.composedPath().includes(host.rootEl)) return;
  void addNote(e.clientX + window.scrollX - 40, e.clientY + window.scrollY - 14);
});

el('add')?.addEventListener('click', () => {
  void addNote(60 + window.scrollX + views.size * 24, 140 + window.scrollY + views.size * 18);
});
el('reload')?.addEventListener('click', () => void load());
el('wipe')?.addEventListener('click', async () => {
  if (!confirm('Delete every note in the playground database?')) return;
  indexedDB.deleteDatabase('chevaletNote');
  location.reload();
});

// Exposed so an automated pass can drive the same code paths a person would.
declare global {
  interface Window {
    cn: {
      addNote: typeof addNote;
      load: typeof load;
      views: Map<NoteId, NoteView>;
      loop: Loop;
      page: typeof page;
      host: typeof host;
    };
  }
}
window.cn = { addNote, load, views, loop, page, host };

// Content scripts are IIFE bundles, which cannot carry top-level await -- so the harness
// boots the same way the real renderer does.
void (async () => {
  await openDb();
  buildPageSwitcher();
  await load();
})();
