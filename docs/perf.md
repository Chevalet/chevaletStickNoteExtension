# Performance and tuning

Recorded numbers, not aspirations. Anything here that is a target rather than a measurement is
marked **TODO**.

---

## R4 — paper feel

Harness: `spikes/paper/index.html`, built by `pnpm build:dev` and served over HTTP.
It mounts the real `createHost`, the real springs and the real `NoteView` on a page whose CSS
is deliberately hostile (`* { box-sizing: border-box !important }`, a serif `font-family` with
`!important` on `body`).

### The pose, measured mid-flick

Grabbed at the far left of the header and yanked right-and-down, ~1500 px/s:

| Degree of freedom | Value | Reading |
|---|---|---|
| `rotateY` | **10.05°** | leans into the direction of travel |
| `rotateX` | **−8.06°** | tips back as it is pulled downward |
| `rotate` (in-plane) | **9.75°** | swings around the grab point — the lever term |
| `skewX` | **3.45°** | the shear that makes it read as a sheet, not a card |
| `translateZ` | **21.77 px** | lifted off the page |
| `scale` | **1.029** | the perspective growth that comes with the lift |
| corner curl | level 2→3, **0.86 / 0.14** | cross-fading between two pre-baked folds |
| shadow opacity | **0.331** (from 0.18 at rest) | separates from the paper as it lifts |

A slow, careful drag (~150 px/s) stays under 2.5° on every axis and produces essentially no
curl, which is the behaviour the unit tests in `tests/pose.test.ts` pin down.

### Constants

Spring frequencies live in `TUNING` in `src/cs/note/NoteView.ts`; the velocity → pose mapping
lives in `TUNING` in `src/cs/physics/pose.ts`, separated so it can be tested without a DOM.

| Spring | ω | ζ | Settle |
|---|---|---|---|
| position | 34 | 1.00 | ~120 ms, never overshoots |
| lift | 28 | 1.00 | ~140 ms |
| in-plane rotation | 16 | 0.58 | ~380 ms, one visible overshoot |
| 3D tilt | 18 | 0.55 | ~340 ms |
| skew | 20 | 0.62 | ~300 ms |
| corner curl | 14 | 0.70 | ~420 ms |

`setTimeScale(n)` slows every spring by `n` — that is how these were chosen. At 1× the eye
cannot separate tilt from spin from curl; at 8× each one is legible on its own.

### What is still outstanding

- **TODO** Firefox Profiler trace: 30 notes on a heavy page, ten seconds. Gates are no
  Reflow/Layout markers inside the rAF window, the release settle appearing as a compositor
  (OMTA) animation, and ≤ 1.2 ms of main-thread cost per frame for the dragged note.
- **TODO** WAAPI keyframe baking for the release settle (plan §6 rule 4). Currently the settle
  runs through the shared loop on the main thread.

---

## Bundle sizes

Enforced by `build.ts`; exceeding a budget fails a production build.

| Bundle | Budget (gz) | Actual (gz) | Why the budget |
|---|---|---|---|
| `cs/guard.js` | 1.0 kB | **0.3 kB** | runs at `document_start` on every annotated page |
| `cs/renderer.js` | 32 kB | **see build output** | parsed on every page load that has notes |
| `bg/main.js` | — | — | an event page parses its whole bundle on *every* wake; keep under 80 kB minified |

---

### Why the renderer budget moved to 28 kB

Measured with an esbuild metafile rather than estimated, at 78.2 kB minified:

| kB | module |
|---:|---|
| 19.9 | `cs/note/NoteView.ts` |
| 16.2 | `cs/styles.ts` |
| 4.8 | `cs/note/SettingsPanel.ts` |
| 4.7 | `cs/note/ink.ts` |
| 4.5 | `perfect-freehand` |
| 4.2 | `cs/renderer.ts` |
| 3.1 | `cs/note/md-lex.ts` |
| 3.0 | `cs/anchor/text.ts` |
| 2.6 | `cs/note/markdown.ts` |
| 2.5 | `cs/anchor/index.ts` |
| 2.0 | `cs/anchor/element.ts` |
| 1.7 | `approx-string-match` |

