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
those tokens builds DOM with `createElement`/`textContent` and never assigns `innerHTML`.

## Development-only

Not shipped, not in `dist/`: `esbuild`, `typescript`, `@biomejs/biome`, `vitest`,
`happy-dom`, `fake-indexeddb`, `web-ext`, `@types/*`.

## Fonts

The bundled type is not yet in the repository. When it lands, each face will be listed here
with its licence file alongside it in `assets/fonts/`; all of them will be
[SIL Open Font Licence](https://openfontlicense.org/) faces, and the licence text will ship in
the package as the OFL requires.

Until then the extension uses system font stacks, and the font picker offers `system` and
`system handwriting` only.

## Licence of this project

[MPL-2.0](LICENSE).
