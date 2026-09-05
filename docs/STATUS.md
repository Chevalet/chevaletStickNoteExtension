# Status — v0.0.11, 5 September 2026

**Notes were not being saved as you typed them.** That is the release. `NoteView` told its host
about a text change when a task box was ticked, when an image was attached, on undo, and from
every formatting shortcut — and never from typing. So a note you wrote and reloaded came back
empty, and the only way to save your words was to press Ctrl+B while writing them.

It shipped four times because of how it was being checked. `spikes/playground` reached into the
note's shadow root and added its own `input` listener that saved on every keystroke, so the one
tool used to answer *"do notes survive a reload?"* was answering about behaviour the extension
did not have. Every manual check passed. There were no tests for that class at all.

The rule that came out of it, now written where it happened: **a harness may stub what it
cannot have and must never add behaviour the product lacks.** If the playground needs a line to
work, the product needs it more.

## Instruments, because three of the last five bugs were found by looking

| | What it answers |
|---|---|
| `tests/` — 679 checks | Everything that reduces to a number |
| `spikes/firefox-extension.mjs` | **The real extension, over a real page.** Nine checks. `pnpm build:test` writes `dist-test/` — the shipped build plus one manifest line, so a driver has host access without a click in browser chrome |
| `spikes/firefox-persist.mjs` | Type, reload, is it there? Restore the bug and it prints NO |
| `spikes/firefox-fonts.mjs` | Can a note get a bundled face on a page whose CSP forbids fonts |
| `spikes/firefox-keys.mjs` | 45 checks across four keyboard layouts |
| `spikes/shots.mjs` | 40 photographs of every pane in both themes, in one command |
| `tests/theme.test.ts` | Contrast of every text-on-surface pair, both themes |
| `tests/css-literals.test.ts` | A backtick in a CSS comment, which has ended one of those strings early four times |

The labels below mean what they say:

- **Tested** — unit or integration tests cover it
- **Seen** — watched running in a browser (`tools/dev.ts`, port 8731)
- **Built** — compiles and lints; never exercised
- **Firefox** — driven in a real Firefox through geckodriver, with real events

679 tests · content script 33.7 kB gz of a 36.0 budget · fonts 263 kB · `web-ext lint` 0 errors
/ 0 warnings / 0 notices.

## Where it stands with the store

**0.0.8 is submitted to addons.mozilla.org and awaiting review.** A source archive went with it,
so a human reviewer rather than the automated path. The listing is not public until that clears.

0.0.9 and 0.0.10 were signed through AMO's *unlisted* channel (`pnpm sign`), which is automatic
and takes minutes, so there is a permanently installable `.xpi` while the listing waits.

**`web_accessible_resources` is now empty**, and the key is gone from the manifest. An
`assets/fonts` entry open to every URL had been there since the first plan, with a comment
claiming the fetch needed it. It did not: the background reads its own packaged file and hands
the bytes over. Measured with the entry absent — the faces still load, on an ordinary page and
on one serving `font-src 'none'`. So it protected nothing and exposed something.

## Works

| | Verified |
|---|---|
| Notes stick to document coordinates and scroll with the page | Seen |
| Notes scoped to the URL, restored on return (tracking params dropped, `http`≡`https`, `www.` stripped, params sorted) | Tested + **Firefox** |
| **A note stays on the page it was made on when a single-page app changes route** — a `pushState` unloads no document, so nothing used to tell the content script the page had changed | Tested + **Firefox** |
| **Typing is saved** | Tested + **Firefox** |
| IndexedDB store — clearing the cache does not touch it | Tested |
| Making a note: Alt + double-click, keyboard shortcut, context menu | **Firefox** (gesture) + Tested (messages) |
| Markdown incl. task lists, via a 3.2 kB own lexer; never parses HTML | Tested + Seen |
| **Every shortcut on every keyboard layout** — physical-key matching, with a Latin layout still winning where it has an opinion | Tested + **Firefox** |
| **Formatting in a note's text** — bold, italic, strikethrough, code, links, quotes, bullet/numbered/task lists, headings, insert-date, clear-formatting. Each is a single undo step | Tested + **Firefox** |
| **A name of its own for a note**, separate from its text, shown in the note's header and in the cabinet, searchable, and a heading in both exports | Tested + **Firefox** |
| RTL/LTR in both the editor and the rendered view; per-block under `auto`; code stays LTR | Seen |
| Freehand drawing, pen and eraser, surviving a reload | Seen |
| Per-note styling: 8 palettes + custom colours, font, size, line height, direction, alignment, torn edges, grain, tape, shadow, physics | Seen |
| **Six bundled typefaces**, 263 kB, loaded only when a note uses one and only once per page — including two Persian faces at two weights, so Persian does not depend on the operating system | Tested + **Firefox** |
| Paper physics on drag — closed-form springs, compositor-only, 0% CPU at rest | Tested + Seen |
| Text-selection anchoring with a scored fallback chain | Tested |
| Manager: drawers per domain, search, multi-select, trash and restore | Seen |
| **Export** — one dialog, three formats: the ZIP archive that comes back, a Markdown file, and a self-contained HTML page that fetches nothing | Tested + Seen |
| **Import that writes.** Reads, checks the checksum, shows a plan, and applies it. Index columns recomputed, `rev` advanced past any in-flight patch, missing images reported, and every overwrite keeps the old text as a revision | Tested |
| **Version history** — the only undo that survives closing the tab. Kept on an edit worth keeping, pruned to the number you choose, restorable from the cabinet, and restoring is itself undoable | Tested |
| **Scheduled backup** — an alarm, a ZIP in Downloads, a ring of three filenames. The `downloads` permission is optional and requested from the switch | Tested |
| Per-tab on/off and per-site rules; tab identity survives session restore | Tested |
| Nothing injected until a site is granted — no `content_scripts` in the manifest | Tested + **Firefox** |
| Undo and redo across typing, formatting, colour, style, move, resize, collapse, lock, drawing, erasing, create and delete — one ordered history for the page, caret restored where it was | Tested + **Firefox** |
| Update check — a button, and an opt-in daily check. Off by default; the only network request the extension can make | Tested |
| Pasted and dropped images, stored per note and painted to a canvas so no page CSP can block them | Tested |
| Your own default note style, applied live to every note in the fields it never set itself | Tested |
| All settings inside the cabinet, in the cabinet's own idiom | Seen |
| **A dark theme** across the cabinet, the popup and the options page — three states from one shared palette, with contrast asserted by test | Tested + Seen |
| A keyboard reference that reads the browser's own bindings through `commands.getAll()` | Seen |
| The retention sweep — enforced by an alarm four times a day, and it refuses to destroy a note it cannot date | Tested |

