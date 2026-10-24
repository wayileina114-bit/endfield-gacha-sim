// Final probe: gen_scan/login response fields + SMS-login send type value.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const res = await fetch('https://web.hycdn.cn/user-center/index.62f8883d.js', { headers: { 'User-Agent': UA, Referer: 'https://user.hypergryph.com/' } });
const js = await res.text();

function ctx(needle, span, max) {
  console.log(`\n===== ${needle} =====`);
  let i = 0, n = 0;
  while (n < (max || 2)) {
    const at = js.indexOf(needle, i);
    if (at < 0) break;
    console.log(js.slice(Math.max(0, at - span), at + needle.length + span).replace(/\s+/g, ' '));
    console.log('---');
    i = at + needle.length; n++;
  }
}

ctx('gen_scan/login', 500, 3);
// where send_phone_code wrapper Il is invoked from the SMS LOGIN form (not user-info): find "Il(" calls
const calls = [...js.matchAll(/Il\(\{[^}]{0,120}\}/g)].map(m => m[0]);
console.log('\n== Il({...}) send calls ==');
calls.forEach(c => console.log(c));
// enum bl values
ctx('REGISTER=0', 150, 1);
