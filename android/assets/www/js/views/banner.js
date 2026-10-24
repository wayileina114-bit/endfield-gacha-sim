/**
 * views/banner.js — 寻访模拟（默认视图）
 * 左侧卡池选择器（干员寻访/武库申领 两组标签 + 基础/启程固定入口）
 * 中部池详情（UP 大卡、六星名单、进度条）+ 右侧/下方操作区 + 翻牌结果
 */
import { API } from '../api.js';
import {
  S, bannerById, setSave, fmtDate, fmtTime, num, esc,
  versionKey, versionName, emit
} from '../store.js';
import {
  toast, pbar, statusBadge, statusInfo, artHtml, mountArt, buildFlipCards, rewardsHtml
} from '../ui.js';

let lastResult = null;   // { bannerId, items, rewards, ts, quotaCharged }
let currentSkip = null;  // 翻牌跳过函数

const TYPE_LABEL = {
  limited: '限定寻访', rerun: '重构寻访', special: '特殊寻访',
  standard: '常驻寻访', newbie: '新手寻访', normal: '武库申领'
};

export async function render(root) {
  if (!S.bannerId) {
    const active = S.banners.find(b => b.category === 'character' && b.status === 'active');
    S.bannerId = active ? active.id : (S.banners[0] && S.banners[0].id) || 'c_std';
  }
  root.innerHTML = `
    <div class="bnv">
      <aside class="panel pool-panel">
        <div class="pool-head"><span class="pool-head-en">BANNER SELECT</span><span class="pool-head-zh">卡池列表</span></div>
        <div class="pool-tabs">
          <button class="pool-tab ${S.poolTab === 'character' ? 'active' : ''}" data-tab="character">干员寻访</button>
          <button class="pool-tab ${S.poolTab === 'weapon' ? 'active' : ''}" data-tab="weapon">武库申领</button>
        </div>
        <div class="pool-pinned" id="pool-pinned"></div>
        <div class="pool-scroll" id="pool-list"></div>
      </aside>
      <section class="pool-main">
        <div class="panel" id="pool-detail"></div>
        <div class="panel" id="pool-actions"></div>
        <div class="panel" id="pool-results"></div>
      </section>
    </div>`;

  root.querySelector('.pool-tabs').addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    if (currentSkip) currentSkip();
    S.poolTab = t.dataset.tab;
    root.querySelectorAll('.pool-tab').forEach(x => x.classList.toggle('active', x === t));
    renderList(root);
  });
  root.querySelector('.pool-panel').addEventListener('click', e => {
    const item = e.target.closest('[data-bid]');
    if (!item) return;
    if (currentSkip) currentSkip(); // 动画进行中切池：先跳过并解锁
    if (S.bannerId !== item.dataset.bid) {
      S.bannerId = item.dataset.bid;
      root.querySelectorAll('.pool-item').forEach(x => x.classList.toggle('sel', x.dataset.bid === S.bannerId));
      renderDetail(root);
      renderActions(root);
      renderResults(root);
    }
  });

  renderList(root);
  renderDetail(root);
  renderActions(root);
  renderResults(root);
}

/* ================= 左侧列表 ================= */
function poolItemHtml(b, idx) {
  const up = b.up6 ? `<span class="pi-up">UP ${esc(b.up6)}</span>` : '';
  const date = (b.start || b.end)
    ? `${fmtDate(b.start)} ~ ${fmtDate(b.end)}`
    : (b.type === 'newbie' ? '新手限定' : '常驻开放');
  const live = b.status === 'active' ? '<span class="pi-live" title="进行中"></span>' : '';
  return `
    <button class="pool-item p-${esc(b.status || 'ended')} ${b.id === S.bannerId ? 'sel' : ''}" data-bid="${esc(b.id)}">
      <span class="pi-idx" aria-hidden="true">${idx || '··'}</span>
      <span class="pi-body">
        <span class="pi-row1"><span class="pi-name">${esc(b.name)}${live}</span>${up}</span>
        <span class="pi-row2"><span class="pi-date">${date}</span>${statusBadge(b.status)}</span>
      </span>
    </button>`;
}

