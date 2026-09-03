/**
 * chevaletNote production build.
 *
 *   node --experimental-strip-types build.ts [--dev]
 *
 * Deliberately a plain, readable script rather than a framework: AMO reviewers must be able to
 * reproduce `dist/` byte-for-byte from source, and this file plus build.config.ts is the whole
 * story. For the watching dev server, see tools/dev.ts -- it shares this exact configuration
 * so what you test on the dev port is what ships.
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';
import {
  BUDGETS_GZ,
  copyStatic,
  FONT_NS,
  HARNESSES,
  HOST_TAG,
  OUT,
  pkg,
  SRC,
  sharedOptions,
  TARGETS,
  writeManifest,
} from './build.config.ts';

const DEV = process.argv.includes('--dev');
const shared = sharedOptions(DEV);

async function reportSizes(): Promise<void> {
  let over = false;
  for (const t of TARGETS) {
    const file = `${t.out}.js`;
    const bytes = await readFile(join(OUT, file)).catch(() => null);
    if (!bytes) continue;
    const gz = gzipSync(bytes, { level: 9 }).byteLength;
    // Dev builds are unminified with inline sourcemaps, so their sizes mean nothing here.
    const budget = DEV ? undefined : BUDGETS_GZ[file];
    const flag = budget && gz > budget ? ' OVER BUDGET' : '';
    if (flag) over = true;
    process.stdout.write(
      `  ${file.padEnd(18)} ${(bytes.byteLength / 1024).toFixed(1)}kB raw  ` +
        `${(gz / 1024).toFixed(1)}kB gz${budget ? ` / ${(budget / 1024).toFixed(1)}kB` : ''}${flag}\n`,
    );
  }
  if (over) throw new Error('bundle size budget exceeded -- see plan section 2');
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const all = DEV ? [...TARGETS, ...HARNESSES] : TARGETS;
await Promise.all(
  all.map((t) =>
    esbuild.build({
      ...shared,
      entryPoints: [resolve(SRC, t.in)],
      outfile: join(OUT, `${t.out}.js`),
      format: t.format,
      // Harnesses are read by a human in a browser; never minify them.
      minify: Boolean(shared.minify) && !t.in.startsWith('..'),
      logLevel: 'warning',
    }),
  ),
);
await writeManifest();
await copyStatic();

process.stdout.write(`\nchevaletNote ${pkg.version}${DEV ? ' (dev)' : ''}\n`);
process.stdout.write(`  host tag: ${HOST_TAG}\n  font ns:  ${FONT_NS}\n`);
await reportSizes();
if (DEV) process.stdout.write('  harnesses: spikes/paper, spikes/playground\n');
