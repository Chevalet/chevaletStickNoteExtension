# Status — v0.0.1, 4 September 2026

The first build that can be installed and used. **It has never been run in a real Firefox by
its author**, so every line below carries how it was actually verified:

- **Tested** — unit or integration tests cover it
- **Seen** — watched running in the browser harness (`tools/dev.ts`, port 8731)
- **Built** — compiles and lints; never exercised

336 tests · content script 27.1 kB gz of a 28.0 budget · `web-ext lint` 0 errors / 0 warnings
/ 0 notices · package 193 kB, 30 files.

## Works

| | Verified |
|---|---|
| Notes stick to document coordinates and scroll with the page | Seen |
| Notes scoped to the URL, restored on return (tracking params dropped, `http`≡`https`, `www.` stripped, params sorted) | Tested + Seen |
| IndexedDB store — clearing the cache does not touch it | Tested |
| Making a note: Alt + double-click, keyboard shortcut, context menu | Tested (messages) + Built (gestures) |
| Markdown incl. task lists, via a 3.1 kB own lexer; never touches `innerHTML` | Tested + Seen |
| RTL/LTR in both the editor and the rendered view; per-block under `auto`; code stays LTR | Seen |
| Freehand drawing, pen and eraser | Seen |
| Per-note styling: 8 palettes + custom colours, font, size, direction, alignment, torn edges, grain, tape, shadow, physics | Seen |
| Paper physics on drag — closed-form springs, compositor-only, 0% CPU at rest | Tested + Seen |
| Text-selection anchoring with a scored fallback chain | Tested |
| Manager: drawers per domain, search, multi-select, trash and restore | Seen |
| Full ZIP export (NDJSON + checksum + positions) | Tested |
| Per-tab on/off and per-site rules; tab identity survives session restore | Tested |
| Nothing injected until a site is granted — no `content_scripts` in the manifest | Tested |

## Half-built — the storage exists, the wire to the user does not

- **Pasted images.** `putAsset`/`getAsset` and canvas painting work in the harness, but
  `src/cs/renderer.ts` passes no `onAsset`/`resolveAsset` hook to `NoteView`. In the extension a
  pasted image is not saved and a stored one does not draw. ~12 lines.
- **Your global default style.** Per-note overrides work and "save as my default" exists in the
  panel, but `Settings` has no default-style field and the renderer is never told one — so
  overrides sit on the built-in default, not yours.
- **ZIP import.** Reads, validates the checksum, shows a dry-run merge plan. Does not write; the
  dialog says so.
- **Trash retention.** Settings exist and default to never destroying anything. Nothing purges on
  a schedule.

## Not built

- **Automatic backup to a file.** `backup.enabled`/`everyHours` in settings, `alarms` permission
  requested, no alarm ever created.
- **Version history.** `addRevision`/`shouldSnapshot` written, never called.
- **Bundled fonts.** System stacks only. Vazirmatn and Estedad are declared for Persian; the files
  are not in the repo.
- **Hold-a-key click-through** (`ghostModifier`), `motion`, `urlMatchDefault` — all in settings,
  all unread. The per-note `physics` control does work.
- **Duplicate Tab handling.** `resolveDuplicate` written, never called.
- **AMO signing and submission.** The build installs temporarily only.

### Fix before AMO

`alarms`, `webNavigation` and `downloads` are requested and never used. Reviewers flag exactly
this. Either use them or drop them.

## The one open question — spike R1

**Does a content script's `beforeunload` actually prompt on tab close?** The close warning
depends entirely on it, and it has never been checked against a real Firefox. Firefox decides
whether to show the dialog, and a page with no user interaction may get none. The whole guard —
the per-tab budget, the arming policy, the grace window — assumes the answer is yes. If it is
no, the design changes, probably to a badge and a manager prompt. Runbook in `docs/spikes.md`.

## What we could add, in the order I would do it

| Work | Size | Why |
|---|---|---|
| Answer R1 — load 0.0.1, make a note, close the tab | minutes | Decides whether the guard design survives |
| Wire images and the default style | small | Two original requirements, one hook away |
| Drop or use the three permissions | small | First thing a reviewer asks |
| Apply an import plan | medium | Backup you cannot restore is not backup |
| Scheduled backup on an alarm | medium | Asked for; makes the trash safe to empty |
| Bundle the Persian faces (OFL, as bytes) | medium | Persian currently depends on the OS |
| Version history | medium | The only real undo for overwritten text |
| Export to Markdown and HTML | medium | Makes notes readable outside the extension |
| AMO submission | large | The only route to a permanent install |
| Sync across machines | large | Parked at your request; needs a server, changes the privacy story |
