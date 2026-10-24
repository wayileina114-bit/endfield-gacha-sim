# -*- coding: utf-8 -*-
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0'}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=60).read()


orig = get('https://web.hycdn.cn/user-center/index.62f8883d.js').decode('utf-8', 'replace')
mine = get('http://127.0.0.1:3276/hgrj?u=https%3A%2F%2Fweb.hycdn.cn%2Fuser-center%2Findex.62f8883d.js').decode('utf-8', 'replace')
print('orig len', len(orig), 'mine len', len(mine))
# 找第一个差异并看上下文
n = min(len(orig), len(mine))
i = 0
while i < n and orig[i] == mine[i]:
    i += 1
print('first diff at', i)
print('--- ORIG ctx ---')
print(orig[max(0, i - 120):i + 160])
print('--- MINE ctx ---')
print(mine[max(0, i - 120):i + 160])
