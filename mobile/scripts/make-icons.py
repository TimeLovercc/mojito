# App icons from the SVG logo (mobile/README.md "App icon"). Writes every icon file of the mobile app and the
# desktop app; the logo SVGs are the only sources. Pillow is not a project dependency; needs rsvg-convert (librsvg)
# and macOS iconutil (for icon.icns):
#   uv run --no-project --with pillow python scripts/make-icons.py \
#     ../docs/media/logo.svg ../docs/media/logo-mono.svg assets ../desktop/src-tauri/icons
# then scripts/make-pwa-icons.py for the web app's icons (made from assets/icon.png).
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

logo_svg, mono_svg, assets, desktop = (Path(a) for a in sys.argv[1:])
WORK = Path(tempfile.mkdtemp(prefix="icons-"))
MARK_PX = 2048  # the logo is rendered once this large, then scaled down per icon

BG_TOP, BG_BOTTOM, BG_FLAT = "#F3FBF6", "#D3EFDD", "#E6F5EB"
GRADIENT = (f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{BG_TOP}"/>'
            f'<stop offset="1" stop-color="{BG_BOTTOM}"/></linearGradient>')
BACKGROUNDS = {
    # full-bleed square: the launcher / iOS applies its own mask. Flat, because make-pwa-icons.py pads the
    # maskable PWA icon with this image's corner colour
    "square": f'<rect width="1024" height="1024" fill="{BG_FLAT}"/>',
    # macOS tile on the Apple icon grid (824 px rounded square on a 1024 canvas, soft shadow)
    "tile": (f'<defs>{GRADIENT}<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">'
             '<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.25"/></filter></defs>'
             '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/>'),
    # round badge: widget header, chat avatar, menu bar
    "circle": f'<defs>{GRADIENT}</defs><circle cx="512" cy="512" r="512" fill="url(#bg)"/>',
}


def render(svg: Path, px: int) -> Image.Image:
    out = WORK / f"{svg.stem}-{px}.png"
    subprocess.run(["rsvg-convert", "-w", str(px), "-h", str(px), "-o", str(out), str(svg)], check=True)
    return Image.open(out).convert("RGBA")


def background(name: str, px: int) -> Image.Image:
    svg = WORK / f"bg-{name}.svg"
    svg.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">{BACKGROUNDS[name]}</svg>')
    return render(svg, px)


def trimmed(svg: Path) -> Image.Image:
    img = render(svg, MARK_PX)
    return img.crop(img.getchannel("A").getbbox())


def reach(mark: Image.Image) -> float:
    """Farthest visible pixel from the mark's centre, as a fraction of its longer side (for round masks)."""
    small = mark.resize((256 * mark.width // max(mark.size), 256 * mark.height // max(mark.size)), Image.LANCZOS)
    alpha, (w, h) = small.getchannel("A"), small.size
    far = max(((x + 0.5 - w / 2) ** 2 + (y + 0.5 - h / 2) ** 2) ** 0.5
              for y in range(h) for x in range(w) if alpha.getpixel((x, y)) > 8)
    return far / 256


def place(canvas: Image.Image, mark: Image.Image, side: float) -> Image.Image:
    """Mark scaled so its longer side is `side` of the canvas, centred."""
    s = side * canvas.width / max(mark.size)
    m = mark.resize((round(mark.width * s), round(mark.height * s)), Image.LANCZOS)
    out = canvas.copy()
    out.alpha_composite(m, ((canvas.width - m.width) // 2, (canvas.height - m.height) // 2))
    return out


def in_circle(radius: float, mark: Image.Image) -> float:
    """The `side` for place() that keeps the whole mark within `radius` (fraction of the canvas) of the centre."""
    return radius / reach(mark)


def clear(px: int) -> Image.Image:
    return Image.new("RGBA", (px, px), (0, 0, 0, 0))


def shrink(img: Image.Image, px: int) -> Image.Image:
    return img if img.width == px else img.resize((px, px), Image.LANCZOS)


mark, mono = trimmed(logo_svg), trimmed(mono_svg)

# ---- mobile/assets
square = place(background("square", 1600), mark, 0.72)
square.convert("RGB").save(assets / "icon-source.webp", "WEBP", quality=92)
shrink(square, 1024).convert("RGB").save(assets / "icon.png")
# adaptive icon: 108 dp canvas, launchers show a 66 dp safe circle (radius 0.306 of the canvas); keep a margin
place(clear(1024), mark, in_circle(0.28, mark)).save(assets / "android-icon-foreground.png")
place(clear(1024), mono, in_circle(0.28, mono)).save(assets / "android-icon-monochrome.png")
place(clear(1024), mark, 0.62).save(assets / "splash-icon.png")
shrink(place(clear(1024), mark, 0.96), 48).save(assets / "favicon.png")
badge = place(background("circle", 512), mark, in_circle(0.42, mark))
shrink(badge, 96).save(assets / "widget-avatar.png")

# ---- desktop/src-tauri/icons
shrink(badge, 36).save(desktop / "tray.png")  # menu bar: 18 pt @2x
tile = place(background("tile", 1024), mark, 0.58)
for name, px in (("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)):
    shrink(tile, px).save(desktop / name)
iconset = WORK / "icon.iconset"
iconset.mkdir()
for pt in (16, 32, 128, 256, 512):
    shrink(tile, pt).save(iconset / f"icon_{pt}x{pt}.png")
    shrink(tile, pt * 2).save(iconset / f"icon_{pt}x{pt}@2x.png")
subprocess.run(["iconutil", "-c", "icns", "-o", str(desktop / "icon.icns"), str(iconset)], check=True)
print(f"icons written to {assets} and {desktop}")
