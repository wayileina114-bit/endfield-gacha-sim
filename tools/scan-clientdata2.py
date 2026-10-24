# -*- coding: utf-8 -*-
import json
import os
import re

base = os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph\Endfield\ClientData\User')
for uid in os.listdir(base):
    d = os.path.join(base, uid)
    print('=== UID', uid)
    for f in os.listdir(d):
        p = os.path.join(d, f)
        print('  ', f, os.path.getsize(p) if os.path.isfile(p) else '<dir>')
    p = os.path.join(d, 'Default.json')
    data = open(p, 'rb').read().decode('utf-8', 'replace')
    # GACHA 出现的所有位置
    for m in re.finditer(r'GACHA', data):
        print('  ctx:', data[max(0, m.start() - 60):m.start() + 400].replace('\n', ' ')[:460])
        break
    try:
        j = json.loads(data)
        def walk(o, path=''):
            if isinstance(o, dict):
                for k, v in o.items():
                    if 'gacha' in str(k).lower() or (isinstance(v, (str, int, float)) and 'gacha' in str(v).lower()):
                        print('  hit:', path + '/' + str(k), '=', str(v)[:200])
                    walk(v, path + '/' + str(k))
        walk(j)
    except Exception as e:
        print('  parse err', e)
