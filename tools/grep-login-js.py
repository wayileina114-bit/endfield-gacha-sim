# -*- coding: utf-8 -*-
import re
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}
req = urllib.request.Request('https://web.hycdn.cn/user-center/index.62f8883d.js', headers=UA)
js = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
open('tools/hg-usercenter.js', 'w', encoding='utf-8').write(js)
print('len', len(js))
# 提取所有接口路径
paths = set()
for m in re.finditer(r'"(/[a-zA-Z0-9_/\-]{2,60})"', js):
    p = m.group(1)
    if any(k in p.lower() for k in ['auth', 'login', 'token', 'user', 'account', 'session', 'captcha', 'sms', 'pwd', 'sign']):
        paths.add(p)
print('--- 接口路径 ---')
for p in sorted(paths):
    print(p)
# 域名
doms = set(re.findall(r'https?://([a-z0-9.\-]+)', js))
print('--- 域名 ---')
for d in sorted(doms):
    if 'hyper' in d or 'hycdn' in d:
        print(d)
# password 相关上下文
print('--- password 上下文 ---')
for m in list(re.finditer(r'password', js))[:8]:
    print(' ', js[max(0, m.start() - 100):m.start() + 120].replace('\n', ' ')[:220])
