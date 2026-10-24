'use strict';
/**
 * 官方记录分析：指标计算 + 保底状态推断 + 未来预测
 * UP 判定：官方记录无 isUp 字段，用 本地卡池数据（poolName→up6）匹配。
 * 注意：官方仅保留约90天记录，"当前池累计"等指标受窗口限制（界面会标注）。
 *
 * 契约扩展（字段名与前端约定一字不差，既有顶层字段全部保留）：
 *   char  : sixStars/rate/avgPerGold/upRate/luckRating/pity/monthly/golds
 *           + fiveStar/pityBuckets/hardPityHits/softPityHits/goldTimeline/
 *             luckPercentile/spend/window
 *           + poolBreakdown（限定轨每池+基础寻访的分池明细，计费口径）
 *             gapHistogram（相邻两金间隔分布，固定 8 桶）
 *             offAfterOff（歪后下一金是否 UP 的经验统计）
 *             activity（计费角色记录按 UTC 日期聚合的活跃度）
 *   weapon: pulls/golds/rate/avgPerGold/upRate/fiveStar/goldTimeline/pity40/window
 *   CSV   : officialRecordsCsv（/api/official/export 用）+ escapeCsvField/toCsv
 * 口径说明：
 *   - 角色池保底类指标（pityBuckets/hardPityHits/softPityHits/goldTimeline）基于
 *     限定轨（limited+rerun，80 抽保底跨池继承）；pity 为该金"花费抽数"（1 基，
 *     即第 N 抽出金则 pity=N），与出金时游戏内保底计数一致。
 *   - 武器池 40 抽保底不跨期继承：goldTimeline 的 pity 按各武器池独立游走；
 *     pity40 取最新武器池（按最新记录所属池）的推断进度。
 *   - luckPercentile：以角色池保底机制对"同样总抽数"做蒙特卡洛，统计玩家
 *     实际六星数的百分位（50=中位，越高越欧）；不建模单池 120 井（跨池聚合无法还原）。
 */
const { getData } = require('../engine/dataloader');
const { simulateCharacter, simulateWeapon, simulateSixCounts } = require('../engine/simulate');

const POOL_TYPE_MAP = {
  E_CharacterGachaPoolType_Special: 'limited',
  E_CharacterGachaPoolType_Rerun: 'rerun',
  E_CharacterGachaPoolType_Joint: 'special',
  E_CharacterGachaPoolType_Standard: 'standard',
  E_CharacterGachaPoolType_Beginner: 'newbie'
};

const KNOWN_POOL_TYPES = new Set(['limited', 'rerun', 'special', 'standard', 'newbie']);

/** luckPercentile 蒙特卡洛种子（固定 → 同一数据多次请求结果可复现） */
const LUCK_SIM_SEED = 20261024;

/** 出金保底计数分布（1 基花费抽数；末桶上限放宽以兜住窗口截断造成的 >80） */
const PITY_BUCKETS = [
  { label: '0-10', min: 1, max: 10 },
  { label: '11-30', min: 11, max: 30 },
  { label: '31-60', min: 31, max: 60 },
  { label: '61-75', min: 61, max: 75 },
  { label: '76-80', min: 76, max: Infinity }
];

/** gapHistogram 固定 8 桶：1-10 … 71-80+（≥71 归末桶；0=贴脸双金等异常小值归首桶） */
const GAP_BUCKETS = ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80+'];

function gapBucketIndexOf(gap) {
  if (!(gap > 10)) return 0; // NaN/负数/≤10 一律首桶
  return Math.min(GAP_BUCKETS.length - 1, Math.floor((gap - 1) / 10));
}

function ts(r) { return Number(r.gachaTs) || 0; }

/** 按时间正序（旧→新） */
function chronological(records) { return [...records].sort((a, b) => ts(a) - ts(b)); }

/** 免费十连（30 抽奖励的加急十连）：游戏规则不计保底、不占计费抽数。
 *  官方记录带 isFree:true 标记；小黑盒等工具同样将其从抽数统计中单列。
 *  统计口径：抽数/保底游走/折算/月度/百分位只用计费记录；
 *  金卡列表仍如实展示（免费出的金打 free 标记），但不参与保底计数（不进位也不重置）。 */
