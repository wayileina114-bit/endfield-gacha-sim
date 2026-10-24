'use strict';
/**
 * 《明日方舟：终末地》抽卡模拟器 — 零依赖 Node 后端
 * 启动：node server.js （或双击 start.bat），浏览器打开 http://127.0.0.1:3276
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { getData } = require('./src/engine/dataloader');
const engine = require('./src/engine');
const { simulateCharacter, simulateWeapon, sixCountPercentile } = require('./src/engine/simulate');
const state = require('./src/state');
const updater = require('./src/updater');
const hgApi = require('./src/official/hg-api');
const officialStore = require('./src/official/store');
const { analyze, predict, officialRecordsCsv, toCsv } = require('./src/official/analyze');

/** 官方登录态：仅内存；用户勾选"记住登录态"时保存长时效 token（绝不保存账号密码） */
let officialAuth = { loginToken: null, oauthToken: null, roles: [], uid: null };

// 短信发码节流：手机号 → 上次发送时间戳（仅内存，60 秒内同号拒绝重复发送；凭据/验证码永不落盘）
const SMS_RESEND_MS = 60 * 1000;
const smsSentAt = new Map();

async function ensureOauthToken() {
  if (officialAuth.oauthToken) return officialAuth.oauthToken;
  let token = officialAuth.loginToken;
  if (!token) {
    const saved = officialStore.loadAuth();
    if (saved && saved.loginToken) { token = saved.loginToken; officialAuth.loginToken = token; }
  }
  if (!token) { const e = new Error('未登录鹰角通行证'); e.code = 401; throw e; }
  officialAuth.oauthToken = await hgApi.grant(token);
  return officialAuth.oauthToken;
}

/** 登录收尾（密码/短信/扫码共用）：换 OAuth、拉角色绑定列表、写入内存登录态。
 *  remember 仅落长时效 token（official-auth.json），凭据/验证码/scanCode 永不落盘。 */
async function finishLogin(loginToken, remember) {
  officialAuth.loginToken = loginToken;
  officialAuth.oauthToken = null;
  if (remember) officialStore.saveAuth({ loginToken, savedAt: new Date().toISOString() });
  else officialStore.clearAuth();
  const oauth = await ensureOauthToken();
  const bindings = await hgApi.bindingList(oauth) || [];
  const roles = (bindings.list || bindings || []).map(b => ({
    uid: String(b.uid), nickName: b.nickName, serverId: b.serverId, serverName: b.serverName, channelName: b.channelName
  }));
  officialAuth.roles = roles;
  if (roles.length === 1) officialAuth.uid = roles[0].uid;
  return roles;
}

const PORT = Number(process.env.PORT || 3276);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 200 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

/** 卡池状态摘要（给前端展示保底进度） */
function bannerView(b) {
  const s = state.load();
  const d = getData();
  if (b.category === 'weapon') {
    const ws = s.weapons[b.id] || { cum: 0, pullsSince6: 0, upObtained: false, milestoneIndex: 0 };
    const pool6 = (b.pool6 && b.pool6.length) ? b.pool6 : [b.up6, ...d.standardWeaponPool];
    return {
      id: b.id, name: b.name, category: 'weapon', type: b.type, version: b.version,
      start: b.start, end: b.end, up6: b.up6, up6Type: b.up6Type || null,
      pairedCharBanner: b.pairedCharBanner || null,
      pool6, pool6Detail: b.pool6Detail || null, notes: b.notes,
      status: bannerStatus(b),
      state: { cum: ws.cum, pullsSince6: ws.pullsSince6, upObtained: ws.upObtained, milestoneIndex: ws.milestoneIndex }
    };
  }
  const base = {
    id: b.id, name: b.name, category: 'character', type: b.type, version: b.version, versionName: b.versionName,
    start: b.start, end: b.end, up6: b.up6, pool6: b.pool6, notes: b.notes,
    fiveStarPool: d.fiveStarPool, fourStarPool: d.fourStarPool,
    specialRules: b.specialRules || null,
    status: bannerStatus(b)
  };
  if (b.type === 'limited' || b.type === 'rerun') {
    const bs = s.banners[b.id] || {};
    return { ...base, state: { cum: bs.cum || 0, upObtained: !!bs.upObtained, rush10Available: !!bs.rush10Available, tokensEarned: bs.tokensEarned || 0, pity6: s.limitedTrack.pity6 } };
  }
  if (b.type === 'special') {
    const bs = s.banners[b.id] || {};
    return { ...base, state: { cum: bs.cum || 0, pitySince6: bs.pitySince6 || 0, securityQuota: bs.securityQuota || 0 } };
  }
  if (b.type === 'standard') {
    return { ...base, state: { pity6: s.standard.pity6, totalPulls: s.standard.totalPulls, selectorAvailable: !!s.standard.selectorAvailable, selectorClaimed: !!s.standard.selectorClaimed } };
  }
  if (b.type === 'newbie') {
    return { ...base, state: { pulls: s.newbie.pulls, closed: !!s.newbie.closed } };
  }
  return base;
}

function bannerStatus(b) {
  if (!b.start || !b.end) return 'permanent';
  const now = new Date();
  const start = new Date(b.start + 'T12:00:00+08:00');
  const end = new Date(b.end + 'T23:59:59+08:00');
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'active';
}

