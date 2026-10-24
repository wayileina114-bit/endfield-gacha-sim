// Send a LOGIN_OR_REGISTER (type=2) SMS code directly to the official endpoint,
// matching what the official login page does. No credentials stored; phone is a CLI arg.
const phone = String(process.argv[2] || '').trim();
if (!/^1\d{10}$/.test(phone)) { console.error('bad phone'); process.exit(1); }
const res = await fetch('https://as.hypergryph.com/general/v1/send_phone_code', {
  method: 'POST',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Origin': 'https://user.hypergryph.com',
    'Referer': 'https://user.hypergryph.com/',
  },
  body: JSON.stringify({ phone, type: 2 }),
});
console.log('HTTP', res.status, JSON.stringify(await res.json()));
