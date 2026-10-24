# -*- coding: utf-8 -*-
import json
import urllib.request

UA = {'User-Agent': 'EndfieldGachaSim/1.0'}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read()


repo = json.loads(get('https://api.github.com/repos/bhaoo/endfield-gacha'))
branch = repo.get('default_branch', 'main')
print('default branch:', branch)
d = json.loads(get('https://api.github.com/repos/bhaoo/endfield-gacha/git/trees/%s?recursive=1' % branch))
paths = [t['path'] for t in d.get('tree', [])]
print('total:', len(paths))
for p in paths:
    if any(k in p.lower() for k in ['auth', 'token', 'login', 'gacha', 'api']):
        print(p)