function renderList(root) {
  const pinnedBox = root.querySelector('#pool-pinned');
  const listBox = root.querySelector('#pool-list');
  const isChar = S.poolTab === 'character';

  if (isChar) {
    const std = bannerById('c_std');
    const nb = bannerById('c_newbie');
    pinnedBox.innerHTML = (std ? poolItemHtml(std) : '') + (nb ? poolItemHtml(nb) : '');
  } else {
    pinnedBox.innerHTML = '';
  }

  const pools = S.banners.filter(b => b.category === (isChar ? 'character' : 'weapon') && b.id !== 'c_std' && b.id !== 'c_newbie');
  const groups = new Map();
  for (const b of pools) {
    const k = versionKey(b);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }
  // 按版本时间线排序
  const tl = (S.meta && S.meta.versions && S.meta.versions.timeline) || [];
  const order = tl.map(t => t.version);
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  listBox.innerHTML = keys.map(k => {
    const arr = groups.get(k).sort((a, b2) => String(a.start || '').localeCompare(String(b2.start || '')));
    return `<div class="pool-group-label"><b>${esc(versionName(k))}</b><span class="pgl-count">POOL ×${arr.length}</span></div>` +
      arr.map((b2, i) => poolItemHtml(b2, String(i + 1).padStart(2, '0'))).join('');
  }).join('');
}

/* ================= 中部详情 ================= */
function renderDetail(root) {
  const b = bannerById(S.bannerId);
  const box = root.querySelector('#pool-detail');
  if (!b) { box.innerHTML = '<div class="empty-hint">暂无卡池数据</div>'; return; }

  const isWeapon = b.category === 'weapon';
  const chips = [];
  chips.push(statusBadge(b.status));
  chips.push(`<span class="chip ${isWeapon ? 'chip-cyan' : 'chip-amber'}">${esc(TYPE_LABEL[b.type] || b.type)}</span>`);
  if (b.versionName || b.version) chips.push(`<span class="chip">${esc(versionName(versionKey(b)))}</span>`);
  if (b.start || b.end) chips.push(`<span class="chip">⏱ ${fmtDate(b.start)} ~ ${fmtDate(b.end)}</span>`);
  if (isWeapon && b.up6Type) chips.push(`<span class="chip">${esc(b.up6Type)}</span>`);
  if (isWeapon && b.pairedCharBanner) chips.push(`<span class="chip">搭档：${esc(b.pairedCharBanner)}</span>`);

  // UP 主角大卡（科技机甲看板 + 六星辉光 + HUD准星 + 渐变遮罩 + 大字名称）；无 UP 池走 2×2 迷你卡
  let mediaHtml = '';
  if (b.up6) {
    mediaHtml = `
      <div class="up-hero-wrapper">
        <div class="up-hero-hud-tl" aria-hidden="true"></div>
        <div class="up-hero-hud-tr" aria-hidden="true"></div>
        <div class="up-hero-hud-bl" aria-hidden="true"></div>
        <div class="up-hero-hud-br" aria-hidden="true"></div>
        <div class="up-hero${isWeapon ? ' wm' : ''} glow">
          <div class="up-hero-bg-watermark" aria-hidden="true">${isWeapon ? 'WEAPON' : 'TACTICAL'}</div>
          <div class="up-hero-media" data-art data-name="${esc(b.up6)}" data-rarity="6" data-kind="${isWeapon ? 'weapon' : 'operator'}"></div>
          <div class="up-hero-shade" aria-hidden="true"></div>
          <div class="up-hero-scanlines" aria-hidden="true"></div>
          <div class="up-hero-badge-group">
            <span class="up-hero-tag">EXCLUSIVE UP</span>
            <span class="up-hero-rate">50%</span>
          </div>
          <i class="up-shine" aria-hidden="true"></i>
          <div class="up-hero-strip">
            <div class="up-hero-stars-row">
              <span class="up-star">★</span><span class="up-star">★</span><span class="up-star">★</span>
              <span class="up-star">★</span><span class="up-star">★</span><span class="up-star">★</span>
            </div>
            <div class="up-hero-name">${esc(b.up6)}</div>
            <div class="up-hero-spec-code">// OPERATOR ARCHIVE PROFILE // CLASSIFIED</div>
          </div>
        </div>
      </div>`;
  } else {
    const names = (b.pool6 || []).slice(0, 4);
    mediaHtml = `<div class="up-minis">
      ${names.map(n => `<div class="up-mini">${artHtml(n, 6, isWeapon ? 'weapon' : 'operator')}
        <div class="up-mini-strip">${esc(n)}</div></div>`).join('')}
    </div>`;
  }

  // 池内六星名单（武器池带缩略图）
  const pool6 = b.pool6 || [];
  const pool6Html = pool6.map(n => {
    const isUp = n === b.up6;
    const thumb = isWeapon ? artHtml(n, 6, 'weapon', 'op-chip-art') : '<span class="dot"></span>';
    return `<span class="op-chip ${isUp ? 'up' : ''}${isWeapon ? ' wp' : ''}">${thumb}${esc(n)}${isUp ? '<span class="pct">50%</span>' : ''}</span>`;
  }).join('');
  const subline = isWeapon
    ? `六星池 ${pool6.length} 名 · 武库申领仅十连（1980 武库配额/次）`
    : `六星池 ${pool6.length} 名 · 五星池 ${(b.fiveStarPool || []).length} 名 · 四星池 ${(b.fourStarPool || []).length} 名`;

  box.innerHTML = `
    <div class="pd">
      <div class="pd-upcard">${mediaHtml}</div>
      <div class="pd-info">
        <h2>${esc(b.name)}</h2>
        <div class="pd-meta">${chips.join('')}</div>
        ${b.notes ? `<div class="pd-notes">${esc(b.notes)}</div>` : ''}
        <div class="pd-subline" style="margin-top:0">池内六星名单</div>
        <div class="pool6-row">${pool6Html}</div>
        <div class="pd-subline">${esc(subline)}</div>
        ${b.specialRules ? `<div class="special-rules"><b>特殊规则</b>：${esc(b.specialRules.note || '')}</div>` : ''}
        <div class="pd-progress" id="pd-progress">${progressHtml(b)}</div>
      </div>
    </div>`;
  mountArt(box);
}