Two things came out of this measurement rather than out of an opinion.

**`marked` was removed.** It was 42.2 kB of a then-107 kB bundle — forty per cent of what
every annotated page had to parse — for a full CommonMark + GFM implementation whose tables,
footnotes, reference links and HTML blocks a sticky note never uses. `md-lex.ts` replaced it
at 3.1 kB, and the 32 existing markdown tests, written against `marked`, passed unchanged.
That is the only reason replacing a battle-tested parser was defensible — and the harness
then found a bug in it that those tests did not (see below), which is the honest cost of the
decision.

**The budget went from 24 kB to 28 kB gz**, once anchoring moved onto this path (~3 kB gz for
`anchor/` plus `approx-string-match`). The table says there is no fat to cut instead: the two
largest entries are the note itself and its stylesheet. Before raising it again, re-measure,
and ask the question the number exists to force — is the new code needed on a page that has
no notes yet? That is the common case.

### Undo/redo, measured

Recording has to be free, because it happens on every keystroke of every note.

| what | measured |
|---|---|
| one recorded edit | **1.3 µs** (2000 edits in 2.6 ms) |
| one undo step, 200-deep stack | **2 µs** |
| 120 drag frames | **0.9 ms**, and **0 history entries** |

The last row is the design point. A drag fires `pointermove` sixty times a second; recording
per move would put sixty entries in the stack for one gesture and make undo useless. The
entry is written on release, so a whole drag is one step. Typing coalesces the same way: a run
of keystrokes inside 600 ms is one entry, so "hello" is one undo, not five.

At 1.3 µs, recording a keystroke costs 0.008% of a 16 ms frame. Nothing here runs per frame,
and the shared rAF loop still stops itself when everything settles.

The stack is bounded twice over -- 200 entries and 2 MB of stored text, whichever comes first
-- because text edits store before/after strings, and a note may hold 200k characters.

## Notes from measuring in a preview pane

Two environment traps cost real time here, worth remembering before trusting any in-pane
measurement:

- **`requestAnimationFrame` is throttled to ~0–1 fps while the pane is hidden.** Physics driven
  by the shared loop simply does not advance. Drive `note.step(dt)` by hand instead.
- **`setTimeout` is clamped to ~1 s in a hidden pane.** A synthetic drag that sleeps 16 ms
  between moves actually sleeps a second, so the velocity estimator sees ~46 px/s instead of
  ~1500 and reports a pose of 0.03°. The code was correct; the measurement was not.

Both are why the velocity → pose mapping is unit-tested rather than screenshot-tested.

---

## Real bugs this harness found

Each of these was invisible in code review and obvious the moment it rendered.

1. **The drop shadow was a rectangle behind a torn shape.** It peeked out past every tear. Now
   the shadow is the same generated path as the paper.
2. **The halftone rendered nothing.** It was applied as a CSS `mask`, whose shorthand resets
   `mask-clip`/`mask-origin` to box values that give an empty mask region on an SVG element.
   Now the pattern is used directly as a `fill`, with a light-dot variant and a `screen` blend
   for dark palettes.
3. **Tape strips floated off into space.** They were positioned by the strip's top-left corner
   and then rotated about that same corner. Now they are drawn centred on the origin and
   rotated about their own centre, so they land across the corner.
4. **Every note wore a hard dark triangle at rest.** Curl level 0 drew a 14 px wedge at full
   opacity. Level 0 is now genuinely empty.
5. **Notes collapsed to the minimum size when the viewport reported 0.** `window.innerWidth` is
   legitimately 0 mid-load and in some hidden tabs, and the size clamp took it at face value.
6. **A stray backtick inside a CSS comment** silently terminated the stylesheet template
   literal. Twice. `tests/styles.test.ts` now fails the build on any backtick in the CSS.
7. **`setPointerCapture` threw and aborted the drag** for a pointer id that was no longer
   active. Capture is an optimisation; failing it must not cancel the gesture.
