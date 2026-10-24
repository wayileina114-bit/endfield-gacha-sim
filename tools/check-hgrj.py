# -*- coding: utf-8 -*-
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}

url = 'http://127.0.0.1:3276/hgrj?u=https%3A%2F%2Fweb.hycdn.cn%2Fuser-center%2Findex.62f8883d.js'
req = urllib.request.Request(url, headers=UA)
r = urllib.request.urlopen(req, timeout=60)
body = r.read()
print('status', r.status, 'len', len(body))
head = body[:200]
print('head:', head[:120])
# 是否 gzip 魔数 1f 8b
print('gzip magic:', body[:2] == b'\x1f\x8b')
# 文本有效性：开头应是 !function 或 (function 等
txt = body.decode('utf-8', 'replace')
print('starts like JS:', txt.lstrip()[:40])
# 找 /hgrj 替换出现次数
print('hgrj occurrences:', txt.count('/hgrj'))
print('hgr occurrences:', txt.count('/hgr?'))
# 用 node 检查语法（保存后检查）
open('tools/relayed-bundle.js', 'wb').write(body)
