/**
 * views/official.js — 官方记录：鹰角通行证中转登录 → 同步真实寻访记录 → 指标分析 → 未来预测
 * 登录卡三个同级 Tab：密码登录 / 短信验证码登录 / 官方 App 扫码登录；手动填 token 保留为折叠备用项。
 * 安全说明：账号、密码、短信验证码、scanCode、token 均只由本机后端内存直转鹰角官方接口，
 * 不存储、不上传任何第三方、不写入任何文件；本地至多保存长时效登录令牌（用户主动勾选时）。
 */
import { API } from '../api.js';
import { num, esc, fmtTime, fmtDate } from '../store.js';
import { toast, pbar, chunkRender } from '../ui.js';
import qrcode from '../vendor/qr.js';

let localStatus = null;

/* ---- 定时器统一管理：视图重入/Tab 切换必须清场，防孤儿回调 ---- */
let qrTimer = null;      // 扫码轮询（2s）
let qrSeq = 0;           // 扫码会话代际：切走/重建后旧轮询结果作废
let smsTimer = null;     // 验证码 60s 倒计时

function stopQr() { if (qrTimer) { clearInterval(qrTimer); qrTimer = null; } qrSeq++; }
function stopSmsCountdown() { if (smsTimer) { clearInterval(smsTimer); smsTimer = null; } }
function stopAllTimers() { stopQr(); stopSmsCountdown(); }

export async function render(root) {
  stopAllTimers();
  root.innerHTML = `<h2 class="sec-title">官方记录</h2><div id="of-body">
    <div class="loading-block">
      <div class="skel-stack" aria-hidden="true">
        <div class="skel" style="width:34%"></div>
        <div class="skel" style="width:86%"></div>
        <div class="skel" style="width:58%"></div>
        <div class="skel" style="width:72%"></div>
      </div>
      <p>检查登录状态…</p>
    </div>
  </div>`;
  try {
    localStatus = await API.officialStatus();
  } catch (e) {
    localStatus = null;
    toast(e.message, 'err');
  }
  const box = root.querySelector('#of-body');
  if (!localStatus || !localStatus.authed) renderLogin(box);
  else renderMain(box);
}

/* ================= 登录收尾（密码/验证码/扫码共用） ================= */
async function finishAuth(box) {
  try { await fetch('/api/official/roles').then(r => r.json()); } catch { /* 已有令牌即可 */ }
  localStatus = await API.officialStatus();
  if (localStatus && localStatus.authed) {
    toast('鹰角通行证登录成功');
    renderMain(box);
    return true;
  }
  return false;
}

/** 无缓存记录时自动同步（对齐小黑盒：登录即拉数据）。
 *  uid 未知（重启后仅凭记住的令牌进入）时先拉角色列表补齐；多角色则等用户点选。 */
async function ensureUid() {
  if (localStatus && localStatus.uid) return localStatus.uid;
  const roles = (localStatus && localStatus.roles) || [];
  if (roles.length === 1) { localStatus.uid = roles[0].uid; return localStatus.uid; }
  try { await fetch('/api/official/roles').then(r => r.json()); } catch { return null; }
  localStatus = await API.officialStatus();
  const rs = (localStatus && localStatus.roles) || [];
  if (rs.length === 1) { localStatus.uid = rs[0].uid; return localStatus.uid; }
  if (rs.length > 1) { toast('检测到多个角色，请点选角色后同步', 'err'); renderMain(root_box || document.getElementById('of-body')); return null; }
  return null;
}
let root_box = null;

async function autoSyncIfEmpty(box) {
  root_box = box;
  const st = localStatus || {};
  if ((st.records || []).some(r => r.char || r.weapon)) return; // 已有缓存 → 走常规展示
  if (st.syncing) return;
  st.syncing = true;
  try {
    const uid = await ensureUid();
    if (!uid) return;
    await doSync(box);
  } finally { st.syncing = false; }
}

