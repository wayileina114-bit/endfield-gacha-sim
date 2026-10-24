/**
 * views/rules.js — 机制说明
 * 渲染 /api/meta 的 rules（概率表 / 软保底 / 80·120·240 / 无大小保底红色警示 /
 * 保底继承 / 武器池 / 经济系统）、assumptions 待核实清单、数据来源与免责声明。
 * 所有数值取自 API，不硬编码。
 */
import { API } from '../api.js';
import { S, relTime, num, esc } from '../store.js';
import { toast } from '../ui.js';

export async function render(root) {
  if (!S.meta) {
    try { S.meta = await API.meta(); } catch (e) { toast(e.message, 'err'); }
  }
  const m = S.meta || {};
  const R = m.rules || {};
  const E = m.economy || {};
  const cb = R.characterBanner || {};
  const wb = R.weaponBanner || {};
  const sb = R.standardBanner || {};
  const nb = R.newbieBanner || {};
  const sp = R.specialBanners || {};
  const qr = R.quotaReward || {};
  const eco = E.currency || {};
  const tu = E.topUp || {};

  root.innerHTML = `
  <div class="rules-wrap">
    <h2 class="sec-title">寻访机制说明 <span class="t-dim" style="font-size:12px;font-weight:400">${esc((R._meta && R._meta.name) || '')}</span></h2>

    ${redAlert()}

    <div class="panel rule-block">
      <div class="panel-title">干员寻访（限定 / 重构）</div>
      ${rateTable(cb.rates, [
        ['六星', cb.rates && cb.rates.r6], ['五星', cb.rates && cb.rates.r5], ['四星', cb.rates && cb.rates.r4]
      ])}
      <div class="kv-list">
        <div class="kv"><span class="k">概率公式</span>${esc(cb.probabilityFormula || '—')}</div>
        <div class="kv"><span class="k">软保底</span>第 ${num(cb.softPity && cb.softPity.startPull)} 抽起每抽 +${pct(cb.softPity && cb.softPity.incrementPerPull)}，第 ${num(cb.softPity && cb.softPity.hardPityPull)} 抽必定六星</div>
        <div class="kv"><span class="k">UP 占比</span>出六星时 ${pct(cb.upShareOnSixStar)} 为当期 UP（无大小保底）</div>
        <div class="kv"><span class="k">120 井</span>${esc(cb.bannerGuarantee && cb.bannerGuarantee.note || '')}</div>
        <div class="kv"><span class="k">十连保底</span>${esc(cb.tenPullRarityFloor && cb.tenPullRarityFloor.note || '')}</div>
        <div class="kv"><span class="k">非 UP 分配</span>${esc(cb.offRateDistribution && cb.offRateDistribution.note || '')}</div>
      </div>
      ${cb.rewards ? `
      <div class="od-build" style="margin-top:10px">
        <div class="ob-t">累计寻访奖励</div>
        <p><span class="k">30 抽</span>解锁加急招募（免费十连，不计入任何保底/累计计数）</p>
        <p><span class="k">60 抽</span>获下期十连券</p>
        <p><span class="k">每 240 抽</span>额外获得当期 UP 六星信物 ×1，循环无上限，每期独立</p>
      </div>` : ''}
    </div>

    <div class="panel rule-block">
      <div class="panel-title">武库申领（武器池）</div>
      ${rateTable(wb.rates, [['六星', wb.rates && wb.rates.r6], ['五星', wb.rates && wb.rates.r5], ['四星', wb.rates && wb.rates.r4]])}
      <div class="kv-list">
        <div class="kv"><span class="k">UP 机制</span>出六星时 ${pct(wb.upShareWithinR6)} 为 UP 武器；UP 综合直达率 ${pct(wb.upRateDirect)}</div>
        <div class="kv"><span class="k">保底</span>${num(wb.hardPityR6)} 抽必出六星（出金重置计数）；单池累计 ${num(wb.bannerUpGuaranteePulls)} 抽必得 UP 武器（每期一次）</div>
        <div class="kv"><span class="k">软保底</span>${esc(wb.softPityNote || '无')}</div>
        <div class="kv"><span class="k">消耗</span>仅十连，${num(wb.costPerTenPullQuota)} 武库配额/次</div>
        <div class="kv"><span class="k">里程碑</span>${esc(wb.milestones && wb.milestones.note || '')}</div>
      </div>
    </div>

    <div class="panel rule-block">
      <div class="panel-title">基础寻访（常驻）与启程寻访（新手）</div>
      <div class="kv-list">
        <div class="kv"><span class="k">基础寻访</span>概率同限定池；${num(sb.selector && sb.selector.atPulls)} 抽可自选常驻六星五人之一（仅一次）；${esc(sb.hardPityPickFrom ? '80 抽保底出自：' + sb.hardPityPickFrom : '')}</div>
        <div class="kv"><span class="k">无 UP</span>${sb.noUp ? '常驻池无 UP 机制，限定 UP 干员永不进入基础寻访' : ''}</div>
        <div class="kv"><span class="k">启程寻访</span>${esc(nb ? `上限 ${num(nb.maxPulls)} 抽必得常驻六星，出六星后关闭；仅十连（主线赠送凭证，不消耗付费资源）；完成后附赠限定范围自选六星武器` : '')}</div>
      </div>
    </div>

    ${sp.huiguang ? `
    <div class="panel rule-block">
      <div class="panel-title">特殊寻访 · ${esc(sp.huiguang.name || '')}</div>
      <div class="kv-list">
        <div class="kv"><span class="k">保底</span>最多 ${num(sp.huiguang.maxPullsToSixStar)} 抽必出六星；${esc(sp.huiguang.perPullRateNote || '')}</div>
        <div class="kv"><span class="k">附赠</span>${esc(sp.huiguang.perPullReward || '')}</div>
        <div class="kv"><span class="k">卡池</span>${esc(sp.huiguang.poolNote || '')}</div>
        <div class="kv"><span class="k">独立</span>保底独立计算，不影响特许寻访计数</div>
      </div>
    </div>` : ''}

    <div class="panel rule-block">
      <div class="panel-title">保底继承规则</div>
      <div class="kv-list">
        <div class="kv"><span class="k">限定池间</span>${esc(cb.pityInheritance && cb.pityInheritance.note || '')}</div>
        <div class="kv"><span class="k">单池累计</span>120 井 / 240 信物 / 30 加急 / 60 券等单池计数每期独立，跨期清零不继承</div>
        <div class="kv"><span class="k">常驻 / 新手</span>基础寻访独立计数；启程寻访为一次性新手池</div>
      </div>
    </div>

    <div class="panel rule-block">
      <div class="panel-title">武库配额（寻访返利）</div>
      <div class="kv-list">
        <div class="kv"><span class="k">六星</span>+${num(qr.perSixStar)} 配额</div>
        <div class="kv"><span class="k">五星</span>+${num(qr.perFiveStar)} 配额</div>
        <div class="kv"><span class="k">四星</span>+${num(qr.perFourStar)} 配额</div>
        <div class="kv"><span class="k">用途</span>${esc(qr.note || '')}</div>
      </div>
    </div>

    <div class="panel rule-block">
      <div class="panel-title">经济系统</div>
      <div class="kv-list">
        <div class="kv"><span class="k">货币链</span>${esc(eco.chain || '')}</div>
        <div class="kv"><span class="k">单抽成本</span>${num(eco.jadePerPull)} 嵌晶玉；十连 ${num(eco.tenPullJade)}（${esc(eco.tenPullDiscount || '')}）</div>
        <div class="kv"><span class="k">源石兑换</span>1 衍质源石 = ${num(eco.jadePerOriginium)} 嵌晶玉</div>
        <div class="kv"><span class="k">首充</span>${esc(E.topUp && E.topUp.firstChargeBonus || '')}</div>
      </div>
      <div class="table-wrap" style="margin-top:10px"><table class="data-table">
        <thead><tr><th>充值档位</th><th>源石（基础）</th><th>非首充</th><th>首充</th><th>备注</th></tr></thead>
        <tbody>${(tu.tiers || []).map(t => `
          <tr>
            <td class="num">¥${num(t.cny)}</td>
            <td class="num">${num(t.originium)}</td>
            <td class="num">${t.nonFirst ? num(t.nonFirst) : '—'}</td>
            <td class="num">${t.first ? num(t.first) : '—'}</td>
            <td class="t-dim">${t.estimated ? '<span class="chip chip-gray">源石数为推算值</span>' : '官方公示'}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      ${E.subscriptions ? `
      <div style="margin-top:10px"><span class="f-label">月卡 / 通行证 / 礼包</span>
        <div class="kv-list" style="margin-top:4px">
          ${E.subscriptions.map(s => `<div class="kv"><span class="k">${esc(s.name)}</span>${esc(s.content)}</div>`).join('')}
        </div>
      </div>` : ''}
      ${E.quotaSources ? `
      <div style="margin-top:10px"><span class="f-label">武库配额获取途径</span>
        <div class="entry-chips" style="margin-top:6px">${(E.quotaSources.others || []).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
        <p style="font-size:12px;color:var(--dim);margin-top:6px">${esc(E.quotaSources.exchange || '')}</p>
      </div>` : ''}
    </div>

    <div class="panel rule-block">
      <div class="panel-title">待核实假设 <span class="pt-sub">以下内容官方未完全公示，为合理假设</span></div>
      <ul class="assump-list">
        ${(m.assumptions || []).map(a => `<li>${esc(a)}</li>`).join('')}
      </ul>
    </div>

    <div class="panel rule-block">
      <div class="panel-title">数据来源 <span class="pt-sub">官方数据最近同步：${esc(relTime(m.lastSync))}（${esc(m.lastSync || '')}）</span></div>
      <p style="font-size:12.5px">规则数值来自<b>官方公告及转载游戏内公示</b>的攻略多源交叉验证，卡池与干员名录按官方公告自动同步；配装 / 强度 / 刷取规划为社区攻略整理，有时效性。</p>
      <div class="src-domains">
        ${['endfield.hypergryph.com（官网公告）', 'wiki.biligame.com/zmd（BWIKI）', 'end.canmoe.com（数据站 / 立绘）', 'news.17173.com', 'gamersky.com（游民星空）', 'taptap.cn', 'gamekee.com', 'cg.163.com', 'zhihu.com', 'bbs.nga.cn'].map(d =>
          `<span class="src-domain">${esc(d)}</span>`).join('')}
      </div>
      <details class="src-fold">
        <summary>完整来源说明（对应仓库 data/SOURCES.md）</summary>
        <div style="padding:0 14px 14px;font-size:12px;color:var(--dim);line-height:1.9">
          官方来源：官网新闻页各期寻访说明（含概率提升干员名单、加急招募、40 信物、武库配额返利原文）与游戏内「寻访详情」概率公示。<br>
          抽卡机制交叉验证：17173 抽卡池机制与概率说明系列、知乎抽卡机制解析（逐抽概率推演）、B站专栏抽卡算法模拟、TapTap 卡池机制讨论（无大小保底/保底不继承）、NGA 二测抽卡系统解析、gamekee 终末地卡池规则。<br>
          卡池历史与干员名录：官网各期寻访公告、BWIKI（白露攻略组）寻访一览 / 干员图鉴 / 物品图鉴、canmoe 数据 wiki、灰机wiki、网易 1.6 抽卡建议。<br>
          配装与基质/材料（社区观点，有时效性）：游民星空基质系统详解与刷取攻略、TapTap 全武器基质养成一图流与各干员养成一图流、17173 掉落关卡效率表与材料刷取、cg.163 基质刷取 13 点规划。<br>
          充值档位：17173 充值档位转载；小额档位源石数为推算值。
        </div>
      </details>
    </div>

    <div class="disclaim">
      <b>免责声明</b>：本模拟器为非官方社区工具，与鹰角网络无关联。所有概率与规则以游戏内官方公示为准；卡池、干员数据可能随版本更新而过时；配装与强度评价为社区观点，不构成抽取或养成建议；模拟结果（含期望规划与成本换算）为模型推算，仅供参考。
    </div>
  </div>`;
}

function redAlert() {
  return `
    <div class="alert-red">
      <div class="ar-icon">!</div>
      <p>终末地寻访<b>没有大小保底</b>：出金仅 <b>50% 为当期 UP</b>，歪（非 UP）之后<b>没有必中 UP 的补偿机制</b>；唯一强制获得当期 UP 的途径是<b>单池累计 120 抽</b>（武器池为单池累计 80 抽必得 UP 武器）。请理性规划，适度消费。</p>
    </div>`;
}

function rateTable(rates, rows) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map(r => Number(r[1]) || 0), 0.0001);
  return `
    <table class="data-table rate-table">
      <thead><tr><th>稀有度</th><th>基础概率</th><th style="width:40%">占比示意</th></tr></thead>
      <tbody>${rows.map(([label, v]) => `
        <tr>
          <td><b>${esc(label)}</b></td>
          <td class="num t-amber">${pct(v)}</td>
          <td><span class="rt-bar" style="width:${((Number(v) || 0) / max * 100).toFixed(1)}%"></span></td>
        </tr>`).join('')}</tbody>
    </table>
    <p style="font-size:11.5px;color:var(--dim-2)">注：以上为基础概率；综合概率（含保底）高于基础概率，具体以游戏内公示为准。${(R_meta_note())}</p>`;
}

function R_meta_note() {
  const R = (S.meta && S.meta.rules) || {};
  return esc((R._meta && R._meta.note) || '');
}

function pct(x) {
  if (x == null || isNaN(x)) return '—';
  return (Number(x) * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
}