function stateView(opts = {}) {
  const s = state.load();
  const d = getData();
  // 干员库存视图（合并图鉴信息）
  const inventory = {};
  for (const [name, rec] of Object.entries(s.inventory)) {
    const op = d.opByName.get(name);
    inventory[name] = {
      count: rec.count, tokens: rec.tokens,
      potential: 1 + (rec.count - 1) + rec.tokens,
      rarity: op ? op.rarity : null,
      profession: op ? op.profession : null,
      limited: op ? op.limited : null
    };
  }
  const view = {
    ...s,
    luck: state.luckAnalysis(s),
    inventoryView: inventory,
    weaponQuota: s.weaponQuota,
    expectedAvgPerGold: 49.1
  };
  // 模拟器欧非百分位：对角色池总抽数做同机制蒙特卡洛，统计六星数百分位（越高越欧）。
  // 固定种子可复现；试验数按抽数预算控制在 <50ms；无出金（hasData=false）为 null。
  try {
    if (view.luck && view.luck.hasData && view.luck.charPulls > 0) {
      view.luck.percentile = sixCountPercentile(view.luck.charPulls, view.luck.golds);
    } else if (view.luck) {
      view.luck.percentile = null;
    }
  } catch { view.luck.percentile = null; } // 模拟异常不拖垮 state 响应
  // 轻量模式：抽卡等高频响应去掉大体量数组（历史与六星记录），统计页会单独全量拉取
  if (opts.light) {
    view.history = undefined;
    view.stats = { ...s.stats, goldRecords: undefined, goldCount: (s.stats.goldRecords || []).length };
  }
  return view;
}

