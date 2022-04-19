const gb = require('glov-build');
const sourcemap = require('glov-build-sourcemap');

module.exports = function (opts, uglify_opts) {
  let uglify;
  return {
    type: gb.SINGLE,
    init: function (next) {
      uglify = require('uglify-js'); // eslint-disable-line global-require
      next();
    },
    func: function (job, done) {
      let file = job.getFile();
      job.depReset();
      sourcemap.init(job, file, function (err, map) {
        if (err) {
          return void done(err);
        }
        let uglify_options = {
          sourceMap: {
            filename: map.file,
            includeSources: true,
            content: map,
          },
          ...uglify_opts
        };
        let files = {};
        files[file.relative] = String(file.contents);

        let mangled = uglify.minify(files, uglify_options);
        if (!mangled || mangled.error) {
          return void done(mangled && mangled.error || 'Uglify error');
        }
        if (mangled.warnings) {
          mangled.warnings.forEach(function (warn) {
            job.warn(warn);
          });
        }

        sourcemap.out(job, {
          relative: file.relative,
          contents: mangled.code,
          map: mangled.map,
          inline: opts.inline,
        });
        done();
      });
    },
    version: [
      opts,
      uglify_opts,
    ],
  };
};
