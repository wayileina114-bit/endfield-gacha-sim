'use strict';
/**
 * 鹰角官方接口中转（社区逆向链路，与 bhaoo/endfield-gacha 等工具一致）
 * 安全原则：账号密码仅在本函数内存中直转官方服务器，不做任何持久化/日志/上传；
 * 本地最多保存长时效登录 token（用户勾选"记住登录态"时）。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const APP_CODE = 'be36d44aa36bfb5b'; // endfield（社区工具同值）
const EF_REFERER = 'https://ef-webview.hypergryph.com/page/gacha_char?server_id=1';

async function jfetch(url, opts = {}, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ac.signal,
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    });
    const j = await r.json().catch(() => { throw new Error('官方接口返回异常（HTTP ' + r.status + '）'); });
    // as.hypergryph.com 认证类端点用 {status:0,...}，其余端点用 {code:0,...}，两者都视为成功
    if (j.code !== 0 && j.status !== 0) {
      const err = new Error(j.msg || j.message || ('官方接口错误 code=' + j.code + ' status=' + j.status));
      err.code = j.code;
      throw err;
    }
    return j.data;
  } finally { clearTimeout(timer); }
}

/** 登录鹰角通行证（官方密码登录端点，字段名 phone）：返回长时效登录 token（密码只经内存直转官方） */
async function login(account, password) {
  // 注意：该端点成功返回 {status:0,data:{token}}，与其它接口的 {code:0,data} 不同，需单独解析
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20000);
  let j;
  try {
    const r = await fetch('https://as.hypergryph.com/user/auth/v1/token_by_phone_password', {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/json',
        'Origin': 'https://user.hypergryph.com',
        'Referer': 'https://user.hypergryph.com/'
      },
      body: JSON.stringify({ phone: account, password })
    });
    j = await r.json().catch(() => { throw new Error('官方登录接口返回异常（HTTP ' + r.status + '）'); });
  } finally { clearTimeout(timer); }
  if (!j || j.status !== 0 || !j.data || !j.data.token) {
    throw new Error((j && (j.msg || j.message)) || ('官方登录失败 status=' + (j ? j.status : 'no-response')));
  }
  return j.data.token;
}

/* ---------- as.hypergryph.com 认证域直连（短信 / 扫码登录链路） ----------
 * 与 token_by_phone_password 同一套请求头：浏览器 UA + 官方登录页 Origin/Referer。
 * as 域成功判定为 {status:0,...}（jfetch 已兼容，但轮询需区分 100/101，这里单独解析）。 */
const AS = 'https://as.hypergryph.com';
const AS_HEADERS = {
  'User-Agent': UA,
  'Content-Type': 'application/json',
  'Origin': 'https://user.hypergryph.com',
  'Referer': 'https://user.hypergryph.com/'
};

/** as 域原始请求：返回完整 JSON（不做 status 判定，供 scan_status 轮询区分各状态码） */
async function asRaw(method, url, body, timeoutMs = 20000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      signal: ac.signal,
      headers: AS_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return await r.json().catch(() => { throw new Error('官方接口返回异常（HTTP ' + r.status + '）'); });
  } finally { clearTimeout(timer); }
}

/** as 域 POST：status!==0 时抛错（err.code 保留官方 status，供发码回退判断），成功返回 data */
async function asPost(url, body) {
  const j = await asRaw('POST', url, body);
  if (!j || (j.status !== 0 && j.code !== 0)) {
    const err = new Error((j && (j.msg || j.message)) || ('官方接口错误 status=' + (j ? j.status : 'no-response')));
    err.code = j && j.status != null ? j.status : (j && j.code);
    throw err;
  }
  return j.data;
}

/** 纯函数：中国大陆手机号校验（1[3-9] 开头的 11 位数字，容错首尾空白） */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone == null ? '' : phone).trim());
}

/** 纯函数：scan_status 官方数字状态 → 本地语义状态。
 *  实测：100=待扫码({"msg":"未扫码"})、101=已过期、0=已确认(data 含 scanCode)；其余视为异常。 */