/* ================= 登录卡：三 Tab ================= */
function renderLogin(box) {
  box.innerHTML = `
    <div class="panel of-login">
      <div class="panel-title">鹰角通行证登录 <span class="pt-sub">密码 / 短信验证码 / 扫码 · 本机内存直转官方</span></div>
      <div class="of-secnote">
        选择下方任一方式登录<b>鹰角通行证</b>。凭据（账号、密码、短信验证码、扫码确认码、令牌）仅由本机后端<b>内存中直接转发给鹰角官方服务器</b>——
        本工具不存储、不记录、不上传给任何第三方；登录成功后仅保留一枚长时效<b>登录令牌</b>用于拉取你自己的寻访记录
        （不勾选"记住登录态"时令牌也只存内存，官方令牌本身保留约90天）。
      </div>
      <div class="of-tabs" id="of-tabs" role="tablist">
        <button type="button" class="of-tab active" data-tab="pwd" role="tab" aria-selected="true"><span class="of-tab-idx">01</span><i class="of-tab-led"></i>密码登录</button>
        <button type="button" class="of-tab" data-tab="sms" role="tab" aria-selected="false"><span class="of-tab-idx">02</span><i class="of-tab-led"></i>验证码登录</button>
        <button type="button" class="of-tab" data-tab="qr" role="tab" aria-selected="false"><span class="of-tab-idx">03</span><i class="of-tab-led"></i>扫码登录</button>
      </div>

      <section class="of-pane" data-pane="pwd">
        <form class="of-form" id="of-login-form" autocomplete="on">
          <input id="of-account" type="text" inputmode="tel" placeholder="手机号 / 鹰角通行证账号" autocomplete="username" />
          <input id="of-password" type="password" placeholder="密码" autocomplete="current-password" />
          <div class="acts">
            <button class="btn btn-primary" type="submit" id="of-btn-login">登录</button>
            <label class="of-remember"><input type="checkbox" id="of-remember-pwd" />记住登录态</label>
            <span class="of-progress" id="of-login-state"></span>
          </div>
        </form>
      </section>

      <section class="of-pane" data-pane="sms" hidden>
        <form class="of-form" id="of-sms-form">
          <div class="of-sms-row">
            <input id="of-sms-phone" type="text" inputmode="tel" maxlength="11" placeholder="手机号（中国大陆）" autocomplete="tel" />
            <button class="btn" type="button" id="of-sms-send">获取验证码</button>
          </div>
          <input id="of-sms-code" type="text" inputmode="numeric" maxlength="6" placeholder="6 位短信验证码" autocomplete="one-time-code" />
          <div class="acts">
            <button class="btn btn-primary" type="submit" id="of-sms-login">登录</button>
            <label class="of-remember"><input type="checkbox" id="of-remember-sms" />记住登录态</label>
            <span class="of-progress" id="of-sms-state"></span>
          </div>
        </form>
        <div class="pd-subline" style="margin-top:10px">验证码仅用于本机后端向官方换取登录令牌，不落盘、不回显。</div>
      </section>

      <section class="of-pane" data-pane="qr" hidden>
        <div class="of-qr-wrap" id="of-qr-body"><div class="empty-hint">正在生成登录二维码…</div></div>
      </section>

      <details class="src-fold" style="margin-top:14px">
        <summary>备用：手动粘贴登录令牌（其它方式都异常时使用）</summary>
        <div class="of-form" style="margin-top:10px">
          <textarea id="of-token" rows="3" placeholder="在浏览器登录 user.hypergryph.com 后，F12 → Network 里 as.hypergryph.com/user/auth/v1/token_by_phone_password 响应中的 data.token"></textarea>
          <button class="btn" id="of-btn-token">使用该令牌</button>
        </div>
      </details>
    </div>`;

  /* ---- Tab 切换 ---- */
  const tabs = box.querySelector('#of-tabs');
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.of-tab');
    if (!btn || btn.classList.contains('active')) return;
    selectLoginTab(box, btn.dataset.tab);
  });

  /* ---- Tab 1 密码登录（行为与原版一致，仅移除已淘汰的官方页弹窗按钮） ---- */
  box.querySelector('#of-login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const account = box.querySelector('#of-account').value.trim();
    const password = box.querySelector('#of-password').value;
    const state = box.querySelector('#of-login-state');
    const btn = box.querySelector('#of-btn-login');
    if (!account || !password) { toast('请输入账号与密码', 'err'); return; }
    btn.disabled = true;
    state.textContent = '正在登录官方…（凭据仅本机内存直转，不存储）';
    try {
      const remember = box.querySelector('#of-remember-pwd').checked;
      await API.officialLogin({ account, password, remember });
      box.querySelector('#of-password').value = ''; // 登录完成即清空密码框
      state.textContent = '';
      const ok = await finishAuth(box); // 刷新状态 → 角色 → renderMain
      if (!ok) state.textContent = '登录态未生效，请重试';
    } catch (e) {
      state.textContent = '';
      toast(e.message, 'err');
    } finally { btn.disabled = false; }
  });

  /* ---- Tab 2 短信验证码登录 ---- */
  const sendBtn = box.querySelector('#of-sms-send');
  sendBtn.addEventListener('click', async () => {
    const phone = box.querySelector('#of-sms-phone').value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入 11 位中国大陆手机号', 'err'); return; }
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中…';
    try {
      const r = await API.officialSmsSend(phone);
      toast((r && r.msg) || '短信验证码已发送，请查收');
      startSmsCountdown(sendBtn, 60);
    } catch (e) {
      sendBtn.disabled = false;
      sendBtn.textContent = '获取验证码';
      toast(e.message, 'err'); // 官方 msg 原样提示（含频率限制）
    }
  });
  box.querySelector('#of-sms-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const phone = box.querySelector('#of-sms-phone').value.trim();
    const code = box.querySelector('#of-sms-code').value.trim();
    const state = box.querySelector('#of-sms-state');
    const btn = box.querySelector('#of-sms-login');
    if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请输入 11 位中国大陆手机号', 'err'); return; }
    if (!/^\d{4,6}$/.test(code)) { toast('请输入短信验证码', 'err'); return; }
    btn.disabled = true;
    state.textContent = '正在校验验证码…（验证码仅本机内存直转官方）';
    try {
      await API.officialSmsLogin(phone, code, box.querySelector('#of-remember-sms').checked);
      box.querySelector('#of-sms-code').value = '';
      state.textContent = '';
      const ok = await finishAuth(box);
      if (!ok) state.textContent = '登录态未生效，请重试';
    } catch (e) {
      state.textContent = '';
      toast(e.message, 'err'); // 官方 msg（验证码错误/过期等）
    } finally { btn.disabled = false; }
  });

  /* ---- Tab 3 扫码登录：进入 Tab 自动建码 + 2s 轮询 ---- */
  box.querySelector('#of-btn-token').addEventListener('click', async () => {
    const t = box.querySelector('#of-token').value.trim();
    if (!t) { toast('请粘贴令牌', 'err'); return; }
    try {
      await fetch('/api/official/capture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: t }) });
      const ok = await finishAuth(box);
      if (!ok) toast('令牌已保存，点击同步试试', 'err');
    } catch (e) { toast(e.message, 'err'); }
  });
}

