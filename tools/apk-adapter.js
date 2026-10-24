/* apk-adapter.js — APK 离线运行时的 API 适配层（内嵌进 runtime-shim.js）。
 * 忠实移植 server.js / src/state.js 的组装逻辑：
 *   bannerView/bannerStatus/stateView/luckAnalysis/pull/simulate/selector/history 等。
 * 差异：存档持久化到 localStorage；官方账号功能为存根（需桌面版中转官方接口）。
 * 全局依赖（由 build-apk-runtime.js 注入）：__APK_DATA__、__APK_IMG__。
 */
'use strict';

var __modsReq = req; // engine mini-registry (runtime-shim.js 提供)
var _engine = __modsReq('engine-index');
var _sim = __modsReq('simulate');
var _dataloader = __modsReq('dataloader');
var _d = _dataloader.getData(); // fs shim 从 __APK_DATA__ 读取，同步可用

var SAVE_KEY = 'zmd_apk_save_v1';
function _defaultSave() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    limitedTrack: { pity6: 0 },
    banners: {},
    standard: { pity6: 0, totalPulls: 0, selectorClaimed: false, selectorAvailable: false },
    newbie: { pulls: 0, pity6: 0, closed: false },
    weapons: {},
    weaponQuota: 0,
    securityQuota: 0,
    inventory: {},
    weaponInventory: {},
    stats: {
      totalPulls: 0,
      byRarity: { 6: 0, 5: 0, 4: 0 },
      byRarityWeapon: { 6: 0, 5: 0, 4: 0 },
      goldRecords: []
    },
    history: []
  };
}
var _save = null;
function _load() {
  if (_save) return _save;
  try {
    var raw = localStorage.getItem(SAVE_KEY);
    _save = raw ? Object.assign(_defaultSave(), JSON.parse(raw)) : _defaultSave();
  } catch (e) { _save = _defaultSave(); }
  return _save;
}
function _persist(s) { _save = s; try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* 忽略 */ } }

function _luckAnalysis(s) {
  var golds = s.stats.goldRecords.filter(function (g) { return !g.weapon; });
  var n = golds.length;
  if (n === 0) return { hasData: false };
  var totalCharPulls = s.stats.byRarity[6] + s.stats.byRarity[5] + s.stats.byRarity[4];
  var avgPerGold = totalCharPulls / n;
  var expected = 49.1;
  var avgPity = golds.reduce(function (a, g) { return a + (g.pity || 0); }, 0) / n;
  var offBannerRate = golds.filter(function (g) { return !g.isUp; }).length / golds.length;
  var ratio = avgPerGold / expected;
  var rating = ratio <= 0.75 ? '欧皇' : ratio <= 0.92 ? '比较欧' : ratio <= 1.1 ? '中规中矩' : ratio <= 1.35 ? '有点非' : '非酋附体';
  return {
    hasData: true, charPulls: totalCharPulls, golds: n, avgPerGold: +avgPerGold.toFixed(1),
    avgPity: +avgPity.toFixed(1), expected: expected, offBannerRate: +offBannerRate.toFixed(3), rating: rating
  };
}

function _bannerStatus(b) {
  if (!b.start || !b.end) return 'permanent';
  var now = new Date();
  var start = new Date(b.start + 'T12:00:00+08:00');
  var end = new Date(b.end + 'T23:59:59+08:00');
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'active';
}