function mapScanStatus(st) {
  if (st === 0) return 'confirmed';
  if (st === 100) return 'pending';
  if (st === 101) return 'expired';
  return 'error';
}

/** 纯函数：从 scan_status 原始响应提取 scanCode（仅 status=0 且 data.scanCode 为非空字符串时有效） */
function extractScanCode(j) {
  if (!j || j.status !== 0) return null;
  const c = j.data && j.data.scanCode;
  return (typeof c === 'string' && c) ? c : null;
}

/** 短信发码。官方 type 枚举：LOGIN=1、LOGIN_OR_REGISTER=2。
 *  必须用 type=2：官方登录页短信表单默认 LOGIN_OR_REGISTER（smsType 缺省即取它），
 *  v2/token_by_phone_code 只认 type=2 签发的码——type=1 也能发出真实短信（实测），
 *  但拿去登录会报「手机号码或验证码错误」（实测）。 */
async function sendSmsCode(phone) {
  const p = String(phone).trim();
  return await asPost(AS + '/general/v1/send_phone_code', { phone: p, type: 2 });
}

/** 短信验证码登录（v2 端点）：{phone, code} → {status:0,data:{token}}，返回长时效登录 token */
async function loginByPhoneCode(phone, code) {
  const data = await asPost(AS + '/user/auth/v2/token_by_phone_code', { phone: String(phone).trim(), code: String(code).trim() });
  if (!data || !data.token) throw new Error('官方短信登录响应异常（缺少 token）');
  return data.token;
}

/** 创建扫码登录会话：POST /general/v1/gen_scan/login。
 *  实测：必须携带 JSON body（空 body → HTTP 400 {"msg":"EOF"}，{} 即可）；
 *  成功 {status:0,data:{scanId, scanUrl, enableScanAppList}} —— 二维码内容字段名为 scanUrl，
 *  值形如 "hypergryph://scan_login?scanId=..."（鹰角 App 扫码深链）。官方未返回过期时间，
 *  客户端按 SCAN_LOGIN_TTL_MS 提示刷新，真正过期以轮询返回 status=101 为准。 */
const SCAN_LOGIN_TTL_MS = 120 * 1000;
async function createScanLogin() {
  const data = await asPost(AS + '/general/v1/gen_scan/login', {});
  if (!data || !data.scanId) throw new Error('官方扫码接口响应异常（缺少 scanId）');
  return {
    scanId: String(data.scanId),
    qrText: String(data.scanUrl || ''),
    expires: Date.now() + SCAN_LOGIN_TTL_MS
  };
}

/** 轮询扫码状态：GET /general/v1/scan_status?scanId=xxx → {status(本地语义), scanCode, raw}
 *  实测待扫码返回 {"msg":"未扫码","status":100}（无 data）；已确认(0)时官方 data 含 scanCode。 */
async function pollScanStatus(scanId) {
  const j = await asRaw('GET', AS + '/general/v1/scan_status?scanId=' + encodeURIComponent(String(scanId)));
  const scanCode = extractScanCode(j);
  return { status: mapScanStatus(j && j.status), scanCode, raw: j ? j.status : undefined };
}

/** 扫码确认后的 scanCode 换登录 token：POST /user/auth/v1/token_by_scan_code → {status:0,data:{token}} */
async function tokenByScanCode(scanCode) {
  const data = await asPost(AS + '/user/auth/v1/token_by_scan_code', { scanCode: String(scanCode) });
  if (!data || !data.token) throw new Error('官方扫码换 token 响应异常（缺少 token）');
  return data.token;
}

/** 登录 token → OAuth token */
async function grant(loginToken) {
  const data = await jfetch('https://as.hypergryph.com/user/oauth2/v2/grant', {
    method: 'POST',
    body: JSON.stringify({ type: 1, appCode: APP_CODE, token: loginToken })
  });
  return data.token;
}

