const gb = require('glov-build');
const JSON5 = require('json5');

module.exports = function (options) {
  options = options || {};
  options.beautify = options.beautify === undefined ? true : options.beautify;

  function parseJSON5(job, done) {
    let file = job.getFile();
    let obj;
    try {
      obj = JSON5.parse(String(file.contents));
    } catch (err) {
      return void done(err);
    }
    job.out({
      relative: file.relative.replace(/\.json5$/, '.json'),
      contents: Buffer.from(JSON.stringify(obj, null, options.beautify ? 2 : null)),
    });
    done();
  }

  return {
    type: gb.SINGLE,
    func: parseJSON5,
  };
};
