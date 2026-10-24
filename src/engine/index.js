'use strict';
const { getData } = require('./dataloader');
const { makeRng } = require('./rng');
const { pullCharacter } = require('./character');
const { pullWeapon } = require('./weapon');

/** 统一抽卡入口 */
function pull(save, bannerId, { times = 10, mode = 'normal', seed, payWithQuota = false } = {}) {
  const data = getData();
  const banner = data.bannerById.get(bannerId);
  if (!banner) throw new Error(`未找到卡池: ${bannerId}`);
  const rng = makeRng(seed);
  const now = new Date().toISOString();
  if (banner.category === 'weapon') {
    return pullWeapon(save, banner, times, mode, rng, now, { payWithQuota });
  }
  return pullCharacter(save, banner, times, mode, rng, now);
}

module.exports = { pull };
