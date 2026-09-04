# AMO listing text — paste-ready

Every field the submission form asks for, written out. Copy from here; do not compose in the
form. `docs/PUBLISHING.md` has the process around it.

---

## Name

```
Chevalet Note
```

## Summary (250 characters max — this one is 172)

```
Sticky notes that stay stuck to the page, not to your browser. They scroll with the content, come back when you revisit the URL, and never leave your machine.
```

## Description

Paste everything between the rules. AMO accepts a small amount of HTML in this field; plain
text with blank lines works and renders fine.

---

Chevalet Note puts a sticky note anywhere on any web page — and leaves it there.

A note is fixed to the page's own coordinates, so it scrolls with the content it belongs to
rather than floating over your viewport. Come back to that URL tomorrow, next week, or after a
browser restart, and the note is where you left it.

**Everything stays on your machine.** Notes live in the extension's own database. There is no
account, no sync, no server, and no analytics. Clearing your browser cache does not touch them.
The only network request the extension is capable of making is an optional check for a new
version, which is off unless you turn it on and asks your permission the first time.

**Nothing is injected until you say so.** No site gets so much as a byte of this extension
until you click the toolbar button and grant it. That is why installing asks for no website
access at all.

WHAT A NOTE CAN HOLD

• Markdown — headings, bold, lists, quotes, code, links, and task lists you can tick
• Images, pasted or dragged straight in
• Freehand drawing, with a pen and an eraser
• Right-to-left and left-to-right text, deciding per paragraph, so Persian and English can
  share one note

MAKING IT YOURS

• Eight palettes, or any colour you like
• Torn edges, paper grain, tape, shadow — or a clean rectangle if you prefer
• Set any note's look, then save it as the default for every note after it
• Notes behave like paper when you drag them: they tilt, they lag, they swing from the corner
  you grabbed

FINDING THINGS AGAIN

• A cabinet with a drawer per site, full-text search, and multi-select
• A trash you can restore from
• Export everything as one ZIP — every note, its position, its style, its images — and keep it
  wherever you like

KEEPING OUT OF THE WAY

• Undo and redo across everything: typing, colour, moving, resizing, drawing, deleting
• Turn notes off for one tab or one site
• Zero processor use when nothing is happening

Free, open source, MPL-2.0. Source and the reasoning behind every decision:
https://github.com/Chevalet/chevaletStickNoteExtension

---

## Categories — tick two

AMO's list for Firefox extensions has **no "Productivity"**, which an earlier draft of this
file wrongly assumed. The real options are: Alerts & Updates, Appearance, Bookmarks, Download
Management, Feeds News & Blogging, Games & Entertainment, Language Support, Photos Music &
Videos, Privacy & Security, Search Tools, Shopping, Social & Communication, Tabs, Web
Development.

Nothing fits exactly. The two closest, and the honest picks:

- **Bookmarks** — saving and organising things about pages is what this is adjacent to
- **Appearance** — it does put visible things onto pages

Three are allowed; two is better than padding with a third that does not fit. Do **not** tick
"Privacy & Security": storing notes locally is not a privacy tool, and claiming that category
invites a reviewer to hold the add-on to a standard it is not trying to meet.

## Tags — tick `privacy`, and nothing else

**Tags are a fixed checkbox list, not free text.** An earlier draft of this file listed
`notes`, `annotation`, `sticky notes`, `markdown` and `offline`, none of which exist on the
form. That was the second time this file assumed a field instead of checking it, after the
Productivity category. The list AMO actually offers:

> ad blocker · anti malware · anti tracker · antivirus · chat · container · content blocker ·
> coupon · dailymotion · dark mode · dndbeyond · download · facebook · google · image search ·
> mp3 · music · password manager · pinterest · pixiv · privacy · reddit · roblox · scholar ·
> search · security · shopping · social media · streaming · torrent · translate · twitch ·
> twitter · user scripts · video converter · video downloader · vpn · wayback machine ·
> whatsapp · word counter · youtube · zoom

It is built around the genres extensions usually fall into, and sticky notes is not one of
them. Ten are allowed and **one is the honest answer**:

- ☑ **privacy** — defensible, and not padding. Someone filtering by this tag because they want
  extensions that do not phone home is genuinely well served by finding this one: no account,
  no sync, no server, no analytics, and one optional network call that is off by default.

Everything else would be worse than nothing. `dark mode` means a page-darkening extension, not
a dark palette. `scholar` is about Google Scholar. `security`, `search` and `container` all
describe tools this is not. A wrong tag puts the add-on in front of people looking for
something else, who then do not install it or install it and rate it badly — and to a reviewer
a list of loosely-related tags reads as stuffing.

