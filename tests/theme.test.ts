/**
 * The palette, measured.
 *
 * ## Why this file exists
 *
 * Two colour bugs in this project reached a person, and neither could have been caught by any
 * other test in the suite:
 *
 *   - a ghost button was acid yellow on cream paper, about 1.3:1, so "Clear", "Restore" and
 *     "Move to trash" were legible only by knowing where they were;
 *   - the first dark theme made the two largest surfaces on the page -- the chrome bar and the
 *     cabinet carcass -- DARKER than the dark page, so switching the theme visibly did nothing
 *     to them and the interface read as holes punched in a sheet.
 *
 * Both were found by looking at a screenshot. A screenshot is the right instrument for
 * layout, and a terrible one for a regression: nobody re-checks eleven pairs by eye on every
 * change. So the pairs are written down here with the numbers they have to clear, in BOTH
 * themes, and a palette edit that breaks one fails the build instead of shipping.
 *
 * ## What the numbers are
 *
 * WCAG 2.1 relative-luminance contrast, the same ratio the accessibility tools report:
 *
 *   4.5   body text (AA)
 *   3.0   large or heavy text, and any glyph or icon that carries meaning (AA)
 *   1.4   a surface against the surface behind it -- not an accessibility figure at all, but
 *         the floor at which a keyline or a raised panel is perceptible rather than notional
 *
 * WCAG contrast is a blunt instrument for two colours of similar lightness, and APCA is the
 * better model. It is not used here because the point of the file is a floor that cannot be
 * argued with, and every reviewer, auditor and browser devtool speaks WCAG.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { THEME_CSS, tokensOf } from '../src/ui/chrome-theme.ts';

// --------------------------------------------------------------------- the maths

/** One channel of sRGB, linearised. */
function channel(eight: number): number {
  const c = eight / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.trim().replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Resolve a token to a hex, following one level of `var(--other)`. */
function hex(tokens: Record<string, string>, name: string): string {
  const raw = tokens[name];
  if (!raw) throw new Error(`--${name} is not in the palette`);
  const indirect = /^var\(--([a-z-]+)\)$/.exec(raw);
  const value = indirect?.[1] ? (tokens[indirect[1]] ?? '') : raw;
  if (!value.startsWith('#')) {
    throw new Error(`--${name} is ${raw}, which this test cannot resolve to a hex`);
  }
  return value;
}

// ------------------------------------------------------------------- the pairs

/** [foreground, background, floor, what it is] */
const PAIRS: readonly [string, string, number, string][] = [
  ['ink', 'paper', 4.5, 'body text on the page'],
  ['ink', 'card', 4.5, 'body text on a card'],
  ['dim', 'paper', 4.5, 'secondary text on the page'],
  ['dim', 'card', 4.5, 'secondary text on a card'],
  ['bar-fg', 'bar', 4.5, 'text on the chrome bar'],
  ['cyan', 'bar', 4.5, 'the version, and the saved-strip, on the chrome bar'],
  ['on-drawer', 'drawer', 4.5, 'a drawer label on the cabinet carcass'],
  ['on-drawer', 'drawer-sunk', 4.5, 'the settings row at the foot of the carcass'],
  ['on-hi', 'hi', 4.5, 'text on the yellow -- the selected drawer, the primary button'],
  ['on-manila', 'manila', 4.5, 'a section tab'],
  ['ok', 'card', 4.5, 'a "yes" in the durability table'],
  ['accent', 'paper', 3, 'the pink, as a keyline and a heading, on the page'],
  ['accent', 'card', 3, 'the pink on a card'],
  ['hi', 'bar', 3, 'the yellow as a mark on the chrome'],
  ['on-sel', 'sel', 4.5, 'the selected drawer -- ink on yellow, or yellow on ink'],
  ['sel', 'drawer', 1.4, 'the selected drawer against the carcass it sits in'],
  ['edge', 'paper', 1.4, 'a 2px keyline against the page'],
  ['edge', 'card', 1.4, 'a 2px keyline against a card'],
];

/** The surface ramp, floor first. Each step has to be lighter than the one before it. */
const RAMP = ['paper', 'card', 'bar', 'drawer'] as const;

describe.each(['light', 'dark'] as const)('the %s theme', (theme) => {
  const tokens = tokensOf(theme);

  it.each(PAIRS)('%s on %s clears %f:1 -- %s', (fg, bg, floor) => {
    const ratio = contrast(hex(tokens, fg), hex(tokens, bg));
    expect(ratio, `--${fg} on --${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(floor);
  });

  it('has no black, and no white, surface', () => {
    // "Do not use pure black, use graphite." Anything under 0.006 relative luminance is being
    // read as an absence of light rather than a colour; #0b0a08, the old chrome bar, is 0.002.
    // The top of the range is not symmetrical, and should not be: #fffdf6 is a warm white
    // sheet at 0.98, which is the paper this whole interface is imitating. What is banned at
    // that end is only the flat #fff of an unstyled page.
    for (const name of RAMP) {
      const value = hex(tokens, name).toLowerCase();
      expect(luminance(value), `--${name} is ${value}`).toBeGreaterThan(0.006);
      expect(['#fff', '#ffffff', '#000', '#000000']).not.toContain(value);
    }
  });

  it('warms every graphite surface, so it belongs to the same family as the manila', () => {
    for (const name of RAMP) {
      const value = hex(tokens, name).replace('#', '');
      const r = Number.parseInt(value.slice(0, 2), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      // Not a neutral grey and not a cool one: red leads blue, which is what makes it read as
      // graphite next to cream rather than as slate next to it.
      expect(r, `--${name} is #${value}`).toBeGreaterThan(b);
    }
  });
});

describe('the surface ramp rises', () => {
  // The bug this asserts against: --drawer #0d0b09 and --bar #0b0a08 sitting on --paper
  // #17150f, so the chrome was darker than the page and the theme switch did nothing visible
  // to the two biggest surfaces on the screen.
  it.each(['light', 'dark'] as const)('in the %s theme, from paper up to the carcass', (theme) => {
    const tokens = tokensOf(theme);
    const lit = RAMP.map((name) => ({ name, l: luminance(hex(tokens, name)) }));

    if (theme === 'light') {
      // The light theme inverts its chrome deliberately -- a graphite bar on cream paper is
      // the whole look -- so what has to hold there is only that the two chrome surfaces are
      // told apart, and that the carcass is the raised one.
      const bar = lit.find((s) => s.name === 'bar');
      const drawer = lit.find((s) => s.name === 'drawer');
      expect(drawer?.l).toBeGreaterThan(bar?.l ?? 1);
      expect(contrast(hex(tokens, 'drawer'), hex(tokens, 'bar'))).toBeGreaterThanOrEqual(1.1);
      return;
    }

    for (let i = 1; i < lit.length; i++) {
      const below = lit[i - 1];
      const above = lit[i];
      if (!below || !above) throw new Error('ramp is not the length it says it is');
      expect(
        above.l,
        `--${above.name} sits on --${below.name} and must be lighter`,
      ).toBeGreaterThan(below.l);
    }
    // Perceptible, not merely ordered.
    expect(contrast(hex(tokens, 'drawer'), hex(tokens, 'paper'))).toBeGreaterThanOrEqual(1.4);
  });
});

describe('the pre-paint snippet', () => {
  /**
   * Every page inlines a few lines of CSS in its `<head>` so a dark-theme user does not get a
   * flash of cream before the bundle runs. Those lines cannot use a custom property -- the
   * stylesheet that defines them has not loaded yet -- so they carry a literal hex, which is a
   * copy of `--paper` waiting to go stale. It went stale in exactly that way once.
   */
  it.each([
    'src/ui/manager/index.html',
    'src/ui/options/index.html',
    'src/ui/popup/index.html',
    'spikes/cabinet/index.html',
  ])('in %s matches the palette', (path) => {
    const html = readFileSync(path, 'utf8');
    for (const theme of ['light', 'dark'] as const) {
      const paper = hex(tokensOf(theme), 'paper');
      expect(html.toLowerCase(), `${path} should pre-paint ${theme} as ${paper}`).toContain(paper);
    }
  });
});

describe('the three states', () => {
  it('gives an explicit choice precedence over the system preference, in both directions', () => {
    // A dark theme written only under `@media (prefers-color-scheme: dark)` cannot be turned
    // off, and one written only under the attribute cannot follow the browser.
    expect(THEME_CSS).toContain('@media (prefers-color-scheme: dark)');
    expect(THEME_CSS).toContain(':root:not([data-theme="light"])');
    expect(THEME_CSS).toContain(':root[data-theme="dark"]');
  });

  it('sets color-scheme, so scrollbars and carets follow', () => {
    // Anchored to the start of a line, because `@media (prefers-color-scheme: dark)` contains
    // the same substring and an unanchored count reads 3 where the answer is 2. Found by
    // measuring rather than by staring at the regex.
    expect(THEME_CSS).toMatch(/^\s*color-scheme: light;/m);
    expect(THEME_CSS.match(/^\s*color-scheme: dark;/gm)?.length).toBe(2);
  });
});
