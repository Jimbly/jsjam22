// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

// Like assert(0), but return the value, so the throw can be disabled if the
// calling code handles failure.  Can replace `verify(foo)` with `(foo)` at
// build time in production builds.

let should_throw = true;

function ok(exp, msg) {
  if (exp) {
    return true;
  }
  if (should_throw) {
    throw new Error(`Assertion failed${msg ? `: ${msg}` : ''}`);
  }
  return false;
}
module.exports = ok;
module.exports.ok = ok;

function equal(a, b) {
  if (a === b) {
    return true;
  }
  if (should_throw) {
    throw new Error(`Assertion failed: "${a}"==="${b}"`);
  }
  return false;
}
module.exports.equal = equal;

function dothrow(doit) {
  should_throw = doit;
}
module.exports.dothrow = dothrow;
