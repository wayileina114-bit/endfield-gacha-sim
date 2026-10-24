'use strict';
/**
 * 蒙特卡洛模拟：抽到目标为止的抽数分布（期望/预算规划用）
 */
const { getData } = require('./dataloader');
const { sixStarRate } = require('./character');

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/**
 * 角 characters 池：target = 'up'（当期UP六星）| 'any6'（任意六星）
 * init: { pity6, cum, upObtained } 可选初始状态
 */
function simulateCharacter(bannerId, { target = 'up', trials = 100000, init = {}, seed, returnSamples = false } = {}) {
  const data = getData();
  const banner = data.bannerById.get(bannerId);
  if (!banner || banner.category !== 'character' || !['limited', 'rerun'].includes(banner.type)) {
    throw new Error('蒙特卡洛仅支持特许/重构寻访');
  }
  const { makeRng } = require('./rng');
  const rng = makeRng(seed);
  const rules = data.rules.characterBanner;
  const results = new Array(trials);
  const cap = 320;

  for (let t = 0; t < trials; t++) {
    let pity6 = init.pity6 || 0;
    let cum = init.cum || 0;
    let upObtained = init.upObtained || false;
    let pulls = 0;
    let done = false;
    while (pulls < cap && !done) {
      pulls += 1;
      cum += 1;
      pity6 += 1;
      const forced120 = cum >= rules.bannerGuarantee.cumulativePulls && !upObtained;
      const p6 = sixStarRate(pity6, rules.softPity);
      if (forced120 || pity6 >= rules.softPity.hardPityPull || rng() < p6) {
        pity6 = 0;
        const isUp = forced120 ? true : rng() < rules.upShareOnSixStar;
        if (isUp) upObtained = true;
        if (target === 'any6' || isUp) done = true;
      }
    }
    results[t] = pulls;
  }

  const summary = summarize(results, trials, cap);
  // opt-in：返回原始样本（官方记录 predict.curve 需要逐抽精度；
  // summarize 的直方图桶宽在 >80 后变粗，无法支撑 10 抽步长的累计概率）
  if (returnSamples) summary.samples = results;
  return summary;
}

/**
 * 固定抽数蒙特卡洛：统计单次 pulls 抽内获得的六星数量（官方记录 luckPercentile 用）
 * 采用角色池保底机制（0.8% 基础 + 66 抽起软保底 + 80 抽硬保底）。
 * 不建模单池 120 井：玩家总抽数跨多卡池聚合，无法还原各池单池累计，属可接受近似。
 */
function simulateSixCounts(pulls, { trials = 20000, seed, softPity } = {}) {
  const data = getData();
  const sp = softPity || data.rules.characterBanner.softPity;
  const { makeRng } = require('./rng');
  const rng = makeRng(seed);
  const out = new Array(trials);
  for (let t = 0; t < trials; t++) {
    let pity6 = 0;
    let sixes = 0;
    for (let n = 0; n < pulls; n++) {
      pity6 += 1;
      if (pity6 >= sp.hardPityPull || rng() < sixStarRate(pity6, sp)) { sixes += 1; pity6 = 0; }
    }
    out[t] = sixes;
  }
  return out;
}

/** 武器池：抽到当期UP武器为止（含里程碑：第180抽保送UP） */
function simulateWeapon(bannerId, { trials = 100000, init = {}, seed } = {}) {
  const data = getData();
  const banner = data.bannerById.get(bannerId);
  if (!banner || banner.category !== 'weapon') throw new Error('未找到该武库申领');
  const { makeRng } = require('./rng');
  const rng = makeRng(seed);
  const rules = data.rules.weaponBanner;
  const results = new Array(trials);
  const cap = 200;

  for (let t = 0; t < trials; t++) {
    let cum = init.cum || 0;
    let since6 = init.since6 || 0;
    let upObtained = init.upObtained || false;
    let pulls = 0;
    while (pulls < cap && !upObtained) {
      pulls += 1; cum += 1; since6 += 1;
      const forcedUp80 = cum >= rules.bannerUpGuaranteePulls && !upObtained;
      const milestoneUp = cum === 180; // 累计180保送UP
      if (forcedUp80 || milestoneUp || since6 >= rules.hardPityR6 || rng() < rules.rates.r6) {
        since6 = 0;
        const isUp = forcedUp80 || milestoneUp ? true : rng() < rules.upShareWithinR6;
        if (isUp) upObtained = true;
      }
    }
    results[t] = pulls;
  }
  return summarize(results, trials, cap);
}

function summarize(results, trials, cap) {
  const sorted = [...results].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / trials;
  const histogram = {};
  const bucket = (n) => (n <= 10 ? '01-10' : n <= 20 ? '11-20' : n <= 30 ? '21-30' : n <= 40 ? '31-40'
    : n <= 50 ? '41-50' : n <= 60 ? '51-60' : n <= 70 ? '61-70' : n <= 80 ? '71-80' : n <= 100 ? '81-100'
      : n <= 120 ? '101-120' : n <= 160 ? '121-160' : n <= 200 ? '161-200' : `>${200}`);
  for (const r of sorted) {
    const b = bucket(r);
    histogram[b] = (histogram[b] || 0) + 1;
  }
  return {
    trials,
    cap,
    mean: +mean.toFixed(2),
    median: percentile(sorted, 0.5),
    p10: percentile(sorted, 0.1),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: sorted[trials - 1],
    min: sorted[0],
    within50Rate: +(sorted.filter(x => x <= 50).length / trials).toFixed(4),
    within80Rate: +(sorted.filter(x => x <= 80).length / trials).toFixed(4),
    within120Rate: +(sorted.filter(x => x <= 120).length / trials).toFixed(4),
    histogram
  };
}

/** 六星数百分位（模拟器 /api/state luck.percentile 用）：
 *  对 pulls 抽角色池跑同机制蒙特卡洛，统计实际 sixes 的百分位（中位秩法，50=中位，越高越欧）。
 *  固定种子 → 同一存档结果可复现；试验数按总抽数预算（≈200 万次抽判定，<50ms 量级）；
 *  输入非法返回 null（"无出金为 null"由调用方在 hasData 判断处保证）。 */
const SIM_LUCK_SEED = 20261024;

function sixCountPercentile(pulls, sixes, { seed, trials } = {}) {
  const n = Number(pulls);
  const x = Number(sixes);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(x) || x < 0) return null;
  const t = trials || Math.max(800, Math.min(20000, Math.floor(2000000 / n)));
  const sims = simulateSixCounts(n, { trials: t, seed: seed === undefined ? SIM_LUCK_SEED : seed });
  let less = 0;
  let equal = 0;
  for (const s of sims) { if (s < x) less++; else if (s === x) equal++; }
  return +((less + 0.5 * equal) / sims.length * 100).toFixed(1);
}

module.exports = { simulateCharacter, simulateWeapon, simulateSixCounts, sixCountPercentile };
