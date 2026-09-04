# Publishing to addons.mozilla.org

Everything the store needs, in the order it asks for it. Nothing here costs money: AMO is free
to publish on and free to be listed on.

## Listed or unlisted — pick this first, it changes everything

| | **Listed** | **Unlisted** |
|---|---|---|
| Where it lives | addons.mozilla.org, searchable | your own server or a GitHub release |
| Install | one click, from the store | you hand people an `.xpi` |
| **Updates** | **Firefox does it, silently, on its own** | you host an update manifest and point `update_url` at it |
| Review | a human reads the code | automated signing only |
| Signing | AMO signs it | AMO signs it |

**Listed is what we want.** It is the only route where updates simply happen for whoever
installed it, and it is why the update-check button in the settings exists only as a stopgap:
once this is listed, that button becomes redundant and can go.

Nothing needs `update_url` in the manifest for a listed add-on. Do not add one — for a listed
extension AMO rejects it.

## Before uploading

- [x] `strict_min_version` is `140.0` and `strict_min_version_android` is `142.0`. Both are
      required by `data_collection_permissions`, and claiming a lower floor is what produced
      the two validator warnings on the 0.0.4 upload.
- [x] Every control in the settings is traceable to code that reads it. 0.0.10 removed four
      that were not — see the header of `src/ui/manager/settings.ts`. A reviewer who tries a
      switch and sees nothing happen has every reason to distrust the rest of the listing.
- [x] `web-ext lint --warnings-as-errors` reports 0 errors, 0 warnings, 0 notices.
- [x] `optional_permissions` is empty and every declared permission is actually used. A
      permission you never call is the first thing a reviewer asks about.
- [x] No remote code, no `eval`, no CDN, no `innerHTML`. Stated in `SOURCE.md` and true.

```bash
pnpm exec biome check . && pnpm exec tsc --noEmit && pnpm exec vitest run
node --experimental-strip-types build.ts
pnpm exec web-ext lint --source-dir dist --no-config-discovery --warnings-as-errors
pnpm exec web-ext build --source-dir dist --artifacts-dir web-ext-artifacts --overwrite-dest --no-config-discovery
```

## The source archive is NOT optional for us

**This is the requirement most first submissions get wrong.** AMO requires the original source
whenever the submitted code is minified, concatenated or otherwise machine-generated. Our build
runs esbuild with `minify: true`, so every shipped file qualifies. Uploading only the package
would get the submission rejected with a request for source, adding a review cycle.

What to upload as the source archive: a zip of the repository *without* `node_modules`, `dist`
and `web-ext-artifacts`. The cleanest way is an archive of the tagged commit:

```bash
git archive --format=zip --prefix=chevalet-note/ -o web-ext-artifacts/source-0.0.10.zip v0.0.10
```

`SOURCE.md` is already written for the reviewer and covers the toolchain, the exact commands,
and why the build is reproducible byte-for-byte (no timestamps, no network, the host tag
derived from `name@version` by SHA-256). Point at it in the reviewer notes.

## Listing metadata

**Every field is written out in `docs/LISTING.md`.** Copy from there rather than composing in
the form — the description field in particular is long, and AMO does not save drafts reliably.
The summary below is repeated here only so this page reads on its own.

**Name** — Chevalet Note

**Summary** (250 characters max)

> Sticky notes that stay stuck to the page, not to your browser. They scroll with the content,
> come back when you revisit the URL, and never leave your machine.

**Description** — the long field. Lead with what it does, then the privacy story, then the
list. `PRIVACY.md` has the wording for the privacy paragraph; do not soften it, it is the
strongest thing in the listing.

**Categories** and **Tags** — see `docs/LISTING.md`, and only that file.

Two lines used to sit here saying "Productivity" and a comma-separated list of tags, and both
were wrong against the actual form: AMO's category list for Firefox extensions contains no
Productivity, and tags are a **fixed set of checkboxes**, not free text — none of the six
suggested here existed on it. That is the second time this page has described a field it had
not looked at. `docs/LISTING.md` has the real lists, checked against the form, with the
reasoning for each pick; duplicating them here is what let them drift in the first place.

