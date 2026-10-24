// Extract context around auth endpoints in the login bundle to learn methods/payloads,
// and find the QR-create call near scan_status / token_by_scan_code.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const JS_URL = 'https://web.hycdn.cn/user-center/index.62f8883d.js';

const res = await fetch(JS_URL, { headers: { 'User-Agent': UA, Referer: 'https://user.hypergryph.com/' } });
const js = await res.text();
console.log('bundle size', js.length);

function ctx(needle, span = 260, max = 4) {
  console.log(`\n===== ${needle} =====`);
  let i = 0, n = 0;
  while (n < max) {
    const at = js.indexOf(needle, i);
    if (at < 0) break;
    console.log(js.slice(Math.max(0, at - span), at + needle.length + span).replace(/\s+/g, ' '));
    console.log('---');
    i = at + needle.length; n++;
  }
  if (!n) console.log('(no hit)');
}

ctx('scan_status');
ctx('token_by_scan_code');
ctx('token_by_phone_code');
ctx('send_phone_code');
// QR creation candidates: any url containing 'qr' or 'scan' we might have missed
ctx('scanId', 200, 3);
ctx('qrcode', 200, 3);
// how requests are made: axios-ish wrapper with .post/.get near these urls
ctx('general/v1/send_phone_code', 300, 2);
