# -*- coding: utf-8 -*-
import json
import os
import re

base = os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph\Endfield\ClientData\User')
for uid in os.listdir(base):
    p = os.path.join(base, uid, 'Default.json')
    if not os.path.isfile(p):
        continue
    print('=== UID', uid, 'size', os.path.getsize(p))
    data = open(p, 'rb').read().decode('utf-8', 'replace')
    try:
        j = json.loads(data)
        g = j.get('GACHA')
        print('GACHA 段落 keys:', list(g.keys()) if isinstance(g, dict) else type(g))
        s = json.dumps(g, ensure_ascii=False, indent=1)
        print(s[:3000])
    except Exception as e:
        # 可能是其他结构，直接搜 GACHA 附近文本
        i = data.find('GACHA')
        print('json err', e, '；原文片段：')
        print(data[max(0, i - 100):i + 2500])
