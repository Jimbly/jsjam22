const assert = require('assert');
const gb = require('glov-build');

// patterns = { 'No eval': /\beval\b/ }
module.exports = function warnMatch(patterns) {
  assert.equal(typeof patterns, 'object');
  for (let key in patterns) {
    assert(patterns[key] instanceof RegExp || typeof patterns[key] === 'string');
  }
  return {
    type: gb.SINGLE,
    func: function (job, done) {
      let file = job.getFile();
      let data = file.contents.toString();
      for (let key in patterns) {
        if (data.match(patterns[key])) {
          job.warn(`${file.relative}: failed ${key}`);
        }
      }
      done();
    },
    version: [
      patterns,
    ],
  };
};
