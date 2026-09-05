/**
 * Which typefaces exist, and what each bundled file is called.
 *
 * ## Why this is in `shared/` and not next to the note styling
 *
 * Three layers need it and they are not allowed to depend on each other: the note renderer
 * builds the CSS stack, the background answers requests for the bytes, and `build.config.ts`
 * copies the files out of node_modules. It lived in `cs/note/theme.ts`, which meant the
 * background imported the note renderer's palette table and style resolver to do one
 * whitelist check.
 *
 * The size argument for moving it turned out to be small, and it is recorded here rather than
 * quietly dropped: a metafile says the move is worth about 0.4 kB gz in `bg/main.js`. The
 * background did grow a lot in 0.0.11 -- 13.6 to 20.3 kB gz -- but that is fflate, 9.0 kB
 * minified, pulled in by the scheduled backup, which genuinely has to build a ZIP in the
 * background because only the background has an alarm. So the reason this file exists is the
 * layering, not the bytes.
 *
 * ## How a bundled face reaches a note, and why it is done the hard way
 *
 * A `@font-face` rule inside a shadow root is IGNORED -- font faces are document-scoped, not
 * tree-scoped -- so a note cannot declare its own. And a `url(moz-extension://...)` in a
 * stylesheet is fetched with the PAGE's principal, so a site with `font-src 'self'` blocks it,
 * exactly as a site's CSP blocks a content script's `<img src>`.
 *
 * So the same answer as for pasted images: bytes, not URLs. The background reads the packaged
 * file, hands the bytes over, and the content script builds a `FontFace` from the ArrayBuffer
 * and adds it to the page's own `document.fonts`. No fetch happens, so there is nothing for a
 * CSP to forbid.
 *
 * All three parts of that are measured, not assumed -- `spikes/firefox-fonts.mjs`, in a real
 * Firefox, with a control:
 *
 *   - `document.fonts.add()` from a content script works, and a CLOSED shadow root uses the
 *     face it registers;
 *   - a page serving `Content-Security-Policy: font-src 'none'` does not affect it at all;
 *   - the arabic and latin subsets share no glyphs, so a Persian note that also contains
 *     Latin needs BOTH files. (The first run of that spike said they overlapped. The space
 *     character was doing it.)
 *
 * ## One naming rule, used twice
 *
 * `faceFile` below builds the filename, and both the build step that copies the files and the
 * loader that asks for them call it. A bundled face that the build names one thing and the
 * runtime asks for by another is a font that silently never loads -- and "silently never
 * loads" is indistinguishable from "the system happens not to have it", which is the exact
 * confusion this whole feature exists to end.
 */
export interface FontFile {
  /** Which script the file covers. Each becomes its own family, in stack order. */
  subset: 'arabic' | 'latin';
  weight: 400 | 700;
}

export interface FontChoice {
  id: string;
  label: string;
  /** CSS stack for a system face, and the tail of the stack for a bundled one. */
  stack: string;
  /** The npm package the build copies from, and the files taken out of it. */
  bundle?: { package: string; base: string; files: readonly FontFile[] };
  /** Scripts this face actually covers, so we can fall back sensibly for Persian. */
  scripts: ReadonlyArray<'latin' | 'arabic'>;
}

const SYSTEM_SANS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Vazirmatn", sans-serif';
const SYSTEM_HAND = '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive';

/** Latin only, one weight: bold is synthesised, which is normal for a display face. */
const LATIN_400: readonly FontFile[] = [{ subset: 'latin', weight: 400 }] as const;

/**
 * Both scripts, both weights.
 *
 * 700 is included for the Persian faces and not for the Latin ones, because synthesised bold
 * on Arabic script smears the joins between letters -- it is the difference between bold text
 * and damaged text. Two extra files, about 33 kB, for the one place it is visible.
 */
const PERSIAN: readonly FontFile[] = [
  { subset: 'arabic', weight: 400 },
  { subset: 'arabic', weight: 700 },
  { subset: 'latin', weight: 400 },
  { subset: 'latin', weight: 700 },
] as const;

