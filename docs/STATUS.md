# Status — v0.0.10, 5 September 2026

**Every shortcut works on every keyboard layout.** That is what this release is. Three
simultaneous reports — `S` did not open a note's settings, `Ctrl+Z` did nothing, and the
Ctrl+B family did not exist — turned out to be one line: every letter shortcut was matched
against `KeyboardEvent.key`, which is *the character the active layout produces*. On a Persian
keyboard the physical S key reports a Persian letter, so `S`, `C`, `D`, `L`, `M`, `P`, `E`,
`Ctrl+Z` and `Ctrl+Y` all silently did nothing — while Backspace, Delete, Escape and the arrows
carried on working, because their `key` values do not depend on the layout. That lopsided
pattern was the whole clue. See `src/cs/note/keys.ts`.

Measured, not deduced: `spikes/firefox-keys.mjs` runs 45 checks in a real Firefox, control
first, including a layout matrix across Persian, Arabic, Cyrillic and Greek — and a Dvorak
counter-case, because matching on physical position *alone* would have broken Dvorak, where the
key that prints "z" is somewhere else entirely.

**There is a real-Firefox harness** (`spikes/firefox-*.mjs`, geckodriver) and now a cabinet
harness (`spikes/cabinet/`), so the labels below mean what they say:

- **Tested** — unit or integration tests cover it
- **Seen** — watched running in a browser (`tools/dev.ts`, port 8731)
- **Built** — compiles and lints; never exercised
- **Firefox** — driven in a real Firefox through geckodriver, with real key events

490 tests · content script 31.9 kB gz of a 34.0 budget · `web-ext lint` 0 errors / 0 warnings
/ 0 notices.

## Where it stands with the store

**0.0.8 is submitted to addons.mozilla.org and awaiting review.** A source archive went with it,
which means a human reviewer rather than the automated path, so days rather than hours. The
listing is not public until that clears.

0.0.9 was signed through AMO's *unlisted* channel (`pnpm sign`), which is automatic and takes
minutes, so there is a permanently installable `.xpi` to hand people while the listing waits.
`xpinstall.signatures.required=false` is not an alternative: Release and Beta builds ignore it.

0.0.10 is the first release in which every control in the settings is traceable to code that
reads it. Four were not. They are gone, or now real.

## Works

| | Verified |
|---|---|
| Notes stick to document coordinates and scroll with the page | Seen |
| Notes scoped to the URL, restored on return (tracking params dropped, `http`≡`https`, `www.` stripped, params sorted) | Tested + Seen |
| IndexedDB store — clearing the cache does not touch it | Tested |
| Making a note: Alt + double-click, keyboard shortcut, context menu | Tested (messages) + Built (gestures) |
| Markdown incl. task lists, via a 3.2 kB own lexer; never touches `innerHTML` | Tested + Seen |
| Typing, Backspace and Delete inside a note | **Firefox** |
| **Every shortcut on every keyboard layout** — physical-key matching, with a Latin layout still winning where it has an opinion | Tested + **Firefox** |
| **Formatting in a note's text** — bold, italic, strikethrough, code, links, quotes, bullet/numbered/task lists, headings, insert-date, clear-formatting. Each is a single undo step | Tested + **Firefox** |
| **A settings button in every note's header** — `S` used to be the only way in, which was no way in at all on a non-Latin keyboard | **Firefox** |
| RTL/LTR in both the editor and the rendered view; per-block under `auto`; code stays LTR | Seen |
| Freehand drawing, pen and eraser — **and drawings now survive a reload**, which they did not before 0.0.10 | Seen |
| Per-note styling: 8 palettes + custom colours, font, size, line height, direction, alignment, torn edges, grain, tape, shadow, physics | Seen |
| Paper physics on drag — closed-form springs, compositor-only, 0% CPU at rest | Tested + Seen |
| Text-selection anchoring with a scored fallback chain | Tested |
| Manager: drawers per domain, search, multi-select, trash and restore | Seen |
| Full ZIP export (NDJSON + checksum + positions) | Tested |
| Per-tab on/off and per-site rules; tab identity survives session restore | Tested |
| Nothing injected until a site is granted — no `content_scripts` in the manifest | Tested |
| Undo and redo (`Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`) across typing, formatting, colour, style, move, resize, collapse, lock, drawing, erasing, create and delete — one ordered history for the whole page, and the caret now goes back where it actually was | Tested + **Firefox** |
| Update check — a button in settings, and an opt-in daily check. Off by default; it is the only network request the extension can make | Tested |
| Pasted and dropped images, stored per note and painted to a canvas so no page CSP can block them | Tested |
| Your own default note style, applied live to every note in the fields it never set itself | Tested |
| All settings inside the cabinet, in the cabinet's own idiom: manila section tabs, ruled paper, paper switches, palette swatches, hand-drawn sliders | Seen |
| **A dark theme** across the cabinet, the popup and the options page — three states (follow the browser / dark / light) from one shared palette in `ui/chrome-theme.ts`, with the switch at the foot of the cabinet | Seen |
| **A keyboard reference that reads the browser's own bindings** through `commands.getAll()`, so it cannot disagree with what you set in `about:addons` | Seen |
| **The retention sweep** — "keep trashed notes for N days" is enforced by an alarm four times a day, and refuses to destroy a note it cannot date | Tested |
| One logo at every size, rasterised from the single SVG by `spikes/make-icons.mjs` | Seen |

