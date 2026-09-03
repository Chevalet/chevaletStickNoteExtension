# Privacy

**Chevalet Note makes no network requests. None. Not once.**

That is not a policy statement, it is a property of the code: there is no `fetch`, no
`XMLHttpRequest`, no WebSocket, no `sendBeacon`, and no remote script anywhere in the shipped
extension. You can verify it by reading the source, by watching the Network panel, or by
running Firefox with the extension in an offline profile — everything works exactly the same.

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

`downloads` is optional and only requested if you turn on unattended scheduled backups.
Manual export needs no permission at all.

## What the extension can see

While it is enabled on a page, the in-page layer reads the page's text — that is how a note
stays attached to the paragraph you stuck it to when the page changes. What it keeps is a
short quote of the surrounding text, stored inside your own note record so the note can be
found again. It is never transmitted, because nothing is ever transmitted.

## Contact

Issues and questions: https://github.com/Chevalet/chevaletStickNoteExtension/issues
