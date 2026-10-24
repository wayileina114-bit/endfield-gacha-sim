// build-apk-runtime.js - generate the offline runtime bundle for the Android APK.
// Produces <root>/android/assets/www/** :
//   index.html (patched: loads js/runtime-shim.js before the ESM app)
//   css/ js/   (copied from public/; ui.js patched for runtime image lookup)
//   js/runtime-shim.js  (generated: engine bundle + data + adapter + fetch/click shims)
//   img/{operators,weapons}/*.{avif|webp} (converted to webp when Pillow supports it)
// Desktop files are never modified.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'android', 'assets', 'www');

function copy(src, dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

/* ---------- 1. static assets ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(PUB, 'css'), path.join(OUT, 'css'));
copyDir(path.join(PUB, 'js', 'views'), path.join(OUT, 'js', 'views'));
copyDir(path.join(PUB, 'js', 'vendor'), path.join(OUT, 'js', 'vendor'));
for (const f of ['api.js', 'store.js', 'ui.js', 'app.js']) copy(path.join(PUB, 'js', f), path.join(OUT, 'js', f));

// index.html: inject the shim BEFORE the ESM app (classic script, sync)
let indexHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const shimTag = '<script src="js/runtime-shim.js"></script>';
const appTag = '<script type="module" src="js/app.js"></script>';
if (!indexHtml.includes(appTag)) throw new Error('index.html marker missing: module script tag');
indexHtml = indexHtml.replace(appTag, shimTag + '\n' + appTag);
fs.writeFileSync(path.join(OUT, 'index.html'), indexHtml);

// ui.js patch: image src resolves through the runtime (bundled img/) when present
let uiJs = fs.readFileSync(path.join(PUB, 'js', 'ui.js'), 'utf8');
const imgMarker = "img.src = `/api/img?name=${encodeURIComponent(name)}&kind=${encodeURIComponent(kind)}&v=2`;";
if (!uiJs.includes(imgMarker)) throw new Error('ui.js marker missing: /api/img src line');
uiJs = uiJs.replace(imgMarker,
  "img.src = (window.__APP_RUNTIME__ && window.__APP_RUNTIME__.imgSrc)\n" +
  "      ? window.__APP_RUNTIME__.imgSrc(name, kind)\n" +
  "      : `/api/img?name=${encodeURIComponent(name)}&kind=${encodeURIComponent(kind)}&v=2`;");
fs.writeFileSync(path.join(OUT, 'js', 'ui.js'), uiJs);

/* ---------- 2. images: copy + optional avif->webp (old WebView safety) ---------- */
const IMG_KINDS = ['operators', 'weapons'];
const imgExt = { operators: null, weapons: null };
let pillowAvif = null;
try {
  const r = spawnSync('python', ['-c',
    "from PIL import Image;import sys;im=Image.open(sys.argv[1]);im.save(sys.argv[2],'WEBP',quality=88)",
    path.join(DATA, 'imgcache', 'operators', fs.readdirSync(path.join(DATA, 'imgcache', 'operators'))[0]),
    path.join(OUT, 'probe.webp')], { encoding: 'utf8' });
  pillowAvif = r.status === 0;
} catch { pillowAvif = false; }
if (fs.existsSync(path.join(OUT, 'probe.webp'))) fs.rmSync(path.join(OUT, 'probe.webp'));
console.log('pillow avif->webp:', pillowAvif);

const imgExist = { operators: {}, weapons: {} };
const crypto = require('crypto');
for (const kind of IMG_KINDS) {
  const srcDir = path.join(DATA, 'imgcache', kind);
  const destDir = path.join(OUT, 'img', kind);
  fs.mkdirSync(destDir, { recursive: true });
  const ext0 = pillowAvif ? 'webp' : 'avif';
  for (const f of fs.readdirSync(srcDir)) {
    if (!f.toLowerCase().endsWith('.avif')) continue;
    const base = f.slice(0, -5); // safe name (filename base == safe(name))
    // aapt2 无法处理非 ASCII 资产文件名：改为内容哈希名，映射表内嵌进 shim
    const hashed = kind[0] + '_' + crypto.createHash('md5').update(base).digest('hex').slice(0, 16) + '.' + ext0;
    const dest = path.join(destDir, hashed);
    if (pillowAvif) {
      const r = spawnSync('python', ['-c',
        "from PIL import Image;import sys;im=Image.open(sys.argv[1]);im.save(sys.argv[2],'WEBP',quality=88)",
        path.join(srcDir, f), dest], { encoding: 'utf8' });
      if (r.status !== 0) fs.copyFileSync(path.join(srcDir, f), dest);
    } else {
      fs.copyFileSync(path.join(srcDir, f), dest);
    }
    imgExist[kind][base] = 'img/' + kind + '/' + hashed;
  }
  console.log(`img/${kind}: ${Object.keys(imgExist[kind]).length} files (hashed, ${ext0})`);
}

/* ---------- 3. data ---------- */
const DATA_FILES = {
  'operators.json': 'operators.json',
  'banners.character.json': 'banners.character.json',
  'banners.weapon.json': 'banners.weapon.json',
  'banners.remote.json': 'banners.remote.json',
  'weapons.json': 'weapons.json',
  'rules.json': 'rules.json',
  'economy.json': 'economy.json',
  'versions.json': 'versions.json',
  'images.json': 'images.json',
  'guide/builds.json': 'guide/builds.json',
  'guide/matrices.json': 'guide/matrices.json',
  'guide/materials.json': 'guide/materials.json'
};
const apkData = {};
for (const [key, rel] of Object.entries(DATA_FILES)) {
  const p = path.join(DATA, rel);
  if (fs.existsSync(p)) apkData[key] = JSON.parse(fs.readFileSync(p, 'utf8'));
}

/* ---------- 4. engine bundle ---------- */
function wrapModule(id, file) {
  const src = fs.readFileSync(file, 'utf8');
  return `def(${JSON.stringify(id)}, function(require, module, exports, __dirname){\n${src}\n});`;
}
const ENGINE = [
  ['rng', 'rng.js'],
  ['dataloader', 'dataloader.js'],
  ['character', 'character.js'],
  ['weapon', 'weapon.js'],
  ['simulate', 'simulate.js'],
  ['engine-index', 'index.js'],
  ['analyze', path.join('..', 'official', 'analyze.js')]
];
let engineDefs = '';
for (const [id, file] of ENGINE) engineDefs += wrapModule(id, path.join(ROOT, 'src', 'engine', file)) + '\n';

/* ---------- 5. adapter (ports server.js composition; see header comment) ---------- */
const adapterSrc = fs.readFileSync(path.join(__dirname, 'apk-adapter.js'), 'utf8');
const officialSrc = fs.readFileSync(path.join(__dirname, 'apk-official.js'), 'utf8');

const shim = `/* AUTO-GENERATED by tools/build-apk-runtime.js - do not edit by hand.
 * APK offline runtime: CommonJS mini-registry + node shims + engine bundle +
 * data snapshot + API adapter (fetch shim). Faithful port of server.js API. */
(function () {
'use strict';
var __mods = {};
function def(id, fn) { __mods[id] = { fn: fn, m: { exports: {} }, init: false }; }
function req(id) {
  id = String(id).replace(/^\\.\\//, '').replace(/^\\.\\.\\/engine\\//, ''); // 相对 require 归一
  var m = __mods[id];
  if (!m) throw new Error('[apk-runtime] module not found: ' + id);
  if (!m.init) { m.init = true; m.fn(req, m.m, m.m.exports); }
  return m.m.exports;
}
/* ---- node shims ---- */
def('crypto', function (require, module, exports) {
  module.exports = {
    randomInt: function (min, max) {
      var a = new Uint32Array(1); globalThis.crypto.getRandomValues(a);
      return min + (a[0] % (max - min));
    }
  };
});
def('path', function (require, module, exports) {
  function norm(p) {
    var parts = p.split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return '/' + out.join('/');
  }
  module.exports = {
    join: function () { return norm([].slice.call(arguments).join('/')); }
  };
});
def('fs', function (require, module, exports) {
  var DATA = globalThis.__APK_DATA__;
  module.exports = {
    readFileSync: function (p) {
      var key = norm(p);
      var m = key.match(/^\\/data\\/(.+\\.json)$/);
      if (m && DATA[m[1]] !== undefined) return JSON.stringify(DATA[m[1]]);
      throw new Error('[apk-runtime] fs unavailable: ' + p);
    },
    writeFileSync: function () { throw new Error('[apk-runtime] read-only'); },
    existsSync: function () { return false; }
  };
  function norm(p) { var a = p.split(/[\\\\/]+/), o = []; for (var i = 0; i < a.length; i++) { var s = a[i]; if (!s || s === '.') continue; if (s === '..') o.pop(); else o.push(s); } return '/' + o.join('/'); }
});
globalThis.__APK_DATA__ = ${JSON.stringify(apkData)};
globalThis.__APK_IMG__ = ${JSON.stringify(imgExist)};

/* ---- engine modules (CommonJS sources verbatim) ---- */
${engineDefs}

/* ---- API adapter ---- */
${adapterSrc}

/* ---- official chain via native bridge ---- */
${officialSrc}

/* ---- fetch / anchor shims ---- */
var origFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
globalThis.fetch = function (input, init) {
  var url = typeof input === 'string' ? input : (input && input.url) || '';
  var path = url.replace(/^https?:\\/\\/[^/]+/, '');
  if (path.indexOf('/api/') === 0) {
    return RUNTIME.handle(path, init).then(function (r) {
      return {
        ok: r.status < 400, status: r.status,
        json: function () { return Promise.resolve(JSON.parse(r.body || 'null')); },
        text: function () { return Promise.resolve(r.body || ''); }
      };
    });
  }
  if (!origFetch) return Promise.reject(new Error('fetch unavailable'));
  return origFetch(input, init);
};
// CSV 导出按钮：<a href="/api/..."> 优先走原生保存（WebView 无 blob 下载），否则退回 blob 下载
window.__bridgeToast = function (m) { if (window.toast) toast(m); };
document.addEventListener('click', function (ev) {
  var a = ev.target && ev.target.closest && ev.target.closest('a[href^="/api/"]');
  if (!a) return;
  ev.preventDefault();
  RUNTIME.handle(a.getAttribute('href'), {}).then(function (r) {
    var name = 'export.csv';
    var m = /filename="([^"]+)"/.exec(r.disposition || '');
    if (m) name = m[1];
    if (globalThis.AndroidBridge) {
      var b64 = btoa(unescape(encodeURIComponent(r.body)));
      globalThis.AndroidBridge.saveFile(name, r.mime || 'text/csv', b64);
      return;
    }
    var blob = new Blob([r.body], { type: r.mime || 'text/csv' });
    var u = URL.createObjectURL(blob);
    var t = document.createElement('a');
    t.href = u; t.download = name; document.body.appendChild(t); t.click();
    setTimeout(function () { URL.revokeObjectURL(u); t.remove(); }, 400);
  }).catch(function (e) { if (window.toast) toast(e.message, 'err'); });
}, true);

window.__APP_RUNTIME__ = RUNTIME;

/* APK 内没有可关闭的本机服务：隐藏页脚「关闭服务」按钮 */
function hideShutdownBtn() {
  var b = document.getElementById('btn-shutdown');
  if (b) b.style.display = 'none';
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hideShutdownBtn);
else hideShutdownBtn();
})();
`;

fs.mkdirSync(path.join(OUT, 'js'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'js', 'runtime-shim.js'), shim);
console.log('runtime-shim.js:', (shim.length / 1024 / 1024).toFixed(2) + ' MB');

/* ---------- 6. image manifest for the adapter ---------- */
fs.writeFileSync(path.join(OUT, 'js', 'img-manifest.json'), JSON.stringify(imgExist));
console.log('APK runtime assets ready at', OUT);
