'use strict';
/**
 * 官方卡池数据自动更新器（纯官方接口）
 *   列表 GET https://web-news.hypergryph.com/api/bulletin?lang=zh-cn&code=endfield_web&page=N&pageSize=50
 *   详情 GET https://web-news.hypergryph.com/api/bulletin/{cid}?lang=zh-cn&code=endfield_web （data 字段=正文HTML）
 * 解析各期「寻访说明/申领说明/版本更新说明」，生成 data/banners.remote.json 覆盖层，
 * dataloader 在静态数据之上合并（同名卡池以官方抓取为准）。
 */
const fs = require('fs');
const path = require('path');

const BULLETIN_LIST = 'https://web-news.hypergryph.com/api/bulletin?lang=zh-cn&code=endfield_web';
const BULLETIN_DETAIL = 'https://web-news.hypergryph.com/api/bulletin/';
const ARTICLE_URL = 'https://endfield.hypergryph.com/news/';
const OVERLAY_PATH = path.join(__dirname, '..', 'data', 'banners.remote.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EndfieldGachaSim/1.0 (fan tool)' };
const STANDARD_SIX = ['艾尔黛拉', '骏卫', '别礼', '余烬', '黎风'];

async function getJson(url, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: UA, signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** 逐行解析正文 → 按行序交错的片段数组 */
function parseArticleLines(title, html) {
  const text = stripHtml(html);
  const frags = [];
  const mVerTitle = title.match(/「(.+?)」版本更新说明/);
  const isVersionUpdate = !!mVerTitle;
  for (let raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    // 寻访说明：「临渊望北」特许寻访中，6星干员【诀】获取概率提升，全部可能出现的6星干员包括：….
    if ((m = line.match(/寻访说明：「(.+?)」(特许寻访|重构寻访|特殊寻访|限时寻访)?中，6星干员【(.+?)】获取概率提升/))) {
      const poolMatch = line.match(/全部可能出现的6星干员包括：(.+?)。/);
      frags.push({ t: 'char', name: m[1], kind: m[2] || '特许寻访', up6: m[3],
        pool6: poolMatch ? poolMatch[1].split(/[/／]/).map(s => s.trim()).filter(Boolean) : null });
      continue;
    }
    // 「万物更新」特许寻访中，概率提升的6星干员为【祀】。
    if ((m = line.match(/「(.+?)」(特许寻访|重构寻访|特殊寻访|限时寻访)中，概率提升的6星干员为【(.+?)】/))) {
      frags.push({ t: 'char', name: m[1], kind: m[2], up6: m[3], pool6: null });
      continue;
    }
    // 申领说明：「军列申领」中，概率提升的6星武器为【四二式·肃阵（施术单元）】，全部可能出现的6星武器包括：….
    if ((m = line.match(/申领说明：「(.+?)」中，概率提升的6星武器为【(.+?)】/))) {
      const rawName = m[2];
      const typeM = rawName.match(/^(.*?)（(.+?)）$/);
      const wname = (typeM ? typeM[1] : rawName).trim();
      const wtype = typeM ? typeM[2] : null;
      const poolMatch = line.match(/全部可能出现的6星武器包括：(.+?)。/);
      let pool = null;
      if (poolMatch) {
        pool = poolMatch[1].split(/[/／]/).map(s => s.trim()).filter(Boolean).map(s => {
          const pm = s.match(/^(.*?)（(.+?)）$/);
          return { name: (pm ? pm[1] : s).trim(), type: pm ? pm[2] : null };
        });
      }
      frags.push({ t: 'weapon', name: m[1], up6: wname, up6Type: wtype, pool6: pool });
      continue;
    }
    // 「辉光庆典」特殊寻访中，全部可能出现的6星干员包括：莱万汀/洁尔佩塔/…。（双UP/无UP特殊池）
    if ((m = line.match(/「(.+?)」(特许寻访|重构寻访|特殊寻访|限时寻访)中，全部可能出现的6星干员包括：(.+?)。/))) {
      frags.push({ t: 'char', name: m[1], kind: m[2], up6: null,
        pool6: m[3].split(/[/／]/).map(s => s.trim()).filter(Boolean) });
      continue;
    }
    // 开放时间行：版本汇总文章内的时间行歧义太多，跳过；单独文章内的时间行有效
    if ((m = line.match(/^·?\s*开放时间[：:](.+)$/))) {
      if (isVersionUpdate) continue;
      const seg = m[1];
      const verName = (seg.match(/「(.+?)」版本更新/) || [])[1] || (mVerTitle && mVerTitle[1]) || null;
      const dates = [...seg.matchAll(/\d{4}\/\d{2}\/\d{2}/g)].map(x => x[0].replace(/\//g, '-'));
      let start = null, end = null;
      if (dates.length >= 2) { start = dates[0]; end = dates[1]; }
      else if (dates.length === 1) {
        // 单日期方向：「…维护后 - 日期」→结束；「日期 - …维护前/下次…」→开始
        const d = dates[0];
        const before = seg.slice(0, seg.indexOf(d.replace(/-/g, '/')));
        if (/后\s*[-–—]?\s*$/.test(before.trim())) end = d;
        else start = d;
      }
      frags.push({ t: 'open', start, end, verName });
      continue;
    }
  }
  return frags;
}

function versionByDate(versions, ts) {
  if (!ts) return versions[0];
  const t = new Date(ts * 1000);
  let cur = versions[0];
  for (const v of versions) if (new Date(v.start + 'T12:00:00+08:00') <= t) cur = v;
  return cur;
}

/** 尽力补齐缺失立绘：canmoe 列表页→详情页标题比对（限流逐个抓） */
async function fillMissingImages(missingNames, imagesMap) {
  if (!missingNames.length) return;
  try {
    const r = await fetch('https://end.canmoe.com/zh-CN/wiki/characters', { headers: UA });
    const html = await r.text();
    const slugs = [...new Set([...html.matchAll(/chr_[0-9a-z_]+/g)].map(m => m[0]))];
    const remaining = new Set(missingNames);
    for (const slug of slugs) {
      if (!remaining.size) break;
      try {
        const dr = await fetch(`https://end.canmoe.com/zh-CN/wiki/characters/${slug}`, { headers: UA });
        const dt = await dr.text();
        const tm = dt.match(/<title>([^<]{1,30})\s*-\s*明日方舟/);
        const name = tm ? tm[1].trim() : null;
        if (name && remaining.has(name)) {
          imagesMap[name] = `https://end.canmoe.com/images/characters/full/${slug}.avif`;
          remaining.delete(name);
        }
        await new Promise(rs => setTimeout(rs, 100));
      } catch { /* 单页失败忽略 */ }
    }
  } catch { /* 离线忽略 */ }
}

/** 尽力补齐缺失武器图：canmoe sitemap → 详情页标题比对 */
async function fillMissingWeaponImages(missingNames, imagesMap) {
  if (!missingNames.length) return;
  try {
    const r = await fetch('https://end.canmoe.com/sitemap.xml', { headers: UA });
    const xml = await r.text();
    const slugs = [...new Set([...xml.matchAll(/weapons\/([a-z0-9_]+)/g)].map(m => m[1]))];
    const remaining = new Set(missingNames);
    for (const slug of slugs) {
      if (!remaining.size) break;
      try {
        const dr = await fetch(`https://end.canmoe.com/zh-CN/wiki/weapons/${slug}`, { headers: UA });
        const dt = await dr.text();
        const tm = dt.match(/<title>([^<]{1,40})\s*-\s*明日方舟/);
        const name = tm ? tm[1].trim() : null;
        if (name && remaining.has(name)) {
          imagesMap[name] = `https://end.canmoe.com/images/weapon/${slug}.avif`;
          remaining.delete(name);
        }
        await new Promise(rs => setTimeout(rs, 80));
      } catch { /* 单页失败忽略 */ }
    }
  } catch { /* 离线忽略 */ }
}

async function sync() {
  const result = { ok: false, error: null };
  const dl = require('./engine/dataloader');
  // 1) 公告列表（最多6页×50，覆盖全部历史公告）
  const items = [];
  for (let page = 1; page <= 6; page++) {
    const j = await getJson(`${BULLETIN_LIST}&page=${page}&pageSize=50`);
    const list = (j.data && j.data.list) || [];
    items.push(...list);
    const total = (j.data && j.data.total) || 0;
    if (items.length >= total || !list.length) break;
  }
  const candidates = items.filter(it =>
    /寻访说明|申领|版本更新说明/.test(it.title) && !/封禁|预下载|预告|创作征集/.test(it.title));
  result.itemCount = items.length;
  result.candidateCount = candidates.length;
  // 2) 逐篇解析（限速抓取，避免触发接口限流）
  const articles = [];
  let fetchFail = 0;
  let firstErr = null;
  for (const it of candidates) {
    try {
      const d = await getJson(`${BULLETIN_DETAIL}${it.cid}?lang=zh-cn&code=endfield_web`);
      const html = (d.data && d.data.data) || '';
      if (!html) { fetchFail++; continue; }
      articles.push({ cid: it.cid, title: it.title, ts: it.displayTime, url: ARTICLE_URL + it.cid, frags: parseArticleLines(it.title, html) });
    } catch (e) { fetchFail++; if (!firstErr) firstErr = e.name + ': ' + e.message + ' @ ' + it.cid; }
    await new Promise(r => setTimeout(r, 120));
  }
  result.fetchFail = fetchFail;
  if (firstErr) result.firstErr = firstErr;
  // 3) 组装：
  //    - 单独的寻访/申领文章（非版本汇总）提供权威时间：首个「开放时间」行属于标题对应的卡池
  //    - 版本汇总文章只提供池单（全部可能出现…名单）与 武器↔角色 配对，不提供时间（歧义大）
  //    - 单独文章的数据优先；文章按时间正序处理
  const versions = dl.getData().versions.timeline;
  const singles = articles.filter(a => !/版本更新说明/.test(a.title)).sort((a, b) => a.ts - b.ts);
  const versionAggs = articles.filter(a => /版本更新说明/.test(a.title));
  const charByName = new Map();
  const wpnByName = new Map();
  const ensureChar = (name) => {
    let rec = charByName.get(name);
    if (!rec) { rec = { name, kind: null, up6: null, pool6: null, start: null, end: null, verName: null, dated: false, sources: [] }; charByName.set(name, rec); }
    return rec;
  };
  const ensureWpn = (name) => {
    let rec = wpnByName.get(name);
    if (!rec) { rec = { name, up6: null, up6Type: null, pool6: null, start: null, end: null, pairedChar: null, dated: false, sources: [] }; wpnByName.set(name, rec); }
    return rec;
  };
  for (const art of singles) {
    const titleName = (art.title.match(/「(.+?)」/) || [])[1];
    const firstOpen = art.frags.find(f => f.t === 'open') || null;
    for (const f of art.frags) {
      if (f.t === 'char') {
        const rec = ensureChar(f.name);
        rec.kind = f.kind || rec.kind;
        rec.up6 = f.up6 || rec.up6;
        if (f.pool6) rec.pool6 = f.pool6;
        rec.ts = rec.ts || art.ts;
        rec.sources.push(art.url);
        if (firstOpen && f.name === titleName && !rec.dated) {
          rec.start = firstOpen.start; rec.end = firstOpen.end;
          rec.startFromArticle = !!firstOpen.start;
          rec.endFromArticle = !!firstOpen.end;
          rec.verName = firstOpen.verName || rec.verName;
          rec.dated = true;
        }
      } else if (f.t === 'weapon') {
        const rec = ensureWpn(f.name);
        rec.up6 = f.up6 || rec.up6;
        rec.up6Type = f.up6Type || rec.up6Type;
        if (f.pool6) rec.pool6 = f.pool6;
        rec.sources.push(art.url);
        if (firstOpen && f.name === titleName && !rec.dated) {
          rec.start = firstOpen.start; rec.end = firstOpen.end;
          rec.dated = true;
        }
      }
    }
  }
  for (const art of versionAggs) {
    let lastChar = null;
    for (const f of art.frags) {
      if (f.t === 'char') {
        const rec = ensureChar(f.name);
        rec.kind = f.kind || rec.kind;
        rec.up6 = f.up6 || rec.up6;
        if (f.pool6 && !rec.pool6) rec.pool6 = f.pool6;
        rec.sources.push(art.url);
        lastChar = rec;
      } else if (f.t === 'weapon') {
        const rec = ensureWpn(f.name);
        rec.up6 = f.up6 || rec.up6;
        rec.up6Type = f.up6Type || rec.up6Type;
        if (f.pool6 && !rec.pool6) rec.pool6 = f.pool6;
        if (!rec.pairedChar && lastChar) rec.pairedChar = lastChar.name;
        rec.sources.push(art.url);
      }
    }
  }
  // 4) 角色池：版本时间线补齐缺失开始日
  const staticData = dl.getData();
  const staticCharS = staticData.charBannersStatic;
  const staticWpnS = staticData.wpnBannersStatic;
  for (const r of charByName.values()) {
    const v = versions.find(v => v.name === r.verName);
    if (v && !r.start) r.start = v.start;
  }
  // 仍未定开始日的记录标记
  const poolAll = [...charByName.values()].filter(r => r.up6 || r.kind === '特殊寻访');
  // 先补结束日：无结束日的卡池用下一个更大开始日的卡池开始日
  for (const r of poolAll) {
    if (!r.end) {
      let next = null;
      for (const o of poolAll) {
        if (o === r || !o.start || o.start <= r.start) continue;
        if (!next || o.start < next) next = o.start;
      }
      if (next) r.end = next;
    }
  }
  // 再链开始日：卡池首尾相接，取结束日不晚于本池的最近已定池结束日
  for (const r of poolAll) {
    if (r.start) continue;
    const bound = r.end || (r.ts ? new Date(r.ts * 1000).toISOString().slice(0, 10) : '9999-12-31');
    let best = null;
    for (const o of poolAll) {
      if (o === r || !o.end || o.end > bound) continue;
      if (!best || o.end > best.end) best = o;
    }
    r.start = best ? best.end : versionByDate(versions, r.ts).start;
    r.startFromArticle = false;
  }
  const dated = poolAll.filter(r => (r.up6 || r.kind === '特殊寻访') && r.start && (r.up6 || (r.pool6 && r.pool6.length >= 3))).sort((a, b) => (a.start < b.start ? -1 : 1));
  const orderedUps = dated.filter(r => r.kind !== '特殊寻访').map(r => r.up6);
  const buildPool6 = (rec) => {
    if (rec.pool6 && rec.pool6.length >= 3) return rec.pool6;
    const idx = orderedUps.indexOf(rec.up6);
    const prev = idx > 0 ? [orderedUps[idx - 1], orderedUps[idx - 2]].filter(Boolean) : [];
    return [...new Set([rec.up6, ...prev, ...STANDARD_SIX])].slice(0, 8);
  };
  let cCounter = staticData.charBanners.length + 1, wCounter = staticData.wpnBanners.length + 1;
  const charOut = dated.map(r => {
    const type = r.kind === '重构寻访' ? 'rerun' : r.kind === '特殊寻访' ? 'special' : 'limited';
    const vrec = versions.find(v => v.name === r.verName);
    const ver = vrec ? vrec.version : (versionByDate(versions, r.startTs || Date.parse(r.start) / 1000) || versions[0]).version;
    const id = (staticCharS.find(b => b.name === r.name) || {}).id || `cx${cCounter++}`;
    const staticSame = staticCharS.find(b => b.name === r.name) || {};
    // 静态数据优先于链式推断：仅文章原文给出的日期才覆盖静态值
    const start = r.startFromArticle ? r.start : (staticSame.start || r.start);
    const end = r.endFromArticle ? r.end : (staticSame.end || r.end || null);
    return {
      id, name: r.name, type, version: ver, versionName: r.verName || null,
      start, end, up6: r.up6, pool6: buildPool6(r),
      notes: '官方公告自动同步', _source: r.sources
    };
  });
  const wpnOut = [...wpnByName.values()].filter(w => w.up6).map(w => {
    const pairedRec = w.pairedChar ? (charOut.find(b => b.name === w.pairedChar) || staticCharS.find(b => b.name === w.pairedChar)) : null;
    const staticSameW = staticWpnS.find(b => b.name === w.name) || {};
    // 优先级：本池文章原文 > 静态数据 > 配对角色池日期
    const start = w.start || staticSameW.start || (pairedRec ? pairedRec.start : null) || null;
    const end = w.end || staticSameW.end || (pairedRec ? pairedRec.end : null) || null;
    const id = (staticWpnS.find(b => b.name === w.name) || {}).id || `wx${wCounter++}`;
    return {
      id, name: w.name, type: /重构/.test(w.name) ? 'rerun' : 'normal',
      version: pairedRec ? pairedRec.version : null,
      start, end,
      up6: w.up6, up6Type: w.up6Type || null,
      pool6: w.pool6 ? w.pool6.map(p => p.name) : null, pool6Detail: w.pool6,
      pairedCharBanner: w.pairedChar || null,
      notes: '官方公告自动同步', _source: w.sources
    };
  });
  // 5) 新干员/新武器
  const newOps = [];
  for (const r of charOut) {
    if (r.up6 && r.type !== 'special' && !staticData.operators.find(o => o.name === r.up6)) {
      newOps.push({ id: r.up6, name: r.up6, rarity: 6, profession: '未知', element: null, limited: true, firstBanner: r.name, firstVersion: r.version, autoAdded: true });
    }
  }
  const seen = new Set();
  const newWpns = [];
  for (const w of wpnOut) {
    for (const cand of [{ name: w.up6, weaponType: w.up6Type, obtain: 'signature' }, ...(w.pool6Detail || []).map(p => ({ name: p.name, weaponType: p.type, obtain: 'weaponBanner' }))]) {
      if (!cand.name || seen.has(cand.name) || staticData.weapons.find(x => x.name === cand.name)) continue;
      seen.add(cand.name);
      newWpns.push({ name: cand.name, weaponType: cand.weaponType, obtain: cand.obtain, autoAdded: true });
    }
  }
  const overlay = {
    lastSync: new Date().toISOString(),
    articleCount: articles.length,
    charBanners: charOut,
    wpnBanners: wpnOut,
    operators: newOps,
    weapons: newWpns,
    images: {},
    weaponImages: {}
  };
  try {
    const old = JSON.parse(fs.readFileSync(OVERLAY_PATH, 'utf8'));
    if (old && old.images) overlay.images = old.images;
    if (old && old.weaponImages) overlay.weaponImages = old.weaponImages;
  } catch { /* 无旧文件 */ }
  // 为缺立绘的 UP 干员/武器补图（含新同步进来的内容）
  const currentImages = dl.getData().images.operators || {};
  const missing = charOut.map(b => b.up6).filter(n => n && !currentImages[n] && !(overlay.images[n]));
  if (missing.length) await fillMissingImages([...new Set(missing)], overlay.images);
  const currentWpnImgs = dl.getData().images.weapons || {};
  const missingWpn = wpnOut.map(b => b.up6).filter(n => n && !currentWpnImgs[n] && !(overlay.weaponImages[n]));
  if (missingWpn.length) await fillMissingWeaponImages([...new Set(missingWpn)], overlay.weaponImages);
  fs.writeFileSync(OVERLAY_PATH, JSON.stringify(overlay, null, 1), 'utf8');
  dl.getData().reload();
  result.ok = true;
  result.articleCount = articles.length;
  result.charBanners = charOut.length;
  result.wpnBanners = wpnOut.length;
  result.newCharBanners = charOut.filter(b => !staticData.charBanners.find(s => s.name === b.name)).length;
  result.newWpnBanners = wpnOut.filter(b => !staticData.wpnBanners.find(s => s.name === b.name)).length;
  result.newOperators = newOps.length;
  result.newWeapons = newWpns.length;
  return result;
}

module.exports = { sync, OVERLAY_PATH, parseArticleLines, stripHtml, getJson, BULLETIN_LIST };
