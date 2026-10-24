const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const weapons = JSON.parse(fs.readFileSync(path.join(root, 'data', 'weapons.json'), 'utf8'));
const images = JSON.parse(fs.readFileSync(path.join(root, 'data', 'images.json'), 'utf8'));

// 六星全集 = 池内14 + 全部标记为 signature/weaponBanner 的 + 明确的非池六星
const sixStars = new Set([
  ...weapons._meta.standardPoolSixStars,
  ...weapons.weapons.filter(w => w.obtain === 'signature' || w.obtain === 'weaponBanner').map(w => w.name),
  ...weapons.weapons.filter(w => /六星|signature/i.test(JSON.stringify(w))).map(w => w.name)
]);
// canmoe 83 把里，排除六星、排除已知专属非池获取（礼包/通行证/赠送的均为六星已在上面）→ 五星
const fiveStars = Object.keys(images.weapons).filter(n => !sixStars.has(n));
console.log('六星数(并集):', sixStars.size);
console.log('五星候选', fiveStars.length, '个:');
console.log(fiveStars.join(' / '));
