/**
 * ui.js — 全局组件：toast、弹窗、分段式保底仪表、立绘挂载（/api/img 代理 + 失败回退占位卡）、
 * 翻牌结果区（六星全屏闪金 + stagger 翻牌）、CSS 直方图、状态徽章、长列表分帧渲染。
 *
 * 性能约定：
 *  - 所有立绘/武器图走 GET /api/img?name=&kind=（后端磁盘缓存，首次 ~0.8s，之后 ~2ms）；
 *    img loading=lazy + decoding=async，onerror 回退占位卡，不白屏。
 *  - 图片异步淡入（opacity 过渡），动画只用 transform / opacity。
 */
import { S, esc, fmtTime, num } from './store.js';

/* ================= toast ================= */
export function toast(msg, type = 'ok') {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }, 3200);
}

/* ================= 弹窗 ================= */
export function openModal(title, bodyHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-mask">
      <div class="modal-box">
        <div class="modal-head">
          <div class="modal-title">${esc(title)}</div>
          <button class="modal-close" data-close aria-label="关闭">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  const mask = root.firstElementChild;
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', escListener);
  return mask.querySelector('.modal-body');
}
function escListener(e) { if (e.key === 'Escape') closeModal(); }
export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
  document.removeEventListener('keydown', escListener);
}

/* ================= 状态徽章 ================= */
export function statusInfo(status) {
  const map = {
    active: ['st-active', '进行中'],
    ended: ['st-ended', '已结束'],
    upcoming: ['st-upcoming', '未开启'],
    permanent: ['st-permanent', '常驻']
  };
  const [cls, label] = map[status] || ['st-ended', status || '—'];
  return { cls, label };
}
export function statusBadge(status) {
  const i = statusInfo(status);
  return `<span class="st-badge ${i.cls}">${i.label}</span>`;
}

/* ================= 分段式保底仪表 =================
   每 10 抽一格刻度（小上限池细分），已抽满格填充实色，当前格部分填充并高亮。
   label: 左侧文字；cur/max 数值；opt: {color:'amber'|'cyan'|'green'|'purple'|'red', right:右侧文本覆盖} */
export function pbar(label, cur, max, opt = {}) {
  max = Number(max) || 0;
  cur = Math.max(0, Math.min(Number(cur) || 0, max));
  const segs = max > 0 ? (max <= 10 ? 5 : Math.max(1, Math.min(30, Math.round(max / 10)))) : 1;
  const segLen = max / segs;
  const color = opt.color ? 'c-' + opt.color : '';
  const right = opt.right !== undefined ? opt.right : `${num(cur)} / ${num(max)}`;
  let cells = '';
  for (let i = 0; i < segs; i++) {
    const fill = segLen > 0 ? Math.max(0, Math.min(1, (cur - i * segLen) / segLen)) : 0;
    const cls = fill >= 1 ? 'done' : (fill > 0 ? 'cur' : '');
    cells += `<span class="g-cell ${cls}"><i style="transform:scaleX(${fill.toFixed(3)})"></i></span>`;
  }
  return `
    <div class="pbar">
      <div class="pbar-head"><span>${label}</span><b>${right}</b></div>
      <div class="pbar-track ${color}">${cells}</div>
    </div>`;
}

/* ================= 立绘挂载（/api/img 代理 + 失败回退占位卡） =================
   host: 带 data-art / data-name / data-rarity / data-kind 的元素
   图片经后端代理（首次远端拉取，之后本地缓存）；onerror 或无图时回退占位卡（六边形/斜切轮廓 + 首字大字 + 稀有度描边） */
function phHtml(name, rarity, kind) {
  const first = (name || '？').trim().charAt(0);
  return `<div class="ph-card pr${Number(rarity) || 4}${kind === 'weapon' ? ' ph-wpn' : ''}">
    <div class="ph-hex"><div class="ph-hex-in">
      <div class="ph-char">${esc(first)}</div>
      <div class="ph-sub">${esc(name)}</div>
    </div></div>
  </div>`;
}

export function mountArt(scope) {
  (scope || document).querySelectorAll('[data-art]:not([data-mounted])').forEach(host => {
    host.dataset.mounted = '1';
    const name = host.dataset.name || '';
    const rarity = host.dataset.rarity || '4';
    const kind = host.dataset.kind || 'operator';
    const ph = () => { host.innerHTML = phHtml(name, rarity, kind); };
    if (!name) { ph(); return; }
    const img = document.createElement('img');
    img.alt = name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onload = () => img.classList.add('ld');       // 异步淡入，不阻塞翻牌/布局
    img.onerror = () => { img.remove(); ph(); };      // 404/断网 → 占位卡，不白屏
    img.src = `/api/img?name=${encodeURIComponent(name)}&kind=${encodeURIComponent(kind)}&v=2`;
    host.appendChild(img);
  });
}

