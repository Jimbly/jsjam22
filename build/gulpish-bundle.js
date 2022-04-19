// Deprecated - using gulpish to wrap old bundling code; More efficient bundling done in build/bundle.js now
const assert = require('assert');
const babelify = require('babelify');
const browserify = require('browserify');
const concat = require('gulp-concat');
const gb = require('glov-build');
const gulpish = require('./gulpish.js');
const replace = require('gulp-replace');
const log = require('fancy-log');
const path = require('path');
const sourcemaps = require('gulp-sourcemaps');
const uglify = require('@jimbly/gulp-uglify');
const vinyl_buffer = require('vinyl-buffer');
const vinyl_source_stream = require('vinyl-source-stream');
const Vinyl = require('vinyl');
const warn_match = require('../gulp/warn-match.js');

const uglify_options_ext = { compress: true, keep_fnames: false, mangle: true };

function bundleJS(tasks, source, filename, target, is_worker) {
  let bundle_name = filename.replace('.js', is_worker ? '.bundle.int.js' : '.bundle.js');
  let do_version = !is_worker;
  let browserify_opts = {
    debug: true, // generate sourceMaps
    transform: [],
    bundleExternal: false,
    // want fullPaths, but that includes full working paths for some reason, even with basedir set
  };

  let task_base = `gulpish_bundle_${filename}`;
  tasks.push(task_base);
  gb.task({
    name: task_base,
    input: path.join(source, filename),
    ...gulpish(target, function (stream, source_file) {
      let build_timestamp = Date.now();
      log(`Using BUILD_TIMESTAMP=${build_timestamp} for ${filename}`);

      function buildTimestampReplace() {
        // Must be exactly 'BUILD_TIMESTAMP'.length (15) characters long
        let ret = `'${build_timestamp}'`;
        assert.equal(ret.length, 15);
        return ret;
      }

      // didn't help: browserify_opts.basedir = source_file.base;
      let b = browserify([source_file.path], browserify_opts);
      b.on('log', log); // output build logs to terminal

      stream = b
        .bundle()
        .on('error', function (err) {
          log.error('Browserify Error', err);
          stream.emit('error', err);
        })
        .pipe(vinyl_source_stream(bundle_name))
        .pipe(vinyl_buffer())
        .pipe(sourcemaps.init({ loadMaps: true })); // loads map from browserify file
      if (do_version) {
        stream = stream.pipe(replace('BUILD_TIMESTAMP', buildTimestampReplace));
      }

      if (is_worker) {
        // Not as useful as old method of browserify hard-stop, but better than nothing?
        stream = stream.pipe(warn_match({
          'Worker requiring not_worker': /not_worker/,
        }));
      }
      stream = stream
        .pipe(sourcemaps.write(is_worker ? undefined : './')); // embeds or writes .map file

      if (do_version) {
        stream.push(new Vinyl({
          path: `${filename.slice(0, -3)}.ver.json`,
          contents: Buffer.from(`{"ver":"${build_timestamp}"}`),
        }));
      }
      return stream;
    })
  });
}

function bundleDeps(tasks, source, filename, target, is_worker) {
  let bundle_name = filename.replace('.js', is_worker ? '.bundle.int.js' : '.bundle.js');
  let browserify_opts = {
    builtins: {
      // super-simple replacements, if needed
      assert: './src/client/shims/assert.js',
      buffer: './src/client/shims/buffer.js',
      not_worker: !is_worker && './src/client/shims/not_worker.js',
      // timers: './src/client/shims/timers.js',
      _process: './src/client/shims/empty.js',
    },
    debug: true, // generate sourceMaps
    transform: [],
  };
  const babelify_opts = {
    global: true, // Required because some modules (e.g. dot-prop) have ES6 code in it
    // For some reason this is not getting picked up from .babelrc for modules!
    presets: [
      ['@babel/env', {
        'targets': {
          'ie': '10'
        },
        'loose': true,
      }]
    ],
  };

  let task_base = `gulpish_bundle_${filename}`;
  tasks.push(task_base);
  gb.task({
    name: task_base,
    input: path.join(source, filename),
    ...gulpish(target, function (stream, source_file) {
      let b = browserify([source_file.path], browserify_opts);
      b.transform(babelify, babelify_opts);
      b.on('log', log); // output build logs to terminal

      return b
        .bundle()
        .on('error', function (err) {
          log.error('Browserify Error', err);
          stream.emit('error', err);
        })
        .pipe(vinyl_source_stream(bundle_name))
        .pipe(vinyl_buffer())
        .pipe(sourcemaps.init({ loadMaps: true })) // loads map from browserify file
        .pipe(uglify(uglify_options_ext))
        .pipe(sourcemaps.write(is_worker ? undefined : './')); // embeds or writes .map file
    })
  });
}

exports.bundle = function (opts) {
  let { source, entrypoint, deps, deps_source, is_worker, target } = opts;
  let tasks = [];
  let final_target = target;
  if (is_worker) {
    target = true;
  }
  bundleJS(tasks, source, entrypoint, target, is_worker);
  if (deps) {
    bundleDeps(tasks, deps_source, deps, target, is_worker);
  }

  // Just for workers, combine the deps and and entrypoint together (slower, but required)
  if (is_worker) {
    let task_name = `client_js_${entrypoint}_final`;
    assert.equal(tasks.length, 2);
    gb.task({
      name: task_name,
      input: [
        `${tasks[0]}:${entrypoint.replace('.js', '.bundle.int.js')}`,
        `${tasks[1]}:${deps.replace('.js', '.bundle.int.js')}`,
      ],
      ...gulpish({
        sort: function (a, b) {
          // Need explicit ordering for concat
          // TODO: glov-build should do this automatically if task.input.length > 1?
          if (a.relative.indexOf(entrypoint) !== -1) {
            return 1;
          }
          return -1;
        },
        target: final_target,
      }, function (stream) {
        return stream
          .pipe(sourcemaps.init({ loadMaps: true }))
          .pipe(concat(entrypoint.replace('.js', '.bundle.js')))
          .pipe(sourcemaps.write('./'));
      }),
      type: gb.ALL,
    });
    tasks = [task_name];
  }

  return {
    type: gb.SINGLE,
    deps: tasks,
  };
};
