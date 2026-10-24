'use strict';
const crypto = require('crypto');

/** mulberry32 种子随机数（测试/蒙特卡洛可复现用） */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cryptoRng() {
  return crypto.randomInt(0, 0x100000000) / 0x100000000;
}

/** makeRng(seed?)：seed 为空时使用 crypto 随机 */
function makeRng(seed) {
  if (seed === undefined || seed === null) return cryptoRng;
  return mulberry32(seed);
}

module.exports = { makeRng, mulberry32 };