**Support** — the GitHub repository's issues page.

**Privacy policy** — paste `PRIVACY.md`. AMO shows it verbatim.

**Licence** — MPL-2.0, which matches `LICENSE` in the repo.

**Screenshots** — at least three, 1280×800 or larger:

1. Two or three notes on a real article, one showing rendered markdown with a task list
2. The cabinet, with drawers per site and the index cards
3. The settings pane in the cabinet, on the Look section with the palette swatches
4. A note mid-drag, tilted, so the paper physics reads

**Icon** — `assets/icon-512.png`, produced by `spikes/make-icons.mjs` from the one logo.

### Data collection

AMO now asks this as a form, and the manifest already answers it:
`data_collection_permissions: { required: ['none'] }`. Answer **no** to every category. The
only network request the extension can make is the update check, which is off by default, asks
for its host permission at the moment of use, and sends no cookies, no referrer and nothing
identifying — say exactly that in the notes rather than leaving it for the reviewer to find.

## Notes to reviewer

Keep it short and factual. A draft:

> No account or login is needed; everything works offline.
>
> The build is minified, so the full source is attached. `SOURCE.md` has the toolchain and the
> two commands, and the output is reproducible byte-for-byte — no timestamps, no network access
> during the build.
>
> There are no static `content_scripts`. Scripts are registered at run time via
> `scripting.registerContentScripts` for the origins the user has explicitly granted, which is
> why the install prompt asks for no host permissions at all. `src/bg/inject.ts` explains it.
>
> Notes are stored in the extension's own IndexedDB. Nothing is uploaded anywhere. The single
> network call in the codebase is an opt-in update check against the GitHub releases API
> (`src/bg/jobs/update.ts`), off by default, gated behind an optional host permission requested
> from a click.
>
> Note content is rendered by a small markdown lexer in `src/cs/note/md-lex.ts` and built into
> DOM with `createElement`/`textContent`. `innerHTML` is never assigned anywhere in the
> codebase, so there is no HTML sanitiser to audit.

## Signing a build for yourself, before the listing clears

`tools/sign.mjs` puts a build through AMO's **unlisted** channel, which signs automatically in
a couple of minutes with no human review, so it can be installed permanently in an ordinary
Firefox while the store listing is still in the queue. An add-on can carry versions in both
channels, so this does not disturb the listed submission — but AMO will not accept a version
number it has already seen in *either* channel, so the two cannot share one.

## After it is listed

Releasing an update is then three steps:

1. Bump `version` in `package.json`, build, package.
2. Upload the new zip to the existing listing, plus the matching source archive.
3. Write the version notes.

Firefox picks it up for everyone who installed it, on its own schedule, with no action from
them. That is the whole reason for going through review.

Two things worth remembering:

- **The version can only go up.** AMO will not accept a version it has already seen, even a
  rejected one, so a botched upload costs a version number.
- **Review takes days, not minutes**, and the first review of a new add-on is the slowest. Do
  not schedule anything around it.

## The one thing still worth doing first

Spike R1 — whether a content script's `beforeunload` actually produces a dialog on tab close —
is still open, and it cannot be automated. `spikes/firefox-r1.mjs` builds a probe add-on,
installs it in a real Firefox and closes a tab, and reports **no dialog for both trials
including the control**, where the page arms its own `beforeunload`. A failed control means a
useless measurement: WebDriver's Close Window command does not run unload prompts at all. The
spike stays in the repo, with its control, so nobody repeats the approach.

So it needs thirty seconds of a human: make a note, type in it, press Ctrl+W — then repeat with
a hand-armed `beforeunload` in the page's console as a control. `docs/spikes.md` has the
procedure and a table for reading the result.

This does **not** block submission. The setting already describes itself as best-effort, which
is honest whichever way the answer falls. But if a content script's `beforeunload` turns out to
be ignored, the wording should be firmed up before strangers read it.
