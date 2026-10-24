'use strict';
/**
 * 角色寻访引擎：特许/重构(limited|rerun)、特殊(special, 辉光庆典)、基础(standard)、启程(newbie)
 * 规则参数来自 data/rules.json；所有计数器在传入的 save 对象上就地更新。
 */
const { getData } = require('./dataloader');

// 第 n 抽（自上次六星后）的六星概率
function sixStarRate(n, soft) {
  if (n >= soft.hardPityPull) return 1;
  if (n <= soft.startPull - 1) return 0.008;
  return 0.008 + soft.incrementPerPull * (n - (soft.startPull - 1));
}

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function isLimitedType(b) { return b.type === 'limited' || b.type === 'rerun'; }

function ensureBannerState(save, bannerId) {
  if (!save.banners[bannerId]) {
    save.banners[bannerId] = {
      cum: 0, upObtained: false, tokensEarned: 0,
      rush10Claimed: false, rush10Available: false, ticket60Claimed: false
    };
  }
  return save.banners[bannerId];
}

/** 单次抽卡判定（不含计数器增减，由调用方控制是否计数） */
function rollOnce({ save, banner, data, rng, trackRef, forcedUp, bannerState }) {
  const rules = data.rules.characterBanner;
  const n = trackRef.pity6 + 1;
  const p6 = sixStarRate(n, rules.softPity);
  const forced = forcedUp || n >= rules.softPity.hardPityPull;
  if (forced || rng() < p6) {
    const isUp = forcedUp ? true : rng() < rules.upShareOnSixStar;
    let name;
    if (banner.up6 && isUp) {
      name = banner.up6;
    } else {
      const others = banner.pool6.filter(x => x !== banner.up6);
      name = pick(rng, others);
    }
    return { name, rarity: 6, isUp: !!(banner.up6 && isUp), pity: n, forced120: !!forcedUp, hardPity: !forcedUp && forced };
  }
  // 未出六星：5星条件概率保持边际8%（0.08/(1-0.008)）
  const p5 = rules.rates.r5 / (1 - rules.rates.r6);
  if (rng() < p5) return { name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false };
  return { name: pick(rng, data.fourStarPool), rarity: 4, isUp: false };
}

function applyInventory(save, item, data) {
  const inv = save.inventory;
  if (!inv[item.name]) inv[item.name] = { count: 0, tokens: 0 };
  const rec = inv[item.name];
  item.isNew = rec.count === 0;
  rec.count += 1;
  if (rec.count > 1) item.dupe = true;
  // 武库配额返利：每次寻访获取干员同时获得
  const q = data.rules.quotaReward;
  save.weaponQuota += item.rarity === 6 ? q.perSixStar : item.rarity === 5 ? q.perFiveStar : q.perFourStar;
  save.stats.byRarity[item.rarity] += 1;
  if (item.rarity === 6) {
    save.stats.goldRecords.push({
      name: item.name, isUp: item.isUp, pity: item.pity || null,
      bannerId: item.bannerId, bannerName: item.bannerName, ts: item.ts,
      new: item.isNew, mode: item.mode || 'normal'
    });
  }
}

function tenPullFloor(items, rng, data, banner) {
  // 十连保底5星+（假设项）
  if (items.some(i => i.rarity >= 5)) return;
  const replace = items.length - 1;
  items[replace] = {
    name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, floorApplied: true,
    bannerId: banner.id, bannerName: banner.name, ts: items[replace].ts, mode: items[replace].mode
  };
}