const isFreeRec = (r) => !!(r && r.isFree);

/** 本地卡池名录 poolName(去「」)→type 映射（dataloader charBanners，含远端覆盖层）。 */
function buildPoolTypeMap(charBanners) {
  const m = new Map();
  for (const b of charBanners || []) {
    const name = String((b && b.name) || '').replace(/[「」]/g, '');
    if (name && KNOWN_POOL_TYPES.has(b.type) && !m.has(name)) m.set(name, b.type);
  }
  return m;
}

/** 记录 → 池类型。判定次序：
 *  1) 官方 poolType 枚举映射（有值时最权威）；
 *  2) 本地卡池名录按 poolName 归类——官方记录常缺 poolType，旧逻辑只嗅探「基础寻访」，
 *     辉光庆典等特殊池会被误归限定轨、污染 80 抽跨池保底统计（P2 修复）；
 *  3) 兜底嗅探：基础寻访→standard，其余→limited。 */
function poolTypeOf(r, bannerTypeMap) {
  const mapped = POOL_TYPE_MAP[r.poolType] || r.poolType;
  if (KNOWN_POOL_TYPES.has(mapped)) return mapped;
  const byName = bannerTypeMap && bannerTypeMap.get(String(r.poolName || '').replace(/[「」]/g, ''));
  if (byName && KNOWN_POOL_TYPES.has(byName)) return byName;
  if (r.poolId === 'standard' || r.poolName === '基础寻访') return 'standard';
  return 'limited';
}

function monthKey(ms) { return new Date(ms).toISOString().slice(0, 7); }

/** 时间窗：最早/最晚时间戳 + 受约90天保留期影响的月份（月初早于保留截断点的月份） */
function windowOf(records) {
  let oldest = Infinity;
  let newest = -Infinity;
  const months = new Set();
  for (const r of records) {
    const t = ts(r);
    if (!t) continue;
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
    months.add(monthKey(t));
  }
  if (!isFinite(oldest) || !isFinite(newest)) return { oldest: null, newest: null, incompleteMonths: [] };
  const cutoff = Date.now() - 90 * 86400000;
  const incompleteMonths = [...months]
    .filter(m => {
      const [y, mo] = m.split('-').map(Number);
      return Date.UTC(y, mo - 1, 1) < cutoff;
    })
    .sort();
  return { oldest, newest, incompleteMonths };
}

/** 折算：1抽=500嵌晶玉；1源石=75玉；648元=350源石(非首充)/560源石(首充)，人民币向上取整到元 */
function spendOf(pulls) {
  const jade = pulls * 500;
  return {
    jade,
    stones: Math.round(jade / 75 * 10) / 10,
    rmbNonFirst: Math.ceil(jade / 75 / 350 * 648),
    rmbFirst: Math.ceil(jade / 75 / 560 * 648)
  };
}

function bucketIndexOf(spent) {
  for (let i = 0; i < PITY_BUCKETS.length; i++) {
    const b = PITY_BUCKETS[i];
    if (spent >= b.min && spent <= b.max) return i;
  }
  return PITY_BUCKETS.length - 1;
}

/** 由模拟原始样本精确累计 10..240 抽获得 UP 的概率；
 *  cum 从 0 起算时 120 抽大保底必出 UP，故 ≥120 的点恒为 1。
 *  samples 缺失时退回直方图近似（>80 桶宽变粗，仅作兜底）。 */
function curveFromHistogram(hist, trials) {
  const upper = (label) => String(label).startsWith('>') ? Infinity : Number(String(label).split('-')[1]);
  const buckets = Object.entries(hist || {})
    .map(([label, count]) => ({ up: upper(label), count: count || 0 }))
    .sort((a, b) => a.up - b.up);
  const curve = [];
  let acc = 0;
  let bi = 0;
  for (let n = 10; n <= 240; n += 10) {
    while (bi < buckets.length && buckets[bi].up <= n) { acc += buckets[bi].count; bi++; }
    let prob = trials > 0 ? acc / trials : 0;
    if (n >= 120) prob = 1;
    curve.push({ pulls: n, prob: +Math.min(1, prob).toFixed(4) });
  }
  return curve;
}