/** 只刷新保底进度仪表（抽卡后局部更新，不重建 UP 大卡/图片） */
function renderProgress(root) {
  const box = root.querySelector('#pd-progress');
  const b = bannerById(S.bannerId);
  if (box && b) box.innerHTML = progressHtml(b);
}

/** 各池类型对应的保底进度条 */
function progressHtml(b) {
  const st = b.state || {};
  const saveBs = (S.save && S.save.banners && S.save.banners[b.id]) || {};
  const bars = [];
  if (b.type === 'limited' || b.type === 'rerun') {
    bars.push(pbar('80 抽保底（跨期限定继承）', st.pity6 ?? 0, 80, { color: 'amber' }));
    bars.push(pbar('单池累计 → 120 井必得 UP', st.cum ?? 0, 120, {
      color: 'red',
      right: (st.upObtained || saveBs.upObtained) ? '已获得 UP ✓' : `${num(st.cum ?? 0)} / 120`
    }));
    const in240 = (st.cum ?? 0) % 240;
    bars.push(pbar('累计 240 抽 → UP 信物', in240, 240, {
      color: 'purple',
      right: `信物 ${num(st.tokensEarned ?? 0)} · 差 ${num(240 - in240)} 抽`
    }));
    const rushClaimed = st.rush10Claimed ?? saveBs.rush10Claimed;
    bars.push(pbar('累计 30 抽 → 加急招募十连', Math.min(st.cum ?? 0, 30), 30, {
      color: 'green',
      right: rushClaimed ? '已领取 ✓' : `${num(Math.max(0, 30 - (st.cum ?? 0)))} 抽后解锁`
    }));
    const t60Claimed = st.ticket60Claimed ?? saveBs.ticket60Claimed;
    bars.push(pbar('累计 60 抽 → 下期十连券', Math.min(st.cum ?? 0, 60), 60, {
      color: 'cyan',
      right: t60Claimed ? '已领取 ✓' : `${num(Math.max(0, 60 - (st.cum ?? 0)))} 抽后解锁`
    }));
  } else if (b.type === 'special') {
    bars.push(pbar('特殊池保底（最多 10 抽出六星）', st.pitySince6 ?? 0, 10, { color: 'amber' }));
    bars.push(pbar('本池累计寻访', st.cum ?? 0, 10, { color: 'cyan', right: `${num(st.cum ?? 0)} 抽` }));
    bars.push(pbar('保障配额累计（每抽 +1）', Math.min(st.securityQuota ?? 0, 40), 40, {
      color: 'purple', right: `已有 ${num(st.securityQuota ?? 0)} 个`
    }));
  } else if (b.type === 'standard') {
    bars.push(pbar('80 抽保底（独立计数）', st.pity6 ?? 0, 80, { color: 'amber' }));
    bars.push(pbar('累计 300 抽 → 六星自选（仅一次）', st.totalPulls ?? 0, 300, {
      color: 'purple',
      right: st.selectorClaimed ? '已领取 ✓' : `${num(st.totalPulls ?? 0)} / 300`
    }));
  } else if (b.type === 'newbie') {
    if (st.closed) {
      bars.push(pbar('启程寻访已完成', 40, 40, { color: 'green', right: '已获得六星 ✓' }));
    } else {
      bars.push(pbar('40 抽内必得六星', st.pulls ?? 0, 40, { color: 'green' }));
    }
  } else if (b.category === 'weapon') {
    bars.push(pbar('40 抽保底出六星', st.pullsSince6 ?? 0, 40, { color: 'amber' }));
    bars.push(pbar('单池累计 80 抽必得 UP', st.cum ?? 0, 80, {
      color: 'red',
      right: (st.upObtained || saveBs.upObtained) ? '已获得 UP ✓' : `${num(st.cum ?? 0)} / 80`
    }));
    // 里程碑：100 常驻自选 → 180 UP → 其后每 80 抽交替（口径见机制说明）
    const idx = st.milestoneIndex ?? 0;
    const next = idx === 0 ? 100 : 180 + (idx - 1) * 80;
    const label = idx % 2 === 0 ? '常驻六星武器自选' : '当期 UP 武器';
    bars.push(pbar(`里程碑 ${num(next)} 抽 → ${label}`, Math.min(st.cum ?? 0, next), next, {
      color: 'cyan', right: `${num(st.cum ?? 0)} / ${num(next)}`
    }));
  }
  return bars.join('');
}

