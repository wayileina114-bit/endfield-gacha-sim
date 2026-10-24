# -*- coding: utf-8 -*-
import os
import sqlite3

db = r'D:\Hypergryph Launcher\games\Arknights Endfield\eld_Endfield.db'
print('size:', os.path.getsize(db))
try:
    con = sqlite3.connect('file:' + db + '?mode=ro', uri=True)
    cur = con.cursor()
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print('tables:', tables)
    for t in tables:
        try:
            cols = [c[1] for c in cur.execute('PRAGMA table_info(%s)' % t)]
            n = cur.execute('SELECT COUNT(*) FROM %s' % t).fetchone()[0]
            print('  %s: %d rows, cols=%s' % (t, n, cols[:12]))
            if n and any(k in t.lower() for k in ['gacha', 'draw', 'record', 'history', 'pull']):
                for row in cur.execute('SELECT * FROM %s LIMIT 3' % t):
                    print('    sample:', str(row)[:200])
        except Exception as e:
            print('  %s err: %s' % (t, e))
    con.close()
except Exception as e:
    print('open err:', e)

# Unity Player.log 常见位置
for p in [
    os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Hypergryph\Arknights Endfield'),
    os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow\Endfield'),
    os.path.expandvars(r'%USERPROFILE%\AppData\LocalLow'),
]:
    if os.path.isdir(p):
        print('DIR:', p)
        for x in os.listdir(p)[:20]:
            print('  ', x)
