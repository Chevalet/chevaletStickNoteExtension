# Building Chevalet Note from source

For addons.mozilla.org reviewers, and for anyone who wants to check that the published
`.xpi` is what this repository says it is.

The build is deliberately a plain script rather than a framework, precisely so this document
can be short and so the output can be reproduced byte-for-byte.

## What you need

| | |
|---|---|
| Node.js | **24.x** (uses `--experimental-strip-types`; `node --version` should print `v24.*`) |
| pnpm | **11.x** — `corepack enable && corepack use pnpm@11` |
| OS | Any. Nothing in the build is platform-specific. |

No other toolchain, no network access during the build, and no code is downloaded at build
time beyond the pinned dependencies in `pnpm-lock.yaml`.

## Steps

```bash
pnpm install --frozen-lockfile
pnpm build
```

`dist/` is the unpacked extension. To produce the same zip the submission contains:

```bash
pnpm package        # writes artifacts/chevalet_note-<version>.zip
```

## Verifying the result

```bash
pnpm check          # typecheck, lint, 200+ unit tests, and web-ext lint on dist/
```

`web-ext lint` must report **0 errors, 0 warnings, 0 notices**. That is enforced in CI with
`--warnings-as-errors`, so a submission that does not meet it never gets built.

## Reproducibility

The build is deterministic. Two runs of `pnpm build` from the same commit produce identical
`dist/` bytes, on any machine:

- No timestamps are embedded anywhere.
- No randomness. The one value that *looks* random — the shadow-host element tag name, which
  exists so a page cannot target our injected element by guessing its name — is derived from
  `name@version` with SHA-256. See `HOST_TAG` in [`build.config.ts`](build.config.ts). The
  same applies to the `FontFace` family-name prefix.
- No network. `esbuild` bundles only what is in `node_modules`.
- `_locales/**` and `dist/manifest.json` are generated from source
  (`src/shared/i18n.ts` and `src/manifest.ts`) rather than hand-maintained, so they cannot
  disagree with the code.

To confirm:

```bash
pnpm build && cp -r dist dist-a
pnpm build && diff -r dist-a dist && echo "identical"
```

## What each bundle is

| Output | Source | Format | Why |
|---|---|---|---|
| `bg/main.js` | `src/bg/main.ts` | ESM | The MV3 background is an **event page** (`"type": "module"`). Firefox does not ship `background.service_worker`. |
| `cs/guard.js` | `src/cs/guard.ts` | IIFE | Firefox content scripts are not ES modules. ~1 kB, injected at `document_start`. |
| `cs/renderer.js` | `src/cs/renderer.ts` | IIFE | Same reason. This is the in-page note layer. |
| `ui/popup.js`, `ui/options.js`, `ui/manager.js` | `src/ui/*/index.ts` | IIFE | Extension pages. |

`spikes/` contains development harnesses that are **never built into `dist/`**. They are only
emitted by `pnpm build:dev`, next to their own HTML, and exist so the look and behaviour can
be exercised in an ordinary browser tab.

## Third-party code

Five runtime dependencies, all bundled from `node_modules`, none loaded at run time. See
[THIRD-PARTY.md](THIRD-PARTY.md) for versions and licences.

| Package | Used for |
|---|---|
| `marked` | Tokenizing markdown. The tokens are turned into DOM nodes by our own code; `innerHTML` is never used. |
| `perfect-freehand` | Turning pen input into a stroke outline. |
| `approx-string-match` | Fuzzy text matching, so a note stays attached when the page's wording changes slightly. |
| `fflate` | Reading and writing the ZIP backup. |
| `minisearch` | The search index in the manager page, built in memory when that page opens. |

## No remote code

There is no `eval`, no `new Function`, no remote `import()`, no CDN, and no network request of
any kind at run time. The extension declares
`data_collection_permissions: { required: ["none"] }` and makes no requests, so there is
nothing to intercept and nothing to audit on the wire. See [PRIVACY.md](PRIVACY.md).

## Permissions, and why each one is there

Listed in [`src/manifest.ts`](src/manifest.ts) with a comment on every entry. In short:

| Permission | Why |
|---|---|
| `storage` | Settings in `storage.local`; the tab map in `storage.session`. |
| `unlimitedStorage` | Marks the extension's storage group persistent, so notes cannot be evicted under disk pressure. |
| `sessions` | `setTabValue` — the per-tab on/off state that survives a browser restart, and the recently-closed list. |
| `tabs` | Tab URLs and titles, for scope matching and for the manager. |
| `scripting` | Notes are injected per origin-that-has-notes; a site with no notes receives zero bytes. |
| `alarms` | The retention sweep and the scheduled backup. |
| `menus` | The "add a note here" context-menu item. |
| `activeTab` | Lets the toolbar button work on a site the user has not granted access to. |

`downloads` and `webNavigation` are **optional** and requested in context.
`host_permissions` is **empty**: Firefox MV3 does not grant host permissions at install, so
declaring them would only add an install-time warning. They are requested from a click in the
popup, at the granularity the user chooses (this site / this domain / all sites).
