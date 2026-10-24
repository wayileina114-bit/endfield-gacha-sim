/**
 * views/stats.js — 数据统计
 * 汇总卡（总抽数/六星/五星/占比/平均每金 vs 期望/欧非评级）、
 * 六星记录表、保底状态一览、干员/武器收藏、重置。
 */
import { API } from '../api.js';
import { S, bannerById, setSave, fmtTime, num, esc, starsHtml } from '../store.js';
import { toast, pbar, chunkRender, confirmModal } from '../ui.js';

export async function render(root) {
  // 骨架屏：取数阶段先铺 shimmer 骨架条，替代单一 spinner
  root.innerHTML = `
    <h2 class="sec-title">数据统计</h2>
    <div class="loading-block" style="padding:70px 0">
      <div class="skel-stack" aria-hidden="true">
        <div class="skel" style="width:32%"></div>
        <div class="skel" style="width:88%"></div>
        <div class="skel" style="width:60%"></div>
        <div class="skel" style="width:74%"></div>
      </div>
      <p>正在读取存档…</p>
    </div>`;
  // 每次进入视图拉取最新存档
  try { setSave(await API.state()); } catch (e) { toast(e.message, 'err'); }
  const save = S.save;
  if (!save) return; // 首次加载且取数失败：保留骨架与错误 toast，避免空指针渲染

  const st = save.stats || {};
  const byR = st.byRarity || {};
  const byW = st.byRarityWeapon || {};
  const charPulls = (byR['6'] || 0) + (byR['5'] || 0) + (byR['4'] || 0);
  const weaponPulls = (byW['6'] || 0) + (byW['5'] || 0) + (byW['4'] || 0);
  const r6 = byR['6'] || 0, r5 = byR['5'] || 0;
  const rate = charPulls ? ((r6 / charPulls) * 100).toFixed(2) + '%' : '—';
  const luck = save.luck || { hasData: false };
  const expected = save.expectedAvgPerGold ?? (luck.expected ?? '—');
  const luckPct = luck.hasData && luck.percentile != null
    ? `<div class="sc-sub">蒙特卡洛百分位 ${esc(luck.percentile)}%（越高越欧）</div>` : '';

  const luckBlock = !luck.hasData
    ? `<div class="sc-val v-cyan" style="font-size:20px">暂无出金</div><div class="sc-sub">抽出第一颗六星后生成评级</div>`
    : `<div class="sc-val" style="color:${luckColor(luck.rating)}">${esc(luck.rating)}</div>
       <div class="sc-sub">平均 ${num(luck.avgPerGold)} 抽/金 · 期望 ${num(expected)} 抽/金 · 歪率 ${(luck.offBannerRate * 100).toFixed(0)}%</div>${luckPct}`;

  root.innerHTML = `
    <h2 class="sec-title">数据统计</h2>
    <div class="stat-grid">
      <div class="stat-card"><div class="sc-label">总抽数</div><div class="sc-val">${num(st.totalPulls)}</div><div class="sc-sub">干员 ${num(charPulls)} · 武器 ${num(weaponPulls)}</div></div>
      <div class="stat-card"><div class="sc-label">六星（干员）</div><div class="sc-val v-amber">${num(r6)}</div><div class="sc-sub">六星武器 ×${num(byW['6'] || 0)}</div></div>
      <div class="stat-card"><div class="sc-label">五星（干员）</div><div class="sc-val v-cyan">${num(r5)}</div><div class="sc-sub">五星武器 ×${num(byW['5'] || 0)}</div></div>
      <div class="stat-card"><div class="sc-label">六星占比（干员池）</div><div class="sc-val">${esc(rate)}</div><div class="sc-sub">综合概率含保底加成</div></div>
      <div class="stat-card"><div class="sc-label">平均每金 vs 期望</div><div class="sc-val ${luck.hasData && luck.avgPerGold <= expected ? 'v-green' : 'v-amber'}">${luck.hasData ? num(luck.avgPerGold) : '—'}</div><div class="sc-sub">理论期望 ${num(expected)} 抽/金</div></div>
      <div class="stat-card luck-card"><div class="sc-label">欧非评级</div>${luckBlock}</div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">六星记录 <span class="pt-sub">最新在前（含武器）</span></div>
        <div id="gold-tbl"></div>
      </div>
      <div>
        <div class="panel" style="margin-bottom:16px">
          <div class="panel-title">保底状态一览</div>
          <div class="pity-brief">${pityOverview()}</div>
        </div>
        <div class="panel">
          <div class="panel-title">存档操作</div>
          <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
            <a class="btn btn-ghost" href="/api/history/export" download
              title="导出模拟器抽卡历史（CSV，含 banner/UP/加急/保底花费，Excel 可直开）">导出抽卡历史</a>
            <button class="btn btn-danger" id="btn-reset">重置存档</button>
            <span class="pd-subline">重置将清空全部抽卡记录、库存与保底计数，不可恢复。</span>
          </div>
        </div>
      </div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">干员收藏 <span class="pt-sub">${Object.keys(save.inventoryView || {}).length} 名持有</span></div>
        <div id="inv-ops" class="inv-grid"></div>
      </div>
      <div class="panel">
        <div class="panel-title">武器收藏 <span class="pt-sub">${Object.keys(save.weaponInventory || {}).length} 把持有</span></div>
        <div id="inv-wpn" class="inv-grid"></div>
      </div>
    </div>`;

  // 长列表分帧渲染（六星记录表 / 收藏网格），图片 lazy 挂载
  const gtbl = root.querySelector('#gold-tbl');
  const grecs = st.goldRecords || [];
  if (!grecs.length) {
    gtbl.innerHTML = '<div class="empty-hint">还没有六星记录<br><a class="link-like" href="#/banner">去寻访页试试 →</a></div>';
  } else {
    gtbl.innerHTML = goldTableShell();
    const tbody = gtbl.querySelector('tbody');
    chunkRender(tbody, [...grecs].reverse().map(goldRow), { chunk: 24 });
  }
  chunkRender(root.querySelector('#inv-ops'), invCards(save.inventoryView || {}, true));
  chunkRender(root.querySelector('#inv-wpn'), invCards(save.weaponInventory || {}, false));
  root.querySelector('#btn-reset').addEventListener('click', async () => {
    const yes = await confirmModal('重置存档', '确定要<b>清空全部抽卡记录、库存与保底计数</b>吗？此操作不可恢复。', '确认重置', true);
    if (!yes) return;
    try {
      const resp = await API.reset();
      if (resp && resp.state) setSave(resp.state);
      toast('存档已重置');
      render(root);
    } catch (e) { toast(e.message, 'err'); }
  });
}

