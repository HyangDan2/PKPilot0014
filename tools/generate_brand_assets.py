#!/usr/bin/env python3
"""
PKPilot0014 · Sága Glitra — HD2Lab brand asset generator (Soft Iris)
====================================================================
Produces the official HD2Lab asset set for Sága Glitra out of the same
dual-skew mark the app header uses:

    favicon.svg, favicon.ico(16/32/48), favicon-32x32.png,
    apple-touch-icon.png(180), icon-192.png, icon-512.png,
    manifest.json,
    og-image.png / social-preview.png (1200×630)

    python3 tools/generate_brand_assets.py [--font PATH] [--out DIR]
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFont

try:
    import cairosvg
except ImportError:  # pragma: no cover
    cairosvg = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── brand tokens (HD2Lab Soft Iris) ─────────────────────────────────────────
BG = "#FAFAFD"
GRID = "#EFEDF7"
CARD = "#FFFFFF"
CARD_BORDER = "#E8E4F2"
TILE = "#FFFFFF"
TILE_BORDER = "#E7E2F5"
INK = "#1B1A24"
PURPLE = "#8B6CE8"
PURPLE_DEEP = "#6D4AE2"
TEXT = "#3A3749"
MUTED = "#6E6A80"
DIM = "#9B97AB"
LINE = "#E5E0F1"
MARK_BG = "#FAFAFD"
MARK_EDGE = "#E8E4F2"

MARK_PATH = "M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z"
MASK_BG = "#F1ECFE"
MASK_EDGE = "#A78BFA"

FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<rect width="64" height="64" rx="12" fill="{MARK_BG}" stroke="{MARK_EDGE}" stroke-width="2"/>'
    f'<path d="{MARK_PATH}" fill="none" stroke="{PURPLE}" stroke-width="4"/></svg>\n'
)

MARK_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
    f'<path d="{MARK_PATH}" fill="none" stroke="{PURPLE}" stroke-width="4"/></svg>'
)

FONT_CANDIDATES = [
    os.environ.get("PICKLE_BRAND_FONT", ""),
    "/workspace/tmp-fonts/NotoSansKR-VF.ttf",
    os.path.join(ROOT, "..", "..", "tmp-fonts", "NotoSansKR-VF.ttf"),
    "/usr/share/fonts/truetype/noto/NotoSansKR-VF.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansKR-Regular.otf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
]
MONO_CANDIDATES = [
    "/usr/share/fonts/pickle-hwp/NotoSansMonoCJKkr-Regular.otf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]

_font_cache: dict = {}
FONT_PATH = next((p for p in FONT_CANDIDATES if p and os.path.exists(p)), None)
MONO_PATH = next((p for p in MONO_CANDIDATES if p and os.path.exists(p)), None)


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    key = ("sans", size, weight)
    if key in _font_cache:
        return _font_cache[key]
    if not FONT_PATH:
        raise SystemExit("한글 폰트를 찾지 못했습니다. --font 로 지정해 주세요.")
    f = ImageFont.truetype(FONT_PATH, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    _font_cache[key] = f
    return f


def mono(size: int) -> ImageFont.FreeTypeFont:
    key = ("mono", size, "Regular")
    if key in _font_cache:
        return _font_cache[key]
    f = ImageFont.truetype(MONO_PATH or FONT_PATH, size)
    _font_cache[key] = f
    return f


def spaced(d, xy, text, f, fill, spacing=0.0, anchor="l"):
    total = sum(d.textlength(ch, font=f) for ch in text) + spacing * max(0, len(text) - 1)
    x = xy[0] - (total / 2 if anchor == "m" else total if anchor == "r" else 0)
    for ch in text:
        d.text((x, xy[1]), ch, font=f, fill=fill, anchor="ls")
        x += d.textlength(ch, font=f) + spacing
    return total


# ── vector rasterisation ────────────────────────────────────────────────────
def render_svg(svg: str, px: int) -> Image.Image:
    if cairosvg is None:
        raise SystemExit("cairosvg 가 필요합니다: pip install cairosvg")
    buf = io.BytesIO()
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=buf,
                     output_width=px, output_height=px)
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def render_mark(px: int) -> Image.Image:
    return render_svg(MARK_SVG, px)


# ── icon set ────────────────────────────────────────────────────────────────
def build_icons(out_dir: str):
    with open(os.path.join(out_dir, "favicon.svg"), "w", encoding="utf-8") as fh:
        fh.write(FAVICON_SVG)

    master = render_svg(FAVICON_SVG, 1024)
    made = [("favicon.svg", (64, 64))]
    for name, size in [("favicon-32x32.png", 32), ("apple-touch-icon.png", 180),
                       ("icon-192.png", 192), ("icon-512.png", 512)]:
        master.resize((size, size), Image.LANCZOS).save(
            os.path.join(out_dir, name), "PNG", optimize=True)
        made.append((name, (size, size)))

    ico = master.resize((256, 256), Image.LANCZOS).convert("RGBA")
    ico.save(os.path.join(out_dir, "favicon.ico"), format="ICO",
             sizes=[(16, 16), (32, 32), (48, 48)])
    made.append(("favicon.ico", (48, 48)))
    return made


# ── manifest ────────────────────────────────────────────────────────────────
MANIFEST = {
    "name": "HD2Lab Sága Glitra",
    "short_name": "Sága Glitra",
    "description": "마크다운으로 덱을 만들고 슬라이드마다 1:1로 묶인 노트·형광펜 필기·"
                   "가림막 암기·집중 타이머로 공부하는 브라우저 로컬 공부방 스튜디오.",
    "lang": "ko",
    "dir": "ltr",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#FAFAFD",
    "theme_color": "#FAFAFD",
    "categories": ["education", "productivity"],
    "icons": [
        {"src": "favicon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any"},
        {"src": "favicon-32x32.png", "sizes": "32x32", "type": "image/png", "purpose": "any"},
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "apple-touch-icon.png", "sizes": "180x180", "type": "image/png", "purpose": "any"},
    ],
}


def build_manifest(out_dir: str) -> str:
    path = os.path.join(out_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(MANIFEST, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    return path


# ── OG card ─────────────────────────────────────────────────────────────────
S = 2  # supersampling: draw at 2400×1260, ship 1200×630


def sc(*v):
    return tuple(int(round(x * S)) for x in v)


def rrect(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline,
                        width=max(1, int(round(width))))


def build_og(out_dir: str) -> str:
    W, H = 1200 * S, 630 * S
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 1) Soft Iris grid + white container card
    for x in range(0, W + 1, 40 * S):
        d.line([(x, 0), (x, H)], fill=GRID)
    for y in range(0, H + 1, 40 * S):
        d.line([(0, y), (W, y)], fill=GRID)
    rrect(d, sc(56, 30, 1144, 600), 26 * S, fill=CARD, outline=CARD_BORDER, width=1.4 * S)

    # 2) kicker + privacy mark
    r = 5 * S
    d.ellipse((104 * S - r, 90 * S - r, 104 * S + r, 90 * S + r), fill=PURPLE)
    spaced(d, (124 * S, 96 * S), "04 / STUDY · SÁGA GLITRA",
           font(14 * S, "Medium"), MUTED, spacing=2.2 * S)
    d.text((1096 * S, 96 * S), "LOCAL ONLY · 0 B UPLOAD", font=mono(13 * S), fill=DIM, anchor="rs")

    # 3) dual-skew mark + HD2Lab | Sága Glitra
    mark = render_mark(100 * S)
    img.paste(mark, (84 * S, 120 * S), mark)

    base_y = 194
    f_title = font(58 * S, "SemiBold")
    d.text((224 * S, base_y * S), "HD2Lab", font=f_title, fill=INK, anchor="ls")
    pipe_x = 224 * S + d.textlength("HD2Lab", font=f_title) + 18 * S
    d.line([(pipe_x, (base_y - 40) * S), (pipe_x, (base_y + 2) * S)],
           fill="#D9D2EE", width=int(2.5 * S))
    d.text((pipe_x + 20 * S, base_y * S), "Sága Glitra", font=f_title, fill=PURPLE, anchor="ls")

    # 4) headline + sub copy
    f_head = font(46 * S, "Bold")
    d.text((104 * S, 262 * S), "읽고, 필기하고,", font=f_head, fill=INK, anchor="ls")

    lead = "가려서 "
    hl = "외운다"
    tail = "."
    x = 104 * S
    d.text((x, 318 * S), lead, font=f_head, fill=INK, anchor="ls")
    x += d.textlength(lead, font=f_head)
    # the masked keyword sits on a lavender cover chip
    kw_w = d.textlength(hl, font=f_head)
    rrect(d, (x - 6 * S, 318 * S - 34 * S, x + kw_w + 6 * S, 318 * S + 8 * S), 6 * S,
          fill=MASK_BG, outline=MASK_EDGE, width=1.2 * S)
    d.text((x, 318 * S), hl, font=f_head, fill=PURPLE_DEEP, anchor="ls")
    x += kw_w + 9 * S
    d.text((x, 318 * S), tail, font=f_head, fill=INK, anchor="ls")

    d.text((105 * S, 358 * S),
           "랜딩의 강의 라이브러리 · 마크다운 덱 16:9 · 슬라이드 1:1 노트 ·",
           font=font(17.5 * S), fill=MUTED)
    d.text((105 * S, 386 * S),
           "==가림막== 암기 · 형광펜/펜 필기 · 25:00 집중 타이머 · 100% 로컬",
           font=font(17.5 * S), fill=MUTED)

    # 5) three tiles
    tiles = [
        ("01 / LIBRARY", "강의 라이브러리", ["랜딩에서 모든 덱을 한눈에,", "카드를 누르면 바로 공부방."]),
        ("02 / NOTE", "슬라이드 1:1 노트", ["넘기면 노트도 함께,", "IndexedDB에 자동 저장."]),
        ("03 / RECALL", "가림막 · 필기 · 타이머", ["가려서 외우고, 그어 두고,", "25분씩 집중합니다."]),
    ]
    tile_w, gap, th, top = 264, 16, 126, 414
    for i, (kicker, heading, desc) in enumerate(tiles):
        x0 = 96 + i * (tile_w + gap)
        rrect(d, sc(x0, top, x0 + tile_w, top + th), 10 * S,
              fill=TILE, outline=TILE_BORDER, width=1.2 * S)
        d.text(((x0 + 18) * S, (top + 26) * S), kicker,
               font=mono(8.5 * S), fill=PURPLE)
        d.text(((x0 + 18) * S, (top + 54) * S), heading,
               font=font(18 * S, "SemiBold"), fill=INK)
        d.text(((x0 + 18) * S, (top + 81) * S), desc[0], font=font(11.5 * S), fill=MUTED)
        d.text(((x0 + 18) * S, (top + 100) * S), desc[1], font=font(11.5 * S), fill=MUTED)

    # 6) footer rail
    d.line([(104 * S, 566 * S), (1096 * S, 566 * S)], fill=LINE, width=int(1 * S))
    spaced(d, (104 * S, 588 * S), "MARKDOWN SLIDE × STUDY ROOM · SÁGA GLITRA",
           font(11.5 * S, "Medium"), MUTED, spacing=1.5 * S)
    d.text((1096 * S, 588 * S), "hyangdan2.github.io/PKPilot0014", font=mono(11.5 * S),
           fill=DIM, anchor="rs")

    out = img.resize((1200, 630), Image.LANCZOS)
    path = os.path.join(out_dir, "og-image.png")
    out.save(path, "PNG", optimize=True)
    out.save(os.path.join(out_dir, "social-preview.png"), "PNG", optimize=True)
    return path


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser(description="PKPilot0014 (Sága Glitra) 브랜드 에셋 생성")
    ap.add_argument("--font")
    ap.add_argument("--out", default=os.path.join(ROOT, "public"))
    args = ap.parse_args()

    global FONT_PATH
    if args.font:
        FONT_PATH = args.font

    os.makedirs(args.out, exist_ok=True)
    icons = build_icons(args.out)
    build_manifest(args.out)
    og = build_og(args.out)

    brand_dir = os.path.join(args.out, "brand")
    os.makedirs(brand_dir, exist_ok=True)
    for name, _ in icons:
        shutil.copyfile(os.path.join(args.out, name), os.path.join(brand_dir, name))

    print("아이콘")
    for name, size in icons:
        p = os.path.join(args.out, name)
        print(f"  {name:22s} {size[0]}x{size[1]:<4d} {os.path.getsize(p):>8,d} B")
    print("  manifest.json")
    print(f"OG\n  {os.path.basename(og):22s} 1200x630 {os.path.getsize(og):>8,d} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
