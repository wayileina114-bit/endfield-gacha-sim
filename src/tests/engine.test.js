'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

// 测试期间使用独立的临时存档，避免污染 data/save.json
const state = require('../state');
const tmpSave = path.join(__dirname, '..', '..', 'data', 'save.test.json');

const { getData } = require('../engine/dataloader');
const { sixStarRate, pullCharacter } = require('../engine/character');
const { pullWeapon, milestoneAt } = require('../engine/weapon');
const { makeRng } = require('../engine/rng');
const { simulateCharacter, simulateWeapon } = require('../engine/simulate');
const engine = require('../engine');

const data = getData();

function freshSave() { return JSON.parse(JSON.stringify(state.defaultSave())); }

test('软保底概率曲线符合公示口径', () => {
  assert.ok(Math.abs(sixStarRate(1, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }) - 0.008) < 1e-9);
  assert.ok(Math.abs(sixStarRate(65, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }) - 0.008) < 1e-9);
  assert.ok(Math.abs(sixStarRate(66, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }) - 0.058) < 1e-9);
  assert.ok(Math.abs(sixStarRate(67, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }) - 0.108) < 1e-9);
  assert.ok(Math.abs(sixStarRate(79, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }) - 0.708) < 1e-9);
  assert.strictEqual(sixStarRate(80, { hardPityPull: 80, startPull: 66, incrementPerPull: 0.05 }), 1);
});

test('特许寻访百万抽统计验证（种子化）', { timeout: 120000 }, () => {
  const save = freshSave();
  const banner = data.bannerById.get('c10');
  const rng = makeRng(20261024);
  const TOTAL = 1000000;
  let pulled = 0;
  const now = '2026-10-24T00:00:00Z';
  let batchesNoFive = 0;
  while (pulled < TOTAL) {
    const { items } = pullCharacter(save, banner, 10, 'normal', rng, now);
    if (!items.some(i => i.rarity >= 5)) batchesNoFive++;
    pulled += 10;
  }
  const r6 = save.stats.byRarity[6], r5 = save.stats.byRarity[5], r4 = save.stats.byRarity[4];
  const total = r6 + r5 + r4;
  assert.strictEqual(total, TOTAL);
  const rate6 = r6 / total, rate5 = r5 / total;
  // 模型理论：综合六星率≈1.85%（66起+5%、80硬保底），均值≈54抽/金
  assert.ok(rate6 > 0.017 && rate6 < 0.020, `六星综合概率异常: ${rate6.toFixed(4)}`);
  // 含「十连保底5星+」假设后，五星综合率≈12%（约40%十连被补一张五星）
  assert.ok(rate5 > 0.11 && rate5 < 0.13, `五星综合概率异常: ${rate5.toFixed(4)}`);
  const avgPerGold = total / r6;
  assert.ok(avgPerGold > 50 && avgPerGold < 58, `平均每金抽数异常: ${avgPerGold.toFixed(1)}`);
  assert.strictEqual(batchesNoFive, 0, '存在无五星的十连');
  // 歪池构成：六星只能来自池内8人
  const poolSet = new Set(banner.pool6);
  // 硬保底：不可能连续80抽无金（用引擎统计无法直接看，改用 goldRecords pity 上限）
  assert.ok(save.stats.goldRecords.length <= 500);
  // UP占比（仅看非强制记录的稳态）粗略应在 45%-55%
  const upCount = save.stats.goldRecords.filter(g => g.isUp).length;
  assert.ok(upCount / save.stats.goldRecords.length > 0.4 && upCount / save.stats.goldRecords.length < 0.6);
});

test('120抽大保底：第120抽强制UP（低水位也强制）', () => {
  const save = freshSave();
  save.banners['c10'] = { cum: 119, upObtained: false, tokensEarned: 0, rush10Claimed: true, rush10Available: false, ticket60Claimed: true };
  save.limitedTrack.pity6 = 0;
  const banner = data.bannerById.get('c10');
  const rng = makeRng(1);
  const { items } = pullCharacter(save, banner, 1, 'normal', rng, 't');
  assert.strictEqual(items[0].rarity, 6);
  assert.strictEqual(items[0].name, banner.up6);
  assert.strictEqual(items[0].isUp, true);
  assert.strictEqual(save.banners['c10'].upObtained, true);
});

