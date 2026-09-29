# 网页版（PWA）图标：只从 assets/icon.png 缩放，只写 pwa/icons/（design.md 8.8、内部 PWA 计划（未公开） M2）。
# 不动 make-icons.py 和 assets/。Pillow 不进项目依赖：
#   uv run --no-project --with pillow python scripts/make-pwa-icons.py
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'assets' / 'icon.png').convert('RGB')
out = root / 'pwa' / 'icons'
out.mkdir(exist_ok=True)

for size in (180, 192, 512):
    src.resize((size, size), Image.LANCZOS).save(out / f'icon-{size}.png', optimize=True)

# maskable：系统会按圆形 / 圆角裁掉外圈，图标缩到 80% 的安全区里，外圈用原图左上角的底色补满
bg = src.getpixel((0, 0))
canvas = Image.new('RGB', (512, 512), bg)
inner = round(512 * 0.8)
canvas.paste(src.resize((inner, inner), Image.LANCZOS), ((512 - inner) // 2, (512 - inner) // 2))
canvas.save(out / 'maskable-512.png', optimize=True)
print('bg', bg, 'wrote', sorted(p.name for p in out.iterdir()))
