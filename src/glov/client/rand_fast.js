// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// RandSeed2
// Derived from libGlov, MIT Licensed
// Super-simple RNG.  2-3x faster than Alea, but probably some correlation in
//   anything but 1D.
// Allows for fast, direct manipulation of rand.seed (if correlation between adjacent seeds is acceptable)

//const MAX_INT2 = 0xFFFFFFFF;

// Initialize with two steps past the seed, otherwise close seeds (e.g. 0 and 1) produce very close first results
function step2(seed) {
  seed = (seed >>> 0) || 0x532f638c2; // arbitrary non-zero
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed >>> 0;
}

function RandSeed2(seed) {
  this.seed = step2(seed);
}
RandSeed2.prototype.reseed = function (seed) {
  this.seed = step2(seed);
};
RandSeed2.prototype.step = function () { // as long as seed is never === 0, this never returns 0
  let seed = this.seed;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (this.seed = (seed >>> 0)) - 1;
};
RandSeed2.prototype.uint32 = RandSeed2.prototype.step;
// returns [0,range-1]
RandSeed2.prototype.range = function (range) {
  // slightly slower (esp before opt): return (this.step() * range / MAX_INT2) | 0; // faster than this.step() % range
  // slower: return this.step() % range;
  return (this.step() * range * 2.3283064376e-10) | 0; // 1/MAX_INT2 - largest float such that 0xFFFFFFFE*f < 1.0
};
// returns [0,1)
RandSeed2.prototype.random = function () {
  // slower: return this.step() / MAX_INT2
  return this.step() * 2.3283064376e-10; // 1/MAX_INT2 - largest float such that 0xFFFFFFFE*f < 1.0
};
RandSeed2.prototype.floatBetween = function (a, b) {
  return a + (b - a) * this.random();
};

export function randFastCreate(seed) {
  return new RandSeed2(seed);
}

// from https://www.shadertoy.com/view/wsXfDM
const RND_A = 134775813;
const RND_B = 1103515245;
export function randSimpleSpatial(seed, x, y, z) {
  y += z * 10327;

  return (((((x ^ y) * RND_A) ^ (seed + x)) * (((RND_B * x) << 16) ^ (RND_B * y) - RND_A)) >>> 0) / 4294967295;
}
