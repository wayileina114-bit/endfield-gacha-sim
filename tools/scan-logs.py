# -*- coding: utf-8 -*-
import re

for f in [r'D:\Hypergryph Launcher\games\Arknights Endfield\sdklogs\HGEventLog.log',
          r'D:\Hypergryph Launcher\games\Arknights Endfield\sdklogs\u8core_ui_pc.log']:
    print('===', f.split('\\')[-1])
    data = open(f, 'rb').read().decode('utf-8', 'replace')
    urls = re.findall(r'https?://[^\s"\'<>]+', data)
    for u in sorted(set(urls)):
        print(' URL:', u[:170])
    for kw in ['gacha', '寻访', 'token', 'auth', 'record', 'history']:
        hits = [l for l in data.split('\n') if kw in l.lower()]
        if hits:
            print(' [%s] %d 行, 例: %s' % (kw, len(hits), hits[0][:150]))
    print(' 行数:', data.count('\n'))
