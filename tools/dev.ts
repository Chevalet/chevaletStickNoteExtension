/**
 * The dev server.
 *
 *   pnpm serve      ->  http://127.0.0.1:8731
 *
 * One fixed port, always serving the freshest build. It watches the sources, rebuilds on every
 * change with exactly the same esbuild configuration as a release build, and pushes a reload to
 * any open tab. Two people (or a person and an agent) can therefore look at the same running
 * version at the same time without stepping on each other.
 *
 * `Cache-Control: no-store` on everything is not paranoia -- an earlier session spent twenty
 * minutes debugging a fix that had already landed, because the browser was serving a cached
 * bundle. On a dev port, staleness is never the behaviour you want.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import * as esbuild from 'esbuild';
import {
  copyStatic,
  HARNESSES,
  HOST_TAG,
  OUT,
  pkg,
  ROOT,
  sharedOptions,
  SRC,
  TARGETS,
  writeLocales,
  writeManifest,
} from '../build.config.ts';

const PORT = 8731;
const HOST = '127.0.0.1';

// ---------------------------------------------------------------- build state

interface BuildState {
  ok: boolean;
  at: number;
  generation: number;
  errors: string[];
}
const state: BuildState = { ok: false, at: 0, generation: 0, errors: [] };
const clients = new Set<ServerResponse>();

function announce(): void {
  const payload = `data: ${JSON.stringify({
    generation: state.generation,
    ok: state.ok,
    errors: state.errors,
  })}\n\n`;
  for (const c of clients) c.write(payload);
}

function stamp(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

/**
 * Every bundle reports, and the results are aggregated.
 *
 * An earlier version attached this to the first context only. When a harness bundle failed to
 * build, the server cheerfully announced a successful rebuild and kept serving the last good
 * copy -- so a broken change looked like a working one. A dev port that lies about the state
 * of the build is worse than having no dev port at all.
 */
const errorsByTarget = new Map<string, string[]>();
let settleTimer: NodeJS.Timeout | null = null;

function reporterFor(name: string): esbuild.Plugin {
  return {
    name: `cn-dev-reporter-${name.replace(/\W+/g, '-')}`,
    setup(build) {
      build.onEnd((result) => {
        errorsByTarget.set(
          name,
          result.errors.map(
            (e) => `${name}  ${e.location?.file ?? '?'}:${e.location?.line ?? 0}  ${e.text}`,
          ),
        );
        // One save touches several bundles. Debounce so it prints once, not once per bundle.
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => void settle(), 60);
      });
    },
  };
}

async function settle(): Promise<void> {
  state.errors = [...errorsByTarget.values()].flat();
  state.ok = state.errors.length === 0;
  state.at = Date.now();
  state.generation++;
  if (state.ok) {
    await writeManifest().catch(() => {});
    await writeLocales().catch(() => {});
    await copyStatic().catch(() => {});
    process.stdout.write(
      `  ${stamp()}  rebuilt #${state.generation}  (${errorsByTarget.size} bundles)\n`,
    );
  } else {
    process.stdout.write(`  ${stamp()}  BUILD FAILED  (${state.errors.length})\n`);
    for (const e of state.errors) process.stdout.write(`    ${e}\n`);
  }
  announce();
}

async function startWatching(): Promise<void> {
  const shared = sharedOptions(true);
  const all = [...TARGETS, ...HARNESSES];
  const contexts = await Promise.all(
    all.map((t) =>
      esbuild.context({
        ...shared,
        entryPoints: [resolve(SRC, t.in)],
        outfile: join(OUT, `${t.out}.js`),
        format: t.format,
        minify: false,
        plugins: [reporterFor(t.out.replace('../spikes/', ''))],
      }),
    ),
  );
  await Promise.all(contexts.map((c) => c.watch()));
}

// ------------------------------------------------------------------- serving

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Injected into every HTML page so a rebuild reloads whatever is open. */
const LIVE_RELOAD = `
<script>
(() => {
  let gen = null;
  const es = new EventSource('/__dev/events');
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    if (gen === null) { gen = d.generation; return; }
    if (d.generation !== gen) {
      if (d.ok) location.reload();
      else console.warn('[cn dev] build failed:', d.errors);
      gen = d.generation;
    }
  };
})();
</script>
`;

