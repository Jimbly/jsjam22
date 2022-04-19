// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const { floor, min } = Math;

let offs = 0;
function now() {
  return Date.now() + offs;
}
module.exports = exports = now;
exports.now = now;
let first = true;
exports.sync = function (server_time) {
  if (first) {
    offs = server_time - Date.now();
  } else {
    offs = min(offs, server_time - Date.now());
  }
};
function toSS2020(milliseconds) {
  // Seconds since Jan 1st, 2020
  return floor(milliseconds / 1000) - 1577836800;
}
exports.toSS2020 = toSS2020;
exports.seconds = function () {
  // Seconds since Jan 1st, 2020
  return toSS2020(now());
};
