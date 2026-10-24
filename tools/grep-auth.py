# -*- coding: utf-8 -*-
for f in ['tools/useGachaAuth.ts', 'tools/useLogin.ts']:
    print('=' * 20, f)
    for i, line in enumerate(open(f, encoding='utf-8'), 1):
        low = line.lower()
        if any(k in low for k in ['http', 'auth', 'token', 'password', 'account', 'fetch', 'post', 'grant', 'binding', 'login']):
            print('%4d %s' % (i, line.rstrip()[:160]))