function luckColor(rating) {
  if (rating === '欧皇' || rating === '比较欧') return 'var(--cyan)';
  if (rating === '中规中矩') return 'var(--text)';
  return 'var(--danger)';
}

/** 六星武器判定：出现在任一武器池 pool6（含常驻池单）即 6★，否则按 5★ 视觉处理 */
function weaponRarity(name) {
  for (const b of S.banners) {
    if (b.category === 'weapon' && (b.pool6 || []).includes(name)) return 6;
  }
  return 5;
}

function goldTableShell() {
  return `
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>名称</th><th>UP</th><th>出货抽数</th><th>所属池</th><th>时间</th><th>NEW</th></tr></thead>
      <tbody></tbody>
    </table></div>`;
}

function goldRow(g) {
  return `
    <tr>
      <td><b class="${g.weapon ? 't-cyan' : 't-amber'}">${esc(g.name)}</b>${g.weapon ? ' <span class="chip chip-cyan" style="margin-left:4px">武器</span>' : ''}</td>
      <td>${g.isUp ? '<span class="chip chip-amber">UP</span>' : '<span class="chip chip-gray">歪</span>'}</td>
      <td class="num">${g.pity != null ? num(g.pity) : '—'}</td>
      <td>${esc(g.bannerName || '—')}</td>
      <td class="num t-dim">${esc(fmtTime(g.ts))}</td>
      <td>${g.new ? '<span class="chip chip-green">NEW</span>' : '<span class="chip chip-gray">潜能+1</span>'}</td>
    </tr>`;
}

