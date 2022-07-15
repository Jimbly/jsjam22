/*
  The problem:  Classes are not hoisted, and therefore cannot be exported safely.
  The wrong solution: hoist classes (causes problems if the class extends any other class
    - that which is exported might be the wrong thing)
  The hacky solution: know our dependency tree and require importing things in the right
    order, like it's 1999 again.
*/

const assert = require('assert');
let has_been_imported = {};

module.exports = function (mod_name, before_name) {
  assert(has_been_imported[mod_name], `Must import ${mod_name} before something that imports ${before_name.match(/[^/\\]+$/)[0]}`);
};

module.exports.imported = function (mod_name) {
  has_been_imported[mod_name] = true;
};
