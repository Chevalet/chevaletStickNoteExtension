# Chevalet Note

Sticky notes that stay stuck to **the page**, not to your browser.

Put a note anywhere on any web page. It stays at that exact spot in the document — scroll, and
it scrolls with the content like part of the site. Close the tab, close the browser, come back
next week and open the same URL: the note is still there, in the same place.

Firefox extension. Offline, private, and yours to export.

> **Status: 0.0.12, awaiting review on addons.mozilla.org.** A signed build is installable
> now from the [releases page](https://github.com/Chevalet/chevaletStickNoteExtension/releases);
> once the listing clears review, Firefox will update it for you on its own. The de-risking
> spikes are still runnable — see [`docs/spikes.md`](docs/spikes.md).

---

## What makes it different

**It barely touches the page.** One element is added to `<body>`, with a closed shadow root and
`all: initial`. Every pixel not covered by a note hit-tests straight through, so the site stays
completely usable. There are no document-level `pointermove`/`keydown`/`click` listeners, no
whole-document `MutationObserver`, and no timers running when nothing is animating — an idle
tab with notes on it costs **0% CPU**.

That element used to be appended to `<html>`, on the reasoning that a child of the root is the
hardest place for a page to disturb. It cost three releases: Gecko will not run an editing
command for an editing host outside `<body>`, so Backspace inside a note did nothing while
typing worked perfectly. `spikes/firefox-where.mjs` proves it in a real Firefox, and
`tests/host.test.ts` makes sure it cannot come back.

**Assets are bytes, never URLs.** Fonts go in through `new FontFace(arrayBuffer)`, styles
through `adoptedStyleSheets`, images through `createImageBitmap` into a canvas. The page's
Content-Security-Policy has nothing to block, because the in-page layer makes no network
request of any kind — and it is the only technique that can render a font *you* uploaded, or a
picture you pasted, on a site with a strict `img-src`.

**Notes are anchored, not just positioned.** Every note records three things when you drop it:
the element under the cursor, a text quote with its surrounding context (W3C Web Annotation
selectors), and document coordinates. On reload they are resolved through a scored fallback
chain, so a note survives responsive reflow, dynamic content and SPA routing instead of ending
up 40,000px down an empty page. When an anchor genuinely cannot be found, the note says so and
offers to reattach — it is never silently misplaced and never deleted.

**Your notes are not in the cache.** They live in the extension's own IndexedDB, which
"Clear cookies and site data" does not touch, and `unlimitedStorage` keeps exempt from
eviction. The two things that *would* lose them are Refresh Firefox and uninstalling the
extension, and the answer to both is **Export ZIP** in the cabinet, which needs no permission
at all and writes every note, its position, its style and its images to one archive.

There is **no scheduled backup**, and an earlier version of this paragraph said there was —
"are covered by scheduled ZIP backups", for a feature that does not exist. Exporting is
something you have to do. The README of a notes app should be honest about this, so:
[see the durability table](#durability).

**It feels like paper.** Dragging a note runs a critically-damped spring on position and
underdamped springs on rotation, tilt, skew and corner curl, driven by pointer velocity and by
where on the note you grabbed it. Only `transform` and `opacity` ever change per frame; the
release settle is baked into a Web Animations keyframe list so it runs on the compositor and
stays smooth even when the page's own JavaScript is blocking.

---

## Keyboard

Every shortcut is matched on the **physical key**, so they work on any keyboard layout. Until
0.0.10 they were matched on the character the layout produces, which meant that on a Persian,
Arabic, Cyrillic or Greek layout none of the letter shortcuts worked at all — while Backspace,
Delete and the arrows did, because those do not depend on the layout. A Latin layout still
wins where it has an opinion, so Dvorak behaves the way a Dvorak user expects.

**Anywhere in Firefox** — rebindable in `about:addons` → the gear → Manage Extension Shortcuts.
The Keys pane in the cabinet reads the *current* binding from the browser, so it never
disagrees with what you set.

| | |
|---|---|
| `Alt+Shift+A` | Stick a note in the middle of the page |
| `Alt+Shift+S` | Turn notes off, or back on, for this tab |
| `Alt+Shift+K` | Move focus to the next note |
| unbound | Open the cabinet |

**On a page** — `Alt`+double-click makes a note where you clicked. Right-click offers to add
one, or to quote the text you have selected.

**On a selected note** — grabbing the header, or the sliders button in it, selects the note.

| | |
|---|---|
| `S` | This note's settings: colour, type, size, direction, paper |
| `C` `D` `P` `E` | Next colour · draw · pen · eraser |
| `Z` | Undo the last brush stroke |
| `L` `M` | Lock · collapse |
| `Enter` / `F2` | Start writing |
| `Delete` | Send it to the trash |
| arrows | Nudge — `Shift` ×10, `Ctrl` ×25. `Alt`+arrows resizes |

**While writing** — the body of a note is markdown source, so `Ctrl+B` wraps the selection in
`**` rather than styling it. Pressing it again unwraps. Every keystroke is saved; you do not
have to click away first.

| | |
|---|---|
| `Ctrl+B` `Ctrl+I` | Bold · italic |
| `Ctrl+Shift+X` `Ctrl+E` | Strikethrough · code |
| `Ctrl+K` | Make a link |
| `Ctrl+Shift+.` | Quote |
| `Ctrl+Shift+8` `7` `9` | Bullet · numbered · task list |
| `Ctrl+Shift+Enter` | Tick or untick this line's checkbox |
| `Ctrl+Shift+1` | Heading — again for smaller, again for none |
| `Ctrl+Shift+D` | Insert today's date |
| `Ctrl+Space` | Clear formatting |
| `Ctrl+Enter` | Finish writing and select the note |

There is deliberately no `Ctrl+U`: markdown has no underline, so there is nothing for it to
produce that a note could render. `Ctrl+Shift+M` and `Ctrl+Shift+K` are left alone because
Firefox owns them.

**Anywhere in a note** — `Ctrl+Z` and `Ctrl+Y` undo and redo *everything*, in the order you did
it: typing, colour, moving, resizing, drawing, deleting. One stack for the whole page, so undo
does not depend on finding the right note first.

---

## Durability

| Action | Your notes |
|---|---|
| Clear cache / cookies / site data | **survive** — the sanitizer excludes `moz-extension://` |
| Forget About This Site | **survive** |
| Disk pressure / quota eviction | **survive** — `unlimitedStorage` |
| Refresh Firefox | lost — restore from a ZIP backup |
| Uninstall the extension | lost — restore from a ZIP backup |

Manual export and import is always available, needs no permission, and produces a single ZIP
containing every note, its position and anchor, its images and ink, plus a human-readable
Markdown mirror.

## Privacy

No telemetry. No analytics. No accounts. No sync. Nothing about you leaves your machine, which
is why the manifest declares `data_collection_permissions: { required: ["none"] }`.

There is exactly one network call in the shipped code, and it is worth being precise about
rather than rounding down to zero: an **optional** check for a new release, off by default,
which asks for its own host permission the first time you press the button and then reads one
public version number with no cookies, no referrer and no identifier. Leave it off and the
extension makes no network request whatsoever. `PRIVACY.md` has the full account.

Host permissions are **not** requested at install. You grant access per site, per domain, or
for all sites, from a button in the popup, whenever you decide to.

---

## Development

Requires Node 24+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

`pnpm dev` builds and launches a scratch Firefox profile with the extension loaded.

| Command | What it does |
|---|---|
| `pnpm build` | Production build into `dist/` |
| `pnpm watch` | Incremental rebuild |
| `pnpm typecheck` | `tsc --noEmit`, strict |
| `pnpm lint` | Biome check |
| `pnpm test` | Vitest unit tests |
| `pnpm lint:ext` | `web-ext lint` — AMO's own validator |
| `pnpm check` | All of the above, the CI gate |
| `pnpm package` | Zips an installable build into `artifacts/` |

The build is a plain, readable [`build.ts`](build.ts) rather than a framework, deliberately:
AMO reviewers must be able to reproduce `dist/` byte-for-byte from source. It is fully
deterministic — no timestamps, no randomness, no network. Even the randomised shadow-host tag
name is derived from `name@version` by SHA-256 so it is stable across machines.

Bundle budgets are enforced by the build and will fail it:

| Bundle | Budget | Why |
|---|---|---|
| `cs/guard.js` | 1 kB gz | runs at `document_start` on every annotated page |
| `cs/renderer.js` | 32 kB gz | parsed on every page load that has notes |
| background | 80 kB min | an event page parses its whole bundle on **every wake** |

### Layout

```
src/bg/     background event page — the only writer to the database
   scope/   URL normalization and scope matching (pure, heavily tested)
   msg/     the typed protocol shared by all four contexts
src/cs/     the in-page layer — host, anchoring, physics, note UI
src/ui/     popup, options, and the note manager
spikes/     throwaway harnesses that answer design questions against a real Firefox
docs/       spike runbook, performance numbers, QA checklist
```

## License

[MPL-2.0](LICENSE)
