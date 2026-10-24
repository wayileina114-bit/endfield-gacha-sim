// Probe official login page JS bundles for SMS-code and QR-code login endpoints.
// Read-only research: fetch user.hypergryph.com HTML + its JS chunks, grep auth endpoints.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function getText(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': '*/*',
      ...(referer ? { Referer: referer, Origin: 'https://user.hypergryph.com' } : {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

(async () => {
  const base = 'https://user.hypergryph.com/';
  const html = await getText(base);
  console.log('== page fetched, length', html.length);

  // script srcs in HTML
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).map(s => new URL(s, base).href);
  console.log('== top scripts:', srcs.length);
  srcs.forEach(s => console.log('  ', s));

  // endpoint hits collector
  const hits = new Set();
  const EP = /["'`]((?:https?:\/\/)?(?:[a-z0-9.-]*hypergryph\.com)?\/[a-z0-9_\/.-]*?(?:user\/auth|user\/oauth|qrcode|qr_code|sms|phone|captcha|geetest|verification)[a-z0-9_\/.?=-]*)["'`]/gi;

  async function scan(url, depth) {
    try {
      const js = await getText(url, base);
      for (const m of js.matchAll(EP)) hits.add(m[1]);
      // follow lazy chunks one level deep from the entry bundles only
      if (depth > 0) return;
      const chunks = [...js.matchAll(/["'`]([^"'`\s]{1,80}?\.js)["'`]/g)].map(m => m[1]).filter(s => !s.startsWith('http') || s.includes('hypergryph'));
      const uniq = [...new Set(chunks)].slice(0, 40);
      console.log(`== ${url.split('/').pop()} -> ${uniq.length} chunk refs`);
      await Promise.all(uniq.map(c => scan(new URL(c, url).href, 1)));
    } catch (e) {
      console.log('  !!', e.message);
    }
  }

  for (const s of srcs) await scan(s, 0);

  console.log('\n== ENDPOINT HITS ==');
  [...hits].sort().forEach(h => console.log(h));

  // also look for appCode-like constants and login method keywords near UI strings
  const codes = new Set();
  for (const s of srcs) {
    try {
      const js = await getText(s, base);
      for (const m of js.matchAll(/appCode["'\s:=]+["']([a-z0-9]{8,32})["']/gi)) codes.add(m[1]);
      for (const m of js.matchAll(/["']([a-z0-9]{16,32})["']\s*,\s*["']?endfield/i)) codes.add(m[1] + ' (endfield)');
    } catch {}
  }
  console.log('\n== APP CODES ==');
  [...codes].forEach(c => console.log(c));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