/** 生成带 data-art 的媒体容器 HTML */
export function artHtml(name, rarity, kind = 'operator', extraCls = '') {
  return `<div class="${extraCls}" data-art data-name="${esc(name)}" data-rarity="${Number(rarity) || 4}" data-kind="${kind}"></div>`;
}

/* ================= 长列表分帧渲染 =================
   itemsHtml: HTML 片段数组；每帧追加 chunk 片，避免长列表一次性 innerHTML 造成主线程长任务。
   返回 Promise（全部挂载完成后 resolve）。 */
export function chunkRender(container, itemsHtml, { chunk = 36 } = {}) {
  if (!container) return Promise.resolve();
  container.innerHTML = '';
  if (!itemsHtml.length) return Promise.resolve();
  return new Promise(resolve => {
    let i = 0;
    const step = () => {
      const end = Math.min(itemsHtml.length, i + chunk);
      let buf = '';
      for (; i < end; i++) buf += itemsHtml[i];
      const tpl = document.createElement('template');
      tpl.innerHTML = buf;
      container.appendChild(tpl.content);
      mountArt(container);
      if (i < itemsHtml.length) {
        (window.requestAnimationFrame || setTimeout)(step);
      } else {
        resolve();
      }
    };
    step();
  });
}

/* ================= 六星全屏闪金 ================= */
let flashEl = null, flashTimer = 0;
export function hideGoldFlash() {
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
  if (flashEl) { flashEl.remove(); flashEl = null; }
}
function showGoldFlash(onDone) {
  hideGoldFlash();
  flashEl = document.createElement('div');
  flashEl.className = 'gold-flash';
  flashEl.innerHTML = `
    <div class="gf-beam" aria-hidden="true"></div>
    <div class="gf-glow" aria-hidden="true"></div>
    <div class="gf-grid" aria-hidden="true"></div>
    <div class="gf-ring" aria-hidden="true"></div>
    <div class="gf-alert-box">
      <div class="gf-alert-code">// PRIORITY SIGNAL // LOCK-ON</div>
      <div class="gf-alert-title">★ ★ ★ ★ ★ ★</div>
      <div class="gf-alert-sub">HIGH RARITY OPERATOR ACQUIRED</div>
    </div>
    <div class="gf-hint">CLICK ANYWHERE TO SKIP · 点击任意处跳过</div>`;
  const finish = () => { hideGoldFlash(); if (onDone) onDone(); };
  flashEl.addEventListener('click', finish, { once: true });
  document.body.appendChild(flashEl);
  flashTimer = setTimeout(finish, 800); // 略微增加张力时间至 0.8s，点击可随时跳过
}

/* ================= 抽卡结果翻牌区 =================
   items: /api/pull 返回的 items；出六星先全屏闪金（0.6s、可点击跳过）再 stagger 翻牌；
   图片异步淡入不阻塞动画。返回 { html, after(el) }，after 负责挂载立绘与动画排程。
   opts.onDone: 全部翻完后回调（解锁按钮） */
