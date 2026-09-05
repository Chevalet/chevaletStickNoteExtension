/**
 * Export notes as something you can read without this extension: one Markdown file, or one
 * HTML page.
 *
 * ## Why this is not the ZIP
 *
 * The ZIP is a backup. It is complete, it round-trips, and it is the thing to keep -- and it
 * is also a folder of NDJSON that nobody reads for pleasure. These two are the opposite trade:
 * they lose the positions, the palettes, the anchors and the ability to come back, and in
 * exchange they open in anything.
 *
 * That is worth saying out loud in the interface, because "Export" appearing three times in a
 * menu invites someone to pick the wrong one and find out a year later. The ZIP is the one
 * described as a backup; these two are described as copies to read.
 *
 * ## One file, not a folder
 *
 * The archive already writes a `readable/` tree, one markdown file per note. It is the right
 * shape inside a zip and the wrong shape for a person who wants to read their notes: forty
 * files in nested folders, each holding two lines. So both of these are a single document,
 * grouped by the page the notes were made on, in the order they were made.
 *
 * ## The HTML is self-contained, and that is the whole point
 *
 * No stylesheet, no script, no font, no image request -- one file that renders identically on
 * a machine that has never heard of this extension, offline, in five years. Images travel as
 * data: URIs. That makes the file big, which is the honest cost of "self-contained"; the size
 * comes back in the result so the caller can say so before the download starts.
 *
 * There is no script in the output at all. A note is arbitrary text from arbitrary pages, and
 * the safe way to ship arbitrary text is as text: every value below goes through `esc`, and
 * the markdown is rendered by the same renderer the notes themselves use -- which builds DOM
 * nodes and never touches innerHTML -- and then serialised. Nothing in a note can become a
 * tag, because at no point is any of it parsed as HTML.
 */

import type { NoteRecord } from '~/bg/db/schema.ts';
import { renderMarkdown } from '~/cs/note/markdown.ts';

export interface ExportAsset {
  id: string;
  mime: string;
  /** Base64, without the data: prefix. */
  base64: string;
}

export interface TextExportInput {
  notes: NoteRecord[];
  assets?: ExportAsset[];
  title?: string;
  now?: Date;
}

/** Escape for HTML text and attribute content. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Notes gathered under the page they were made on, each group in creation order.
 *
 * `context.url` is what a person recognises -- it is the page they were reading. The scope is
 * what the extension matches on and is often a normalised key with the tracking parameters
 * stripped, so it makes a worse heading and a better tiebreak.
 */
function byPage(notes: NoteRecord[]): Array<{ page: string; title: string; notes: NoteRecord[] }> {
  const groups = new Map<string, { page: string; title: string; notes: NoteRecord[] }>();
  for (const note of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
    const page =
      note.context?.url ??
      (note.scope.kind === 'url' ? note.scope.urlKey : note.ix_domain || note.ix_origin) ??
      '';
    const key = page || 'unfiled';
    const group = groups.get(key);
    if (group) group.notes.push(note);
    else groups.set(key, { page, title: note.context?.title ?? '', notes: [note] });
  }
  return [...groups.values()];
}

const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// ------------------------------------------------------------------ markdown

/**
 * One Markdown document.
 *
 * The note text is passed through UNCHANGED. It is already markdown -- that is what a note
 * body is -- and reformatting it would be this function inventing edits to someone's writing.
 * The only thing added is the heading structure around it, and the notes are indented by
 * nothing, so a note that starts with `# Heading` still reads correctly under an `##` page
 * heading.
 */
