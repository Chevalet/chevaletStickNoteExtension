# Design brief — chevaletNote

**What this file is for.** Hand this whole file to another model (or a human illustrator) when
you want alternative art: sticky-note surfaces, the logo, icons, the manager page. It carries
the design system that already exists, so what comes back can be dropped in rather than
admired and discarded.

Everything below is the *current, shipping* state, read out of the code — not a wish list.
Where something is deliberately excluded, it says so and why. Read the **Hard constraints**
section before drawing anything: half the good-looking answers to this brief cannot ship.

---

## 1. The product, in one paragraph

A Firefox extension that sticks notes onto web pages. A note is attached to the page's own
coordinate space — it scrolls with the content like part of the site, not floating over the
viewport — and it comes back when you return to that URL, even after the browser has been
closed and reopened. The notes are stored locally, in the extension's own IndexedDB. Nothing
is sent anywhere. It is one person's tool for marking up the web, and it must never make the
page it sits on feel slower or behave differently.

The design has to carry that idea: **something physically placed on the page, made of paper,
by hand.** Not a chrome-styled panel. Not a floating card with a soft blue shadow.

## 2. The look, named

**Late-80s / 90s photocopied zine.** Riso and photocopier, fly-posted, cut and taped. The
reference points are:

- Risograph printing — flat spot inks, slight misregistration, colours that fluoresce
- Photocopier degradation — hard black, blown-out midtones, visible halftone dots
- Xeroxed punk flyers and zines — torn paper edges, tape, stencil and marker lettering
- Screen-printed stickers — thick keylines, no gradients, no soft light

What it is **not**: skeuomorphic leather, glassmorphism, gradient meshes, Material elevation,
neumorphism, "clean SaaS", or anything with a drop shadow that blurs more than a few pixels.
Paper is **matte**. This one has been got wrong once already: a glossy highlight was added to
the paper and it read immediately as glass. There is no sheen, no specular band, no gloss
rim, at any angle, in any state. Paper does not shine.

## 3. Palette

Eight palettes ship. Each is `paper` / `ink` / `accent`. These are the real values:

| id | label | paper | ink | accent |
|---|---|---|---|---|
| `postit` | Post-it (default) | `#ffe94a` | `#14110e` | `#ff2e63` |
| `riso-pink` | Riso pink | `#ff8fb8` | `#1b0d16` | `#00d5c8` |
| `acid` | Acid lime | `#c6ff3d` | `#10160a` | `#7a2ff7` |
| `cyan` | Photocopy cyan | `#7ef0ff` | `#06181d` | `#ff5b17` |
| `traffic` | Traffic orange | `#ff8a3d` | `#1d0f05` | `#0f2fd6` |
| `violet` | Ultraviolet | `#b79bff` | `#150c2b` | `#c6ff3d` |
| `newsprint` | Newsprint | `#f0e7d2` | `#181613` | `#c01b3a` |
| `carbon` | Carbon (dark) | `#1e1b17` | `#f2ede0` | `#ffe94a` |

Rules the palettes obey and any new one must too:

- **Two flat colours plus a hot accent.** No third neutral, no tints, no gradients.
- **The ink is near-black, never pure `#000`** — a photocopier never produces pure black, and
  pure black next to a fluorescent paper vibrates unpleasantly.
- **The accent is loud and roughly complementary** to the paper. It is used sparingly: one
  active state, one destructive action, the tear of a torn edge.
- **`carbon` inverts** — the ink becomes the light colour. Anything drawn must survive that
  inversion. There is an `isDarkPaper()` check in the code precisely because the halftone has
  to switch to a light-dot variant and `screen` blending on dark paper.
- The user can also set fully custom `paper` / `ink` / `accent`, so **nothing may be hardcoded
  to a specific hue.** Draw against the roles, not the colours.

## 4. The note itself

Roughly 240 × 200 px by default, resizable from 120 × 80 to 2000 × 2000. Everything below is
generated in SVG and CSS at run time — there are no raster assets in a note.

- **Torn edge.** A generated path (`tornRectPath`), seeded per note from its id so a given
  note always tears the same way and two notes never look identical. Strength is a user knob
  (`tornEdges`, 0 = a clean rectangle).
- **Halftone.** An SVG `<pattern>` of dots used directly as a `fill`, with a light-dot variant
  and `screen` blending for dark palettes. Strength is a user knob (`grain`).
- **Tape.** Zero, one or two translucent strips across the corners, each drawn centred on the
  origin and rotated about its own centre.
- **Shadow.** `none` / `soft` / `hard`. `hard` is an offset flat shape — a screen-print
  register offset, not a blur. The shadow is the *same generated torn path* as the paper; a
  rectangle behind a torn shape peeks out at every tear.
- **Corner curl.** Levels of a small dog-eared corner. Level 0 is genuinely empty.
- **Keyline.** A thick, slightly irregular dark outline. This is what makes it read as
  screen-printed rather than as a div.

### The physics

Dragging a note behaves like paper: it tilts, it lags, it swings from the corner you grabbed.
This is driven by analytic damped-harmonic-oscillator springs (closed-form, exact at any
timestep), and **only `transform` and `opacity` change per frame**, so it stays on the
compositor. There is one shared `requestAnimationFrame` loop that stops itself when
everything has settled — 0% CPU when idle.

If you propose motion, it has to be expressible as `transform` + `opacity` on a four-layer
stack: `translate3d` → shadow → `perspective` → `rotateX/Y` → `rotate/skew/scale`. Anything
requiring layout, filters per frame, or SVG path animation per frame is not shippable.