/* ================= 操作区 ================= */
function renderActions(root) {
  const b = bannerById(S.bannerId);
  const box = root.querySelector('#pool-actions');
  if (!b) { box.innerHTML = '<div class="empty-hint">暂无卡池</div>'; return; }
  const st = b.state || {};
  const saveBs = (S.save && S.save.banners && S.save.banners[b.id]) || {};
  const isWeapon = b.category === 'weapon';
  const newbieClosed = b.type === 'newbie' && (st.closed || (S.save && S.save.newbie && S.save.newbie.closed));
  const disabled = S.pulling ? 'disabled' : '';

  const btns = [];
  if (b.type !== 'newbie' && !isWeapon) {
    btns.push(`
      <button class="btn btn-tactical btn-single" data-act="pull1" ${disabled}>
        <span class="btn-tac-code">// 01 SINGLE</span>
        <span class="btn-tac-title">单次寻访</span>
        <span class="btn-tac-cost">500 嵌晶玉</span>
      </button>`);
  }
  if (isWeapon || b.type === 'newbie') {
    btns.push(`
      <button class="btn btn-primary btn-tactical btn-multi" data-act="pull10" ${newbieClosed ? 'disabled' : disabled}>
        <span class="btn-tac-code">// 10 BATCH</span>
        <span class="btn-tac-title">十连申领</span>
        <span class="btn-tac-cost">${isWeapon ? (S.payWithQuota ? '1,980 武库配额' : '5,000 玉 / 模拟模式') : '40 抽内必出六星'}</span>
      </button>`);
  } else {
    btns.push(`
      <button class="btn btn-primary btn-tactical btn-multi" data-act="pull10" ${disabled}>
        <span class="btn-tac-code">// 10 BATCH</span>
        <span class="btn-tac-title">十连寻访</span>
        <span class="btn-tac-cost">5,000 嵌晶玉</span>
      </button>`);
  }
  if (b.type === 'limited' || b.type === 'rerun') {
    const avail = !!(st.rush10Available || saveBs.rush10Available);
    btns.push(`
      <button class="btn btn-rush btn-tactical ${avail ? 'blink' : ''}" data-act="rush" ${avail && !S.pulling ? '' : 'disabled'}
        title="累计 30 抽解锁：免费十连，不计入任何保底/累计计数">
        <span class="btn-tac-code">// RUSH TICKET</span>
        <span class="btn-tac-title">⚡ 加急招募</span>
        <span class="btn-tac-cost">${avail ? 'FREE · 立即执行' : '未解锁 (满30抽解锁)'}</span>
      </button>`);
  }
  if (newbieClosed) {
    btns.push('<span class="chip chip-gray">启程寻访已结束</span>');
  }

  let quotaLine = '';
  if (isWeapon) {
    const q = (S.save && S.save.weaponQuota) ?? 0;
    quotaLine = `
      <label class="switch" title="开启后本次武库申领将真实扣除 1980 武库配额/十连；默认仅模拟不扣">
        <input type="checkbox" id="quota-toggle" ${S.payWithQuota ? 'checked' : ''}>
        <span class="sw-track"></span>
        <span>扣配额抽卡（1980/十连）</span>
      </label>
      <span class="chip chip-cyan">武库配额余额 <b style="margin-left:4px">${num(q)}</b></span>`;
  }

  let selectorRow = '';
  if (b.type === 'standard' && st.selectorAvailable && !st.selectorClaimed) {
    const five = b.pool6 || [];
    selectorRow = `
      <div class="selector-row">
        <div class="pd-subline" style="margin-top:0"><b class="t-amber">300 抽自选已解锁</b> — 从五名常驻六星中选择一位（仅一次）：</div>
        <div class="sel-btns">${five.map(n =>
          `<button class="btn btn-sm" data-claim="${esc(n)}" ${S.pulling ? 'disabled' : ''}>${esc(n)}</button>`).join('')}
        </div>
      </div>`;
  }

  box.innerHTML = `
    <div class="panel-title">寻访操作 <span class="pt-sub">${esc(b.name)}</span></div>
    <div class="acts">
      ${btns.join('')}
      <span class="spacer"></span>
      <span class="quota-line">${quotaLine}</span>
    </div>
    ${selectorRow}`;

  box.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (S.pulling) return;
      if (act === 'pull1') doPull(root, 1, 'normal');
      else if (act === 'pull10') doPull(root, 10, 'normal');
      else if (act === 'rush') doPull(root, 10, 'rush');
    });
  });
  const toggle = box.querySelector('#quota-toggle');
  if (toggle) toggle.addEventListener('change', () => { S.payWithQuota = toggle.checked; });
  box.querySelectorAll('[data-claim]').forEach(btn => {
    btn.addEventListener('click', () => claimSelector(root, btn.dataset.claim));
  });
}

