#!/usr/bin/env python3
"""Cut Fusion Pixel 12px down to the characters the page actually uses.

    python3 tools/subset-fonts.py

Reads every character in index.html and main.js, then writes two small woff2 files into assets/fonts/:

  fusion-pixel-12px-latin.woff2   all of printable ASCII and Latin-1, plus whatever other non-CJK
                                  symbols the page uses (arrows, the sun and moon on the theme key, ...)
  fusion-pixel-12px-zh.woff2      only the Han characters and full-width punctuation on the page

Run it again after editing any Chinese text, or a new character will fall back to the system font and
stand out as the one glyph that is not pixels. The script prints anything the font cannot draw.

The full fonts live in tools/fonts-src/ (from https://github.com/TakWolf/fusion-pixel-font/releases,
"12px proportional otf.woff2"; SIL Open Font License 1.1, no reserved font name). Needs fonttools and brotli:

    pip install fonttools brotli
"""
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "fonts-src"
OUT = ROOT / "assets" / "fonts"
PAGES = ["index.html", "main.js"]

# Must match the unicode-range of the second @font-face in styles.css.
CJK = [(0x2E80, 0x2FDF), (0x3000, 0x303F), (0x31C0, 0x31EF), (0x3400, 0x4DBF),
       (0x4E00, 0x9FFF), (0xF900, 0xFAFF), (0xFE30, 0xFE4F), (0xFF00, 0xFFEF)]


def is_cjk(cp):
    return any(a <= cp <= b for a, b in CJK)


def cut(src, dst, cps):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["kern", "ccmp", "calt", "locl", "mark", "mkmk"]
    opts.name_IDs = ["*"]          # keep the copyright and licence records in the file
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.hinting = False
    opts.drop_tables += ["vhea", "vmtx", "VORG"]
    font = TTFont(str(src))
    have = font.getBestCmap()
    missing = sorted(cp for cp in cps if cp not in have)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(cp for cp in cps if cp in have))
    sub.subset(font)
    font.flavor = "woff2"
    font.save(str(dst))
    return missing


def main():
    used = set()
    for name in PAGES:
        used.update(ord(ch) for ch in (ROOT / name).read_text(encoding="utf-8"))
    used = {cp for cp in used if cp >= 0x20 and cp != 0x7F}

    latin = {cp for cp in used if not is_cjk(cp)}
    latin.update(range(0x20, 0x7F))        # all of ASCII: English edits never need a re-cut
    latin.update(range(0xA0, 0x100))       # Latin-1: accents, ©, ·, ×
    latin.update([0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026,
                  0x2190, 0x2191, 0x2192, 0x2193, 0x2197, 0x2600, 0x263E, 0x2709])
    han = {cp for cp in used if is_cjk(cp)}

    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [("fusion-pixel-12px-latin.woff2", latin), ("fusion-pixel-12px-zh.woff2", han)]
    bad = False
    for name, cps in jobs:
        src, dst = SRC / name, OUT / name
        if not src.exists():
            sys.exit("missing source font: %s (see the note at the top of this file)" % src)
        missing = cut(src, dst, cps)
        # only characters the page really uses count as a problem; the padding above is best-effort
        missing = [cp for cp in missing if cp in used]
        print("%-32s %4d characters  %6.1f KB" % (name, len(cps), dst.stat().st_size / 1024))
        if missing:
            bad = True
            print("   not in the font, will fall back to a system face:",
                  " ".join("%s (U+%04X)" % (chr(cp), cp) for cp in missing))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
