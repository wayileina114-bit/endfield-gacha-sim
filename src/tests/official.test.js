'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  analyze, predict, buildPoolTypeMap, poolTypeOf,
  gapBucketIndexOf, escapeCsvField, toCsv, officialRecordsCsv
} = require('../official/analyze');
const { sixCountPercentile } = require('../engine/simulate');
const { getData } = require('../engine/dataloader');
const store = require('../official/store');
const hgApi = require('../official/hg-api');

/** 合成：万物更新池 60 抽，第 61 抽歪了出余烬，再 20 抽后 UP 祀 */
function synth() {
  const mk = (i, name, rarity, poolName, poolType, seq) => ({
    charId: 'x', charName: name, rarity, poolId: poolName, poolName, poolType,
    gachaTs: String(1770000000000 + i * 60000), seqId: String(seq), isNew: true
  });
  const char = [];
  let seq = 1;
  for (let i = 0; i < 60; i++) char.push(mk(i, '埃特拉', 4, '万物更新', 'E_CharacterGachaPoolType_Special', seq++));
  char.push(mk(60, '余烬', 6, '万物更新', 'E_CharacterGachaPoolType_Special', seq++));
  for (let i = 61; i < 80; i++) char.push(mk(i, '秋栗', 4, '万物更新', 'E_CharacterGachaPoolType_Special', seq++));
  char.push(mk(80, '祀', 6, '万物更新', 'E_CharacterGachaPoolType_Special', seq++));
  for (let i = 81; i < 92; i++) char.push(mk(i, '安塔尔', 4, '万物更新', 'E_CharacterGachaPoolType_Special', seq++));
  const weapon = [];
  for (let i = 0; i < 12; i++) weapon.push({
    weaponName: '四星单手剑', rarity: 4, poolId: 'weponbox_1_6_1', poolName: '篆玉申领',
    gachaTs: String(1770000000000 + i * 60000), seqId: String(1000 + i)
  });
  return { char, weapon, updatedAt: new Date().toISOString() };
}

test('官方记录分析：保底/UP/评级推断', () => {
  const a = analyze('123', synth());
  assert.strictEqual(a.totals.char, 92);
  assert.strictEqual(a.totals.charR[6], 2);
  // 限定计数：最后一个六星(祀, idx80)之后 11 抽 → pity=11
  assert.strictEqual(a.pity.limitedPity, 11);
  // 六星记录：2条，祀 为 UP，余烬 为歪
  assert.strictEqual(a.golds.length, 2);
  const goldNames = a.golds.map(g => g.name);
  assert.ok(goldNames.includes('祀') && goldNames.includes('余烬'));
  const si = a.golds.find(g => g.name === '祀');
  assert.strictEqual(si.isUp, true);
  const yu = a.golds.find(g => g.name === '余烬');
  assert.strictEqual(yu.isUp, false);
  // 当前池 UP 已获得
  assert.strictEqual(a.pity.currentPool.upObtained, true);
  // UP 占比 50%
  assert.strictEqual(a.luck.upShare, 50);
  // 武器池窗口 12 抽 since6=12
  assert.strictEqual(a.weaponPools[0].since6, 12);
  assert.ok(a.monthly && Object.keys(a.monthly).length >= 1);
});

test('未来预测：三场景返回且数值合理', () => {
  const a = analyze('123', synth());
  const p = predict(a);
  assert.strictEqual(p.scenarios.length, 3);
  for (const s of p.scenarios) {
    assert.ok(s.mean > 10 && s.mean < 130);
    assert.ok(s.cost.jade > 0 && s.cost.cny > 0);
  }
  // 当前池已累计(92抽,UP已得) → 场景1均值应低于从零场景3
  assert.ok(p.scenarios[0].mean <= p.scenarios[2].mean + 5);
});

test('记录增量合并按 seqId 去重', () => {
  const st = { accounts: {} };
  const recs = synth().char.slice(0, 5);
  assert.strictEqual(store.mergeRecords(st, 'u1', 'char', recs), 5);
  assert.strictEqual(store.mergeRecords(st, 'u1', 'char', recs), 0);
  assert.strictEqual(store.mergeRecords(st, 'u1', 'char', [synth().char[5]]), 1);
  assert.strictEqual(st.accounts.u1.char.length, 6);
});

/* ---- 短信/扫码登录：纯函数级测试（不联网） ---- */

