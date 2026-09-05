import { t } from '~/shared/i18n.ts';

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
 * ## What 0.0.11 changed, and why the first dark theme was wrong
 *
 * The first attempt made the dark theme by flipping `--ink` and `--paper` and leaving the
 * chrome alone, on the reasoning that "chrome which is already dark is right in a dark theme
 * too". Reported, correctly, as: the theme changed and the menu was still black.
 *
 * It was worse than not changing it. `--drawer` was #0d0b09 and `--bar` #0b0a08 -- both DARKER
 * than the dark page itself, so the two biggest surfaces on the screen read as holes punched
 * in it, and switching the theme visibly did nothing to them. Two rules now, and they are the
 * whole design:
 *
 *   1. NOTHING is black, and the second attempt means it. The first graphite ramp started at #1c1a17,
 *      which is a colour by the numbers and still reads as black on a screen in a lit room --
 *      reported, twice, as "much too dark". The floor is now #2e2b28, about two and a half
 *      times as much light, which is the difference between a dark grey object and a hole.
 *      Every dark surface is warm graphite: a neutral grey with R > G > B by a few points, so
 *      it belongs to the same family as the manila and the cream.
 *
 *      Lifting the floor is not free, and the test enforces the part that pays for it: the
 *      keylines and the raised surfaces had to come up with it, or a lighter page just makes
 *      the panels on it disappear. `--edge` went #423c34 -> #55e4e44 for exactly
 *      that reason -- at the old value it fell below the 1.4:1 floor against the new page.
 *
 *   2. Surfaces RISE by getting lighter, in both themes. The page is the floor; a card sits on
 *      it; the chrome bar above that; the cabinet carcass, which floats with a shadow, is the
 *      top. In the light theme that ramp runs cream -> white for the paper surfaces and
 *      graphite -> lighter graphite for the chrome. In the dark theme it is one continuous
 *      graphite ramp, so the carcass is LIGHTER than the page and reads as an object on it.
 *
 * That is why the chrome tokens differ between the themes even though both are dark: what has
 * to hold is the relationship, not the hex.
 *
 * ## The cabinet carcass, which is the other half of the same report
 *
 * "The theme changed and the menu was still black" was true in the light theme too, and worse
 * there: the carcass was #2c2720, DARKER than the #322e28 it became in the dark theme. Put
 * that in words and it is plainly absurd -- the light theme's menu was darker than the dark
 * theme's menu -- and the two screenshots side by side were indistinguishable.
 *
 * So in the light theme the carcass is now kraft card (#d3b483) with ink on it. That is not a
 * retreat from the look; it is the look, arrived at properly. The thing being drawn is a card
 * index -- manila folders, ruled cards, a torn edge -- and a card-index box is made of board,
 * not of a black slab. The masthead is the one surface that stays dark in both themes, because
 * a masthead is a nameplate: it carries the wordmark, and a newspaper does not reprint its
 * nameplate in a different colour for the evening edition.
 *
 * `--sel` / `--on-sel` exist for the same reason. The selected drawer used to be the acid
 * yellow, which is right on graphite and nearly invisible on kraft -- 1.35:1. So selection is
 * "the ink-and-yellow pair, whichever of the two the ground is not": ink plate with yellow
 * lettering on kraft, yellow plate with ink lettering on graphite. Same two colours, same
 * gesture, legible on both.
 *
 * ## The roles a token can have, and which of them flip
 *
 *   --ink        foreground and text. FLIPS.
 *   --paper      the floor.                                    the surface ramp, lightest
 *   --card       a sheet on the floor.                         last, in both themes
 *   --bar        the chrome bar.
 *   --drawer     the cabinet carcass, which floats.
 *   --drawer-sunk  the recessed panel at the foot of the carcass.
 *   --edge       heavy keylines -- the 2px and 3px borders that draw this interface. In the
 *                light theme it is the ink itself; in the dark theme a graphite one step above
 *                the surfaces, because a 3px cream outline around every panel is a cage.
 *                THIS is the token to reach for a border, never `--ink`.
 *   --line       hairlines and rules. Derived from `--ink`.
 *   --rule-card  the ruling printed on an index card -- blue on white paper, and a warm grey on
 *                graphite, because a pale blue at any alpha over graphite is a steel wash.
 *   --rule-paper the fainter feint on the big settings sheet.
 *   --bar-fg     text on the chrome bar.
 *   --on-drawer  text on the carcass.
 *   --sel        the selected drawer's plate.
 *   --on-sel     its lettering.
 *   --on-hi      text on the yellow. Does not flip: dark text on a yellow, in both themes.
 *   --on-manila  text on a folder tab.
 *   --shadow-c   the hard offset shadow. Dark in both -- a light shadow reads as a glow, which
 *                is the opposite of the printed look this is after.
 *   --scrim      the modal backdrop.
 *
 * Anything derived with `color-mix(... var(--ink) ...)` needs no dark counterpart: custom
 * properties resolve lazily where they are used, so redefining `--ink` moves them all.
 *
 * ## The accents are toned for the dark theme, and that is not a compromise
 *
 * #ffe94a and #ff2e63 are chosen to sing off cream paper. At full chroma on graphite they
 * glare and bloom, which is what makes a dark interface tiring to sit in front of. The dark
 * theme drops both a step in lightness and chroma -- #edd45a and #f4718c -- which is still
 * unmistakably the same yellow and the same pink, and stops the page vibrating.
 *
 * `tests/theme.test.ts` asserts the contrast of every text-on-surface pair in BOTH themes, and
 * that each surface ramp is monotonic. It exists because the one bug in this area that got all
 * the way to a person was acid yellow on cream at about 1.3:1, and no test said a word.
 *
 * ## The three states
 *
 * The full light palette sits on a bare `:root`. The dark values appear twice: once under the
 * system preference, guarded so an explicit light choice still wins, and once under
 * `[data-theme="dark"]` so the toggle beats the system in both directions. `applyTheme` at the
 * foot of this file is what stamps the attribute.
 */

const DARK = `
  --ink: #ebe4d7;
  /* Lifted with the page. At #a49b8d this was 4.4956:1 on the new card colour -- four
     thousandths under AA, caught by the test, and the sort of thing an eye never finds. */
  --dim: #aaa193;
  --paper: #2e2b28;
  --card: #383430;
  --bar: #423d38;
  --drawer: #4b463f;
  --drawer-sunk: #3c3833;
  --edge: #554e44;
  --line: color-mix(in oklab, var(--ink) 22%, transparent);
  /* Faint and warm rather than faint and cyan: a pale-blue ruling reads as blue biro on white
     paper, and as a steel-blue wash on graphite. */
  --rule-card: color-mix(in oklab, var(--ink) 13%, transparent);
  /* 5%, not the light theme's 8%: adding cream to graphite is a far bigger relative step than
     adding ink to white, so the same number is a faint guide on paper and a visible stripe in
     the dark. Measured by looking at the settings sheet, where 8% cut across the text. */
  --rule-paper: color-mix(in oklab, var(--ink) 7%, transparent);
  --hi: #edd45a;
  --accent: #f4718c;
  --cyan: #8ad7e8;
  --ok: #5fc98d;
  --manila: #7d663a;
  --on-manila: #f5eddb;
  --on-drawer: #e9e2d5;
  --sel: #edd45a;
  --on-sel: #1c1a17;
  --shadow-c: #0f0e0c;
  --scrim: color-mix(in oklab, #0b0a09 70%, transparent);
  /* Light dots at low alpha straight over dark paper. No blend trickery: multiply would make
     them invisible against a dark ground. */
  --halftone: radial-gradient(color-mix(in oklab, var(--ink) 20%, transparent) .8px, transparent .9px);
  --halftone-blend: normal;
`;

export const THEME_CSS = /* css */ `
:root {
  --ink: #14110e;
  --dim: #6f665a;

  /* The surface ramp: cream floor, white sheets, graphite chrome, lighter carcass. */
  --paper: #f2ece0;
  --card: #fffdf6;
  --bar: #211d17;
  --drawer: #d3b483;
  --drawer-sunk: #c9a86f;

  --edge: var(--ink);
  --line: color-mix(in oklab, var(--ink) 18%, transparent);
  /* The ruling on an index card. Blue biro on white paper. */
  --rule-card: color-mix(in oklab, var(--cyan) 42%, transparent);
  /* The feint on the big settings sheet: pencil, not biro. */
  --rule-paper: color-mix(in oklab, var(--ink) 8%, transparent);

  --hi: #ffe94a;
  --accent: #ff2e63;
  --cyan: #7ef0ff;
  /* The one green in the palette, for a "yes" in the durability table. It has to change with
     the theme: #0d7a3d on a dark card is unreadable. */
  --ok: #0d7a3d;
  --manila: #e8c98a;

  --bar-fg: var(--hi);
  --on-hi: #14110e;
  --on-manila: #14110e;
  --on-drawer: #14110e;
  --sel: #14110e;
  --on-sel: #ffe94a;

  --shadow-c: #14110e;
  --shadow: 5px 5px 0 var(--shadow-c);
  --scrim: color-mix(in oklab, #14110e 55%, transparent);
  --halftone: radial-gradient(var(--ink) .8px, transparent .9px);
  --halftone-blend: multiply;

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
/* end of stylesheet */
`;

// ------------------------------------------------------------ reading it back

/**
 * The literal tokens of one theme, as written above.
 *
 * Parsing our own CSS rather than keeping a second copy in TypeScript, because two copies of a
 * palette is exactly the drift this file exists to stop. Only plain values come back usefully
 * -- a `color-mix(...)` is returned verbatim, and the caller is expected to skip anything that
 * is not a hex.
 */
export function tokensOf(theme: 'light' | 'dark'): Record<string, string> {
  const out: Record<string, string> = {};
  const source = theme === 'dark' ? lightBlock() + DARK : lightBlock();
  for (const match of source.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) out[name] = value.trim();
  }
  return out;
}

/** Just the declarations of the bare `:root` block, which is the whole light theme. */
function lightBlock(): string {
  const at = THEME_CSS.indexOf(':root {');
  const end = THEME_CSS.indexOf('\n}', at);
  return THEME_CSS.slice(at, end);
}

// ------------------------------------------------------- choosing between them

export type ThemeChoice = 'auto' | 'light' | 'dark';

export const THEME_ORDER: readonly ThemeChoice[] = ['auto', 'dark', 'light'] as const;

/**
 * What the button says it is on.
 *
 * Functions, not strings: a constant would be evaluated at module load, before the language is
 * known, and would then keep saying "Auto" in a Persian interface for the life of the page.
 *
 * The glyph carries the state and the word repeats it, because an icon alone leaves people
 * guessing which of three states they are looking at -- and with `auto` there is genuinely no
 * icon that means "the same as your system".
 */
export const THEME_LABEL: Record<ThemeChoice, () => string> = {
  auto: () => t('themeAuto'),
  dark: () => t('themeDark'),
  light: () => t('themeLight'),
};

export const THEME_TITLE: Record<ThemeChoice, () => string> = {
  auto: () => t('themeAutoTitle'),
  dark: () => t('themeDarkTitle'),
  light: () => t('themeLightTitle'),
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
