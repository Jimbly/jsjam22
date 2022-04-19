// Portions Copyright 2019 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT
/* eslint prefer-rest-params:off, no-underscore-dangle:off */

const assert = require('assert');

function EventEmitter() {
  this._listeners = {};
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;

function addListener(ee, type, fn, once) {
  assert(typeof fn === 'function');
  let arr = ee._listeners[type];
  if (!arr) {
    arr = ee._listeners[type] = [];
  }
  arr.push({
    once,
    fn,
  });
}

EventEmitter.prototype.hasListener = function (type, fn) {
  let arr = this._listeners[type];
  if (!arr) {
    return false;
  }
  for (let ii = 0; ii < arr.length; ++ii) {
    if (arr[ii].fn === fn) {
      return true;
    }
  }
  return false;
};

EventEmitter.prototype.on = function (type, fn) {
  addListener(this, type, fn, 0);
  return this;
};

EventEmitter.prototype.once = function (type, fn) {
  addListener(this, type, fn, 1);
  return this;
};

EventEmitter.prototype.removeListener = function (type, fn) {
  let arr = this._listeners[type];
  assert(arr);
  for (let ii = 0; ii < arr.length; ++ii) {
    if (arr[ii].fn === fn) {
      arr.splice(ii, 1);
      return this;
    }
  }
  assert(false); // expected to find the listener!
  return this;
};

function filterNotOnce(elem) {
  return !elem.once;
}

EventEmitter.prototype.emit = function (type, ...args) {
  let arr = this._listeners[type];
  if (!arr) {
    return false;
  }

  let any = false;
  let any_once = false;
  for (let ii = 0; ii < arr.length; ++ii) {
    let elem = arr[ii];
    any = true;
    elem.fn(...args);
    if (elem.once) {
      any_once = true;
    }
  }
  if (any_once) {
    this._listeners[type] = arr.filter(filterNotOnce);
  }

  return any;
};

// Aliases
// EventEmitter.prototype.addListener = EventEmitter.prototype.on;
