// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

exports.setImmediate = window.setImmediate || function setImmediate(fn) {
  return setTimeout(fn, 0);
};
exports.clearImmediate = window.clearImmediate || function clearImmediate(id) {
  return clearTimeout(id);
};
