/**
 * The cabinet's stylesheet.
 *
 * Same house as the notes -- acid yellow on newsprint, ink keylines, hard offset shadows,
 * halftone -- but this is a room full of filing furniture rather than a sheet of paper, so
 * the vocabulary is drawers, manila folders and index cards.
 *
 * Kept as a string next to the page so there is one stylesheet, no fetch, and the same
 * tokens the note layer uses.
 */

export const MANAGER_CSS = /* css */ `
:root {
  --ink: #14110e;
  --paper: #f2ece0;
  --card: #fffdf6;
  --hi: #ffe94a;
  --accent: #ff2e63;
  --cyan: #7ef0ff;
  --dim: #6f665a;
  --line: color-mix(in oklab, var(--ink) 18%, transparent);
  --manila: #e8c98a;
  --drawer: #23201b;
  --shadow: 5px 5px 0 var(--ink);
  --halftone: radial-gradient(var(--ink) .8px, transparent .9px);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background:
    var(--halftone) 0 0 / 5px 5px,
    var(--paper);
  background-blend-mode: multiply;
  color: var(--ink);
  font: 14px/1.55 ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace;
}
body[dir="rtl"] { direction: rtl; }

/* ------------------------------------------------------------------ chrome */

.top {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 18px;
  background: var(--ink);
  color: var(--hi);
  border-bottom: 3px solid var(--accent);
}
.brand { display: flex; align-items: center; gap: 9px; }
.brand img { width: 26px; height: 26px; display: block; }
.brand b { font-size: 15px; letter-spacing: -.2px; }
.brand span { color: var(--cyan); font-size: 11.5px; }

.grow { flex: 1 1 auto; }

.search {
  all: unset;
  box-sizing: border-box;
  flex: 1 1 260px;
  min-width: 160px;
  max-width: 420px;
  padding: 6px 10px;
  background: color-mix(in oklab, var(--hi) 14%, transparent);
  color: var(--hi);
  border: 2px solid color-mix(in oklab, var(--hi) 45%, transparent);
  font: inherit;
}
.search::placeholder { color: color-mix(in oklab, var(--hi) 55%, transparent); }
.search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.btn {
  all: unset;
  box-sizing: border-box;
  padding: 5px 11px;
  cursor: pointer;
  font: 700 12px/1.5 inherit;
  background: var(--hi);
  color: var(--ink);
  border: 2px solid var(--ink);
  box-shadow: 3px 3px 0 var(--accent);
  white-space: nowrap;
}
.btn:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--accent); }
.btn:active { transform: translate(3px, 3px); box-shadow: none; }
.btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.btn.ghost { background: transparent; color: var(--hi); box-shadow: none; border-color: color-mix(in oklab, var(--hi) 50%, transparent); }
.btn.ghost:hover { background: color-mix(in oklab, var(--hi) 18%, transparent); }
.btn.danger { background: var(--accent); color: #fff; box-shadow: 3px 3px 0 var(--ink); }
.btn[aria-pressed="true"] { background: var(--accent); color: #fff; }
.btn:disabled { opacity: .4; cursor: not-allowed; transform: none; }

/* ------------------------------------------------------------------ layout */

.wrap { display: grid; grid-template-columns: 232px 1fr; align-items: start; gap: 20px; padding: 20px 18px 90px; }
@media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } }

/* -------------------------------------------------------- the filing cabinet */

/* The left column is a cabinet: a dark carcass with a drawer per domain. */
.cabinet {
  position: sticky;
  top: 74px;
  background: var(--drawer);
  border: 3px solid var(--ink);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.cabinet h2 {
  margin: 0;
  padding: 8px 12px;
  font: 700 10.5px/1.6 inherit;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--cyan);
  border-bottom: 2px solid color-mix(in oklab, var(--cyan) 30%, transparent);
}
.drawers { max-height: min(62vh, 560px); overflow: auto; scrollbar-width: thin; }

/* Each drawer front has a pull and a count plate, like a real card index. */
.drawer {
  all: unset;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px 8px 12px;
  cursor: pointer;
  color: #efe7d6;
  border-bottom: 1px solid color-mix(in oklab, #efe7d6 14%, transparent);
  font: 12.5px/1.4 inherit;
  position: relative;
}
.drawer::before {
  content: '';
  position: absolute;
  inset-inline-start: 4px;
  top: 50%;
  width: 3px;
  height: 16px;
  transform: translateY(-50%);
  background: color-mix(in oklab, var(--cyan) 45%, transparent);
}
.drawer:hover { background: color-mix(in oklab, var(--cyan) 12%, transparent); }
.drawer[aria-current="true"] { background: var(--hi); color: var(--ink); }
.drawer[aria-current="true"]::before { background: var(--accent); }
.drawer .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer .count {
  font-size: 11px;
  padding: 0 5px;
  background: color-mix(in oklab, #efe7d6 20%, transparent);
  border-radius: 2px;
}
.drawer[aria-current="true"] .count { background: var(--ink); color: var(--hi); }

/* ------------------------------------------------------------------- main */

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 0 0 14px;
  font-size: 12.5px;
  color: var(--dim);
}
.bar .views { display: flex; gap: 0; }
.bar .views .btn { box-shadow: none; margin-inline-end: -2px; }

.empty {
  padding: 40px 22px;
  text-align: center;
  color: var(--dim);
  border: 3px dashed var(--line);
}
.empty b { display: block; font-size: 16px; color: var(--ink); margin-bottom: 6px; }

/* --------------------------------------------------------- folders and cards */

.folder { margin: 0 0 18px; }
/* A manila tab, cut at the corner the way a hanging folder is. */
.folder > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  padding: 5px 16px 5px 12px;
  cursor: pointer;
  list-style: none;
  background: var(--manila);
  color: var(--ink);
  border: 2px solid var(--ink);
  border-bottom: 0;
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 100%, 0 100%);
  font: 700 12px/1.5 inherit;
}
.folder > summary::-webkit-details-marker { display: none; }
.folder > summary:hover { background: color-mix(in oklab, var(--manila) 80%, var(--hi)); }
.folder > summary .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder > summary .n { opacity: .65; font-weight: 400; }
.folder[open] > summary { box-shadow: 0 2px 0 var(--ink); }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 14px;
  padding: 14px;
  border: 2px solid var(--ink);
  background: color-mix(in oklab, var(--manila) 22%, var(--card));
}

/* An index card: ruled, with a red margin line, and it leans a degree or two. */
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 128px;
  padding: 9px 11px 30px;
  cursor: pointer;
  background:
    repeating-linear-gradient(
      to bottom,
      transparent 0 21px,
      color-mix(in oklab, var(--cyan) 42%, transparent) 21px 22px
    ),
    var(--card);
  border: 2px solid var(--ink);
  box-shadow: 3px 3px 0 color-mix(in oklab, var(--ink) 55%, transparent);
  --lean: 0deg;
  transform: rotate(var(--lean));
  transition: transform 110ms ease, box-shadow 110ms ease;
}
.card::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: 26px;
  width: 2px;
  background: color-mix(in oklab, var(--accent) 55%, transparent);
}
.card:hover { transform: rotate(0deg) translate(-1px, -2px); box-shadow: 5px 6px 0 var(--ink); }
.card:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.card[aria-selected="true"] { box-shadow: 0 0 0 3px var(--accent), 3px 3px 0 var(--ink); }

.card .swatch {
  position: absolute;
  top: -2px;
  inset-inline-end: -2px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--ink);
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
.card .title {
  font-weight: 700;
  margin: 0 0 4px;
  padding-inline-start: 22px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card .body {
  flex: 1 1 auto;
  padding-inline-start: 22px;
  font-size: 12.5px;
  color: color-mix(in oklab, var(--ink) 82%, transparent);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  unicode-bidi: plaintext;
  white-space: pre-wrap;
}
.card .meta {
  position: absolute;
  inset-inline: 11px;
  bottom: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 10.5px;
  color: var(--dim);
}
.card .meta .chip {
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 2px;
  white-space: nowrap;
}
.card .meta .chip.ink { border-color: var(--accent); color: var(--accent); }

/* --------------------------------------------------------------- list view */

table.list { width: 100%; border-collapse: collapse; background: var(--card); border: 2px solid var(--ink); }
table.list th, table.list td { padding: 5px 9px; text-align: start; border-bottom: 1px solid var(--line); font-size: 12.5px; }
table.list th { position: sticky; top: 68px; background: var(--ink); color: var(--hi); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; }
table.list tbody tr { cursor: pointer; }
table.list tbody tr:hover { background: color-mix(in oklab, var(--hi) 30%, transparent); }
table.list tbody tr[aria-selected="true"] { background: var(--hi); }
table.list td.t { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.list td.dim { color: var(--dim); }

/* ------------------------------------------------------------------ dialog */

dialog {
  padding: 0;
  max-width: min(560px, 92vw);
  background: var(--card);
  color: var(--ink);
  border: 3px solid var(--ink);
  box-shadow: 7px 7px 0 var(--ink);
}
dialog::backdrop { background: color-mix(in oklab, var(--ink) 55%, transparent); }
dialog h3 { margin: 0; padding: 9px 14px; background: var(--ink); color: var(--hi); font-size: 13px; letter-spacing: .04em; }
dialog .content { padding: 14px; }
dialog .content p { margin: 0 0 10px; }
dialog .actions { display: flex; gap: 8px; justify-content: flex-end; padding: 0 14px 14px; }
dialog ul { margin: 0 0 10px; padding-inline-start: 18px; }
dialog .warn { color: var(--accent); }
dialog pre { max-height: 180px; overflow: auto; background: color-mix(in oklab, var(--ink) 8%, transparent); padding: 8px; font-size: 11.5px; }

/* ------------------------------------------------------------------ status */

.status {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 20;
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 6px 18px;
  background: var(--ink);
  color: var(--cyan);
  border-top: 3px solid var(--hi);
  font-size: 12px;
}
.status .sel { color: var(--hi); }

@media (prefers-reduced-motion: reduce) {
  .card, .btn { transition: none; }
}
`;