## Fixed in 0.0.10

Everything here was reported, or found while looking for what was reported.

- **Every letter shortcut, on every non-Latin keyboard layout.** The one cause behind three
  separate reports. `src/cs/note/keys.ts`.
- **The settings pane in the cabinet was a trap.** Clicking any other item did not leave it,
  because one field held both "which screen" and "how the notes are laid out" — so a drawer
  click changed the drawer *underneath* the settings pane. Two fields now.
- **Drawings were lost on reload.** The background had always sent `ink` on the wire; the field
  was missing from `NoteWire` and from `mountNote`, so it arrived and was dropped one line short
  of the screen.
- **The Movement setting was read by nothing at all.** It is now a ceiling on every note's
  physics, live in every open tab.
- **Cabinet settings never reached open tabs.** The pane writes straight to storage and only the
  note panel's own "save as my default" ever broadcast, so the entire pane was inert in any tab
  that was already open. Broadcast from `storage.onChanged` now.
- **Two sliders showed the wrong numbers and could write values a note could not use.** Torn
  edges and grain were whole-number 0–3 boxes for fields whose real ranges are 0–6 and 0–0.6, so
  the pane displayed 1 where the actual defaults are 2.4 and 0.16.
- **Undo restored the caret to the end of the text, always.** `ShadowRoot.getSelection()` does
  not exist in Firefox; the code called it with an optional chain, got `undefined`, and took its
  fallback path every single time. `src/cs/note/selection.ts`.
- **Three controls that changed nothing are gone** — "keep notes whose page vanished for N
  days" (nothing marks a note detached), "revisions kept per note" (`addRevision` has no
  callers), and the scheduled-backup switch and interval (no alarm runs them, and the permission
  they would need is deliberately not declared).
- **A ghost button was acid yellow on cream paper**, roughly 1.3:1, wherever it sat on the page
  rather than on the dark chrome — "Clear", "Restore", "Move to trash". Found by looking at the
  page. No test would have mentioned it, and the first fix moved the bug to the Trash button
  instead of fixing it.
- **The popup printed the same sentence twice** whenever the close guard was armed.
- **The README claimed scheduled ZIP backups.** It does not have them. That paragraph is the
  reason to re-read the docs before copying them into a store listing — which is exactly what
  went wrong once already.

## Half-built — the storage exists, the wire to the user does not

- **ZIP import.** Reads, validates the checksum, shows a dry-run merge plan. Does not write, and
  the dialog says so.

## Not built

- **Automatic backup to a file.** `backup.enabled`/`everyHours` stay in `Settings` for the day
  it lands; the controls are gone until then, and the `downloads` permission with them.
- **Version history.** `addRevision`/`shouldSnapshot` written, never called.
- **Bundled fonts.** System stacks only. Vazirmatn and Estedad are declared for Persian; the
  files are not in the repo.
- **Hold-a-key click-through** (`ghostModifier`) and `urlMatchDefault` — in `Settings`, unread,
  and offered nowhere in the UI.
- **Duplicate Tab handling.** `resolveDuplicate` written, never called.
- **Persian in the cabinet and inside a note.** The Language setting covers the popup and the
  options page; the cabinet's strings and a note's own placeholders are English only. The
  setting now says so rather than implying otherwise.
- **Firefox for Android.** Declared in the manifest (`strict_min_version_android`) and never
  tested. The interface is pointer-and-keyboard shaped — Alt+double-click, single-key shortcuts,
  hover states, drag versus scroll — so it is a release of its own, not a checkbox.

## The one open question — spike R1

**Does a content script's `beforeunload` actually prompt on tab close?** The close warning
depends entirely on it, and it has still never been checked against a real Firefox. The whole
guard — the per-tab budget, the arming policy, the grace window — assumes the answer is yes. If
it is no, the design changes, probably to a badge and a manager prompt.

It cannot be automated. `spikes/firefox-r1.mjs` tries, and its control correctly reports the
harness useless, because WebDriver's Close Window command does not run unload prompts at all.
It needs thirty seconds of a human; the runbook is in `docs/spikes.md`.

## What we could add, in the order I would do it

| Work | Size | Why |
|---|---|---|
| Answer R1 — make a note, type, press Ctrl+W, then repeat with a hand-armed `beforeunload` as a control | minutes | Decides whether the guard design survives. `docs/spikes.md` has the procedure; it cannot be automated |
| Apply an import plan | medium | Backup you cannot restore is not backup, and it is the last half-built thing left |
| Version history | medium | Undo is session-scoped; this is the one that survives a restart. It is also what would make "revisions kept per note" a real setting again |
| Scheduled backup on an alarm | medium | Makes the trash safe to empty. Brings the `downloads` permission back, so the reviewer note needs updating with it |
| Bundle the Persian faces (OFL, as bytes) | medium | Persian currently depends on whatever the operating system happens to have |
| Translate the cabinet and the note strings | medium | The Language setting is honest about not covering them, which is not the same as covering them |
| Export to Markdown and HTML | medium | Makes notes readable outside the extension |
| Firefox for Android | large | Every gesture needs rethinking for touch, not just a manifest key |
| Sync across machines | large | Parked at your request; needs a server, and changes the privacy story from "nothing leaves your machine" into something that needs explaining |
