# AGENTS.md: cosmic-ascii

## Purpose and architecture

A Claude Code mod (theme) for the desktop and mobile apps: every surface pure
black (#000000, pixels off) and, behind the conversation, an animated ASCII
solar system inspired by the owner's site (`Zer0codestuff/Zer0codestuff.github.io`,
branch `codex/cosmic-zoom-polish`, WebGL ASCII renderer in `src/gl/`).

- Published at `github.com/Zer0codestuff/cosmic-ascii` (public, MIT). Local
  live copy: `~/.claude/skills/cosmic-ascii`. Claude Code auto-loads it in every
  new session as `cosmic-ascii@skills-dir` (user scope). The first version
  lived in one session's `~/.claude/dev-mods/<session>/` folder, which is why
  it showed in that thread only.
- `hooks/register.tsx`: `session.start` sets the theme (`$.theme.set` with
  colors from `make-colors.js` and a `solar-system` backdrop scene); a
  `ui.render` hook on `Backdrop` draws `SCENE` as an interactive `Svg`
  (reads `e.props.scene`, falling back to `e.props.id` for older builds).
- `hooks/scene.ts`: GENERATED. One self-contained SVG string. Never edit by hand.
- `tools/build-scene.mjs`: the generator. Renders each body fully lit into
  character cells (FONT 6, cell 3.6 x 7.2) with the site's pipeline: Menlo
  glyph ramp, tone curve, Sobel contour glyphs. Surfaces ported from the
  site's `body.frag`/`earth.frag`.
- `tools/earth-256x128.txt`: Earth relief from the site's `world.webp`.
- `hooks/make-colors.js/.d.ts`: copied unchanged from the plugin-authoring
  skill. Recopy when the Claude Code build updates.

### How the scene animates (SMIL, no script, no CSS animation)

- All motion is SMIL: `<animateTransform type="rotate">` for orbits, the
  counter-rotation and the asteroid belt; discrete `<animate>` on
  `visibility` for spin frames, on `opacity` for the Sun-crossing copies and
  on `class` for the light-mask steps; spline `<animate>` on `opacity` for the
  Sun's granules and the twinkling stars. CSS animation also runs in the app
  (the theme-examples scenes use it); SMIL was kept because it works and the
  scene was already built on it.
- Resting state (no animation) is still a composed picture: each planet sits
  at its start angle through a fixed `rotate()` around the animated one,
  spin frame 0 is `visibility="visible"` and the rest `hidden`, the mask class
  and the crossing copies' `opacity` start at the start-angle values.
- Orbits: planet group rotates 0 to -360 on a plane flattened by
  `scale(1 0.4)`; the inner group rotates 0 to 360 and `scale(1 2.5)` keeps
  glyphs upright.
- Light and phases: a black gradient shade over each globe; its rotation and
  terminator (gradient x1/x2) follow 16 keys per orbit, interpolated by SMIL. Phases are softened
  (`t0 = -0.45 * L.V`) and the night side keeps alpha ~0.5.
- Spin: Earth 12 frames / 32 s, Mars 10 / 34 s, Jupiter 12 / 44 s (spot
  patches only); cells that never change are drawn once.
- Sun: full disc always drawn, plus three brighter granule layers fading
  in and out over it. No corona, no halo.
- Mercury and Venus cross the Sun: a back copy and a front copy, each with a
  discrete opacity window for the far half of the orbit.
- Tall boxes zoom on the inner system through `xMidYMid slice` framing.
- Speeds: period = 50 s x sqrt(real sidereal period in years).
- When the app stops motion it removes SMIL elements and nulls CSS animation
  itself (see below), so reduced motion is honoured without a media query.

## Run, build, test

```sh
node tools/build-scene.mjs [preview-dir]   # rewrites hooks/scene.ts, prints sizes
claude plugin validate .
claude plugin list                          # should show cosmic-ascii@skills-dir
```

Preview: serve the preview dir and open `scene.svg` in a browser. Type-check
with the tsconfig from the types header (`jsxFactory: h`).

## How the desktop app draws the scene (read from app 5.11492.5, engine 2.1.325)

- `Svg isInteractive` goes through DOMPurify (svg + svgFilters profiles, plus
  `animate`, `set`, `use`; forbids `script`, `foreignObject`, `image`, `a`,
  `iframe`; `href` kept only when it starts with `#`), then into a sandboxed
  `iframe srcdoc` with a CSP that allows inline style only. ids, gradients,
  masks, `<style>`, CSS `@keyframes` and SMIL all survive.
- The app draws motion only when `shouldAnimate` is true AND the window is not
  software-composited. `shouldAnimate` = localStorage
  `LSS-appearance:backgroundAnimation` is `enabled`, or it is not `disabled`
  and the OS does not ask for reduced motion. Otherwise the app inserts
  `*{animation:none!important;transition:none!important}` and deletes every
  `animate`, `animateTransform`, `animateMotion` and `set`. Nothing inside an
  SVG can move in that mode; do not try to work around it.