test('扫码状态映射：官方数字状态 → 本地语义，scanCode 仅在确认态提取', () => {
  // 实测口径：100=待扫码、101=已过期、0=已确认（data 含 scanCode）
  assert.strictEqual(hgApi.mapScanStatus(0), 'confirmed');
  assert.strictEqual(hgApi.mapScanStatus(100), 'pending');
  assert.strictEqual(hgApi.mapScanStatus(101), 'expired');
  assert.strictEqual(hgApi.mapScanStatus(500), 'error');
  assert.strictEqual(hgApi.mapScanStatus(undefined), 'error');
  assert.strictEqual(hgApi.extractScanCode({ status: 0, data: { scanCode: 'sc_x' } }), 'sc_x');
  assert.strictEqual(hgApi.extractScanCode({ status: 100, msg: '未扫码' }), null);
  assert.strictEqual(hgApi.extractScanCode({ status: 101, msg: '已过期' }), null);
  assert.strictEqual(hgApi.extractScanCode({ status: 0, data: {} }), null);   // 确认但缺 scanCode
  assert.strictEqual(hgApi.extractScanCode({ status: 0, data: { scanCode: '' } }), null);
  assert.strictEqual(hgApi.extractScanCode(null), null);
});

test('手机号输入校验（发码/短信登录共用）', () => {
  assert.strictEqual(hgApi.isValidPhone('13812345678'), true);
  assert.strictEqual(hgApi.isValidPhone(' 13812345678 '), true); // 容错首尾空白
  assert.strictEqual(hgApi.isValidPhone('12345678901'), false);  // 探针假号：第二位非 3-9
  assert.strictEqual(hgApi.isValidPhone('1381234567'), false);   // 10 位
  assert.strictEqual(hgApi.isValidPhone('138123456789'), false); // 12 位
  assert.strictEqual(hgApi.isValidPhone('23812345678'), false);  // 非 1 开头
  assert.strictEqual(hgApi.isValidPhone(''), false);
  assert.strictEqual(hgApi.isValidPhone(null), false);
  assert.strictEqual(hgApi.isValidPhone(undefined), false);
});

test('空记录输入校验：analyze/predict 不抛错且消费估算为正数', () => {
  const a = analyze('u0', { char: [], weapon: [], updatedAt: null });
  assert.strictEqual(a.totals.totalPulls, 0);
  assert.strictEqual(a.pity.limitedPity, 0);
  assert.strictEqual(a.luck.rating, '暂无出金');
  const p = predict(a);
  assert.strictEqual(p.scenarios.length, 3);
  for (const s of p.scenarios) {
    assert.ok(s.cost.jade > 0 && s.cost.cny > 0 && s.cost.pulls > 0);
  }
});

/* ---- 分析契约扩展字段（char/weapon/predict 新指标） ---- */

test('契约扩展：char 五星/保底分布/时间线/折算/时间窗与 weapon 同口径指标', () => {
  const acc = synth();
  const a = analyze('123', acc);
  // char 基础映射
  assert.strictEqual(a.char.sixStars, 2);
  assert.strictEqual(a.char.rate, +(2 / 92 * 100).toFixed(2));
  assert.strictEqual(a.char.upRate, 50);
  assert.strictEqual(a.char.luckRating, a.luck.rating);
  assert.strictEqual(a.char.fiveStar.count, 0);
  assert.strictEqual(a.char.fiveStar.avgPer, null);
  // 保底计数分布（1 基花费抽数）：余烬第 61 抽 → 61-75；祀第 20 抽 → 11-30
  assert.strictEqual(a.char.pityBuckets.length, 5);
  assert.strictEqual(a.char.pityBuckets.reduce((s, b) => s + b.count, 0), 2);
  assert.strictEqual(a.char.pityBuckets.find(b => b.label === '61-75').count, 1);
  assert.strictEqual(a.char.pityBuckets.find(b => b.label === '11-30').count, 1);
  assert.strictEqual(a.char.hardPityHits, 0);
  assert.strictEqual(a.char.softPityHits, 0);
  // 时间线正序，pity=该金花费抽数，up 为布尔
  assert.deepStrictEqual(a.char.goldTimeline.map(g => g.name), ['余烬', '祀']);
  assert.deepStrictEqual(a.char.goldTimeline.map(g => g.pity), [61, 20]);
  assert.deepStrictEqual(a.char.goldTimeline.map(g => g.up), [false, true]);
  // golds[].spent = 该金真实花费抽数（旧 pity 字段是"下一金花费-1"，不可当出货抽数用）
  assert.strictEqual(a.golds.find(g => g.name === '余烬').spent, 61);
  assert.strictEqual(a.golds.find(g => g.name === '祀').spent, 20);
  // spend：92×500=46000 玉；首充档人民币更低；两档向上取整为整数
  assert.strictEqual(a.char.spend.jade, 46000);
  assert.ok(a.char.spend.rmbNonFirst > a.char.spend.rmbFirst);
  assert.ok(Number.isInteger(a.char.spend.rmbNonFirst) && Number.isInteger(a.char.spend.rmbFirst));
  // luckPercentile 在 [0,100]
  assert.ok(a.char.luckPercentile !== null && a.char.luckPercentile >= 0 && a.char.luckPercentile <= 100);
  // window：时间戳 + 受 90 天保留期影响的月份（合成数据在 2026-02，必然早于保留截断点）
  assert.strictEqual(a.char.window.oldest, 1770000000000);
  assert.ok(a.char.window.incompleteMonths.includes('2026-02'));
  // weapon 契约（同口径）
  assert.strictEqual(a.weapon.pulls, 12);
  assert.strictEqual(a.weapon.golds, 0);
  assert.strictEqual(a.weapon.rate, 0);
  assert.strictEqual(a.weapon.avgPerGold, null);
  assert.strictEqual(a.weapon.upRate, null);
  assert.strictEqual(a.weapon.pity40, 12);
  assert.deepStrictEqual(a.weapon.goldTimeline, []);
  assert.strictEqual(typeof a.weapon.window.oldest, 'number');
});