Leaving the other nine boxes empty is the right answer, not a gap.

## Support

- **Support site:** `https://github.com/Chevalet/chevaletStickNoteExtension/issues`
- **Support email:** the one you want strangers to have. Consider a dedicated address rather
  than your personal one; it goes on a public page.

## Licence

`Mozilla Public License 2.0` — matches `LICENSE` in the repository.

## Privacy policy

Paste the contents of `PRIVACY.md`. Do not soften it. It is accurate and it is the strongest
thing in this listing.

## Data collection form

Answer **no** to every category. The manifest already declares
`data_collection_permissions: { required: ['none'] }`, and this form has to agree with it.

## Version notes for 0.0.10

```
Every keyboard shortcut now works on every keyboard layout.

They were matched on the character the active layout produces, so on a Persian, Arabic,
Cyrillic or Greek keyboard none of the letter shortcuts worked at all -- S for a note's
settings, C for colour, D to draw, and Ctrl+Z / Ctrl+Y for undo -- while Backspace, Delete
and the arrows kept working, because those do not depend on the layout. They are matched on
the physical key now, with the layout's own character still winning where it is a Latin
letter, so Dvorak behaves the way a Dvorak user expects.

New in a note's text: Ctrl+B, Ctrl+I, Ctrl+Shift+X, Ctrl+E, Ctrl+K, quotes, bullet, numbered
and task lists, headings, insert-date, and clear-formatting. Each is one undo step.

New in the cabinet: a dark theme, covering the cabinet, the popup and the options page, with
the switch at the foot of the cabinet. And a settings button in each note's header -- the S
key used to be the only way in, which was no way in at all on a non-Latin keyboard.

Fixed: opening the settings in the cabinet trapped you there, because clicking any other item
did not leave it. Drawings were lost on reload. The Movement setting was read by nothing. Two
settings sliders showed the wrong values and could write values a note could not use. Three
more controls that changed nothing have been removed. Undo now restores the caret where it
actually was.
```

## Version notes for 0.0.8

```
First public release.

Sticky notes attached to a page's own coordinates, stored locally in the extension's own
database. Markdown, pasted images, freehand drawing, RTL and LTR per paragraph, eight
palettes with a savable default, undo and redo across everything, a cabinet with per-site
drawers and full-text search, and complete ZIP export.

No account, no sync, no server, no analytics. No website access is requested at install;
nothing is injected into a page until you grant that site from the toolbar button.
```

## Notes to reviewer

```
No account or login is needed. Everything works offline.

The build is minified, so the full source is attached. SOURCE.md has the toolchain and the two
commands, and the output is reproducible byte-for-byte: no timestamps, no network access during
the build, and the randomised shadow-host element name is derived from name@version by SHA-256
rather than generated.

There are no static content_scripts. Scripts are registered at run time via
scripting.registerContentScripts, only for origins the user has explicitly granted, which is
why the install prompt requests no host permissions. src/bg/inject.ts explains the reasoning.

Notes are stored in the extension's own IndexedDB. Nothing is uploaded anywhere. The single
network call in the codebase is an opt-in update check against the GitHub releases API
(src/bg/jobs/update.ts). It is off by default, gated behind an optional host permission that is
requested from a user click, and sends no credentials and no referrer. A hostile response
cannot redirect the download: the link shown is always the releases page, never a URL from the
response body.

Note content is rendered by a small markdown lexer (src/cs/note/md-lex.ts) and built into DOM
with createElement and textContent. innerHTML is never assigned anywhere in the codebase, so
there is no HTML sanitiser to audit.

Every permission declared is used: storage and unlimitedStorage for the note database, sessions
for per-tab identity that survives session restore, tabs and scripting for the per-origin
registration above, menus for the "Add a note here" context menu, alarms for the opt-in daily
update check, and activeTab so the toolbar button works before any host permission is granted.
optional_permissions is empty.
```

## Screenshots

Four, in this order. 1280×800 or larger; AMO crops to a 3:2-ish thumbnail, so keep the subject
away from the edges. These are the one thing that cannot be prepared from the repository — they
need the extension running on pages you are happy to show.

1. **Two or three notes on a real article.** Different palettes. One showing rendered markdown
   with a ticked task list. This is the shot that has to explain the product in one glance, so
   spend the most time on it.
2. **The cabinet**, with several site drawers populated and the index cards visible.
3. **The settings pane in the cabinet**, on the Look section, so the palette swatches and the
   section tabs are both in frame.
4. **A note mid-drag**, tilted, so the paper physics reads as intentional rather than as a bug.

Avoid: any page with your own email, tokens, or anything from a private account in frame. A
listing screenshot is public forever.
