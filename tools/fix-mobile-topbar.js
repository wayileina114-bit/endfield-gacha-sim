// fix-mobile-topbar.js - hide brand text on mobile, add console-safe classes
'use strict';
const fs = require('fs');
const p = 'public/css/style.css';
let s = fs.readFileSync(p, 'utf8');
const add = `
/* ---- 移动端顶栏二次修正：品牌文字让位，徽章独占，杜绝重叠 ---- */
@media (max-width:820px) {
  .brand-text { display: none; }
  .topbar-brand { flex-shrink: 0; }
  .topbar { justify-content: space-between; }
  .topbar-side { flex: 0 1 auto; min-width: 0; }
  .btn-sync .btn-sync-label { display: none; }
}
`;
if (s.includes('.brand-text { display: none; }')) { console.log('already'); process.exit(0); }
fs.writeFileSync(p, s + add);
console.log('topbar mobile fix appended');
