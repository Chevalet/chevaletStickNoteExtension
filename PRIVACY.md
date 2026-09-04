# Privacy

**Chevalet Note sends nothing about you anywhere, and makes no network request at all unless
you ask it to.**

There is exactly one network call in the shipped code: an optional check for a new version. It
is **off by default**, it asks for its own permission the first time you press the button, and
all it does is read the public release list and compare one version number. It sends no
cookies, no referrer, no identifier and no note content — `credentials: 'omit'`,
`referrerPolicy: 'no-referrer'`. It lives in `src/bg/jobs/update.ts` and it is the only `fetch`
in the codebase, which you can check with a single search.

Turn it off, or never turn it on, and the extension makes no network request whatsoever. There
is no `XMLHttpRequest`, no WebSocket, no `sendBeacon`, no analytics, no telemetry and no remote
script anywhere. Run Firefox with the extension in an offline profile and everything works
exactly the same.

This paragraph used to say "no network requests, none, not once", which was true when it was
written and stopped being true when the update check was added. Saying so here rather than
quietly editing it is the point of a privacy policy.

The manifest declares this explicitly:

```json
"data_collection_permissions": { "required": ["none"] }
```

## What is stored, and where

Everything lives in your own Firefox profile on your own machine.

| What | Where | Notes |
|---|---|---|
| Your notes, drawings, pasted images, revisions | The extension's own **IndexedDB** | Never in a website's storage, so a site can never read them |
| Settings and per-site rules | `storage.local` | Small, and observable by the extension's own pages |
| Which tabs have notes on / off | Firefox's **session store**, via `sessions.setTabValue` | This is what makes "notes off for this tab" survive a restart |

Nothing is stored on any website's origin. Nothing is synced. There is no account, no
identifier, no telemetry, no analytics, and no crash reporting.

## What survives, and what does not

Being honest about this matters more than sounding reassuring.

| You do this | Your notes |
|---|---|
| Clear cache / cookies / site data | **survive** — Firefox's sanitizer excludes `moz-extension://` |
| Forget About This Site | **survive** |
| Run low on disk | **survive** — `unlimitedStorage` marks the storage group persistent |
| "Refresh Firefox" | **lost** — that creates a fresh profile |
| Uninstall the extension | **lost** — Firefox deletes an extension's storage with it |

The last two are the reason the ZIP backup exists, and why the extension can be set to write
one automatically. An export is a plain zip containing your notes as NDJSON, your images as
real image files, and a `readable/` folder of markdown — openable in anything, with or without
this extension installed.

## Permissions

Host access is **not** granted at install. You grant it from a button in the popup, at the
granularity you choose: this site, this domain, or all sites. You can revoke it at any time
from Firefox's own extensions panel, and the notes stay in the database while it is revoked.

Access to the release list (`https://api.github.com`) is also optional, and is requested at the
moment you first press "check for a new version" — never at install, and never in the
background before you have asked for it once.

Export needs no permission at all: the ZIP is built in the page and handed to Firefox's own
save dialog.

## What the extension can see

While it is enabled on a page, the in-page layer reads the page's text — that is how a note
stays attached to the paragraph you stuck it to when the page changes. What it keeps is a
short quote of the surrounding text, stored inside your own note record so the note can be
found again. It is never transmitted, because nothing is ever transmitted.

## Contact

Issues and questions: https://github.com/Chevalet/chevaletStickNoteExtension/issues