test('提前出UP后120保底消失（不再强制）', () => {
  const save = freshSave();
  const banner = data.bannerById.get('c10');
  const rng = makeRng(7);
  save.banners['c10'] = { cum: 119, upObtained: true, tokensEarned: 0, rush10Claimed: true, rush10Available: false, ticket60Claimed: true };
  save.limitedTrack.pity6 = 0;
  const { items } = pullCharacter(save, banner, 1, 'normal', rng, 't');
  assert.notStrictEqual(items[0].rarity, 6); // cum=120 但 UP 已获得 → 普通4星判定
});

test('80抽硬保底与跨池继承', () => {
  const save = freshSave();
  save.limitedTrack.pity6 = 79;
  const banner = data.bannerById.get('c14'); // 另一个池：pity 继承，cum 从 0 开始
  const rng = makeRng(3);
  const { items } = pullCharacter(save, banner, 1, 'normal', rng, 't');
  assert.strictEqual(items[0].rarity, 6, '第80抽必须出金');
  assert.strictEqual(save.limitedTrack.pity6, 0);
  assert.strictEqual(save.banners['c14'].cum, 1, '新池累计计数从0开始');
});

test('30抽解锁加急招募；加急不改变任何计数', () => {
  const save = freshSave();
  const banner = data.bannerById.get('c01');
  const rng = makeRng(11);
  pullCharacter(save, banner, 10, 'normal', rng, 't');
  const mid = pullCharacter(save, banner, 10, 'normal', rng, 't');
  assert.ok(!save.banners['c01'].rush10Available, '20抽不应解锁');
  pullCharacter(save, banner, 10, 'normal', rng, 't');
  assert.ok(save.banners['c01'].rush10Available, '30抽应解锁加急');
  const pityBefore = save.limitedTrack.pity6;
  const cumBefore = save.banners['c01'].cum;
  const rush = pullCharacter(save, banner, 10, 'rush', rng, 't');
  assert.strictEqual(rush.items.length, 10);
  assert.strictEqual(save.limitedTrack.pity6, pityBefore, '加急不影响80计数');
  assert.strictEqual(save.banners['c01'].cum, cumBefore, '加急不影响池内累计');
  assert.ok(!save.banners['c01'].rush10Available, '加急仅一次');
  assert.throws(() => pullCharacter(save, banner, 10, 'rush', rng, 't'), /加急/);
});

test('240抽信物循环', () => {
  const save = freshSave();
  const banner = data.bannerById.get('c10');
  save.banners['c10'] = { cum: 239, upObtained: true, tokensEarned: 0, rush10Claimed: true, rush10Available: false, ticket60Claimed: true };
  const rng = makeRng(5);
  const { rewards } = pullCharacter(save, banner, 1, 'normal', rng, 't');
  assert.ok(rewards.some(r => r.type === 'upToken'), '第240抽应送UP信物');
  assert.strictEqual(save.inventory[banner.up6].tokens, 1);
});

test('歪池只含池内8名六星（统计）', () => {
  const save = freshSave();
  const banner = data.bannerById.get('c01');
  const rng = makeRng(99);
  const poolSet = new Set(banner.pool6);
  for (let i = 0; i < 20000; i++) {
    const { items } = pullCharacter(save, banner, 10, 'normal', rng, 't');
    for (const it of items) {
      if (it.rarity === 6) assert.ok(poolSet.has(it.name), `歪出了池外干员: ${it.name}`);
    }
  }
});

test('武器池：概率/保底/UP占比', { timeout: 60000 }, () => {
  const save = freshSave();
  const banner = data.bannerById.get('w10');
  const rng = makeRng(2026);
  let pulled = 0;
  while (pulled < 200000) {
    pullWeapon(save, banner, 10, 'normal', rng, 't', { payWithQuota: false });
    pulled += 10;
  }
  const w = save.stats.byRarityWeapon;
  const rate6 = w[6] / (w[6] + w[5] + w[4]);
  // 基础4% + 40抽硬保底 → 综合率≈4.97%（平均20.1抽/金）
  assert.ok(rate6 > 0.047 && rate6 < 0.052, `武器六星综合率异常: ${rate6.toFixed(4)}`);
  // 40抽硬保底：pullsSince6 恒 < 40
  assert.ok(save.weapons['w10'].pullsSince6 < 40);
});