export function buildFlipCards(items, opts = {}) {
  const sorted = [...items].sort((a, b) => (a.rarity || 0) - (b.rarity || 0)); // 4★→5★→6★
  const STEP = 100, FLIP = 560; // stagger 100ms（80-120ms 区间）
  const hasSix = items.some(it => Number(it.rarity) === 6);
  const cards = sorted.map((it, i) => {
    const badges = [];
    if (it.isUp) badges.push('<span class="gb gb-up">UP</span>');
    if (it.isNew && (it.rarity === 6 || it.rarity === 5)) badges.push('<span class="gb gb-new">NEW</span>');
    if (it.dupe) badges.push('<span class="gb gb-dupe">潜能+1</span>');
    if (it.forced120) badges.push('<span class="gb gb-pity">120保底</span>');
    if (it.hardPity) badges.push('<span class="gb gb-hard">硬保底</span>');
    if (it.floorApplied) badges.push('<span class="gb gb-floor">十连保底</span>');
    if (it.mode === 'rush') badges.push('<span class="gb gb-rush">加急</span>');
    const isWeapon = !!it.weapon;
    const isSix = Number(it.rarity) === 6;
    return `
    <div class="gcard r${it.rarity}${isWeapon ? ' wpn' : ''}" data-idx="${i}">
      <div class="gc-inner">
        <div class="gc-face gc-back">
          <svg class="gc-emblem" viewBox="0 0 32 36"><polygon points="16,2 30,10 30,26 16,34 2,26 2,10" fill="none" stroke="#f5a623" stroke-width="1.6"/><polygon points="16,12 21,15.5 21,21 16,24 11,21 11,15.5" fill="#f5a623" opacity=".85"/></svg>
          <span class="gc-back-code" aria-hidden="true">ENF-${String(i + 1).padStart(2, '0')}</span>
        </div>
        <div class="gc-face gc-front">
          <span class="gc-rarity-bar" aria-hidden="true"></span>
          <div class="gc-art" data-art data-name="${esc(it.name)}" data-rarity="${it.rarity}" data-kind="${isWeapon ? 'weapon' : 'operator'}"></div>
          <div class="gc-foot">
            <div class="gc-name" title="${esc(it.name)}">${esc(it.name)}</div>
            <div class="gc-badges">${badges.join('')}</div>
          </div>
          ${isSix ? '<i class="gc-shine" aria-hidden="true"></i>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  const html = `
    <div class="gcards">${cards}</div>
    <div class="rewards-slot"></div>`;

  function after(root) {
    mountArt(root);
    const nodes = [...root.querySelectorAll('.gcard')];
    let done = false;
    const timers = [];
    const finish = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      hideGoldFlash();
      nodes.forEach(n => n.classList.add('open'));
      if (opts.onDone) opts.onDone();
    };
    if (opts.registerSkip) opts.registerSkip(finish);

    const startFlips = () => {
      nodes.forEach((n, i) => timers.push(setTimeout(() => n.classList.add('open'), 80 + i * STEP)));
      timers.push(setTimeout(finish, 80 + nodes.length * STEP + FLIP));
    };

    if (hasSix) {
      showGoldFlash(startFlips); // 仪式感：先闪金再回落翻牌；点击/跳过均直接 finish
      if (opts.registerFlash) opts.registerFlash(true);
    } else {
      startFlips();
    }
    return 80 + nodes.length * STEP + FLIP + (hasSix ? 620 : 0);
  }
  return { html, after };
}

/** 渲染 rewards 列表（信物 / 里程碑 / 加急 / 300井 等，逐条 text） */
export function rewardsHtml(rewards) {
  if (!rewards || !rewards.length) return '';
  return `<div class="rewards">${rewards.map(r => `
    <div class="reward-item"><span class="rw-type">[${esc(r.type || '奖励')}]</span><span>${esc(r.text || '')}</span></div>
  `).join('')}</div>`;
}

/* ================= 直方图（CSS 条形图，入场用 transform scaleY） =================
   hist: { "01-10": n, ... } */
export function histogramHtml(hist) {
  const keys = Object.keys(hist || {});
  if (!keys.length) return '<div class="empty-hint">无分布数据</div>';
  const max = Math.max(...keys.map(k => Number(hist[k]) || 0), 1);
  // 标记峰值桶
  let hotKey = keys[0];
  for (const k of keys) if ((hist[k] || 0) > (hist[hotKey] || 0)) hotKey = k;
  return `
    <div class="hist">
      ${keys.map(k => {
        const v = Number(hist[k]) || 0;
        const h = Math.max(1.5, (v / max) * 100);
        return `<div class="hist-col" title="${esc(k)} 抽：${num(v)} 次">
          <div class="hist-n">${v > max * 0.06 ? num(v) : ''}</div>
          <div class="hist-bar ${k === hotKey ? 'hot' : ''}" style="height:${h.toFixed(1)}%"></div>
          <div class="hist-label">${esc(k)}</div>
        </div>`;
      }).join('')}
    </div>`;
}

/** 时间轴格式的历史记录时间 */
export function tsCell(ts) {
  return `<td class="num t-dim" title="${esc(ts || '')}">${esc(fmtTime(ts))}</td>`;
}

/** 二次确认弹窗，resolve(true/false) */
export function confirmModal(title, message, confirmText = '确认', danger = false) {
  return new Promise(resolve => {
    const body = openModal(title, `
      <p style="font-size:13.5px;line-height:1.8">${message}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
        <button class="btn btn-sm" data-x="0">取消</button>
        <button class="btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}" data-x="1">${esc(confirmText)}</button>
      </div>`);
    body.closest('.modal-mask').addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (b) { closeModal(); resolve(b.dataset.x === '1'); }
    });
  });
}
