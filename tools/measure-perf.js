'use strict';
/* 性能测量：制造重存档 → 对比抽卡响应体积与耗时 */
async function main() {
  const pull = (bannerId, times = 10, mode = 'normal') => fetch('http://127.0.0.1:3276/api/pull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bannerId, times, mode })
  });

  // 造档：50 次十连（500抽，history/goldRecords 增长）
  for (let i = 0; i < 50; i++) await pull('c14');
  console.log('已制造 500 抽存档');

  // 测量抽卡响应
  let sizes = [], times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const r = await pull('c14');
    const buf = await r.arrayBuffer();
    sizes.push(buf.byteLength);
    times.push(performance.now() - t0);
  }
  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
  console.log('抽卡响应体积: avg %.1f KB (min %d, max %d)', avg(sizes) / 1024, Math.min(...sizes) / 1024, Math.max(...sizes) / 1024);
  console.log('抽卡耗时(本地): avg %.1f ms', avg(times));

  // 对照：/api/state 全量体积
  const st = await fetch('http://127.0.0.1:3276/api/state');
  const stBuf = await st.arrayBuffer();
  console.log('/api/state 全量体积: %.1f KB', stBuf.byteLength / 1024);

  // 清档
  await fetch('http://127.0.0.1:3276/api/reset', { method: 'POST' });
  console.log('已重置存档');
}
main().catch(e => console.error('FATAL', e.message));
