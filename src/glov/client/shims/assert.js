// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

function ok(exp, msg) {
  if (exp) {
    return;
  }
  msg = msg ? msg : (exp === undefined || exp === false) ? '' : JSON.stringify(exp);
  throw new Error(`Assertion failed${msg ? `: ${msg}` : ''}`);
}
module.exports = ok;
module.exports.ok = ok;

function equal(a, b) {
  if (a === b) {
    return;
  }
  throw new Error(`Assertion failed: "${a}"==="${b}"`);
}
module.exports.equal = equal;