- `tools/` has no copy of the test page. To reproduce the pipeline, sanitize
  the scene with the DOMPurify options above and load it in
  `<iframe sandbox="" srcdoc>`; to preview the still mode, strip the SMIL
  elements and add the `animation:none` style.

## Current status (2026-11-15, v1.0.0)

- v1.0.0, asked by the owner: planets with more resolution and detail, the
  Sun's "pixels switching off" removed, everything a little slower, and
  "surprise me".
  - Glyphs 6 -> 4.8 (about 1.6x the cells), planets about 10% larger,
    Sun R 90; orbits moved out so Earth's globe still clears the Sun.
  - Sun: the full disc is always drawn; three layers of the same glyphs in a
    brighter colour fade 0 -> .95 -> 0 over it (13, 16.4, 20 s). The old
    version faded a third of the disc down to 30% with nothing beneath:
    that was the flicker.
  - Speed: Earth orbit 40 -> 50 s (all orbits follow), spins and twinkles
    slower.
  - Jupiter spins (12 frames, 44 s). Its band turbulence repeats exactly 12
    times around (JUPITER_REPEAT), so every frame equals a spotless base;
    per frame only the Great Red Spot's cells are drawn, on black backing
    rects. That keeps the spin at ~12k instead of ~84k.
  - Per-body colour saturation (`sat`), applied after the palette snap.
  - New: the Moon around Earth; Io, Europa, Ganymede, Callisto around
    Jupiter (back copy hidden by the globe's black backing, front copy over
    it, opacity windows by half-orbit); a comet on a Kepler ellipse (e 0.8,
    inclined 18 deg, 170 s) whose tail always points away from the Sun and
    lengthens near perihelion (nested translate, rotate, scale animations);
    four shooting stars on 23-53 s cycles.
  - Scene ~125k of 131,072 characters: little room left. Earth (12 frames,
    ~34k) and the Sun (~15k) are the largest parts.
- v1.1.0: Claude Code's mascot in a space helmet floats across as pixel art
  (owner's request, from a reference image): `ASTRONAUT` grid in the
  generator, two passes per 180 s cycle (left to right high at 9-40 s, then
  right to left low at 99-130 s, flipped to face its way), bob, sway and a
  two-frame leg paddle. It rests hidden (opacity 0), so with motion off it
  never shows. Drawn by the scene itself; no artwork file is copied. Checked
  as rendered from the scene; its flight not yet seen in the app (the window
  was not in front during the capture).
- Verified in the app by screen capture: everything moves; Saturn and its
  rings render cleanly at full resolution.
- Tried and rejected: two stacked Svg leaves in the Backdrop tree (to double
  the size budget). The top layer is transparent, but the app froze both
  layers' animations.
- ROOT CAUSE of frozen scenes (v0.9.0, measured in the app): a viewport
  media query, a CSS mask-image, or (probably) vector-effect anywhere in the
  scene freezes every animation in it. `@media (prefers-reduced-motion)`,
  SMIL discrete/class animations, tspans, gradients by id are fine.
- Lab method (reuse it): a temporary mode in register.tsx that cycles
  `$.theme.set` through variants every 8 s aligned to the wall clock, each
  with SMIL and CSS probe dots; `screencapture` from the shell (Screen
  Recording permission granted) and a PIL script measuring the dots. The
  browser pane often returns black frames for the scene; the app capture
  is the reliable check.
- `/cosmic` applies the theme, `/cosmic off` clears it.
- Published: github.com/Zer0codestuff/cosmic-ascii (public, MIT); the repo
  copy lives in ~/Documents/cosmic-ascii.
- Mobile layout only verified by measurement, not on a device.

## Preferences and constraints

- Everything pure #000000; neutral white accent. Danger, success, warning keep
  red, green, amber for meaning.
- Tilted perspective like the site; planets readable on their night side too.
- Keep the scene under 131,072 characters; the build fails above it.
- The build refuses `href`, `<use>`, inline `style`, `<a>`, viewport media
  queries, `mask-image` and `vector-effect`. ids and `url(#...)` are allowed
  (the shade gradients use them). The app itself drops `<a>`, `image`,
  `foreignObject`, scripts and non-local `href`.
- Keep `width="100%" height="100%"` on the root `<svg>`.
- Never use viewport media queries, CSS `mask-image` or `vector-effect` in
  the scene: each one freezes the whole scene in the desktop app.
- English for all files; no em dashes.

## Do not

- Do not use the real Kepler ratios (outer planets would look frozen).
- Do not fade parts of the Sun toward dark: the owner hated cells "switching off".
- Do not stack two Svg leaves in the backdrop: it freezes them.
- Screen captures for checks only while the Claude window is in front; delete
  any capture that shows another app, unread.
- Do not add a glow or halo around the Sun (owner rejected it).
- Do not make planets dim or their dark side invisible (owner rejected it).
- Do not lighten panels or menus above #000000 unless the owner asks.
- Do not hand-edit `hooks/scene.ts` or `hooks/make-colors.js`.
- Do not ship diagnostic scenes or a look without `colors` in this folder: every new session loads it.
- Do not add viewport media queries, CSS masks or vector-effect to the scene.
- Do not call `$.theme.clear()` at start or reload.