/** 角色绑定列表（uid/nickName/serverId/serverName/channelName）
 *  官方原始结构为 list[].bindingList[].roles[]（应用→账号绑定→游戏角色），
 *  此处拍平为 {list:[{uid,nickName,serverId,serverName,channelName,roleId}]}，
 *  uid 取账号绑定层（u8_token_by_uid 用它），nickName/serverId 取嵌套游戏角色。 */
async function bindingList(oauthToken) {
  const data = await jfetch('https://binding-api-account-prod.hypergryph.com/account/binding/v1/binding_list?token='
    + encodeURIComponent(oauthToken) + '&appCode=endfield');
  const out = [];
  for (const g of ((data && data.list) || [])) {
    for (const b of (g.bindingList || [])) {
      const roles = (Array.isArray(b.roles) && b.roles.length) ? b.roles : [{}];
      for (const r of roles) {
        out.push({
          uid: String(b.uid),
          nickName: (r && r.nickName) || null,
          serverId: r && r.serverId != null ? String(r.serverId) : null,
          serverName: (r && r.serverName) || null,
          channelName: b.channelName || null,
          roleId: r && r.roleId != null ? String(r.roleId) : null
        });
      }
    }
  }
  return { list: out };
}

/** uid + OAuth token → 游戏侧 u8_token */
async function u8TokenByUid(uid, oauthToken) {
  const data = await jfetch('https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid', {
    method: 'POST',
    body: JSON.stringify({ uid, token: oauthToken })
  });
  return data.token;
}

/* ---------- ef-webview 记录接口 ---------- */
const EF = 'https://ef-webview.hypergryph.com';
const efHeaders = { Referer: EF_REFERER };

async function charMeta(u8) {
  return jfetch(`${EF}/api/record/char/meta?lang=zh-cn&token=${encodeURIComponent(u8)}&server_id=1`, { headers: efHeaders });
}
async function charRecords(u8, poolType, seqId) {
  return jfetch(`${EF}/api/record/char?lang=zh-cn&token=${encodeURIComponent(u8)}&server_id=1&pool_type=${encodeURIComponent(poolType)}`
    + (seqId ? `&seq_id=${encodeURIComponent(seqId)}` : ''), { headers: efHeaders });
}
async function weaponPools(u8) {
  return jfetch(`${EF}/api/record/weapon/pool?lang=zh-cn&token=${encodeURIComponent(u8)}&server_id=1`, { headers: efHeaders });
}
async function weaponRecords(u8, poolId, seqId) {
  return jfetch(`${EF}/api/record/weapon?lang=zh-cn&token=${encodeURIComponent(u8)}&server_id=1&pool_id=${encodeURIComponent(poolId)}`
    + (seqId ? `&seq_id=${encodeURIComponent(seqId)}` : ''), { headers: efHeaders });
}

/** 通用分页拉取：seqId 游标=当前页最小值；页间隔防风控；只计正常抽卡（kind==='draw' 或无 kind），gift_* 等赠礼不计抽数 */
async function fetchAllPages(fetchPage, onPage, { maxPages = 400, intervalMs = 220 } = {}) {
  const out = [];
  let seqId = null;
  for (let p = 0; p < maxPages; p++) {
    let data;
    for (let retry = 0; retry < 3; retry++) {
      try { data = await fetchPage(seqId); break; }
      catch (e) { if (retry === 2) throw e; await new Promise(r => setTimeout(r, 800 * (retry + 1))); }
    }
    const list = (data && data.list) || [];
    for (const it of list) if (!it.kind || it.kind === 'draw') out.push(it); // 正常抽卡；gift_* 等赠礼不计抽数
    if (onPage) onPage(p + 1, out.length, !data.hasMore);
    if (!data || !data.hasMore || !list.length) break;
    seqId = list[list.length - 1].seqId; // list 新→旧，取末尾为游标
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return out;
}

module.exports = {
  login, grant, bindingList, u8TokenByUid, charMeta, charRecords, weaponPools, weaponRecords, fetchAllPages, UA,
  sendSmsCode, loginByPhoneCode, createScanLogin, pollScanStatus, tokenByScanCode,
  mapScanStatus, extractScanCode, isValidPhone, SCAN_LOGIN_TTL_MS
};
