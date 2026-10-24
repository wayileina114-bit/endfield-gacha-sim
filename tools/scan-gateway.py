# -*- coding: utf-8 -*-
import os
import re

g = r'D:\Hypergryph Launcher\games\Arknights Endfield'
# config.ini
p = os.path.join(g, 'config.ini')
if os.path.isfile(p):
    print('=== config.ini ===')
    print(open(p, 'rb').read().decode('utf-8', 'replace')[:800])

# webview 配置
p = os.path.join(g, 'WebviewConfig')
if os.path.isdir(p):
    for f in os.listdir(p):
        print('WebviewConfig/', f)
        fp = os.path.join(p, f)
        if f.endswith(('.json', '.ini', '.txt', '.xml')):
            print(open(fp, 'rb').read().decode('utf-8', 'replace')[:600])

# HGWebview.log 中 SetAccountToken 上下文与 URL
lp = os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph\Endfield\sdklogs\HGWebview.log')
data = open(lp, 'rb').read().decode('utf-8', 'replace')
lines = data.split('\n')
shown = 0
for i, l in enumerate(lines):
    if 'SetAccountToken' in l and shown < 2:
        print('=== HGWebview ctx ===')
        print('\n'.join(lines[max(0, i - 4):i + 4])[:1200])
        shown += 1
urls = re.findall(r'https?://[^\s"\'<>]+', data)
print('HGWebview URLs:', len(set(urls)))
for u in sorted(set(urls))[:20]:
    print(' ', u[:150])

# Player.log 里找 gateway/api 域名
for name in ['Player.log', 'Player-prev.log']:
    p2 = os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph\Endfield' + '\\' + name)
    if not os.path.isfile(p2):
        continue
    d2 = open(p2, 'rb').read().decode('utf-8', 'replace')
    doms = re.findall(r'https?://([a-z0-9.\-]+)/[^\s]*', d2)
    from collections import Counter
    c = Counter(doms)
    print('===', name, '域名 Top ===')
    for k, v in c.most_common(12):
        print(' ', v, k)
