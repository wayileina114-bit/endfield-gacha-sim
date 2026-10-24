/**
 * views/codex.js — 武器·基质·材料（三个子标签）
 * 武器图鉴 /api/weapons；基质系统 /api/matrices；材料刷取 /api/materials
 */
import { API } from '../api.js';
import { S, num, esc } from '../store.js';
import { toast, artHtml, chunkRender } from '../ui.js';

let data = { weapons: null, matrices: null, materials: null };
let sub = 'weapons';

const OBTAIN_LABEL = { signature: '专属武器', weaponBanner: '武库申领', nonPool: '非卡池获取' };

export async function render(root) {
  try {
    if (!data.weapons) data.weapons = await API.weapons();
    if (!data.matrices) data.matrices = await API.matrices();
    if (!data.materials) data.materials = await API.materials();
  } catch (e) { toast(e.message, 'err'); }

  root.innerHTML = `
    <h2 class="sec-title">武器 · 基质 · 材料</h2>
    <div class="subtabs">
      ${['weapons', 'matrices', 'materials'].map(k =>
        `<button class="subtab ${sub === k ? 'active' : ''}" data-sub="${k}">${ { weapons: '武器图鉴', matrices: '基质系统', materials: '材料刷取' }[k] }</button>`).join('')}
    </div>
    <div id="codex-body"></div>`;

  root.querySelector('.subtabs').addEventListener('click', e => {
    const t = e.target.closest('[data-sub]');
    if (!t) return;
    sub = t.dataset.sub;
    root.querySelectorAll('.subtab').forEach(x => x.classList.toggle('active', x === t));
    drawBody(root);
  });

  drawBody(root);
}

function drawBody(root) {
  const box = root.querySelector('#codex-body');
  try {
    if (sub === 'weapons') drawWeapons(box);
    else if (sub === 'matrices') drawMatrices(box);
    else drawMaterials(box);
  } catch (e) {
    box.innerHTML = `<div class="pull-err">渲染失败：${esc(e.message)}</div>`;
  }
}

/* ================= 武器图鉴 ================= */
function drawWeapons(box) {
  const d = data.weapons;
  if (!d) { box.innerHTML = '<div class="empty-hint">数据加载失败</div>'; return; }
  const wps = d.weapons || [];
  const sig = wps.filter(w => w.obtain === 'signature');
  const pool = wps.filter(w => w.obtain === 'weaponBanner');
  const other = wps.filter(w => w.obtain !== 'signature' && w.obtain !== 'weaponBanner');

  // 横向武器卡：左侧方形图（/api/img?kind=weapon），未收录武器（玉中身/唤月等）由 mountArt 回退占位卡
  const card = w => {
    const rar = w.obtain === 'nonPool' ? 5 : 6;
    return `
    <div class="wp-card wp-h ${w.obtain === 'signature' ? 'pr6' : 'pr5'}">
      <div class="wp-media">${artHtml(w.name, rar, 'weapon')}</div>
      <div class="wp-body">
        <div class="wp-name">${esc(w.name)}
          <span class="wp-type">${esc(w.weaponType || '—')}</span>
          ${w.obtain === 'signature' ? '<span class="chip chip-amber">专属</span>' : ''}
        </div>
        <div class="wp-sub">专属干员：<b>${esc(w.signatureFor || '—')}</b> · 获取：${esc(OBTAIN_LABEL[w.obtain] || w.obtain || '—')}</div>
        ${w.upBanners && w.upBanners.length ? `<div class="wp-banners">UP 卡池：${w.upBanners.map(esc).join('、')}</div>` : ''}
        ${w.notes ? `<div class="wp-banners">${esc(w.notes)}</div>` : ''}
      </div>
    </div>`;
  };

  box.innerHTML = `
    <div class="info-block">
      <h4>常驻六星武器池（基础武库申领）</h4>
      <p>${(d.standardPool || []).map(esc).join(' · ')}</p>
    </div>
    <div class="info-block"><h4>专属武器（${sig.length}）</h4><div class="wp-grid" id="wp-g1"></div></div>
    <div class="info-block"><h4>武库申领可获武器（${pool.length}）</h4><div class="wp-grid" id="wp-g2"></div></div>
    ${other.length ? `<div class="info-block"><h4>其他途径（${other.length}）</h4><div class="wp-grid" id="wp-g3"></div></div>` : ''}`;

  // 长列表分帧渲染（44 把武器分帧挂载，图片 lazy）
  chunkRender(box.querySelector('#wp-g1'), sig.map(card));
  chunkRender(box.querySelector('#wp-g2'), pool.map(card));
  if (other.length) chunkRender(box.querySelector('#wp-g3'), other.map(card));
}

