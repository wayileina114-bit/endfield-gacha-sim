// Find the QR-scan create call: list every "scan" occurrence and every POST near scan_status usage.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const res = await fetch('https://web.hycdn.cn/user-center/index.62f8883d.js', { headers: { 'User-Agent': UA, Referer: 'https://user.hypergryph.com/' } });
const js = await res.text();

// all url-ish strings containing scan/qr
console.log('== url strings with scan/qr ==');
for (const m of js.matchAll(/["'`]([^"'`\s]{4,120}(?:scan|qr)[^"'`\s]{0,80})["'`]/gi)) console.log(m[1]);

// who calls the polling helper Fl( / bu( — find creation preceding: grep for 'scan' identifiers
console.log('\n== identifiers with scan ==');
const ids = new Set();
for (const m of js.matchAll(/[A-Za-z_$][\w$]{0,30}[Ss]can[\w$]{0,20}/g)) ids.add(m[0]);
console.log([...ids].join('\n'));

// find the QR create http call: any yl.post/yl.get whose url literal we haven't listed — dump all yl.get/yl.post urls
console.log('\n== ALL api urls ==');
const urls = new Set();
for (const m of js.matchAll(/yl\.(?:post|get)\((["'`])([^"'`]+)\1/g)) urls.add(m[2]);
[...urls].sort().forEach(u => console.log(u));

// context around the first use of scan_status polling component start (look for setInterval/poll + create)
const at = js.indexOf('token_by_scan_code');
console.log('\n== 800 chars before token_by_scan_code usage ==');
console.log(js.slice(Math.max(0, at - 800), at).replace(/\s+/g, ' '));
