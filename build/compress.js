const { brotliCompress, gzip } = require('zlib');
const gb = require('glov-build');
const micromatch = require('micromatch');

function gbif(globs, fn) {
  return function (job, done) {
    let file = job.getFile();
    if (micromatch(file.relative, globs).length) {
      fn(job, done);
    } else {
      job.out(file);
      done();
    }
  };
}


module.exports = function (globs) {

  function compressFunc(job, done) {
    let file = job.getFile();
    job.out(file); // pass through uncompressed file
    brotliCompress(file.contents, function (err, buffer_br) {
      if (err) {
        return void done(err);
      }
      job.out({
        relative: `${file.relative}.br`,
        contents: buffer_br,
      });
      gzip(file.contents, function (err, buffer_gz) {
        if (err) {
          return void done(err);
        }
        job.out({
          relative: `${file.relative}.gz`,
          contents: buffer_gz,
        });
        done();
      });
    });
  }

  return {
    type: gb.SINGLE,
    func: gbif(globs, compressFunc),
    version: [
      globs,
      compressFunc,
    ],
  };
};
