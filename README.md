# zhelinqi — personal site

A void, a small archipelago of paper islands drawn in WebGL, and a desk of pixel windows over it.
Scrolling flies the camera from island to island; each window's island comes into view as its window
reaches the middle of the screen. The look follows [0z5a.github.io](https://0z5a.github.io/).

Static, zero-dependency, no build step — deployable anywhere that serves files.

```
index.html              structure and all copy, in English and Chinese
styles.css              the windows, keys and layout; light (ivory paper) and dark (void) themes
main.js                 language, theme, which window is in front, dragging, labels on the islands
scene.js                the WebGL scene: builder, islands, camera path, render loop (window.Scene)
assets/fonts/           Fusion Pixel 12px, cut down to the characters the page uses (16 KB together)
assets/portrait.jpg     the photograph in "Beyond the lab"
assets/og.jpg           1200x630 social share image
tools/subset-fonts.py   re-cuts the fonts after the copy changes (see below)
tools/fonts-src/        the full fonts the subsets are cut from (the page never loads them)
classic/                the earlier warm-ivory site, kept as it was, served at /classic/
```

## Run locally

```bash
python3 -m http.server 4173
```

then open http://localhost:4173.

## Deploy

The site is served by GitHub Pages at https://linqizhe07.github.io, straight from the `main` branch
of [`linqizhe07/linqizhe07.github.io`](https://github.com/linqizhe07/linqizhe07.github.io).
Publishing is a commit and a push:

```bash
git push
```

Pages rebuilds in about a minute. `.nojekyll` tells it to serve the files as they are, with no
Jekyll pass. Everything in the repository is served, `tools/` and the READMEs included; `.claude/`
and the old Vercel link (`.vercel`, `.vercelignore`) are kept out by `.gitignore`. If the site moves
to a custom domain, update the canonical / og:url / og:image / JSON-LD URLs in `index.html` and
`classic/index.html` to the new origin.

## Editing the words

Every piece of copy is in `index.html` twice, side by side: `<span class="en">…</span>` and
`<span class="zh" lang="zh-Hans">…</span>` (or two `<p>`s with those classes). `<html lang>` decides
which one shows; the 文A key switches and remembers. A first visit follows the browser's language.
The few strings that are not markup (the rotating roles under the name, labels, alt text) are in the
`T` and `MARKS` tables at the top of `main.js`.

**After changing any Chinese text, re-cut the fonts:**

```bash
python3 tools/subset-fonts.py
```

The pixel font ships only the ~330 Han characters on the page. A character added without re-cutting
falls back to a system font and stands out as the one glyph that is not pixels. The script reads
`index.html` and `main.js`, rewrites `assets/fonts/*.woff2`, and prints anything the font cannot draw.
English edits never need it (all of ASCII and Latin-1 is included). It needs `fonttools` and `brotli`.

## The scene

One island per thing:

| island | what it is | window |
| --- | --- | --- |
| the kiln, centre | FORGE: rewards are written, fired and re-fired; the ring of cubes round its neck is the population | Research |
| the planet in a sagging net | Gravit: what it pulls, orbits. The meter in the Now window turns it faster | Now |
| the lab floor | Phibotics: a humanoid on a treadmill, an arm sorting cubes, a reward curve on the board | Experience |
| the notice board | Bounty.ai: posted bounties, the agents reading them, a coin | Experience |
| the clock tower | Philadelphia / Penn, with a GRASP quadrotor overhead | Education |
| the pagoda and moon bridge | Hangzhou / ZJU | Education |
| the pitch | football, because the lab is not everything | Beyond the lab |

Everything is built in code in `scene.js` from boxes, lofted rings and flat cut-outs; nothing is loaded.
Each face gets one of four flat tones from a fixed light, as a palette index, so a theme is 24 colours
in a uniform and nothing is rebuilt when it changes. The static world is one vertex buffer and one draw
call; whatever moves is re-posed on the CPU into a second small buffer each frame.

- **Camera**: `STOPS` in `scene.js` is one position/target/field-of-view per window, joined by a
  Catmull-Rom curve. `main.js` maps scroll positions to stops (`layout()`): on wide screens a stop is
  reached when its window is centred; on narrow ones, in the open stretch above the window, since the
  window then covers the view.
- **Looking around while editing**, from the console: `Scene.dbg.cam([x,y,z],[x,y,z],fov)` places the
  camera, `Scene.dbg.stop(3)` goes to a stop, `Scene.dbg.time(8)` freezes the clock, `Scene.dbg.draw()`
  draws one frame now, `Scene.dbg.free()` hands control back to the scroll.
- **Islands** are placed in `ISL` (position, turn); moving one moves its label, chain and animations.

## Notes

- **Performance**: rAF-driven with delta-time damping (identical feel at 60/120/144 Hz), paused when
  the tab is hidden, device-pixel-ratio capped at 2, and resolution steps down rather than frames being
  dropped on slow machines. Matrices come from a per-frame pool, so the loop allocates nothing. The DOM
  over the canvas only ever animates `transform` and `opacity`.
- **Type**: the pixel face is drawn on a 12px grid and has one weight, so it is only set at 12px or
  sizes that land on whole device pixels (`--m` is 18px at 2x, 16px at 3x, 24px at 1x), with font
  smoothing off. Emphasis is a highlighter stroke, not bold.
- **Accessibility**: real headings, links and form controls throughout; the meter is a radio group.
  `prefers-reduced-motion` stops every animation and the camera no longer flies: it stands at the stop
  nearest the scroll and cuts to the next. Without WebGL the page is the same windows over a plain
  ground. Both languages are in the markup with `lang` set.
- **`?static`** renders one still frame and runs nothing (snapshots, print).
- **Fonts**: Fusion Pixel by TakWolf, SIL Open Font License 1.1 — licence text in `assets/fonts/OFL.txt`.
- The CV PDF is intentionally not included (it contains a phone number).
