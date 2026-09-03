/**
 * The shadow-root stylesheet, shipped as a string so it goes straight into
 * `CSSStyleSheet.replaceSync()`. No <style> element, no separate file, no fetch -- and
 * therefore nothing for a page's `style-src` CSP to act on. Plan section 4.
 *
 * Colour is always a token, so re-theming a note is four custom-property writes and no
 * repaint of the art layers.
 */

export const SHEET_CSS = /* css */ `
:host {
  all: initial;
  display: block;
}

.lyr {
  position: absolute;
  inset: 0 auto auto 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.lyr-pin { position: fixed; }

/* ---------------------------------------------------------------- the note */

.note {
  --cn-paper: #ffe94a;
  --cn-ink: #14110e;
  --cn-accent: #ff2e63;
  --cn-font: system-ui, sans-serif;
  --cn-size: 15px;
  --cn-lh: 1.45;
  --cn-opacity: 1;
  --cn-grain: .16;
  --cn-edge: color-mix(in oklab, var(--cn-ink) 88%, var(--cn-paper));
  --cn-shade: color-mix(in oklab, var(--cn-paper) 80%, var(--cn-ink));

  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  contain: layout style;
  transform: translate3d(0, 0, 0);
  opacity: var(--cn-opacity);
  -webkit-user-select: none;
  user-select: none;
}

.note:focus { outline: none; }
.note:focus-visible .face { outline: 3px solid var(--cn-accent); outline-offset: 3px; }

/* The hard, unblurred offset shadow is the single most 90s thing in the whole design.
   It is the SAME torn path as the paper -- a rectangle behind a torn shape peeks out at
   every tear and reads instantly as a bug. */
.shadow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  opacity: .18;
  transform: translate3d(4px, 5px, 0);
  will-change: opacity;
  pointer-events: none;
}
.shadow path { fill: #000; }
.note[data-shadow="none"] .shadow { display: none; }
.note[data-shadow="soft"] .shadow { filter: blur(7px); opacity: .26; }

.tilt { perspective: 900px; }

.card { transform-style: preserve-3d; }

.face {
  position: relative;
  width: 240px;
  height: 170px;
  transform-origin: 50% 50%;
  backface-visibility: hidden;
  color: var(--cn-ink);
  font: var(--cn-size) / var(--cn-lh) var(--cn-font);
  display: grid;
  grid-template-rows: 30px 1fr;
  isolation: isolate;
}

/* ------------------------------------------------------------------- paper */

.paper {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -2;
  overflow: visible;
}
.paper-fill {
  fill: var(--cn-paper);
  stroke: var(--cn-edge);
  stroke-width: 2.5;
  stroke-linejoin: round;
}
/* Halftone: one shared <pattern> used directly as a fill. Static, so the browser caches the
   tile once for every note on the page. (A CSS mask was tried first and renders nothing on
   an SVG element: the mask shorthand resets mask-clip/mask-origin to box values that give
   an empty mask region.) */
.paper-halftone {
  fill: url(#cn-halftone-dark);
  mix-blend-mode: multiply;
  opacity: .16;
  pointer-events: none;
}
/* Multiplying black dots onto dark paper is invisible, so dark palettes get the inverse. */
.note[data-dark="1"] .paper-halftone {
  fill: url(#cn-halftone-light);
  mix-blend-mode: screen;
  opacity: .16;
}

.grain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  opacity: var(--cn-grain);
  mix-blend-mode: multiply;
  pointer-events: none;
}

/* The gloss. Not matte paper -- a laminated sheet that catches the light, so lifting a note
   sweeps a specular band across it. The wrapper clips and never moves; only the band inside
   is transformed, which keeps the whole effect on the compositor. */
.sheen {
  position: absolute;
  inset: 2px;
  z-index: 6;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  mix-blend-mode: screen;
  will-change: opacity;
}
.sheen-band {
  position: absolute;
  inset: -70% -90%;
  /* A narrow, near-white specular streak plus a second thinner one trailing it. Wide, soft
     gradients read as a wash; a real reflection has an edge. */
  background:
    linear-gradient(
      101deg,
      transparent 39%,
      rgba(255, 255, 255, .22) 44%,
      rgba(255, 255, 255, .95) 48.5%,
      rgba(255, 255, 255, 1) 50%,
      rgba(255, 255, 255, .95) 51.5%,
      rgba(255, 255, 255, .22) 56%,
      transparent 61%
    ),
    linear-gradient(
      101deg,
      transparent 63%,
      rgba(255, 255, 255, .45) 66.5%,
      rgba(255, 255, 255, .55) 68%,
      rgba(255, 255, 255, .12) 71%,
      transparent 75%
    ),
    /* A cool ambient tint over the whole sheet, the way coated stock picks up the room. */
    linear-gradient(160deg, rgba(190, 225, 255, .16), transparent 55%);
  will-change: transform;
}
/* A permanent hint of gloss along the top edge, so the sheet reads as coated even at rest. */
.gloss-rim {
  position: absolute;
  inset: 2px 2px auto 2px;
  height: 46%;
  z-index: 5;
  pointer-events: none;
  background:
    linear-gradient(to bottom, rgba(255, 255, 255, .42), rgba(255, 255, 255, .06) 45%, transparent 90%);
  mix-blend-mode: screen;
}

.tape-strip {
  fill: color-mix(in oklab, var(--cn-paper) 22%, #f7f4ea);
  opacity: .74;
  stroke: color-mix(in oklab, var(--cn-ink) 20%, transparent);
  stroke-width: .8;
}

.ink {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 4;
  pointer-events: none;
  overflow: visible;
}
.ink.is-drawing { pointer-events: auto; cursor: crosshair; }
.ink path { fill: var(--cn-ink); }
.note.is-inking .body { cursor: crosshair; }
.note.is-inking .face { outline: 2px dashed color-mix(in oklab, var(--cn-accent) 70%, transparent); outline-offset: 2px; }

.curl {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.curl-level {
  fill: var(--cn-shade);
  stroke: var(--cn-edge);
  stroke-width: 1.2;
  stroke-linejoin: round;
  will-change: opacity;
}

/* ------------------------------------------------------------------ header */

.handle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 6px 0 8px;
  cursor: grab;
  touch-action: none;
  border-bottom: 2px solid color-mix(in oklab, var(--cn-ink) 18%, transparent);
}
.note.is-dragging .handle { cursor: grabbing; }

.grip-dots {
  width: 34px;
  height: 9px;
  opacity: .5;
  background-image: radial-gradient(var(--cn-ink) 1px, transparent 1.2px);
  background-size: 5px 5px;
}

.actions { display: flex; gap: 1px; }
/* 26px targets. The first version used 18px glyphs at 55% opacity and the first person to
   try the build simply could not hit them -- notably, could not delete a note at all. */
.act {
  all: unset;
  box-sizing: border-box;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  color: var(--cn-ink);
  cursor: pointer;
  border-radius: 3px;
  opacity: .78;
}
.act svg { width: 15px; height: 15px; display: block; }
.act svg path { fill: currentColor; }
.act:hover { opacity: 1; background: color-mix(in oklab, var(--cn-ink) 16%, transparent); }
.act:focus-visible { outline: 2px solid var(--cn-accent); outline-offset: -2px; }
.act.is-on {
  opacity: 1;
  background: var(--cn-accent);
  color: var(--cn-paper);
}
.act-delete:hover { background: var(--cn-accent); color: var(--cn-paper); }
.note.is-locked .body { cursor: default; }

/* -------------------------------------------------------------------- body */

.body {
  padding: 7px 11px 12px;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-user-select: text;
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  /* unicode-bidi:plaintext makes each paragraph pick its own direction from its first
     strong character -- the correct behaviour for a note mixing Persian and English. */
  unicode-bidi: plaintext;
  scrollbar-width: thin;
}
.body:focus { outline: none; }
.body:empty::before {
  content: attr(data-placeholder);
  opacity: .38;
  pointer-events: none;
}
.note[data-align="center"] .body { text-align: center; }
.note[data-align="end"] .body { text-align: end; }

/* ------------------------------------------------------------------- grips */

.grips { position: absolute; inset: 0; pointer-events: none; }
.grip {
  position: absolute;
  pointer-events: auto;
  touch-action: none;
  opacity: 0;
  transition: opacity 120ms ease;
}
.note:hover .grip, .note:focus-within .grip { opacity: .5; }
.grip:hover { opacity: 1; }
.grip-se {
  right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
  background:
    linear-gradient(135deg, transparent 48%, var(--cn-ink) 48%, var(--cn-ink) 56%, transparent 56%),
    linear-gradient(135deg, transparent 68%, var(--cn-ink) 68%, var(--cn-ink) 76%, transparent 76%);
}
.grip-s { left: 16px; right: 16px; bottom: 0; height: 7px; cursor: ns-resize; }
.grip-e { top: 30px; bottom: 16px; right: 0; width: 7px; cursor: ew-resize; }

/* --------------------------------------------------------------- collapsed */

.note.is-collapsed .face {
  width: 34px;
  height: 34px;
  grid-template-rows: 1fr;
}
.note.is-collapsed .body,
.note.is-collapsed .actions,
.note.is-collapsed .grips,
.note.is-collapsed .curl { display: none; }

/* Resizing writes width/height, which is layout. Physics is pinned off while it happens. */
.note.is-resizing .card,
.note.is-resizing .face { transform: none; }

/* ------------------------------------------------------------------ global */

:host([data-ghost]) .note { pointer-events: none; opacity: .35; }

@media print { :host { display: none; } }

@media (prefers-reduced-motion: reduce) {
  .note, .note * {
    animation-duration: .001ms;
    transition-duration: .001ms;
  }
}

@media (forced-colors: active) {
  .face {
    forced-color-adjust: none;
    background: Canvas;
    color: CanvasText;
    border: 1px solid ButtonBorder;
  }
  .paper, .grain, .sheen, .curl, .shadow { display: none; }
}
`;
