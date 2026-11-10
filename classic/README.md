# zhelinqi — personal site

Static, zero-dependency personal website for Zhe Linqi. No build step, no framework —
deployable anywhere that serves static files.

```
index.html            structure & content
styles.css            warm ivory light theme; animation on transform/opacity only
main.js               hero flow-field canvas, scroll reveals, nav, energy-field slider
assets/portrait.jpg   Life-section photo
assets/og.jpg         1200x630 social share image
```

## Run locally

```bash
python3 -m http.server 4173
```

then open http://localhost:4173.

## Deploy

This folder is published with the rest of the site (see the README one level up) and is
served at https://linqizhe07.github.io/classic/. Its canonical and og:url point there; the
share image is the parent site's `assets/og.jpg`. If the site moves to a custom domain,
update those URLs and the JSON-LD one in `index.html` to match the new origin.

## Notes

- **Performance**: both canvases (hero flow field, effort slider) are rAF-driven with
  delta-time compensation — identical speed at 60/120/144 Hz — and pause when
  off-screen or when the tab is hidden. Device-pixel-ratio is capped at 2.
- **The effort slider** is a reimplementation of Claude Code's energy-field slider:
  the field lives only in the fill window left of the handle (right of it is the bare
  track with stop dots), bursts race outward from the handle in Manhattan cell
  distance, cells flash and cool through a discrete 5-step ink ramp, only top-step
  cells breathe, and the first part of the fill sits beyond the energy's reach. It
  snaps to four stops (prompt-only / SFT / RLHF-style / ultra); press, drag, or use
  arrow keys.
- **Accessibility**: `prefers-reduced-motion` freezes both canvases (static drawings
  instead), scroll reveals and the rotating role word stop, and the slider remains a
  real keyboard-operable `role="slider"`. Scroll-reveal hiding is gated on
  `<html class="js">`, so content is never invisible if scripts fail. On small
  screens the nav collapses into a disclosure menu.
- **`?static`** renders everything revealed with no animation (for print pipelines
  and full-page snapshots). **`?probe`** additionally exposes `window.__strip`
  (setTime/fire/state) so tooling can sample exact animation frames.
- The CV PDF is intentionally not included (it contains a phone number). To offer a
  résumé download, drop `cv.pdf` next to `index.html` and add a link.
