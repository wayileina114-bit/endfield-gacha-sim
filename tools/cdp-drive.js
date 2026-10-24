// cdp-drive.js - CDP driver v2: evaluate an expression AND dump console/exceptions
// observed during the call. Usage: node cdp-drive.js "<js expression>" [--watch N sec]
'use strict';
const http = require('http');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
  });
}

async function main() {
  const watchSec = process.argv.includes('--watch') ? Number(process.argv[process.argv.indexOf('--watch') + 1] || 8) : 0;
  const exprIdx = process.argv[2] === '--watch' ? 3 : 2;
  const expr = process.argv[exprIdx] || '1+1';
  const targets = await getJSON('http://127.0.0.1:9222/json/list');
  const page = targets.find(t => t.type === 'page');
  if (!page) { console.error('no page target'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value !== undefined ? String(a.value) : (a.description || a.type)).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push('[EXCEPTION] ' + (d.exception && (d.exception.description || d.exception.value) || d.text));
    } else if (m.method === 'Log.entryAdded') {
      logs.push('[log.' + m.params.entry.level + '] ' + m.params.entry.text);
    }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  await send('Runtime.enable');
  await send('Log.enable');
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (watchSec > 0) await new Promise(res => setTimeout(res, watchSec * 1000));
  console.log('=== RESULT ===');
  console.log(JSON.stringify(r.result, null, 1));
  if (logs.length) {
    console.log('=== CONSOLE/EXCEPTIONS (' + logs.length + ') ===');
    logs.slice(0, 40).forEach(l => console.log(l));
  } else {
    console.log('=== no console output observed ===');
  }
  ws.close();
  function send(method, params) {
    const id = ++seq;
    return new Promise(resolve => { pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  }
}
main().catch(e => { console.error('CDP ERROR', e.message); process.exit(1); });
