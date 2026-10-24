/* apk-official.js — APK 端官方账号链路（内嵌进 runtime-shim.js）。
 * 忠实移植 src/official/hg-api.js + store.js 的端点与语义；HTTP 经原生网络桥
 * （AndroidBridge：可自定义 Origin/Referer/UA，白名单仅鹰角域名）。
 * 凭据只在内存直转官方；勾选「记住登录态」时仅本地保存长时效令牌（对齐桌面版语义）。
 * 依赖：req('analyze')（分析/预测）、_d（dataloader 数据）。 */
var OFFICIAL = (function () {
  'use strict';
  var AS = 'https://as.hypergryph.com';
  var APP_CODE = 'be36d44aa36bfb5b';
  var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  var EF = 'https://ef-webview.hypergryph.com';
  var EF_REFERER = EF + '/page/gacha_char?server_id=1';
  var AS_HEADERS = {
    'User-Agent': UA, 'Content-Type': 'application/json',
    'Origin': 'https://user.hypergryph.com', 'Referer': 'https://user.hypergryph.com/'
  };
  var SCAN_TTL_MS = 120 * 1000;
  var AUTH_KEY = 'zmd_apk_official_auth_v1';
  var REC_KEY = 'zmd_apk_official_records_v1';

  /* ---- 原生网络桥 ---- */
  var _seq = 0, _wait = {};
  window.__bridgeDispatch = function (id, resp) {
    var w = _wait[id];
    if (w) { delete _wait[id]; w(resp); }
  };
  function bridgeHttp(method, url, headers, body, timeout) {
    return new Promise(function (resolve, reject) {
      if (!globalThis.AndroidBridge) { reject(new Error('原生网络桥不可用')); return; }
      var id = 'b' + (++_seq);
      _wait[id] = resolve;
      globalThis.AndroidBridge.http(id, method, url, JSON.stringify(headers || {}), body || '', timeout || 20000);
    });
  }
  function raw(method, url, extra, body, timeout) {
    if (body && typeof body === 'object') body = JSON.stringify(body); // JS 对象过原生桥必须先字符串化
    var headers = {};
    for (var k in { 'User-Agent': 1, 'Content-Type': 1 }) headers[k] = ({ 'User-Agent': UA, 'Content-Type': 'application/json' })[k];
    if (extra) for (var k2 in extra) headers[k2] = extra[k2];
    return bridgeHttp(method, url, headers, body, timeout).then(function (r) {
      if (r && r.error && !r.status) throw new Error('网络请求失败：' + r.error);
      var j = null;
      try { j = JSON.parse(r.body); } catch (e) { throw new Error('官方接口返回异常（HTTP ' + r.status + '）'); }
      return j;
    });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /** as 域 POST：status!==0 抛错（err.code 保留官方 status），成功返回 data */
  function asPost(url, body) {
    return raw('POST', url, AS_HEADERS, JSON.stringify(body || {})).then(function (j) {
      if (!j || (j.status !== 0 && j.code !== 0)) {
        var e = new Error((j && (j.msg || j.message)) || '官方接口错误');
        e.code = j && j.status != null ? j.status : (j && j.code);
        throw e;
      }
      return j.data;
    });
  }
  /** 通用 jf：code===0 || status===0 视为成功（对齐桌面 jfetch） */
  function jf(method, url, extra, body, timeout) {
    return raw(method, url, extra, body, timeout).then(function (j) {
      if (j && j.code !== 0 && j.status !== 0) {
        var e = new Error(j.msg || j.message || ('官方接口错误 code=' + j.code + ' status=' + j.status));
        e.code = j.code;
        throw e;
      }
      return j ? j.data : null;
    });
  }

  /* ---- 官方端点（移植 hg-api.js） ---- */
  function login(account, password) {
    return raw('POST', AS + '/user/auth/v1/token_by_phone_password', AS_HEADERS, JSON.stringify({ phone: account, password })).then(function (j) {
      if (!j || j.status !== 0 || !j.data || !j.data.token) {
        throw new Error((j && (j.msg || j.message)) || ('官方登录失败 status=' + (j ? j.status : 'no-response')));
      }
      return j.data.token;
    });
  }
  function sendSmsCode(phone) { return asPost(AS + '/general/v1/send_phone_code', { phone: String(phone).trim(), type: 2 }); }
  function loginByPhoneCode(phone, code) {
    return asPost(AS + '/user/auth/v2/token_by_phone_code', { phone: String(phone).trim(), code: String(code).trim() }).then(function (data) {
      if (!data || !data.token) throw new Error('官方短信登录响应异常（缺少 token）');
      return data.token;
    });
  }
  function createScanLogin() {
    return asPost(AS + '/general/v1/gen_scan/login', {}).then(function (data) {
      if (!data || !data.scanId) throw new Error('官方扫码接口响应异常（缺少 scanId）');
      return { scanId: String(data.scanId), qrText: String(data.scanUrl || ''), expires: Date.now() + SCAN_TTL_MS };
    });
  }
  function pollScanStatus(scanId) {
    return raw('GET', AS + '/general/v1/scan_status?scanId=' + encodeURIComponent(String(scanId)), AS_HEADERS).then(function (j) {
      var st = j && j.status;
      var scanCode = (j && j.status === 0 && j.data && typeof j.data.scanCode === 'string' && j.data.scanCode) ? j.data.scanCode : null;
      var status = st === 0 ? 'confirmed' : st === 100 ? 'pending' : st === 101 ? 'expired' : 'error';
      return { status: status, scanCode: scanCode, raw: st };
    });
  }
  function tokenByScanCode(scanCode) {
    return asPost(AS + '/user/auth/v1/token_by_scan_code', { scanCode: String(scanCode) }).then(function (data) {
      if (!data || !data.token) throw new Error('官方扫码换 token 响应异常（缺少 token）');
      return data.token;
    });
  }
  function grant(loginToken) {
    return jf('POST', AS + '/user/oauth2/v2/grant', null, { type: 1, appCode: APP_CODE, token: loginToken }).then(function (d) { return d.token; });
  }
  function bindingList(oauthToken) {
    return jf('GET', 'https://binding-api-account-prod.hypergryph.com/account/binding/v1/binding_list?token='
      + encodeURIComponent(oauthToken) + '&appCode=endfield', null, null).then(function (data) {
        var out = [];
        var list = (data && data.list) || [];
        for (var i = 0; i < list.length; i++) {
          var bl = list[i].bindingList || [];
          for (var j = 0; j < bl.length; j++) {
            var b = bl[j];
            var roles = (Array.isArray(b.roles) && b.roles.length) ? b.roles : [{}];
            for (var k = 0; k < roles.length; k++) {
              var r = roles[k] || {};
              out.push({
                uid: String(b.uid), nickName: r.nickName || null,
                serverId: r.serverId != null ? String(r.serverId) : null,
                serverName: r.serverName || null, channelName: b.channelName || null,
                roleId: r.roleId != null ? String(r.roleId) : null
              });
            }
          }
        }
        return { list: out };
      });
  }
  function u8TokenByUid(uid, oauthToken) {
    return jf('POST', 'https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid', null, { uid: uid, token: oauthToken }).then(function (d) { return d.token; });
  }
  function charMeta(u8) { return jf('GET', EF + '/api/record/char/meta?lang=zh-cn&token=' + encodeURIComponent(u8) + '&server_id=1', { Referer: EF_REFERER }); }
  function charRecords(u8, poolType, seqId) {
    return jf('GET', EF + '/api/record/char?lang=zh-cn&token=' + encodeURIComponent(u8) + '&server_id=1&pool_type=' + encodeURIComponent(poolType) + (seqId ? '&seq_id=' + encodeURIComponent(seqId) : ''), { Referer: EF_REFERER });
  }
  function weaponPools(u8) { return jf('GET', EF + '/api/record/weapon/pool?lang=zh-cn&token=' + encodeURIComponent(u8) + '&server_id=1', { Referer: EF_REFERER }); }
  function weaponRecords(u8, poolId, seqId) {
    return jf('GET', EF + '/api/record/weapon?lang=zh-cn&token=' + encodeURIComponent(u8) + '&server_id=1&pool_id=' + encodeURIComponent(poolId) + (seqId ? '&seq_id=' + encodeURIComponent(seqId) : ''), { Referer: EF_REFERER });
  }
  function fetchAllPages(fetchPage, onPage) {
    var out = [], seqId = null;
    function step(p) {
      if (p >= 400) return Promise.resolve(out);
      var data;
      var attempt = fetchPage(seqId);
      for (var q = 0; q < 2; q++) attempt = attempt.catch(function () { return sleep(800).then(function () { return fetchPage(seqId); }); });
      return attempt.then(function (d) {
        data = d;
        var list = (data && data.list) || [];
        for (var i = 0; i < list.length; i++) { var it = list[i]; if (!it.kind || it.kind === 'draw') out.push(it); }
        if (onPage) onPage(p + 1, out.length, !(data && data.hasMore));
        if (!data || !data.hasMore || !list.length) return out;
        seqId = list[list.length - 1].seqId;
        return sleep(220).then(function () { return step(p + 1); });
      });
    }
    return step(0);
  }
  function isValidPhone(phone) { return /^1[3-9]\d{9}$/.test(String(phone == null ? '' : phone).trim()); }

  /* ---- 本地持久化（对齐 store.js 语义） ---- */
  var auth = { loginToken: null, oauthToken: null, roles: [], uid: null };
  function loadSavedAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } }
  function persistAuth(token) {
    try {
      if (token) localStorage.setItem(AUTH_KEY, JSON.stringify({ loginToken: token, savedAt: new Date().toISOString() }));
      else localStorage.removeItem(AUTH_KEY);
    } catch (e) { /* 忽略 */ }
  }
  function loadRecords() {
    try { var d = JSON.parse(localStorage.getItem(REC_KEY) || 'null'); return (d && d.accounts) ? d : { accounts: {} }; }
    catch (e) { return { accounts: {} }; }
  }
  function saveRecords(d) { try { localStorage.setItem(REC_KEY, JSON.stringify(d)); } catch (e) { /* 忽略 */ } }
  function mergeRecords(store, uid, kind, incoming) {
    var acc = store.accounts[uid] || (store.accounts[uid] = { char: [], weapon: [], updatedAt: null });
    var seen = {};
    for (var i = 0; i < acc[kind].length; i++) seen[acc[kind][i].seqId] = 1;
    var added = 0;
    for (var j = 0; j < incoming.length; j++) {
      if (!seen[incoming[j].seqId]) { acc[kind].push(incoming[j]); seen[incoming[j].seqId] = 1; added++; }
    }
    acc[kind].sort(function (a, b) { return (Number(b.seqId) || 0) - (Number(a.seqId) || 0); });
    acc.updatedAt = new Date().toISOString();
    return added;
  }

  /* ---- 登录态收尾 ---- */
  function ensureOauth() {
    if (auth.oauthToken) return Promise.resolve(auth.oauthToken);
    var token = auth.loginToken;
    if (!token) { var saved = loadSavedAuth(); if (saved && saved.loginToken) { token = saved.loginToken; auth.loginToken = token; } }
    if (!token) { var e = new Error('未登录鹰角通行证'); e.status401 = true; return Promise.reject(e); }
    return grant(token).then(function (o) { auth.oauthToken = o; return o; });
  }
  function finishLogin(loginToken, remember) {
    auth.loginToken = loginToken;
    auth.oauthToken = null;
    persistAuth(remember ? loginToken : null);
    return grant(loginToken).then(function (o) {
      auth.oauthToken = o;
      return bindingList(o);
    }).then(function (bindings) {
      var list = (bindings && bindings.list) || [];
      auth.roles = list.map(function (b) {
        return { uid: b.uid, nickName: b.nickName, serverId: b.serverId, serverName: b.serverName, channelName: b.channelName };
      });
      if (auth.roles.length === 1) auth.uid = auth.roles[0].uid;
      return auth.roles;
    });
  }

  /* ---- 路由（对齐 server.js /api/official/*） ---- */
  function j(msg) { return JSON.stringify(msg); }
  function ok(body) { return { status: 200, mime: 'application/json', body: j(body) }; }
  function bad(msg) { return { status: 400, mime: 'application/json', body: j({ error: msg }) }; }

  var smsSentAt = {};
  var ANALYZE = req('analyze');

  function route(route, query, method, body) {
    /* status */
    if (route === '/api/official/status' && method === 'GET') {
      var saved = loadSavedAuth();
      var recs = loadRecords();
      return ok({
        authed: !!(auth.oauthToken || auth.loginToken || (saved && saved.loginToken)),
        remembered: !!(saved && saved.loginToken),
        roles: auth.roles || [], uid: auth.uid,
        records: Object.keys(recs.accounts || {}).map(function (uid) {
          var a = recs.accounts[uid];
          return { uid: uid, updatedAt: a.updatedAt, char: (a.char || []).length, weapon: (a.weapon || []).length };
        })
      });
    }
    /* roles */
    if (route === '/api/official/roles' && method === 'GET') {
      return ensureOauth().then(function (o) { return bindingList(o); }).then(function (bindings) {
        var roles = ((bindings && bindings.list) || []).map(function (b) {
          return { uid: b.uid, nickName: b.nickName, serverId: b.serverId, serverName: b.serverName, channelName: b.channelName };
        });
        auth.roles = roles;
        if (roles.length === 1) auth.uid = roles[0].uid;
        return ok({ ok: true, roles: roles });
      }).catch(function (e) { return bad(e.message); });
    }
    /* 密码登录 */
    if (route === '/api/official/login' && method === 'POST') {
      return login(String(body.account || ''), String(body.password || '')).then(function (t) {
        return finishLogin(t, !!body.remember);
      }).then(function (roles) {
        return ok({ ok: true, roles: roles, note: '账号密码仅本机内存直转官方服务器，未存储' });
      }).catch(function (e) { return bad('官方登录失败：' + e.message); });
    }
    /* 短信 */
    if (route === '/api/official/sms_send' && method === 'POST') {
      var phone = String(body.phone || '').trim();
      if (!isValidPhone(phone)) return Promise.resolve({ status: 400, mime: 'application/json', body: j({ ok: false, error: '请输入 11 位中国大陆手机号' }) });
      var last = smsSentAt[phone] || 0;
      var waitSec = Math.ceil((60000 - (Date.now() - last)) / 1000);
      if (waitSec > 0) return Promise.resolve(ok({ ok: false, msg: '发送过于频繁，请 ' + waitSec + ' 秒后再试' }));
      return sendSmsCode(phone).then(function () {
        smsSentAt[phone] = Date.now();
        return ok({ ok: true, msg: '短信验证码已发送，请查收' });
      }).catch(function (e) {
        var m = '官方发码失败：' + e.message;
        return ok({ ok: false, msg: m, error: m });
      });
    }
    if (route === '/api/official/sms_login' && method === 'POST') {
      var p2 = String(body.phone || '').trim(), code = String(body.code || '').trim();
      if (!isValidPhone(p2)) return Promise.resolve(bad('请输入 11 位中国大陆手机号'));
      if (!/^\d{4,6}$/.test(code)) return Promise.resolve(bad('请输入短信验证码'));
      return loginByPhoneCode(p2, code).then(function (t) { return finishLogin(t, !!body.remember); }).then(function (roles) {
        return ok({ ok: true, roles: roles, note: '短信验证码仅本机内存直转官方服务器，未存储' });
      }).catch(function (e) { return bad('官方登录失败：' + e.message); });
    }
    /* 扫码 */
    if (route === '/api/official/qr_create' && method === 'POST') {
      return createScanLogin().then(function (s2) {
        return ok({ ok: true, scanId: s2.scanId, qrText: s2.qrText, expires: s2.expires });
      }).catch(function (e) { return bad('创建扫码登录失败：' + e.message); });
    }
    if (route === '/api/official/qr_status' && method === 'GET') {
      var scanId = (query.scanId || '').trim();
      if (!scanId) return Promise.resolve(bad('缺少 scanId'));
      return pollScanStatus(scanId).then(function (r) {
        if (r.status === 'confirmed') {
          if (!r.scanCode) return ok({ status: 'error', msg: '扫码已确认但官方未返回 scanCode（响应结构变更）' });
          return tokenByScanCode(r.scanCode).then(function (t) { return finishLogin(t, false); }).then(function (roles) {
            return ok({ status: 'confirmed', ok: true, roles: roles, note: '扫码登录成功' });
          }).catch(function (e) { return ok({ status: 'error', msg: '扫码换取令牌失败：' + e.message }); });
        }
        var out = { status: r.status };
        if (r.status === 'pending') out.msg = '等待手机端扫码确认';
        else if (r.status === 'expired') out.msg = '二维码已过期，请刷新重试';
        else out.msg = '扫码状态异常（官方 status=' + r.raw + '）';
        return ok(out);
      }).catch(function (e) { return ok({ status: 'error', msg: '查询扫码状态失败：' + e.message }); });
    }
    /* 手动令牌 */
    if (route === '/api/official/capture' && method === 'POST') {
      if (body && body.token) {
        auth.loginToken = String(body.token);
        auth.oauthToken = null;
        persistAuth(body.remember ? body.token : null);
        return Promise.resolve(ok({ ok: true }));
      }
      return Promise.resolve(bad('no token'));
    }
    /* 登出（保留已同步记录） */
    if (route === '/api/official/logout' && method === 'POST') {
      auth = { loginToken: null, oauthToken: null, roles: [], uid: null };
      persistAuth(null);
      return Promise.resolve(ok({ ok: true }));
    }
    /* 同步记录 */
    if (route === '/api/official/sync' && method === 'POST') {
      return (async function () {
        var uid = String(body.uid || auth.uid || '');
        if (!uid) {
          try {
            var o0 = await ensureOauth();
            var bl = await bindingList(o0);
            var list0 = (bl && bl.list) || [];
            auth.roles = list0.map(function (b) {
              return { uid: b.uid, nickName: b.nickName, serverId: b.serverId, serverName: b.serverName, channelName: b.channelName };
            });
            if (list0.length === 1) auth.uid = list0[0].uid;
          } catch (e) {
            if (e && e.status401) return { status: 401, mime: 'application/json', body: j({ error: e.message }) };
            return bad('同步失败：' + e.message);
          }
          uid = String(auth.uid || '');
        }
        if (!uid) return bad('检测到多个角色，请先在角色列表中选择');
      return ensureOauth().then(function (o) {
        var role = (auth.roles || []).filter(function (r) { return r.uid === uid; })[0] || null;
        var store = loadRecords();
        var progress = [];
        return u8TokenByUid(uid, o).then(function (u8) {
          return charMeta(u8).then(function (meta) {
            var tabs = (meta && meta.tabs) || [];
            var chain = Promise.resolve();
            tabs.forEach(function (t) {
              chain = chain.then(function () {
                return fetchAllPages(function (seq) { return charRecords(u8, t.poolType || t.key, seq); }).then(function (recs) {
                  var added = mergeRecords(store, uid, 'char', recs);
                  progress.push({ pool: t.label || t.key, count: recs.length, added: added });
                });
              });
            });
            return chain.then(function () {
              return weaponPools(u8);
            }).then(function (wpools) {
              var chain2 = Promise.resolve();
              (wpools || []).forEach(function (p) {
                chain2 = chain2.then(function () {
                  return fetchAllPages(function (seq) { return weaponRecords(u8, p.poolId, seq); }).then(function (recs) {
                    var added = mergeRecords(store, uid, 'weapon', recs);
                    progress.push({ pool: p.poolName || p.poolId, count: recs.length, added: added });
                  });
                });
              });
              return chain2;
            });
          }).then(function () {
            saveRecords(store);
            auth.uid = uid;
            var result = ANALYZE.analyze(uid, store.accounts[uid]);
            return ok({ ok: true, uid: uid, role: role, progress: progress, analysis: result });
          });
        });
      }).catch(function (e) {
        if (e && e.status401) return { status: 401, mime: 'application/json', body: j({ error: e.message }) };
        return bad('同步失败：' + e.message);
      });
      })();
    }
    /* 分析 / 预测 */
    var mOfUid = route.match(/^\/api\/official\/(analysis|predict)$/);
    if (mOfUid && (method === 'GET' || method === 'POST')) {
      var uid2 = query.uid || auth.uid || '';
      var store2 = loadRecords();
      if (!uid2) uid2 = Object.keys(store2.accounts || {})[0] || '';
      var acc = store2.accounts && store2.accounts[uid2];
      if (!acc) return Promise.resolve({ status: 404, mime: 'application/json', body: j({ error: '尚无官方记录，请先同步' }) });
      var result = ANALYZE.analyze(uid2, acc);
      var PRED_TRIALS = globalThis.AndroidBridge ? 6000 : 100000; // 手机端降档防冻结
            var predCache = OFFICIAL._predCache || (OFFICIAL._predCache = {});
      var ck = uid2 + '|' + (acc.updatedAt || '') + '|' + (acc.char || []).length;
      if (mOfUid[1] === 'analysis') return Promise.resolve(ok({ uid: uid2, analysis: result }));
            if (!predCache[ck]) predCache[ck] = ANALYZE.predict(result, acc, { trials: PRED_TRIALS });
      return Promise.resolve(ok({ uid: uid2, analysis: result, prediction: predCache[ck] }));
    }
    /* CSV 导出（时间正序混排；UP 判定用本地卡池数据） */
    if (route === '/api/official/export' && method === 'GET') {
      var uid3 = query.uid || auth.uid || Object.keys(loadRecords().accounts || {})[0] || '';
      var store3 = loadRecords();
      var acc3 = store3.accounts && store3.accounts[uid3];
      if (!acc3) return Promise.resolve({ status: 404, mime: 'application/json', body: j({ error: '尚无官方记录，请先同步' }) });
      var charUp = {};
      var wpnUp = {};
      _d.charBanners.forEach(function (b) { if (b.up6) charUp[(b.name || '').replace(/[「」]/g, '')] = b.up6; });
      _d.wpnBanners.forEach(function (b) { if (b.up6) wpnUp[(b.name || '').replace(/[「」]/g, '')] = b.up6; });
      var rows = [];
      var all = [].concat(acc3.char || [], acc3.weapon || []).sort(function (a, b) { return (Number(a.gachaTs) || 0) - (Number(b.gachaTs) || 0); });
      all.forEach(function (r) {
        var isChar = !!r.charName;
        var name = isChar ? r.charName : r.weaponName;
        var pool = r.poolName || '';
        var up = '';
        if (Number(r.rarity) === 6) {
          var up6 = (isChar ? charUp : wpnUp)[pool.replace(/[「」]/g, '')];
          if (up6 != null) up = up6 === name ? 1 : 0;
        }
        rows.push([r.gachaTs ? new Date(Number(r.gachaTs)).toISOString() : '', pool, name, r.rarity, up, r.isFree ? 1 : 0, isChar ? 'char' : 'weapon']);
      });
      var esc = function (v) { v = String(v == null ? '' : v); return /["\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = ['time,pool,name,rarity,up,isFree,type'];
      rows.forEach(function (row) { lines.push(row.map(esc).join(',')); });
      var csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
      return Promise.resolve({ status: 200, mime: 'text/csv; charset=utf-8', body: csv, disposition: 'attachment; filename="official-records-' + uid3 + '.csv"' });
    }
    return null; // 未命中 → 交给主适配器 404
  }

  return { route: route };
})();
