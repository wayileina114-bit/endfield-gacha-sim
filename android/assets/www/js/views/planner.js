/**
 * views/planner.js — 期望规划（蒙特卡洛）
 * 卡池 + 目标（当期UP/任意六星；武器池固定UP武器）+ 模拟次数 → /api/simulate
 * 展示统计指标、抽数分布直方图、成本换算卡。
 */
import { API } from '../api.js';
import { S, num, esc, versionKey } from '../store.js';
import { toast, histogramHtml } from '../ui.js';

let running = false;

export async function render(root) {
  const charBanners = S.banners.filter(b => b.category === 'character');
  const wpnBanners = S.banners.filter(b => b.category === 'weapon');
  // 计算器默认保底水位：模拟器当前存档 limitedTrack.pity6（0-79 截断）
  const pityDefault = Math.max(0, Math.min(79, Math.floor(Number(S.save && S.save.limitedTrack && S.save.limitedTrack.pity6) || 0)));

  root.innerHTML = `
    <h2 class="sec-title">期望规划 · 蒙特卡洛模拟</h2>
    <div class="panel" style="margin-bottom:16px">
      <div class="planner-form">
        <div class="f-field" style="min-width:260px">
          <span class="f-label">选择卡池</span>
          <select class="f-input" id="pl-banner">
            <optgroup label="干员寻访">
              ${charBanners.map(b => `<option value="${esc(b.id)}">${esc(b.name)}${b.up6 ? '（UP ' + esc(b.up6) + '）' : ''}</option>`).join('')}
            </optgroup>
            <optgroup label="武库申领">
              ${wpnBanners.map(b => `<option value="${esc(b.id)}">${esc(b.name)}（UP ${esc(b.up6 || '—')}）</option>`).join('')}
            </optgroup>
          </select>
        </div>
        <div class="f-field">
          <span class="f-label">目标</span>
          <div class="radio-row" id="pl-target">
            <label class="radio-pill"><input type="radio" name="plt" value="up" checked><span>当期 UP</span></label>
            <label class="radio-pill"><input type="radio" name="plt" value="any6"><span>任意六星</span></label>
          </div>
        </div>
        <div class="f-field">
          <span class="f-label">模拟次数</span>
          <div class="radio-row" id="pl-trials">
            <label class="radio-pill"><input type="radio" name="plt2" value="10000"><span>1 万</span></label>
            <label class="radio-pill"><input type="radio" name="plt2" value="100000" checked><span>10 万</span></label>
            <label class="radio-pill"><input type="radio" name="plt2" value="500000"><span>50 万</span></label>
          </div>
        </div>
        <div class="f-field" style="flex-direction:row;align-items:center;gap:12px">
          <button class="btn btn-primary" id="pl-run">开始模拟</button>
          <span class="pd-subline" id="pl-hint" style="min-width:180px"></span>
        </div>
      </div>
    </div>
    <div id="pl-output">
      <div class="empty-hint" style="padding:30px 0">选择卡池与目标后点击「开始模拟」—— 结果含期望抽数、分位数、≤50/≤80/≤120 抽概率、分布直方图与抽卡成本换算。</div>
    </div>
    <div class="panel" style="margin-top:16px">
      <div class="panel-title">还差多少？<span class="pt-sub">从当前保底水位算到目标 · 与模拟同口径</span></div>
      <div class="planner-form">
        <div class="f-field" style="min-width:150px">
          <span class="f-label">当前限定保底计数</span>
          <input class="f-input" id="pl2-pity" type="number" min="0" max="79" step="1" inputmode="numeric" value="${pityDefault}">
        </div>
        <div class="f-field">
          <span class="f-label">目标</span>
          <div class="radio-row" id="pl2-target">
            <label class="radio-pill"><input type="radio" name="pl2t" value="up" checked><span>当期 UP</span></label>
            <label class="radio-pill"><input type="radio" name="pl2t" value="any6"><span>任意六星</span></label>
          </div>
        </div>
        <div class="f-field" style="flex-direction:row;align-items:center;gap:12px">
          <button class="btn btn-primary" id="pl2-run">算一算</button>
          <span class="pd-subline" id="pl2-hint" style="min-width:160px"></span>
        </div>
      </div>
      <div id="pl2-out"><div class="pd-subline" style="margin-top:10px">输入当前 80 抽保底计数（默认取模拟器存档水位），从该水位起算到目标出货的期望 / 中位 / P90 与两档人民币消耗。</div></div>
    </div>`;

  const bannerSel = root.querySelector('#pl-banner');
  const targetBox = root.querySelector('#pl-target');
  const runBtn = root.querySelector('#pl-run');
  const hint = root.querySelector('#pl-hint');
  const output = root.querySelector('#pl-output');

  // 武器池固定目标为 UP 武器
  function syncTarget() {
    const b = S.banners.find(x => x.id === bannerSel.value);
    const isWeapon = b && b.category === 'weapon';
    targetBox.style.display = isWeapon ? 'none' : 'flex';
    let fixed = root.querySelector('#pl-target-fixed');
    if (isWeapon) {
      if (!fixed) {
        fixed = document.createElement('div');
        fixed.className = 'pd-subline';
        fixed.id = 'pl-target-fixed';
        fixed.style.margin = '-4px 0 0';
        targetBox.after(fixed);
      }
      fixed.textContent = '目标固定为当期 UP 武器（武器池规则）';
    } else if (fixed) {
      fixed.remove();
    }
  }
  bannerSel.addEventListener('change', syncTarget);
  syncTarget();

  /* ---- 还差多少计算器：从当前保底水位到目标（纯表单 + 结果卡） ---- */
  const shortOut = root.querySelector('#pl2-out');
  const shortHint = root.querySelector('#pl2-hint');
  const shortBtn = root.querySelector('#pl2-run');
  // 目标池：当前进行中的限定/重构池，退而取最后一期（与官方记录预测同选择逻辑）
  const shortPool = S.banners.find(b => b.category === 'character' && (b.type === 'limited' || b.type === 'rerun') && b.status === 'active')
    || [...S.banners].reverse().find(b => b.category === 'character' && (b.type === 'limited' || b.type === 'rerun'));
  if (!shortPool) {
    shortBtn.disabled = true;
    shortOut.innerHTML = '<div class="empty-hint">暂无限定轨卡池数据，无法计算</div>';
  }
  shortBtn.addEventListener('click', async () => {
    if (running || !shortPool) return;
    let pity = Math.floor(Number(root.querySelector('#pl2-pity').value));
    if (!Number.isFinite(pity) || pity < 0) pity = 0;
    if (pity > 79) pity = 79; // 80 抽硬保底，输入截断
    const target = (root.querySelector('input[name="pl2t"]:checked') || { value: 'up' }).value;
    running = true;
    shortBtn.disabled = true;
    shortHint.textContent = '模拟中…';
    try {
      const r = await API.simulate({
        bannerId: shortPool.id, target, trials: 100000,
        init: { pity6: pity, cum: 0, upObtained: false }
      });
      const c = r.cost || {};
      const fmt = v => (v == null || isNaN(v)) ? '—' : num(v);
      shortOut.innerHTML = `
        <div class="pd-subline" style="margin-top:12px">目标池：<b class="t-amber">${esc(shortPool.name)}</b>（UP ${esc(shortPool.up6 || '—')}）· 起始保底 <b>${num(pity)}</b>/80 · ${num(r.trials)} 次模拟</div>
        <div class="sim-metrics" style="margin-top:10px">
          <div class="sim-metric hl"><div class="sm-l">期望抽数</div><div class="sm-v">${fmt(r.mean)}</div></div>
          <div class="sim-metric"><div class="sm-l">中位数</div><div class="sm-v">${fmt(r.median)}</div></div>
          <div class="sim-metric"><div class="sm-l">P90</div><div class="sm-v">${fmt(r.p90)}</div></div>
          <div class="sim-metric"><div class="sm-l">≤80 抽概率</div><div class="sm-v">${pct(r.within80Rate)}</div></div>
        </div>
        <div class="cost-grid">
          <div class="cost-card"><div class="cc-t">人民币 · 非首充（648 元 = 350 源石）</div><div class="cc-v">¥${fmt(c.cnyNonFirst)}</div></div>
          <div class="cost-card"><div class="cc-t">人民币 · 首充双倍（648 元 = 560 源石）</div><div class="cc-v">¥${fmt(c.cnyFirst)}</div></div>
        </div>
        <div class="cost-note">折算链：${fmt(r.mean)} 抽 ≈ ${fmt(c.jade)} 嵌晶玉 ≈ ${fmt(c.originium)} 源石。模型推算仅供参考，免费资源未计入。</div>`;
      shortHint.textContent = '';
    } catch (e) {
      toast(e.message, 'err');
      shortHint.textContent = '';
    } finally {
      running = false;
      shortBtn.disabled = false;
    }
  });

  runBtn.addEventListener('click', async () => {
    if (running) return;
    const bannerId = bannerSel.value;
    const b = S.banners.find(x => x.id === bannerId);
    const isWeapon = b && b.category === 'weapon';
    const target = isWeapon ? 'up' : (root.querySelector('input[name="plt"]:checked') || { value: 'up' }).value;
    const trials = Number((root.querySelector('input[name="plt2"]:checked') || { value: '100000' }).value);

    running = true;
    runBtn.disabled = true;
    hint.textContent = '模拟中…';
    const t0 = performance.now();
    try {
      const resp = await API.simulate({ bannerId, target, trials });
      const ms = Math.round(performance.now() - t0);
      hint.textContent = `${num(trials)} 次模拟耗时 ${ms} ms`;
      output.innerHTML = resultHtml(resp, b);
      histogramAnimate(output);
    } catch (e) {
      toast(e.message, 'err');
      hint.textContent = '';
    } finally {
      running = false;
      runBtn.disabled = false;
    }
  });
}

