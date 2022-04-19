// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Alea PRNG
// Based on code from Johannes Baagøe <baagoe@baagoe.com>, 2010
// From https://github.com/coverslide/node-alea/blob/master/alea.js, MIT Licensed
// From http://baagoe.com/en/RandomMusings/javascript/

export function mashString(data) {
  let n = 0xefc8249d;
  for (let i = 0; i < data.length; i++) {
    n += data.charCodeAt(i);
    let h = 0.02519603282416938 * n;
    n = h >>> 0;
    h -= n;
    h *= n;
    n = h >>> 0;
    h -= n;
    n += h * 0x100000000; // 2^32
  }
  return n >>> 0;
  // return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
}

// Takes an integer (up to 53bits) and returns a 0-1 float
export function mashI53(data) {
  let n = 0xefc8249d;
  while (data) {
    let byte = data % 256;
    data = (data - byte) / 256;
    n += byte;
    let h = 0.02519603282416938 * n;
    n = h >>> 0;
    h -= n;
    h *= n;
    n = h >>> 0;
    h -= n;
    n += h * 0x100000000; // 2^32
  }
  return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
}

function Mash() {
  this.n = 0xc06c5fc8; // 0xefc8249d;
}
Mash.prototype.mash = function (data) {
  let n = this.n + data;
  let h = 0.02519603282416938 * n;
  n = h >>> 0;
  h -= n;
  h *= n;
  n = h >>> 0;
  h -= n;
  n += h * 0x100000000; // 2^32
  this.n = n;
  return (n >>> 0) * 2.3283064365386963e-10; // 2^-32
};

function Alea(seed) {
  this.reseed(seed);
}
Alea.prototype.reseed = function (seed) {
  // this.s0/s1/s2 are floating point between 0 and 1
  // this.c is a 32-bit int
  this.c = 1;
  let mash = new Mash();
  // Hard-coded results of initial mash(' ') found in original implementation
  this.s0 = 0.3014581324532628;
  this.s1 = 0.2643220406025648;
  this.s2 = 0.7516536582261324;

  this.s0 -= mash.mash(seed);
  if (this.s0 < 0) {
    this.s0 += 1;
  }
  this.s1 -= mash.mash(seed);
  if (this.s1 < 0) {
    this.s1 += 1;
  }
  this.s2 -= mash.mash(seed);
  if (this.s2 < 0) {
    this.s2 += 1;
  }
};
Alea.prototype.step = function () {
  let t = 2091639 * this.s0 + this.c * 2.3283064365386963e-10; // 2^-32
  this.s0 = this.s1;
  this.s1 = this.s2;
  return (this.s2 = t - (this.c = t | 0));
};
Alea.prototype.uint32 = function () {
  return this.step() * 0x100000000; // 2^32
};
Alea.prototype.fract53 = function () {
  return this.step() +
    (this.step() * 0x200000 | 0) * 1.1102230246251565e-16; // 2^-53
};
Alea.prototype.random = Alea.prototype.step;
Alea.prototype.range = function (range) {
  return (this.step() * range) | 0;
};
Alea.prototype.floatBetween = function (a, b) {
  return a + (b - a) * this.random();
};

// Note: import/export probably needs more precision than F32 or JSON provide
Alea.prototype.exportState = function () {
  return [this.s0, this.s1, this.s2, this.c];
};
Alea.prototype.importState = function (i) {
  this.s0 = i[0];
  this.s1 = i[1];
  this.s2 = i[2];
  this.c = i[3];
};

export function randCreate(seed) {
  return new Alea(seed);
}

export function shuffleArray(rand, arr) {
  for (let ii = arr.length - 1; ii >= 1; --ii) {
    let swap = rand.range(ii + 1);
    let t = arr[ii];
    arr[ii] = arr[swap];
    arr[swap] = t;
  }
}
