# -*- coding: utf-8 -*-
"""分析 user.hypergryph.com 登录页的真实提交端点"""
import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0'}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')


page = get('https://user.hypergryph.com/')
open('tools/hg-login-page.html', 'w', encoding='utf-8').write(page)
print('page len', len(page))
# 找 JS 资源
srcs = re.findall(r'src="([^"]+\.js[^"]*)"', page)
print('scripts:', srcs[:12])
for s in srcs[:8]:
    url = s if s.startswith('http') else 'https://user.hypergryph.com' + (s if s.startswith('/') else '/' + s)
    try:
        js = get(url)
    except Exception as e:
        print('skip', url, e)
        continue
    hits = set()
    for m in re.finditer(r'https?://[a-z0-9.\-]*hypergryph\.com[/a-zA-Z0-9_\-\.]*', js):
        hits.add(m.group(0))
    auths = set()
    for m in re.finditer(r'["\'/]([a-zA-Z0-9_/\-]*(?:auth|login|token|session)[a-zA-Z0-9_/\-]*)["\']', js):
        auths.add(m.group(1))
    print('==', url[-60:], 'len', len(js))
    for h in sorted(hits)[:15]:
        print('   url:', h)
    for a in sorted(auths)[:15]:
        print('   api:', a)
