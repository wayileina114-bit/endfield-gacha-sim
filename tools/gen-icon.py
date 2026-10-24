# gen-icon.py - generate the launcher icon set (brand: amber hexagon on deep-space navy).
# Outputs under android/res/:
#   mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png          (legacy, full-bleed)
#   mipmap-*/ic_launcher_foreground.png                              (adaptive foreground, transparent)
#   mipmap-anydpi-v26/ic_launcher.xml                                (adaptive icon definition)
#   values/ic_launcher.xml                                           (background color)
from PIL import Image, ImageDraw, ImageFilter
import os, math

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(ROOT, 'android', 'res')
AMBER = (245, 166, 35)
AMBER_HI = (255, 212, 121)
NAVY_TOP = (13, 19, 34)
NAVY_BOT = (6, 9, 16)

def hex_points(cx, cy, r):
    # pointy-top hexagon (matches the in-app brand mark)
    return [(cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
            for a in (-90, -30, 30, 90, 150, 210)]

def draw_mark(size, scale=1.0, glow=True):
    """Draw hexagon mark on a size x size RGBA canvas, content scaled by `scale`."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    r_out = size * 0.36 * scale

    # soft glow under the outer hexagon
    if glow:
        glow_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow_layer)
        gd.line(hex_points(cx, cy, r_out) + [hex_points(cx, cy, r_out)[0]],
                fill=AMBER + (110,), width=int(size * 0.035), joint='curve')
        glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(size * 0.045))
        img.alpha_composite(glow_layer)

    # outer hexagon outline (two passes: hi-light edge + main)
    pts = hex_points(cx, cy, r_out) + [hex_points(cx, cy, r_out)[0]]
    d.line(pts, fill=AMBER_HI + (255,), width=int(size * 0.012), joint='curve')
    d.line(pts, fill=AMBER + (255,), width=int(size * 0.028), joint='curve')

    # inner filled hexagon
    r_in = r_out * 0.46
    d.polygon(hex_points(cx, cy, r_in), fill=AMBER + (255,))
    return img

def gradient_bg(size):
    img = Image.new('RGBA', (size, size))
    top, bot = NAVY_TOP, NAVY_BOT
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = c
    return img

DENSITIES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
MASTER = 512

os.makedirs(RES, exist_ok=True)
for dpi, px in DENSITIES.items():
    d = os.path.join(RES, 'mipmap-' + dpi)
    os.makedirs(d, exist_ok=True)
    # legacy: gradient bg + mark
    icon = gradient_bg(MASTER)
    icon.alpha_composite(draw_mark(MASTER))
    icon.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
    # adaptive foreground: transparent, mark fits center ~62% (safe zone)
    fg = draw_mark(MASTER, scale=0.78, glow=False)
    fg.resize((px * 2, px * 2), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
    print(f'mipmap-{dpi}: ic_launcher.png + ic_launcher_foreground.png ({px}px)')

# adaptive icon xml (API 26+)
ad_dir = os.path.join(RES, 'mipmap-anydpi-v26')
os.makedirs(ad_dir, exist_ok=True)
with open(os.path.join(ad_dir, 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n'
            '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
            '  <background android:drawable="@color/ic_launcher_background"/>\n'
            '  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
            '</adaptive-icon>\n')
v_dir = os.path.join(RES, 'values')
os.makedirs(v_dir, exist_ok=True)
with open(os.path.join(v_dir, 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n'
            '<resources>\n  <color name="ic_launcher_background">#0A0E18</color>\n</resources>\n')
print('adaptive icon xml + background color written')
