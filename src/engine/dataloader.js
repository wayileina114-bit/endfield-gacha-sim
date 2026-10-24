'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), 'utf8'));
}

let cache = null;

function getData() {
  if (cache) return cache;
  const operators = loadJson('operators.json');
  const charBannersRaw = loadJson('banners.character.json');
  const wpnBannersRaw = loadJson('banners.weapon.json');
  const weapons = loadJson('weapons.json');
  const rules = loadJson('rules.json');
  const economy = loadJson('economy.json');
  const versions = loadJson('versions.json');
  const builds = loadJson(path.join('guide', 'builds.json'));
  const matrices = loadJson(path.join('guide', 'matrices.json'));
  const materials = loadJson(path.join('guide', 'materials.json'));

  const opByName = new Map(operators.operators.map(o => [o.name, o]));

  // 图鉴立绘映射 + 官方抓取覆盖层
  let images = { operators: {} };
  try { images = loadJson('images.json'); } catch { /* 无映射文件时用占位 */ }
  let overlay = null;
  try { overlay = loadJson('banners.remote.json'); } catch { /* 未同步过 */ }

  const charBanners = [...charBannersRaw.banners];
  const wpnBanners = [...wpnBannersRaw.banners];
  const operatorsAll = [...operators.operators];
  const weaponsAll = [...weapons.weapons];
  if (overlay) {
    for (const b of overlay.charBanners || []) {
      const i = charBanners.findIndex(x => x.name === b.name);
      if (i >= 0) charBanners[i] = { ...charBanners[i], ...b };
      else charBanners.push(b);
    }
    for (const b of overlay.wpnBanners || []) {
      const i = wpnBanners.findIndex(x => x.name === b.name);
      if (i >= 0) wpnBanners[i] = { ...wpnBanners[i], ...b };
      else wpnBanners.push(b);
    }
    for (const o of overlay.operators || []) {
      if (!operatorsAll.find(x => x.name === o.name)) operatorsAll.push(o);
      if (!opByName.has(o.name)) opByName.set(o.name, o);
    }
    for (const w of overlay.weapons || []) {
      if (!weaponsAll.find(x => x.name === w.name)) weaponsAll.push(w);
    }
    for (const [k, v] of Object.entries(overlay.images || {})) images.operators[k] = v;
    for (const [k, v] of Object.entries(overlay.weaponImages || {})) {
      if (!images.weapons[k]) images.weapons[k] = v;
    }
  }
  // 限定/重构/特殊按开始日期排序，常驻/新手置底
  const rank = { limited: 1, rerun: 1, special: 1, standard: 2, newbie: 3 };
  charBanners.sort((a, b) => (rank[a.type] - rank[b.type]) || ((a.start || '9999') < (b.start || '9999') ? -1 : 1));
  wpnBanners.sort((a, b) => ((a.start || '9999') < (b.start || '9999') ? -1 : 1));

  // 全部卡池（角色+武器）统一索引
  const allBanners = [];
  for (const b of charBanners) allBanners.push({ ...b, category: 'character' });
  for (const b of wpnBanners) allBanners.push({ ...b, category: 'weapon' });
  const bannerById = new Map(allBanners.map(b => [b.id, b]));

  cache = {
    operators: operatorsAll,
    opByName,
    fiveStarPool: charBannersRaw._meta.fiveStarPool,
    fourStarPool: charBannersRaw._meta.fourStarPool,
    charBanners,
    wpnBanners,
    standardWeaponPool: weapons._meta.standardPoolSixStars,
    weapons: weaponsAll,
    images,
    overlay,
    charBannersStatic: charBannersRaw.banners,
    wpnBannersStatic: wpnBannersRaw.banners,
    operatorsStatic: operators.operators,
    weaponsStatic: weapons.weapons,
    rules, economy, versions, builds, matrices, materials,
    allBanners, bannerById,
    reload() { cache = null; return getData(); }
  };
  return cache;
}

module.exports = { getData, DATA_DIR };