function selectLoginTab(box, id) {
  stopQr();
  box.querySelectorAll('.of-tab').forEach(b => {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  box.querySelectorAll('.of-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  if (id === 'qr') startQr(box);
}

/* ---- 验证码 60s 倒计时（禁用态） ---- */
function startSmsCountdown(btn, secs) {
  stopSmsCountdown();
  let left = secs;
  const tick = () => {
    if (!btn.isConnected) { stopSmsCountdown(); return; } // 视图已重渲染
    if (left <= 0) {
      stopSmsCountdown();
      btn.disabled = false;
      btn.textContent = '获取验证码';
      return;
    }
    btn.textContent = `重新获取 ${left}s`;
    left--;
  };
  tick();
  smsTimer = setInterval(tick, 1000);
}

/* ---- 扫码登录 ---- */
function startQr(box) {
  stopQr();
  const body = box.querySelector('#of-qr-body');
  if (!body) return;
  const seq = qrSeq;
  body.innerHTML = `<div class="empty-hint">正在生成登录二维码…</div>`;
  API.officialQrCreate().then(r => {
    if (seq !== qrSeq) return; // 期间已切走/重建
    const scanId = r && r.scanId;
    const qrText = (r && r.qrText) || '';
    if (!scanId) throw new Error('官方未返回 scanId');
    const svg = qrText ? qrSvg(qrText) : '';
    body.innerHTML = `
      ${svg
        ? `<div class="of-qr-box pending" id="of-qr-box">${svg}</div>`
        : `<div class="of-qr-text"><code>${esc(qrText || '（官方未返回二维码内容）')}</code>
             <button class="btn btn-sm" id="of-qr-copy">复制链接</button></div>`}
      <div class="of-qr-state pending" id="of-qr-state"><i class="of-qr-dot"></i>等待扫码：请用<b>明日方舟 / 终末地官方 App</b> 扫码确认</div>
      <div class="acts"><button class="btn btn-sm" id="of-qr-refresh">刷新二维码</button></div>`;
    body.querySelector('#of-qr-refresh').addEventListener('click', () => startQr(box));
    const copyBtn = body.querySelector('#of-qr-copy');
    if (copyBtn) copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(qrText).then(() => toast('已复制'), () => toast('复制失败，请手动选择文本', 'err'));
    });
    const poll = () => pollQr(box, scanId, seq);
    poll();
    qrTimer = setInterval(poll, 2000);
  }).catch(e => {
    if (seq !== qrSeq) return;
    body.innerHTML = `
      <div class="empty-hint">二维码生成失败：${esc(e.message)}</div>
      <div class="acts"><button class="btn btn-sm" id="of-qr-refresh">重试</button></div>`;
    body.querySelector('#of-qr-refresh').addEventListener('click', () => startQr(box));
  });
}

/** qrText → 内联 SVG（vendored 公有域库 qrcode-generator，typeNumber 0 自动选型） */
function qrSvg(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) {
    return ''; // 编码失败 → 回退 qrText 文本 + 复制按钮
  }
}

function setQrState(state, msg) {
  const st = document.getElementById('of-qr-state');
  const qrBox = document.getElementById('of-qr-box');
  if (!st) return;
  st.className = 'of-qr-state ' + state;
  if (state === 'pending') st.innerHTML = `<i class="of-qr-dot"></i>${esc(msg || '等待扫码确认')} · 请用<b>明日方舟 / 终末地官方 App</b> 扫码`;
  else if (state === 'confirmed') st.innerHTML = `<i class="of-qr-dot"></i>${esc(msg || '已确认，正在进入…')}`;
  else st.textContent = msg || '状态异常，请刷新重试';
  if (qrBox) qrBox.classList.toggle('pending', state === 'pending');
  if (qrBox && state === 'expired') qrBox.classList.add('expired');
}

async function pollQr(box, scanId, seq) {
  if (seq !== qrSeq) return;
  let r = null;
  try { r = await API.officialQrStatus(scanId); }
  catch { return; } // 网络抖动：下个周期再试
  if (seq !== qrSeq) return;
  const st = (r && r.status) || 'error';
  if (st === 'pending') {
    setQrState('pending', r.msg);
  } else if (st === 'expired') {
    stopQr();
    setQrState('expired', '二维码已过期，请点击「刷新二维码」重试');
  } else if (st === 'confirmed') {
    stopQr();
    setQrState('confirmed', '扫码已确认，正在进入…');
    await finishAuth(box); // 与密码登录同一条 renderMain 路径
  } else {
    stopQr();
    setQrState('error', (r && r.msg) || '扫码状态异常，请刷新重试');
  }
}

/* ================= 主界面 ================= */
function renderMain(box) {
  const st = localStatus;
  const roles = st.roles || [];
  const recSummary = st.records || [];
  const exportUid = st.uid || (recSummary[0] && recSummary[0].uid) || '';
  box.innerHTML = `
    <div class="panel">
      <div class="panel-title">账号与同步
        <span class="pt-sub">${roles.length ? '已登录鹰角通行证' : '登录态已保存（令牌）'}${st.remembered ? ' · 已记住登录态' : ''}</span>
      </div>
      ${roles.length ? `
        <div class="of-roles">${roles.map(r => `
          <button class="btn btn-sm of-role ${st.uid === r.uid ? 'btn-primary' : ''}" data-uid="${esc(r.uid)}" title="${esc(r.serverName || '')} ${esc(r.channelName || '')}">
            ${esc(r.nickName || r.uid)} <span class="pt-sub">${esc(r.uid)}</span>
          </button>`).join('')}
        </div>` : '<div class="empty-hint">登录态来自已保存的令牌（未缓存角色列表），直接点同步即可。</div>'}
      <div class="acts" style="margin-top:10px">
        <button class="btn btn-primary" id="of-btn-sync">同步寻访记录</button>
        <a class="btn" id="of-btn-export" href="/api/official/export${exportUid ? `?uid=${encodeURIComponent(exportUid)}` : ''}" download
          title="导出该 UID 全部缓存记录（CSV，含 up/免费标记，Excel 可直开）">导出 CSV</a>
        <button class="btn" id="of-btn-logout">退出登录</button>
        <span class="of-progress" id="of-progress"></span>
      </div>
      ${recSummary.length ? `<div class="of-recsum">已缓存：${recSummary.map(r => `UID ${esc(r.uid)}（角色 ${num(r.char)} · 武器 ${num(r.weapon)} · ${esc(fmtTime(r.updatedAt))}）`).join('；')}</div>` : ''}
    </div>
    <div id="of-analysis"><div class="empty-hint">正在准备分析数据…</div></div>`;

  box.querySelectorAll('.of-role').forEach(b => b.addEventListener('click', () => {
    localStatus.uid = b.dataset.uid;
    box.querySelectorAll('.of-role').forEach(x => x.classList.toggle('btn-primary', x.dataset.uid === localStatus.uid));
    const ex = box.querySelector('#of-btn-export'); // 导出跟随当前选中 UID
    if (ex) ex.href = `/api/official/export?uid=${encodeURIComponent(localStatus.uid)}`;
  }));
  box.querySelector('#of-btn-sync').addEventListener('click', () => doSync(box));
  box.querySelector('#of-btn-logout').addEventListener('click', async () => {
    await API.officialLogout();
    localStatus = null;
    toast('已退出登录并清除本地令牌');
    renderLogin(box);
  });

  // 已有缓存则直接展示分析
  const cachedUid = st.uid || (recSummary[0] && recSummary[0].uid);
  if (cachedUid && recSummary.find(r => r.uid === cachedUid && (r.char || r.weapon))) {
    loadAnalysis(box, cachedUid);
  } else {
    autoSyncIfEmpty(box); // 登录后无缓存 → 自动同步拉取
  }
}

