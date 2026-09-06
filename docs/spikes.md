# Spikes

> **The two newest matter most.** `spikes/firefox-extension.mjs` drives the REAL extension over
> a real page, and `spikes/firefox-persist.mjs` asks whether a note you typed is still there
> after a reload. Both exist because two bugs reached a user that nothing here could have
> caught: the playground has the note stack but no background, `tests/messages.test.ts` has the
> background but no page, and both bugs lived in the seam between them.
>
> Each has a control. Put the bug back and they print NO.
>
>     pnpm serve
>     pnpm build:test          # dist-test/, the shipped build with host access declared
>     node spikes/firefox-extension.mjs
>     node spikes/firefox-persist.mjs

## Phase 0 — de-risking spikes

Six questions whose answers change the **design**, not just the code. Run them before any
product code is written on top of the assumptions they test. Budget: about four hours.

Record every answer in the "Results" table at the bottom of this file, on **Firefox release
and ESR**. A blank cell is not a pass.

---

## How to run

```bash
pnpm install
```

Then in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → pick `spikes/harness/manifest.json`
3. Click the harness's toolbar button. The dashboard opens in a tab.
4. Press **Grant all sites** first — Firefox MV3 grants no host permissions at install, so
   nothing can be injected until you do. (That prompt *is* the product's real onboarding flow.)

The harness writes its event log to `storage.local`, so it survives a browser restart. That is
the only way to see what actually happened during session restore, which is the whole point of
R5a. Do **not** press *Clear all results + log* between a restart test and reading the log.

> The harness is throwaway and is never shipped. `web-ext lint` flags four `innerHTML`
> assignments in `panel.js`; that is expected and deliberately not worth fixing in a dev tool.
> The shipped extension lints at **0 errors / 0 warnings / 0 notices** — keep it that way.

---

## R1 — Does a content-script `beforeunload` actually prompt on tab close?

> **ANSWERED: yes.** Firefox 155 on Windows, September 2026, by hand: a note with unsaved
> typing in it, Ctrl+W, and the "Leave page?" dialog appears. So the close guard is real, the
> kill criterion below was never triggered, and `strict_min_version` stays where it is.
>
> It took a person because no harness in this repository can reach that dialog — it is browser
> chrome. `firefox-r1.mjs` and `firefox-unload.mjs` both keep their failing controls as the
> record of that.
>
> `src/cs/guard.ts` has had its own tests since the day this was answered: ten of them, on
> everything the file decides for itself. The dialog is Firefox's; the arming is ours.

**Why it mattered.** The whole close-confirmation feature rests on this one behaviour, and it
is the only mechanism that exists: `tabs.onRemoved` fires *after* the fact and there is no
cancellable variant in any browser.

**Kill criterion.** If isolated-world cancellation is ignored, `scripting.executeScript` with
`world: "MAIN"` becomes mandatory. That keeps `strict_min_version` pinned at 128 and puts a
cross-world message channel in scope from day one rather than week six.

Pick a tab in the R5a table, press **use**, then **Inject probe**. Work the matrix:

| # | Setup | Expected | Actual |
|---|---|---|---|
| 1 | Armed, page clicked once → close the tab | dialog appears | |
| 2 | Armed, page **never** clicked → close the tab | no dialog (sticky activation) | |
| 3 | Three tabs armed → close the whole window | how many dialogs? does Firefox focus each tab? | |
| 4 | Armed → Ctrl+Shift+Q | dialogs? does session restore still work after choosing Stay? | |
| 5 | Armed → **Close via tabs.remove()** | guard bypassed | |
| 6 | `dom.disable_beforeunload = true` in about:config | suppressed | |
| 7 | Discard in `about:unloads`, then close | silent (no content process) | |
| 8 | Back-navigation timing, armed vs disarmed | armed is measurably slower (bfcache ineligible) | |

Row 3 sizes the **guard budget**. Row 8 is why the shipped guard arms and disarms on demand
instead of staying attached.

---

## R2 — Is the CSP-immune asset pipeline real in Firefox?

**Why it matters.** The entire "bytes, never URLs" strategy — and with it user-uploaded fonts,
which have no URL to give CSS — depends on `new FontFace(name, arrayBuffer)` +
`document.fonts.add()` working from a content-script sandbox.

Sweep at minimum: **github.com**, **x.com**, and a locally served page with
`Content-Security-Policy: default-src 'none'`.

Read the three font rows carefully, because they fail for different reasons:

- `new FontFace(...)` throws → the API is not reachable from the sandbox.
- `document.fonts.add()` throws → **cross-compartment failure. This is the design-killing one.**
- `face.load()` rejects → read the error name. `SecurityError` means CSP blocked it. Anything
  else is a *parse* error, which is the **expected** result here: `asset-probe.woff2` is
  deliberately not a real font, so a parse rejection proves the pipeline works end to end and
  only the bytes were junk.

The real-font load step gets confirmed in phase 4, when an actual subset font is bundled.

**Kill criterion.** If `document.fonts.add()` fails everywhere and the `wrappedJSObject` +
`cloneInto` fallback also fails, drop user-uploaded fonts, ship bundled + system stacks only,
and say so plainly in the store listing.

---

## R3 — Do anchors actually hold on real sites?

Not in the harness — this one is a Playwright-Firefox script (phase 3, `tests/anchoring/`).

Twenty representative URLs: a news article, a GitHub PR, Wikipedia, an infinite-scroll feed, a
React SPA with client routing, a docs site, an e-commerce PDP, a Persian RTL news site. Ten
synthetic anchors each, capturing all three tiers. Then reload, resize to 1440 / 900 / 390 px,
and for the SPA navigate away and back.

**Gate: ≥ 92 % resolved at confidence ≥ 0.65, median drift ≤ 4 px.** Below that, the fallback
chain needs rework *before* any note UI is built on it.

---

## R4 — Does the drag feel like paper, and does Firefox composite it?

Not in the harness — a standalone page (phase 4, `spikes/paper/`).

Build the real four-layer transform stack with sliders for each spring's ω and ζ and for the
velocity → deformation coefficients. Tune by feel for twenty minutes and **write the numbers
down**; they become the constants in `src/cs/physics/spring.ts`. Then spawn 30 notes on a
deliberately heavy page and record ten seconds in the Firefox Profiler.

**Gates:** no Reflow/Layout markers inside the rAF window · the release settle appears as an
OMTA (compositor) animation · ≤ 1.2 ms main-thread cost per frame for the dragged note.

---

## R5a — Tab identity: does `sessions.setTabValue` survive everything?

A key is minted on each tab's first load. Do each of these, then **Refresh table** and read the
event log:

| Scenario | What to look for | Actual |
|---|---|---|
| Restart with "Restore previous session" | same keys come back | |
| Ctrl+Shift+T (undo close) | new tabId, **same** key | |
| **Duplicate Tab** | does the clone carry the *same* key? A red `SHARED!` in the table means yes | |
| Drag a tab to a new window | same tabId? same key? | |
| Container tab | key works, `cookieStoreId` recorded | |
| Private window, then restart | key correctly gone | |
| Discard via `about:unloads` | is the key still readable with no content process? | |
| `kill -9` the Firefox process 3 s after a fresh tab loads | key lost → confirms the ~15 s sessionstore flush window, which is why fuzzy re-attach exists | |
| 300 lazily-restored tabs → **Time getTabValue for every tab** | total and per-tab cost | |

The duplicate-tab answer drives the collision logic in `src/bg/tabs/identity.ts`. Firefox's
Duplicate Tab is expected to clone extension tab values, which means a brand-new tab can arrive
already holding a key another *live* tab is using.

Also exercise **Recovery**: `restore` uses Firefox's own shallow undo stack, while
**reopen + reattach** is the product's own path (recreate the tab, hand it back its old key)
and has no depth limit. Prove the second one works — it is strictly better than what Firefox
offers and it is what the plan promises.

---

## R5b — IndexedDB at scale

Press **Seed & benchmark** with 10 000 notes.

**Gate: hot-path query p95 < 5 ms.** That query runs on every page load in every tab, so if it
misses, the schema needs rework before anything is built on it.

The run also answers three schema questions directly:

- Is a compound index over a `multiEntry` component really rejected? (The ` `-prefixed
  key workaround exists only because it should be.)
- What does a **full `getAll`** cost? That is the number `storage.local` would force us to pay
  on every single page load, and it is the argument for IndexedDB.
- Is `durability: "strict"` supported, and what does it cost?

---

## R6 — Does the host survive the real web?

Same probe as R2. Open a hostile site, come back to the dashboard, type its tab id, inject.

The row that matters most is **"uncovered pixel hits the PAGE"**. If that ever fails, the host
page is broken for the user — which is the one thing the product must never do.

Sweep: youtube.com (also in fullscreen) · mail.google.com · docs.google.com · notion.so ·
github.com · x.com · linkedin.com · a bank with a strict CSP · a Next.js app with client
routing · pdf.js · `file:///` · a `#/` hash-router SPA · a Persian RTL site · a page that
clears `document.body` on boot · a page with `* { all: unset !important }` in its reset.

Also test the **extension-update orphaning** path: reload the temporary add-on with a probed
page still open, and confirm the old content script gets "Extension context invalidated" and
tears itself down instead of throwing.

**Kill criterion.** Any pass-through failure, or the host being removed and staying removed, is
a design change rather than a bug fix.

---

## Results

Fill this in as you go. `—` means not yet run.

| Spike | Firefox release | Firefox ESR | Verdict / design consequence |
|---|---|---|---|
| R1 close guard | — | — | |
| R2 CSP assets | — | — | |
| R3 anchoring | — | — | |
| R4 paper physics | — | — | |
| R5a tab identity | — | — | |
| R5b IDB at scale | — | — | |
| R6 host survival | — | — | |

---

## Keyboard spikes — added in 0.0.10

Two harnesses that are not part of the original phase-0 set, and the reason they exist.

### `spikes/firefox-keys.mjs` — every shortcut, in a real Firefox

Runs 45 checks against the playground through the browser's own input pipeline: typing,
Backspace, the caret, undo, redo, every formatting chord, the header gear, and the single-key
note shortcuts. **Its first line is a control** — a plain `contenteditable` in the top-level
document, typed into and backspaced with the same calls. If that fails the run stops, because
nothing after it would mean anything.

It also carries a **layout matrix**, which is the one place in the repo where a *synthetic*
key event is the correct instrument. WebDriver cannot change the OS keyboard layout, so the
only way to cover a Persian keyboard from an automated run is to dispatch an explicit
`key`+`code` pair. That is legitimate here and nowhere else: it measures our own `if`
statements, which are plain JavaScript and cannot tell where an event came from. It could
never measure an *edit* — a synthetic key carries no physical `code`, browsers perform no
editing action for one, and not knowing that is what cost three releases on the Backspace bug.

Each layout row is fired twice, once with the Latin character and once with the layout's own,
and both must agree. There is a Dvorak row too — `key: 'z'` with `code: 'Semicolon'` — because
matching on physical position *only* would break Dvorak, where the key that prints "z" is
somewhere else entirely.

    node spikes/firefox-keys.mjs        (needs `pnpm serve` in another shell)

### `spikes/firefox-chords.mjs` — a documented dead end

Tries to measure which `Ctrl` chords Firefox swallows before page JavaScript sees them, so the
formatting shortcuts could be placed on chords that are actually free.

**It cannot answer that, and its control says so.** The run begins by sending `Ctrl+T` and
counting window handles: if a new tab appears, WebDriver is reaching browser chrome and the
measurement is meaningful. It does not. WebDriver dispatches into the content process, so
every chord would report "arrived" whether Firefox owned it or not — including the two
deliberately hostile rows in the table (`Ctrl+Shift+K`, `Ctrl+Shift+M`) that exist to make a
broken instrument obvious.

So it prints the refusal instead of a table. The shortcut set was chosen from what rich text
editors on the web demonstrably override in Firefox every day — `Ctrl+B`, `Ctrl+I`, `Ctrl+K`,
and Google Docs' own `Ctrl+Shift+7`/`8` — and chords Firefox certainly owns are avoided
outright. Kept in the repo, control intact, next to `firefox-r1.mjs`, so nobody spends an
afternoon on the same approach.

---

## R1, the thirty-second version — how it was answered

`spikes/firefox-r1.mjs` cannot answer this and says so: WebDriver's Close Window command does
not run unload prompts, so **both** trials report no dialog, including the control where the
page arms its own `beforeunload`. A failed control means a useless measurement.

So it was done by hand, and this is the procedure that did it — kept because it is also how
to re-check the answer on another platform, which nobody has:

**The test**

1. Open any ordinary site.
2. Make a note (Alt + double-click) and type a few words into it.
3. **Immediately** press Ctrl+W.

**The control** — do this second, on a fresh tab of the same site, and it is what makes the
answer trustworthy:

1. Open the page's own console (F12 → Console) and paste:
   ```js
   window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
   ```
2. Click somewhere on the page, so Firefox counts it as interacted with.
3. Press Ctrl+W.

**Reading it**

| test | control | conclusion |
|---|---|---|
| dialog | dialog | The guard works as designed. Firm up the wording in the settings. |
| no dialog | dialog | A content script's `beforeunload` is ignored in an isolated world. The guard cannot work as designed; replace the dialog with the toolbar badge plus the cabinet. |
| no dialog | no dialog | Firefox is suppressing it for this page or this profile — try another site before concluding anything. |

Until this is answered, the close-warning setting stays described as best-effort, which is
honest either way and is why it does not block an AMO submission.


## The later spikes, added as questions came up

| File | The question |
|---|---|
| `firefox-keys.mjs` | Which key was pressed, on a Persian, Arabic, Cyrillic, Greek or Dvorak layout. 45 checks, control first |
| `firefox-chords.mjs` | Which Ctrl chords reach page JavaScript. Its control fails and it says so: WebDriver never reaches browser chrome |
| `firefox-unload.mjs` | R1 by navigation instead of a tab close. Four triggers, two prefs, control never fires — Marionette does not open the prompt at all |
| `firefox-fonts.mjs` | Can a content script give a note a bundled face on a page whose CSP forbids fonts. Yes, via `new FontFace(buffer)` — and the arabic and latin subsets share no glyphs |
| `firefox-persist.mjs` | Type into a note, reload: is the text there? |
| `firefox-extension.mjs` | The real extension over a real page: injection, a note, a reload, and a single-page app changing route |
| `shots.mjs` | 40 photographs of every pane in both themes, including native-resolution crops |
| `cabinet/` | The cabinet in an ordinary page, with the four browser edges stubbed |
| `spa/` | A page that changes its URL with `pushState`, for the scope-leak reproduction |
