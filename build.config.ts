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
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as esbuild from 'esbuild';

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
 * `cs/renderer.js` — 34 kB, raised four times, each with the measurement in hand.
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
 * The measured breakdown at 94.0 kB minified says there is no fat to cut instead — 25.5 kB is
 * NoteView, 16.3 kB is the stylesheet, and the rest is spread across the ink layer,
 * `perfect-freehand`, the settings panel, markdown, anchoring, history and formatting. Every
 * one of those is the feature itself.
 *
 * Before raising it again: re-measure with an esbuild metafile (see the tail of this comment's
 * history for how), ask the same question, and if the answer is again "cannot be split", say so
 * here rather than moving the number quietly.
 */
export const BUDGETS_GZ: Readonly<Record<string, number>> = {
  'cs/guard.js': 1_024,
  'cs/renderer.js': 34 * 1024,
};