/** 特许/重构寻访 */
function pullLimited(save, banner, times, mode, rng, data, now) {
  const bs = ensureBannerState(save, banner.id);
  const rules = data.rules.characterBanner;
  const items = [];
  const rewards = [];
  const track = save.limitedTrack;

  const mk = (r) => ({ ...r, bannerId: banner.id, bannerName: banner.name, ts: now, mode });

  if (mode === 'rush') {
    if (!bs.rush10Available || bs.rush10Claimed) throw new Error('当前无可用的加急招募十连');
    if (times !== 10) throw new Error('加急招募为十连');
    bs.rush10Available = false;
    bs.rush10Claimed = true;
    // 概率与基础概率一致；不影响任何计数（pity6/cum/240 均不动）
    const trackShadow = { pity6: track.pity6 };
    for (let i = 0; i < 10; i++) {
      const r = rollOnce({ save, banner, data, rng, trackRef: trackShadow, forcedUp: false, bannerState: bs });
      // 影子计数仅用于概率，不回写
      trackShadow.pity6 = r.rarity === 6 ? 0 : trackShadow.pity6 + 1;
      if (r.rarity === 6 && r.isUp) bs.upObtained = true; // 已获得UP，120保底失效（解释见 rules.json 注释）
      items.push(mk(r));
    }
    tenPullFloorRush(items, rng, data, banner, now);
    rewards.push({ type: 'rush10', text: '加急招募十连（不计数）' });
    return finalize(save, banner, items, rewards, mode, now);
  }

  if (times !== 1 && times !== 10) throw new Error('times 仅支持 1 或 10');
  for (let i = 0; i < times; i++) {
    bs.cum += 1;
    const forced120 = bs.cum >= rules.bannerGuarantee.cumulativePulls && !bs.upObtained;
    const r = rollOnce({ save, banner, data, rng, trackRef: track, forcedUp: forced120, bannerState: bs });
    track.pity6 = r.rarity === 6 ? 0 : (track.pity6 + 1);
    if (r.rarity === 6 && r.isUp) bs.upObtained = true;
    items.push(mk(r));
    // 单池累计奖励
    if (bs.cum >= rules.rewards.rush10AtPulls && !bs.rush10Claimed && !bs.rush10Available) {
      bs.rush10Available = true;
      rewards.push({ type: 'rush10Unlock', text: `累计${rules.rewards.rush10AtPulls}抽，可进行一次加急招募十连（免费，不计保底）` });
    }
    if (bs.cum >= rules.rewards.nextBanner10TicketAtPulls && !bs.ticket60Claimed) {
      bs.ticket60Claimed = true;
      rewards.push({ type: 'ticket60', text: `累计${rules.rewards.nextBanner10TicketAtPulls}抽，获得【寻访情报书】（下期寻访开启后转化为专有十连凭证，本模拟器仅作记录）` });
    }
    while (bs.cum >= (bs.tokensEarned + 1) * rules.rewards.upTokenEveryPulls) {
      bs.tokensEarned += 1;
      const inv = save.inventory[banner.up6] || (save.inventory[banner.up6] = { count: 0, tokens: 0 });
      inv.tokens += 1;
      rewards.push({ type: 'upToken', text: `单池累计${bs.tokensEarned * rules.rewards.upTokenEveryPulls}抽，额外获得【${banner.up6}信物】×1（潜能+1）` });
    }
  }
  if (times === 10) tenPullFloor(items, rng, data, banner);
  return finalize(save, banner, items, rewards, mode, now);
}

function tenPullFloorRush(items, rng, data, banner, now) {
  if (items.some(i => i.rarity >= 5)) return;
  const replace = items.length - 1;
  items[replace] = {
    name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, floorApplied: true,
    bannerId: banner.id, bannerName: banner.name, ts: now, mode: 'rush'
  };
}