function noStore(res: ServerResponse, type: string): void {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
}

/** Resolve a URL path to a file inside ROOT, refusing anything that escapes it. */
function safePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const p = resolve(ROOT, `.${normalize(decoded)}`);
  return p === ROOT || p.startsWith(ROOT + sep) ? p : null;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/';

  if (url.startsWith('/__dev/events')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ generation: state.generation, ok: state.ok })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Icon regeneration. The PNGs are rasterized by the browser from assets/logo*.svg -- the
  // same renderer that will show them -- and posted back here to be written. That keeps the
  // vector as the only source of truth and makes regenerating every size a one-click job.
  // Dev server only, and it will only ever write assets/icon-<size>.png.
  if (url.startsWith('/__dev/write-icons') && req.method === 'POST') {
    const body = await new Promise<string>((finish) => {
      let buf = '';
      req.on('data', (c) => {
        buf += c;
      });
      req.on('end', () => finish(buf));
    });
    try {
      const icons = JSON.parse(body) as Record<string, string>;
      const written: string[] = [];
      for (const [size, b64] of Object.entries(icons)) {
        if (!/^\d{1,4}$/.test(size)) continue;
        const file = join(ROOT, 'assets', `icon-${size}.png`);
        await writeFile(file, Buffer.from(b64, 'base64'));
        written.push(`icon-${size}.png`);
      }
      process.stdout.write(`  ${stamp()}  wrote ${written.length} icons\n`);
      noStore(res, 'text/plain; charset=utf-8');
      res.end(written.join('\n'));
    } catch (e) {
      res.writeHead(400).end(String(e));
    }
    return;
  }

  /*
   * A page that forbids fonts outright, for `spikes/firefox-fonts.mjs`.
   *
   * The question that spike answers is whether a note can get a bundled face on a site with a
   * strict CSP -- the same class of problem that made pasted images paint to a canvas instead
   * of using an `<img src>`. A header cannot be faked from inside a page, so the harness needs
   * a real response with a real Content-Security-Policy on it.
   */
  if (url.startsWith('/__dev/csp-fonts')) {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; font-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(
      '<!doctype html><meta charset=utf-8><title>font-src none</title>' +
        '<p>This page forbids fonts. A note on it should still get its own.</p>',
    );
    return;
  }

  if (url.startsWith('/__dev/status')) {
    noStore(res, MIME['.json'] as string);
    res.end(JSON.stringify({ ...state, version: pkg.version, hostTag: HOST_TAG }, null, 2));
    return;
  }

  if (url === '/' || url.startsWith('/?')) {
    noStore(res, MIME['.html'] as string);
    res.end(hub() + LIVE_RELOAD);
    return;
  }

  /*
   * The cabinet harness lives at /spikes/cabinet/, but it loads the SHIPPED bundle, which asks
   * for the logo at `../assets/logo.svg` -- correct from `dist/ui/manager.html`, and
   * /spikes/assets/logo.svg from here. Without this the harness shows a broken-image box where
   * the wordmark goes, in every screenshot, for ever, and you stop seeing it. Serving the real
   * file rather than patching the bundle keeps the harness a photograph of what ships.
   */
  const aliased = url.startsWith('/spikes/assets/fonts/')
    ? // The fonts are not in the repository -- they are copied out of node_modules into dist
      // by the build -- so this one goes to dist, not to the source tree. Without it every
      // bundled face 404s in the harness and every screenshot of the Type picker shows eight
      // labels in the same mono font, which is a false alarm you would learn to ignore.
      url.replace('/spikes/assets/', '/dist/assets/')
    : url.startsWith('/spikes/assets/')
      ? url.replace('/spikes/', '/')
      : url;

  const file = safePath(aliased);
  if (!file) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    const type = MIME[extname(target)] ?? 'application/octet-stream';
    noStore(res, type);
    if (type.startsWith('text/html')) {
      res.end(body.toString('utf8').replace('</body>', `${LIVE_RELOAD}</body>`));
    } else {
      res.end(body);
    }
  } catch {
    noStore(res, MIME['.html'] as string);
    res.writeHead(404).end(`<pre>404  ${url}</pre>${LIVE_RELOAD}`);
  }
}

