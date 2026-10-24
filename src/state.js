'use strict';
const fs = require('fs');
const path = require('path');

const SAVE_PATH = path.join(__dirname, '..', 'data', 'save.json');

function defaultSave() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    limitedTrack: { pity6: 0 },            // 80抽计数，跨特许/重构寻访继承
    banners: {},                            // 每个限定/重构/特殊池的独立计数
    standard: { pity6: 0, totalPulls: 0, selectorClaimed: false, selectorAvailable: false },
    newbie: { pulls: 0, pity6: 0, closed: false },
    weapons: {},                            // 每期武库申领独立计数
    weaponQuota: 0,                         // 武库配额
    securityQuota: 0,
    inventory: {},                          // 干员: {count, tokens}
    weaponInventory: {},                    // 武器: {count}
    stats: {
      totalPulls: 0,
      byRarity: { 6: 0, 5: 0, 4: 0 },
      byRarityWeapon: { 6: 0, 5: 0, 4: 0 },
      goldRecords: []
    },
    history: []
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(SAVE_PATH, 'utf8'));
    // 兼容缺省字段
    cache = Object.assign(defaultSave(), cache);
  } catch {
    cache = defaultSave();
  }
  return cache;
}

function save(saveObj) {
  cache = saveObj;
  try {
    fs.writeFileSync(SAVE_PATH, JSON.stringify(saveObj, null, 1), 'utf8');
  } catch (e) {
    console.error('[state] 存档写入失败:', e.message);
  }
  return cache;
}

function reset() {
  cache = defaultSave();
  save(cache);
  return cache;
}

/** 运气分析：与理论期望对比 */
function luckAnalysis(s) {
  const golds = s.stats.goldRecords.filter(g => !g.weapon);
  const n = golds.length;
  if (n === 0) return { hasData: false };
  const totalCharPulls = s.stats.byRarity[6] + s.stats.byRarity[5] + s.stats.byRarity[4];
  const avgPerGold = totalCharPulls / n;
  const expected = 49.1; // 理论期望（含软/硬保底，社区推算口径约49抽/金）
  // 期望出货时保底水位越低越欧
  const avgPity = golds.reduce((a, g) => a + (g.pity || 0), 0) / n;
  const offBannerRate = golds.length ? golds.filter(g => !g.isUp).length / golds.length : 0;
  let rating;
  const ratio = avgPerGold / expected;
  if (ratio <= 0.75) rating = '欧皇';
  else if (ratio <= 0.92) rating = '比较欧';
  else if (ratio <= 1.1) rating = '中规中矩';
  else if (ratio <= 1.35) rating = '有点非';
  else rating = '非酋附体';
  return {
    hasData: true, charPulls: totalCharPulls, golds: n, avgPerGold: +avgPerGold.toFixed(1),
    avgPity: +avgPity.toFixed(1), expected, offBannerRate: +offBannerRate.toFixed(3), rating
  };
}

module.exports = { load, save, reset, defaultSave, luckAnalysis, SAVE_PATH };