## 5. Type

`system` is the default and costs nothing. Bundled faces load on first use, as bytes through
`FontFace` — never as a URL, because a page's CSP can block a URL. All bundled faces must be
SIL Open Font Licence.

Currently declared: Permanent Marker, Bangers (display), Caveat (hand), Archivo (grotesk),
and — importantly — **Vazirmatn and Estedad for Persian/Arabic**. Each face declares which
scripts it actually covers, so a Latin-only marker face falls back sensibly for Persian text.

**Persian is a first-class script here, not an afterthought.** The author writes in Persian.
Any type or lettering proposal that only works in Latin is half a proposal — say what happens
to Persian, or pick a face that covers both.

## 6. The logo

A silhouette in the spirit of the Windows Sticky Notes icon — a sheet of paper with writing on
it — but in this project's own language. Current construction, in `assets/logo.svg`:

- 64 × 64 viewBox, the sheet rotated `-5°` about its centre
- Torn top edge; halftone `<pattern>` fill over a flat paper fill; a folded flap
- Ink `#14110E`, accent `#FF2E63`, keyline `1.6px`
- Marker strokes drawn as **tapered filled paths**, not stroked lines, so they read as a
  chisel marker rather than a pen
- An offset flat ink shadow — the screen-print register offset again

There is a second file, `assets/logo-mark.svg`, simplified for ≤24px: no tear, no halftone,
no tilt, and a heavier `2.6px` keyline. **Both are needed.** A mark that is only beautiful at
512px is not finished.

Known critique to work with: an earlier version had black lines that were too thick and heavy
and lost the sharp, cut quality of the rest of the design. The wanted direction is **sharper,
more graffiti/stencil, more cut-paper — less "bold icon set"**.

Sizes that must each look deliberate, not merely scaled: **16, 32, 48, 64, 96, 128, 512**.

## 7. Hard constraints — read these before drawing

These are not preferences. Work that violates them cannot be used.

1. **No external requests, ever.** No web fonts by URL, no CDN, no remote images, no tracking
   pixel. Everything ships in the package. A content script also runs under the *page's* CSP,
   so a URL that works in a normal page may be blocked here. Images arrive as bytes and are
   painted to a canvas; stylesheets are `adoptedStyleSheets`; SVG is inline.
2. **No raster art for anything that scales.** Icons and the logo are SVG. The only raster in
   a note is a 128px tiled paper-grain texture generated at run time.
3. **No `innerHTML`, anywhere.** Everything is built with `createElement` / `textContent`. If
   your deliverable is markup, it has to be expressible as a small element tree.
4. **The note lives in a closed shadow root** with `all: initial`, `pointer-events: none` on
   the host, and `contain: style`. It cannot inherit from, or leak into, the page. Nothing may
   depend on a page-level stylesheet, a global class, or a CSS variable defined outside.
5. **Compositor-only animation.** `transform` and `opacity`. Nothing else per frame.
6. **Zero cost when idle.** No animation may run when nothing is happening. No infinite
   ambient loops, no perpetual shimmer.
7. **Bundle budgets are enforced by the build.** The content script has 28 kB gzipped for
   *everything* — notes, styles, markdown, drawing, anchoring. A beautiful 40 kB SVG is not a
   candidate. The stylesheet is already 16 kB of the 78 kB minified total.
8. **Theme-agnostic.** Eight palettes plus fully custom colours, one of them dark-on-light
   inverted. Draw against the `paper` / `ink` / `accent` roles.
9. **Accessibility is not optional.** Ink on paper must stay legible in all eight palettes;
   `prefers-reduced-motion` must be honoured (there is already a `physics: 'off'` setting);
   nothing may rely on colour alone to convey state.
10. **AMO review.** This ships publicly on addons.mozilla.org, reviewed by humans against
    Mozilla's policies, with the source published. Nothing obfuscated, nothing minified beyond
    the ordinary build, no eval, no remote code.

## 8. What would actually help

In rough order of value:

1. **The logo, taken seriously.** Sharper and more cut-paper/stencil than the current version,
   with the thick black lines resolved. Delivered as: the hero mark, a ≤24px simplification,
   and a note on how the two relate. Inline SVG, flat fills, no gradients, no filters.
2. **Alternative paper surfaces.** New torn-edge characters, halftone/grain treatments, tape
   styles, register-offset shadows. Must be generative or at least parameterised — every note
   is seeded from its own id and no two should look the same.
3. **Icon set.** The note toolbar (pen, palette, lock, collapse, delete, settings) at a 24px
   box, plus the manager's file/folder/drawer icons in the "old document shelf" register the
   manager already uses. Single-path where possible; they have to read at 16px.
4. **New palettes** obeying the rules in §3. Riso spot-ink pairs are the sweet spot.
5. **The manager page.** It is currently a dark carcass with a drawer per domain, manila folder
   tabs cut with `clip-path`, and ruled index cards with a deterministic lean. If you can make
   that stronger without adding weight, that is welcome.

## 9. Deliverable format

Inline SVG source, or CSS, or a short element tree — something that can be read and adapted.
For each piece, say **which roles map to which colours** (`paper`/`ink`/`accent`) rather than
baking in hex values, and say what happens on the dark `carbon` palette and with Persian text.

If a proposal needs one of the hard constraints relaxed, say so explicitly and say why it is
worth it. That is a real conversation. Quietly breaking one is not.