/* ================= 基质系统 ================= */
function drawMatrices(box) {
  const d = data.matrices;
  if (!d) { box.innerHTML = '<div class="empty-hint">数据加载失败</div>'; return; }
  const sys = d.system || {};
  const loc = d.locations || {};
  const regions = Object.keys(loc).filter(k => k !== 'note');
  const et = sys.entryTypes || {};

  box.innerHTML = `
    <div class="info-block">
      <h4>基质系统机制</h4>
      <p>${esc(sys.intro || '')}</p>
      <p style="margin-top:6px"><span class="k" style="color:var(--dim-2)">品质：</span>${esc(sys.quality || '')}</p>
      <p style="margin-top:6px"><span class="k" style="color:var(--dim-2)">结算：</span>${esc(sys.settlement || '')}</p>
      <p style="margin-top:6px"><span class="k" style="color:var(--dim-2)">蚀刻：</span>${esc(sys.etching || '')}</p>
    </div>

    <div class="info-block">
      <h4>词条三类</h4>
      ${Object.keys(et).map(k => `
        <div style="margin-top:6px"><span style="color:var(--cyan);font-size:12.5px">${esc(k)}</span>
          <div class="entry-chips">${(et[k] || []).map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
        </div>`).join('')}
    </div>

    ${sys.engraveTicket ? `
    <div class="info-block">
      <h4>${esc(sys.engraveTicket.name || '刻写券')}</h4>
      <p>${esc(sys.engraveTicket.mechanic || '')}</p>
      <p style="margin-top:6px">${esc(sys.engraveTicket.exchange || '')}</p>
    </div>` : ''}

    <div class="info-block">
      <h4>能量淤积点（13 处 · 按地区）</h4>
      ${loc.note ? `<p style="color:var(--dim)">${esc(loc.note)}</p>` : ''}
      <div class="loc-cols" style="margin-top:8px">
        ${regions.map(r => `
          <div style="border:1px solid var(--line-soft);padding:10px 12px">
            <div style="color:var(--amber);font-size:13px;font-weight:700;margin-bottom:6px">${esc(r)}</div>
            <div class="entry-chips">${(loc[r] || []).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="info-block">
      <h4>武器类型 → 词条 / 地点 速查</h4>
      <div class="table-wrap"><table class="data-table mtx-table">
        <thead><tr><th>武器类型</th><th>词条示例</th><th>刷取地点</th></tr></thead>
        <tbody>${(d.weaponTypeMatrix || []).map(m => `
          <tr>
            <td><b>${esc(m.weaponType)}</b></td>
            <td>${esc(m.examples || '')}</td>
            <td class="t-dim">${esc(m.locations || '')}</td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="info-block">
      <h4>外链规划工具</h4>
      <ul>${(d.tools || []).map(t => `<li><a class="link-like" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.name)}</a> — ${esc(t.note || '')}</li>`).join('')}</ul>
    </div>`;
}

/* ================= 材料刷取 ================= */
function drawMaterials(box) {
  const d = data.materials;
  if (!d) { box.innerHTML = '<div class="empty-hint">数据加载失败</div>'; return; }
  const stam = d.stamina || {};

  box.innerHTML = `
    <div class="info-block">
      <h4>理智规则</h4>
      <p><span class="k" style="color:var(--dim-2)">恢复：</span>${esc(stam.recovery || '')}</p>
      <p style="margin-top:6px"><span class="k" style="color:var(--dim-2)">补给：</span>${esc(stam.refreshItems || '')}</p>
      <p style="margin-top:6px"><span class="k" style="color:var(--dim-2)">总量参考：</span>${esc(stam.totals || '')}</p>
    </div>

    <div class="info-block">
      <h4>材料家族</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>家族</th><th>材料与说明</th></tr></thead>
        <tbody>${(d.materialFamilies || []).map(f => `
          <tr><td><b>${esc(f.family)}</b></td><td class="t-dim">${esc(f.items || '')}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="info-block">
      <h4>关卡效率表</h4>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>关卡</th><th>理智消耗</th><th>主要产出</th></tr></thead>
        <tbody>${(d.farmingStages || []).map(s => `
          <tr><td><b>${esc(s.stage)}</b></td><td class="num t-cyan">${esc(s.cost || '')}</td><td class="t-dim">${esc(s.drops || '')}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="info-block">
      <h4>规划建议</h4>
      <ul>${(d.planningAdvice || []).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    </div>`;
}
