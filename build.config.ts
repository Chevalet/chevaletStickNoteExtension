/**
 * Shared build configuration.
 *
 * Split out of build.ts so the dev server (tools/dev.ts) rebuilds with exactly the same
 * options as a release build -- if the two could drift, the thing served on the dev port
 * would not be the thing that ships, which defeats the point of having a dev port at all.
 *
 * Everything here is deterministic: no timestamps, no randomness, no network. Even the
 * randomised shadow-host tag is derived from name@version by SHA-256, so an AMO reviewer
 * reproduces `dist/` byte-for-byte.
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as esbuild from 'esbuild';
// The single source of truth for which faces exist and what each file is called.
import { faceFile, FONTS } from './src/shared/fonts.ts';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const SRC = join(ROOT, 'src');
export const OUT = join(ROOT, 'dist');

export const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

/** Deterministic per-release tag for the shadow host element. See plan section 4. */
export const HOST_TAG = `chevalet-note-root-${createHash('sha256')
  .update(`${pkg.name}@${pkg.version}`)
  .digest('hex')
  .slice(0, 8)}`;

/** Deterministic prefix for FontFace family names, so we never collide with a page's fonts. */
export const FONT_NS = `cn${createHash('sha256')
  .update(`fonts@${pkg.version}`)
  .digest('hex')
  .slice(0, 6)}`;

export interface Target {
  in: string;
  out: string;
  format: esbuild.Format;
}

/**
 * Content scripts are NOT ES modules in Firefox -- they must be IIFE.
 * The background event page is `"type": "module"`, so it gets ESM.
 */
export const TARGETS: readonly Target[] = [
  { in: 'bg/main.ts', out: 'bg/main', format: 'esm' },
  { in: 'cs/guard.ts', out: 'cs/guard', format: 'iife' },
  { in: 'cs/renderer.ts', out: 'cs/renderer', format: 'iife' },
  { in: 'ui/popup/index.ts', out: 'ui/popup', format: 'iife' },
  { in: 'ui/options/index.ts', out: 'ui/options', format: 'iife' },
  { in: 'ui/manager/index.ts', out: 'ui/manager', format: 'iife' },
];

/**
 * Dev-only pages that mount the REAL modules outside the extension, so the look and the
 * behaviour can be exercised in an ordinary browser tab. Never shipped: emitted next to
 * their own HTML under spikes/, not into dist/.
 */
export const HARNESSES: readonly Target[] = [
  { in: '../spikes/paper/main.ts', out: '../spikes/paper/bundle', format: 'iife' },
  { in: '../spikes/playground/main.ts', out: '../spikes/playground/bundle', format: 'iife' },
  // The cabinet, in an ordinary page. Seeds the real store, then loads the real manager
  // bundle -- see spikes/cabinet/index.html for why the manager cannot just be opened.
  { in: '../spikes/cabinet/seed.ts', out: '../spikes/cabinet/seed', format: 'iife' },
];

export function sharedOptions(dev: boolean): esbuild.BuildOptions {
  return {
    bundle: true,
    target: ['firefox128'],
    platform: 'browser',
    charset: 'utf8',
    legalComments: 'none',
    treeShaking: true,
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    logLevel: 'silent',
    alias: { '~': SRC },
    define: {
      __DEV__: String(dev),
      __VERSION__: JSON.stringify(pkg.version),
      __HOST_TAG__: JSON.stringify(HOST_TAG),
      __FONT_NS__: JSON.stringify(FONT_NS),
    },
  };
}

export async function writeManifest(): Promise<void> {
  // Cache-busted so a watch rebuild picks up manifest.ts edits without restarting the process.
  const { manifest } = await import(`./src/manifest.ts?v=${Date.now()}`);
  await writeFile(
    join(OUT, 'manifest.json'),
    `${JSON.stringify(manifest({ version: pkg.version }), null, 2)}\n`,
    'utf8',
  );
}

/**
 * Write _locales from the single catalogue in src/shared/i18n.ts.
 *
 * Keeping the strings in TypeScript and generating the JSON means a string cannot exist in
 * the code while being missing from a shipped locale -- which is the usual way an extension
 * ends up showing a raw message key to a reviewer.
 */
