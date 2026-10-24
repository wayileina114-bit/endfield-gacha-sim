'use strict';
/** 官方数据本地持久化：登录令牌（可选）与抽卡记录（按 uid） */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const AUTH_PATH = path.join(DATA_DIR, 'official-auth.json');
const RECORDS_PATH = path.join(DATA_DIR, 'official-records.json');

function loadAuth() {
  try { return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8')); } catch { return null; }
}
function saveAuth(auth) { fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 1), 'utf8'); }
function clearAuth() { try { fs.unlinkSync(AUTH_PATH); } catch { /* 无文件 */ } }

function loadRecords() {
  try { return JSON.parse(fs.readFileSync(RECORDS_PATH, 'utf8')); } catch { return { accounts: {} }; }
}
function saveRecords(data) { fs.writeFileSync(RECORDS_PATH, JSON.stringify(data, null, 1), 'utf8'); }

/** 增量合并：按 seqId 去重（账号级单调递增，角色/武器两类各自独立） */
function mergeRecords(store, uid, kind, incoming) {
  const acc = store.accounts[uid] || (store.accounts[uid] = { char: [], weapon: [], updatedAt: null });
  const seen = new Set(acc[kind].map(r => r.seqId));
  let added = 0;
  for (const r of incoming) {
    if (!seen.has(r.seqId)) { acc[kind].push(r); seen.add(r.seqId); added++; }
  }
  acc[kind].sort((a, b) => (Number(b.seqId) || 0) - (Number(a.seqId) || 0));
  acc.updatedAt = new Date().toISOString();
  return added;
}

module.exports = { loadAuth, saveAuth, clearAuth, loadRecords, saveRecords, mergeRecords, AUTH_PATH, RECORDS_PATH };