/* ================= 抽卡 ================= */
async function doPull(root, times, mode) {
  if (S.pulling) return;
  const b = bannerById(S.bannerId);
  if (!b) return;
  S.pulling = true;
  currentSkip = null;
  renderActions(root); // 禁用按钮防连点

  const body = { bannerId: b.id, times, mode };
  if (b.category === 'weapon' && S.payWithQuota) body.payWithQuota = true;

  try {
    const resp = await API.pull(body);
    setSave(resp.state);
    // 抽卡响应已携带最新卡池状态，本地更新即可（省去一次额外请求）
    if (resp.banner) {
      const i = S.banners.findIndex(x => x.id === resp.banner.id);
      if (i >= 0) S.banners[i] = resp.banner;
    }
    lastResult = {
      bannerId: b.id, items: resp.items || [], rewards: resp.rewards || [],
      ts: resp.items && resp.items[0] && resp.items[0].ts, quotaCharged: resp.quotaCharged
    };
    renderProgress(root);   // 局部更新保底仪表，不重建 UP 大卡
    renderResults(root, true);
  } catch (e) {
    lastResult = null;
    toast('寻访失败：' + e.message, 'err');
    renderResultsError(root, e.message);
    S.pulling = false;
    renderActions(root);
  }
}

async function claimSelector(root, name) {
  if (S.pulling) return;
  try {
    const resp = await API.claimSelector(name);
    setSave(resp.state);
    if (resp.banner) {
      const i = S.banners.findIndex(x => x.id === resp.banner.id);
      if (i >= 0) S.banners[i] = resp.banner;
    }
    toast(`已自选获得六星干员：${name}`);
    renderDetail(root);
    renderActions(root);
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ================= 结果区 ================= */
function renderResults(root, animate = false) {
  const box = root.querySelector('#pool-results');
  const b = bannerById(S.bannerId);
  if (!b) { box.innerHTML = '<div class="empty-hint">暂无卡池</div>'; return; }

  const show = lastResult && lastResult.bannerId === b.id && lastResult.items.length;
  if (!show) {
    box.innerHTML = `
      <div class="panel-title">寻访结果 <span class="pt-sub">${esc(b.name)}</span></div>
      <div class="res-empty">
        <div class="res-empty-t">等待寻访指令</div>
        <div class="res-empty-d">选择左侧卡池后进行寻访，结果将以翻牌形式展示<br>十连保底 5 星+ · 80 抽必出六星 · 限定池出金仅 50% 为 UP</div>
      </div>`;
    return;
  }

  const r = lastResult;
  const modeText = r.items[0] && r.items[0].mode === 'rush' ? '加急招募（不计数）' : '寻访';
  const head = `
    <div class="results-head">
      <div class="results-title">寻访结果 <span class="pt-sub">${esc(b.name)} · ${num(r.items.length)} 抽 · ${esc(fmtTime(r.ts))}</span></div>
      <span style="display:flex;gap:8px;align-items:center">
        ${r.quotaCharged ? '<span class="chip chip-cyan">已扣 1980 武库配额</span>' : ''}
        <button class="btn btn-sm" id="btn-skip">跳 过</button>
      </span>
    </div>`;

  const flip = buildFlipCards(r.items, {
    registerSkip: fn => { currentSkip = fn; },
    onDone: () => {
      S.pulling = false;
      currentSkip = null;
      const slot = box.querySelector('.rewards-slot');
      if (slot) {
        slot.innerHTML = rewardsHtml(r.rewards) +
          (r.rewards && r.rewards.length ? '' : '');
      }
      renderActions(root); // 重新点亮按钮（含加急/已结束状态）
      renderProgress(root); // 局部刷新保底进度仪表
      box.querySelector('#btn-skip') && (box.querySelector('#btn-skip').disabled = true);
    }
  });

  box.innerHTML = head + `<div id="res-body">${flip.html}</div>`;
  box.querySelector('#btn-skip').addEventListener('click', () => { if (currentSkip) currentSkip(); });
  if (animate) {
    S.pulling = true;
    flip.after(box.querySelector('#res-body'));
  } else {
    // 直接展示（切回视图时不重复动画）
    box.querySelectorAll('.gcard').forEach(n => n.classList.add('open'));
    mountArt(box);
    box.querySelector('.rewards-slot').innerHTML = rewardsHtml(r.rewards);
    box.querySelector('#btn-skip').disabled = true;
    S.pulling = false;
  }
}

function renderResultsError(root, msg) {
  const box = root.querySelector('#pool-results');
  const b = bannerById(S.bannerId);
  box.innerHTML = `
    <div class="panel-title">寻访结果 <span class="pt-sub">${esc(b ? b.name : '')}</span></div>
    <div class="pull-err">寻访失败：${esc(msg)}</div>`;
}
