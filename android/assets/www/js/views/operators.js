/**
 * views/operators.js — 干员图鉴
 * 全干员网格（稀有度/职业/限定/持有筛选）+ 详情弹窗（配装推荐、出现卡池、持有信息）
 */
import { API } from '../api.js';
import { S, num, esc, starsHtml } from '../store.js';
import { toast, artHtml, mountArt, chunkRender, openModal, closeModal } from '../ui.js';

const filters = { rarity: 'all', profession: 'all', limited: 'all', owned: 'all' };
let operators = [];

export async function render(root) {
  try {
    const resp = await API.operators();
    operators = resp.operators || [];
  } catch (e) {
    toast(e.message, 'err');
    operators = [];
  }
  if (!S.save) { try { S.save = await API.state(); } catch { /* 忽略 */ } }

  const professions = [...new Set(operators.map(o => o.profession).filter(Boolean))].sort();

  root.innerHTML = `
    <h2 class="sec-title">干员图鉴 <span class="t-dim" style="font-size:12px;font-weight:400">共 ${num(operators.length)} 名 · 点击卡片查看详情与配装</span></h2>
    <div class="panel" style="margin-bottom:14px">
      <div class="op-filters">
        <div class="f-field" style="flex-direction:row;align-items:center;gap:8px"><span class="f-label">稀有度</span>
          <div class="radio-row">${pillChecked('opr', 'all', filters.rarity, '全部')}${[6, 5, 4].map(r => pillChecked('opr', r, filters.rarity, r + '★')).join('')}</div>
        </div>
        <div class="f-field" style="flex-direction:row;align-items:center;gap:8px"><span class="f-label">职业</span>
          <div class="radio-row">${pillChecked('opj', 'all', filters.profession, '全部')}${professions.map(p => pillChecked('opj', p, filters.profession, p)).join('')}</div>
        </div>
        <div class="f-field" style="flex-direction:row;align-items:center;gap:8px"><span class="f-label">限定</span>
          <div class="radio-row">${pillChecked('opl', 'all', filters.limited, '全部')}${pillChecked('opl', 'yes', filters.limited, '限定')}${pillChecked('opl', 'no', filters.limited, '常驻')}</div>
        </div>
        <div class="f-field" style="flex-direction:row;align-items:center;gap:8px"><span class="f-label">持有</span>
          <div class="radio-row">${pillChecked('opo', 'all', filters.owned, '全部')}${pillChecked('opo', 'yes', filters.owned, '已持有')}${pillChecked('opo', 'no', filters.owned, '未持有')}</div>
        </div>
      </div>
    </div>
    <div class="op-grid" id="op-grid"></div>
    <div class="od-note" style="margin-top:14px">※ 配装为社区观点，随版本变动；立绘来自社区数据站（canmoe），加载失败时以占位卡显示。</div>`;

  // 监听器挂在每次重建的节点上，避免视图切换时重复绑定
  root.querySelector('.panel').addEventListener('change', e => {
    const input = e.target.closest('input[type=radio]');
    if (!input) return;
    const map = { opr: 'rarity', opj: 'profession', opl: 'limited', opo: 'owned' };
    filters[map[input.name]] = input.value;
    drawGrid(root);
  });
  root.querySelector('#op-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-op]');
    if (card) showDetail(card.dataset.op);
  });

  drawGrid(root);
}

function pillChecked(name, value, current, label) {
  return `<label class="radio-pill"><input type="radio" name="${name}" value="${esc(String(value))}" ${String(current) === String(value) ? 'checked' : ''}><span>${esc(label)}</span></label>`;
}

function drawGrid(root) {
  const grid = root.querySelector('#op-grid');
  const inv = (S.save && S.save.inventory) || {};
  const list = operators.filter(o => {
    if (filters.rarity !== 'all' && o.rarity !== Number(filters.rarity)) return false;
    if (filters.profession !== 'all' && o.profession !== filters.profession) return false;
    if (filters.limited === 'yes' && !o.limited) return false;
    if (filters.limited === 'no' && o.limited) return false;
    const owned = !!(inv[o.name] && inv[o.name].count > 0);
    if (filters.owned === 'yes' && !owned) return false;
    if (filters.owned === 'no' && owned) return false;
    return true;
  });
  if (!list.length) { grid.innerHTML = '<div class="empty-hint" style="grid-column:1/-1">没有符合条件的干员</div>'; return; }
  const sorted = [...list].sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'));
  // 分帧渲染图鉴网格（立绘 lazy + 异步淡入）
  chunkRender(grid, sorted.map(o => {
    const owned = !!(inv[o.name] && inv[o.name].count > 0);
    return `
    <div class="op-card pr${o.rarity}" data-op="${esc(o.name)}" title="${esc(o.name)} · ${esc(o.profession || '')} · ${esc(o.element || '')}">
      <div class="op-media">
        ${artHtml(o.name, o.rarity, 'operator')}
        <span class="op-rarity r${o.rarity}">${'★'.repeat(o.rarity)}</span>
        ${o.limited ? '<span class="op-lim">限定</span>' : ''}
        ${owned ? '<span class="op-owned">已持有</span>' : ''}
      </div>
      <div class="op-foot">
        <div class="op-name">${esc(o.name)}</div>
        <div class="op-sub"><span>${esc(o.profession || '—')}</span><span>${esc(o.element || '')}</span></div>
      </div>
    </div>`;
  }));
}

