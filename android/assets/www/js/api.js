/**
 * api.js — fetch 封装 + localStorage 缓存（/api/banners 与 /api/images，10 分钟）
 * 全部使用相对路径 /api/...，非 2xx 抛 Error(message)（服务端错误形如 {"error":"..."}）
 */
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_PREFIX = 'zmd_cache_';

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.ts !== 'number') return null;
    if (Date.now() - obj.ts > CACHE_TTL) return null; // 过期
    return obj.data;
  } catch { return null; }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* 隐私模式等场景忽略 */ }
}

export function cacheClear(key) {
  try { localStorage.removeItem(CACHE_PREFIX + key); } catch { /* noop */ }
}

async function request(path, options = {}) {
  let resp;
  try {
    resp = await fetch(path, options);
  } catch (e) {
    throw new Error('网络请求失败：' + (e && e.message ? e.message : '无法连接服务器'));
  }
  let body = null;
  try { body = await resp.json(); } catch { /* 非 JSON 响应 */ }
  if (!resp.ok) {
    const msg = (body && body.error) ? body.error : `请求失败（HTTP ${resp.status}）`;
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return body;
}

function get(path, { cache = false, force = false } = {}) {
  if (cache && !force) {
    const hit = cacheGet(path);
    if (hit) return Promise.resolve(hit);
  }
  return request(path).then(data => {
    if (cache) cacheSet(path, data);
    return data;
  });
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
}

/** 官方登录类轻量 POST：兼容两种错误形状——
 *  HTTP 4xx {error}（request 已处理）与 HTTP 200 {ok:false,msg}（官方发码失败等，此处转为异常） */
async function postOfficial(path, body) {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let j = null;
  try { j = await resp.json(); } catch { /* 非 JSON 响应 */ }
  if (!resp.ok) throw new Error((j && (j.error || j.msg)) || `请求失败（HTTP ${resp.status}）`);
  if (j && j.ok === false) throw new Error(j.msg || j.error || '操作失败');
  return j || {};
}

export const API = {
  meta: (force) => get('/api/meta', { force }),
  banners: (force) => get('/api/banners', { cache: true, force }),
  images: (force) => get('/api/images', { cache: true, force }),
  banner: (id) => get(`/api/banners/${encodeURIComponent(id)}`),
  state: () => get('/api/state'),
  history: (limit = 50) => get(`/api/history?limit=${limit}`),
  pull: (body) => post('/api/pull', body),
  simulate: (body) => post('/api/simulate', body),
  reset: () => post('/api/reset', {}),
  refresh: () => post('/api/banners/refresh', {}),
  claimSelector: (name) => post('/api/selector/claim', { name }),
  operators: (force) => get('/api/operators', { cache: true, force }),
  operator: (name) => get(`/api/operators/${encodeURIComponent(name)}`),
  weapons: () => get('/api/weapons'),
  matrices: () => get('/api/matrices'),
  materials: () => get('/api/materials'),
  builds: () => get('/api/builds'),
  officialStatus: () => get('/api/official/status'),
  officialLogin: (body) => post('/api/official/login', body),
  officialLogout: () => post('/api/official/logout', {}),
  officialSync: (uid) => post('/api/official/sync', { uid }),
  officialPredict: (uid) => get(`/api/official/predict?uid=${encodeURIComponent(uid || '')}`),
  officialSmsSend: (phone) => postOfficial('/api/official/sms_send', { phone }),
  officialSmsLogin: (phone, code, remember) => postOfficial('/api/official/sms_login', { phone, code, remember }),
  officialQrCreate: () => postOfficial('/api/official/qr_create', {}),
  officialQrStatus: (scanId) => get(`/api/official/qr_status?scanId=${encodeURIComponent(scanId)}`)
};