/** 特殊寻访（辉光庆典）：独立保底，最多10抽必出六星，每抽附赠保障配额 */
function pullSpecial(save, banner, times, mode, rng, data, now) {
  const sp = data.rules.specialBanners.huiguang;
  const bs = ensureBannerState(save, banner.id);
  bs.pitySince6 = bs.pitySince6 || 0;
  bs.securityQuota = bs.securityQuota || 0;
  if (times !== 1 && times !== 10) throw new Error('times 仅支持 1 或 10');
  const items = [];
  const rewards = [];
  for (let i = 0; i < times; i++) {
    bs.cum += 1;
    bs.pitySince6 += 1;
    bs.securityQuota += 1;
    const forced = bs.pitySince6 >= sp.maxPullsToSixStar;
    const p6 = sp.perPullSixStarRate;
    if (forced || rng() < p6) {
      bs.pitySince6 = 0;
      const name = pick(rng, banner.pool6);
      items.push({ name, rarity: 6, isUp: false, pity: sp.maxPullsToSixStar, forced: true, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
    } else {
      const p5 = 0.08 / (1 - 0.008);
      if (rng() < p5) items.push({ name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
      else items.push({ name: pick(rng, data.fourStarPool), rarity: 4, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
    }
  }
  if (times === 10) tenPullFloor(items, rng, data, banner);
  rewards.push({ type: 'securityQuota', text: `本次获得【保障配额】×${times}（辉光庆典每抽附赠1，累计${bs.securityQuota}）` });
  return finalize(save, banner, items, rewards, mode, now);
}

/** 基础寻访（常驻） */
function pullStandard(save, banner, times, mode, rng, data, now) {
  if (times !== 1 && times !== 10) throw new Error('times 仅支持 1 或 10');
  const st = save.standard;
  const rules = data.rules.standardBanner;
  const items = [];
  const rewards = [];
  for (let i = 0; i < times; i++) {
    st.pity6 += 1;
    st.totalPulls += 1;
    const n = st.pity6;
    const p6 = n >= rules.softPity.hardPityPull ? 1
      : n <= rules.softPity.startPull - 1 ? rules.rates.r6
        : rules.rates.r6 + rules.softPity.incrementPerPull * (n - (rules.softPity.startPull - 1));
    if (n >= rules.softPity.hardPityPull || rng() < p6) {
      st.pity6 = 0;
      items.push({ name: pick(rng, banner.pool6), rarity: 6, isUp: false, pity: n, hardPity: n >= 80, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
    } else {
      const p5 = rules.rates.r5 / (1 - rules.rates.r6);
      if (rng() < p5) items.push({ name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
      else items.push({ name: pick(rng, data.fourStarPool), rarity: 4, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
    }
  }
  if (times === 10) tenPullFloor(items, rng, data, banner);
  if (st.totalPulls >= rules.selector.atPulls && !st.selectorClaimed) {
    st.selectorAvailable = true;
    rewards.push({ type: 'selector', text: `基础寻访累计${st.totalPulls}抽，可在五名常驻六星中自选一位（一次性，前端点击领取）` });
  }
  return finalize(save, banner, items, rewards, mode, now);
}

/** 启程寻访（新手池，仅十连，40抽内必得六星，出金即关） */
function pullNewbie(save, banner, times, mode, rng, data, now) {
  const nb = save.newbie;
  if (nb.closed) throw new Error('启程寻访已结束（已获得六星干员）');
  if (times !== 10) throw new Error('启程寻访仅支持十连');
  const items = [];
  const rewards = [];
  for (let i = 0; i < 10; i++) {
    nb.pulls += 1;
    nb.pity6 = (nb.pity6 || 0) + 1;
    const forced = nb.pulls >= 40 || nb.pity6 >= 80;
    const p6 = 0.008;
    if (forced || rng() < p6) {
      nb.pity6 = 0;
      const name = pick(rng, banner.pool6);
      items.push({ name, rarity: 6, isUp: false, pity: nb.pulls, forced, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
      nb.closed = true;
      rewards.push({ type: 'newbieWeapon', text: '启程寻访完成：额外获得一把限定范围自选六星武器（本模拟器仅作记录）' });
    } else {
      const p5 = 0.08 / (1 - 0.008);
      if (rng() < p5) items.push({ name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
      else items.push({ name: pick(rng, data.fourStarPool), rarity: 4, isUp: false, bannerId: banner.id, bannerName: banner.name, ts: now, mode });
    }
  }
  // 十连内出金后其余抽数仍正常结算；若整十连无5星+则保底
  if (!items.some(i => i.rarity >= 5)) {
    const replace = items.length - 1;
    items[replace] = { name: pick(rng, data.fiveStarPool), rarity: 5, isUp: false, floorApplied: true, bannerId: banner.id, bannerName: banner.name, ts: now, mode };
  }
  return finalize(save, banner, items, rewards, mode, now);
}

function finalize(save, banner, items, rewards, mode, now) {
  const data = getData();
  for (const it of items) applyInventory(save, it, data);
  save.stats.totalPulls += items.length;
  save.history.unshift({ ts: now, bannerId: banner.id, bannerName: banner.name, mode, items });
  if (save.history.length > 300) save.history.length = 300;
  if (save.stats.goldRecords.length > 500) save.stats.goldRecords.length = 500;
  return { items, rewards };
}

function pullCharacter(save, banner, times, mode, rng, now) {
  const data = getData();
  if (isLimitedType(banner)) return pullLimited(save, banner, times, mode, rng, data, now);
  if (banner.type === 'special') return pullSpecial(save, banner, times, mode, rng, data, now);
  if (banner.type === 'standard') return pullStandard(save, banner, times, mode, rng, data, now);
  if (banner.type === 'newbie') return pullNewbie(save, banner, times, mode, rng, data, now);
  throw new Error(`未知卡池类型: ${banner.type}`);
}

module.exports = { pullCharacter, sixStarRate, isLimitedType };
