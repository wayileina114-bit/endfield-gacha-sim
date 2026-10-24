'use strict';
/* 预热图片代理缓存：全部干员+武器走一遍 /api/img */
async function main() {
  const imgs = await (await fetch('http://127.0.0.1:3276/api/images')).json();
  const entries = [];
  for (const kind of ['operators', 'weapons']) {
    for (const name of Object.keys(imgs[kind] || {})) {
      entries.push({ kind: kind === 'operators' ? 'operator' : 'weapon', name });
    }
  }
  let ok = 0, fail = 0, idx = 0;
  async function worker() {
    while (idx < entries.length) {
      const e = entries[idx++];
      try {
        const r = await fetch(`http://127.0.0.1:3276/api/img?kind=${e.kind}&name=${encodeURIComponent(e.name)}`);
        if (r.status === 200) ok++;
        else { fail++; console.log('FAIL', e.kind, e.name, r.status); }
      } catch (err) { fail++; console.log('ERR', e.kind, e.name, err.message); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  console.log(`warm done: ok=${ok} fail=${fail}`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
