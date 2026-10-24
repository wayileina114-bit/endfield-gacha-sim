'use strict';
/**
 * 武库申领（武器池）引擎：只能十连；六星4%（UP占1%）；40抽保底六星（25%UP）；
 * 单池累计80抽必得当期UP（每期一次）；累计100/180送自选常驻/UP武器，其后每80抽交替。
 */
const { getData } = require('./dataloader');

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

/** 社区确认的池内五星武器（17173施术单元一图流；其他类型五星名录未公开，标注于 rules.json） */
const FIVE_STAR_WEAPON_POOL = ['悼亡诗', '布道自由', '莫奈何', '迷失荒野', 'O.B.J.术识'];
const ALL_WEAPON_TYPES = ['单手剑', '双手剑', '长柄', '手铳', '施术单元'];

/** 四星为量产型武器：官方与各wiki均无名录/立绘，按池内类型呈现（如「四星单手剑」） */
function genericFourStarName(rng, banner) {
  const types = (banner.pool6Detail || [])
    .map(p => (p.type || '').replace('长柄武器', '长柄'))
    .filter(t => ALL_WEAPON_TYPES.includes(t));
  const pool = types.length ? [...new Set(types)] : ALL_WEAPON_TYPES;
  return `四星${pick(rng, pool)}`;
}

function ensureWeaponState(save, bannerId) {
  if (!save.weapons[bannerId]) {
    save.weapons[bannerId] = { cum: 0, pullsSince6: 0, upObtained: false, milestoneIndex: 0 };
  }
  return save.weapons[bannerId];
}

/** 里程碑序列：100=自选常驻, 180=UP, 260=常驻, 340=UP, ...（其后每80抽交替，gamekee口径） */
function milestoneAt(index) {
  if (index === 0) return { pulls: 100, kind: 'standardSelector' };
  if (index === 1) return { pulls: 180, kind: 'upWeapon' };
  const k = index - 1; // 180 + 80*k：260=自选常驻, 340=UP, 420=自选常驻…
  return { pulls: 180 + 80 * k, kind: k % 2 === 1 ? 'standardSelector' : 'upWeapon' };
}

function pullWeapon(save, banner, times, mode, rng, now, opts = {}) {
  const data = getData();
  const rules = data.rules.weaponBanner;
  if (times !== 10) throw new Error('武库申领仅支持十连（1980武库配额/次）');
  const ws = ensureWeaponState(save, banner.id);
  if (opts.payWithQuota) {
    if (save.weaponQuota < rules.costPerTenPullQuota) {
      throw new Error(`武库配额不足：需要${rules.costPerTenPullQuota}，当前${save.weaponQuota}（可通过角色寻访返利获得）`);
    }
    save.weaponQuota -= rules.costPerTenPullQuota;
  }
  const items = [];
  const rewards = [];
  for (let i = 0; i < 10; i++) {
    ws.cum += 1;
    ws.pullsSince6 += 1;
    const forcedUp80 = ws.cum >= rules.bannerUpGuaranteePulls && !ws.upObtained;
    const forcedR6 = ws.pullsSince6 >= rules.hardPityR6;
    let item;
    if (forcedUp80 || forcedR6 || rng() < rules.rates.r6) {
      const pity = ws.pullsSince6;
      ws.pullsSince6 = 0;
      const isUp = forcedUp80 ? true : rng() < rules.upShareWithinR6;
      if (isUp) ws.upObtained = true;
      // 优先使用官方公告的本期池单（约7把），无则回退全常驻14把
      const offPool = (banner.pool6 && banner.pool6.length > 1)
        ? banner.pool6.filter(x => x !== banner.up6)
        : data.standardWeaponPool;
      const name = isUp ? banner.up6 : pick(rng, offPool);
      item = { name, rarity: 6, isUp, pity, hardPity: forcedR6 && !forcedUp80, forcedUp80, weapon: true, bannerId: banner.id, bannerName: banner.name, ts: now };
    } else {
      const p5 = rules.rates.r5 / (1 - rules.rates.r6);
      if (rng() < p5) item = { name: pick(rng, FIVE_STAR_WEAPON_POOL), rarity: 5, isUp: false, weapon: true, bannerId: banner.id, bannerName: banner.name, ts: now };
      else item = { name: genericFourStarName(rng, banner), rarity: 4, isUp: false, weapon: true, generic: true, bannerId: banner.id, bannerName: banner.name, ts: now };
    }
    items.push(item);
    // 里程碑奖励
    let m = milestoneAt(ws.milestoneIndex);
    while (ws.cum >= m.pulls) {
      ws.milestoneIndex += 1;
      if (m.kind === 'upWeapon') {
        rewards.push({ type: 'milestoneUpWeapon', text: `武库申领累计${m.pulls}抽：获得当期UP六星武器【${banner.up6}】` });
        ws.upObtained = true;
      } else {
        rewards.push({ type: 'milestoneSelector', text: `武库申领累计${m.pulls}抽：获得常驻六星武器自选（补充武库箱）` });
      }
      m = milestoneAt(ws.milestoneIndex);
    }
  }
  // 十连保底5星+（假设）
  if (!items.some(i => i.rarity >= 5)) {
    const replace = items.length - 1;
    items[replace] = { name: pick(rng, FIVE_STAR_WEAPON_POOL), rarity: 5, isUp: false, floorApplied: true, weapon: true, bannerId: banner.id, bannerName: banner.name, ts: now };
  }
  // 武器库存
  for (const it of items) {
    if (it.rarity === 4) continue;
    const inv = save.weaponInventory[it.name] || (save.weaponInventory[it.name] = { count: 0 });
    it.isNew = inv.count === 0;
    inv.count += 1;
  }
  save.stats.totalPulls += items.length;
  save.stats.byRarityWeapon = save.stats.byRarityWeapon || { 6: 0, 5: 0, 4: 0 };
  for (const it of items) save.stats.byRarityWeapon[it.rarity] += 1;
  for (const it of items) {
    if (it.rarity === 6) {
      save.stats.goldRecords.push({ name: it.name, isUp: it.isUp, pity: it.pity || null, bannerId: banner.id, bannerName: banner.name, ts: now, new: it.isNew, weapon: true });
    }
  }
  save.history.unshift({ ts: now, bannerId: banner.id, bannerName: banner.name, mode: 'weapon' + (opts.payWithQuota ? '-paid' : ''), items });
  if (save.history.length > 300) save.history.length = 300;
  if (save.stats.goldRecords.length > 500) save.stats.goldRecords.length = 500;
  return { items, rewards, quotaCharged: !!opts.payWithQuota };
}

module.exports = { pullWeapon, milestoneAt, FIVE_STAR_WEAPON_POOL };
