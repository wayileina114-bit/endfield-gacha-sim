/**
 * store.js — 全局共享状态（视图模块与入口 app.js 共用）
 * 所有业务数据来自 API，前端不硬编码概率/卡池数值。
 */
export const S = {
  meta: null,        // /api/meta
  banners: [],       // /api/banners（含 state 摘要）
  images: { operators: {}, weapons: {} }, // /api/images
  save: null,        // /api/state
  bannerId: null,    // 当前选中卡池
  poolTab: 'character', // 寻访页左侧标签：character | weapon
  payWithQuota: false,  // 武库申领"扣配额抽卡"开关
  pulling: false,    // 抽卡动画进行中（防连点）
  lastSync: null
};

/* ---- 极简事件 ---- */
const listeners = {};
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
export function emit(evt, payload) {
  (listeners[evt] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
}

/* ---- 工具 ---- */
export function bannerById(id) { return S.banners.find(b => b.id === id) || null; }

export function setSave(state) {
  S.save = state;
  if (state && typeof state.weaponQuota === 'number') emit('quota', state.weaponQuota);
}

export function fmtTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
  catch { return String(ts); }
}

export function relTime(ts) {
  if (!ts) return '从未同步';
  const d = Date.now() - new Date(ts).getTime();
  if (!(d >= 0)) return fmtTime(ts);
  const m = Math.floor(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const dd = Math.floor(h / 24);
  return `${dd}天前`;
}

export function fmtDate(d) {
  if (!d) return '常驻';
  const s = String(d);
  return s.length >= 10 ? s.slice(5).replace('-', '.') : s; // 2026-10-15 → 10.15
}

export function num(n) { return (n ?? 0).toLocaleString('zh-CN'); }

export function starsHtml(rarity) {
  const n = Number(rarity) || 0;
  return `<span class="stars s${n}">${'★'.repeat(n)}</span>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 干员/武器稀有度主色 class：r6 / r5 / r4 */
export function rarityClass(r) { return 'r' + (Number(r) || 4); }

/** 版本分组 key：优先 banner.version，否则按 start 日期对齐版本时间线 */
export function versionKey(b) {
  if (b.version) return b.version;
  const tl = (S.meta && S.meta.versions && S.meta.versions.timeline) || [];
  if (!b.start || !tl.length) return '早期';
  let v = '早期';
  for (const t of tl) { if (t.start <= b.start) v = t.version; }
  return v;
}

export function versionName(v) {
  const tl = (S.meta && S.meta.versions && S.meta.versions.timeline) || [];
  const hit = tl.find(t => t.version === v);
  return hit ? `${v} ${hit.name}` : v;
}
