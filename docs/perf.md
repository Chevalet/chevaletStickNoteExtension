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
| `cs/renderer.js` | 24 kB | **see build output** | parsed on every page load that has notes |
| `bg/main.js` | — | — | an event page parses its whole bundle on *every* wake; keep under 80 kB minified |

---

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
