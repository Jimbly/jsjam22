import assert from 'assert';
/*
 * Creates an object which can be used as a proxy for a class until the class
 * constructor and prototype are set up.  All static members added and all
 * things added to `prototype` will be added to the eventual class, and all
 * other static property reads are assumed to be calling static functions,
 * which will be deferred and called when the class is realized.
 */
function classProxyCreate() {
  let prototype = {};
  let static_data = {};
  let queued_funcs = [];
  let expected_calls = 0;

  function finalize(target_ctor) {
    assert(!expected_calls); // Otherwise, something referenced was a function not called (or called twice?)
    for (let key in static_data) {
      assert(!target_ctor[key], `Duplicate class field ${key} defined in two files`);
      target_ctor[key] = static_data[key];
    }
    for (let key in prototype) {
      assert(!target_ctor.prototype[key], `Duplicate class function ${key} defined in two files`);
      target_ctor.prototype[key] = prototype[key];
    }
    for (let ii = 0; ii < queued_funcs.length; ++ii) {
      let pair = queued_funcs[ii];
      target_ctor[pair.func_name].apply(target_ctor, pair.args);
    }
  }

  return new Proxy({}, {
    get: function (target, prop) {
      if (prop === 'prototype') {
        return prototype;
      } else if (prop === 'finalize') {
        return finalize;
      }
      // Otherwise, assume function, delay calling until later
      ++expected_calls;
      return function (...args) {
        --expected_calls;
        queued_funcs.push({ func_name: prop, args });
      };
    },
    set: function (target, prop, value) {
      assert(prop !== 'prototype');
      // Setting static data, also fine
      static_data[prop] = value;
      return true;
    },
  });
}
module.exports = classProxyCreate;