export async function writeLocales(): Promise<void> {
  const { CATALOGUE, toMessagesJson } = await import(`./src/shared/i18n.ts?v=${Date.now()}`);
  for (const lang of ['en', 'fa'] as const) {
    const dir = join(OUT, '_locales', lang);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'messages.json'),
      `${JSON.stringify(toMessagesJson(lang), null, 2)}\n`,
      'utf8',
    );
    // Also update the checked-in copies, so the repo shows what ships.
    const repoDir = join(ROOT, '_locales', lang);
    await mkdir(repoDir, { recursive: true });
    await writeFile(
      join(repoDir, 'messages.json'),
      `${JSON.stringify(toMessagesJson(lang), null, 2)}\n`,
      'utf8',
    );
  }
  return void CATALOGUE;
}

export async function copyStatic(): Promise<void> {
  for (const dir of ['assets']) {
    await cp(join(ROOT, dir), join(OUT, dir), { recursive: true, force: true }).catch(() => {});
  }
  // HTML shells live next to their entry point in src/ui/<name>/index.html
  for (const name of ['popup', 'options', 'manager']) {
    await cp(join(SRC, 'ui', name, 'index.html'), join(OUT, 'ui', `${name}.html`), {
      force: true,
    }).catch(() => {});
  }
  await copyFonts();
}

/**
 * Bring the bundled typefaces out of node_modules and into `dist/assets/fonts/`.
 *
 * ## Why they are not committed to the repository
 *
 * They are `devDependencies` -- @fontsource packages, published by the Fontsource project,
 * every one OFL-1.1 or Apache-2.0 -- so `pnpm-lock.yaml` carries an integrity hash for each,
 * and a reviewer can verify where every byte came from with `pnpm install`. A committed binary
 * blob can only be verified by trusting a sentence in a README. THIRD-PARTY.md names them.
 *
 * ## Why this throws
 *
 * Every other line in `copyStatic` swallows its error, and that is right for them: a missing
 * icon is a cosmetic problem visible immediately. A missing font file is not visible at all --
 * the note renders in the system stack, which is exactly what it did before the feature
 * existed, so a silently broken build looks like a working one. The whole reason this feature
 * is being built is that "Vazirmatn" in the menu did nothing and nobody could tell.
 *
 * The names come from `faceFile` in `src/cs/note/theme.ts`, which is also what the runtime
 * asks for. One naming rule, called from both ends, so they cannot drift apart.
 */
async function copyFonts(): Promise<void> {
  const dir = join(OUT, 'assets', 'fonts');
  await mkdir(dir, { recursive: true });

  let bytes = 0;
  let files = 0;
  for (const font of FONTS) {
    if (!font.bundle) continue;
    for (const file of font.bundle.files) {
      const from = join(
        ROOT,
        'node_modules',
        font.bundle.package,
        'files',
        `${font.bundle.base}-${file.subset}-${file.weight}-normal.woff2`,
      );
      const to = join(dir, faceFile(font, file));
      try {
        await cp(from, to, { force: true });
        bytes += (await stat(to)).size;
        files++;
      } catch (e) {
        throw new Error(
          `font missing: ${from}\n` +
            `  ${font.label} is offered in the Type menu, so it has to be in the package.\n` +
            `  Run pnpm install, or take the face out of FONTS in src/cs/note/theme.ts.\n` +
            `  ${String(e)}`,
        );
      }
    }
  }
  await copyFontLicences();
  process.stdout.write(`  fonts:    ${files} files, ${(bytes / 1024).toFixed(0)}kB\n`);
}

/**
 * Ship the licence next to the bytes, because the licence says to.
 *
 * The SIL Open Font Licence requires the licence text to travel with the font -- clause 2:
 * "Copies of the Font Software may be sold or distributed... provided that each copy contains
 * the above copyright notice and this licence". Apache-2.0 says the same for Permanent Marker.
 * A build that copies the woff2 and leaves the LICENSE behind is not a build with a licensing
 * footnote to tidy up later; it is redistribution without permission.
 *
 * One file per face, named after the face, because six files called LICENSE cannot coexist and
 * a reviewer should be able to tell which text covers which font without opening any of them.
 */
async function copyFontLicences(): Promise<void> {
  for (const font of FONTS) {
    if (!font.bundle) continue;
    const from = join(ROOT, 'node_modules', font.bundle.package, 'LICENSE');
    const to = join(OUT, 'assets', 'fonts', `${font.id}-LICENSE.txt`);
    try {
      await cp(from, to, { force: true });
    } catch (e) {
      throw new Error(
        `licence missing for ${font.label}: ${from}\n` +
          '  The OFL requires the licence to be distributed with the font. Shipping the ' +
          'woff2 without it is not allowed.\n' +
          `  ${String(e)}`,
      );
    }
  }
}