function _bannerView(b) {
  var s = _load();
  var d = _d;
  if (b.category === 'weapon') {
    var ws = s.weapons[b.id] || { cum: 0, pullsSince6: 0, upObtained: false, milestoneIndex: 0 };
    var pool6 = (b.pool6 && b.pool6.length) ? b.pool6 : [b.up6].concat(d.standardWeaponPool);
    return {
      id: b.id, name: b.name, category: 'weapon', type: b.type, version: b.version,
      start: b.start, end: b.end, up6: b.up6, up6Type: b.up6Type || null,
      pairedCharBanner: b.pairedCharBanner || null,
      pool6: pool6, pool6Detail: b.pool6Detail || null, notes: b.notes,
      status: _bannerStatus(b),
      state: { cum: ws.cum, pullsSince6: ws.pullsSince6, upObtained: ws.upObtained, milestoneIndex: ws.milestoneIndex }
    };
  }
  var base = {
    id: b.id, name: b.name, category: 'character', type: b.type, version: b.version, versionName: b.versionName,
    start: b.start, end: b.end, up6: b.up6, pool6: b.pool6, notes: b.notes,
    fiveStarPool: d.fiveStarPool, fourStarPool: d.fourStarPool,
    specialRules: b.specialRules || null,
    status: _bannerStatus(b)
  };
  if (b.type === 'limited' || b.type === 'rerun') {
    var bs = s.banners[b.id] || {};
    var o = Object.assign({}, base, { state: { cum: bs.cum || 0, upObtained: !!bs.upObtained, rush10Available: !!bs.rush10Available, tokensEarned: bs.tokensEarned || 0, pity6: s.limitedTrack.pity6 } });
    return o;
  }
  if (b.type === 'special') {
    var bs2 = s.banners[b.id] || {};
    return Object.assign({}, base, { state: { cum: bs2.cum || 0, pitySince6: bs2.pitySince6 || 0, securityQuota: bs2.securityQuota || 0 } });
  }
  if (b.type === 'standard') {
    return Object.assign({}, base, { state: { pity6: s.standard.pity6, totalPulls: s.standard.totalPulls, selectorAvailable: !!s.standard.selectorAvailable, selectorClaimed: !!s.standard.selectorClaimed } });
  }
  if (b.type === 'newbie') {
    return Object.assign({}, base, { state: { pulls: s.newbie.pulls, closed: !!s.newbie.closed } });
  }
  return base;
}

function _stateView(opts) {
  var s = _load();
  var d = _d;
  var inventory = {};
  for (var name in s.inventory) {
    if (!Object.prototype.hasOwnProperty.call(s.inventory, name)) continue;
    var rec = s.inventory[name];
    var op = d.opByName.get(name);
    inventory[name] = {
      count: rec.count, tokens: rec.tokens,
      potential: 1 + (rec.count - 1) + rec.tokens,
      rarity: op ? op.rarity : null,
      profession: op ? op.profession : null,
      limited: op ? op.limited : null
    };
  }
  var view = Object.assign({}, s, {
    luck: _luckAnalysis(s),
    inventoryView: inventory,
    weaponQuota: s.weaponQuota,
    expectedAvgPerGold: 49.1
  });
  try {
    if (view.luck && view.luck.hasData && view.luck.charPulls > 0) {
      view.luck.percentile = _sim.sixCountPercentile(view.luck.charPulls, view.luck.golds);
    } else if (view.luck) {
      view.luck.percentile = null;
    }
  } catch (e) { if (view.luck) view.luck.percentile = null; }
  if (opts && opts.light) {
    view.history = undefined;
    view.stats = Object.assign({}, s.stats, { goldRecords: undefined, goldCount: (s.stats.goldRecords || []).length });
  }
  return view;
}