/* ---- 免费十连口径：isFree 记录不计抽数/不进保底（与小黑盒对齐） ---- */

test('免费十连：isFree 不计抽数、不进保底游走、免费金单列不重置保底', () => {
  const acc = synth();
  const base = acc.char.length; // 92
  let seq = 500;
  const freeRec = (i, name, rarity) => ({
    charId: 'f', charName: name, rarity, poolId: '万物更新', poolName: '万物更新',
    poolType: 'E_CharacterGachaPoolType_Special', isFree: true,
    gachaTs: String(1770000000000 + (base + i) * 60000), seqId: String(seq++), isNew: false
  });
  for (let i = 0; i < 10; i++) acc.char.push(freeRec(i, '埃特拉', 4));  // 免费十连
  acc.char.push(freeRec(10, '别礼', 6));                                // 免费出了个六星
  const a = analyze('123', acc);
  // 计费口径完全不变
  assert.strictEqual(a.totals.char, 92);
  assert.strictEqual(a.totals.charFree, 11);
  assert.strictEqual(a.char.pulls, 92);
  assert.strictEqual(a.char.freePulls, 11);
  assert.strictEqual(a.char.spend.jade, 92 * 500); // 折算也只按计费抽数
  // 保底游走跳过免费记录（不进位、免费金也不重置）：仍为 11
  assert.strictEqual(a.pity.limitedPity, 11);
  // 免费金：进金卡列表（free 标记、无保底数），不计入计费六星数
  assert.strictEqual(a.totals.charR[6], 2);
  assert.strictEqual(a.char.freeSix, 1);
  const fg = a.golds.find(g => g.free);
  assert.ok(fg && fg.name === '别礼');
  assert.strictEqual(fg.pity, null);
  assert.strictEqual(fg.spent, null); // 免费金无保底口径花费
  // 保底分布/时间线仍只含计费金
  assert.strictEqual(a.char.pityBuckets.reduce((s, b) => s + b.count, 0), 2);
  assert.strictEqual(a.char.goldTimeline.length, 2);
});

test('契约扩展：predict.curve 单调且 120 抽封顶，monthlyPulls/daysToP90 缺数据安全', () => {
  const acc = synth();
  const a = analyze('123', acc);
  const p = predict(a, acc);
  assert.strictEqual(p.curve.length, 24);
  assert.strictEqual(p.curve[0].pulls, 10);
  assert.strictEqual(p.curve[p.curve.length - 1].pulls, 240);
  assert.strictEqual(p.curve[p.curve.length - 1].prob, 1);
  for (let i = 1; i < p.curve.length; i++) {
    assert.ok(p.curve[i].prob >= p.curve[i - 1].prob, 'curve 必须单调不减');
  }
  // 合成数据早于 90 天窗口（当前运行日期 2026-10）→ 无近期数据；若非空则两字段必须联动
  if (p.monthlyPulls != null) {
    assert.ok(p.monthlyPulls > 0);
    assert.ok(Number.isInteger(p.daysToP90) && p.daysToP90 > 0);
  } else {
    assert.strictEqual(p.daysToP90, null);
  }
});

