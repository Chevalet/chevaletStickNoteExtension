/**
 * chevaletNote build.
 *
 * Deliberately a plain, readable script rather than a framework: AMO reviewers must be
 * able to reproduce `dist/` byte-for-byte from source. Everything here is deterministic --
 * no timestamps, no randomness, no network. The only "random" value in the product (the
 * shadow-host tag name) is derived from name+version by sha256 so it is stable across
 * machines and reproducible by a reviewer.
 *
 *   node --experimental-strip-types build.ts [--dev] [--watch]
 */
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');

const argv = new Set(process.argv.slice(2));
const DEV = argv.has('--dev');
const WATCH = argv.has('--watch');

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
};

/** Deterministic per-release tag for the shadow host element. See plan §4. */
const HOST_TAG = `chevalet-note-root-${createHash('sha256')
  .update(`${pkg.name}@${pkg.version}`)
  .digest('hex')
  .slice(0, 8)}`;

/** Deterministic prefix for FontFace family names, so we never collide with a page's fonts. */
const FONT_NS = `cn${createHash('sha256').update(`fonts@${pkg.version}`).digest('hex').slice(0, 6)}`;

const define = {
  __DEV__: String(DEV),
  __VERSION__: JSON.stringify(pkg.version),
  __HOST_TAG__: JSON.stringify(HOST_TAG),
  __FONT_NS__: JSON.stringify(FONT_NS),
};

const shared: esbuild.BuildOptions = {
  bundle: true,
  target: ['firefox128'],
  platform: 'browser',
  charset: 'utf8',
  legalComments: 'none',
  treeShaking: true,
  minify: !DEV,
  sourcemap: DEV ? 'inline' : false,
  define,
  logLevel: 'info',
  alias: { '~': SRC },
};

/**
 * Content scripts are NOT ES modules in Firefox -- they must be IIFE.
 * The background event page is `"type": "module"`, so it gets ESM.
 */
const targets: Array<{ in: string; out: string; format: esbuild.Format }> = [
  { in: 'bg/main.ts', out: 'bg/main', format: 'esm' },
  { in: 'cs/guard.ts', out: 'cs/guard', format: 'iife' },
  { in: 'cs/renderer.ts', out: 'cs/renderer', format: 'iife' },
  { in: 'ui/popup/index.ts', out: 'ui/popup', format: 'iife' },
  { in: 'ui/options/index.ts', out: 'ui/options', format: 'iife' },
  { in: 'ui/manager/index.ts', out: 'ui/manager', format: 'iife' },
];

async function buildManifest(): Promise<void> {
  const { manifest } = await import(`./src/manifest.ts?v=${Date.now()}`);
  const json = JSON.stringify(manifest({ version: pkg.version }), null, 2);
  await writeFile(join(OUT, 'manifest.json'), `${json}\n`, 'utf8');
}

async function copyStatic(): Promise<void> {
  for (const dir of ['_locales', 'assets']) {
    await cp(join(ROOT, dir), join(OUT, dir), { recursive: true, force: true }).catch(() => {});
  }
  // HTML shells live next to their entry point in src/ui/<name>/index.html
  for (const name of ['popup', 'options', 'manager']) {
    const from = join(SRC, 'ui', name, 'index.html');
    await cp(from, join(OUT, 'ui', `${name}.html`), { force: true }).catch(() => {});
  }
}

/** Report gzipped size against the budgets in the plan, and fail the build if blown. */
const BUDGETS_GZ: Record<string, number> = {
  'cs/guard.js': 1_024,
  'cs/renderer.js': 24 * 1024,
};

async function reportSizes(): Promise<void> {
  const { gzipSync } = await import('node:zlib');
  let over = false;
  for (const t of targets) {
    const file = `${t.out}.js`;
    const bytes = await readFile(join(OUT, file)).catch(() => null);
    if (!bytes) continue;
    const gz = gzipSync(bytes, { level: 9 }).byteLength;
    // Dev builds are unminified with inline sourcemaps, so their sizes mean nothing here.
    const budget = DEV ? undefined : BUDGETS_GZ[file];
    const flag = budget && gz > budget ? ' OVER BUDGET' : '';
    if (flag) over = true;
    const budgetStr = budget ? ` / ${(budget / 1024).toFixed(1)}kB` : '';
    process.stdout.write(
      `  ${file.padEnd(18)} ${(bytes.byteLength / 1024).toFixed(1)}kB raw  ` +
        `${(gz / 1024).toFixed(1)}kB gz${budgetStr}${flag}\n`,
    );
  }
  if (over && !DEV) {
    throw new Error('bundle size budget exceeded -- see plan section 2');
  }
}

/**
 * Dev-only harnesses. These import the real modules and mount them outside the extension so
 * the look and the feel can be judged and profiled directly in a browser. Never shipped --
 * they are emitted next to their own HTML under spikes/, not into dist/.
 */
async function buildHarnesses(): Promise<void> {
  if (!DEV) return;
  await esbuild.build({
    ...shared,
    entryPoints: [join(ROOT, 'spikes/paper/main.ts')],
    outfile: join(ROOT, 'spikes/paper/bundle.js'),
    format: 'iife',
    minify: false,
    logLevel: 'warning',
  });
  process.stdout.write('  harness:  spikes/paper/index.html\n');
}

async function run(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const ctxs = await Promise.all(
    targets.map((t) =>
      esbuild.context({
        ...shared,
        entryPoints: [resolve(SRC, t.in)],
        outfile: join(OUT, `${t.out}.js`),
        format: t.format,
      }),
    ),
  );

  if (WATCH) {
    await Promise.all(ctxs.map((c) => c.watch()));
    await buildManifest();
    await copyStatic();
    await buildHarnesses();
    process.stdout.write(`\nwatching (host tag: ${HOST_TAG})\n`);
    return;
  }

  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
  await buildManifest();
  await copyStatic();
  process.stdout.write(`\nchevaletNote ${pkg.version}${DEV ? ' (dev)' : ''}\n`);
  process.stdout.write(`  host tag: ${HOST_TAG}\n  font ns:  ${FONT_NS}\n`);
  await reportSizes();
  await buildHarnesses();
}

await run();