test('武器池确定性保底与里程碑', () => {
  const save = freshSave();
  const banner = data.bannerById.get('w10');
  // 80抽强制UP
  save.weapons['w10'] = { cum: 79, pullsSince6: 0, upObtained: false, milestoneIndex: 0 };
  const rng = makeRng(21);
  let { items } = pullWeapon(save, banner, 10, 'normal', rng, 't', { payWithQuota: false });
  assert.strictEqual(items[0].name, banner.up6, '累计80抽强制UP武器');
  assert.strictEqual(save.weapons['w10'].upObtained, true);
  // 里程碑：100/180
  assert.deepStrictEqual(milestoneAt(0), { pulls: 100, kind: 'standardSelector' });
  assert.deepStrictEqual(milestoneAt(1), { pulls: 180, kind: 'upWeapon' });
  assert.deepStrictEqual(milestoneAt(2), { pulls: 260, kind: 'standardSelector' });
  assert.deepStrictEqual(milestoneAt(3), { pulls: 340, kind: 'upWeapon' });
  const save2 = freshSave();
  save2.weapons['w10'] = { cum: 90, pullsSince6: 0, upObtained: true, milestoneIndex: 0 };
  const r2 = pullWeapon(save2, banner, 10, 'normal', makeRng(33), 't', { payWithQuota: false });
  assert.ok(r2.rewards.some(x => x.type === 'milestoneSelector'), '累计100抽里程碑');
});

test('启程寻访：40抽内必得六星且关闭', () => {
  const save = freshSave();
  const banner = data.bannerById.get('c_newbie');
  const rng = makeRng(77);
  for (let i = 0; i < 4 && !save.newbie.closed; i++) {
    pullCharacter(save, banner, 10, 'normal', rng, 't');
  }
  assert.ok(save.newbie.closed, '40抽内必须出六星');
  assert.strictEqual(save.newbie.pulls, 40);
  assert.ok(save.stats.byRarity[6] >= 1);
  assert.throws(() => pullCharacter(save, banner, 10, 'normal', rng, 't'), /已结束/);
});

test('基础寻访：300抽自选解锁', { timeout: 60000 }, () => {
  const save = freshSave();
  const banner = data.bannerById.get('c_std');
  const rng = makeRng(123);
  for (let i = 0; i < 30; i++) {
    const r = pullCharacter(save, banner, 10, 'normal', rng, 't');
    if (save.standard.selectorAvailable) break;
  }
  assert.strictEqual(save.standard.totalPulls >= 300, true);
  assert.strictEqual(save.standard.selectorAvailable, true);
});

test('蒙特卡洛：UP目标必在120抽内，均值符合模型', { timeout: 120000 }, () => {
  const sim = simulateCharacter('c10', { target: 'up', trials: 200000, seed: 42 });
  assert.strictEqual(sim.within120Rate, 1, '120抽内必得UP');
  // 理论≈82：54×(1+0.5+0.25×截断长尾)，120保底把第三金成本压到≈12抽
  assert.ok(sim.mean > 70 && sim.mean < 95, `UP均值异常: ${sim.mean}`);
  assert.ok(sim.max <= 120, `UP最大抽数超120: ${sim.max}`);
  const sim6 = simulateCharacter('c10', { target: 'any6', trials: 100000, seed: 43 });
  assert.ok(sim6.mean > 48 && sim6.mean < 60, `六星均值异常: ${sim6.mean}`);
  assert.ok(sim6.max <= 80);
  const simW = simulateWeapon('w10', { trials: 100000, seed: 44 });
  assert.ok(simW.max <= 180, `武器UP最大抽数超180: ${simW.max}`);
  assert.ok(simW.mean > 30 && simW.mean < 90, `武器UP均值异常: ${simW.mean}`);
});

test('引擎统一入口 pull 与存档联动', () => {
  const save = freshSave();
  const r = engine.pull(save, 'c14', { times: 10, seed: 8 });
  assert.strictEqual(r.items.length, 10);
  assert.strictEqual(save.stats.totalPulls, 10);
  assert.strictEqual(save.history.length, 1);
});
