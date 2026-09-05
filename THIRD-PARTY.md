# Third-party code

Four runtime dependencies. All are bundled from `node_modules` at build time; none is fetched
at run time. Versions are pinned by `pnpm-lock.yaml`.

| Package | Licence | What it does here |
|---|---|---|
| [perfect-freehand](https://github.com/steveruizok/perfect-freehand) | MIT | Turns pressure-varying pen input into a stroke outline, which is what gives the drawing layer its thick-thin marker character. |
| [approx-string-match](https://github.com/robertknight/approx-string-match-js) | MIT | Bitap fuzzy matching, so a note stays attached when a page's wording changes slightly. |
| [fflate](https://github.com/101arrowz/fflate) | MIT | Reads and writes the ZIP backup archive. |
| [minisearch](https://github.com/lucaong/minisearch) | MIT | The search index in the manager page, built in memory when that page is opened. |

Markdown is **not** a dependency. `src/cs/note/md-lex.ts` is a small lexer written for this
project, covering the subset a note needs. It replaced [marked](https://github.com/markedjs/marked)
(MIT), which was 42 kB of a 107 kB content-script bundle -- forty per cent of what every
annotated page had to parse -- for a full CommonMark + GFM implementation whose tables,
footnotes, reference links and HTML blocks a sticky note never uses. The renderer that walks
those tokens builds DOM with `createElement`/`textContent` and never assigns `innerHTML`. It is
*read* once, in `src/bg/jobs/export-text.ts`, to serialise nodes the renderer has already
built into a standalone HTML file -- nothing is ever parsed from a string into DOM.

## Development-only

Not shipped, not in `dist/`: `esbuild`, `typescript`, `@biomejs/biome`, `vitest`,
`happy-dom`, `fake-indexeddb`, `web-ext`, `geckodriver`, `selenium-webdriver`, `@types/*`.

The `@fontsource/*` packages are development-only in the same sense -- no code from them ships
-- but twelve of their `.woff2` files do. See **Fonts** below.

## Fonts

Six faces are bundled, 263 kB in twelve `.woff2` files. They are **not** in this repository:
they are `devDependencies` from [Fontsource](https://fontsource.org/), and
`build.config.ts` copies the files it needs out of `node_modules` into
`dist/assets/fonts/` at build time. So `pnpm-lock.yaml` carries an integrity hash for every
byte, and anyone -- including an AMO reviewer -- can verify where they came from with
`pnpm install`. A committed binary can only be verified by trusting a sentence in a README.

| Face | Package | Licence | Files |
|---|---|---|---|
| Vazirmatn | `@fontsource/vazirmatn` | OFL-1.1 | arabic + latin, 400 and 700 |
| Estedad | `@fontsource/estedad` | OFL-1.1 | arabic + latin, 400 and 700 |
| Bangers ("Display") | `@fontsource/bangers` | OFL-1.1 | latin 400 |
| Caveat ("Handwriting") | `@fontsource/caveat` | OFL-1.1 | latin 400 |
| Archivo ("Grotesk") | `@fontsource/archivo` | OFL-1.1 | latin 400 |
| Permanent Marker | `@fontsource/permanent-marker` | Apache-2.0 | latin 400 |

The licence text ships beside the fonts as `assets/fonts/<face>-LICENSE.txt`, because the OFL
requires it to travel with the font -- clause 2 -- and Apache-2.0 says the same. The build
throws if one is missing rather than shipping the bytes without permission.

The two Persian faces get weight 700 as well as 400; the Latin display faces do not. Bold on
Arabic script cannot be synthesised without smearing the joins between letters, which is the
difference between bold text and damaged text. On a Latin display face, synthesised bold is
ordinary.

Each face is fetched only when a note actually uses it, and only once per page. Getting one
into a note is not the obvious `@font-face`, for two reasons that are measured rather than
assumed -- see `src/shared/fonts.ts` and `spikes/firefox-fonts.mjs`.

## Licence of this project

[MPL-2.0](LICENSE).