export const FONTS: readonly FontChoice[] = [
  { id: 'system', label: 'System', stack: SYSTEM_SANS, scripts: ['latin', 'arabic'] },
  { id: 'system-hand', label: 'System handwriting', stack: SYSTEM_HAND, scripts: ['latin'] },
  {
    id: 'marker',
    label: 'Marker',
    stack: 'cursive',
    bundle: {
      package: '@fontsource/permanent-marker',
      base: 'permanent-marker',
      files: LATIN_400,
    },
    scripts: ['latin'],
  },
  {
    id: 'display',
    label: 'Display',
    stack: 'sans-serif',
    bundle: { package: '@fontsource/bangers', base: 'bangers', files: LATIN_400 },
    scripts: ['latin'],
  },
  {
    id: 'hand',
    label: 'Handwriting',
    stack: 'cursive',
    bundle: { package: '@fontsource/caveat', base: 'caveat', files: LATIN_400 },
    scripts: ['latin'],
  },
  {
    id: 'grotesk',
    label: 'Grotesk',
    stack: 'sans-serif',
    bundle: { package: '@fontsource/archivo', base: 'archivo', files: LATIN_400 },
    scripts: ['latin'],
  },
  {
    id: 'vazir',
    label: 'Vazirmatn',
    stack: SYSTEM_SANS,
    bundle: { package: '@fontsource/vazirmatn', base: 'vazirmatn', files: PERSIAN },
    scripts: ['arabic', 'latin'],
  },
  {
    id: 'estedad',
    label: 'Estedad',
    stack: SYSTEM_SANS,
    bundle: { package: '@fontsource/estedad', base: 'estedad', files: PERSIAN },
    scripts: ['arabic', 'latin'],
  },
] as const;

declare const __FONT_NS__: string;

/**
 * The filename of one file of one face, under `assets/fonts/`.
 *
 * Called by the build when it copies, and by the loader when it asks. One function, so the two
 * cannot disagree.
 */
export function faceFile(font: FontChoice, file: FontFile): string {
  return `${font.id}-${file.subset}-${file.weight}.woff2`;
}

/** The CSS family name a bundled subset is registered under. */
export function faceFamily(font: FontChoice, subset: FontFile['subset']): string {
  // Namespaced with a build-time hash, so a page that happens to define its own "Vazirmatn"
  // cannot be overridden by ours, and ours cannot be overridden by the page's.
  return `${__FONT_NS__}-${font.id}-${subset}`;
}

/**
 * The full CSS stack for a face: our families first, then the system fallback.
 *
 * Arabic before Latin, because the two subsets share no glyphs and a right-to-left note should
 * reach the Arabic file first. The system stack stays on the end so that text in a script
 * neither file covers -- Cyrillic, Greek, CJK -- still renders as something rather than tofu.
 */
export function fontStack(font: FontChoice): string {
  if (!font.bundle) return font.stack;
  const subsets = [...new Set(font.bundle.files.map((f) => f.subset))].sort((a, b) =>
    a === 'arabic' ? -1 : b === 'arabic' ? 1 : 0,
  );
  return [...subsets.map((sub) => `"${faceFamily(font, sub)}"`), font.stack].join(', ');
}

/**
 * `@font-face` rules for one of the extension's OWN pages.
 *
 * A plain URL, which a note cannot use and this can: the cabinet, the popup and the options
 * page are `moz-extension://` documents, so a relative `url()` is same-origin and the page's
 * own CSP allows it. None of the shadow-root or page-CSP trouble applies.
 *
 * It exists so the Type picker can show each face IN that face. A font menu written in one
 * font is a list of words, and the point of choosing type is to see it.
 *
 * `font-display: block` here, not `swap` as in a note: these are eight small labels on a
 * settings sheet, and text that reflows a moment after the sheet appears is more distracting
 * than eight labels arriving together a frame later.
 */
export function fontFaceCss(base = '../assets/fonts/'): string {
  const out: string[] = [];
  for (const font of FONTS) {
    for (const file of font.bundle?.files ?? []) {
      out.push(
        `@font-face{font-family:"${faceFamily(font, file.subset)}";` +
          `font-weight:${file.weight};font-style:normal;font-display:block;` +
          `src:url("${base}${faceFile(font, file)}") format("woff2")}`,
      );
    }
  }
  return out.join('\n');
}

export function fontById(id: string): FontChoice {
  return FONTS.find((f) => f.id === id) ?? (FONTS[0] as FontChoice);
}