function resultHtml(r, b) {
  const isWeapon = b && b.category === 'weapon';
  const targetName = isWeapon ? `当期 UP 武器「${b.up6 || '—'}」` : (r.target === 'up' ? `当期 UP「${b.up6 || '—'}」` : '任意六星');
  const cap = r.cap ? `<span class="chip chip-gray" title="硬保底封顶">模拟封顶 ${num(r.cap)} 抽</span>` : '';
  return `
    <div class="panel" style="margin-bottom:16px">
      <div class="sim-result-head">
        <div class="results-title" style="font-size:13px;font-weight:700;color:var(--amber)">
          模拟结果 · ${esc(b ? b.name : r.bannerId)} · 目标 ${esc(targetName)} · ${num(r.trials)} 次
        </div>
        ${cap}
      </div>
      <div class="sim-metrics">
        <div class="sim-metric hl"><div class="sm-l">期望抽数</div><div class="sm-v">${num(r.mean)}</div></div>
        <div class="sim-metric"><div class="sm-l">中位数</div><div class="sm-v">${num(r.median)}</div></div>
        <div class="sim-metric"><div class="sm-l">P10</div><div class="sm-v">${num(r.p10)}</div></div>
        <div class="sim-metric"><div class="sm-l">P90</div><div class="sm-v">${num(r.p90)}</div></div>
        <div class="sim-metric"><div class="sm-l">P99</div><div class="sm-v">${num(r.p99)}</div></div>
        <div class="sim-metric"><div class="sm-l">最欧（min）</div><div class="sm-v t-cyan">${num(r.min)}</div></div>
        <div class="sim-metric"><div class="sm-l">最非（max）</div><div class="sm-v t-red">${num(r.max)}</div></div>
      </div>
      <div class="rate-chips">
        <span class="chip chip-green">≤50 抽：${pct(r.within50Rate)}</span>
        <span class="chip chip-cyan">≤80 抽：${pct(r.within80Rate)}</span>
        <span class="chip chip-amber">≤120 抽：${pct(r.within120Rate)}</span>
      </div>
    </div>

    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">抽数分布直方图 <span class="pt-sub">柱上为模拟次数 · 橙色为峰值桶</span></div>
      ${histogramHtml(r.histogram)}
    </div>

    <div class="panel">
      <div class="panel-title">成本换算 <span class="pt-sub">按期望抽数折算</span></div>
      <div class="cost-grid">
        <div class="cost-card"><div class="cc-t">嵌晶玉（500/抽）</div><div class="cc-v">${num(r.cost.jade)} <small>玉</small></div></div>
        <div class="cost-card"><div class="cc-t">源石（1=75 玉）</div><div class="cc-v">${num(r.cost.originium)} <small>源石</small></div></div>
        <div class="cost-card"><div class="cc-t">人民币 · 基础档</div><div class="cc-v">¥${num(r.cost.cnyBase)}</div></div>
        <div class="cost-card"><div class="cc-t">人民币 · 非首充</div><div class="cc-v">¥${num(r.cost.cnyNonFirst)}</div></div>
        <div class="cost-card"><div class="cc-t">人民币 · 首充双倍</div><div class="cc-v">¥${num(r.cost.cnyFirst)}</div></div>
      </div>
      <div class="cost-note">⚠ 模型推算，仅供参考。汇率口径：500 嵌晶玉 = 1 抽；1 衍质源石 = 75 嵌晶玉；648 元档基础 280 源石、非首充 350、首充 560（小额档位源石数为推算值）。实际获取含各类免费资源与优惠券，真实成本通常更低。</div>
    </div>`;
}

function pct(x) {
  if (x == null || isNaN(x)) return '—';
  return (x * 100).toFixed(1) + '%';
}

/** 直方图入场动画：柱体从 scaleY(0.02) 过渡到 1（transform，不触发布局） */
function histogramAnimate(output) {
  const bars = output.querySelectorAll('.hist-bar');
  bars.forEach(bar => {
    let restored = false;
    const restore = () => { if (!restored) { restored = true; bar.style.transform = ''; } };
    bar.style.transform = 'scaleY(0.02)';
    requestAnimationFrame(() => requestAnimationFrame(restore));
    setTimeout(restore, 80);
  });
}