## Fixed in 0.0.11

- **Typing was never saved.** See the top of this file.
- **A note followed a single-page app from one route to another.** `onTabUpdated` dropped the
  event — it returned early unless `status === 'complete'`, and an in-page route change reports
  no status at all. `scope/recheck` now reaches the tab, and the renderer re-resolves through
  the same path `boot` uses. Pending edits are flushed first, because notes that no longer
  belong are about to be destroyed.
- **The dark theme was too dark, twice.** The first graphite ramp started at #1c1a17, which is
  a colour by the numbers and reads as black on a screen. The floor is #2e2b28 now, about two
  and a half times the light, with the keylines and raised surfaces lifted to match — and the
  contrast test caught `--dim` landing four thousandths under AA on the way.
- **The light theme's menu was darker than the dark theme's menu.** Said out loud, absurd. The
  carcass is kraft board with ink on it in the light theme now; the masthead is the one surface
  that stays dark in both, because a masthead is a nameplate.
- **Every per-domain note count in the cabinet was clipped off the right-hand edge**, with a
  horizontal scrollbar across the menu. `all: unset` takes `box-sizing` back to `content-box`,
  so every drawer was 22px wider than the carcass holding it.
- **A key cap in the shortcut reference was a 176px yellow slab holding the letter S.**
- **A hidden row still drew a rule across the settings sheet.** `display: grid` beats the
  `hidden` attribute; all three pages now say `[hidden] { display: none !important }`.
- **A select on the options page looked exactly like a text field** — `all: unset` strips the
  native arrow — and its number field drew Firefox's own light spin box on the dark page.
- **`web_accessible_resources` exposed the fonts to every page for no reason.** Deleted.
- Dead weight, after a line-by-line pass: four `Settings` fields nothing read, `ghostModifier`
  and the `toggle-ghost` command name, a `scope/apply` message with no sender, three unused
  exports and two speculative ones written the same afternoon for callers that did not exist.
- `lastImport` is read now, by the Backup section, rather than written and never looked at.

## Not built

- **Persian in the cabinet and inside a note.** The Language setting covers the popup and the
  options page; the cabinet's own strings and a note's placeholders are English. The setting
  says so rather than implying otherwise.
- **Tab-scoped notes are unreachable.** `Scope` has a `tab` kind and `notesForContext` looks it
  up on every page load, but `createFor` takes the scope from the sender's URL and
  `defaultScopeFor` never returns a tab scope. `resolveDuplicate` guards a collision that
  therefore cannot happen, and says so above itself.
- **Live edits between the cabinet and a page.** Renaming and restoring a version reach an open
  tab; editing a note's text in the cabinet is not possible at all yet.
- **Firefox for Android.** Declared in the manifest (`strict_min_version_android`) and never
  tested. The interface is pointer-and-keyboard shaped, so it is a release of its own.
- **Sync across machines.** Parked deliberately: no server, no account, nothing leaves the
  machine.

## The one open question — spike R1

**Does a content script's `beforeunload` actually prompt on tab close?** The close warning
depends on it entirely, and it has still never been checked against a real Firefox.

It cannot be automated, and that is now measured rather than assumed. `firefox-r1.mjs` closes
the tab; `firefox-unload.mjs` navigates instead. Between them they rule out four triggers and
two prefs — including reading the profile back to prove `dom.disable_beforeunload=false` really
landed, and removing the sticky-activation gate entirely. The positive control never fires:
under Marionette the tab-modal unload prompt is not opened at all. Both files keep their
controls and say so.

It needs thirty seconds of a human. `docs/spikes.md` has the runbook.
