'use strict';
/**
 * 立绘映射构建脚本：canmoe 干员页 <title> 提取中文名，立绘直链 /images/characters/full/{slug}.avif
 * 用法：node tools/build-images.js（需联网）
 */
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EndfieldGachaSim/1.0 (fan tool)' };
const LIST_URL = 'https://end.canmoe.com/zh-CN/wiki/characters';
const OUT = path.join(__dirname, '..', 'data', 'images.json');

async function main() {
  console.log('抓取干员列表页…');
  const r = await fetch(LIST_URL, { headers: UA });
  const html = await r.text();
  const slugs = [...new Set([...html.matchAll(/chr_[0-9a-z_]+/g)].map(m => m[0]))];
  console.log('slug 数:', slugs.length);

  const nameBySlug = new Map();
  for (const slug of slugs) {
    try {
      const dr = await fetch(`https://end.canmoe.com/zh-CN/wiki/characters/${slug}`, { headers: UA });
      const dt = await dr.text();
      const tm = dt.match(/<title>([^<]{1,30})\s*-\s*明日方舟/);
      const name = tm ? tm[1].trim() : null;
      nameBySlug.set(slug, name);
      console.log(`  ${slug} -> ${name}`);
    } catch (e) {
      console.log(`  ${slug} 抓取失败: ${e.message}`);
    }
  }

  const operators = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'operators.json'), 'utf8')).operators;
  const result = {
    _meta: {
      source: 'canmoe 数据站（https://end.canmoe.com）干员立绘/武器图片直链',
      builtAt: new Date().toISOString(),
      pattern: 'https://end.canmoe.com/images/characters/full/{slug}.avif | /images/weapon/{slug}.avif',
      note: '运行时若加载失败，前端自动回退为文字占位卡；离线包不含图片本体'
    },
    operators: {},
    weapons: {}
  };
  for (const op of operators) {
    let hit = null;
    for (const [slug, name] of nameBySlug) if (name === op.name) { hit = slug; break; }
    if (hit) {
      result.operators[op.name] = `https://end.canmoe.com/images/characters/full/${hit}.avif`;
      console.log(`[ok] ${op.name}`);
    } else {
      console.log(`[miss] ${op.name}（canmoe 暂无或名称不一致），使用占位卡`);
    }
  }

  // 武器：列表页 slug -> 详情页标题中文名 -> /images/weapon/{slug}.avif
  console.log('抓取武器列表页…');
  try {
    const wr = await fetch('https://end.canmoe.com/zh-CN/wiki/weapons', { headers: UA });
    const whtml = await wr.text();
    const wslugs = [...new Set([...whtml.matchAll(/\/zh-CN\/wiki\/weapons\/([a-z0-9_]+)/g)].map(m => m[1]))];
    console.log('weapon slugs:', wslugs.length);
    const wnameBySlug = new Map();
    for (const slug of wslugs) {
      try {
        const dr = await fetch(`https://end.canmoe.com/zh-CN/wiki/weapons/${slug}`, { headers: UA });
        const dt = await dr.text();
        const tm = dt.match(/<title>([^<]{1,30})\s*-\s*明日方舟/);
        if (tm) wnameBySlug.set(slug, tm[1].trim());
        await new Promise(rs => setTimeout(rs, 80));
      } catch { /* 单页失败忽略 */ }
    }
    for (const [slug, name] of wnameBySlug) {
      result.weapons[name] = `https://end.canmoe.com/images/weapon/${slug}.avif`;
    }
    console.log('weapons mapped:', result.weapons.length ?? Object.keys(result.weapons).length);
  } catch (e) {
    console.log('武器抓取失败（跳过）:', e.message);
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1), 'utf8');
  console.log('已生成', OUT, '干员映射:', Object.keys(result.operators).length, '/', operators.length, '武器映射:', Object.keys(result.weapons).length);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
