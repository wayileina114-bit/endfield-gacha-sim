# -*- coding: utf-8 -*-
"""把 data/imgcache 中的大图原地降采样到最长边 480px（卡片显示尺寸的2倍，兼顾高分屏）。
用法：python tools/downscale-images.py   （需 pillow>=11，自带 AVIF 编解码）
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print('需要 Pillow：python -m pip install --user pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'data', 'imgcache')
MAX_SIDE = 480

total_in = total_out = 0
count = 0
skipped = 0
for base, _, files in os.walk(CACHE):
    for f in files:
        p = os.path.join(base, f)
        if not f.lower().endswith(('.avif', '.webp', '.png', '.jpg')):
            continue
        size_before = os.path.getsize(p)
        try:
            im = Image.open(p)
            w, h = im.size
            if max(w, h) <= MAX_SIDE:
                skipped += 1
                continue
            scale = MAX_SIDE / max(w, h)
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            tmp = p + '.tmp.avif'
            im.save(tmp, 'AVIF', quality=72)
            size_after = os.path.getsize(tmp)
            # 原地替换为 avif 小图（统一扩展名，代理按 avif 服务）
            os.remove(p)
            os.rename(tmp, os.path.splitext(p)[0] + '.avif')
            total_in += size_before
            total_out += size_after
            count += 1
        except Exception as e:
            print('skip', f, e)

print(f'downscaled {count} files, skipped(already small) {skipped}')
if count:
    print(f'size: {total_in/1048576:.1f}MB -> {total_out/1048576:.1f}MB ({total_out*100//total_in}%)')
