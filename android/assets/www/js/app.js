/**
 * app.js — 入口：路由 / 视图切换 / 顶栏（配额徽章、同步按钮、同步时间）/ 全局错误处理
 * 数据经 api.js（/api/... 相对路径；banners 与 images 带 10 分钟 localStorage 缓存）
 */
import { API } from './api.js';
import { S, setSave, relTime, num, emit, on } from './store.js';
import { toast, hideGoldFlash, confirmModal } from './ui.js';
import * as bannerView from './views/banner.js';
import * as officialView from './views/official.js';
import * as statsView from './views/stats.js';
import * as plannerView from './views/planner.js';
import * as operatorsView from './views/operators.js';
import * as codexView from './views/codex.js';
import * as rulesView from './views/rules.js';

const VIEWS = {
  banner: bannerView, official: officialView, stats: statsView, planner: plannerView,
  operators: operatorsView, codex: codexView, rules: rulesView
};
const TITLES = {
  banner: '寻访模拟', official: '官方记录', stats: '数据统计', planner: '期望规划',
  operators: '干员图鉴', codex: '武器·基质·材料', rules: '机制说明'
};

function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  return VIEWS[h] ? h : 'banner';
}

/* ================= 顶栏 ================= */
function renderTopbar() {
  const q = (S.save && S.save.weaponQuota);
  document.getElementById('quota-val').textContent = q == null ? '--' : num(q);
  
  // 累计消耗嵌晶玉（总抽数 * 500）
  const st = (S.save && S.save.stats) || {};
  const total = st.totalPulls || 0;
  const jadeSpent = total * 500;
  const jadeEl = document.getElementById('jade-spent-val');
  if (jadeEl) jadeEl.textContent = `${num(jadeSpent)} 玉`;

  document.getElementById('sync-time').textContent =
    '官方数据同步于 ' + relTime(S.meta && S.meta.lastSync);
  const led = document.getElementById('sync-led');
  if (led) led.classList.toggle('on', !!(S.meta && S.meta.lastSync));
}

/* 终端时钟（1s 一次，仅改文本） */
function tickClock() {
  const el = document.getElementById('topbar-clock');
  if (el) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
}
setInterval(tickClock, 1000);
tickClock();

on('quota', () => renderTopbar());

/* ================= 同步官方数据 ================= */
let syncing = false;
async function syncBanners() {
  if (syncing) return;
  syncing = true;
  const btn = document.getElementById('btn-sync');
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = '同步中…';
  try {
    const resp = await API.refresh();
    if (resp && resp.ok === false) throw new Error(resp.error || '同步失败');
    const r = (resp && resp.result) || {};
    const added = (r.newCharBanners || 0) + (r.newWpnBanners || 0);
    await loadCore({ force: true });   // 强制刷新缓存
    try { setSave(await API.state()); } catch { /* 保留旧存档 */ }
    renderTopbar();
    await rerender();
    toast(added > 0 ? `同步完成：新增 ${added} 个卡池` : '同步完成：卡池数据已是最新');
  } catch (e) {
    toast('同步失败：' + e.message, 'err');
  } finally {
    syncing = false;
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

/* ================= 路由与渲染 ================= */
let renderSeq = 0;
async function rerender() {
  const route = currentRoute();
  const root = document.getElementById('view-root');
  document.querySelectorAll('.nav-item').forEach(a =>
    a.classList.toggle('active', a.dataset.view === route));
  const seq = ++renderSeq;
  hideGoldFlash(); // 切视图时中断六星闪金（若在进行）
  try {
    await VIEWS[route].render(root);
    if (seq === renderSeq) {
      document.title = `${TITLES[route]} · 终末地·寻访模拟器`;
      // 视图切换过渡：淡入 + 上移（transform/opacity，~220ms）
      root.classList.remove('view-in');
      void root.offsetWidth;
      root.classList.add('view-in');
    }
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="pull-err" style="margin-top:20px">视图渲染失败：${String(e && e.message || e)}</div>`;
  }
}

async function loadCore({ force = false } = {}) {
  const [meta, banners, images] = await Promise.all([
    API.meta(force),
    API.banners(force),
    API.images(force)
  ]);
  S.meta = meta;
  S.banners = (banners && banners.banners) || [];
  S.images = images || { operators: {}, weapons: {} };
}

/* ================= 关闭本机服务（页脚按钮） ================= */
async function shutdownServer() {
  const ok = await confirmModal('关闭服务', '将停止本机模拟器服务（端口 3276），本页面随后不可用。重新使用时双击 start.bat 即可。', '关闭服务', true);
  if (!ok) return;
  try { await fetch('/api/shutdown', { method: 'POST' }); } catch { /* 进程退出后连接重置属正常 */ }
  document.body.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:#0b0f1a;color:#8fa3c8">
      <div style="width:44px;height:44px;border:2px solid #f5a623;transform:rotate(45deg);display:flex;align-items:center;justify-content:center">
        <span style="transform:rotate(-45deg);color:#f5a623;font-size:20px">■</span>
      </div>
      <div style="font-size:20px;color:#f5a623">服务已关闭</div>
      <div>重新使用请双击 start.bat</div>
    </div>`;
}

/* ================= 启动 ================= */
async function boot() {
  const root = document.getElementById('view-root');
  try {
    await loadCore();
  } catch (e) {
    root.innerHTML = `
      <div class="loading-block">
        <p style="color:var(--danger)">数据加载失败：${String(e && e.message || e)}</p>
        <button class="btn btn-primary" id="btn-retry">重新加载</button>
      </div>`;
    root.querySelector('#btn-retry').addEventListener('click', () => boot());
    return;
  }
  try { setSave(await API.state()); } catch { /* 存档失败不阻塞 */ }

  renderTopbar();
  document.getElementById('btn-sync').addEventListener('click', syncBanners);
  document.getElementById('btn-shutdown').addEventListener('click', shutdownServer);
  window.addEventListener('hashchange', rerender);
  window.addEventListener('unhandledrejection', e => {
    console.error(e);
    const msg = e && e.reason && e.reason.message;
    if (msg) toast('发生意外错误：' + msg, 'err');
  });

  if (!location.hash) history.replaceState(null, '', '#/banner');
  await rerender();
}

boot();
