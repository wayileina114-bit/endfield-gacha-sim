// Trace the SMS login form: what `type` is passed to send_phone_code, and how phone is formatted.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const res = await fetch('https://web.hycdn.cn/user-center/index.62f8883d.js', { headers: { 'User-Agent': UA, Referer: 'https://user.hypergryph.com/' } });
const js = await res.text();

// 1) The login-form send call: Il({phone:n,type:s}) — dump wide context around it
let at = js.indexOf('Il({phone:n,type:s}');
if (at < 0) at = js.indexOf('{phone:n,type:s}');
console.log('===== form send call wide ctx =====');
console.log(js.slice(Math.max(0, at - 1500), at + 300).replace(/\s+/g, ' '));

// 2) where token_by_phone_code is called — wide context before it for the form's send handler
let b = js.indexOf('token_by_phone_code');
console.log('\n===== token_by_phone_code wide ctx =====');
console.log(js.slice(Math.max(0, b - 2000), b + 200).replace(/\s+/g, ' '));

// 3) phone preprocessing: any +86 / country code handling
console.log('\n===== +86 / country hints =====');
for (const m of js.matchAll(/(.{80})(\+86|country|areaCode|countryCode)(.{120})/g)) {
  const s = (m[1] + m[2] + m[3]).replace(/\s+/g, ' ');
  if (/phone|mobile|tel/i.test(s)) console.log(s, '\n---');
}