async function handleApi(req, res, url) {
  const d = getData();
  const route = url.pathname.replace(/\/+$/, '');
  const method = req.method;

  if (route === '/api/meta' && method === 'GET') {
    return sendJson(res, 200, {
      game: d.versions,
      rules: d.rules,
      economy: d.economy,
      versions: d.versions,
      lastSync: (d.overlay && d.overlay.lastSync) || null,
      assumptions: [
        '十连保底5星+（官方对加急十连的措辞，普通十连按同一机制实现）',
        '非UP六星的50%在池内其余七名六星间均分',
        '基础寻访软保底与限定池同结构',
        '武器池180抽后里程碑奖励每80抽交替（gamekee口径）',
        '辉光庆典特殊池每抽概率未公示，按0.8%+第10抽强制六星建模',
        '小额充值档位源石数为推算值'
      ],
      sourcesFile: 'data/SOURCES.md'
    });
  }

  if (route === '/api/banners/refresh' && method === 'POST') {
    try {
      const r = await updater.sync();
      const d2 = getData();
      return sendJson(res, 200, { ok: r.ok, result: r, banners: d2.allBanners.map(bannerView) });
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message });
    }
  }

  if (route === '/api/images' && method === 'GET') {
    return sendJson(res, 200, d.images || { operators: {} });
  }

  // 图片代理：/api/img?name=祀&kind=operator —— 远端拉取一次后磁盘缓存，加速二次加载并支持离线
  const mImg = route === '/api/img' && method === 'GET';
  if (mImg) {
    const name = url.searchParams.get('name') || '';
    const kind = url.searchParams.get('kind') === 'weapon' ? 'weapons' : 'operators';
    const map = (d.images && d.images[kind]) || {};
    const target = map[name];
    if (!target) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('no image'); }
    const cacheDir = path.join(__dirname, 'data', 'imgcache', kind);
    const safe = name.replace(/[\\/:*?"<>|]/g, '_');
    const cacheFile = path.join(cacheDir, safe + '.avif');
    const serveBuf = (buf) => {
      const etag = 'W/"' + buf.length + '-' + crypto.createHash('md5').update(safe).digest('hex').slice(0, 10) + '"';
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }
      res.writeHead(200, { 'Content-Type': 'image/avif', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400', ETag: etag, 'Access-Control-Allow-Origin': '*' });
      res.end(buf);
    };
    const sendFile = (p) => {
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(500); return res.end('cache read error'); }
        serveBuf(buf);
      });
    };
    if (fs.existsSync(cacheFile)) return sendFile(cacheFile);
    httpsGet(target).then(buf => {
      fs.mkdir(cacheDir, { recursive: true }, () => {
        try { fs.writeFileSync(cacheFile, buf); } catch { /* 磁盘缓存失败不影响返回 */ }
      });
      serveBuf(buf);
    }).catch(() => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('remote fetch failed');
    });
    return;
  }

  if (route === '/api/banners' && method === 'GET') {
    return sendJson(res, 200, { banners: d.allBanners.map(bannerView) });
  }

  const mBanner = route.match(/^\/api\/banners\/([\w-]+)$/);
  if (mBanner && method === 'GET') {
    const b = d.bannerById.get(mBanner[1]);
    if (!b) return sendJson(res, 404, { error: '未找到卡池' });
    return sendJson(res, 200, { banner: bannerView(b) });
  }

  if (route === '/api/state' && method === 'GET') {
    return sendJson(res, 200, stateView());
  }

  if (route === '/api/reset' && method === 'POST') {
    state.reset();
    return sendJson(res, 200, { ok: true, state: stateView() });
  }

  if (route === '/api/history' && method === 'GET') {
    const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50));
    const s = state.load();
    return sendJson(res, 200, { history: s.history.slice(0, limit), total: s.history.length });
  }

  // 模拟器抽卡历史导出（CSV，前置 BOM；列：time,banner,name,rarity,up,isRush,pity）
  if (route === '/api/history/export' && method === 'GET') {
    const s = state.load();
    const rows = [];
    for (const h of [...s.history].reverse()) { // 存档为最新在前，导出按时间正序
      for (const it of (h.items || [])) {
        const mode = it.mode || h.mode || '';
        rows.push([
          it.ts || h.ts || '',
          h.bannerName || h.bannerId || '',
          it.name,
          it.rarity,
          it.rarity === 6 ? (it.isUp ? 1 : 0) : '',   // up 仅六星行判定
          mode === 'rush' ? 1 : 0,                    // isRush 取记录上的 mode（加急招募十连）
          it.rarity === 6 && it.pity != null ? it.pity : '' // 6 星花费抽数，其余留空
        ]);
      }
    }
    const body = toCsv(['time', 'banner', 'name', 'rarity', 'up', 'isRush', 'pity'], rows);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sim-history.csv"',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(body)
    });
    return res.end(body);
  }

  if (route === '/api/pull' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const times = body.times === 1 ? 1 : 10;
      const result = engine.pull(state.load(), body.bannerId, {
        times, mode: body.mode || 'normal', seed: body.seed, payWithQuota: !!body.payWithQuota
      });
      state.save(state.load());
      const banner = getData().bannerById.get(body.bannerId);
      return sendJson(res, 200, {
        ok: true, ...result,
        banner: banner ? bannerView(banner) : null,
        state: stateView({ light: true })
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (route === '/api/selector/claim' && method === 'POST') {
    const s = state.load();
    if (!s.standard.selectorAvailable || s.standard.selectorClaimed) {
      return sendJson(res, 400, { error: '当前不可领取基础寻访300抽自选' });
    }
    let body;
    try { body = await readBody(req); } catch { body = {}; }
    const d2 = getData();
    const name = body.name;
    if (!name || !d2.charBanners.find(b => b.id === 'c_std').pool6.includes(name)) {
      return sendJson(res, 400, { error: '请从五名常驻六星中选择一位' });
    }
    s.standard.selectorClaimed = true;
    const inv = s.inventory[name] || (s.inventory[name] = { count: 0, tokens: 0 });
    inv.count += 1;
    state.save(s);
    const banner = getData().bannerById.get('c_std');
    return sendJson(res, 200, { ok: true, picked: name, banner: bannerView(banner), state: stateView({ light: true }) });
  }

  if (route === '/api/simulate' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const trials = Math.min(500000, Math.max(1000, body.trials || 100000));
      const banner = d.bannerById.get(body.bannerId);
      let result;
      if (!banner) throw new Error('未找到卡池');
      if (banner.category === 'weapon') {
        result = simulateWeapon(body.bannerId, { trials, init: body.init || {}, seed: body.seed });
      } else {
        result = simulateCharacter(body.bannerId, { target: body.target || 'up', trials, init: body.init || {}, seed: body.seed });
      }
      const econ = d.economy;
      const jade = result.mean * econ.currency.jadePerPull;
      return sendJson(res, 200, {
        ok: true, bannerId: body.bannerId, target: body.target || 'up', ...result,
        cost: {
          meanPulls: result.mean,
          jade: Math.round(jade),
          originium: +(jade / econ.currency.jadePerOriginium).toFixed(1),
          cnyBase: +(jade / econ.currency.jadePerPull / 0.15 / 280 * 648).toFixed(0), // 近似：基础档
          cnyNonFirst: +(jade / econ.currency.jadePerPull / 0.15 / 350 * 648).toFixed(0),
          cnyFirst: +(jade / econ.currency.jadePerPull / 0.15 / 560 * 648).toFixed(0)
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (route === '/api/operators' && method === 'GET') {
    return sendJson(res, 200, { operators: d.operators });
  }
  const mOp = route.match(/^\/api\/operators\/(.+)$/);
  if (mOp && method === 'GET') {
    const name = decodeURIComponent(mOp[1]);
    const op = d.opByName.get(name);
    if (!op) return sendJson(res, 404, { error: '未找到干员' });
    const build = d.builds.builds.find(b => b.operator === name) || null;
    const banners = d.allBanners.filter(b => b.up6 === name || (b.pool6 || []).includes(name)).map(b => ({ id: b.id, name: b.name, version: b.version }));
    const s = state.load();
    const inv = s.inventory[name] || null;
    return sendJson(res, 200, { operator: op, build, banners, owned: inv ? { count: inv.count, tokens: inv.tokens, potential: 1 + (inv.count - 1) + inv.tokens } : null });
  }

  if (route === '/api/weapons' && method === 'GET') {
    return sendJson(res, 200, { weapons: d.weapons, standardPool: d.standardWeaponPool });
  }

  if (route === '/hglog' && method === 'POST') {
    try {
      const buf = await readBodyRaw(req);
      console.log('[hglogin]', buf.toString('utf8').slice(0, 400));
    } catch { /* 忽略 */ }
    res.writeHead(204);
    return res.end();
  }

  /* ================= 官方登录页中转（弹窗内打开，凭据直发官方，仅捕获响应令牌） ================= */
  if (route === '/hglogin' && method === 'GET') {
    try {
      let html = await httpsGetText('https://user.hypergryph.com/');
      // 静态资源改走"带正文重写"的中转（懒加载分片需要同源，否则被 CORS 拦截）
      html = html.replace(/(src|href)="https:\/\/web\.hycdn\.cn\/([^"]+)"/g, '$1="/hgrj?u=https%3A%2F%2Fweb.hycdn.cn%2F$2"');
      const injected = url.searchParams.get('bare') === '1'
        ? ''
        : `<script>${HG_LOGIN_HOOK}</script>`;
      const out = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(out);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('官方登录页中转失败：' + e.message);
    }
  }

  // 带正文重写的中转：JS/CSS 内部的 CDN 前缀改写为本机中转地址，使懒加载分片/字体同源可达
  if (route === '/hgrj' && (method === 'GET' || method === 'POST')) {
    const target = url.searchParams.get('u') || '';
    if (!isAllowedRelayTarget(target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('relay target not allowed');
    }
    try {
      const { status, headers, buf } = await relayRequest(target, 'GET', req, null);
      const ct = headers['content-type'] || '';
      let body = buf;
      if (/javascript|css/.test(ct) || body[0] === 0x1f) {
        // 上游可能强制压缩（gzip/br）：先解压再改写，避免按 UTF-8 解码二进制造成损坏
        let raw = buf;
        const ce = String(headers['content-encoding'] || '').toLowerCase();
        try {
          if (ce.includes('br') || (buf[0] === 0x1f && false)) raw = zlib.brotliDecompressSync(buf);
          else if (ce.includes('gzip') || (buf[0] === 0x1f && buf[1] === 0x8b)) raw = zlib.gunzipSync(buf);
          else if (ce.includes('deflate')) raw = zlib.inflateSync(buf);
        } catch (e) {
          // 解压失败且响应头未标明编码：按 gzip 再试一次
          try { raw = zlib.gunzipSync(buf); } catch (e2) { raw = buf; }
        }
        let text = raw.toString('utf8');
        // 若解压后仍是二进制（魔数），说明内容本就是二进制，原样返回
        if (raw[0] === 0x1f || raw.includes('\u0000')) {
          body = buf;
        } else {
          text = text.replace(/https:\/\/web\.hycdn\.cn/g, '/hgrj?u=https%3A%2F%2Fweb.hycdn.cn');
          text = text.replace(/https:\/\/(user|as|[a-z\-]+)\.hypergryph\.com/g, function (m) {
            return '/hgr?u=' + encodeURIComponent(m);
          });
          body = Buffer.from(text, 'utf8');
        }
      }
      const h = { 'Content-Type': ct || 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
      res.writeHead(status === 200 ? 200 : status, h);
      return res.end(body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('中转失败：' + e.message);
    }
  }

  if (route === '/hgr' && (method === 'GET' || method === 'POST' || method === 'PUT')) {
    const target = url.searchParams.get('u') || '';
    if (!isAllowedRelayTarget(target)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('relay target not allowed');
    }
    // 读取请求体转发
    let reqBody = null;
    if (method !== 'GET') {
      try { reqBody = await readBodyRaw(req); } catch { reqBody = null; }
    }
    relayRequest(target, method, req, reqBody).then(({ status, headers, buf }) => {
      const h = {};
      for (const k of ['content-type', 'cache-control']) if (headers[k]) h[k] = headers[k];
      h['Access-Control-Allow-Origin'] = '*';
      res.writeHead(status, h);
      res.end(buf);
    }).catch(e => {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('中转失败：' + e.message);
    });
    return;
  }

  if (route === '/api/official/capture' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (body && body.token) {
      officialAuth.loginToken = String(body.token);
      officialAuth.oauthToken = null;
      if (body.remember) officialStore.saveAuth({ loginToken: body.token, savedAt: new Date().toISOString() });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { error: 'no token' });
  }

  if (route === '/api/official/roles' && method === 'GET') {
    // 登录成功后由前端调用：grant + binding_list
    try {
      const oauth = await ensureOauthToken();
      const bindings = await hgApi.bindingList(oauth) || {};
      const roles = (bindings.list || bindings || []).map(b => ({
        uid: String(b.uid), nickName: b.nickName, serverId: b.serverId, serverName: b.serverName, channelName: b.channelName
      }));
      officialAuth.roles = roles;
      if (roles.length === 1) officialAuth.uid = roles[0].uid;
      return sendJson(res, 200, { ok: true, roles });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  /* ================= 官方数据中转 ================= */
  if (route === '/api/official/status' && method === 'GET') {
    const recs = officialStore.loadRecords();
    return sendJson(res, 200, {
      authed: !!(officialAuth.oauthToken || officialAuth.loginToken || (officialStore.loadAuth() || {}).loginToken),
      remembered: !!(officialStore.loadAuth() || {}).loginToken,
      roles: officialAuth.roles || [],
      uid: officialAuth.uid,
      records: Object.entries(recs.accounts || {}).map(([uid, a]) => ({
        uid, updatedAt: a.updatedAt, char: (a.char || []).length, weapon: (a.weapon || []).length
      }))
    });
  }

  if (route === '/api/official/login' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const loginToken = await hgApi.login(String(body.account || ''), String(body.password || ''));
      const roles = await finishLogin(loginToken, !!body.remember);
      return sendJson(res, 200, { ok: true, roles, note: '账号密码仅本机内存直转官方服务器，未存储' });
    } catch (e) {
      return sendJson(res, 400, { error: '官方登录失败：' + e.message });
    }
  }

  /* ================= 短信验证码登录 / 扫码登录（官方 as.hypergryph.com 直连，凭据仅内存直转） ================= */
  if (route === '/api/official/sms_send' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const phone = String(body.phone || '').trim();
    if (!hgApi.isValidPhone(phone)) return sendJson(res, 400, { ok: false, error: '请输入 11 位中国大陆手机号' });
    const last = smsSentAt.get(phone) || 0;
    const waitSec = Math.ceil((SMS_RESEND_MS - (Date.now() - last)) / 1000);
    if (waitSec > 0) return sendJson(res, 200, { ok: false, msg: `发送过于频繁，请 ${waitSec} 秒后再试` });
    try {
      await hgApi.sendSmsCode(phone);
      smsSentAt.set(phone, Date.now());
      return sendJson(res, 200, { ok: true, msg: '短信验证码已发送，请查收' });
    } catch (e) {
      return sendJson(res, 200, { ok: false, msg: '官方发码失败：' + e.message, error: '官方发码失败：' + e.message });
    }
  }

  if (route === '/api/official/sms_login' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    const phone = String(body.phone || '').trim();
    const code = String(body.code || '').trim();
    if (!hgApi.isValidPhone(phone)) return sendJson(res, 400, { error: '请输入 11 位中国大陆手机号' });
    if (!/^\d{4,6}$/.test(code)) return sendJson(res, 400, { error: '请输入短信验证码' });
    try {
      const loginToken = await hgApi.loginByPhoneCode(phone, code);
      const roles = await finishLogin(loginToken, !!body.remember);
      return sendJson(res, 200, { ok: true, roles, note: '短信验证码仅本机内存直转官方服务器，未存储' });
    } catch (e) {
      return sendJson(res, 400, { error: '官方登录失败：' + e.message });
    }
  }

  if (route === '/api/official/qr_create' && method === 'POST') {
    try {
      const s = await hgApi.createScanLogin();
      // qrText 为官方返回的二维码原始内容（hypergryph://scan_login?scanId=...）原样透传；expires 为本地过期时间戳(ms)
      return sendJson(res, 200, { ok: true, scanId: s.scanId, qrText: s.qrText, expires: s.expires });
    } catch (e) {
      return sendJson(res, 400, { error: '创建扫码登录失败：' + e.message });
    }
  }

  if (route === '/api/official/qr_status' && method === 'GET') {
    const scanId = (url.searchParams.get('scanId') || '').trim();
    if (!scanId) return sendJson(res, 400, { error: '缺少 scanId' });
    try {
      const r = await hgApi.pollScanStatus(scanId);
      if (r.status === 'confirmed') {
        if (!r.scanCode) return sendJson(res, 200, { status: 'error', msg: '扫码已确认但官方未返回 scanCode（响应结构变更）' });
        // 已确认：自动完成 scanCode → 登录 token → 授权 → 角色列表（scanCode 只经内存直转官方，不落盘不回传）
        try {
          const loginToken = await hgApi.tokenByScanCode(r.scanCode);
          const roles = await finishLogin(loginToken, false);
          return sendJson(res, 200, { status: 'confirmed', ok: true, roles, note: '扫码登录成功' });
        } catch (e) {
          return sendJson(res, 200, { status: 'error', msg: '扫码换取令牌失败：' + e.message });
        }
      }
      const out = { status: r.status };
      if (r.status === 'pending') out.msg = '等待手机端扫码确认';
      else if (r.status === 'expired') out.msg = '二维码已过期，请刷新重试';
      else out.msg = '扫码状态异常（官方 status=' + r.raw + '）';
      return sendJson(res, 200, out);
    } catch (e) {
      return sendJson(res, 200, { status: 'error', msg: '查询扫码状态失败：' + e.message });
    }
  }

  if (route === '/api/official/logout' && method === 'POST') {
    officialAuth = { loginToken: null, oauthToken: null, roles: [], uid: null };
    officialStore.clearAuth();
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/official/sync' && method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    let uid = String(body.uid || officialAuth.uid || '');
    if (!uid) {
      // 仅凭记住的令牌进入（重启后）：拉角色列表补齐 uid
      try {
        const oauth = await ensureOauthToken();
        const b = await hgApi.bindingList(oauth);
        const list = (b && b.list) || [];
        officialAuth.roles = list.map(r => ({ uid: r.uid, nickName: r.nickName, serverId: r.serverId, serverName: r.serverName, channelName: r.channelName }));
        if (list.length === 1) officialAuth.uid = list[0].uid;
      } catch (e) {
        if (e.code === 401) return sendJson(res, 401, { error: e.message });
        return sendJson(res, 400, { error: '同步失败：' + e.message });
      }
      uid = String(officialAuth.uid || '');
    }
    if (!uid) return sendJson(res, 400, { error: '检测到多个角色，请先在角色列表中选择' });
    try {
      const oauth = await ensureOauthToken();
      const role = (officialAuth.roles || []).find(r => r.uid === uid);
      const u8 = await hgApi.u8TokenByUid(uid, oauth);
      const store = officialStore.loadRecords();
      const progress = [];
      // 角色池：meta 拿 pool_type 列表
      const meta = await hgApi.charMeta(u8);
      const tabs = (meta && meta.tabs) || [];
      for (const t of tabs) {
        const recs = await hgApi.fetchAllPages((seq) => hgApi.charRecords(u8, t.poolType || t.key, seq));
        const added = officialStore.mergeRecords(store, uid, 'char', recs);
        progress.push({ pool: t.label || t.key, count: recs.length, added });
      }
      // 武器池：先池列表再逐池
      const wpools = (await hgApi.weaponPools(u8)) || [];
      for (const p of wpools) {
        const recs = await hgApi.fetchAllPages((seq) => hgApi.weaponRecords(u8, p.poolId, seq));
        const added = officialStore.mergeRecords(store, uid, 'weapon', recs);
        progress.push({ pool: p.poolName || p.poolId, count: recs.length, added });
      }
      officialStore.saveRecords(store);
      officialAuth.uid = uid;
      const result = analyze(uid, store.accounts[uid]);
      return sendJson(res, 200, { ok: true, uid, role, progress, analysis: result });
    } catch (e) {
      if (e.code === 401) return sendJson(res, 401, { error: e.message });
      return sendJson(res, 400, { error: '同步失败：' + e.message });
    }
  }

  const mOfUid = route.match(/^\/api\/official\/(analysis|predict)$/);
  if (mOfUid && method === 'GET' || mOfUid && method === 'POST') {
    let uid = url.searchParams.get('uid');
    const store = officialStore.loadRecords();
    if (!uid) uid = Object.keys(store.accounts || [])[0] || (officialAuth.uid || '');
    const acc = store.accounts && store.accounts[uid];
    if (!acc) return sendJson(res, 404, { error: '尚无官方记录，请先同步' });
    if (mOfUid[1] === 'analysis') return sendJson(res, 200, { uid, analysis: analyze(uid, acc) });
    const result = analyze(uid, acc);
    return sendJson(res, 200, { uid, analysis: result, prediction: predict(result, acc) });
  }

  // 官方缓存记录导出（CSV，前置 BOM；列：time,pool,name,rarity,up,isFree,type）
  if (route === '/api/official/export' && method === 'GET') {
    const store = officialStore.loadRecords();
    let uid = url.searchParams.get('uid');
    if (!uid) uid = Object.keys(store.accounts || {})[0] || (officialAuth.uid || '');
    const acc = store.accounts && store.accounts[uid];
    if (!acc) return sendJson(res, 404, { error: '尚无官方记录，请先同步' });
    let body;
    try { body = officialRecordsCsv(acc); }
    catch (e) { return sendJson(res, 500, { error: '导出失败：' + e.message }); }
    const safeUid = String(uid).replace(/[^\w.-]/g, '') || 'unknown';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="official-records-${safeUid}.csv"`,
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(body)
    });
    return res.end(body);
  }

  /* ================= 官方数据中转 end ================= */

  if (route === '/api/economy' && method === 'GET') {
    return sendJson(res, 200, d.economy);
  }

  if (route === '/api/matrices' && method === 'GET') {
    return sendJson(res, 200, d.matrices);
  }
  if (route === '/api/materials' && method === 'GET') {
    return sendJson(res, 200, d.materials);
  }
  if (route === '/api/builds' && method === 'GET') {
    return sendJson(res, 200, d.builds);
  }

  /* ================= 本机服务关闭（页面「关闭服务」按钮 / stop.bat 之外的直连方式） ================= */
  if (route === '/api/shutdown' && method === 'POST') {
    sendJson(res, 200, { ok: true, msg: '服务已关闭，可关闭此页面' });
    console.log('[shutdown] 收到关闭请求，服务退出。重新使用请运行 start.bat');
    setTimeout(() => process.exit(0), 150); // 等响应刷出再退出
    return;
  }

  return sendJson(res, 404, { error: `未知接口: ${method} ${route}` });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  // 官方用户中心的内部路由（如 /login?redirect=...）：我们自己的前端是 # 哈希路由，
  // 无扩展名路径一律交还给官方页中转，避免被本地 SPA 回退拦截
  if (!path.extname(p) && p !== '/index.html') {
    const q = url.search || '';
    req.url = '/hglogin' + (q ? q : '');
    return handleApi(req, res, new URL(req.url, `http://127.0.0.1:${PORT}`));
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, p));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA 回退到 index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('前端未生成，请先运行前端构建'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(idx);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (process.env.HG_DEBUG) {
    if (url.pathname.startsWith('/hgr') || url.pathname === '/hglogin' || (!url.pathname.startsWith('/api/') && url.pathname !== '/' && !path.extname(url.pathname))) {
      console.log('[req]', req.method, url.pathname + (url.search || ''));
    }
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/hglogin' || url.pathname === '/hgr' || url.pathname === '/hgrj' || url.pathname === '/hglog') {
    try {
      await handleApi(req, res, url);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }
  serveStatic(req, res, url);
});

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    if (process.platform === 'win32') exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch { /* 打开失败不影响服务 */ }
}

/** https GET 到 Buffer（图片代理用） */
function httpsGet(u, redirects) {
  return new Promise((resolve, reject) => {
    if ((redirects || 0) > 3) return reject(new Error('too many redirects'));
    try {
      const req = https.request(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EndfieldGachaSim/1.0' }, timeout: 20000 }, (rs) => {
        if ([301, 302, 303, 307, 308].includes(rs.statusCode) && rs.headers.location) {
          rs.resume();
          const next = new URL(rs.headers.location, u).href;
          return httpsGet(next, (redirects || 0) + 1).then(resolve, reject);
        }
        const chunks = [];
        rs.on('data', c => { chunks.push(c); if (chunks.reduce((a, b) => a + b.length, 0) > 15 * 1024 * 1024) { req.destroy(); reject(new Error('image too large')); } });
        rs.on('end', () => resolve(Buffer.concat(chunks)));
        rs.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      req.end();
    } catch (e) { reject(e); }
  });
}

function httpsGetText(u) { return httpsGet(u).then(b => b.toString('utf8')); }

/** 中转白名单：官方及其登录页依赖的静态/验证码域 */
const RELAY_ALLOW_SUFFIX = ['hypergryph.com', 'gryphline.com', 'hycdn.cn', 'geetest.com', 'gstatic.com'];
function isAllowedRelayTarget(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'https:') return false;
    return RELAY_ALLOW_SUFFIX.some(s => p.hostname === s || p.hostname.endsWith('.' + s));
  } catch { return false; }
}

/** 读取原始请求体（中转转发用） */
function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => { chunks.push(c); if (chunks.reduce((a, b) => a + b.length, 0) > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 转发请求到官方域（带浏览器 UA 与来源页 Referer） */
function relayRequest(target, method, incomingReq, body) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(target);
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': incomingReq.headers['accept'] || '*/*',
        'Accept-Encoding': 'identity',
        'Referer': 'https://user.hypergryph.com/'
      };
      if (incomingReq.headers['content-type']) headers['Content-Type'] = incomingReq.headers['content-type'];
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: 20000 }, (rs) => {
        if ([301, 302, 303, 307, 308].includes(rs.statusCode) && rs.headers.location) {
          rs.resume();
          const next = new URL(rs.headers.location, target).href;
          if (isAllowedRelayTarget(next)) return relayGetToBuf(next, headers).then(buf => resolve({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, buf })).catch(reject);
          rs.resume();
          const chunks = []; rs.on('data', c => chunks.push(c)); rs.on('end', () => resolve({ status: rs.statusCode, headers: rs.headers, buf: Buffer.concat(chunks) }));
          return;
        }
        const chunks = [];
        rs.on('data', c => { chunks.push(c); if (chunks.reduce((a, b) => a + b.length, 0) > 10 * 1024 * 1024) { req.destroy(); reject(new Error('response too large')); } });
        rs.on('end', () => resolve({ status: rs.statusCode, headers: rs.headers, buf: Buffer.concat(chunks) }));
        rs.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (body && body.length) req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

function relayGetToBuf(u, headers) {
  return new Promise((resolve, reject) => {
    const p = new URL(u);
    const req = https.request({ hostname: p.hostname, path: p.pathname + p.search, method: 'GET', headers, timeout: 20000 }, (rs) => {
      const chunks = [];
      rs.on('data', c => chunks.push(c));
      rs.on('end', () => resolve(Buffer.concat(chunks)));
      rs.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/**
 * 注入到中转登录页的脚本：
 * 1) 把运行时对官方域的 XHR/fetch 重写到 /hgr 中转
 * 2) 登录接口响应中出现 token 时回传本地服务（仅令牌，不含凭据）
 */
const HG_LOGIN_HOOK = `
(function () {
  var MODE = parseInt(new URLSearchParams(location.search).get('p') || '0', 10); // 0=全量 1=无fetch包装 2=无XHR包装
  var ORIGINS = ['hypergryph.com', 'gryphline.com', 'hycdn.cn', 'geetest.com', 'gstatic.com'];
  var PAGE_ORIGIN = 'https://user.hypergryph.com';
  function ALLOWED_HOST(host) {
    return ORIGINS.some(function (s) { return host === s || host.slice(-(s.length + 1)) === '.' + s; });
  }
  function absOf(u) { try { return new URL(u, PAGE_ORIGIN).href; } catch (e) { return String(u); } }
  function relayUrl(u) {
    try {
      var s = String(u);
      if (s.indexOf(location.origin) === 0) return null;      // 已是本机绝对地址
      if (/^\\/hgr(j)?\\?/.test(s)) return null;               // 已是中转相对地址（/hgrj 改写产物）
      if (s.charAt(0) === '/') {
        // 官方 SPA 的相对路径 API → 按 PAGE_ORIGIN 解析后中转
        var abs1 = new URL(s, PAGE_ORIGIN).href;
        if (!ALLOWED_HOST(new URL(abs1).hostname)) return null;
        return '/hgr?u=' + encodeURIComponent(abs1);
      }
      if (!/^https?:/.test(s)) return null;
      if (!ALLOWED_HOST(new URL(s).hostname)) return null;
      return '/hgr?u=' + encodeURIComponent(s);
    } catch (e) { return null; }
  }
  function reportToken(data) {
    try {
      var j = (typeof data === 'string') ? JSON.parse(data) : data;
      var token = j && j.data && (j.data.token || (j.data.data && j.data.data.content));
      if (token) navigator.sendBeacon('/api/official/capture', new Blob([JSON.stringify({ token: String(token) })], { type: 'application/json' }));
    } catch (e) {}
  }
  var _open = XMLHttpRequest.prototype.open;
  if (MODE !== 2) {
    XMLHttpRequest.prototype.open = function () {
      var args = arguments;
      var abs = absOf(args[1]);
      var r = relayUrl(args[1]);
      if (r) {
        args[1] = r;
        if (/\\/user\\/auth|login|token/i.test(abs)) {
          var xhrSelf = this;
          this.addEventListener('load', function () {
            reportToken(typeof xhrSelf.response === 'string' ? xhrSelf.response : xhrSelf.response);
          });
        }
      }
      return _open.apply(this, args);
    };
  }
  var _fetch = window.fetch;
  if (_fetch && MODE !== 1) {
    window.fetch = function (input, init) {
      try {
        var u = typeof input === 'string' ? input : (input && input.url);
        if (u) {
          var abs = absOf(u);
          var r = relayUrl(u);
          if (r) {
            var newInput = (typeof input === 'string') ? r : new Request(r, input);
            var p = _fetch.call(window, newInput, init);
            if (/\\/user\\/auth|login|token/i.test(abs)) {
              p.then(function (resp) { resp.clone().text().then(reportToken); });
            }
            return p;
          }
        }
      } catch (e) {}
      return _fetch.apply(window, arguments);
    };
  }
  var bar = document.createElement('div');
  bar.textContent = '⟪ 本页由本机模拟器中转：凭据直接提交官方服务器，仅回传登录令牌 ⟫';
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0b0f1a;color:#f5a623;font:12px/1.8 monospace;padding:3px 10px;text-align:center;pointer-events:none';
  document.addEventListener('DOMContentLoaded', function () { document.body && document.body.appendChild(bar); });

  // 诊断日志：网络结果与未捕获错误回传本机服务端控制台
  window.__hgLog = function (msg) {
    try { navigator.sendBeacon('/hglog', new Blob([String(msg)], { type: 'text/plain' })); } catch (e) {}
  };
  window.addEventListener('error', function (e) { window.__hgLog('JS错误: ' + (e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '')); });
  window.addEventListener('unhandledrejection', function (e) { window.__hgLog('Promise拒绝: ' + ((e.reason && (e.reason.message || e.reason)) + '').slice(0, 300)); });
  var _openLog = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    var xhr = this;
    xhr.addEventListener('loadend', function () {
      try {
        if (xhr.status >= 400 || (xhr.getResponseHeader('content-type') || '').indexOf('json') < 0) {
          var body = '';
          try { body = xhr.responseType === '' || xhr.responseType === 'text' ? (xhr.responseText || '') : JSON.stringify(xhr.response || ''); } catch (e2) { body = '<unreadable>'; }
          window.__hgLog('XHR ' + xhr.status + ' ' + (xhr.__hgUrl || xhr.responseURL || '') + ' -> ' + body.slice(0, 120));
        }
      } catch (e) {}
    });
    return _openLog.apply(xhr, arguments);
  };
})();
`;

if (require.main === module) {
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[提示] 端口 ${PORT} 已被占用——可能已经有一个模拟器实例在运行。`);
      console.log(`请直接在浏览器打开 http://127.0.0.1:${PORT} ，或关闭其他模拟器窗口后重试。`);
      openBrowser(`http://127.0.0.1:${PORT}`);
      process.exit(0);
    }
    console.error('服务器启动失败：', err.message);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`《明日方舟：终末地》抽卡模拟器已启动`);
    console.log(`请用浏览器打开 http://127.0.0.1:${PORT}（即将自动打开，按 Ctrl+C 停止）`);
    console.log(`数据来源与免责声明见 data/SOURCES.md`);
    openBrowser(`http://127.0.0.1:${PORT}`);
    // 启动时后台同步官方最新卡池数据（不阻塞服务）
    updater.sync().then(r => {
      if (r.ok) console.log(`[updater] 官方数据同步完成：${r.articleCount} 篇公告，角色池 ${r.charBanners} 条、武器池 ${r.wpnBanners} 条${r.newCharBanners ? `，新增 ${r.newCharBanners} 个新卡池` : ''}`);
      else console.log(`[updater] 同步失败（离线或接口变更，继续使用本地数据）：${r.error}`);
    }).catch(e => console.log(`[updater] 异常：${e.message}`));
  });
}

module.exports = { server, handleApi };
