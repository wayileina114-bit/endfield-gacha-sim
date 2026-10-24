// test-apk-parity.js - run the APK offline runtime (runtime-shim.js) inside Node
// and compare its API responses with the live desktop server. Same engine + same
// data files must produce structurally identical API output.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHIM = path.join(ROOT, 'android', 'assets', 'www', 'js', 'runtime-shim.js');
const SERVER = 'http://127.0.0.1:3377';

/* ---- browser-ish globals ---- */
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k)
};
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement() { return { click() {}, remove() {}, style: {}, setAttribute() {} }; },
  body: { appendChild() {} }
};

eval(fs.readFileSync(SHIM, 'utf8')); // defines window.__APP_RUNTIME__ + wraps fetch

const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : '')); }

async function getJson(url) { const r = await fetch(url); return { status: r.status, body: await r.json() }; }
async function postJson(url, obj) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) }); return { status: r.status, body: await r.json() }; }

/** deep-compare with numeric tolerance + key-order independence + optional skip keys */
function similar(a, b, skip, pathStr) {
  skip = skip || []; pathStr = pathStr || '$';
  if (skip.some(k => pathStr === '$.' + k || pathStr.endsWith('.' + k))) return true;
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return String(a) + '|' + String(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => similar(v, b[i], skip, pathStr + '[' + i + ']'));
  const ka = Object.keys(a).filter(k => a[k] !== undefined);
  const kb = Object.keys(b).filter(k => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && similar(a[k], b[k], skip, pathStr + '.' + k));
}

function stripVolatile(o) { // createdAt/时间戳类字段克隆剔除
  if (Array.isArray(o)) return o.map(stripVolatile);
  if (o && typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) {
      if (/^(createdAt|updatedAt|ts|lastSync|time)$/i.test(k)) continue;
      out[k] = stripVolatile(o[k]);
    }
    return out;
  }
  return o;
}

(async () => {
  const R = window.__APP_RUNTIME__;
  await R.init();

  /* ---- 静态数据类：逐接口与桌面服务端结构对账 ---- */
  for (const ep of ['/api/meta', '/api/banners', '/api/images', '/api/operators', '/api/weapons', '/api/matrices', '/api/materials', '/api/builds', '/api/economy', '/api/official/status']) {
    const [apk, srv] = await Promise.all([getJson(ep), getJson(SERVER + ep)]);
    const ok = apk.status === srv.status && similar(stripVolatile(apk.body), stripVolatile(srv.body));
    check('GET ' + ep, ok, ok ? '' : 'status ' + apk.status + '/' + srv.status + ' 或字段不一致');
  }

  /* ---- 空存档 state 对账 ---- */
  {
    const [apk, srv] = await Promise.all([getJson('/api/state'), getJson(SERVER + '/api/state')]);
    const ok = apk.status === 200 && similar(stripVolatile(apk.body), stripVolatile(srv.body));
    check('GET /api/state (空存档)', ok, ok ? '' : JSON.stringify(apk.body).slice(0, 200) + ' vs ' + JSON.stringify(srv.body).slice(0, 200));
  }

  /* ---- 抽卡：形状与计数对账（RNG 不同，只比结构） ---- */
  const bannersResp = await getJson('/api/banners');
  const limited = bannersResp.body.banners.find(b => b.category === 'character' && (b.type === 'limited' || b.type === 'rerun'));
  {
    const [apk, srv] = await Promise.all([
      postJson('/api/pull', { bannerId: limited.id, times: 10 }),
      postJson(SERVER + '/api/pull', { bannerId: limited.id, times: 10 })
    ]);
    const shapeOk = apk.status === 200 && srv.status === 200
      && apk.body.items && apk.body.items.length === 10
      && apk.body.banner && apk.body.banner.id === limited.id
      && apk.body.state && apk.body.state.stats && apk.body.state.stats.goldCount !== undefined
      && similar(Object.keys(apk.body).sort(), Object.keys(srv.body).sort());
    check('POST /api/pull (十连)', shapeOk, shapeOk ? 'items=10, 键集合一致' : '键或结构不一致');
  }

  /* ---- 模拟对账 ---- */
  {
    const [apk, srv] = await Promise.all([
      postJson('/api/simulate', { bannerId: limited.id, target: 'up', trials: 3000, seed: 42 }),
      postJson(SERVER + '/api/simulate', { bannerId: limited.id, target: 'up', trials: 3000, seed: 42 })
    ]);
    const ok = apk.status === 200 && similar(Object.keys(apk.body).sort(), Object.keys(srv.body).sort())
      && apk.body.mean > 0 && apk.body.cost && apk.body.cost.jade > 0 && apk.body.cost.cnyFirst > 0;
    check('POST /api/simulate (种子 42)', ok, ok ? 'mean=' + apk.body.mean : '');
  }

  /* ---- 历史导出对账：行数 = 已抽抽数 + 表头 ---- */
  {
    const [a, s] = await Promise.all([fetch('/api/history/export'), fetch(SERVER + '/api/history/export')]);
    const aTxt = await a.text(); const sTxt = await s.text();
    const aRows = aTxt.split('\r\n').filter(x => x).length;
    const sRows = sTxt.split('\r\n').filter(x => x).length;
    check('GET /api/history/export', a.status === 200 && aTxt.charCodeAt(0) === 0xFEFF && aRows === sRows,
      `apk=${aRows}行 server=${sRows}行 BOM=${aTxt.charCodeAt(0) === 0xFEFF}`);
  }

  /* ---- reset 与 official 存根 ---- */
  {
    const r = await postJson('/api/reset');
    const st = await getJson('/api/state');
    check('POST /api/reset', r.status === 200 && r.body.ok && st.body.stats.totalPulls === 0);
    const login = await postJson('/api/official/login', { account: 'x', password: 'y' });
    check('POST /api/official/* 存根', login.status === 200 && login.body.ok === false && /桌面版/.test(login.body.msg || ''));
  }

  const fails = results.filter(r => !r.ok);
  console.log(`\n== parity: ${results.length - fails.length}/${results.length} passed ==`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
