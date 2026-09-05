/**
 * Build the extension into `dist-test/`, with host access declared.
 *
 *   node --experimental-strip-types tools/build-test-ext.ts
 *
 * ## Why this exists at all
 *
 * The shipped extension declares NO host permissions -- they are requested from a click in the
 * popup, and a permission prompt lives in browser chrome, which is the one place WebDriver
 * cannot reach. So nothing could ever drive the real extension over a real page, and two bugs
 * went out in 0.0.10 that lived exactly there: a note whose text was never saved, and a note
 * that followed a single-page app from one route to another.
 *
 * This produces the same extension with one line of the manifest changed. Everything else --
 * every bundle, every asset, the locales, the fonts -- comes from `dist/`, so there is no
 * second build to drift.
 *
 * ## Why it copies rather than rebuilds
 *
 * A second esbuild run with different flags would be a second product. Copying `dist/` means
 * `spikes/firefox-extension.mjs` drives THE BUILD THAT SHIPS, with a manifest that lets a
 * driver in. The only difference is one that cannot change behaviour on a page the user has
 * already granted -- which is the state the harness is trying to reproduce.
 *
 * `dist-test/` is gitignored, never signed and never uploaded.
 */

import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OUT, ROOT, pkg } from '../build.config.ts';

const TEST_OUT = join(ROOT, 'dist-test');

const built = await readFile(join(OUT, 'manifest.json'), 'utf8').catch(() => null);
if (!built) {
  console.error('\ndist/ is not built. Run: pnpm build\n');
  process.exit(2);
}

await rm(TEST_OUT, { recursive: true, force: true });
await cp(OUT, TEST_OUT, { recursive: true });

const { manifest } = await import(`../src/manifest.ts?v=${Date.now()}`);
await writeFile(
  join(TEST_OUT, 'manifest.json'),
  `${JSON.stringify(manifest({ version: pkg.version, testHostAccess: true }), null, 2)}\n`,
  'utf8',
);

/*
 * A different add-on id, so a test build can never be mistaken for -- or update over -- the
 * signed one in a browser profile.
 */
const written = JSON.parse(await readFile(join(TEST_OUT, 'manifest.json'), 'utf8'));
written.browser_specific_settings.gecko.id = 'chevalet-note-test@chevalet.dev';
written.name = 'Chevalet Note (test build)';
await writeFile(join(TEST_OUT, 'manifest.json'), `${JSON.stringify(written, null, 2)}\n`, 'utf8');

process.stdout.write(
  `\n  dist-test/  ${pkg.version}, host access declared, id chevalet-note-test@chevalet.dev\n` +
    '  For spikes/firefox-extension.mjs only. Never sign or upload this.\n\n',
);
