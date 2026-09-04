/**
 * One palette for all three of the extension's own pages: the cabinet, the options page and
 * the popup.
 *
 * ## Why it is shared
 *
 * All three had the same `:root` line copied into them, and adding a dark theme to only one
 * would have been worse than not adding it at all -- the setting says "the cabinet, the popup
 * and this page", and a dark cabinet next to a blinding cream popup is a broken promise rather
 * than a partial feature. Three copies of a palette is three chances for them to drift.
 *
 * ## The two roles `--ink` used to play
 *
 * `--ink` was both the foreground on light paper AND the near-black surface of the chrome --
 * the header bars, the section headings, the status strip. That works for exactly one theme.
 * Flip `--ink` to a light colour for a dark theme and every one of those bars turns pale.
 *
 * So they are separate, and only the first of them flips:
 *
 *   --ink        foreground and keylines. FLIPS with the theme.
 *   --bar        the dark chrome surface. Dark in BOTH themes -- chrome that is already dark
 *                is right in a dark theme too.
 *   --bar-fg     text on the chrome.
 *   --on-hi      text on the acid yellow. NEVER flips: the yellow does not change, so what is
 *                written on it must not either.
 *   --on-manila  text on a folder tab: tan in light, deep ochre in dark.
 *   --shadow-c   the hard offset shadow. Dark in both -- a light shadow reads as a glow, which
 *                is the opposite of the printed look this is after.
 *   --scrim      the modal backdrop.
 *
 * Anything derived with `color-mix(... var(--ink) ...)` needs no dark counterpart: custom
 * properties resolve lazily where they are used, so redefining `--ink` moves them all.
 *
 * ## The three states
 *
 * The full light palette sits on a bare `:root`. The dark values appear twice: once under the
 * system preference, guarded so an explicit light choice still wins, and once under
 * `[data-theme="dark"]` so the toggle beats the system in both directions. `applyTheme` at the
 * foot of this file is what stamps the attribute.
 */

const DARK = `
  --ink: #ece4d3;
  --paper: #17150f;
  --card: #211e17;
  --dim: #9c9284;
  --accent: #ff4d78;
  --manila: #6b5426;
  --on-manila: #f7efdb;
  --drawer: #0d0b09;
  --bar: #0b0a08;
  --shadow-c: #000;
  --scrim: color-mix(in oklab, #000 74%, transparent);
  /* Light dots at low alpha straight over dark paper. No blend trickery: multiply would make
     them invisible against a dark ground. */
  --halftone: radial-gradient(color-mix(in oklab, var(--ink) 26%, transparent) .8px, transparent .9px);
  --halftone-blend: normal;
  --ok: #46d98a;
`;

export const THEME_CSS = /* css */ `
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

  --bar: #14110e;
  --bar-fg: var(--hi);
  --on-hi: #14110e;
  --on-manila: #14110e;
  --shadow-c: #14110e;
  --shadow: 5px 5px 0 var(--shadow-c);
  --scrim: color-mix(in oklab, #14110e 55%, transparent);
  --halftone: radial-gradient(var(--ink) .8px, transparent .9px);
  --halftone-blend: multiply;
  /* The one green in the palette, for a "yes" in the durability table. It has to change with
     the theme: #0d7a3d on a dark card is unreadable. */
  --ok: #0d7a3d;

  /* The pages are set in mono throughout, which is the dev-hub/zine register. The display face
     is the same stack at a heavier weight: no web font, so nothing is fetched and nothing can
     fail to load. */
  --mono: ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace;
  --display: ui-monospace, "Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace;

  /* Tells the browser which way its own scrollbars, carets and native controls should go. */
  color-scheme: light;
}

/* The system preference, unless an explicit light choice overrides it. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK}    color-scheme: dark;
  }
}

/* An explicit choice, which has to beat the media query in both directions. */
:root[data-theme="dark"] {${DARK}  color-scheme: dark;
}
`;

// ------------------------------------------------------- choosing between them

export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'dark', 'light'] as const;

/**
 * What the button says it is on.
 *
 * The glyph carries the state and the word repeats it, because an icon alone leaves people
 * guessing which of three states they are looking at -- and with `auto` there is genuinely no
 * icon that means "the same as your system".
 */
export const THEME_LABEL: Record<ThemeChoice, string> = {
  auto: '◐ Auto',
  dark: '● Dark',
  light: '○ Light',
};

export const THEME_TITLE: Record<ThemeChoice, string> = {
  auto: 'Colours follow your browser. Click for dark.',
  dark: 'Dark, whatever your browser says. Click for light.',
  light: 'Light, whatever your browser says. Click to follow your browser.',
};

/** Cycle auto -> dark -> light -> auto. Dark comes first because that is what people want. */
export function nextTheme(choice: ThemeChoice): ThemeChoice {
  const at = THEME_ORDER.indexOf(choice);
  return THEME_ORDER[(at + 1) % THEME_ORDER.length] as ThemeChoice;
}

/** Anything unrecognised in storage means `auto`, never a broken page. */
export function asThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** Stamp the choice on the document root. */
export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
): void {
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}
