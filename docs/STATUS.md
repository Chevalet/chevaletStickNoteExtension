# Status — v0.0.6 (LTS), 4 September 2026

Backspace works. It took three wrong fixes to find that the cause was one line — the shadow
host was attached outside `<body>`, where Gecko refuses to run editing commands. See the
Backspace section of `docs/perf.md`.

**There is now a real-Firefox harness** (`spikes/firefox-*.mjs`, geckodriver), so "Seen" below
can mean the real browser rather than a Chromium approximation:

- **Tested** — unit or integration tests cover it
- **Seen** — watched running in the browser harness (`tools/dev.ts`, port 8731)
- **Built** — compiles and lints; never exercised
- **Firefox** — driven in a real Firefox through geckodriver, with real key events

414 tests · content script 30.1 kB gz of a 32.0 budget · `web-ext lint` 0 errors / 0 warnings
/ 0 notices.

## Works

| | Verified |
|---|---|
| Notes stick to document coordinates and scroll with the page | Seen |
| Notes scoped to the URL, restored on return (tracking params dropped, `http`≡`https`, `www.` stripped, params sorted) | Tested + Seen |
| IndexedDB store — clearing the cache does not touch it | Tested |
| Making a note: Alt + double-click, keyboard shortcut, context menu | Tested (messages) + Built (gestures) |
| Markdown incl. task lists, via a 3.1 kB own lexer; never touches `innerHTML` | Tested + Seen |
| Typing, Backspace and Delete inside a note | **Firefox** |
| RTL/LTR in both the editor and the rendered view; per-block under `auto`; code stays LTR | Seen |
| Freehand drawing, pen and eraser | Seen |
| Per-note styling: 8 palettes + custom colours, font, size, direction, alignment, torn edges, grain, tape, shadow, physics | Seen |
| Paper physics on drag — closed-form springs, compositor-only, 0% CPU at rest | Tested + Seen |
| Text-selection anchoring with a scored fallback chain | Tested |
| Manager: drawers per domain, search, multi-select, trash and restore | Seen |
| Full ZIP export (NDJSON + checksum + positions) | Tested |
| Per-tab on/off and per-site rules; tab identity survives session restore | Tested |
| Nothing injected until a site is granted — no `content_scripts` in the manifest | Tested |
| **Undo and redo** (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) across typing, colour, style, move, resize, collapse, lock, drawing, erasing, create and delete — one ordered history for the whole page | Tested + Seen |
| **Update check** — a button in settings, and an opt-in daily check. Off by default; it is the only network request the extension can make | Tested |
| **Pasted and dropped images**, stored per note and painted to a canvas so no page CSP can block them | Tested |
| **Your own default note style** — "Save as my default" on any note (press **S**), applied live to every note in the fields it never set itself | Tested |
| **All settings inside the cabinet**, in the cabinet's own idiom: manila section tabs, ruled paper, paper switches, palette swatches, a keyboard reference | Seen |
| One logo at every size, rasterised from the single SVG by `spikes/make-icons.mjs` | Seen |

## Half-built — the storage exists, the wire to the user does not

- **ZIP import.** Reads, validates the checksum, shows a dry-run merge plan. Does not write; the
  dialog says so.
- **Trash retention.** Settings exist and default to never destroying anything. Nothing purges on
  a schedule.

## Not built

- **Automatic backup to a file.** `backup.enabled`/`everyHours` sit in settings and nothing
  runs them. The `downloads` permission they would need has been removed until they exist.
- **Version history.** `addRevision`/`shouldSnapshot` written, never called.
- **Bundled fonts.** System stacks only. Vazirmatn and Estedad are declared for Persian; the files
  are not in the repo.
- **Hold-a-key click-through** (`ghostModifier`), `motion`, `urlMatchDefault` — all in settings,
  all unread. The per-note `physics` control does work.
- **Duplicate Tab handling.** `resolveDuplicate` written, never called.
- **AMO signing and submission.** The build installs temporarily only.

### Permissions — fixed in 0.0.2

`webNavigation` and `downloads` were requested and never used; they are gone from the manifest
and go back the day the code that needs them lands. `alarms` is now genuinely used, by the
opt-in daily update check. `optional_permissions` is empty.

## The one open question — spike R1

**Does a content script's `beforeunload` actually prompt on tab close?** The close warning
depends entirely on it, and it has never been checked against a real Firefox. Firefox decides
whether to show the dialog, and a page with no user interaction may get none. The whole guard —
the per-tab budget, the arming policy, the grace window — assumes the answer is yes. If it is
no, the design changes, probably to a badge and a manager prompt. Runbook in `docs/spikes.md`.

## What we could add, in the order I would do it

| Work | Size | Why |
|---|---|---|
| Answer R1 — load 0.0.6, make a note, close the tab | minutes | Decides whether the guard design survives |
| Apply an import plan | medium | Backup you cannot restore is not backup |
| Scheduled backup on an alarm | medium | Asked for; makes the trash safe to empty |
| Bundle the Persian faces (OFL, as bytes) | medium | Persian currently depends on the OS |
| Version history | medium | Undo is session-scoped; this is the one that survives a restart |
| Export to Markdown and HTML | medium | Makes notes readable outside the extension |
| AMO submission | large | The only route to a permanent install. `docs/PUBLISHING.md` has every step, the listing copy and the source-archive requirement |
| Sync across machines | large | Parked at your request; needs a server, changes the privacy story |