function curveOf(sim) {
  const samples = sim && sim.samples;
  if (!Array.isArray(samples)) return curveFromHistogram(sim && sim.histogram, sim ? sim.trials : 0);
  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.length;
  const curve = [];
  let idx = 0;
  for (let n = 10; n <= 240; n += 10) {
    while (idx < total && sorted[idx] <= n) idx++;
    let prob = total > 0 ? idx / total : 0;
    if (n >= 120) prob = 1;
    curve.push({ pulls: n, prob: +Math.min(1, prob).toFixed(4) });
  }
  return curve;
}

function analyze(uid, acc) {
  const d = getData();
  const accSafe = acc || {};
  const charAll = chronological(accSafe.char || []);
  const weaponAll = chronological(accSafe.weapon || []);
  const charPaid = charAll.filter(r => !isFreeRec(r));   // 计费记录（统计口径）
  const weaponPaid = weaponAll.filter(r => !isFreeRec(r));
  const freeRecs = charAll.filter(isFreeRec);            // 免费记录单列（仅展示口径）
  const charFree = freeRecs.length;
  const weaponFree = weaponAll.length - weaponPaid.length;
  const bannerTypeMap = buildPoolTypeMap(d.charBanners);
  const charByType = {};
  const poolBuckets = new Map(); // poolId -> {poolId, poolName, recs[], free}（限定轨+基础寻访；搭本遍历顺手累计）
  const dayMap = new Map();      // 'YYYY-MM-DD'(UTC，与 monthly 同口径) -> {pulls, golds}（计费角色记录按日聚合）
  for (const r of charPaid) {
    const t = poolTypeOf(r, bannerTypeMap);
    (charByType[t] = charByType[t] || []).push(r);
    if (t === 'limited' || t === 'rerun' || t === 'standard') {
      const k = r.poolId || r.poolName || '?';
      let b = poolBuckets.get(k);
      if (!b) { b = { poolId: k, poolName: r.poolName, recs: [], free: 0 }; poolBuckets.set(k, b); }
      b.poolName = r.poolName; // 记录按时间正序遍历，以池内最新记录的池名为准
      b.recs.push(r);
    }
    const day = new Date(ts(r)).toISOString().slice(0, 10);
    const dv = dayMap.get(day) || { pulls: 0, golds: 0 };
    dv.pulls += 1;
    if (r.rarity === 6) dv.golds += 1;
    dayMap.set(day, dv);
  }
  // 免费抽数并入对应池（仅展示 free 字段；免费记录不进计费口径）
  for (const r of freeRecs) {
    const t = poolTypeOf(r, bannerTypeMap);
    if (t !== 'limited' && t !== 'rerun' && t !== 'standard') continue;
    const k = r.poolId || r.poolName || '?';
    let b = poolBuckets.get(k);
    if (!b) { b = { poolId: k, poolName: r.poolName, recs: [], free: 0 }; poolBuckets.set(k, b); }
    b.free += 1;
  }

  /* ---- 保底状态推断 ---- */
  const trackOf = (types) => [].concat(...types.map(t => charByType[t] || []));
  const inferPity = (recs) => {
    let n = 0;
    for (let i = recs.length - 1; i >= 0; i--) {
      if (recs[i].rarity === 6) break;
      n++;
    }
    return n;
  };
  const limitedRecs = trackOf(['limited', 'rerun']);
  const limitedPity = inferPity(limitedRecs);
  const standardPity = inferPity(trackOf(['standard']));

  // 当前(最近出现的)限定池与其中数据 —— 窗口内口径
  const lastPoolId = limitedRecs.length ? limitedRecs[limitedRecs.length - 1].poolId : null;
  const currentPoolRecs = lastPoolId ? limitedRecs.filter(r => r.poolId === lastPoolId) : [];
  const bannerByName = new Map(d.charBanners.map(b => [b.name, b]));
  const upOf = (r) => {
    const b = bannerByName.get((r.poolName || '').replace(/[「」]/g, ''));
    return b && b.up6 ? b.up6 : null;
  };
  const lastSixInPool = [...currentPoolRecs].reverse().find(r => r.rarity === 6);
  const currentPoolUp = lastSixInPool ? upOf(lastSixInPool) : null;
  const currentUpObtained = !!(lastSixInPool && currentPoolUp && lastSixInPool.charName === currentPoolUp);

  /* ---- 六星与歪率（计费记录游走；免费出的金补充进列表，打 free 标记，不参与保底口径） ---- */
  const golds = [];
  let sinceGold = 0;
  for (let i = limitedRecs.length - 1; i >= 0; i--) {
    const r = limitedRecs[i];
    if (r.rarity === 6) {
      const up = upOf(r);
      golds.unshift({
        name: r.charName, ts: ts(r), pool: r.poolName, pity: sinceGold,
        isUp: !!(up && up === r.charName), isNew: !!r.isNew
      });
      sinceGold = 0;
    } else sinceGold++;
  }
  const freeLimitedGolds = freeRecs
    .filter(r => r.rarity === 6 && poolTypeOf(r, bannerTypeMap) !== 'standard')
    .map(r => ({ name: r.charName, ts: ts(r), pool: r.poolName, pity: null, isUp: !!(upOf(r) && upOf(r) === r.charName), isNew: !!r.isNew, free: true }));
  golds.unshift(...freeLimitedGolds); // 时间维度上免费金一般更早，直接放最前（列表本就按新→旧展示）
  const upCount = golds.filter(g => g.isUp).length;

  /* ---- 武器（既有 weaponPools 视图；计费口径） ---- */
  const weaponByPool = {};
  for (const r of weaponPaid) (weaponByPool[r.poolId] = weaponByPool[r.poolId] || []).push(r);
  const weaponPools = Object.entries(weaponByPool).map(([poolId, recs]) => {
    const last = recs[recs.length - 1];
    const wSix = [...recs].reverse().find(r => r.rarity === 6);
    let since6 = 0;
    for (let i = recs.length - 1; i >= 0; i--) { if (recs[i].rarity === 6) break; since6++; }
    return { poolId, poolName: last.poolName, pulls: recs.length, since6, lastSix: wSix ? wSix.weaponName : null };
  }).sort((a, b) => b.pulls - a.pulls);

  /* ---- 汇总 ---- */
  const countBy = (arr) => {
    const c = { 6: 0, 5: 0, 4: 0 };
    for (const r of arr) c[r.rarity] = (c[r.rarity] || 0) + 1;
    return c;
  };
  const charR = countBy(charPaid);
  const wpnR = countBy(weaponPaid);
  const totalPulls = charPaid.length + weaponPaid.length;
  const sixStars = charR[6];
  const freeSix = freeRecs.filter(r => r.rarity === 6).length;
  const avgPerGold = sixStars ? +(charPaid.length / sixStars).toFixed(1) : null;
  const luck = sixStars
    ? { rating: avgPerGold / 54 <= 0.75 ? '欧皇' : avgPerGold / 54 <= 0.92 ? '比较欧' : avgPerGold / 54 <= 1.1 ? '中规中矩' : avgPerGold / 54 <= 1.35 ? '有点非' : '非酋附体' }
    : { rating: '暂无出金' };

  // 月度抽数（图表用；免费十连不计）
  const monthly = {};
  for (const r of charPaid) {
    const k = new Date(ts(r)).toISOString().slice(0, 7);
    monthly[k] = (monthly[k] || 0) + 1;
  }

  const sixRate = charPaid.length ? +(sixStars / charPaid.length * 100).toFixed(2) : null;
  const upShare = golds.length ? +(upCount / golds.length * 100).toFixed(1) : null;
  const pityView = {
    limitedPity, standardPity,
    currentPool: {
      poolId: lastPoolId,
      poolName: currentPoolRecs.length ? currentPoolRecs[0].poolName : null,
      pullsInWindow: currentPoolRecs.length,
      upObtained: currentUpObtained
    }
  };
  const goldsLatestFirst = golds.slice().reverse();

  /* ---- 契约扩展：char 保底分布 / 时间线 / 欧非百分位 / 折算 / 时间窗 ---- */
  // 注意：既有 golds[].pity 是"该金之后到下一金的非六星数"（最新金=当前保底水位），
  // 与契约的"该金花费抽数"口径不同；故时间线/分布独立按时间正序游走，不动既有字段。
  const pityBuckets = PITY_BUCKETS.map(b => ({ label: b.label, count: 0 }));
  let hardPityHits = 0;
  let softPityHits = 0;
  const goldTimeline = [];
  let sinceLast6 = 0;
  for (const r of limitedRecs) { // 时间正序
    if (r.rarity === 6) {
      const spent = sinceLast6 + 1; // 该金花费抽数（1 基）
      const up = upOf(r);
      goldTimeline.push({ ts: ts(r), name: r.charName, up: !!(up && up === r.charName), pity: spent });
      pityBuckets[bucketIndexOf(spent)].count++;
      if (spent === 80) hardPityHits++;
      else if (spent >= 66 && spent <= 79) softPityHits++;
      sinceLast6 = 0;
    } else sinceLast6++;
  }

  // golds[].spent：该金的真实花费抽数（与 goldTimeline 同口径，1 基）。
  // 旧 pity 字段语义是"该金之后到下一金的非六星数"（即下一金花费-1；最新金=当前保底水位），
  // 直接 +1 展示会把每行的出货抽数错位成下一颗金的——前端必须用 spent。
  const spentByGold = new Map(goldTimeline.map(g => [g.ts + '|' + g.name, g.pity]));
  for (const g of golds) g.spent = spentByGold.get(g.ts + '|' + g.name) ?? null;

  /* ---- gapHistogram：相邻两金间隔的分布（金数<2 → 空数组）----
   * gap = 下一金起始pity - 上一金起始pity - 1：把每颗金按"累计消耗抽数"定位（上一金后计数归零），
   * 两金位置之差再扣掉金本身 1 抽 = 两金之间的非六星数，即下一金花费抽数 - 1。 */
  const gapHistogram = [];
  if (goldTimeline.length >= 2) {
    for (const label of GAP_BUCKETS) gapHistogram.push({ label, count: 0 });
    for (let i = 1; i < goldTimeline.length; i++) {
      gapHistogram[gapBucketIndexOf(goldTimeline[i].pity - 1)].count++;
    }
  }

  /* ---- offAfterOff：歪后下一金是否 UP 的经验统计（样本=前驱为歪金的相邻对数）----
   * 打破「歪后必中」错觉：终末地每金独立 50%，经验比率只会围绕 50% 波动。样本<3 时不出比率。 */
  let afterOffTotal = 0;
  let afterOffUp = 0;
  for (let i = 1; i < goldTimeline.length; i++) {
    if (!goldTimeline[i - 1].up) {
      afterOffTotal++;
      if (goldTimeline[i].up) afterOffUp++;
    }
  }
  const offAfterOff = {
    afterOffTotal,
    afterOffUp,
    observedRate: afterOffTotal >= 3 ? +(afterOffUp / afterOffTotal * 100).toFixed(1) : null
  };

  // luckPercentile：同计费抽数角色池机制蒙特卡洛，出金数百分位（越高越欧）
  let luckPercentile = null;
  if (charPaid.length > 0) {
    try {
      const trials = charPaid.length > 6000 ? 10000 : 20000; // 极端大窗口降试验数控时（<0.5s 量级）
      const sims = simulateSixCounts(charPaid.length, { trials, seed: LUCK_SIM_SEED });
      let less = 0;
      let equal = 0;
      for (const s of sims) { if (s < sixStars) less++; else if (s === sixStars) equal++; }
      luckPercentile = +((less + 0.5 * equal) / sims.length * 100).toFixed(1);
    } catch { luckPercentile = null; } // 模拟异常不拖垮分析接口
  }

  /* ---- poolBreakdown：限定轨每池一条 + 基础寻访一条（特殊/新手池不进明细）----
   * pulls/golds/upCount/sinceLast6 均为计费口径；free=该池免费抽数（仅展示）；
   * firstTs/lastTs=池内计费记录时间跨度（ms，仅免费记录的池为 null）；按 lastTs 倒序（新池在前）。 */
  const poolBreakdown = [...poolBuckets.values()].map(b => {
    const recs = b.recs;
    let since = 0;
    for (let i = recs.length - 1; i >= 0; i--) { if (recs[i].rarity === 6) break; since++; }
    let golds = 0;
    let upCount = 0;
    let firstTs = Infinity;
    let lastTs = -Infinity;
    for (const r of recs) {
      const t = ts(r);
      if (t < firstTs) firstTs = t;
      if (t > lastTs) lastTs = t;
      if (r.rarity === 6) {
        golds++;
        const up = upOf(r);
        if (up && up === r.charName) upCount++;
      }
    }
    return {
      poolId: b.poolId,
      poolName: b.poolName != null ? b.poolName : null,
      pulls: recs.length,
      free: b.free,
      golds,
      upCount,
      sinceLast6: since,
      firstTs: isFinite(firstTs) ? firstTs : null,
      lastTs: isFinite(lastTs) ? lastTs : null
    };
  }).sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

  /* ---- activity：计费角色记录按 UTC 日期聚合（与 monthly 同口径；免费十连不计）---- */
  const activeDays = dayMap.size;
  const activity = {
    activeDays,
    avgPerActiveDay: activeDays ? +(charPaid.length / activeDays).toFixed(1) : null,
    topDays: [...dayMap.entries()]
      .map(([date, v]) => ({ date, pulls: v.pulls, golds: v.golds }))
      .sort((a, b) => (b.pulls - a.pulls) || (a.date < b.date ? 1 : -1)) // 抽数降序，同抽数新日期在前
      .slice(0, 5)
  };

  const charFiveCount = charR[5] || 0;
  const charContract = {
    sixStars,
    freeSix,
    freePulls: charFree,
    pulls: charPaid.length,
    rate: sixRate,
    avgPerGold,
    upRate: upShare,
    luckRating: luck.rating,
    pity: pityView,
    monthly,
    golds: goldsLatestFirst,
    fiveStar: { count: charFiveCount, avgPer: charFiveCount ? +(charPaid.length / charFiveCount).toFixed(1) : null },
    pityBuckets,
    hardPityHits,
    softPityHits,
    goldTimeline,
    luckPercentile,
    spend: spendOf(charPaid.length),
    poolBreakdown,
    gapHistogram,
    offAfterOff,
    activity,
    window: windowOf(charAll)
  };

  /* ---- 契约扩展：weapon（40 抽保底不跨期继承，按池独立游走） ---- */
  const wBannerByName = new Map(d.wpnBanners.map(b => [b.name, b]));
  const wUpOf = (r) => {
    const b = wBannerByName.get((r.poolName || '').replace(/[「」]/g, ''));
    return b && b.up6 ? b.up6 : null;
  };
  const wGoldCount = wpnR[6] || 0;
  const wFiveCount = wpnR[5] || 0;
  const wSinceByPool = {};
  const wGoldTimeline = [];
  let wUpCount = 0;
  for (const r of weaponPaid) { // 时间正序
    const k = r.poolId || r.poolName || '?';
    wSinceByPool[k] = (wSinceByPool[k] || 0) + 1;
    if (r.rarity === 6) {
      const up = wUpOf(r);
      const isUp = !!(up && up === r.weaponName);
      if (isUp) wUpCount++;
      wGoldTimeline.push({ ts: ts(r), name: r.weaponName, up: isUp, pity: wSinceByPool[k] });
      wSinceByPool[k] = 0;
    }
  }
  // pity40：最新记录所属武器池的 40 抽保底进度（游走法，与 weaponPools.since6 同口径）
  let pity40 = 0;
  if (weaponPaid.length) {
    const last = weaponPaid[weaponPaid.length - 1];
    pity40 = wSinceByPool[last.poolId || last.poolName || '?'] || 0;
  }
  const weaponContract = {
    pulls: weaponPaid.length,
    freePulls: weaponFree,
    golds: wGoldCount,
    rate: weaponPaid.length ? +(wGoldCount / weaponPaid.length * 100).toFixed(2) : null,
    avgPerGold: wGoldCount ? +(weaponPaid.length / wGoldCount).toFixed(1) : null,
    upRate: wGoldCount ? +(wUpCount / wGoldCount * 100).toFixed(1) : null, // 对照官方 25%
    fiveStar: { count: wFiveCount, avgPer: wFiveCount ? +(weaponPaid.length / wFiveCount).toFixed(1) : null },
    goldTimeline: wGoldTimeline,
    pity40,
    window: windowOf(weaponAll)
  };

  return {
    uid,
    updatedAt: accSafe.updatedAt,
    windowNote: '官方仅保留约90天记录，以下指标基于可获取窗口',
    totals: { totalPulls, char: charPaid.length, weapon: weaponPaid.length, charFree, weaponFree, charR, wpnR },
    luck: { ...luck, avgPerGold, sixRate, upShare },
    pity: pityView,
    golds: goldsLatestFirst,
    weaponPools,
    monthly,
    char: charContract,
    weapon: weaponContract
  };
}

