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
      let uglify_options = {
        ...uglify_opts
      };
      function doit() {
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

        if (opts.no_sourcemap) {
          job.out({
            relative: file.relative,
            contents: mangled.code,
          });
        } else {
          sourcemap.out(job, {
            relative: file.relative,
            contents: mangled.code,
            map: mangled.map,
            inline: opts.inline,
          });
        }
        done();
      }
      if (opts.no_sourcemap) {
        doit();
      } else {
        sourcemap.init(job, file, function (err, map) {
          if (err && !opts.no_sourcemap) {
            return void done(err);
          }
          uglify_options.sourceMap = {
            filename: map.file,
            includeSources: true,
            content: map,
          };
          doit();
        });
      }
    },
    version: [
      opts,
      uglify_opts,
    ],
  };
};
