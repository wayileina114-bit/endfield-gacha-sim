# -*- coding: utf-8 -*-
import os
import re

# Unity LocalLow 目录
base = os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph')
for root, dirs, files in os.walk(base):
    depth = root[len(base):].count('\\')
    if depth > 2:
        continue
    for f in files:
        p = os.path.join(root, f)
        try:
            sz = os.path.getsize(p)
        except OSError:
            continue
        if sz > 20000000 or f.endswith(('.dll', '.exe', '.png', '.jpg', '.bundle', '.assets', '.resource')):
            continue
        print('%8d  %s' % (sz, p.replace(base, '...')))

print('---- 在文本日志里找 URL/token ----')
pat = re.compile(r'https?://[^\s"\'<>]+|(?:auth_?key|token|gacha|寻访记录)[^\n]{0,80}', re.I)
for root, dirs, files in os.walk(base):
    for f in files:
        if not f.endswith(('.log', '.txt', '.json', '.ini')):
            continue
        p = os.path.join(root, f)
        try:
            data = open(p, 'rb').read().decode('utf-8', 'replace')
        except OSError:
            continue
        hits = pat.findall(data)
        if hits:
            print('==', p.replace(base, '...'))
            for h in sorted(set(hits))[:15]:
                print('   ', h[:150])
