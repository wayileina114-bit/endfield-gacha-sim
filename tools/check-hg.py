# -*- coding: utf-8 -*-
import os
import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')


d = get('http://127.0.0.1:3276/hglogin')
print('relay len', len(d))
print('has #app:', 'id="app"' in d)
print('scripts:', re.findall(r'src="([^"]+\.js[^"]*)"', d))
print('tail:', d[-400:].replace('\n', ' '))

direct = get('https://user.hypergryph.com/')
print('--- official direct len', len(direct), 'has #app:', 'id="app"' in direct)
print('official scripts:', re.findall(r'src="([^"]+\.js[^"]*)"', direct))

req = urllib.request.Request('https://web.hycdn.cn/user-center/index.62f8883d.js', headers=UA)
try:
    r = urllib.request.urlopen(req, timeout=30)
    print('CDN js status', r.status, 'len', len(r.read()))
except Exception as e:
    print('CDN js ERR', e)