/** 未来预测：基于当前保底状态跑蒙特卡洛 */
function predict(analysis, acc, opts) {
  const TRIALS = (opts && opts.trials) || 100000;
  const d = getData();
  const active = d.charBanners.find(b => (b.type === 'limited' || b.type === 'rerun') && b.status === 'active')
    || d.charBanners.filter(b => b.type === 'limited' || b.type === 'rerun').pop();
  const init = {
    pity6: analysis.pity.limitedPity,
    cum: 0,           // 预测口径：进入"目标池"时的单池累计（当前池窗口内累计不可靠，从0起算偏保守）
    upObtained: false
  };
  // 折算双档（口径同 char.spend/spendOf：648元=350源石非首充 / 560源石首充，向上取整到元）。
  // 旧 cny（648=280 源石档）与前端/旧测试兼容保留，展示口径应改用 cnyNonFirst/cnyFirst。
  const toCost = (meanPulls) => {
    const jade = meanPulls * 500;
    return {
      pulls: Math.round(meanPulls),
      jade: Math.round(jade),
      originium: +(jade / 75).toFixed(1),
      cny: Math.round(jade / 75 / 280 * 648),
      cnyNonFirst: Math.ceil(jade / 75 / 350 * 648),
      cnyFirst: Math.ceil(jade / 75 / 560 * 648)
    };
  };
  const out = { banner: active ? { id: active.id, name: active.name, up6: active.up6 } : null, scenarios: [] };
  // 场景1：在当前(进行中)池继续抽到UP —— 继承 pity 与窗口内单池累计（口径保守，界面标注90天窗口）
  const cur = analysis.pity.currentPool || {};
  const isCurrentActive = active && cur.poolName && cur.poolName.replace(/[「」]/g, '') === active.name;
  const s1 = simulateCharacter(active ? active.id : 'c14', {
    target: 'up', trials: TRIALS,
    init: { pity6: init.pity6, cum: isCurrentActive ? Math.min(cur.pullsInWindow || 0, 119) : 0, upObtained: isCurrentActive ? !!cur.upObtained : false }
  });
  out.scenarios.push({ name: '当前池继续抽到 UP（含已累计进度）', fromPity: init.pity6, mean: s1.mean, median: s1.median, p90: s1.p90, within80: s1.within80Rate, cost: toCost(s1.mean) });
  // 场景2：下一期新卡池（pity 继承、单池累计清零）；samples 供 curve 逐抽累计用
  const s2 = simulateCharacter(active ? active.id : 'c14', { target: 'up', trials: TRIALS, init: { pity6: init.pity6, cum: 0, upObtained: false }, returnSamples: true });
  out.scenarios.push({ name: '下一期新卡池抽到 UP（保底继承）', fromPity: init.pity6, mean: s2.mean, median: s2.median, p90: s2.p90, within80: s2.within80Rate, cost: toCost(s2.mean) });
  // 场景3：从零开始攒一个新UP（完全新建号口径参考）
  const s3 = simulateCharacter(active ? active.id : 'c14', { target: 'up', trials: TRIALS, init: { pity6: 0, cum: 0, upObtained: false } });
  out.scenarios.push({ name: '从 0 保底开始抽到 UP', fromPity: 0, mean: s3.mean, median: s3.median, p90: s3.p90, within80: s3.within80Rate, cost: toCost(s3.mean) });

  // curve：10..240 抽（步长10）获得 UP 的累计概率 —— 复用场景2（下一期新池、保底继承）的原始样本
  out.curve = curveOf(s2);
  // monthlyPulls：近 90 天角色池抽卡量 / 3（月均）；无记录为 null
  let monthlyPulls = null;
  if (acc && Array.isArray(acc.char)) {
    const cutoff = Date.now() - 90 * 86400000;
    let recent = 0;
    for (const r of acc.char) {
      if (!r || r.isFree) continue; // 免费十连不计频率
      if ((Number(r.gachaTs) || 0) >= cutoff) recent++;
    }
    if (recent > 0) monthlyPulls = +(recent / 3).toFixed(1);
  }
  out.monthlyPulls = monthlyPulls;
  // daysToP90：按该月均频率攒够场景2 P90 抽数所需天数
  out.daysToP90 = monthlyPulls && s2.p90 ? Math.ceil(s2.p90 / monthlyPulls * 30) : null;
  return out;
}