/** 各池保底计数一览 */
function pityOverview() {
  const parts = [];
  const save = S.save;
  // 跨期限定继承 80 计数
  parts.push(pbar('限定寻访共享 80 计数', save.limitedTrack ? save.limitedTrack.pity6 : 0, 80, { color: 'amber' }));
  const charPools = S.banners.filter(b => b.category === 'character' && (b.type === 'limited' || b.type === 'rerun' || b.type === 'special'));
  for (const b of charPools) {
    const s = b.state || {};
    if (b.type === 'special') {
      if (!s.cum) continue;
      parts.push(pbar(`${b.name} · 特殊池累计`, s.cum, 10, { color: 'purple', right: `累计 ${num(s.cum)} · 配额 ${num(s.securityQuota || 0)}` }));
    } else if (s.cum > 0 || s.pity6 > 0) {
      parts.push(pbar(`${b.name} · 单池累计`, s.cum, 120, { color: 'red', right: `${num(s.cum)} / 120${s.upObtained ? ' · 已UP✓' : ''}` }));
    }
  }
  const std = bannerById('c_std');
  if (std && std.state) {
    parts.push(pbar('基础寻访 · 80 保底', std.state.pity6, 80, { color: 'cyan' }));
    parts.push(pbar('基础寻访 · 300 自选', std.state.totalPulls, 300, { color: 'purple', right: std.state.selectorClaimed ? '已领取 ✓' : `${num(std.state.totalPulls)} / 300` }));
  }
  const nb = bannerById('c_newbie');
  if (nb && nb.state) {
    parts.push(pbar('启程寻访', nb.state.closed ? 40 : nb.state.pulls, 40, { color: 'green', right: nb.state.closed ? '已结束 ✓' : `${num(nb.state.pulls)} / 40` }));
  }
  const wpools = S.banners.filter(b => b.category === 'weapon' && (b.state.cum > 0 || b.status === 'active' || b.status === 'permanent'));
  for (const b of wpools) {
    parts.push(pbar(`${b.name} · 40 保底`, b.state.pullsSince6 || 0, 40, { color: 'amber', right: `${num(b.state.pullsSince6 || 0)} / 40 · 累计 ${num(b.state.cum || 0)}` }));
  }
  return parts.join('') || '<div class="empty-hint">暂无保底数据</div>';
}

/** 收藏网格卡片；ops=true 干员（含潜能/信物），false 武器（横向图区分 + /api/img kind=weapon） */
function invCards(map, ops) {
  const names = Object.keys(map);
  if (!names.length) return ['<div class="empty-hint">暂无持有记录</div>'];
  names.sort((a, b) => (map[b].rarity || 0) - (map[a].rarity || 0) || (map[b].count || 0) - (map[a].count || 0));
  return names.map(n => {
    const rec = map[n] || {};
    const rarity = rec.rarity || (ops ? 6 : weaponRarity(n));
    const cls = ops ? ` pr${rarity}` : (rarity >= 6 ? ' pr6' : ' pr5');
    const sub = ops
      ? `持有 ${num(rec.count)}${rec.tokens ? ` · 信物 ${num(rec.tokens)}` : ''}`
      : `持有 ${num(rec.count)}`;
    return `
      <div class="inv-card${cls}">
        ${ops && rec.limited ? '<span class="iv-lim">限定</span>' : ''}
        ${ops ? `<span class="iv-pot" title="潜能 = 1 + 重复 + 信物">P${num(rec.potential ?? rec.count)}</span>` : ''}
        <div class="inv-art${ops ? '' : ' wp'}" data-art data-name="${esc(n)}" data-rarity="${rarity}" data-kind="${ops ? 'operator' : 'weapon'}"></div>
        <div class="iv-name" title="${esc(n)}">${esc(n)}</div>
        <div class="iv-sub">${esc(sub)}</div>
      </div>`;
  });
}
