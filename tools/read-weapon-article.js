const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) EndfieldGachaSim/1.0' };
async function main() {
  // 篆玉申领 限时特卖说明 的 cid 从 bulletin 列表找
  const lr = await fetch('https://web-news.hypergryph.com/api/bulletin?lang=zh-cn&code=endfield_web&page=1&pageSize=50', { headers: UA });
  const lj = await lr.json();
  const item = ((lj.data && lj.data.list) || []).find(x => x.title.includes('申领'));
  console.log('article:', item && item.title, 'cid', item && item.cid);
  const dr = await fetch(`https://web-news.hypergryph.com/api/bulletin/${item.cid}?lang=zh-cn&code=endfield_web`, { headers: UA });
  const dj = await dr.json();
  const html = (dj.data && dj.data.data) || '';
  const text = html
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
  console.log('=== 正文 ===');
  console.log(text.split('\n').map(s => s.trim()).filter(Boolean).join('\n'));
}
main().catch(e => console.error('FATAL', e.message));
