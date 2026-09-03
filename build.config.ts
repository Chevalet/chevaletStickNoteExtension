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
import { cp, readFile, writeFile } from 'node:fs/promises';
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

export async function copyStatic(): Promise<void> {
  for (const dir of ['_locales', 'assets']) {
    await cp(join(ROOT, dir), join(OUT, dir), { recursive: true, force: true }).catch(() => {});
  }
  // HTML shells live next to their entry point in src/ui/<name>/index.html
  for (const name of ['popup', 'options', 'manager']) {
    await cp(join(SRC, 'ui', name, 'index.html'), join(OUT, 'ui', `${name}.html`), {
      force: true,
    }).catch(() => {});
  }
}

/** Gzipped budgets from plan section 2. Exceeding one fails a production build. */
export const BUDGETS_GZ: Readonly<Record<string, number>> = {
  'cs/guard.js': 1_024,
  'cs/renderer.js': 24 * 1024,
};
