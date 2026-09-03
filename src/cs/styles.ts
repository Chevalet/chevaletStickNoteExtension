/**
 * The shadow-root stylesheet, shipped as a string so it goes straight into
 * `CSSStyleSheet.replaceSync()`. No <style> element, no separate file, no fetch -- and
 * therefore nothing for a page's `style-src` CSP to act on. Plan section 4.
 *
 * Colour is always a token so re-theming a note is four custom-property writes and no
 * repaint of the art layers.
 */

export const SHEET_CSS = /* css */ `
:host {
  all: initial;
  display: block;
}

.lyr {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.lyr-pin { position: fixed; }

/* Only a note is clickable. Everything else lets the page through. */
.note {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  contain: layout style;
  /* The position spring writes here and nowhere else. */
  transform: translate3d(0, 0, 0);
}

/* Ghost mode: hold the modifier to read the page underneath. */
:host([data-ghost]) .note {
  pointer-events: none;
  opacity: .35;
}

/* Notes never appear in print unless the user opts in. */
@media print {
  :host { display: none !important; }
}

/* Respect the OS setting; an in-extension override can force this class on instead. */
@media (prefers-reduced-motion: reduce) {
  .note, .note * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}

/* High-contrast mode: drop the paper art entirely and use system colours. */
@media (forced-colors: active) {
  .note { forced-color-adjust: none; background: Canvas; color: CanvasText; border: 1px solid ButtonBorder; }
}
`;