/* ---- 分析增强：poolBreakdown / gapHistogram / offAfterOff / activity / CSV / 模拟器百分位 ---- */

const T0 = 1770000000000;

/** 造一条角色记录；poolId 默认同池名（与 synth 一致），opts 可覆盖 poolId/poolType/isFree */
function mkChar(i, name, rarity, poolName, seq, opts = {}) {
  return {
    charId: 'x', charName: name, rarity,
    poolId: opts.poolId || poolName, poolName,
    poolType: opts.poolType,
    gachaTs: String(T0 + i * 60000), seqId: String(seq), isNew: false,
    isFree: !!opts.isFree
  };
}

/** 造限定轨（万物更新，UP=祀）：spec 每项 {gap, name}，gap=该金之前的非六星数 */
function buildTrack(spec, poolName = '万物更新') {
  const char = [];
  let seq = 1, i = 0;
  for (const s of spec) {
    for (let k = 0; k < s.gap; k++) char.push(mkChar(i++, '埃特拉', 4, poolName, seq++));
    char.push(mkChar(i++, s.name, 6, poolName, seq++));
  }
  return char;
}

test('poolTypeOf：池名映射归类（P2），辉光庆典不再误归限定轨', () => {
  const m = buildPoolTypeMap(getData().charBanners);
  assert.strictEqual(m.get('辉光庆典'), 'special');
  assert.strictEqual(poolTypeOf({ poolName: '辉光庆典' }, m), 'special');
  assert.strictEqual(poolTypeOf({ poolName: '万物更新' }, m), 'limited');
  assert.strictEqual(poolTypeOf({ poolName: '绚丽异彩' }, m), 'rerun');
  assert.strictEqual(poolTypeOf({ poolName: '基础寻访' }, m), 'standard');
  assert.strictEqual(poolTypeOf({ poolName: '启程寻访' }, m), 'newbie');
  // 官方 poolType 枚举仍最优先
  assert.strictEqual(poolTypeOf({ poolType: 'E_CharacterGachaPoolType_Joint', poolName: '辉光庆典' }, m), 'special');
  // 映射未命中 → 既有兜底（standard 嗅探 → limited）
  assert.strictEqual(poolTypeOf({ poolName: '从未登记的池' }, m), 'limited');
  assert.strictEqual(poolTypeOf({ poolId: 'standard', poolName: '??' }, m), 'standard');
});

test('P2 修复：辉光庆典记录不进限定轨（pity/时间线/池明细不受污染）', () => {
  const acc = synth(); // 万物更新 92 抽 2 金，limitedPity=11
  let seq = 800;
  for (let i = 0; i < 4; i++) acc.char.push(mkChar(300 + i, '莱万汀', i === 0 ? 6 : 4, '辉光庆典', seq++, { poolId: 'special_hg' }));
  const a = analyze('hg1', acc);
  assert.deepStrictEqual(a.char.goldTimeline.map(g => g.name), ['余烬', '祀']);
  assert.strictEqual(a.pity.limitedPity, 11);
  assert.strictEqual(a.char.poolBreakdown.find(p => p.poolName === '辉光庆典'), undefined);
  assert.strictEqual(a.totals.char, 96); // 计费总抽数仍如实包含特殊池
});

test('gapHistogram：相邻金间隔固定 8 桶与边界（0/10/11/70/71）', () => {
  assert.strictEqual(gapBucketIndexOf(0), 0);
  assert.strictEqual(gapBucketIndexOf(1), 0);
  assert.strictEqual(gapBucketIndexOf(10), 0);
  assert.strictEqual(gapBucketIndexOf(11), 1);
  assert.strictEqual(gapBucketIndexOf(70), 6);
  assert.strictEqual(gapBucketIndexOf(71), 7);
  assert.strictEqual(gapBucketIndexOf(999), 7);
  // 各金前非六星数 0,0,9,10,69,70,71 → 相邻间隔（下一金花费-1）= 0,9,10,69,70,71
  const a = analyze('gh1', { char: buildTrack([
    { gap: 0, name: '祀' }, { gap: 0, name: '祀' }, { gap: 9, name: '祀' },
    { gap: 10, name: '祀' }, { gap: 69, name: '祀' }, { gap: 70, name: '祀' }, { gap: 71, name: '祀' }
  ]), weapon: [] });
  const gh = a.char.gapHistogram;
  assert.deepStrictEqual(gh.map(b => b.label), ['1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80+']);
  assert.strictEqual(gh.find(b => b.label === '1-10').count, 3);
  assert.strictEqual(gh.find(b => b.label === '61-70').count, 2);
  assert.strictEqual(gh.find(b => b.label === '71-80+').count, 1);
  assert.strictEqual(gh.reduce((s, b) => s + b.count, 0), 6);
  // 金数<2 → 空数组
  assert.deepStrictEqual(analyze('gh0', { char: buildTrack([{ gap: 5, name: '祀' }]), weapon: [] }).char.gapHistogram, []);
  // synth（余烬花费61→祀花费20）：间隔 19 → 11-20
  assert.strictEqual(analyze('gh2', synth()).char.gapHistogram.find(b => b.label === '11-20').count, 1);
});