function _toCsv(header, rows) {
  var esc = function (v) {
    v = String(v == null ? '' : v);
    return /["\n,]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  var lines = [header.map(esc).join(',')];
  for (var i = 0; i < rows.length; i++) lines.push(rows.map(esc).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function _j(msg) { return JSON.stringify(msg); }
var OFFLINE_OFFICIAL_MSG = 'APK 离线版暂不支持官方账号功能，请使用桌面版';

var RUNTIME = {
  init: function () {
    _load();
    return Promise.resolve();
  },
  /** 立绘地址：直接指向打包进 APK 的哈希名图片（映射表内嵌），缺失返回空串走占位 */
  imgSrc: function (name, kind) {
    var IMG = globalThis.__APK_IMG__ || { operators: {}, weapons: {} };
    var bucket = kind === 'weapon' ? IMG.weapons : IMG.operators;
    var safe = String(name).replace(/[\\/:*?"<>|]/g, '_');
    return bucket[safe] || '';
  },
  /** 主入口：path 形如 /api/xxx?query；返回 {status, body, mime, disposition} */
  handle: function (path, init) {
    return Promise.resolve().then(function () {
      return _route(path, init || {});
    }).catch(function (e) {
      return { status: 500, body: _j({ error: (e && e.message) || String(e) }), mime: 'application/json' };
    });
  }
};

function _route(path, init) {
  var qpos = path.indexOf('?');
  var route = qpos >= 0 ? path.slice(0, qpos) : path;
  var query = {};
  if (qpos >= 0) {
    path.slice(qpos + 1).split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      var k = decodeURIComponent(i < 0 ? kv : kv.slice(0, i));
      var v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1));
      query[k] = v;
    });
  }
  route = route.replace(/\/+$/, '') || '/';
  var method = (init.method || 'GET').toUpperCase();
  var body = {};
  if (init.body) { try { body = JSON.parse(init.body); } catch (e) { body = {}; } }
  var d = _d;

  /* ---- 元数据与静态数据 ---- */
  if (route === '/api/meta' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j({
      game: d.versions, rules: d.rules, economy: d.economy, versions: d.versions,
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
    }) };
  }
  if (route === '/api/images' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j(d.images || { operators: {} }) };
  }
  if (route === '/api/banners' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j({ banners: d.allBanners.map(_bannerView) }) };
  }
  var mBanner = route.match(/^\/api\/banners\/([\w-]+)$/);
  if (mBanner && method === 'GET') {
    var b0 = d.bannerById.get(mBanner[1]);
    if (!b0) return { status: 404, mime: 'application/json', body: _j({ error: '未找到卡池' }) };
    return { status: 200, mime: 'application/json', body: _j({ banner: _bannerView(b0) }) };
  }
  if (route === '/api/operators' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j({ operators: d.operators }) };
  }
  var mOp = route.match(/^\/api\/operators\/(.+)$/);
  if (mOp && method === 'GET') {
    var name = decodeURIComponent(mOp[1]);
    var op = d.opByName.get(name);
    if (!op) return { status: 404, mime: 'application/json', body: _j({ error: '未找到干员' }) };
    var build = d.builds.builds.find(function (b) { return b.operator === name; }) || null;
    var banners = d.allBanners.filter(function (b) { return b.up6 === name || (b.pool6 || []).indexOf(name) >= 0; })
      .map(function (b) { return { id: b.id, name: b.name, version: b.version }; });
    var s0 = _load();
    var inv = s0.inventory[name] || null;
    return { status: 200, mime: 'application/json', body: _j({
      operator: op, build: build, banners: banners,
      owned: inv ? { count: inv.count, tokens: inv.tokens, potential: 1 + (inv.count - 1) + inv.tokens } : null
    }) };
  }
  if (route === '/api/weapons' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j({ weapons: d.weapons, standardPool: d.standardWeaponPool }) };
  }
  if (route === '/api/matrices' && method === 'GET') return { status: 200, mime: 'application/json', body: _j(d.matrices) };
  if (route === '/api/materials' && method === 'GET') return { status: 200, mime: 'application/json', body: _j(d.materials) };
  if (route === '/api/builds' && method === 'GET') return { status: 200, mime: 'application/json', body: _j(d.builds) };
  if (route === '/api/economy' && method === 'GET') return { status: 200, mime: 'application/json', body: _j(d.economy) };

  /* ---- 存档与抽卡 ---- */
  if (route === '/api/state' && method === 'GET') {
    return { status: 200, mime: 'application/json', body: _j(_stateView()) };
  }
  if (route === '/api/reset' && method === 'POST') {
    _persist(_defaultSave());
    return { status: 200, mime: 'application/json', body: _j({ ok: true, state: _stateView() }) };
  }
  if (route === '/api/history' && method === 'GET') {
    var limit = Math.min(300, Math.max(1, parseInt(query.limit || '50', 10) || 50));
    var s1 = _load();
    return { status: 200, mime: 'application/json', body: _j({ history: s1.history.slice(0, limit), total: s1.history.length }) };
  }
  if (route === '/api/history/export' && method === 'GET') {
    var s2 = _load();
    var rows = [];
    var hist = s2.history.slice().reverse();
    for (var i = 0; i < hist.length; i++) {
      var h = hist[i];
      var items = h.items || [];
      for (var k = 0; k < items.length; k++) {
        var it = items[k];
        var mode = it.mode || h.mode || '';
        rows.push([
          it.ts || h.ts || '', h.bannerName || h.bannerId || '', it.name, it.rarity,
          it.rarity === 6 ? (it.isUp ? 1 : 0) : '',
          mode === 'rush' ? 1 : 0,
          it.rarity === 6 && it.pity != null ? it.pity : ''
        ]);
      }
    }
    var csv = _toCsv(['time', 'banner', 'name', 'rarity', 'up', 'isRush', 'pity'], rows);
    return { status: 200, mime: 'text/csv; charset=utf-8', body: csv, disposition: 'attachment; filename="sim-history.csv"' };
  }
  if (route === '/api/pull' && method === 'POST') {
    try {
      var times = body.times === 1 ? 1 : 10;
      var result = _engine.pull(_load(), body.bannerId, {
        times: times, mode: body.mode || 'normal', seed: body.seed, payWithQuota: !!body.payWithQuota
      });
      _persist(_load());
      var bb = _d.bannerById.get(body.bannerId);
      return { status: 200, mime: 'application/json', body: _j(Object.assign({ ok: true }, result, {
        banner: bb ? _bannerView(bb) : null,
        state: _stateView({ light: true })
      })) };
    } catch (e) {
      return { status: 400, mime: 'application/json', body: _j({ error: e.message }) };
    }
  }
  if (route === '/api/selector/claim' && method === 'POST') {
    var s3 = _load();
    if (!s3.standard.selectorAvailable || s3.standard.selectorClaimed) {
      return { status: 400, mime: 'application/json', body: _j({ error: '当前不可领取基础寻访300抽自选' }) };
    }
    var stdBanner = _d.charBanners.find(function (b) { return b.id === 'c_std'; });
    if (!body.name || !stdBanner || stdBanner.pool6.indexOf(body.name) < 0) {
      return { status: 400, mime: 'application/json', body: _j({ error: '请从五名常驻六星中选择一位' }) };
    }
    s3.standard.selectorClaimed = true;
    var inv2 = s3.inventory[body.name] || (s3.inventory[body.name] = { count: 0, tokens: 0 });
    inv2.count += 1;
    _persist(s3);
    return { status: 200, mime: 'application/json', body: _j({ ok: true, picked: body.name, banner: _bannerView(stdBanner), state: _stateView({ light: true }) }) };
  }
  if (route === '/api/simulate' && method === 'POST') {
    try {
      var trials = Math.min(500000, Math.max(1000, body.trials || 100000));
      var banner = _d.bannerById.get(body.bannerId);
      var result2;
      if (!banner) throw new Error('未找到卡池');
      if (banner.category === 'weapon') {
        result2 = _sim.simulateWeapon(body.bannerId, { trials: trials, init: body.init || {}, seed: body.seed });
      } else {
        result2 = _sim.simulateCharacter(body.bannerId, { target: body.target || 'up', trials: trials, init: body.init || {}, seed: body.seed });
      }
      var econ = _d.economy;
      var jade = result2.mean * econ.currency.jadePerPull;
      return { status: 200, mime: 'application/json', body: _j(Object.assign({ ok: true, bannerId: body.bannerId, target: body.target || 'up' }, result2, {
        cost: {
          meanPulls: result2.mean,
          jade: Math.round(jade),
          originium: +(jade / econ.currency.jadePerOriginium).toFixed(1),
          cnyBase: +(jade / econ.currency.jadePerPull / 0.15 / 280 * 648).toFixed(0),
          cnyNonFirst: +(jade / econ.currency.jadePerPull / 0.15 / 350 * 648).toFixed(0),
          cnyFirst: +(jade / econ.currency.jadePerPull / 0.15 / 560 * 648).toFixed(0)
        }
      })) };
    } catch (e) {
      return { status: 400, mime: 'application/json', body: _j({ error: e.message }) };
    }
  }

  /* ---- 官方账号：原生网络桥直连官方（完整实现在 apk-official.js） ---- */
  if (route.indexOf('/api/official/') === 0) {
    var off = OFFICIAL.route(route, query, method, body);
    if (off) return Promise.resolve(off);
    return Promise.resolve(bad('未知官方接口: ' + method + ' ' + route));
  }

  /* ---- 卡池同步（离线存根：数据已内置） ---- */
  if (route === '/api/banners/refresh' && method === 'POST') {
    return { status: 200, mime: 'application/json', body: _j({
      ok: true,
      result: { ok: true, articleCount: 0, charBanners: d.charBanners.length, wpnBanners: d.wpnBanners.length, newCharBanners: 0, newWpnBanners: 0 },
      banners: d.allBanners.map(_bannerView)
    }) };
  }

  return { status: 404, mime: 'application/json', body: _j({ error: '未知接口: ' + method + ' ' + route }) };
}