/* ================= 详情弹窗 ================= */
async function showDetail(name) {
  const body = openModal(esc(name), '<div class="loading-block" style="padding:30px"><div class="spinner"></div></div>');
  let d;
  try {
    d = await API.operator(name);
  } catch (e) {
    body.innerHTML = `<div class="pull-err">加载失败：${esc(e.message)}</div>`;
    return;
  }
  const op = d.operator || {};
  const build = d.build;
  const owned = d.owned;
  const inv = (S.save && S.save.inventory && S.save.inventory[name]) || null;

  body.innerHTML = `
    <div class="op-detail">
      <div>
        <div class="od-media">${artHtml(op.name, op.rarity, 'operator')}</div>
        <div style="text-align:center;margin-top:8px">${starsHtml(op.rarity)}</div>
      </div>
      <div>
        <div class="pd-meta" style="margin-top:0">
          <span class="chip chip-amber">${esc(op.profession || '—')}</span>
          <span class="chip chip-cyan">${esc(op.element || '—')}</span>
          ${op.limited ? '<span class="chip chip-amber">限定干员</span>' : '<span class="chip">常驻</span>'}
          ${op.firstVersion ? `<span class="chip">首登场：${esc(op.firstVersion)} ${esc(op.firstBanner || '')}</span>` : ''}
        </div>
        <div class="od-rows">
          <div class="od-row"><span class="k">持有状态</span>${
            (owned || inv)
              ? `<b class="t-green">已持有</b> · 潜能 ${num((owned && owned.potential) || (inv && 1 + (inv.count - 1) + (inv.tokens || 0)) || 1)}（${num((owned && owned.count) || (inv && inv.count) || 0)} 名${(owned && owned.tokens) || (inv && inv.tokens) ? ` + 信物 ${num((owned && owned.tokens) || (inv && inv.tokens))}` : ''}）`
              : '<span class="t-dim">未持有</span>'
          }</div>
        </div>
        ${build ? `
        <div class="od-build">
          <div class="ob-t">配装推荐（社区观点）</div>
          ${build.role ? `<p><span class="k">定位</span>${esc(build.role)}</p>` : ''}
          ${build.signatureWeapon ? `<p><span class="k">专属武器</span>${esc(build.signatureWeapon)}</p>` : ''}
          ${build.altWeapons && build.altWeapons.length ? `<p><span class="k">备选</span>${build.altWeapons.map(esc).join('、')}</p>` : ''}
          ${build.matrixEntries && build.matrixEntries.length ? `<p><span class="k">基质词条</span><span class="entry-chips" style="display:inline-flex">${build.matrixEntries.map(x => `<span class="chip chip-cyan">${esc(x)}</span>`).join('')}</span></p>` : ''}
          ${build.matrixLocations && build.matrixLocations.length ? `<p><span class="k">刷取地点</span>${build.matrixLocations.map(esc).join(' / ')}</p>` : ''}
          ${build.rating ? `<p><span class="k">评价</span>${esc(build.rating)}</p>` : ''}
        </div>` : '<div class="od-build"><div class="ob-t">配装推荐</div><p class="t-dim">暂无配装数据</p></div>'}
        <div class="od-build">
          <div class="ob-t">出现卡池</div>
          ${(d.banners && d.banners.length)
            ? `<div class="entry-chips">${d.banners.map(b => `<span class="chip ${b.version ? 'chip-amber' : ''}">${esc(b.name)}${b.version ? ` · v${esc(b.version)}` : ''}</span>`).join('')}</div>`
            : '<p class="t-dim">暂无记录</p>'}
        </div>
        <div class="od-note">※ 配装为社区观点，随版本变动，不构成抽取建议。</div>
      </div>
    </div>`;
  mountArt(body);
}