test('offAfterOff：歪后下一金 UP 统计（样本<3 比率为 null）', () => {
  // 金序列 up,off,up,off,off,up → 前驱为歪金的相邻对 3 个，其中下一金 UP 的 2 个
  const a = analyze('oo1', { char: buildTrack([
    { gap: 3, name: '祀' }, { gap: 3, name: '余烬' }, { gap: 3, name: '祀' },
    { gap: 3, name: '余烬' }, { gap: 3, name: '余烬' }, { gap: 3, name: '祀' }
  ]), weapon: [] });
  assert.deepStrictEqual(a.char.offAfterOff, { afterOffTotal: 3, afterOffUp: 2, observedRate: 66.7 });
  // synth：金序列 [余烬(off), 祀(up)] → 样本 1 < 3
  assert.deepStrictEqual(analyze('oo2', synth()).char.offAfterOff, { afterOffTotal: 1, afterOffUp: 1, observedRate: null });
  // 无金安全默认
  assert.deepStrictEqual(
    analyze('oo3', { char: [], weapon: [] }).char.offAfterOff,
    { afterOffTotal: 0, afterOffUp: 0, observedRate: null }
  );
});

test('poolBreakdown：计费口径/免费单列/基础寻访并入/lastTs 倒序', () => {
  const acc = synth();
  let seq = 500;
  // 万物更新追加 10 抽免费（含 1 免费六星别礼）——免费不入 pulls/golds
  for (let i = 0; i < 10; i++) acc.char.push(mkChar(92 + i, '埃特拉', 4, '万物更新', seq++, { isFree: true }));
  acc.char.push(mkChar(102, '别礼', 6, '万物更新', seq++, { isFree: true }));
  // 基础寻访 5 抽计费（时间更晚；poolId=standard 与真实记录一致）
  for (let i = 0; i < 5; i++) acc.char.push(mkChar(200 + i, '艾尔黛拉', 4, '基础寻访', seq++, { poolId: 'standard' }));
  const a = analyze('pb1', acc);
  const pb = a.char.poolBreakdown;
  assert.strictEqual(pb.length, 2);
  assert.strictEqual(pb[0].poolName, '基础寻访'); // lastTs 更晚 → 新池在前
  const wu = pb.find(p => p.poolName === '万物更新');
  assert.strictEqual(wu.pulls, 92);            // 计费口径
  assert.strictEqual(wu.free, 11);             // 免费单列（仅展示）
  assert.strictEqual(wu.golds, 2);             // 免费金别礼不计入
  assert.strictEqual(wu.upCount, 1);           // 祀 UP
  assert.strictEqual(wu.sinceLast6, 11);       // 最后一金（祀）后 11 抽非六星
  assert.strictEqual(wu.firstTs, T0);
  assert.strictEqual(wu.lastTs, T0 + 91 * 60000); // firstTs/lastTs 只看计费记录
  const std = pb.find(p => p.poolName === '基础寻访');
  assert.strictEqual(std.poolId, 'standard');
  assert.strictEqual(std.pulls, 5);
  assert.strictEqual(std.golds, 0);
  assert.strictEqual(std.sinceLast6, 5);
  assert.strictEqual(std.free, 0);
  // 空数据安全默认
  assert.deepStrictEqual(analyze('pb0', { char: [], weapon: [] }).char.poolBreakdown, []);
});

