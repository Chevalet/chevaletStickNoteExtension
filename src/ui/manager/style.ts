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

import { THEME_CSS } from '../chrome-theme.ts';

export const MANAGER_CSS = /* css */ `${THEME_CSS}
* { box-sizing: border-box; }
/* Any explicit display beats the hidden attribute, and almost every row in this file sets
   one. Without this, hiding a .srow (display:grid) left an empty dashed rule across the
   settings sheet -- an element that had been told twice to be invisible and was not. */
[hidden] { display: none !important; }

body {
  margin: 0;
  min-height: 100vh;
  background:
    var(--halftone) 0 0 / 5px 5px,
    var(--paper);
  background-blend-mode: var(--halftone-blend);
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
  background: var(--bar);
  color: var(--bar-fg);
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
  background: color-mix(in oklab, var(--bar-fg) 14%, transparent);
  color: var(--bar-fg);
  border: 2px solid color-mix(in oklab, var(--bar-fg) 45%, transparent);
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
  color: var(--on-hi);
  border: 2px solid var(--on-hi);
  box-shadow: 3px 3px 0 var(--accent);
  white-space: nowrap;
}
.btn:hover { transform: translate(1px, 1px); box-shadow: 2px 2px 0 var(--accent); }
.btn:active { transform: translate(3px, 3px); box-shadow: none; }
.btn:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
/*
 * A ghost button is transparent, so it has to take its colour from whatever it is sitting on.
 *
 * It used to be color: var(--hi) everywhere -- acid yellow -- which is right on the dark top
 * bar and close to invisible on the cream paper below it, where "Clear", "Restore" and "Move
 * to trash" live. Roughly 1.3:1 against the paper.
 *
 * The first attempt at fixing that flipped the default to --ink, which MOVED the bug rather
 * than fixing it: the Trash button lives at the foot of the cabinet, whose carcass is dark, so
 * dark-on-dark made that one invisible instead. Caught by looking at the page; no test would
 * have said a word about it.
 *
 * So the foreground is one token set by the CONTAINER -- paper by default, and the two dark
 * surfaces override it -- rather than a rule per button.
 */
.btn.ghost {
  --ghost-fg: var(--ink);
  background: transparent; color: var(--ghost-fg); box-shadow: none;
  border-color: color-mix(in oklab, var(--ghost-fg) 45%, transparent);
}
.btn.ghost:hover { background: color-mix(in oklab, var(--ghost-fg) 14%, transparent); }
/* A ghost button takes its colour from whatever it is sitting on, which is the whole reason
   --ghost-fg exists: the first attempt at fixing an unreadable ghost button set one global
   colour and moved the bug from the page to the chrome. The masthead writes in yellow; the
   carcass writes in whatever --on-drawer is, which is ink on board and cream on graphite. */
.top .btn.ghost { --ghost-fg: var(--bar-fg); }
.cabinet .btn.ghost { --ghost-fg: var(--on-drawer); }
.btn.danger { background: var(--accent); color: #fff; box-shadow: 3px 3px 0 var(--shadow-c); }
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
  border: 3px solid var(--edge);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.cabinet h2 {
  margin: 0;
  padding: 8px 12px;
  font: 700 10.5px/1.6 inherit;
  letter-spacing: .16em;
  text-transform: uppercase;
  /* A label plate stuck on the box, rather than coloured lettering. Cyan lettering was fine on
     the old near-black carcass and is unreadable on kraft board; a plate carries its own
     ground with it, so it needs no per-theme colour of its own. */
  background: var(--bar);
  color: var(--bar-fg);
  border-bottom: 2px solid color-mix(in oklab, var(--cyan) 30%, transparent);
}
.drawers {
  max-height: min(62vh, 560px);
  /* Vertically only. A long domain name ellipsises; nothing here should ever be reachable by
     scrolling sideways, and overflow:auto on both axes made the count plates unreachable
     rather than absent -- see the box-sizing note below. */
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
}

/* Each drawer front has a pull and a count plate, like a real card index. */
.drawer {
  all: unset;
  /* all:unset takes box-sizing back to content-box, so width:100% plus 22px of padding made
     every drawer 22px WIDER than the carcass that holds it. The visible result was a
     horizontal scrollbar across the menu and a note count clipped off the right-hand edge of
     every row -- the counts were being drawn, just past the end of the box. Every other
     all:unset in this file already restores it; this one did not.

     NO BACKTICKS IN THIS FILE. It is one CSS template literal, and a backtick in a comment
     ends the string; the error surfaces thirty lines later as a CSS parse failure. */
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px 8px 12px;
  cursor: pointer;
  color: var(--on-drawer);
  border-bottom: 1px solid color-mix(in oklab, var(--on-drawer) 14%, transparent);
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
  background: color-mix(in oklab, var(--on-drawer) 40%, transparent);
}
.drawer:hover { background: color-mix(in oklab, var(--on-drawer) 10%, transparent); }
.drawer[aria-current="true"] { background: var(--sel); color: var(--on-sel); }
.drawer[aria-current="true"]::before { background: var(--accent); }
.drawer .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer .count {
  font-size: 11px;
  padding: 0 5px;
  background: color-mix(in oklab, var(--on-drawer) 20%, transparent);
  border-radius: 2px;
}
.drawer[aria-current="true"] .count {
  background: color-mix(in oklab, var(--on-sel) 22%, transparent);
  color: var(--on-sel);
}

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
  color: var(--on-manila);
  border: 2px solid var(--edge);
  border-bottom: 0;
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 100%, 0 100%);
  font: 700 12px/1.5 inherit;
}
.folder > summary::-webkit-details-marker { display: none; }
.folder > summary:hover { background: color-mix(in oklab, var(--manila) 80%, var(--hi)); }
.folder > summary .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder > summary .n { opacity: .65; font-weight: 400; }
.folder[open] > summary { box-shadow: 0 2px 0 var(--ink); }
/* The tab's own text colour must not leak into the folder's contents. */
.folder > summary .n { color: inherit; }

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 14px;
  padding: 14px;
  border: 2px solid var(--edge);
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
      var(--rule-card) 21px 22px
    ),
    var(--card);
  border: 2px solid var(--edge);
  box-shadow: 3px 3px 0 color-mix(in oklab, var(--shadow-c) 55%, transparent);
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
.card:hover { transform: rotate(0deg) translate(-1px, -2px); box-shadow: 5px 6px 0 var(--shadow-c); }
.card:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.card[aria-selected="true"] { box-shadow: 0 0 0 3px var(--accent), 3px 3px 0 var(--shadow-c); }

.card .swatch {
  position: absolute;
  top: -2px;
  inset-inline-end: -2px;
  width: 20px;
  height: 20px;
  border: 2px solid var(--edge);
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

table.list { width: 100%; border-collapse: collapse; background: var(--card); border: 2px solid var(--edge); }
table.list th, table.list td { padding: 5px 9px; text-align: start; border-bottom: 1px solid var(--line); font-size: 12.5px; }
table.list th { position: sticky; top: 68px; background: var(--bar); color: var(--bar-fg); font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; }
table.list tbody tr { cursor: pointer; }
table.list tbody tr:hover { background: color-mix(in oklab, var(--hi) 30%, transparent); color: var(--on-hi); }
/* Yellow row, so the text on it has to be the on-yellow colour rather than the theme's. */
table.list tbody tr[aria-selected="true"] { background: var(--hi); color: var(--on-hi); }
table.list tbody tr[aria-selected="true"] td.dim { color: color-mix(in oklab, var(--on-hi) 70%, transparent); }
table.list td.t { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
table.list td.dim { color: var(--dim); }

/* ------------------------------------------------------------------ dialog */

dialog {
  padding: 0;
  max-width: min(560px, 92vw);
  background: var(--card);
  color: var(--ink);
  border: 3px solid var(--edge);
  box-shadow: 7px 7px 0 var(--shadow-c);
}
dialog::backdrop { background: var(--scrim); }

/* ------------------------------------------- choosing an export, and an import

   Three formats, and the difference between them is not visible from their names: one comes
   back and two do not. So each choice is a button with a sentence, and the sentence is the
   part that matters. */

.exp { display: grid; gap: 12px; }
.exp > p:first-child { margin: 0; font-weight: 600; }
.exp-scope { margin: 0; font-size: 12.5px; color: var(--dim); }
/* The rename box. Same idiom as the search field, on paper rather than on the chrome. */
.ren {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  padding: 7px 10px;
  background: var(--paper);
  color: var(--ink);
  border: 2px solid var(--edge);
  font: inherit;
}
.ren::placeholder { color: var(--dim); }
.ren:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
.exp-row {
  display: grid;
  grid-template-columns: 148px 1fr;
  gap: 12px;
  align-items: start;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.exp-row .btn { width: 100%; text-align: center; }
.exp-row p { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--dim); }

.imp-opt {
  display: flex;
  gap: 9px;
  align-items: start;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
  font-size: 12.5px;
  line-height: 1.5;
}
.imp-opt input { accent-color: var(--accent); width: 15px; height: 15px; margin-top: 2px; }

/* ----------------------------------------------------- one note's history */

.hist { display: grid; gap: 12px; max-height: 52vh; overflow-y: auto; }
.hist-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 6px 12px;
  align-items: start;
  padding-top: 12px;
  border-top: 1px dashed var(--line);
}
.sbtn-row { display: flex; gap: 8px; justify-content: flex-end; }

.hist-when { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; }
.hist-when span { color: var(--dim); font-size: 11.5px; }
.hist-text {
  grid-column: 1 / -1;
  margin: 0;
  max-height: 8.4em;
  overflow: hidden;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  background: var(--paper);
  border: 2px solid var(--edge);
}
.imp-opt input:disabled + span { color: var(--dim); }

@media (max-width: 520px) {
  .exp-row { grid-template-columns: 1fr; }
}
dialog h3 { margin: 0; padding: 9px 14px; background: var(--bar); color: var(--bar-fg); font-size: 13px; letter-spacing: .04em; }
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
  background: var(--bar);
  color: var(--cyan);
  border-top: 3px solid var(--hi);
  font-size: 12px;
}
.status .sel { color: var(--hi); }

@media (prefers-reduced-motion: reduce) {
  .card, .btn { transition: none; }
}

/* ------------------------------------------------------- the cabinet's foot
   Two groups, with air between them. The drawers and the trash are about WHERE
   NOTES ARE and belong together; Settings and the theme are about the app, so
   they sit at the bottom behind a rule, where a settings button belongs. */

.cab-files { padding: 10px; }

.cab-foot {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: stretch;
  padding: 10px;
  /* The air, and the rule that earns it. */
  margin-top: 6px;
  border-top: 2px solid color-mix(in oklab, var(--on-drawer) 26%, transparent);
  background: var(--drawer-sunk);
}

.drawer.is-settings {
  padding: 9px 11px;
  border-bottom: 0;
  /* An embossed panel in the board, not a highlighter stripe. A 74% mix with the pink read as
     salmon on kraft and as mud on graphite -- one mix cannot be an accent on two grounds this
     far apart, so the panel is made of the carcass and the pink moves to the pull. */
  background: color-mix(in oklab, var(--drawer) 88%, var(--on-drawer));
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  font-size: 11.5px;
}
.drawer.is-settings::before { background: var(--accent); }
.drawer.is-settings[aria-current="true"] { background: var(--accent); color: #fff; }
.drawer.is-settings[aria-current="true"]::before { background: #fff; }

/* The theme control. Sized to the same rhythm as the settings button beside it, and
   deliberately quiet: it is a preference, not an action. */
.cab-theme {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--on-drawer);
  background: color-mix(in oklab, var(--on-drawer) 10%, transparent);
  border: 2px solid color-mix(in oklab, var(--on-drawer) 26%, transparent);
  font: 700 11.5px/1 var(--mono);
  letter-spacing: .04em;
  text-transform: uppercase;
}
.cab-theme:hover {
  background: color-mix(in oklab, var(--on-drawer) 20%, transparent);
  border-color: color-mix(in oklab, var(--on-drawer) 50%, transparent);
}
.cab-theme:focus-visible { outline: 3px solid var(--hi); outline-offset: 2px; }

@media (max-width: 820px) {
  /* Stacked, the two stop competing for a narrow row. */
  .cab-foot { grid-template-columns: 1fr; }
}

/* ------------------------------------------------------------- settings pane
   The cabinet's own idiom rather than a form: manila tabs down the side, ruled
   index-card paper for the content, one hard offset shadow, the accent spent
   once per row. No native control survives contact with this palette, so none
   of them is used. */

.settings { display: grid; grid-template-columns: 132px 1fr; gap: 0; align-items: start; }

.stabs { display: flex; flex-direction: column; gap: 6px; padding-top: 18px; }
.stab {
  font: 600 12.5px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase;
  text-align: left; padding: 10px 10px 10px 12px; cursor: pointer; color: var(--on-manila);
  background: var(--manila); border: 2px solid var(--edge); border-right: 0;
  /* A folder tab: cut on the leading edge, so the stack reads as a stack. */
  clip-path: polygon(0 0, 100% 0, 100% 100%, 8px 100%, 0 calc(100% - 8px));
  margin-right: -2px; box-shadow: inset -6px 0 0 rgba(20,17,14,.14);
}
.stab:hover { background: color-mix(in oklab, var(--manila) 84%, var(--hi)); }
.stab[aria-selected="true"] {
  /* The selected tab is card paper, not manila, so it takes the paper's foreground back. */
  background: var(--card); color: var(--ink); box-shadow: none; z-index: 2; position: relative;
  padding-left: 16px;
}
.stab:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }

.scard {
  background: var(--card); border: 2px solid var(--edge); box-shadow: var(--shadow);
  padding: 18px 20px 22px; min-height: 300px;
  /* Ruled paper, the same rule the index cards use. */
  background-image: repeating-linear-gradient(
    to bottom, transparent 0 27px, var(--rule-paper) 27px 28px);
}
.ssec-title {
  margin: 0 0 4px; font: 800 21px/1.15 var(--display); letter-spacing: -.02em;
}
.ssec-title::after {
  content: ''; display: block; width: 58px; height: 5px; margin-top: 7px;
  background: var(--accent);
}
.ssec-sub {
  margin: 22px 0 8px; font: 700 11.5px/1 var(--mono); letter-spacing: .12em;
  text-transform: uppercase; color: var(--dim);
}
.ssec-note.warn { color: var(--accent); font-weight: 600; }
.ssec-note, .ssec-empty {
  margin: 12px 0 0; font-size: 13px; line-height: 1.55; color: var(--dim); max-width: 62ch;
}
.ssec-body { display: flex; flex-direction: column; }

.srow {
  /* Both tracks are minmax(0, ...) so a wide control cannot squeeze the label out of its own
     column -- the segmented strip for Type has eight options and did exactly that. */
  display: grid; grid-template-columns: minmax(11ch, 1fr) minmax(0, 22rem);
  gap: 14px 18px; align-items: start;
  padding: 14px 0; border-bottom: 1px dashed var(--line);
}
.srow:last-child { border-bottom: 0; }
.srow-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.srow-label { font-weight: 600; font-size: 14px; }
.srow-note { font-size: 12.5px; line-height: 1.5; color: var(--dim); max-width: 60ch; }
.srow-ctl { display: flex; justify-content: flex-end; }

/* A paper tab that slides. */
.sw {
  width: 54px; height: 28px; padding: 0; cursor: pointer; position: relative;
  background: var(--paper); border: 2px solid var(--edge); box-shadow: 3px 3px 0 var(--shadow-c);
}
.sw-knob {
  position: absolute; inset: 3px auto 3px 3px; width: 20px;
  background: var(--card); border: 2px solid var(--edge);
  transition: transform .13s cubic-bezier(.2,.9,.2,1);
}
.sw[aria-checked="true"] { background: var(--hi); }
.sw[aria-checked="true"] .sw-knob { transform: translateX(24px); background: var(--accent); }
.sw:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .sw-knob { transition: none; } }

/* Segmented choice, as a strip of little tabs. */
.seg { display: flex; flex-wrap: wrap; gap: 0; justify-content: flex-end; }
.seg button {
  font: 600 12px/1 var(--mono); padding: 7px 11px; cursor: pointer; color: var(--ink);
  background: var(--paper); border: 2px solid var(--edge); margin-left: -2px;
}
.seg button:first-child { margin-left: 0; }
.seg button:hover { background: color-mix(in oklab, var(--paper) 80%, var(--hi)); }
.seg button[aria-checked="true"] {
  background: var(--bar); color: var(--bar-fg); position: relative; z-index: 1;
}
.seg button:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; z-index: 2; }

/* A slider, drawn rather than borrowed. A native range input is the one control that looks
   wrong in every palette, so the track and the thumb are both ours: a ruled channel with a
   hard-edged block on it, and a readout that always says what the value actually is. */
.rngwrap { display: flex; align-items: center; gap: 10px; width: 100%; justify-content: flex-end; }
.rng {
  -webkit-appearance: none;
  appearance: none;
  flex: 1 1 auto;
  min-width: 90px;
  max-width: 210px;
  height: 26px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.rng::-moz-range-track {
  height: 8px;
  background: var(--paper);
  border: 2px solid var(--edge);
}
.rng::-moz-range-progress {
  height: 8px;
  background: var(--hi);
  border: 2px solid var(--edge);
  border-right: 0;
}
.rng::-moz-range-thumb {
  width: 14px;
  height: 22px;
  border-radius: 0;
  background: var(--accent);
  border: 2px solid var(--edge);
}
.rng::-webkit-slider-runnable-track {
  height: 8px;
  background: var(--paper);
  border: 2px solid var(--edge);
}
.rng::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 22px;
  margin-top: -9px;
  border-radius: 0;
  background: var(--accent);
  border: 2px solid var(--edge);
}
.rng:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.rngout {
  font: 700 12px/1 var(--mono);
  min-width: 6.5ch;
  padding: 6px 7px;
  text-align: center;
  color: var(--ink);
  background: var(--card);
  border: 2px solid var(--edge);
  white-space: nowrap;
}

/* The button that leads out to Firefox's own shortcut page. */
.keyact { margin: 16px 0 4px; }

.numwrap { display: flex; align-items: center; gap: 7px; }
.num {
  font: 600 14px/1 var(--mono); width: 74px; padding: 7px 8px; color: var(--ink);
  background: var(--card); border: 2px solid var(--edge); box-shadow: 3px 3px 0 var(--shadow-c);
}
.num:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
/* A native number input takes its spinner and caret from the OS palette, which is wrong on a
   dark card unless the element is told which scheme it is in. */
.num { color-scheme: light dark; }
.unit { font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }

/* Palette swatches: the paper, with its accent showing as a marker stroke. */
/* Four across, so eight palettes make two even rows instead of seven and an orphan. */
.swatches { display: grid; grid-template-columns: repeat(4, 34px); gap: 7px; justify-content: end; }
.swatch {
  width: 34px; height: 34px; cursor: pointer; position: relative; padding: 0;
  background: var(--sw-paper); border: 2px solid var(--edge);
}
.swatch::after {
  content: ''; position: absolute; left: 5px; right: 5px; top: 12px; height: 5px;
  background: var(--sw-accent);
}
.swatch[aria-checked="true"] { box-shadow: 0 0 0 2px var(--card), 0 0 0 5px var(--accent); }
.swatch:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }

/* Per-site rules. */
.rules { display: flex; flex-direction: column; gap: 0; }
.rule {
  display: grid; grid-template-columns: 12px 1fr auto auto; gap: 10px; align-items: center;
  padding: 9px 0; border-bottom: 1px dashed var(--line); font-size: 13px;
}
.rule-dot { width: 10px; height: 10px; border: 2px solid var(--edge); }
.rule-dot.is-on { background: var(--hi); }
.rule-dot.is-off { background: var(--card); }
.rule-origin { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
.rule-state { font: 600 11px/1 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }
.rule-drop {
  font: 600 11px/1 var(--mono); letter-spacing: .06em; text-transform: uppercase; cursor: pointer;
  padding: 5px 8px; color: var(--ink); background: var(--card); border: 2px solid var(--edge);
}
.rule-drop:hover { background: var(--accent); color: var(--card); }

/* Keyboard reference. */
.keys { display: flex; flex-direction: column; }
.keyrow {
  /* The column is fixed so that every description in the reference starts at the same x --
     each row is its own grid, so max-content would size each one to its own chord and the
     descriptions would stagger. 148px clears the longest chord, Ctrl+Shift+Enter, without
     wrapping it -- measured at 156px on screen, so 160 leaves a hair; at 122px it wrapped and
     the cells stopped looking like keys.

     The KEY, though, is content-sized inside that column. Stretching it was the default, and
     it turned the letter S into a 176px yellow slab: a key cap should be the size of a key. */
  display: grid; grid-template-columns: 160px 1fr; gap: 12px; align-items: baseline;
  padding: 6px 0; font-size: 13px;
}
.keyrow kbd {
  justify-self: start;
  min-width: 2.4em;
  font: 700 11.5px/1 var(--mono); padding: 5px 8px; text-align: center; color: var(--on-hi);
  background: var(--hi); border: 2px solid var(--on-hi); box-shadow: 2px 2px 0 var(--shadow-c);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .settings { grid-template-columns: 1fr; }
  .stabs { flex-direction: row; flex-wrap: wrap; padding: 0 0 10px; }
  .stab { border-right: 2px solid var(--edge); margin-right: 0; clip-path: none; }
  .srow { grid-template-columns: 1fr; }
  .keyrow { grid-template-columns: 1fr; gap: 4px; }
  .keyrow kbd { justify-self: start; }
  .srow-ctl { justify-content: flex-start; }
  .swatches { justify-content: flex-start; }
}
`;
