# -*- coding: utf-8 -*-
import urllib.request

UA = {'User-Agent': 'EndfieldGachaSim/1.0'}
files = ['app/composables/gacha/useGachaAuth.ts', 'app/composables/useLogin.ts']
for f in files:
    url = 'https://raw.githubusercontent.com/bhaoo/endfield-gacha/master/' + f
    req = urllib.request.Request(url, headers=UA)
    data = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
    out = 'tools/' + f.split('/')[-1]
    open(out, 'w', encoding='utf-8').write(data)
    print('saved', out, len(data))