/* ================= CSV 导出（\ufeff BOM 前置，保证 Excel 中文不乱码） ================= */

/** CSV 字段转义：含逗号/引号/换行时用双引号包裹并双写内部引号 */
function escapeCsvField(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const csvLine = (fields) => fields.map(escapeCsvField).join(',');

/** 表头 + 行 → CSV 文本（前置 BOM，CRLF 行尾，末尾换行收口） */
function toCsv(headers, rows) {
  return '\ufeff' + [csvLine(headers)].concat(rows.map(csvLine)).join('\r\n') + '\r\n';
}

/** 官方缓存记录 → CSV 文本。列：time(ISO),pool,name,rarity,up,isFree,type。
 *  up：仅六星行用本地卡池 up6 判定（1/0），非六星或池无法判定留空；角色/武器按时间正序混排。 */
function officialRecordsCsv(acc) {
  const d = getData();
  const accSafe = acc || {};
  const bannerByName = new Map(d.charBanners.map(b => [b.name, b]));
  const wBannerByName = new Map(d.wpnBanners.map(b => [b.name, b]));
  const upFlag = (bannerMap, poolNameRaw, name, rarity) => {
    if (rarity !== 6) return '';
    const b = bannerMap.get(String(poolNameRaw || '').replace(/[「」]/g, ''));
    if (!b || !b.up6) return '';
    return name === b.up6 ? 1 : 0;
  };
  const isoOf = (r) => {
    const t = Number(r && r.gachaTs);
    return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : '';
  };
  const nameOf = (r, kind) => (
    kind === 'char' ? (r.charName != null ? r.charName : (r.nameText != null ? r.nameText : ''))
                    : (r.weaponName != null ? r.weaponName : (r.nameText != null ? r.nameText : ''))
  );
  const rows = []
    .concat((accSafe.char || []).filter(Boolean).map(r => ({ r, kind: 'char', t: Number(r.gachaTs) || 0 })))
    .concat((accSafe.weapon || []).filter(Boolean).map(r => ({ r, kind: 'weapon', t: Number(r.gachaTs) || 0 })))
    .sort((a, b) => a.t - b.t)
    .map(({ r, kind }) => {
      const name = nameOf(r, kind);
      return [
        isoOf(r),
        r.poolName != null ? r.poolName : '',
        name,
        r.rarity != null ? r.rarity : '',
        upFlag(kind === 'char' ? bannerByName : wBannerByName, r.poolName, name, r.rarity),
        isFreeRec(r) ? 1 : 0,
        kind
      ];
    });
  return toCsv(['time', 'pool', 'name', 'rarity', 'up', 'isFree', 'type'], rows);
}

module.exports = {
  analyze, predict, POOL_TYPE_MAP,
  buildPoolTypeMap, poolTypeOf, gapBucketIndexOf,
  escapeCsvField, toCsv, officialRecordsCsv
};