// ----------------------------------------------------------------- the hub

function hub(): string {
  const links: Array<[string, string, string]> = [
    [
      '/spikes/playground/',
      'Playground',
      'The whole note stack in an ordinary page: create notes, drag them, reload and watch them come back. Notes are stored per URL in IndexedDB, exactly as the extension stores them.',
    ],
    [
      '/spikes/paper/',
      'Paper feel',
      'The art and physics harness. Live controls for tear, grain, tape, shadow, and a slow-motion toggle for judging each spring on its own.',
    ],
    [
      '/docs/spikes.md',
      'Spike runbook',
      'The six phase-0 questions and how to answer them against a real Firefox.',
    ],
    ['/docs/perf.md', 'Performance notes', 'Measured numbers, tuning constants, and every bug the harness caught.'],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chevaletNote dev</title>
<style>
  :root { --paper:#f4efe2; --ink:#14110e; --hi:#ffe94a; --accent:#ff2e63; --dim:#6b6355; }
  * { box-sizing: border-box; }
  body { margin:0; padding:34px 30px 90px; background:var(--paper); color:var(--ink);
         font:15px/1.6 ui-monospace, "Cascadia Mono", Consolas, monospace; }
  h1 { font-size:26px; margin:0 0 4px; letter-spacing:-.5px; }
  h1 span { background:var(--hi); padding:0 8px; box-shadow:5px 5px 0 var(--ink); }
  .meta { color:var(--dim); margin:16px 0 30px; font-size:13px; }
  a.card { display:block; text-decoration:none; color:inherit; border:3px solid var(--ink);
           background:#fff; padding:14px 16px; margin:0 0 14px; max-width:74ch;
           box-shadow:6px 6px 0 var(--ink); }
  a.card:hover { transform:translate(2px,2px); box-shadow:4px 4px 0 var(--accent); }
  a.card b { display:block; font-size:17px; margin-bottom:4px; }
  a.card span { color:var(--dim); font-size:13px; }
  #status { position:fixed; left:0; right:0; bottom:0; padding:7px 16px; font-size:12.5px;
            background:var(--ink); color:var(--hi); border-top:3px solid var(--accent); }
  #status.bad { background:var(--accent); color:#fff; }
  pre { margin:6px 0 0; white-space:pre-wrap; font-size:12px; }
</style></head><body>
<h1><span>chevaletNote</span> dev</h1>
<p class="meta">
  v${pkg.version} &middot; host tag <code>${HOST_TAG}</code><br>
  This port always serves the newest build. Sources are watched; anything open here reloads
  itself when a rebuild finishes. If a build breaks, the bar at the bottom turns red and says
  why instead of silently serving stale code.
</p>
${links.map(([href, title, desc]) => `<a class="card" href="${href}"><b>${title}</b><span>${desc}</span></a>`).join('\n')}
<div id="status">connecting…</div>
<script>
  const bar = document.getElementById('status');
  const es = new EventSource('/__dev/events');
  es.onmessage = (e) => {
    const d = JSON.parse(e.data);
    bar.className = d.ok ? '' : 'bad';
    bar.innerHTML = d.ok
      ? 'build #' + d.generation + ' ok &middot; ' + new Date().toLocaleTimeString()
      : 'BUILD FAILED<pre>' + (d.errors || []).join('\\n') + '</pre>';
  };
  es.onerror = () => { bar.className = 'bad'; bar.textContent = 'dev server not reachable'; };
</script>
</body></html>`;
}

// --------------------------------------------------------------------- boot

await startWatching();

createServer((req, res) => {
  handle(req, res).catch((e) => {
    res.writeHead(500).end(String(e));
  });
}).listen(PORT, HOST, () => {
  process.stdout.write(
    `\nchevaletNote dev server\n  http://${HOST}:${PORT}\n  watching src/ and spikes/, no caching, live reload on\n\n`,
  );
});