async function doSync(box) {
  const btn = box.querySelector('#of-btn-sync');
  const prog = box.querySelector('#of-progress');
  btn.disabled = true;
  prog.textContent = '正在登录校验…';
  if (!localStatus.uid) {
    const u = await ensureUid();
    if (!u) { btn.disabled = false; prog.textContent = ''; return; }
  }
  try {
    prog.textContent = '正在逐池拉取记录（每页间隔防风控，可能需要十几秒）…';
    const r = await API.officialSync(localStatus.uid || undefined);
    prog.textContent = `同步完成：${(r.progress || []).length} 个池，共 ${num((r.progress || []).reduce((a, p) => a + p.count, 0))} 条`;
    toast('官方记录同步完成');
    renderAnalysis(box.querySelector('#of-analysis'), r.analysis, r.uid);
    setTimeout(() => loadPrediction(box, r.uid), 120); // 同上
    localStatus = await API.officialStatus();
  } catch (e) {
    prog.textContent = '';
    toast(e.message, 'err');
    if (String(e.message).includes('未登录')) { localStatus = null; renderLogin(box); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadAnalysis(box, uid) {
  try {
    const r = await fetch(`/api/official/analysis?uid=${encodeURIComponent(uid)}`).then(x => x.json());
    if (r.analysis) renderAnalysis(box.querySelector('#of-analysis'), r.analysis, uid);
    setTimeout(() => loadPrediction(box, uid), 120); // 先画完分析再算预测（手机端防冻结）
  } catch (e) { toast(e.message, 'err'); }
}

async function loadPrediction(box, uid) {
  try {
    const r = await API.officialPredict(uid);
    if (r.prediction) {
      const el = box.querySelector('#of-predict');
      if (el) el.innerHTML = predictionHtml(r.prediction);
    }
  } catch {
    const el = box.querySelector('#of-predict');
    if (el) el.innerHTML = '<div class="empty-hint">预测计算暂不可用</div>';
  }
}

/* ================= 分析渲染：小组件 ================= */
const NUM_DASH = '—';
const nOr = (v) => (v == null ? NUM_DASH : num(v));
const pctOr = (v) => (v == null ? NUM_DASH : v + '%');

/** 记录窗口提示条（g）：最早/最晚记录 + 90 天保留期不完整月份警示（有数据才显示） */
function winBarHtml(chWin, wpWin) {
  const c = chWin || {}, w = wpWin || {};
  const parts = [];
  if (c.oldest) parts.push(`角色 ${esc(fmtTime(c.oldest))} ~ ${esc(fmtTime(c.newest))}`);
  if (w.oldest) parts.push(`武器 ${esc(fmtTime(w.oldest))} ~ ${esc(fmtTime(w.newest))}`);
  if (!parts.length) return '';
  const inc = [...new Set([...(c.incompleteMonths || []), ...(w.incompleteMonths || [])])].sort();
  return `
    <div class="of-winbar${inc.length ? ' warn' : ''}">
      <span class="of-win-ico">⌗</span>
      <span>记录窗口：${parts.join(' ｜ ')}</span>
      ${inc.length ? `<span class="of-win-warn">⚠ 官方仅保留约 90 天记录，以下月份数据不完整：${esc(inc.join('、'))}</span>` : ''}
    </div>`;
}

/** 金卡时间线 chip（UP 琥珀高亮 · 角标为该金花费抽数） */
function gchipHtml(g) {
  const pity = num((g && g.pity) ?? 0);
  const title = `${esc(fmtTime(g && g.ts))} · 花费 ${pity} 抽`;
  return `<span class="of-gchip${g && g.up ? ' up' : ''}" title="${title}">${g && g.up ? '★ ' : ''}${esc(g.name || '？')}<i>${pity}</i></span>`;
}

/** 时间线 chips 分帧渲染（长列表用 chunkRender，遵守性能红线） */
function mountTimeline(box, timeline, emptyText) {
  if (!box) return;
  const tl = (Array.isArray(timeline) ? timeline : []).filter(g => g && g.name);
  if (!tl.length) { box.innerHTML = `<div class="empty-hint">${esc(emptyText || '窗口内暂无记录')}</div>`; return; }
  chunkRender(box, tl.map(gchipHtml), { chunk: 48 });
}

/** 保底计数分布（5 桶，纯 CSS 宽度百分比条，复用月度条仪表语汇） */
function bucketRows(buckets) {
  const bs = (Array.isArray(buckets) ? buckets : []).filter(b => b && b.label != null);
  if (!bs.length) return '<div class="empty-hint">窗口内暂无出金记录</div>';
  const max = Math.max(1, ...bs.map(b => Number(b.count) || 0));
  return `<div class="of-monthly">${bs.map(b => {
    const v = Number(b.count) || 0;
    return `<div class="of-mrow" title="保底计数 ${esc(b.label)}：${num(v)} 次">
      <span class="of-mk">${esc(b.label)}</span>
      <span class="of-mtrack"><span class="of-mbar" style="width:${Math.round(v / max * 100)}%"></span></span>
      <span class="of-mv">${num(v)}</span></div>`;
  }).join('')}</div>`;
}

/* ================= 分析渲染 ================= */
function renderAnalysis(el, a, uid) {
  if (!el) return;
  const t = a.totals || {};
  const lk = a.luck || {};
  const py = a.pity || {};
  const cur = py.currentPool || {};
  const ch = a.char || {};
  const wp = a.weapon || {};
  const golds = (a.golds || []).slice(0, 50);
  const months = Object.entries(a.monthly || {}).sort();
  const maxM = Math.max(1, ...months.map(x => x[1]));
  const chWin = ch.window || null;
  const wpWin = wp.window || null;
  const spend = ch.spend || null;
  const lp = ch.luckPercentile;
  const charPulls = t.char != null ? t.char : null;
  const luckExplain = lp == null ? '' :
    `窗口内 ${nOr(sixStarsOf(ch))} 金 / ${nOr(charPulls)} 抽。以角色池保底机制对同样总抽数做 2 万次模拟，出金数超过你的模拟占 ${lp}%——数值越高越欧（50 为中位水平）。`;

  el.innerHTML = `
    ${winBarHtml(chWin, wpWin)}

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">分析仪表盘 <span class="pt-sub">UID ${esc(uid)} · ${esc(fmtTime(a.updatedAt))} · ${esc(a.windowNote || '')}</span></div>
      <div class="stat-grid">
        <div class="stat-card"><div class="sc-label">总抽数（窗口内）</div><div class="sc-val">${num(t.totalPulls)}</div><div class="sc-sub">角色 ${num(t.char)} · 武器 ${num(t.weapon)}${(t.charFree || t.weaponFree) ? ` · 另免费十连 ${num((t.charFree || 0) + (t.weaponFree || 0))} 抽（不计保底）` : ''}</div></div>
        <div class="stat-card"><div class="sc-label">六星 / 五星（角色）</div><div class="sc-val v-amber">${num(t.charR && t.charR[6] || 0)}<span style="font-size:14px;color:var(--dim-2)"> / ${num(t.charR && t.charR[5] || 0)}</span></div><div class="sc-sub">武器六星 ×${num(t.wpnR && t.wpnR[6] || 0)}</div></div>
        <div class="stat-card"><div class="sc-label">六星出率</div><div class="sc-val">${lk.sixRate == null ? '—' : lk.sixRate + '%'}</div><div class="sc-sub">模型期望 ≈1.85%</div></div>
        <div class="stat-card"><div class="sc-label">平均每金</div><div class="sc-val ${lk.avgPerGold && lk.avgPerGold <= 54 ? 'v-green' : 'v-amber'}">${lk.avgPerGold == null ? '—' : num(lk.avgPerGold)}</div><div class="sc-sub">模型期望 54 抽</div></div>
        <div class="stat-card"><div class="sc-label">UP 占比</div><div class="sc-val">${lk.upShare == null ? '—' : lk.upShare + '%'}</div><div class="sc-sub">理论 50%（含120井拉高）</div></div>
        <div class="stat-card luck-card"><div class="sc-label">运气评级</div><div class="sc-val">${esc(lk.rating || '—')}</div><div class="sc-sub">基于窗口内数据</div></div>
      </div>
    </div>

    <div class="stats-cols" style="margin-top:16px">
      <div class="panel">
        <div class="panel-title">武器池专区 <span class="pt-sub">40 抽保底 · UP 率对照官方 25%</span></div>
        ${wp.pulls ? `
          <div class="sim-metrics">
            <div class="sim-metric"><div class="sm-l">窗口内抽数</div><div class="sm-v">${num(wp.pulls)}</div></div>
            <div class="sim-metric"><div class="sm-l">出金率</div><div class="sm-v">${pctOr(wp.rate)}</div></div>
            <div class="sim-metric"><div class="sm-l">平均每金</div><div class="sm-v">${nOr(wp.avgPerGold)}</div></div>
            <div class="sim-metric${wp.upRate != null && wp.upRate >= 25 ? ' hl' : ''}"><div class="sm-l">UP 率（官方 25%）</div><div class="sm-v">${pctOr(wp.upRate)}</div></div>
            <div class="sim-metric"><div class="sm-l">五星（窗口内）</div><div class="sm-v">${num(wp.fiveStar && wp.fiveStar.count || 0)}</div></div>
          </div>
          ${pbar('当前武器池 40 抽保底进度（推断）', wp.pity40 ?? 0, 40, { color: 'purple', right: `${num(wp.pity40 ?? 0)} / 40` })}
          <div class="pd-subline" style="margin-top:8px">武器金卡时间线（旧 → 新，角标为该池内间隔）</div>
          <div class="of-gtl of-gtl-sm" id="of-gtl-weapon"></div>`
        : '<div class="empty-hint">窗口内暂无武器池记录</div>'}
      </div>
      <div class="panel">
        <div class="panel-title">保底结构 <span class="pt-sub">出金时保底计数分布（限定轨）</span></div>
        ${bucketRows(ch.pityBuckets)}
        <div class="rate-chips" style="margin-top:10px">
          <span class="chip chip-amber">硬保底命中（恰第 80 抽）× ${num(ch.hardPityHits ?? 0)}</span>
          <span class="chip chip-cyan">软保底区间出金（66–79 抽）× ${num(ch.softPityHits ?? 0)}</span>
        </div>
        <div class="pd-subline" style="margin-top:8px">80 抽硬保底；第 66 抽起出率逐抽提升（软保底），占比高说明常被概率提前送出金。</div>
      </div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">欧非百分位 <span class="pt-sub">同总抽数 · 蒙特卡洛 2 万次模拟</span></div>
        ${lp == null ? '<div class="empty-hint">窗口内暂无出金记录，暂无法计算百分位</div>' : `
          <div class="of-luckp-big">
            <b class="${lp >= 50 ? 't-amber' : 't-cyan'}">${esc(lp)}%</b>
            <span class="of-luckp-unit">击败了 ${esc(lp)}% 的玩家</span>
          </div>
          <p class="of-luckp-note">${esc(luckExplain)}</p>`}
      </div>
      <div class="panel">
        <div class="panel-title">消费估算 <span class="pt-sub">窗口内角色池抽数折算</span></div>
        ${spend ? `
          <div class="cost-grid">
            <div class="cost-card"><div class="cc-t">嵌晶玉（抽数×500）</div><div class="cc-v">${num(spend.jade ?? 0)}</div></div>
            <div class="cost-card"><div class="cc-t">源石（1 源石 = 75 玉）</div><div class="cc-v">${num(spend.stones ?? 0)}<small> 源石</small></div></div>
            <div class="cost-card"><div class="cc-t">人民币 · 非首充（648 元 = 350 源石）</div><div class="cc-v">¥${num(spend.rmbNonFirst ?? 0)}</div></div>
            <div class="cost-card"><div class="cc-t">人民币 · 首充（648 元 = 560 源石）</div><div class="cc-v">¥${num(spend.rmbFirst ?? 0)}</div></div>
          </div>
          <div class="cost-note">按窗口内角色池 ${nOr(charPulls)} 抽等价折算，仅作量级参考，非实际消费记录。</div>`
        : '<div class="empty-hint">暂无数据</div>'}
      </div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">卡池明细 <span class="pt-sub">限定轨每池 + 基础寻访 · 计费口径 · 新池在前</span></div>
        ${poolBreakHtml(ch.poolBreakdown, cur.poolId)}
      </div>
      <div class="panel">
        <div class="panel-title">出金间隔分布 <span class="pt-sub">相邻两金之间的抽数 · 限定轨</span></div>
        ${gapHistHtml(ch.gapHistogram)}
      </div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">「歪后必中？」<span class="pt-sub">实测检验 · 每金独立 50%</span></div>
        ${offAfterOffHtml(ch.offAfterOff)}
      </div>
      <div class="panel">
        <div class="panel-title">活跃度 <span class="pt-sub">计费记录按 UTC 日期聚合</span></div>
        ${activityHtml(ch.activity)}
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">金卡时间线 <span class="pt-sub">限定轨六星 · 时间正序（旧 → 新）· 角标为该金花费抽数</span></div>
      <div class="of-gtl" id="of-gtl-char"></div>
      <div class="pd-subline" style="margin-top:8px">★ 琥珀高亮为当期 UP；悬停查看出货时间。</div>
    </div>

    <div class="stats-cols">
      <div class="panel">
        <div class="panel-title">保底状态推断 <span class="pt-sub">由真实记录倒推</span></div>
        ${pbar('限定寻访 80 抽计数（跨池继承）', py.limitedPity, 80, { color: 'amber', right: `${num(py.limitedPity)} / 80` })}
        ${pbar('基础寻访 80 抽计数（独立）', py.standardPity, 80, { color: 'cyan', right: `${num(py.standardPity)} / 80` })}
        <div class="pd-subline" style="margin-top:8px">最近限定池：${esc(cur.poolName || '—')}
          · 窗口内累计 <b>${num(cur.pullsInWindow || 0)}</b> 抽（120 井进度受90天窗口限制）
          · ${cur.upObtained ? '<span class="t-green">已获得当期 UP ✓</span>' : '<span class="t-amber">尚未获得当期 UP</span>'}</div>
        ${(a.weaponPools || []).slice(0, 4).map(w => pbar(
          `武器池 ${esc(w.poolName || '')} · 40 抽保底`, w.since6, 40,
          { color: 'purple', right: `窗口内 ${num(w.pulls)} 抽${w.lastSix ? ' · 最近六星 ' + esc(w.lastSix) : ''}` })).join('')}
      </div>
      <div class="panel">
        <div class="panel-title">月度寻访量</div>
        ${months.length ? `<div class="of-monthly">${months.map(([k, v]) =>
          `<div class="of-mrow" title="${esc(k)}：${num(v)} 抽"><span class="of-mk">${esc(k.slice(2))}</span>
            <span class="of-mtrack"><span class="of-mbar" style="width:${Math.round(v / maxM * 100)}%"></span></span><span class="of-mv">${num(v)}</span></div>`).join('')}</div>`
        : '<div class="empty-hint">暂无数据</div>'}
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">六星记录 <span class="pt-sub">最新在前 · UP 判定基于本地卡池数据</span></div>
      ${golds.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>干员</th><th>UP</th><th>出货抽数</th><th>卡池</th><th>时间</th></tr></thead><tbody>
        ${golds.map(g => `<tr><td><b>${esc(g.name)}</b>${g.isNew ? ' <span class="chip chip-gray">NEW</span>' : ''}${g.free ? ' <span class="chip chip-cyan">免费</span>' : ''}</td>
          <td>${g.isUp ? '<span class="t-amber">UP ✓</span>' : '<span class="t-red">歪</span>'}</td>
          <td>${g.spent != null ? num(g.spent) : '—'}</td><td>${esc(g.pool || '')}</td><td class="pt-sub">${esc(fmtTime(g.ts))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty-hint">窗口内没有六星记录</div>'}
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">未来预测 <span class="pt-sub">基于当前真实保底状态的蒙特卡洛（10万次）</span></div>
      <div id="of-predict"><div class="empty-hint">计算中…</div></div>
    </div>`;

  // 时间线分帧挂载（放在 innerHTML 之后）
  mountTimeline(el.querySelector('#of-gtl-char'), ch.goldTimeline, '窗口内暂无金卡记录');
  mountTimeline(el.querySelector('#of-gtl-weapon'), wp.goldTimeline, '窗口内暂无武器金卡');
}

function sixStarsOf(ch) { return ch && ch.sixStars != null ? ch.sixStars : null; }

/* ================= 分析板块（契约扩展：poolBreakdown / gapHistogram / offAfterOff / activity） ================= */
/** ms 时间戳 → 短日期（10.15，UTC 日界与后端聚合口径一致） */
function dayOf(tsMs) {
  const t = Number(tsMs);
  if (!Number.isFinite(t) || t <= 0) return null;
  try { return fmtDate(new Date(t).toISOString().slice(0, 10)); } catch { return null; }
}

/** 卡池明细：池名 + 计费抽数大字 + 免费角标 + 金/UP chips + 池内已垫 + 时间范围；当前激活池琥珀高亮 */
function poolBreakHtml(pools, currentPoolId) {
  const ps = (Array.isArray(pools) ? pools : []).filter(p => p && (p.poolName != null || p.poolId));
  if (!ps.length) return '<div class="empty-hint">窗口内暂无限定轨 / 基础寻访记录</div>';
  return `<div class="of-pools">${ps.map(p => {
    const act = !!(currentPoolId && p.poolId === currentPoolId);
    const range = (p.firstTs && p.lastTs)
      ? (p.firstTs === p.lastTs ? dayOf(p.firstTs) : `${dayOf(p.firstTs)} ~ ${dayOf(p.lastTs)}`)
      : '仅免费记录';
    return `<div class="of-pool-card${act ? ' act' : ''}"${act ? ' title="当前激活池"' : ''}>
      <div class="of-pool-top">
        <span class="of-pool-name" title="${esc(p.poolName || '')}">${esc(p.poolName || '未命名池')}</span>
        ${p.free ? `<span class="of-pool-free" title="该池免费抽数（不计入计费口径）">+${num(p.free)} 免</span>` : ''}
      </div>
      <div class="of-pool-big">${num(p.pulls)}<small> 抽</small></div>
      <div class="rate-chips">
        <span class="chip chip-amber">六星 ${num(p.golds)}</span>
        <span class="chip chip-cyan">UP ${num(p.upCount)}</span>
      </div>
      <div class="of-pool-sub">池内已垫 <b>${num(p.sinceLast6 ?? 0)}</b> 抽 · ${esc(range)}${act ? ' · <span class="t-amber">当前激活</span>' : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

/** gapHistogram 中位间隔近似：按桶中点加权累计到 50% 分位（仅展示用） */
function gapMedianOf(buckets) {
  const bs = (Array.isArray(buckets) ? buckets : [])
    .map(b => ({ label: b && b.label, count: Number(b && b.count) || 0 }))
    .filter(b => b.label != null && b.count > 0);
  const total = bs.reduce((a, b) => a + b.count, 0);
  if (!total) return null;
  const midOf = (label) => {
    const m = String(label).match(/^(\d+)-(\d+)(\+?)$/);
    if (!m) return null;
    return m[3] ? 80 : (+m[1] + +m[2]) / 2;
  };
  let acc = 0;
  for (const b of bs) {
    acc += b.count;
    if (acc >= total / 2) { const v = midOf(b.label); return v == null ? null : Math.round(v); }
  }
  return null;
}

/** 出金间隔分布：8 根纯 CSS 竖条（of-mbar 纵向语汇），悬停显示区间与次数 */
function gapHistHtml(buckets) {
  const bs = (Array.isArray(buckets) ? buckets : []).filter(b => b && b.label != null);
  if (!bs.length) return '<div class="empty-hint">出金不足 2 次，暂无间隔分布</div>';
  const max = Math.max(1, ...bs.map(b => Number(b.count) || 0));
  const total = bs.reduce((a, b) => a + (Number(b.count) || 0), 0);
  const med = gapMedianOf(bs);
  return `<div class="of-gap">${bs.map(b => {
    const v = Number(b.count) || 0;
    const h = Math.max(v ? 5 : 1.5, v / max * 100);
    return `<div class="of-gap-col" title="间隔 ${esc(b.label)} 抽：${num(v)} 次">
      <span class="of-gap-n">${v ? num(v) : ''}</span>
      <span class="of-gap-track"><i class="of-gap-bar" style="height:${h.toFixed(1)}%"></i></span>
      <span class="of-gap-k">${esc(b.label)}</span>
    </div>`;
  }).join('')}</div>
  ${total >= 2 && med != null ? `<div class="pd-subline" style="margin-top:8px">中位间隔 ≈ <b class="t-amber">${num(med)}</b> 抽（按分布近似 · 共 ${num(total)} 个间隔）</div>` : ''}`;
}

/** 「歪后必中？」myth 卡：实测比率 + 打破错觉的说明（样本 <3 或为 0 走 empty-hint） */
function offAfterOffHtml(o) {
  const d = o || {};
  const n = Number(d.afterOffTotal) || 0;
  if (d.observedRate == null) {
    return `<div class="empty-hint">${n
      ? `歪后出金样本仅 ${num(n)} 次（不足 3），暂不给出经验比率`
      : '窗口内暂无可统计的「歪后出金」样本'}</div>`;
  }
  return `<div class="of-luckp-big">
      <b class="t-cyan">${esc(d.observedRate)}%</b>
      <span class="of-luckp-unit">歪后下一金为 UP 的实测比率</span>
    </div>
    <p class="of-luckp-note">样本 ${num(n)} 次中 ${num(d.afterOffUp ?? 0)} 次命中 UP。终末地<b>每一金独立判定 50% UP、没有大小保底</b>——「歪了下一金必中」并不存在，经验比率只会围绕 50% 波动。</p>`;
}

/** 活跃度卡：活跃天数 / 日均抽数 / 最猛一天（date+pulls） */
function activityHtml(act) {
  const a = act || {};
  const top = (Array.isArray(a.topDays) ? a.topDays : []).filter(d => d && d.date);
  if (!a.activeDays && !top.length) return '<div class="empty-hint">窗口内暂无记录</div>';
  const best = top[0] || null;
  return `<div class="sim-metrics">
      <div class="sim-metric"><div class="sm-l">活跃天数</div><div class="sm-v">${num(a.activeDays ?? 0)}<small style="font-size:12px;color:var(--dim-2);font-weight:400"> 天</small></div></div>
      <div class="sim-metric"><div class="sm-l">日均抽数</div><div class="sm-v">${a.avgPerActiveDay == null ? '—' : num(a.avgPerActiveDay)}</div></div>
      <div class="sim-metric hl"><div class="sm-l">最猛一天</div><div class="sm-v">${best ? num(best.pulls) : '—'}<small style="font-size:12px;color:var(--dim-2);font-weight:400"> 抽</small></div>
        <div class="sm-l" style="margin-top:3px">${best ? `${esc(best.date)} · 六星 ×${num(best.golds ?? 0)}` : '—'}</div></div>
    </div>
    ${top.length > 1 ? `<div class="pd-subline" style="margin-top:8px">Top ${num(top.length)} 天：${top.map(d => `${esc(String(d.date).slice(5))} ${num(d.pulls)}抽`).join(' · ')}</div>` : ''}`;
}

/* ================= 未来预测渲染（场景 + 概率曲线 + 频率外推） ================= */
/** P50/P90 人民币估算：与后端 predict.toCost 双档同口径（648 元 = 350 源石非首充 / 560 源石首充，向上取整到元） */
function cnyOf(pulls) {
  const jade = (Number(pulls) || 0) * 500;
  return {
    nonFirst: Math.ceil(jade / 75 / 350 * 648),
    first: Math.ceil(jade / 75 / 560 * 648)
  };
}

/** 场景 cost 安全取值：新字段缺失时由 jade/mean 兜底推算（后端旧字段 pulls/jade 保留） */
function costParts(s) {
  const c = (s && s.cost) || {};
  const jade = c.jade != null ? Number(c.jade) : Math.round((Number(s && s.mean) || 0) * 500);
  return {
    jade,
    originium: c.originium != null ? c.originium : +(jade / 75).toFixed(1),
    nonFirst: c.cnyNonFirst != null ? c.cnyNonFirst : Math.ceil(jade / 75 / 350 * 648),
    first: c.cnyFirst != null ? c.cnyFirst : Math.ceil(jade / 75 / 560 * 648)
  };
}

/** 概率曲线（纯 SVG 静态绘制，无动画）：curve [{pulls,prob}]，ref 提供 P50/P90 竖标 */
function curveSvg(curve, ref) {
  const c = (Array.isArray(curve) ? curve : [])
    .map(pt => ({ pulls: +pt.pulls, prob: +pt.prob }))
    .filter(pt => Number.isFinite(pt.pulls) && Number.isFinite(pt.prob));
  if (c.length < 2) return '';
  const W = 640, H = 208, L = 44, R = 14, T = 18, B = 34;
  const maxX = c[c.length - 1].pulls || 240;
  const x = v => L + (v / maxX) * (W - L - R);
  const y = v => T + (1 - Math.max(0, Math.min(1, v))) * (H - T - B);
  const pts = c.map(pt => `${x(pt.pulls).toFixed(1)},${y(pt.prob).toFixed(1)}`).join(' ');
  const areaPts = [`${x(c[0].pulls).toFixed(1)},${y(0).toFixed(1)}`,
    ...c.map(pt => `${x(pt.pulls).toFixed(1)},${y(pt.prob).toFixed(1)}`),
    `${x(c[c.length - 1].pulls).toFixed(1)},${y(0).toFixed(1)}`].join(' ');

  let g = '';
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    g += `<line class="grid" x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}"/>`
      + `<text class="axis-t" x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`;
  }
  for (const px of [60, 120, 180, 240]) {
    if (px > maxX) continue;
    g += `<line class="grid" x1="${x(px).toFixed(1)}" y1="${T}" x2="${x(px).toFixed(1)}" y2="${(H - B).toFixed(1)}"/>`
      + `<text class="axis-t" x="${x(px).toFixed(1)}" y="${H - B + 15}" text-anchor="middle">${px}</text>`;
  }
  if (maxX >= 120) g += `<text class="axis-t mark-t" x="${x(120).toFixed(1)}" y="${T - 6}" text-anchor="middle">120 大保底</text>`;
  if (ref) {
    const marks = [[ref.median, 'P50', 9], [ref.p90, 'P90', 20]];
    for (const [pulls, label, dy] of marks) {
      const pv = +pulls;
      if (!Number.isFinite(pv) || pv <= 0 || pv > maxX) continue;
      g += `<line class="mark" x1="${x(pv).toFixed(1)}" y1="${T}" x2="${x(pv).toFixed(1)}" y2="${(H - B).toFixed(1)}"/>`
        + `<text class="mark-t" x="${x(pv).toFixed(1)}" y="${T + dy}" text-anchor="middle">${label} ${Math.round(pv)}抽</text>`;
    }
  }
  return `<svg class="of-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="10 至 240 抽内获得 UP 的累计概率曲线">
    <polygon class="area" points="${areaPts}"/>${g}<polyline class="line" points="${pts}"/>
  </svg>`;
}

function predictionHtml(p) {
  p = p || {};
  const scs = Array.isArray(p.scenarios) ? p.scenarios : [];
  const rows = scs.map(s => {
    const c = costParts(s);
    return `
    <div class="of-pred">
      <div class="of-pred-name">${esc(s.name || '')}<span class="pt-sub">起始保底 ${num(s.fromPity)}/80</span></div>
      <div class="of-pred-nums">
        <span>期望 <b>${num(s.mean)}</b> 抽</span><span>中位 <b>${num(s.median)}</b></span>
        <span>90% ≤ <b>${num(s.p90)}</b></span><span>≤80抽概率 <b>${Math.round((s.within80 || 0) * 100)}%</b></span>
        <span class="of-cost">≈ ${num(c.jade)} 嵌晶玉 / ${num(c.originium)} 源石 / ¥${num(c.nonFirst)}（非首充）· ¥${num(c.first)}（首充）</span>
      </div>
    </div>`;
  }).join('');
  const ref = scs[1] || scs[0] || null; // 曲线/标记取「下一期新池」口径（与后端 curve 同源），缺失时退首个场景
  const curve = curveSvg(p.curve, ref);
  const curveBlock = curve
    ? `<div class="of-curve-wrap">
         <div class="pd-subline" style="margin-top:14px">获得 UP 累计概率曲线（下一期新池口径 · 10–240 抽 · 120 抽大保底封顶）</div>
         ${curve}
       </div>`
    : '<div class="empty-hint" style="margin-top:12px">概率曲线暂不可用</div>';
  const mp = p.monthlyPulls;
  const d90 = p.daysToP90;
  const freqHtml = `
    <div class="sim-metrics" style="margin-top:14px">
      <div class="sim-metric"><div class="sm-l">月均抽数（近 90 天）</div><div class="sm-v">${mp == null ? '—' : num(mp)}</div></div>
      <div class="sim-metric"><div class="sm-l">攒够 P90 所需天数</div><div class="sm-v">${d90 == null ? '—' : num(d90)}<small style="font-size:12px;color:var(--dim-2);font-weight:400"> 天</small></div></div>
      ${ref ? (() => { const c = cnyOf(ref.median), c9 = cnyOf(ref.p90); return `<div class="sim-metric hl"><div class="sm-l">P50 / P90（下一期新池）</div>
        <div class="sm-v">${num(ref.median)} / ${num(ref.p90)}<small style="font-size:12px;color:var(--dim-2);font-weight:400"> 抽</small></div>
        <div class="sm-l" style="margin-top:3px">≈ ¥${num(c.nonFirst)} / ¥${num(c9.nonFirst)}（非首充）· ¥${num(c.first)} / ¥${num(c9.first)}（首充）<span style="color:var(--dim-3)">　648 元 = 350 / 560 源石</span></div></div>`; })() : ''}
    </div>`;
  return (p.banner ? `<div class="pd-subline" style="margin-top:0">目标卡池：<b class="t-amber">${esc(p.banner.name || '')}</b>（UP ${esc(p.banner.up6 || '—')}）</div>` : '')
    + (rows || '<div class="empty-hint">暂无预测场景</div>') + curveBlock + freqHtml;
}
