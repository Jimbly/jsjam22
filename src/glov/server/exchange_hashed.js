// Portions Copyright 2021 Jimb Esser (https://github.com/Jimbly/)
// Released under MIT License: https://opensource.org/licenses/MIT

const assert = require('assert');
const { floor } = Math;
const { mashString } = require('glov/common/rand_alea.js');

export function create(exchange_list) {
  assert(exchange_list);
  assert(exchange_list.length);
  // Hash comparison and performance: https://gist.github.com/Jimbly/328387ec1623909af935e133850e9ed6
  let mult = 1 / 0xFFFFFFFF * exchange_list.length;
  function hasher(str) {
    assert(str && typeof str === 'string');
    let ret = mashString(str);
    return floor(ret * mult);
  }
  let ret = {};
  ['register', 'replaceMessageHandler', 'subscribe', 'unregister', 'publish'].forEach((api) => {
    ret[api] = function (id, ...args) {
      let hash = hasher(id);
      return exchange_list[hash][api](id, ...args);
    };
  });
  return ret;
}
