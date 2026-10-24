'use strict';
/* 从 canmoe sitemap 抓全部武器详情页标题，重建完整武器图片映射并入 images.json */
const fs = require('fs');
const path = require('path');
async function main() {
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EndfieldGachaSim/1.0' };
  const r = await fetch('https://end.canmoe.com/sitemap.xml', { headers: UA });
  const xml = await r.text();
  const slugs = [...new Set([...xml.matchAll(/weapons\/([a-z0-9_]+)/g)].map(m => m[1]))];
  console.log('sitemap weapon slugs:', slugs.length);

  const p = path.join(__dirname, '..', 'data', 'images.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  let added = 0, dupSkip = 0;
  const existing = new Set(Object.keys(data.weapons));
  const results = [];
  const idx = { i: 0 };
  async function worker() {
    while (idx.i < slugs.length) {
      const slug = slugs[idx.i++];
      try {
        const dr = await fetch(`https://end.canmoe.com/zh-CN/wiki/weapons/${slug}`, { headers: UA });
        const dt = await dr.text();
        const tm = dt.match(/<title>([^<]{1,40})\s*-\s*明日方舟/);
        const name = tm ? tm[1].trim() : null;
        if (name) results.push({ slug, name });
      } catch { /* 忽略 */ }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()));
  for (const { slug, name } of results) {
    if (existing.has(name)) { dupSkip++; continue; }
    data.weapons[name] = `https://end.canmoe.com/images/weapon/${slug}.avif`;
    existing.add(name);
    added++;
  }
  data._meta.builtAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(data, null, 1), 'utf8');
  console.log(`added ${added}, skipped dup ${dupSkip}, total weapons mapped: ${Object.keys(data.weapons).length}`);
  const need = ['昔日精品', '破碎君王', '典范', '楔子', '同类相食', 'J.E.T.', '骁勇', '艺术暴君', '落草', '赤缨', '镀红祝福', '曜夜的首演', '玉中身', '唤月'];
  for (const n of need) console.log(n, '->', data.weapons[n] ? 'OK' : 'MISS');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