/**
 * Gzipped budgets. Exceeding one fails a production build.
 *
 * A budget is only worth having if raising it costs an argument, so here is the argument for
 * the current numbers.
 *
 * `cs/guard.js` — 1 kB. This runs at `document_start` on every granted origin, ahead of the
 * page's own scripts, and exists solely to hold a `beforeunload` listener. It has to stay
 * small enough that its cost is not measurable. Currently 0.3 kB.
 *
 * `cs/renderer.js` — 36 kB, raised five times, each with the measurement in hand.
 *
 * 24 -> 28 kB when anchoring moved onto this path (~3 kB gz for `anchor/` plus 1.7 kB
 * minified of `approx-string-match`). 28 -> 30 kB for undo/redo: `history.ts` is 3.1 kB
 * minified and the recorders took NoteView from 19.9 to 24.2 kB. 30 -> 32 kB for pasted
 * images, which have to decode bytes into a canvas on the page side, because a content
 * script's `<img src>` answers to the *page's* CSP and would silently fail on a strict site.
 *
 * 32 -> 34 kB in 0.0.10, for the keyboard: the formatting shortcuts, layout-independent key
 * matching, and a selection module that works in a browser with no `ShadowRoot.getSelection`.
 * Measured with a metafile rather than estimated:
 *
 *     src/cs/note/format.ts       3.30 kB minified   Ctrl+B and the rest, as text operations
 *     src/cs/note/selection.ts    1.26 kB            reading and writing the caret
 *     src/cs/note/keys.ts         0.54 kB            which key was pressed, on any layout
 *                                 -------
 *                                 5.10 kB minified, ~1.8 kB gz
 *
 * That lands the bundle at 31.9 kB gz against the old 32 kB ceiling — a hundred bytes of
 * headroom, which is no headroom at all.
 *
 * The question this number exists to force is "is the new code needed on a page that has no
 * notes yet?" For `keys.ts` and `selection.ts` the answer is yes: recording has to be live
 * from the first keystroke, and the caret is part of every recorded edit. For `format.ts` the
 * honest answer is no — nothing needs it until someone is typing in a note — but it cannot be
 * split off, for exactly the reason undo could not be: lazy-loading means a dynamic import of
 * an extension URL, which needs `web_accessible_resources`, and that lets any page on the web
 * detect the extension. Trading a fingerprinting surface for 3 kB is not a trade worth making.
 *
 * `selection.ts` is not purely additive, incidentally: `history.ts` re-exports its two tree
 * walks instead of carrying its own copies, so the net cost is a little under the 5.10 kB.
 *
 * 34 -> 36 kB in 0.0.11, for two things a person reported and one they asked for. Measured,
 * again with a metafile, against the same question -- is this needed on a page with no notes?
 *
 *     src/cs/renderer.ts        7.01 kB minified, up 0.71 kB.  `recheckScope`: when a
 *                               single-page app changes route, work out which notes belong on
 *                               the new URL. Needed the moment a note exists, and the note may
 *                               be made a second after the page loads -- so no, it cannot wait.
 *     src/cs/note/NoteView.ts   26.77 kB, up 0.62 kB.  A note's name: the field, the header
 *                               line, the accessible label, and the two callbacks.
 *     src/cs/styles.ts          18.73 kB, up 2.05 kB.  The name's row in the grid, the name
 *                               box in the settings panel, and the three-row face.
 *
 * Total 101.5 kB minified, 33.7 kB gz. The ceiling goes to 36 rather than 34.5 for the same
 * reason it went to 32 for images: moving this line by a few hundred bytes at a time is how a
 * budget stops meaning anything. The next feature has headroom; the one after argues again.
 *
 * The breakdown says there is no fat to cut instead -- 26.8 kB is NoteView, 18.7 kB is the
 * stylesheet, and the rest is spread across the ink layer, `perfect-freehand`, the settings
 * panel, markdown, anchoring, history and formatting. Every one of those is the feature itself.
 *
 * Before raising it again: re-measure with an esbuild metafile (see the tail of this comment's
 * history for how), ask the same question, and if the answer is again "cannot be split", say so
 * here rather than moving the number quietly.
 */
export const BUDGETS_GZ: Readonly<Record<string, number>> = {
  'cs/guard.js': 1_024,
  'cs/renderer.js': 36 * 1024,
};