test('activity：按 UTC 日期聚合计费角色记录，免费不计入', () => {
  const acc = synth(); // 92 条计费记录全在 T0 当天（UTC）
  let seq = 900;
  for (let i = 0; i < 10; i++) acc.char.push(mkChar(2000 + i, '埃特拉', 4, '万物更新', seq++));       // 次日
  for (let i = 0; i < 5; i++) acc.char.push(mkChar(2000 + i, '埃特拉', 4, '万物更新', seq++, { isFree: true }));
  const a = analyze('ac1', acc);
  const act = a.char.activity;
  assert.strictEqual(act.activeDays, 2);
  assert.strictEqual(act.avgPerActiveDay, 51); // 102 计费抽 / 2 天
  const day0 = new Date(T0).toISOString().slice(0, 10);
  assert.deepStrictEqual(act.topDays[0], { date: day0, pulls: 92, golds: 2 });
  assert.strictEqual(act.topDays.length, 2);
  assert.strictEqual(act.topDays[1].pulls, 10);
  assert.strictEqual(act.topDays[1].golds, 0);
  // 空数据安全默认
  assert.deepStrictEqual(
    analyze('ac0', { char: [], weapon: [] }).char.activity,
    { activeDays: 0, avgPerActiveDay: null, topDays: [] }
  );
});

test('CSV：转义、BOM、表头与官方记录导出口径', () => {
  assert.strictEqual(escapeCsvField('plain'), 'plain');
  assert.strictEqual(escapeCsvField('a,b'), '"a,b"');
  assert.strictEqual(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.strictEqual(escapeCsvField('a\nb'), '"a\nb"');
  assert.strictEqual(escapeCsvField(null), '');
  assert.strictEqual(escapeCsvField(undefined), '');
  assert.strictEqual(escapeCsvField(5), '5');
  assert.strictEqual(toCsv(['a', 'b'], [[1, 'x,y']]), '\ufeffa,b\r\n1,"x,y"\r\n');

  const body = officialRecordsCsv(synth());
  assert.ok(body.startsWith('\ufeff'));
  const lines = body.slice(1).replace(/\r\n$/, '').split('\r\n');
  assert.strictEqual(lines[0], 'time,pool,name,rarity,up,isFree,type');
  assert.strictEqual(lines.length - 1, 104); // char 92 + weapon 12
  assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(lines[1].split(',')[0])); // time 为 ISO
  assert.ok(lines[1].endsWith(',埃特拉,4,,0,char'));  // 首行=时间最早的 char[0]，四星 up 留空
  assert.ok(lines.some(l => l.endsWith(',祀,6,1,0,char')));     // UP 金 → 1
  assert.ok(lines.some(l => l.endsWith(',余烬,6,0,0,char')));   // 歪金 → 0
  assert.ok(lines.some(l => l.endsWith(',四星单手剑,4,,0,weapon'))); // 武器行
  // 池无法判定 → up 留空
  const b2 = officialRecordsCsv({ char: [mkChar(0, '祀', 6, '从未登记的池', 1)], weapon: [] });
  assert.ok(b2.includes(',从未登记的池,祀,6,,0,char'));
});

test('predict cost：双档口径同 spendOf（350/560），旧字段保留', () => {
  const acc = synth();
  const p = predict(analyze('dc1', acc), acc);
  assert.strictEqual(p.scenarios.length, 3);
  for (const s of p.scenarios) {
    assert.ok(s.cost.pulls > 0 && s.cost.jade > 0 && s.cost.cny > 0); // 旧字段仍在
    assert.strictEqual(s.cost.cnyNonFirst, Math.ceil(s.cost.jade / 75 / 350 * 648));
    assert.strictEqual(s.cost.cnyFirst, Math.ceil(s.cost.jade / 75 / 560 * 648));
    assert.ok(s.cost.cnyNonFirst > s.cost.cnyFirst);   // 非首充更贵
    assert.ok(s.cost.cny >= s.cost.cnyNonFirst);       // 旧 280 档最贵（兼容保留）
    assert.strictEqual(s.cost.originium, +(s.cost.jade / 75).toFixed(1));
  }
});

test('sixCountPercentile：范围/固定种子可复现/非法输入 null', () => {
  const p1 = sixCountPercentile(300, 5);
  assert.ok(p1 !== null && p1 >= 0 && p1 <= 100);
  assert.strictEqual(sixCountPercentile(300, 5), p1); // 固定种子 → 可复现
  assert.strictEqual(sixCountPercentile(120, 2), sixCountPercentile(120, 2, { seed: 20261024 }));
  assert.strictEqual(sixCountPercentile(0, 0), null);
  assert.strictEqual(sixCountPercentile(-5, 1), null);
  assert.strictEqual(sixCountPercentile(100, -1), null);
  assert.strictEqual(sixCountPercentile(NaN, 1), null);
});