export function toMarkdown(input: TextExportInput): string {
  const groups = byPage(input.notes);
  const out: string[] = [
    `# ${input.title ?? 'My notes'}`,
    '',
    `*${input.notes.length} note${input.notes.length === 1 ? '' : 's'}, exported ${stamp((input.now ?? new Date()).getTime())}*`,
    '',
  ];

  for (const group of groups) {
    out.push('---', '');
    out.push(`## ${group.title || group.page || 'Unfiled'}`, '');
    if (group.page) out.push(`<${group.page}>`, '');
    for (const note of group.notes) {
      out.push(`*${stamp(note.updatedAt)}*`, '');
      out.push(note.body.text.trim(), '');
      if (note.ink?.strokes.length) {
        // Said rather than silently dropped: a drawing cannot be written as markdown, and
        // someone comparing this file with the app should be told what is not in it.
        out.push('> *(this note also has a drawing on it, which is only in the ZIP)*', '');
      }
      if (note.tags.length) out.push(`tags: ${note.tags.join(', ')}`, '');
    }
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

// ---------------------------------------------------------------------- html

/**
 * Serialise a note's markdown to an HTML string, using the app's own renderer.
 *
 * Needs a `document`, which is why this whole module lives in the manager page rather than the
 * background: the alternative is a second markdown-to-HTML implementation, and two renderers
 * disagreeing about someone's notes is worse than either.
 */
function bodyHtml(note: NoteRecord, assets: Map<string, ExportAsset>): string {
  const holder = document.createElement('div');
  holder.append(
    renderMarkdown(note.body.text, {
      readOnly: true,
      resolveAsset: (id) => {
        const asset = assets.get(id);
        if (!asset) return null;
        const img = document.createElement('img');
        // A data: URI, so the page needs nothing from anywhere. This is where the file size
        // goes, and it is the price of a document that still works offline in five years.
        img.src = `data:${asset.mime};base64,${asset.base64}`;
        img.alt = '';
        return img;
      },
    }),
  );
  /*
   * Reflect the checkbox state onto ATTRIBUTES before serialising.
   *
   * `renderMarkdown` sets `box.checked` and `box.disabled` as properties, which is exactly
   * right for a live note and invisible to `innerHTML`: a property is not an attribute. Left
   * alone, every task list in an exported page came out unticked and clickable -- the
   * document would silently disagree with the note it was made from, which is the one thing
   * an export must never do. Found by a test asserting the output contained a ticked box.
   */
  for (const box of holder.querySelectorAll('input[type="checkbox"]')) {
    const input = box as HTMLInputElement;
    if (input.checked) input.setAttribute('checked', '');
    else input.removeAttribute('checked');
    input.setAttribute('disabled', '');
  }
  return holder.innerHTML;
}

const HTML_CSS = `
:root { --ink:#14110e; --paper:#f2ece0; --card:#fffdf6; --dim:#6f665a; --edge:#14110e;
        --accent:#ff2e63; --manila:#e8c98a; color-scheme: light; }
@media (prefers-color-scheme: dark) {
  :root { --ink:#ebe4d7; --paper:#1c1a17; --card:#24211d; --dim:#a49b8d; --edge:#423c34;
          --accent:#f4718c; --manila:#766036; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin:0; padding:32px 20px 80px; background:var(--paper); color:var(--ink);
       font:15px/1.6 ui-monospace,"Cascadia Mono",Consolas,monospace; }
main { max-width: 780px; margin: 0 auto; }
h1 { font-size:26px; letter-spacing:-.02em; margin:0 0 4px; }
h1::after { content:''; display:block; width:64px; height:5px; margin-top:10px;
            background:var(--accent); }
.meta { color:var(--dim); font-size:12.5px; margin:12px 0 30px; }
section { margin: 0 0 34px; }
section > h2 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; margin:0;
               padding:7px 12px; background:var(--manila); color:var(--ink);
               border:2px solid var(--edge); border-bottom:0;
               clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 100%, 0 100%);
               width: fit-content; max-width:100%; }
section > .page { border:2px solid var(--edge); padding:14px; display:grid; gap:14px;
                  background:color-mix(in oklab, var(--manila) 22%, var(--card)); }
section > .page > .src { font-size:12px; color:var(--dim); word-break:break-all; margin:0; }
article { background:var(--card); border:2px solid var(--edge); padding:12px 14px;
          box-shadow:3px 3px 0 color-mix(in oklab, var(--edge) 55%, transparent); }
article > .when { font-size:11.5px; color:var(--dim); margin:0 0 8px; }
article :is(h1,h2,h3,h4) { font-size:1.05em; margin:.6em 0 .3em; }
article > :first-child { margin-top:0; }
article p { margin:.5em 0; }
article pre { overflow-x:auto; padding:8px 10px; direction:ltr; text-align:left;
              background:color-mix(in oklab, var(--ink) 7%, transparent); }
article code { background:color-mix(in oklab, var(--ink) 7%, transparent); padding:1px 3px; }
article blockquote { margin:.5em 0; padding-left:10px; border-left:3px solid var(--accent);
                     color:var(--dim); }
article img { max-width:100%; height:auto; display:block; }
article ul.task { list-style:none; padding-left:1.1em; }
article input[type=checkbox] { accent-color:var(--accent); }
article a { color:var(--accent); }
.ink { font-size:12px; color:var(--dim); font-style:italic; }
.tags { font-size:12px; color:var(--dim); }
@media print {
  body { padding:0; background:#fff; color:#000; }
  article { box-shadow:none; break-inside:avoid; }
}
`;

export interface HtmlExport {
  html: string;
  /** Bytes, so the caller can warn before handing someone a 40MB file. */
  bytes: number;
  /** Images embedded, and images referenced but not supplied. */
  images: { embedded: number; missing: number };
}

export function toHtml(input: TextExportInput): HtmlExport {
  const assets = new Map((input.assets ?? []).map((a) => [a.id, a]));
  const groups = byPage(input.notes);
  const title = input.title ?? 'My notes';
  let embedded = 0;
  let missing = 0;

  const parts: string[] = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${HTML_CSS}</style>`,
    '</head><body><main>',
    `<h1>${esc(title)}</h1>`,
    `<p class="meta">${input.notes.length} note${input.notes.length === 1 ? '' : 's'}, exported ${esc(stamp((input.now ?? new Date()).getTime()))} from Chevalet Note. This file needs nothing from the internet.</p>`,
  ];

  for (const group of groups) {
    parts.push('<section>');
    parts.push(`<h2>${esc(group.title || group.page || 'Unfiled')}</h2>`);
    parts.push('<div class="page">');
    if (group.page) {
      parts.push(`<p class="src"><a href="${esc(group.page)}">${esc(group.page)}</a></p>`);
    }
    for (const note of group.notes) {
      for (const id of note.assets) {
        if (assets.has(id)) embedded++;
        else missing++;
      }
      const dir = /[֐-ࣿ]/.test(note.body.text) ? ' dir="auto"' : '';
      parts.push(`<article${dir}>`);
      parts.push(`<p class="when">${esc(stamp(note.updatedAt))}</p>`);
      parts.push(bodyHtml(note, assets));
      if (note.ink?.strokes.length) {
        parts.push(
          '<p class="ink">This note also has a drawing on it, which is only in the ZIP.</p>',
        );
      }
      if (note.tags.length) parts.push(`<p class="tags">tags: ${esc(note.tags.join(', '))}</p>`);
      parts.push('</article>');
    }
    parts.push('</div></section>');
  }

  parts.push('</main></body></html>');
  const html = parts.join('\n');
  return {
    html,
    bytes: new TextEncoder().encode(html).length,
    images: { embedded, missing },
  };
}

/** What these land in Downloads as. */
export function textExportName(kind: 'md' | 'html', now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `chevalet-notes-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.${kind}`;
}