8. **A blockquote swallowed the rest of the note.** Lazy continuation absorbed *any* unmarked
   line under a quote, so a code fence written straight after a quote with no blank line
   between took the fence, the paragraph after it and the rule after that inside the quote.
   The unit tests passed throughout, because they asserted those blocks *existed* and never
   where they sat. One screenshot of a note holding a realistic markdown sample showed a
   single quote bar running down two thirds of the card. `startsBlock()` is now one shared
   definition used by both the paragraph loop and the quote loop, and the tests assert
   nesting.
9. **Backspace did nothing, and my first attempt to reproduce it was invalid.** `focusBody()`
   called `selection.removeAllRanges()` and then `addRange()` with a range inside the note's
   closed shadow root, without checking the second call took. `ShadowRoot.getSelection()` is a
   Chromium extension to the spec; Firefox does not have it, so the code fell through to
   `document.getSelection()`, which cannot address a node inside a shadow tree. The
   `removeAllRanges()` destroyed the caret the browser had just placed on focus and nothing put
   one back — a note you could type into (the editor infers a position on insert) but could not
   delete in, because a delete needs a selection to delete backwards from.

   The reproduction attempt is worth recording as its own lesson. Injected key events carry no
   physical `code`, so the browser delivers them as events and performs **no editing action**.
   Under a synthetic Backspace *every* contenteditable looks broken, so the first "reproduction"
   proved nothing and the second confirmed nothing. `document.execCommand('delete')` is the
   valid proxy: it runs the same edit path a real Backspace does. With the fix, clicking five
   characters into a note reports `caretOffset: 5` inside the body and `execCommand('delete')`
   removes the character *at* the caret rather than at the end. Before the fix the same probe
   reported the selection anchored on `HTML` with `rangeCount: 0`.

## The Backspace bug, and three wrong fixes

Worth writing out in full, because the mistakes were more instructive than the fix.

**The symptom.** Inside a note, in Firefox, typing worked and Backspace did nothing. Reported
three times.

**The fix, in the end, is one line.** The shadow host was appended to
`document.documentElement` — a sibling of `<body>`, outside it — on the reasoning that a child
of `<html>` is the hardest place for a page to disturb. Gecko will not perform an editing
command for an editing host outside `<body>`: it dispatches `beforeinput` with
`deleteContentBackward`, does not cancel it, and then declines to edit. No `input` event, no
change, no error. Text insertion takes a different path and kept working, which is exactly why
the symptom was so lopsided.

**Why it took three releases.** Every instrument available was wrong for the job.

- The in-app browser is Blink, and Blink does not have this restriction, so the bug is
  invisible there.
- Injected key events carry no physical `code`, so the browser delivers them as events and
  performs *no editing action*. Under a synthetic Backspace every `contenteditable` looks
  broken — so the first "reproduction" proved nothing, and the fix that followed it was
  addressing an artefact of the test.
- Two real bugs were found on the way and fixed, which made each release feel like progress: a
  caret destroyed by `removeAllRanges()` and never replaced, and `dir` set on the editor but
  not the rendered view. Neither was this.

**What actually found it**, once Atur pointed out that a real browser could be driven: real
Firefox through geckodriver, with real key events, varying one thing at a time.

    spikes/firefox-backspace.mjs   the structure, seven variants   -> all innocent
    spikes/firefox-note.mjs        the real note, instrumented     -> beforeinput, then nothing
    spikes/firefox-bisect.mjs      one intervention at a time      -> only reparenting helped
    spikes/firefox-where.mjs       host position and tag name      -> position is everything

The last one is the whole answer:

| host | Backspace |
|---|---|
| `<div>` inside `<body>` | deletes |
| custom tag inside `<body>` | deletes |
| `<div>` on `<html>` | nothing |
| custom tag on `<html>` | nothing |

Eliminated the same way first, and all innocent: the closed shadow root, `all: initial`,
`pointer-events: none`, `contain: style`, `plaintext-only` versus `true`, ancestor transforms,
the adopted stylesheet, four levels of nesting, and stopping keyboard events at the host.

**The lesson worth keeping.** Playwright's own Firefox would not start on this machine
("side-by-side configuration is incorrect" — it wants the MSVC redistributable), and
geckodriver drives the *installed* Firefox instead, which is better anyway. Both are now
devDependencies. Reach for them before theorising about engine behaviour: the four scripts
above cost less than any one of the three wrong fixes.
