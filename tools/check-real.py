# -*- coding: utf-8 -*-
import json
import urllib.request

a = json.loads(urllib.request.urlopen('http://127.0.0.1:3276/api/official/analysis?uid=823765354', timeout=30).read())['analysis']
t, lk, py = a['totals'], a['luck'], a['pity']
print('总抽数:', t['totalPulls'], '| 角色:', t['char'], '武器:', t['weapon'])
print('六星(角色):', t['charR'].get('6', 0), '| 五星:', t['charR'].get('5', 0), '| 出率:', lk['sixRate'], '% | 平均每金:', lk['avgPerGold'], '| UP占比:', lk['upShare'], '% | 评级:', lk['rating'])
print('限定保底:', py['limitedPity'], '/80 | 常驻:', py['standardPity'], '/80 | 当前池:', py['currentPool'].get('poolName'), 'UP已得:', py['currentPool'].get('upObtained'))
print('六星记录条数:', len(a['golds']), '| 武器池:', len(a['weaponPools']), '| 月度:', len(a['monthly']))
print('golds样例:', [(g['name'], g['isUp'], g['pity'] + 1) for g in a['golds'][:5]])

p = json.loads(urllib.request.urlopen('http://127.0.0.1:3276/api/official/predict?uid=823765354', timeout=60).read())['prediction']
print('预测目标池:', p['banner']['name'], 'UP:', p['banner']['up6'])
for s in p['scenarios']:
    print(' -', s['name'], '| 期望', s['mean'], '抽 | 中位', s['median'], '| P90', s['p90'], '| ~RMB', s['cost']['cny'])
